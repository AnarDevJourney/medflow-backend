// Machine-readable error codes returned in error.code. The frontend switches
// on these (e.g. ALLERGY_WARNING opens a confirmation modal).
export enum ErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  SLOT_TAKEN = 'SLOT_TAKEN',
  INVALID_STATUS = 'INVALID_STATUS',
  INVITE_EXPIRED = 'INVITE_EXPIRED',
  ALLERGY_WARNING = 'ALLERGY_WARNING',
  BUSINESS_RULE = 'BUSINESS_RULE',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

// Fallback code when an exception does not carry its own
export const DEFAULT_ERROR_CODES: Record<number, ErrorCode> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  422: ErrorCode.BUSINESS_RULE,
  429: ErrorCode.TOO_MANY_REQUESTS,
  500: ErrorCode.INTERNAL_ERROR,
  503: ErrorCode.SERVICE_UNAVAILABLE,
};
