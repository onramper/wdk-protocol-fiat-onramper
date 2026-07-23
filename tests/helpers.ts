import { createWebCryptoAdapter } from '../src/adapters/crypto/webcrypto.ts';
import { createPersistedFingerprintAdapter } from '../src/adapters/fingerprint/persisted.ts';
import { createMemoryStorageAdapter } from '../src/adapters/storage/memory.ts';
import type { Adapters, HttpRequest, HttpResponse } from '../src/adapters/types.ts';
import type { OnramperFiatConfig } from '../src/types/onramper.ts';

export type RouteHandler = (req: HttpRequest) => HttpResponse;

/** A mock HTTP adapter that routes by substring match, for hermetic tests. */
export function mockHttp(routes: Array<{ match: string; handler: RouteHandler }>): {
  adapters: () => Adapters;
  calls: HttpRequest[];
} {
  const calls: HttpRequest[] = [];
  const storage = createMemoryStorageAdapter();
  const crypto = createWebCryptoAdapter();
  const http = {
    async request(req: HttpRequest): Promise<HttpResponse> {
      calls.push(req);
      const route = routes.find((r) => req.url.includes(r.match));
      if (!route) {
        return { status: 404, headers: {}, body: '{}' };
      }
      return route.handler(req);
    },
  };
  return {
    calls,
    adapters: () => ({ crypto, storage, http, fingerprint: createPersistedFingerprintAdapter(storage) }),
  };
}

export function json(status: number, body: unknown): HttpResponse {
  return { status, headers: {}, body: JSON.stringify(body) };
}

/** A token endpoint handler that always mints a valid Tier-1 access token. */
export const tokenRoute = {
  match: 'client-sessions/tokens',
  handler: () =>
    json(200, {
      access_token: 'at_test_token',
      refresh_token: 'rt_test_token',
      expires_in: 900,
      device_id: 'dev_test',
      tier: 1,
    }),
};

/** Standard supported payload carrying the decimals the amount conversion needs (eth 18, btc 8, usd/eur 2). */
export const SUPPORTED_PAYLOAD = {
  crypto: [
    { code: 'eth', networkCode: 'ethereum', decimals: 18, name: 'Ethereum' },
    { code: 'btc', networkCode: 'bitcoin', decimals: 8, name: 'Bitcoin' },
  ],
  fiat: [
    { code: 'usd', decimals: 2, name: 'US Dollar' },
    { code: 'eur', decimals: 2, name: 'Euro' },
  ],
};

/** Mocks `GET /supported` so quote/buy/sell can resolve an asset's decimals. */
export const supportedRoute = {
  match: '/supported',
  handler: () => json(200, { message: SUPPORTED_PAYLOAD }),
};

export function baseConfig(overrides: Partial<OnramperFiatConfig> = {}): OnramperFiatConfig {
  return {
    apiKey: 'pk_test_abc123',
    environment: 'sandbox',
    getSessionToken: async () => ({ sessionId: 'sess_test', sessionToken: 'st_test' }),
    signUrl: async (params) =>
      `https://buy.stg.onramper.com/?apiKey=${params.apiKey}&mode=${params.direction}&asset=${params.cryptoAsset}&address=${params.address}`,
    ...overrides,
  };
}
