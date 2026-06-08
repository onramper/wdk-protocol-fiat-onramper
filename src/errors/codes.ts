/**
 * Error taxonomy for the SDK. Two wire formats feed into one normalised enum:
 *
 *   1. Checkout/headless endpoints return `{ errorCode: <int>, errorMessage }`.
 *   2. Token (OAuth) endpoints return RFC 6749 `{ error, error_description? }`.
 *
 * The numeric and string maps below MUST stay in sync with
 * `headless-service/src/errors/index.ts` and the partners-api OAuth errors —
 * that mapping is a cross-repo contract. Mirror, do not invent.
 */
export enum OnramperErrorCode {
  INVALID_CONFIG = 'invalid_config',
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
  UPSTREAM_ERROR = 'upstream_error',
  NETWORK_ERROR = 'network_error',
  DECODE_ERROR = 'decode_error',
}

/** Numeric codes from checkout/headless endpoints → normalised code. */
export const CHECKOUT_ERROR_CODES: Readonly<Record<number, OnramperErrorCode>> = {
  40101: OnramperErrorCode.UNAUTHORIZED,
  40102: OnramperErrorCode.INVALID_SDK_SESSION,
  40103: OnramperErrorCode.INVALID_USER_TOKEN,
  40301: OnramperErrorCode.FORBIDDEN,
  40302: OnramperErrorCode.INSUFFICIENT_SCOPE,
  40303: OnramperErrorCode.DEVICE_BLOCKED,
  40304: OnramperErrorCode.INVALID_ATTESTATION,
};

/** RFC 6749 / DPoP string codes from token endpoints → normalised code. */
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
