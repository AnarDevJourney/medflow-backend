import { Injectable } from '@nestjs/common';
import { Topics } from '@medflow/contracts';
import { BaseConsumer, EventHandlers } from '@medflow/kafka';
import { StaffSyncService } from '../modules/staff/staff-sync.service';

// auth.events → staff profiles (DOC 5.6). Each handler runs in the base
// class's transaction together with the processed_events row.
@Injectable()
export class AuthEventsConsumer extends BaseConsumer {
  protected readonly topic = Topics.AUTH;
  protected readonly handlers: EventHandlers = {
    'user.invited': (event, em) => this.sync.onInvited(event.payload, em),
    'user.activated': (event, em) => this.sync.onActivated(event.payload, em),
    'user.updated': (event, em) => this.sync.onUpdated(event.payload, em),
    'user.deactivated': (event, em) =>
      this.sync.onDeactivated(event.payload, em),
    'user.reactivated': (event, em) =>
      this.sync.onReactivated(event.payload, em),
  };

  constructor(private readonly sync: StaffSyncService) {
    super();
  }
}
