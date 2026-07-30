/**
 * URL builders for the API calls. buy/sell do NOT appear here — they are
 * signed widget URLs, not API calls.
 *
 * Two auth families:
 *   - supported/quotes are the existing public endpoints, authenticated by the
 *     publishable apiKey alone (`Authorization` header).
 *   - the checkout session-transaction lookup and the token exchange carry the
 *     SDK session envelope (access token + DPoP). The checkout session API accepts
 *     that envelope as an alternative to the partner's request signature, so
 *     existing signature-authenticated integrations are unaffected.
 */
export class Endpoints {
  /** @param apiBaseUrl - The environment's base API URL; a trailing slash is stripped. */
  constructor(private readonly apiBaseUrl: string) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, '');
  }

  /**
   * Builds the token-exchange URL. The client signs its DPoP `htu` against this
   * exact URL, so the server must reconstruct the same origin + path to verify
   * proof-of-possession.
   *
   * @param apiKey - The publishable partner API key, path-encoded.
   * @returns The token-exchange endpoint URL.
   */
  tokens(apiKey: string): string {
    return `${this.apiBaseUrl}/partners/v2/${encodeURIComponent(apiKey)}/client-sessions/tokens`;
  }

  /**
   * Public `GET /supported` route (`{crypto, fiat}` lists); apiKey-authenticated.
   *
   * @returns The supported-assets endpoint URL.
   */
  supported(): string {
    return `${this.apiBaseUrl}/supported`;
  }

  /**
   * Public `GET /supported/countries` route; apiKey-authenticated.
   *
   * @returns The supported-countries endpoint URL.
   */
  supportedCountries(): string {
    return `${this.apiBaseUrl}/supported/countries`;
  }

  /**
   * Public `GET /quotes/{source}/{destination}` route. `source`/`destination`
   * are currency/asset codes; their order is direction-dependent and set by the
   * protocol layer (fiat→crypto for buy, crypto→fiat for sell).
   *
   * @param source - The code the caller is spending/selling, path-encoded.
   * @param destination - The code the caller is receiving, path-encoded.
   * @returns The quote endpoint URL (without query parameters).
   */
  quote(source: string, destination: string): string {
    return `${this.apiBaseUrl}/quotes/${encodeURIComponent(source)}/${encodeURIComponent(destination)}`;
  }

  /**
   * Checkout session transaction lookup; carries the SDK session envelope.
   *
   * @param sessionId - The session id returned by the intent call, path-encoded.
   * @returns The session-transaction endpoint URL.
   */
  checkoutTransaction(sessionId: string): string {
    return `${this.apiBaseUrl}/checkout/session/${encodeURIComponent(sessionId)}/transaction`;
  }
}
