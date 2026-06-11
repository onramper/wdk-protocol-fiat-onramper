import { z } from 'zod';
import { OnramperError, OnramperErrorCode } from '../errors/index.ts';
import type { OnramperFiatConfig } from '../types/onramper.ts';

/**
 * Validates the consumer-supplied config at construction so misconfiguration
 * fails loudly and early rather than on the first network call. Callbacks and
 * adapters are validated as "is a function/object", not by shape.
 */
const configSchema = z.object({
  apiKey: z.string().min(1, 'apiKey is required'),
  getSessionToken: z.function().optional(),
  signUrl: z.function(),
  environment: z.enum(['production', 'sandbox', 'staging']).optional(),
  baseUrl: z.string().url().optional(),
  widgetBaseUrl: z.string().url().optional(),
  cacheTime: z.number().int().nonnegative().optional(),
  channel: z.enum(['wdk-web', 'wdk-rn', 'wdk-node']).optional(),
  adapters: z.object({}).passthrough().optional(),
});

export function validateConfig(config: OnramperFiatConfig): OnramperFiatConfig {
  const result = configSchema.safeParse(config);
  if (!result.success) {
    const issue = result.error.issues[0];
    const detail = issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid configuration';
    throw new OnramperError(OnramperErrorCode.INVALID_CONFIG, `Invalid OnramperFiatConfig — ${detail}`);
  }
  return config;
}
