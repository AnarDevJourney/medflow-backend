import { Inject, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import Redis from 'ioredis';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import {
  AccessTokenPayload,
  AUTH_COOKIES,
  ErrorCode,
  isAccessTokenRevoked,
  readCookie,
  REDIS_CLIENT,
  Role,
} from '@medflow/common';
import { Notification } from './entities/notification.entity';
import { NotificationResponse } from './notification.response';

// Rooms (DOC 6.7). Department rooms (role:NURSE:dept:<id>, lab queue) need
// the staff profile and come with phases 5/8.
export const ROOMS = {
  user: (userId: string) => `user:${userId}`,
  role: (role: Role) => `role:${role}`,
};

// What the server emits
export const SERVER_EVENTS = {
  NOTIFICATION: 'notification', // a new notification (NotificationResponse)
  COUNT: 'notification:count', // { count } — unread badge, server is the source of truth
  SESSION_EXPIRED: 'session:expired', // access token expired → refresh, reconnect
  SESSION_REVOKED: 'session:revoked', // logged out elsewhere / deactivated → login
  PERMISSIONS: 'permissions:updated', // { role, permissions } — the role's new list
} as const;

interface SocketUser {
  id: string;
  role: Role;
  iatMs: number;
  exp: number; // seconds
}

type AuthSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  { user: SocketUser }
>;

// Handshake error the client receives in `connect_error` (err.message, err.data.code)
function handshakeError(code: ErrorCode, message: string): Error {
  return Object.assign(new Error(message), { data: { code } });
}

// Socket.io server (DOC 6.7). The browser connects to /socket.io on the
// gateway, which proxies the upgrade here; the gateway does not check the
// token for it, so the handshake does the same checks as the gateway does
// for HTTP: access_token cookie → JWT signature → Redis block-list.
@WebSocketGateway({ cors: false, serveClient: false })
export class NotificationsGateway
  implements OnGatewayInit<Server>, OnGatewayConnection<AuthSocket>
{
  @WebSocketServer() private readonly server: Server;
  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly jwt: JwtService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  afterInit(server: Server) {
    server.use((socket, next) => {
      this.authenticate(socket as AuthSocket).then(
        () => next(),
        (error: Error) => next(error),
      );
    });
  }

  async handleConnection(socket: AuthSocket) {
    const { user } = socket.data;
    await socket.join([ROOMS.user(user.id), ROOMS.role(user.role)]);

    // The access token lives 15 min — the socket must not outlive it. The
    // client refreshes the cookie and reconnects.
    const timer = setTimeout(
      () => {
        socket.emit(SERVER_EVENTS.SESSION_EXPIRED);
        socket.disconnect(true);
      },
      Math.max(0, user.exp * 1000 - Date.now()),
    );
    socket.once('disconnect', () => clearTimeout(timer));

    try {
      socket.emit(SERVER_EVENTS.COUNT, {
        count: await this.unreadCount(user.id),
      });
    } catch (error) {
      this.logger.warn(`Initial count failed: ${(error as Error).message}`);
    }
  }

  pushNotification(userId: string, notification: NotificationResponse) {
    this.server
      .to(ROOMS.user(userId))
      .emit(SERVER_EVENTS.NOTIFICATION, notification);
  }

  // The admin changed a role's permissions: open clients of that role
  // update menus and buttons without a reload
  pushPermissions(role: Role, permissions: string[]) {
    this.server
      .to(ROOMS.role(role))
      .emit(SERVER_EVENTS.PERMISSIONS, { role, permissions });
  }

  // Fresh unread counts of several users with one query
  async pushCounts(userIds: string[]) {
    if (userIds.length === 0) return;
    const rows = await this.notifications
      .createQueryBuilder('n')
      .select('n.recipientId', 'recipientId')
      .addSelect('COUNT(*)::int', 'count')
      .where('n.recipientId IN (:...userIds)', { userIds })
      .andWhere('NOT n.isRead')
      .groupBy('n.recipientId')
      .getRawMany<{ recipientId: string; count: number }>();
    const counts = new Map(rows.map((r) => [r.recipientId, r.count]));
    for (const userId of userIds) {
      this.server
        .to(ROOMS.user(userId))
        .emit(SERVER_EVENTS.COUNT, { count: counts.get(userId) ?? 0 });
    }
  }

  // Closes the sockets opened with tokens issued before `beforeMs`
  // (deactivation, password change, refresh-token reuse) — the rule the
  // gateway applies to HTTP via auth:revoked-before. Newer sockets stay.
  async revokeSockets(userId: string, beforeMs: number) {
    const sockets = await this.server.in(ROOMS.user(userId)).fetchSockets();
    for (const socket of sockets) {
      const user = (socket.data as { user: SocketUser }).user;
      if (user.iatMs < beforeMs) {
        socket.emit(SERVER_EVENTS.SESSION_REVOKED);
        socket.disconnect(true);
      }
    }
  }

  private unreadCount(userId: string): Promise<number> {
    return this.notifications.count({
      where: { recipientId: userId, isRead: false },
    });
  }

  private async authenticate(socket: AuthSocket) {
    const token = readCookie(
      socket.handshake.headers.cookie,
      AUTH_COOKIES.ACCESS,
    );
    if (!token) {
      throw handshakeError(ErrorCode.UNAUTHORIZED, 'Authentication required');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw handshakeError(
        ErrorCode.UNAUTHORIZED,
        'Session expired, please refresh',
      );
    }

    let revoked: boolean;
    try {
      revoked = await isAccessTokenRevoked(this.redis, payload);
    } catch (error) {
      // Fail closed, like the gateway
      this.logger.error(`Block-list check failed: ${(error as Error).message}`);
      throw handshakeError(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Authentication is temporarily unavailable, please try again',
      );
    }
    if (revoked) {
      throw handshakeError(
        ErrorCode.UNAUTHORIZED,
        'Session has been revoked, please log in again',
      );
    }

    socket.data.user = {
      id: payload.sub,
      role: payload.role,
      iatMs: payload.iatMs,
      exp: payload.exp,
    };
  }
}
