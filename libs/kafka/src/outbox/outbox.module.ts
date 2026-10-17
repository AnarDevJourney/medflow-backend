import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OUTBOX_OPTIONS, OutboxModuleOptions } from './outbox.constants';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxPoller } from './outbox.poller';
import { OutboxService } from './outbox.service';

// For services that publish events: OutboxService (write) + OutboxPoller
// (send). Needs KafkaModule, the database and REDIS_URL (BullMQ).
@Module({})
export class OutboxModule {
  static forRoot(options: OutboxModuleOptions): DynamicModule {
    return {
      module: OutboxModule,
      global: true,
      imports: [TypeOrmModule.forFeature([OutboxEvent])],
      providers: [
        { provide: OUTBOX_OPTIONS, useValue: options },
        OutboxService,
        OutboxPoller,
      ],
      exports: [OutboxService],
    };
  }
}
