/**
 * URL builders for the authenticated data calls. These hit the SDK auth path
 * (headless) which validates the session token + DPoP envelope. buy/sell do NOT
 * appear here — they are signed widget URLs, not API calls.
 *
 * The data paths are a cross-repo contract: they must match the headless
 * `sdkDataRoutes` registrations AND the `CLIENT_ROUTE_SCOPE_MAP` keys in
 * core-utils (`GET /headless/v1/sdk/...`), where each route's required scope
 * (`supported:read`, `quotes:read`, `transactions:read`) is defined.
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
    return `${this.apiBaseUrl}/headless/v1/sdk/supported`;
  }

  quote(source: string, destination: string): string {
    return `${this.apiBaseUrl}/headless/v1/sdk/quotes/${encodeURIComponent(source)}/${encodeURIComponent(destination)}`;
  }

  transaction(txId: string): string {
    return `${this.apiBaseUrl}/headless/v1/sdk/transactions/${encodeURIComponent(txId)}`;
  }
}
