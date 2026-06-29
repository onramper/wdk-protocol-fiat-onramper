/**
 * URL builders for the API calls. buy/sell do NOT appear here — they are
 * signed widget URLs, not API calls.
 *
 * Two auth families:
 *   - supported/quotes are the existing public endpoints, authenticated by the
 *     publishable apiKey alone (`Authorization` header).
 *   - the checkout session-transaction lookup and the token exchange carry the
 *     SDK session envelope (access token + DPoP). Checkout v2 accepts that
 *     envelope as an alternative to the partner's request signing signature, so
 *     existing signature-authenticated integrations are unaffected.
 */
export class Endpoints {
  constructor(private readonly apiBaseUrl: string) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, '');
  }

  /**
   * Routes directly to the the API public session route. The client signs
   * its DPoP `htu` against this exact URL, so the API must reconstruct the
   * same origin + path to verify proof-of-possession.
   */
  tokens(apiKey: string): string {
    return `${this.apiBaseUrl}/partners/v2/${encodeURIComponent(apiKey)}/client-sessions/tokens`;
  }

  /** Public `GET /supported` route ({crypto, fiat} lists); apiKey-authenticated. */
  supported(): string {
    return `${this.apiBaseUrl}/supported`;
  }

  /** Public `GET /supported/countries` route; apiKey-authenticated. */
  supportedCountries(): string {
    return `${this.apiBaseUrl}/supported/countries`;
  }

  /**
   * Public `GET /quotes/{source}/{destination}` route. `source`/`destination`
   * are currency/asset codes; their order is direction-dependent and set by the
   * protocol layer (fiat→crypto for buy, crypto→fiat for sell).
   */
  quote(source: string, destination: string): string {
    return `${this.apiBaseUrl}/quotes/${encodeURIComponent(source)}/${encodeURIComponent(destination)}`;
  }

  /** Checkout v2 session transaction lookup; carries the SDK session envelope. */
  checkoutTransaction(sessionId: string): string {
    return `${this.apiBaseUrl}/checkout/session/${encodeURIComponent(sessionId)}/transaction`;
  }
}
