import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProcessedEvent } from './processed-event.entity';

// Import in the module that declares BaseConsumer subclasses, so the
// processed_events entity is registered (the table comes from the
// service's own migration)
@Module({
  imports: [TypeOrmModule.forFeature([ProcessedEvent])],
})
export class KafkaConsumerModule {}
