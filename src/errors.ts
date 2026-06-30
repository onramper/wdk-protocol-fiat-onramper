/**
 * Error taxonomy for the SDK. Two wire formats feed into one normalised enum:
 *
 *   1. The API returns `{ errorCode: <int>, errorMessage }`.
 *   2. Token (OAuth) endpoints return RFC 6749 `{ error, error_description? }`.
 *
 * The numeric and string maps below MUST stay in sync with the API's error
 * responses. Mirror, do not invent.
 */
export enum OnramperErrorCode {
  INVALID_CONFIG = 'invalid_config',
  /** Client-side: a method was called with conflicting or missing arguments. */
  INVALID_ARGUMENT = 'invalid_argument',
  UNAUTHORIZED = 'unauthorized',
  INVALID_SDK_SESSION = 'invalid_sdk_session',
  INVALID_USER_TOKEN = 'invalid_user_token',
  FORBIDDEN = 'forbidden',
  INSUFFICIENT_SCOPE = 'insufficient_scope',
  DEVICE_BLOCKED = 'device_blocked',
  INVALID_ATTESTATION = 'invalid_attestation',
  DPOP_REJECTED = 'dpop_rejected',
  DPOP_NONCE_REQUIRED = 'dpop_nonce_required',
  INVALID_GRANT = 'invalid_grant',
  QUOTE_UNAVAILABLE = 'quote_unavailable',
  UNSUPPORTED_ASSET = 'unsupported_asset',
  /** A WDK-valid call this provider's API can't serve (e.g. an exact-crypto buy quote). */
  UNSUPPORTED_OPERATION = 'unsupported_operation',
  UPSTREAM_ERROR = 'upstream_error',
  NETWORK_ERROR = 'network_error',
  DECODE_ERROR = 'decode_error',
}

/** Numeric codes from the API → normalised code. */
export const CHECKOUT_ERROR_CODES: Readonly<Record<number, OnramperErrorCode>> = {
  40101: OnramperErrorCode.UNAUTHORIZED,
  40102: OnramperErrorCode.INVALID_SDK_SESSION,
  40103: OnramperErrorCode.INVALID_USER_TOKEN,
  40301: OnramperErrorCode.FORBIDDEN,
  40302: OnramperErrorCode.INSUFFICIENT_SCOPE,
  40303: OnramperErrorCode.DEVICE_BLOCKED,
  40304: OnramperErrorCode.INVALID_ATTESTATION,
};

/**
 * RFC 6749 / DPoP string codes from token endpoints → normalised code.
 *
 * @see https://www.rfc-editor.org/rfc/rfc6749#section-5.2
 * @see https://www.rfc-editor.org/rfc/rfc9449 (DPoP: invalid_dpop_proof, use_dpop_nonce)
 */
export const OAUTH_ERROR_CODES: Readonly<Record<string, OnramperErrorCode>> = {
  invalid_grant: OnramperErrorCode.INVALID_GRANT,
  invalid_dpop_proof: OnramperErrorCode.DPOP_REJECTED,
  use_dpop_nonce: OnramperErrorCode.DPOP_NONCE_REQUIRED,
  invalid_attestation: OnramperErrorCode.INVALID_ATTESTATION,
  device_blocked: OnramperErrorCode.DEVICE_BLOCKED,
  insufficient_scope: OnramperErrorCode.INSUFFICIENT_SCOPE,
  invalid_token: OnramperErrorCode.INVALID_SDK_SESSION,
};

/**
 * Codes that mean "the current session is dead — re-bootstrap from a fresh
 * session token". The session manager checks this to decide between a silent
 * refresh and a full re-bootstrap.
 */
export const REBOOTSTRAP_CODES: ReadonlySet<OnramperErrorCode> = new Set([
  OnramperErrorCode.INSUFFICIENT_SCOPE,
  OnramperErrorCode.INVALID_ATTESTATION,
  OnramperErrorCode.INVALID_GRANT,
]);

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
