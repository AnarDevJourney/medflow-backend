import Joi from 'joi';
import { baseEnvSchema, kafkaBrokers, postgresUrl } from '@medflow/common';

export const envValidationSchema = Joi.object({
  ...baseEnvSchema,
  PORT: Joi.number().default(3009),
  DATABASE_URL: postgresUrl(),
  // Permission cache + outbox poller (BullMQ)
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  KAFKA_BROKERS: kafkaBrokers(),
});
