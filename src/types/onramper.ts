import type { Adapters } from '../adapters/types.ts';

/** Onramper deployment the SDK talks to. Picks the base URLs (see config/defaults). */
export type OnramperEnvironment = 'production' | 'sandbox' | 'staging';

/**
 * Client channel reported in `X-Onramper-Channel`. The WDK adapter uses the
 * `wdk-*` family (not `sdk-*`) so the server can tell WDK traffic apart from
 * our first-party SDKs. Must match a server-side VALID_CHANNELS entry.
 */
export type OnramperChannel = 'wdk-web' | 'wdk-rn' | 'wdk-node';

/**
 * Parameters handed to the consumer's `signUrl` callback for buy/sell. These are
 * the widget query params; the consumer's backend produces a Security V2 signed
 * widget URL from them (the signing key never reaches the client).
 */
export interface SignUrlParams {
  direction: 'buy' | 'sell';
  apiKey: string;
  fiatCurrency: string;
  cryptoAsset: string;
  networkCode?: string;
  fiatAmount?: string;
  cryptoAmount?: string;
  /** Recipient (buy) or refund (sell) address. */
  address: string;
  memo?: string;
  paymentMethod?: string;
  country?: string;
}

/**
 * Consumer-provided callback that returns a Security V2 signed widget URL.
 * Mirrors `@tetherto/wdk-protocol-fiat-moonpay`'s `signUrl`. Backed by the
 * partner's backend; the SDK never holds the signing secret.
 */
export type SignUrl = (params: SignUrlParams) => Promise<string>;

/**
 * Consumer-provided callback that mints an SDK session token via the partner's
 * backend (the single Security V2 call). Returns the opaque `st_` token and its
 * session id. Called on first authenticated use and again whenever the SDK must
 * re-bootstrap (e.g. after a terminal token error). The token is single-use for
 * binding, so a fresh one is needed each bootstrap — hence a callback, not a string.
 */
export type GetSessionToken = () => Promise<{ sessionId: string; sessionToken: string }>;

export interface OnramperFiatConfig {
  /** Publishable partner API key (safe to ship in client code). */
  apiKey: string;
  /** Mints the session token for authenticated data calls. Required. */
  getSessionToken: GetSessionToken;
  /** Signs buy/sell widget URLs. Required. */
  signUrl: SignUrl;
  /** Defaults to 'production'. */
  environment?: OnramperEnvironment;
  /** Overrides the environment's base API URL. */
  baseUrl?: string;
  /** Overrides the environment's hosted widget base URL used by buy/sell. */
  widgetBaseUrl?: string;
  /** TTL in ms for cached supported lists. Defaults to 5 minutes. */
  cacheTime?: number;
  /** Channel reported to the server. Inferred from the runtime when omitted. */
  channel?: OnramperChannel;
  /** Inject platform adapters; any omitted adapter is auto-detected. */
  adapters?: Partial<Adapters>;
}

/** Optional WDK wallet account. We read a default address from it when buy/sell omit one. */
export interface WdkAccount {
  getAddress?: () => string | Promise<string>;
  address?: string;
}
