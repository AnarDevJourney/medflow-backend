import { Injectable } from '@nestjs/common';
import { Topics } from '@medflow/contracts';
import { BaseConsumer, EventHandlers } from '@medflow/kafka';
import { PatientSyncService } from '../modules/appointments/patient-sync.service';

// patient.events → appointment snapshots / system cancellations. Each
// handler runs in the base class's transaction with the processed_events
// row, so a redelivered event is skipped.
@Injectable()
export class PatientEventsConsumer extends BaseConsumer {
  protected readonly topic = Topics.PATIENT;
  protected readonly handlers: EventHandlers = {
    'patient.updated': (event, em) => this.sync.onUpdated(event.payload, em),
    'patient.deactivated': (event, em) =>
      this.sync.onDeactivated(event.payload, em),
  };

  constructor(private readonly sync: PatientSyncService) {
    super();
  }
}
