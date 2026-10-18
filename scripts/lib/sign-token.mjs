// Test helper: signs an access token like auth-service does, with a custom
// lifetime — lets the e2e script see the socket close when a token expires.
// Usage: node scripts/lib/sign-token.mjs <secret> <userId> <role> <ttlSeconds>
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

const [secret, sub, role, ttl] = process.argv.slice(2);
process.stdout.write(
  jwt.sign(
    { sub, role, name: 'Expiry Test', email: 'expiry@medflow.az', jti: randomUUID(), iatMs: Date.now() },
    secret,
    { expiresIn: Number(ttl) },
  ),
);
