import { API_PREFIX } from '@medflow/common';

const AUTH = `/${API_PREFIX}/auth`;

// Routes the gateway lets through without an access token (DOC 1.3 step 4).
// logout is public so it also works when the access token has expired.
const PUBLIC_ROUTES: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: 'POST', path: new RegExp(`^${AUTH}/login/?$`) },
  { method: 'POST', path: new RegExp(`^${AUTH}/refresh/?$`) },
  { method: 'POST', path: new RegExp(`^${AUTH}/logout/?$`) },
  { method: 'GET', path: new RegExp(`^${AUTH}/invitations/[^/]+/?$`) },
  { method: 'POST', path: new RegExp(`^${AUTH}/accept-invite/?$`) },
  { method: 'POST', path: new RegExp(`^${AUTH}/forgot-password/?$`) },
  { method: 'POST', path: new RegExp(`^${AUTH}/reset-password/?$`) },
];

export function isPublicRoute(method: string, path: string): boolean {
  return PUBLIC_ROUTES.some((r) => r.method === method && r.path.test(path));
}

// Stricter rate limit: password guessing and reset-email spam
const STRICT_ROUTES: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: 'POST', path: new RegExp(`^${AUTH}/login/?$`) },
  { method: 'POST', path: new RegExp(`^${AUTH}/forgot-password/?$`) },
];

export function isStrictRateLimitRoute(method: string, path: string): boolean {
  return STRICT_ROUTES.some((r) => r.method === method && r.path.test(path));
}
