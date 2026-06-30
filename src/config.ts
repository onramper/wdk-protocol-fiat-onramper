import { OnramperError, OnramperErrorCode } from './errors.ts';
import type { OnramperEnvironment, OnramperFiatConfig } from './types/onramper.ts';

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

const ENVIRONMENTS: ReadonlySet<OnramperEnvironment> = new Set(['production', 'sandbox', 'staging']);
const CHANNELS: ReadonlySet<string> = new Set(['wdk-web', 'wdk-node']);

function fail(detail: string): never {
  throw new OnramperError(OnramperErrorCode.INVALID_CONFIG, `Invalid OnramperFiatConfig — ${detail}`);
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a consumer-supplied {@link OnramperFiatConfig} at construction so
 * misconfiguration fails early rather than on the first network call. Returns
 * the input unchanged on success (callback/adapter references are preserved).
 * Callbacks and adapters are validated as "is a function/object", not by shape.
 *
 * @throws {OnramperError} With code `OnramperErrorCode.INVALID_CONFIG` when a
 *   field is missing or malformed; the message names the offending field.
 */
export function validateConfig(config: unknown): OnramperFiatConfig {
  if (typeof config !== 'object' || config === null) {
    fail('config: expected an object');
  }
  const c = config as Partial<OnramperFiatConfig>;

  if (typeof c.apiKey !== 'string' || c.apiKey.length === 0) {
    fail('apiKey: apiKey is required');
  }
  if (c.getSessionToken !== undefined && typeof c.getSessionToken !== 'function') {
    fail('getSessionToken: expected a function');
  }
  if (typeof c.signUrl !== 'function') {
    fail('signUrl: signUrl is required');
  }
  if (c.environment !== undefined && !ENVIRONMENTS.has(c.environment)) {
    fail(`environment: must be one of 'production', 'sandbox', 'staging'`);
  }
  if (c.baseUrl !== undefined && (typeof c.baseUrl !== 'string' || !isValidUrl(c.baseUrl))) {
    fail('baseUrl: expected a valid URL');
  }
  if (c.cacheTime !== undefined && (!Number.isInteger(c.cacheTime) || c.cacheTime < 0)) {
    fail('cacheTime: expected a non-negative integer');
  }
  if (c.channel !== undefined && !CHANNELS.has(c.channel)) {
    fail(`channel: must be one of 'wdk-web', 'wdk-node'`);
  }
  if (
    c.adapters !== undefined &&
    (typeof c.adapters !== 'object' || c.adapters === null || Array.isArray(c.adapters))
  ) {
    fail('adapters: expected an object');
  }

  return config as OnramperFiatConfig;
}
