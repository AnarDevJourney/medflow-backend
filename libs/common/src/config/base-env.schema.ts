import Joi from 'joi';

// Env keys every app needs. Each app spreads these into its own schema:
// Joi.object({ ...baseEnvSchema, PORT: Joi.number().default(3003), ... })
export const baseEnvSchema = {
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  INTERNAL_API_KEY: Joi.string().min(32).required(),
};

export const postgresUrl = () =>
  Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required();
