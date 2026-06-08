import { describe, expect, it } from 'vitest';
import { mapCheckoutError, mapOAuthError, OnramperErrorCode } from '../src/errors/index.ts';

describe('error mapping', () => {
  it('maps checkout numeric codes', () => {
    expect(mapCheckoutError(401, { errorCode: 40102, errorMessage: 'bad session' }).code).toBe(
      OnramperErrorCode.INVALID_SDK_SESSION,
    );
    expect(mapCheckoutError(403, { errorCode: 40303 }).code).toBe(OnramperErrorCode.DEVICE_BLOCKED);
  });

  it('falls back to UPSTREAM_ERROR for unknown checkout codes', () => {
    expect(mapCheckoutError(500, { errorCode: 99999 }).code).toBe(OnramperErrorCode.UPSTREAM_ERROR);
    expect(mapCheckoutError(502, undefined).code).toBe(OnramperErrorCode.UPSTREAM_ERROR);
  });

  it('maps OAuth string codes', () => {
    expect(mapOAuthError(400, { error: 'use_dpop_nonce' }).code).toBe(OnramperErrorCode.DPOP_NONCE_REQUIRED);
    expect(mapOAuthError(400, { error: 'invalid_dpop_proof' }).code).toBe(OnramperErrorCode.DPOP_REJECTED);
    expect(mapOAuthError(400, { error: 'invalid_grant', error_description: 'expired' }).code).toBe(
      OnramperErrorCode.INVALID_GRANT,
    );
  });

  it('preserves http status', () => {
    expect(mapCheckoutError(403, { errorCode: 40302 }).httpStatus).toBe(403);
  });
});
