import { createHash, randomBytes } from 'node:crypto';

// Opaque tokens (refresh, invite, reset): random bytes, base64url.
// Only sha256(token) is stored, so a DB leak exposes no usable token.
export function generateToken(bytes = 64): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
