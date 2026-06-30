import { CHECKOUT_ERROR_CODES, OAUTH_ERROR_CODES, OnramperErrorCode } from './codes.ts';

/** Single error type surfaced to consumers, carrying the normalised code. */
export class OnramperError extends Error {
  readonly code: OnramperErrorCode;
  /** Upstream HTTP status when the error came from a response; absent for transport/decode failures (NETWORK_ERROR, DECODE_ERROR). */
  readonly httpStatus?: number;

  constructor(code: OnramperErrorCode, message: string, options?: { httpStatus?: number; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'OnramperError';
    this.code = code;
    this.httpStatus = options?.httpStatus;
  }
}

interface CheckoutErrorBody {
  errorCode?: number;
  errorMessage?: string;
}

interface OAuthErrorBody {
  error?: string;
  error_description?: string;
}

/** Map an API `{ errorCode, errorMessage }` body to an OnramperError. */
export function mapCheckoutError(httpStatus: number, body: unknown): OnramperError {
  const parsed = (body ?? {}) as CheckoutErrorBody;
  const code =
    (parsed.errorCode !== undefined ? CHECKOUT_ERROR_CODES[parsed.errorCode] : undefined) ??
    OnramperErrorCode.UPSTREAM_ERROR;
  return new OnramperError(code, parsed.errorMessage ?? `Request failed with status ${httpStatus}`, { httpStatus });
}

/** Map a token endpoint RFC 6749 `{ error, error_description }` body to an OnramperError. */
export function mapOAuthError(httpStatus: number, body: unknown): OnramperError {
  const parsed = (body ?? {}) as OAuthErrorBody;
  const code = (parsed.error ? OAUTH_ERROR_CODES[parsed.error] : undefined) ?? OnramperErrorCode.UPSTREAM_ERROR;
  return new OnramperError(code, parsed.error_description ?? parsed.error ?? `Token request failed (${httpStatus})`, {
    httpStatus,
  });
}
