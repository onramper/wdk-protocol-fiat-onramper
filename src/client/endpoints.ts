/**
 * URL builders for the authenticated data calls. These hit the SDK auth path
 * (headless) which validates the session token + DPoP envelope. buy/sell do NOT
 * appear here — they are signed widget URLs, not API calls.
 *
 * Paths are kept in one place so they stay aligned with the headless routes; the
 * `/headless/v1` prefix mirrors `onramper-sdk`'s `HTTPBFFClient`.
 */
export class Endpoints {
  constructor(private readonly apiBaseUrl: string) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, '');
  }

  /** Token exchange / refresh (RFC 6749-style OAuth wire format). */
  tokens(apiKey: string): string {
    return `${this.apiBaseUrl}/headless/v1/sdk/partners/${encodeURIComponent(apiKey)}/client-sessions/tokens`;
  }

  supported(): string {
    return `${this.apiBaseUrl}/headless/v1/supported`;
  }

  quote(source: string, destination: string): string {
    return `${this.apiBaseUrl}/headless/v1/quotes/${encodeURIComponent(source)}/${encodeURIComponent(destination)}`;
  }

  transaction(txId: string): string {
    return `${this.apiBaseUrl}/headless/v1/transactions/${encodeURIComponent(txId)}`;
  }
}
