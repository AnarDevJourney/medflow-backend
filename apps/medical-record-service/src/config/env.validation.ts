import Joi from 'joi';
import { baseEnvSchema, kafkaBrokers, postgresUrl } from '@medflow/common';

export const envValidationSchema = Joi.object({
  ...baseEnvSchema,
  PORT: Joi.number().default(3005),
  DATABASE_URL: postgresUrl(),
  // Outbox poller (BullMQ)
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  KAFKA_BROKERS: kafkaBrokers(),
  // Starting a visit: the appointment (status, doctor, snapshots)
  APPOINTMENT_SERVICE_URL: Joi.string().uri().required(),
});
