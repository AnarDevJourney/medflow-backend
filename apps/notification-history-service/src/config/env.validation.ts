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
});
