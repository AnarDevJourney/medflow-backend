import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { HEADERS } from '../constants/headers';
import { requestContext } from '../context/request-context';

// Only accept ids that are safe to put in logs and headers
const VALID_REQUEST_ID = /^[\w-]{1,64}$/;

// Keeps an incoming x-request-id (set by the gateway) or creates a new one,
// so a single id follows a click through gateway → service → Kafka → consumer.
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers[HEADERS.REQUEST_ID];
  const requestId =
    typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming)
      ? incoming
      : randomUUID();

  req.headers[HEADERS.REQUEST_ID] = requestId;
  res.setHeader(HEADERS.REQUEST_ID, requestId);

  requestContext.run({ requestId }, () => next());
}
