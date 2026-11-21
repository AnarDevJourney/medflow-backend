import { Injectable } from '@nestjs/common';
import { Topics } from '@medflow/contracts';
import { BaseConsumer, EventHandlers } from '@medflow/kafka';
import { EncounterSyncService } from '../modules/appointments/encounter-sync.service';

// record.events → appointment status. Each handler runs in the base
// class's transaction with the processed_events row (redelivery = skip).
@Injectable()
export class RecordEventsConsumer extends BaseConsumer {
  protected readonly topic = Topics.RECORD;
  // Own group: appointment-service.record (patient.events has the default)
  protected readonly groupSuffix = 'record';
  protected readonly handlers: EventHandlers = {
    'encounter.started': (event, em) => this.sync.onStarted(event.payload, em),
    'encounter.closed': (event, em) => this.sync.onClosed(event.payload, em),
  };

  constructor(private readonly sync: EncounterSyncService) {
    super();
  }
}
