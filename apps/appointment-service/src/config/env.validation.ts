import Joi from 'joi';
import { baseEnvSchema, kafkaBrokers, postgresUrl } from '@medflow/common';

export const envValidationSchema = Joi.object({
  ...baseEnvSchema,
  PORT: Joi.number().default(3004),
  DATABASE_URL: postgresUrl(),
  // Outbox poller (BullMQ); reminder / no-show jobs later (7.4)
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  KAFKA_BROKERS: kafkaBrokers(),
  // Internal calls while booking: doctor's day, patient summary
  STAFF_SERVICE_URL: Joi.string().uri().required(),
  PATIENT_SERVICE_URL: Joi.string().uri().required(),
});
