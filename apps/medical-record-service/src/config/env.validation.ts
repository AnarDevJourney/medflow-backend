import Joi from 'joi';
import { baseEnvSchema, postgresUrl } from '@medflow/common';

export const envValidationSchema = Joi.object({
  ...baseEnvSchema,
  PORT: Joi.number().default(3005),
  DATABASE_URL: postgresUrl(),
});
