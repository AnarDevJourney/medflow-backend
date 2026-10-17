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

// "kafka:9092" or "host1:9092,host2:9092" — for apps that use libs/kafka
export const kafkaBrokers = () =>
  Joi.string()
    .pattern(/^[\w.-]+:\d+(,[\w.-]+:\d+)*$/)
    .required()
    .messages({
      'string.pattern.base':
        'KAFKA_BROKERS must look like "host:port,host:port"',
    });
