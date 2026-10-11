import Joi from 'joi';
import { baseEnvSchema } from '@medflow/common';
import { SERVICES } from '../proxy/service-registry';

const serviceUrls = Object.fromEntries(
  SERVICES.map((s) => [s.urlEnv, Joi.string().uri().required()]),
);

export const envValidationSchema = Joi.object({
  ...baseEnvSchema,
  PORT: Joi.number().default(3000),
  FRONTEND_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  ...serviceUrls,
});
