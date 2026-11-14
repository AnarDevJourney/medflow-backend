import Joi from 'joi';
import { baseEnvSchema, kafkaBrokers, postgresUrl } from '@medflow/common';

export const envValidationSchema = Joi.object({
  ...baseEnvSchema,
  PORT: Joi.number().default(3003),
  DATABASE_URL: postgresUrl(),
  // Outbox poller (BullMQ)
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  KAFKA_BROKERS: kafkaBrokers(),
});
