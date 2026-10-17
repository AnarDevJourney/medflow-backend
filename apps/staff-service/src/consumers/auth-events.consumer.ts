import { Injectable } from '@nestjs/common';
import { Topics } from '@medflow/contracts';
import type { DomainEvent } from '@medflow/contracts';
import { BaseConsumer, EventHandlers } from '@medflow/kafka';

// auth.events → staff profiles (DOC 5.6).
// TODO(phase 5): real handlers — create the profile on user.invited (skip
// resent), sync on user.updated, is_active on user.deactivated/reactivated.
// Until then every event is only recorded in processed_events and logged,
// which proves the outbox → Kafka → consumer path. Phase 5 must replay the
// topic for this group (truncate processed_events + reset the group offsets
// to the earliest, see scripts/kafka-reset-group.sh), otherwise the users
// that exist now never get a profile.
@Injectable()
export class AuthEventsConsumer extends BaseConsumer {
  protected readonly topic = Topics.AUTH;
  protected readonly handlers: EventHandlers = {
    'user.invited': (event) => this.received(event),
    'user.activated': (event) => this.received(event),
    'user.updated': (event) => this.received(event),
    'user.deactivated': (event) => this.received(event),
    'user.reactivated': (event) => this.received(event),
  };

  private received(event: DomainEvent): Promise<void> {
    this.logger.log(
      `Received ${event.eventType} ${event.eventId} for user ${event.payload.userId}`,
    );
    return Promise.resolve();
  }
}
