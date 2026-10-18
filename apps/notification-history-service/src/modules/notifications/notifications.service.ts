import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AppException,
  ErrorCode,
  Paginated,
  paginated,
  parseSort,
  skipOf,
} from '@medflow/common';
import {
  ListNotificationsQueryDto,
  NOTIFICATION_SORT_FIELDS,
} from './dto/list-notifications-query.dto';
import { Notification } from './entities/notification.entity';
import {
  NotificationResponse,
  toNotificationResponse,
} from './notification.response';
import { NotificationsGateway } from './notifications.gateway';

// Own notifications of the current user (DOC 8.9). Rows are created only by
// NotificationsConsumer; a user can only read and mark their own.
@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly gateway: NotificationsGateway,
  ) {}

  async list(
    userId: string,
    query: ListNotificationsQueryDto,
  ): Promise<Paginated<NotificationResponse>> {
    const qb = this.notifications
      .createQueryBuilder('n')
      .where('n.recipientId = :userId', { userId });
    if (query.unread !== undefined) {
      qb.andWhere('n.isRead = :isRead', { isRead: !query.unread });
    }

    const sort = parseSort(query.sort, NOTIFICATION_SORT_FIELDS, {
      createdAt: 'DESC',
    });
    for (const [field, direction] of Object.entries(sort)) {
      qb.addOrderBy(`n.${field}`, direction);
    }
    qb.addOrderBy('n.id', 'ASC'); // stable pages when timestamps tie

    const [rows, total] = await qb
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();
    return paginated(rows.map(toNotificationResponse), total, query);
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.notifications.count({
      where: { recipientId: userId, isRead: false },
    });
    return { count };
  }

  // Idempotent: marking a read notification again keeps the first read_at.
  // Someone else's notification → 404 (its existence is not revealed).
  async markRead(id: string, userId: string): Promise<NotificationResponse> {
    const result = await this.notifications
      .createQueryBuilder()
      .update()
      .set({ isRead: true, readAt: () => 'now()' })
      .where('id = :id AND recipient_id = :userId AND NOT is_read', {
        id,
        userId,
      })
      .execute();

    const notification = await this.notifications.findOneBy({
      id,
      recipientId: userId,
    });
    if (!notification) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Notification not found',
      );
    }
    // Other open tabs update their badge
    if (result.affected) await this.gateway.pushCounts([userId]);
    return toNotificationResponse(notification);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notifications
      .createQueryBuilder()
      .update()
      .set({ isRead: true, readAt: () => 'now()' })
      .where('recipient_id = :userId AND NOT is_read', { userId })
      .execute();
    const updated = result.affected ?? 0;
    if (updated > 0) await this.gateway.pushCounts([userId]);
    return { updated };
  }
}
