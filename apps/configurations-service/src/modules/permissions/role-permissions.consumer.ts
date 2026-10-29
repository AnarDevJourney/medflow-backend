import { Injectable } from '@nestjs/common';
import { Topics } from '@medflow/contracts';
import { BaseConsumer, EventHandlers } from '@medflow/kafka';
import { PermissionsService } from './permissions.service';

// configurations.events → Redis: the admin's change reaches the cache the
// gateway reads. Writing the same list twice is harmless and an older event
// never overwrites a newer list (versioned write), so no processed_events.
@Injectable()
export class RolePermissionsConsumer extends BaseConsumer {
  protected readonly topic = Topics.CONFIGURATIONS;
  protected readonly useProcessedEvents = false;
  protected readonly handlers: EventHandlers = {
    'role_permissions.updated': async (event) => {
      const { role, permissions } = event.payload;
      const written = await this.permissions.applyEvent(
        role,
        permissions,
        event.occurredAt,
      );
      this.logger.log(
        written
          ? `Permission cache of ${role} updated (${permissions.length})`
          : `Permission cache of ${role} is newer, event ${event.eventId} skipped`,
      );
    },
  };

  constructor(private readonly permissions: PermissionsService) {
    super();
  }
}
