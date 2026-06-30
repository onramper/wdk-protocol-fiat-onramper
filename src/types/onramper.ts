import type { Adapters } from '../adapters/types.ts';

/** Onramper deployment the SDK talks to. Picks the base URLs (see config.ts). */
export type OnramperEnvironment = 'production' | 'sandbox' | 'staging';

/**
 * Client channel reported in `X-Onramper-Channel`. The WDK adapter uses the
 * `wdk-*` family.
 * React Native (`wdk-rn`) is out of scope for now — web and Node only.
 */
export type OnramperChannel = 'wdk-web' | 'wdk-node';

/**
 * Parameters handed to the consumer's `signUrl` callback for buy/sell. These are
 * the widget query params; the consumer's backend produces a signed
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
  /**
   * Recipient (buy) or refund (sell) address. Omitted when neither a recipient
   * nor a wallet account is supplied — the widget then prompts for one.
   */
  address?: string;
  memo?: string;
  paymentMethod?: string;
  country?: string;
  /** Pins the widget to a specific quote when the caller passed one. */
  quoteId?: string;
}

/**
 * Consumer-provided callback that returns a signed widget URL.
 * Mirrors `@tetherto/wdk-protocol-fiat-moonpay`'s `signUrl`. Backed by the
 * partner's backend; the SDK never holds the signing secret.
 */
export type SignUrl = (params: SignUrlParams) => Promise<string>;

/**
 * Consumer-provided callback that mints an SDK session token via the partner's
 * backend. Returns the opaque `st_` token and its
 * session id. Called on first session-gated use (`getTransactionDetail`) and
 * again whenever the SDK must re-bootstrap (e.g. after a terminal token error).
 * The token is single-use for binding, so a fresh one is needed each bootstrap —
 * hence a callback, not a string.
 */
export type GetSessionToken = () => Promise<{ sessionId: string; sessionToken: string }>;

/**
 * Configuration for an Onramper fiat protocol instance: partner key, the
 * consumer-supplied signing/session callbacks, and optional environment and
 * platform-adapter overrides.
 */
export interface OnramperFiatConfig {
  /** Publishable partner API key (safe to ship in client code). */
  apiKey: string;
  /**
   * Mints the session token for session-gated calls (`getTransactionDetail`).
   * Optional: quotes, supported lists and buy/sell work without it.
   */
  getSessionToken?: GetSessionToken;
  /** Signs buy/sell widget URLs. Required. */
  signUrl: SignUrl;
  /** Defaults to 'production'. */
  environment?: OnramperEnvironment;
  /** Overrides the environment's base API URL. */
  baseUrl?: string;
  /** TTL in ms for cached supported lists. Defaults to 5 minutes. */
  cacheTime?: number;
  /** Channel reported to the server. Inferred from the runtime when omitted. */
  channel?: OnramperChannel;
  /** Inject platform adapters; any omitted adapter is auto-detected. */
  adapters?: Partial<Adapters>;
}
