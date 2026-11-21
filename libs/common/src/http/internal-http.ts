import { HttpStatus, Logger } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';
import { HEADERS } from '../constants/headers';
import { requestContext } from '../context/request-context';
import { AppException } from '../exceptions/app.exception';

const TIMEOUT_MS = 3000;

// GET <baseUrl><path> on another service's internal API (x-internal-key).
// 404 → null; unreachable, timeout or any other non-2xx → 503 naming the
// service, so the user sees "try again" instead of a 500.
export async function internalGet<T>(
  logger: Logger,
  service: { name: string; label: string; baseUrl: string; key: string },
  path: string,
): Promise<T | null> {
  const requestId = requestContext.get().requestId;
  const unavailable = () =>
    new AppException(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.SERVICE_UNAVAILABLE,
      `${service.label} is unavailable, please try again`,
      { service: service.name },
    );

  let res: Response;
  try {
    res = await fetch(`${service.baseUrl}${path}`, {
      headers: {
        [HEADERS.INTERNAL_KEY]: service.key,
        ...(requestId ? { [HEADERS.REQUEST_ID]: requestId } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn(`${service.name} unreachable: ${(error as Error).message}`);
    throw unavailable();
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    logger.warn(`${service.name} answered ${res.status} for ${path}`);
    throw unavailable();
  }
  const body = (await res.json()) as { data: T };
  return body.data;
}
