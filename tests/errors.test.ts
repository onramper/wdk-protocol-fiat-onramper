import { describe, expect, it } from 'vitest';
import { mapCheckoutError, mapOAuthError, OnramperError, OnramperErrorCode } from '../src/errors.ts';
import { OnramperFiatProtocol } from '../src/index.ts';
import type { OnramperFiatConfig } from '../src/types/onramper.ts';
import { baseConfig } from './helpers.ts';

describe('error mapping', () => {
  it('maps checkout numeric codes', () => {
    const withMessage = mapCheckoutError(401, { errorCode: 40102, errorMessage: 'bad session' });
    expect(withMessage.code).toBe(OnramperErrorCode.INVALID_SDK_SESSION);
    expect(withMessage.message).toBe('bad session');
    expect(withMessage.httpStatus).toBe(401);

    const noMessage = mapCheckoutError(403, { errorCode: 40303 });
    expect(noMessage.code).toBe(OnramperErrorCode.DEVICE_BLOCKED);
    expect(noMessage.message).toBe('Request failed with status 403');
    expect(noMessage.httpStatus).toBe(403);
  });

  it('falls back to UPSTREAM_ERROR for unknown checkout codes', () => {
    const unknownCode = mapCheckoutError(500, { errorCode: 99999 });
    expect(unknownCode.code).toBe(OnramperErrorCode.UPSTREAM_ERROR);
    expect(unknownCode.message).toBe('Request failed with status 500');
    expect(unknownCode.httpStatus).toBe(500);

    const undefinedBody = mapCheckoutError(502, undefined);
    expect(undefinedBody.code).toBe(OnramperErrorCode.UPSTREAM_ERROR);
    expect(undefinedBody.message).toBe('Request failed with status 502');
    expect(undefinedBody.httpStatus).toBe(502);
  });

  it('maps OAuth string codes', () => {
    const nonce = mapOAuthError(400, { error: 'use_dpop_nonce' });
    expect(nonce.code).toBe(OnramperErrorCode.DPOP_NONCE_REQUIRED);
    expect(nonce.message).toBe('use_dpop_nonce');
    expect(nonce.httpStatus).toBe(400);

    const badProof = mapOAuthError(400, { error: 'invalid_dpop_proof' });
    expect(badProof.code).toBe(OnramperErrorCode.DPOP_REJECTED);
    expect(badProof.message).toBe('invalid_dpop_proof');
    expect(badProof.httpStatus).toBe(400);

    const grant = mapOAuthError(400, { error: 'invalid_grant', error_description: 'expired' });
    expect(grant.code).toBe(OnramperErrorCode.INVALID_GRANT);
    expect(grant.message).toBe('expired');
    expect(grant.httpStatus).toBe(400);
  });

  it('preserves http status', () => {
    expect(mapCheckoutError(403, { errorCode: 40302 }).httpStatus).toBe(403);
  });

  describe('config validation rejects malformed config at construction', () => {
    const expectInvalidConfig = (over: Partial<OnramperFiatConfig>, messageMatch?: RegExp) => {
      const construct = () => new OnramperFiatProtocol(undefined, baseConfig(over));
      let err: unknown;
      try {
        construct();
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(OnramperError);
      expect((err as OnramperError).code).toBe(OnramperErrorCode.INVALID_CONFIG);
      if (messageMatch) {
        expect((err as OnramperError).message).toMatch(messageMatch);
      }
    };

    it('rejects an empty apiKey', () => {
      expectInvalidConfig({ apiKey: '' }, /apiKey is required/);
    });
    it('rejects a missing signUrl', () => {
      expectInvalidConfig({ signUrl: undefined }, /signUrl/);
    });
    it('rejects a negative cacheTime', () => {
      expectInvalidConfig({ cacheTime: -1 }, /cacheTime/);
    });
    it('rejects an array adapters value', () => {
      expectInvalidConfig({ adapters: [] as unknown as OnramperFiatConfig['adapters'] }, /adapters/);
    });
  });
});
