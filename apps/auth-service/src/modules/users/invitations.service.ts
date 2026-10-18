import { HttpStatus, Injectable } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { AppException, ErrorCode } from '@medflow/common';
import { generateToken, sha256 } from '../../common/crypto.util';
import { AuthConfigService } from '../../config/auth-config.service';
import { Invitation } from './entities/invitation.entity';
import { User } from './entities/user.entity';
import { UserStatus } from './entities/user-status.enum';

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

export interface CreatedInvitation {
  link: string;
  expiresAt: Date;
}

export interface PendingInvitation {
  invitation: Invitation;
  user: User;
}

// Invite tokens (DOC 3.3): 72 h, single use, only the sha256 is stored
@Injectable()
export class InvitationsService {
  constructor(private readonly config: AuthConfigService) {}

  // Replaces any pending invitation of the user (resend invalidates the old link)
  async create(
    em: EntityManager,
    user: User,
    createdBy: string,
  ): Promise<CreatedInvitation> {
    await em.delete(Invitation, { userId: user.id, acceptedAt: IsNull() });

    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await em.insert(Invitation, {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt,
      createdBy,
    });

    // Sent by notification-history (staff-invite email), never logged
    const link = `${this.config.frontendUrl}/accept-invite?token=${token}`;
    return { link, expiresAt };
  }

  // Valid = exists, not accepted, not expired, user still INVITED.
  // With lock = true the invitation row is locked until the transaction ends.
  async findPending(
    em: EntityManager,
    rawToken: string,
    lock = false,
  ): Promise<PendingInvitation> {
    const invitation = await em.findOne(Invitation, {
      where: { tokenHash: sha256(rawToken) },
      ...(lock && { lock: { mode: 'pessimistic_write' as const } }),
    });
    if (!invitation) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Invitation not found or no longer valid',
      );
    }
    if (invitation.acceptedAt) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        'Invitation has already been accepted',
      );
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new AppException(
        HttpStatus.GONE,
        ErrorCode.INVITE_EXPIRED,
        'Invitation has expired — ask an administrator to resend it',
      );
    }

    const user = await em.findOneByOrFail(User, { id: invitation.userId });
    if (user.status !== UserStatus.INVITED) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATUS,
        'This account is no longer waiting for activation',
      );
    }
    return { invitation, user };
  }
}
