import Joi from 'joi';
import { baseEnvSchema, postgresUrl } from '@medflow/common';

// "15m", "7d", "3600s" …
const duration = () => Joi.string().pattern(/^\d+[smhd]$/);

export const envValidationSchema = Joi.object({
  ...baseEnvSchema,
  PORT: Joi.number().default(3001),
  DATABASE_URL: postgresUrl(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  FRONTEND_URL: Joi.string().uri().required(),

  // Same secret as the gateway (which verifies the tokens)
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: duration().default('15m'),
  JWT_REFRESH_TTL: duration().default('7d'),
  // Defaults to true in production. Browsers accept Secure cookies on
  // http://localhost, so the Docker stack works either way.
  COOKIE_SECURE: Joi.boolean(),

  // Log invite / reset links (no emails before phase 4). Defaults to true
  // outside production. TODO(phase 4): drop once notification-history sends emails.
  LOG_AUTH_LINKS: Joi.boolean(),

  // Optional first admin, created on startup if the email does not exist yet
  SEED_ADMIN_EMAIL: Joi.string().email(),
  SEED_ADMIN_PASSWORD: Joi.string().min(8).when('SEED_ADMIN_EMAIL', {
    is: Joi.exist(),
    then: Joi.required(),
  }),
});
