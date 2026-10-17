export const KAFKA_CLIENT = Symbol('KAFKA_CLIENT');
export const KAFKA_PRODUCER = Symbol('KAFKA_PRODUCER');
export const KAFKA_OPTIONS = Symbol('KAFKA_OPTIONS');

export interface KafkaModuleOptions {
  // Service name: Kafka client id, consumer group id and envelope source
  serviceName: string;
}
