import {
  DynamicModule,
  Global,
  Inject,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { Kafka, Partitioners } from 'kafkajs';
import type { Producer } from 'kafkajs';
import { HealthChecksRegistry } from '@medflow/common';
import { KafkaHealthIndicator } from './kafka-health';
import { nestLogCreator } from './kafka-logger';
import {
  KAFKA_CLIENT,
  KAFKA_OPTIONS,
  KAFKA_PRODUCER,
  KafkaModuleOptions,
} from './kafka.constants';

// KafkaJS client + one shared producer per service (DOC 5). Plain pub/sub —
// not @nestjs/microservices — so commits, retries and idempotency stay in
// our hands. The outbox poller and the consumers' DLQ use the producer.
@Global()
@Module({})
export class KafkaModule implements OnModuleInit, OnApplicationShutdown {
  static forRoot(options: KafkaModuleOptions): DynamicModule {
    return {
      module: KafkaModule,
      imports: [TerminusModule],
      providers: [
        { provide: KAFKA_OPTIONS, useValue: options },
        {
          provide: KAFKA_CLIENT,
          inject: [ConfigService],
          useFactory: (config: ConfigService) =>
            new Kafka({
              clientId: options.serviceName,
              brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
              logCreator: nestLogCreator,
              // A request to a dead broker fails after 10 s, not 30 s
              requestTimeout: 10_000,
            }),
        },
        {
          provide: KAFKA_PRODUCER,
          inject: [KAFKA_CLIENT],
          useFactory: (kafka: Kafka) =>
            kafka.producer({
              // One request at a time keeps the order of a batch even when
              // a send is retried. Not KafkaJS's idempotent producer: the
              // outbox can resend anyway (DOC 5.3) and consumers de-duplicate.
              maxInFlightRequests: 1,
              allowAutoTopicCreation: false,
              // Fail within a few seconds when the broker is down: the outbox
              // poller records the error and retries on the next tick
              // instead of hanging inside one send (and its DB transaction)
              retry: { retries: 3, initialRetryTime: 300, maxRetryTime: 2000 },
              createPartitioner: Partitioners.DefaultPartitioner,
            }),
        },
        KafkaHealthIndicator,
      ],
      exports: [KAFKA_OPTIONS, KAFKA_CLIENT, KAFKA_PRODUCER],
    };
  }

  constructor(
    @Inject(KAFKA_PRODUCER) private readonly producer: Producer,
    private readonly health: KafkaHealthIndicator,
    private readonly registry: HealthChecksRegistry,
  ) {}

  // The app does not start without Kafka (Docker restarts it), like with
  // the database
  async onModuleInit() {
    this.registry.register(this.health.check);
    await this.producer.connect();
  }

  async onApplicationShutdown() {
    await this.producer.disconnect();
  }
}
