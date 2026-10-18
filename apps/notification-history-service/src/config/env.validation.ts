import Joi from 'joi';
import { baseEnvSchema, kafkaBrokers, postgresUrl } from '@medflow/common';

export const envValidationSchema = Joi.object({
  ...baseEnvSchema,
  PORT: Joi.number().default(3008),
  DATABASE_URL: postgresUrl(),
  KAFKA_BROKERS: kafkaBrokers(),
  // Upper bound of one action-history fetch / insert batch (default 1 MB)
  HISTORY_BATCH_MAX_BYTES: Joi.number()
    .integer()
    .min(64 * 1024)
    .default(1024 * 1024),
  // Same for in-app notifications
  NOTIFICATION_BATCH_MAX_BYTES: Joi.number()
    .integer()
    .min(64 * 1024)
    .default(1024 * 1024),
  // Older events (replayed after an outage) are stored but not pushed live
  NOTIFICATION_PUSH_MAX_AGE_SECONDS: Joi.number().integer().min(1).default(600),
  // Socket.io handshake: verify the access token + check the block-list
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
});
