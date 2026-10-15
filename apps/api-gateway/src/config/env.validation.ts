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
  // Same secret auth-service signs the access tokens with
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  // Requests per minute per IP: whole API / login + forgot-password
  RATE_LIMIT_DEFAULT: Joi.number().integer().min(1).default(100),
  RATE_LIMIT_STRICT: Joi.number().integer().min(1).default(10),
  ...serviceUrls,
});
