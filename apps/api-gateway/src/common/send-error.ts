import type { IncomingMessage, ServerResponse } from 'node:http';
import { ErrorCode, HEADERS } from '@medflow/common';

// Errors produced by gateway middleware (outside Nest's exception filter)
// in the same envelope the services use
export function sendError(
  req: IncomingMessage,
  res: ServerResponse,
  statusCode: number,
  code: ErrorCode,
  message: string,
  headers: Record<string, string | number> = {},
): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', ...headers });
  res.end(
    JSON.stringify({
      success: false,
      error: {
        statusCode,
        code,
        message,
        path: req.url,
        requestId: req.headers[HEADERS.REQUEST_ID] ?? null,
        details: null,
      },
    }),
  );
}
