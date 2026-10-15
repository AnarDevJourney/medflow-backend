import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Role } from '@medflow/common';
import { hashPassword } from '../common/password.util';
import { AuthConfigService } from '../config/auth-config.service';
import { OutboxService } from '../outbox/outbox.service';
import { User } from '../modules/users/entities/user.entity';
import { UserStatus } from '../modules/users/entities/user-status.enum';

// Creates the first ADMIN from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD when
// that email does not exist yet — there is no public sign-up, so someone has
// to be able to log in and invite the others. Idempotent across restarts.
@Injectable()
export class AdminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AuthConfigService,
    private readonly outbox: OutboxService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const seed = this.config.seedAdmin;
    if (!seed) return;

    const exists = await this.dataSource.manager.existsBy(User, {
      email: seed.email,
    });
    if (exists) return;

    const passwordHash = await hashPassword(seed.password);
    await this.dataSource.transaction(async (em) => {
      const now = new Date();
      const admin = await em.save(
        em.create(User, {
          email: seed.email,
          firstName: 'System',
          lastName: 'Administrator',
          role: Role.ADMIN,
          status: UserStatus.ACTIVE,
          passwordHash,
          passwordChangedAt: now,
        }),
      );

      // Same events as a real invite + accept, so staff-service creates a
      // profile once Kafka publishing exists (phase 3)
      const userData = {
        userId: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
      };
      await this.outbox.add(em, {
        eventType: 'user.invited',
        userId: admin.id,
        actor: null,
        payload: {
          ...userData,
          departmentId: null,
          title: 'System Administrator',
          inviteLink: null,
          expiresAt: null,
          resent: false,
        },
      });
      await this.outbox.add(em, {
        eventType: 'user.activated',
        userId: admin.id,
        actor: null,
        payload: userData,
      });
    });

    this.logger.log(`Seed admin created: ${seed.email}`);
  }
}
