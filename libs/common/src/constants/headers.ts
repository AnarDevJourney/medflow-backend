// Headers set by the api-gateway. Services trust x-user-* only because the
// request also carries a valid x-internal-key, which only the gateway knows.
export const HEADERS = {
  REQUEST_ID: 'x-request-id',
  INTERNAL_KEY: 'x-internal-key',
  USER_ID: 'x-user-id',
  USER_ROLE: 'x-user-role',
  USER_NAME: 'x-user-name',
} as const;

export const API_PREFIX = 'api/v1';
