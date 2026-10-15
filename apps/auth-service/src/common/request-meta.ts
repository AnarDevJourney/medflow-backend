import { isIP } from 'node:net';
import type { Request } from 'express';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

// The gateway appends the real client address to x-forwarded-for (xfwd), so
// the LAST entry is the trustworthy one — earlier ones can be client-made.
export function getRequestMeta(req: Request): RequestMeta {
  const forwarded = req.headers['x-forwarded-for'];
  const chain = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const raw = chain?.at(-1) ?? req.socket.remoteAddress ?? '';
  const ip = raw.replace(/^::ffff:/, '');

  return {
    ip: isIP(ip) ? ip : null,
    userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
  };
}
