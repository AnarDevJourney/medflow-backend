import Joi from 'joi';
import { baseEnvSchema, postgresUrl } from '@medflow/common';

export const envValidationSchema = Joi.object({
  ...baseEnvSchema,
  PORT: Joi.number().default(3002),
  DATABASE_URL: postgresUrl(),
});
