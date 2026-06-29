import type { OnramperEnvironment } from '../types/onramper.ts';

/** Default TTL for cached supported lists (5 minutes). */
export const DEFAULT_CACHE_TIME_MS = 5 * 60 * 1000;

interface EnvUrls {
  /** Base for authenticated data calls (quotes, supported, transactions). */
  apiBaseUrl: string;
}

/**
 * Per-environment base URLs. Sandbox and staging point at the staging stack;
 * they are split so a consumer can opt into "sandbox semantics" explicitly.
 * Override via `OnramperFiatConfig.baseUrl`.
 */
export const ENVIRONMENT_URLS: Readonly<Record<OnramperEnvironment, EnvUrls>> = {
  production: {
    apiBaseUrl: 'https://api.onramper.com',
  },
  sandbox: {
    apiBaseUrl: 'https://api-stg.onramper.com',
  },
  staging: {
    apiBaseUrl: 'https://api-stg.onramper.com',
  },
};
