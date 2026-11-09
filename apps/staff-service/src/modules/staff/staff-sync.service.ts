import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Role } from '@medflow/common';
import type {
  UserActivatedPayload,
  UserDeactivatedPayload,
  UserInvitedPayload,
  UserReactivatedPayload,
  UserUpdatedPayload,
} from '@medflow/contracts';
import { Department } from '../departments/entities/department.entity';
import { StaffMember, StaffStatus } from './entities/staff-member.entity';

type Identity = Pick<
  StaffMember,
  'userId' | 'firstName' | 'lastName' | 'email' | 'role'
>;

const identityOf = (p: {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}): Identity => ({
  userId: p.userId,
  firstName: p.firstName,
  lastName: p.lastName,
  email: p.email,
  role: p.role as Role,
});

// auth.events → staff_members (DOC 5.6). Runs inside the consumer's
// transaction (with its processed_events row), so a repeat is skipped.
// Events of one user come in order (Kafka key = user id), so user.invited
// always arrives before the others. Auth data (name, email, role, status)
// changes only here; staff fields (department, title, …) only through the API.
@Injectable()
export class StaffSyncService {
  private readonly logger = new Logger(StaffSyncService.name);

  // Creates the profile. A resent invite (or a replay) finds it already
  // there: then only the auth copies are refreshed — department and title
  // from the first invite stay.
  async onInvited(p: UserInvitedPayload, em: EntityManager): Promise<void> {
    const departmentId = await this.existingDepartment(p.departmentId, em);
    await em
      .createQueryBuilder()
      .insert()
      .into(StaffMember)
      .values({
        ...identityOf(p),
        status: StaffStatus.INVITED,
        departmentId,
        title: p.title,
      })
      .orUpdate(['first_name', 'last_name', 'email', 'role'], ['user_id'])
      .updateEntity(false)
      .execute();
  }

  // The invite was accepted (or the seeded admin was activated)
  async onActivated(p: UserActivatedPayload, em: EntityManager): Promise<void> {
    await em
      .createQueryBuilder()
      .insert()
      .into(StaffMember)
      .values({ ...identityOf(p), status: StaffStatus.ACTIVE, isActive: true })
      .orUpdate(
        ['first_name', 'last_name', 'email', 'role', 'status', 'is_active'],
        ['user_id'],
      )
      .updateEntity(false)
      .execute();
  }

  async onUpdated(p: UserUpdatedPayload, em: EntityManager): Promise<void> {
    const { userId, ...identity } = identityOf(p);
    await this.updateExisting(userId, identity, em, 'user.updated');
  }

  async onDeactivated(
    p: UserDeactivatedPayload,
    em: EntityManager,
  ): Promise<void> {
    await this.updateExisting(
      p.userId,
      { status: StaffStatus.DEACTIVATED, isActive: false },
      em,
      'user.deactivated',
    );
  }

  async onReactivated(
    p: UserReactivatedPayload,
    em: EntityManager,
  ): Promise<void> {
    await this.updateExisting(
      p.userId,
      { status: p.status as StaffStatus, isActive: true },
      em,
      'user.reactivated',
    );
  }

  // No profile = its user.invited was never received (it cannot come later:
  // same partition, in order). Nothing to update; logged, not retried.
  private async updateExisting(
    userId: string,
    changes: Partial<StaffMember>,
    em: EntityManager,
    eventType: string,
  ): Promise<void> {
    const result = await em.update(StaffMember, { userId }, changes);
    if (!result.affected) {
      this.logger.warn(
        `${eventType} for user ${userId} without a staff profile — skipped`,
      );
    }
  }

  // auth checks the department on invite; it may still have been removed
  // from the event's point of view (never in practice — departments are not
  // deleted). An unknown id must not fail the FK and park the event.
  private async existingDepartment(
    id: string | null,
    em: EntityManager,
  ): Promise<string | null> {
    if (!id) return null;
    const exists = await em.existsBy(Department, { id });
    if (!exists) {
      this.logger.warn(`user.invited names unknown department ${id} — ignored`);
    }
    return exists ? id : null;
  }
}
