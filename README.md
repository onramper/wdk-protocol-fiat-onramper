# @onramper/wdk-protocol-fiat

Onramper implementation of Tether's WDK [`IFiatProtocol`](https://github.com/tetherto/wdk-wallet/blob/main/src/protocols/fiat-protocol.js). Cross-platform: web, Node, and React Native from a single package. Mirrors [`@tetherto/wdk-protocol-fiat-moonpay`](https://github.com/tetherto/wdk-protocol-fiat-moonpay).

> Status: v0.1 (web + Node). React Native crypto adapter lands in v0.2.

## Install

```sh
npm i @onramper/wdk-protocol-fiat
```

## Usage

```ts
import { OnramperFiatProtocol } from '@onramper/wdk-protocol-fiat';

const fiat = new OnramperFiatProtocol(undefined, {
  apiKey: 'pk_prod_…',                 // publishable partner key
  environment: 'production',
  // Your backend mints a session token (the single Security V2 call).
  getSessionToken: async () => {
    const r = await fetch('/onramper/session', { method: 'POST' });
    return r.json();                   // { sessionId, sessionToken }
  },
  // Your backend signs the widget URL (same flow you use today).
  signUrl: async (params) => {
    const r = await fetch('/onramper/sign-url', { method: 'POST', body: JSON.stringify(params) });
    return (await r.json()).url;
  },
});

const quote = await fiat.quoteBuy({ fiatCurrency: 'usd', cryptoAsset: 'eth', fiatAmount: 100 });
const { buyUrl } = await fiat.buy({ fiatCurrency: 'usd', cryptoAsset: 'eth', fiatAmount: 100, recipient: '0xabc' });
```

## Design

- **`buy()` / `sell()`** are pure signed-URL builders. They call your `signUrl`
  callback and return a hosted widget deep link. No backend call, no session.
- **`quoteBuy` / `quoteSell` / `getSupported*` / `getTransactionDetail`** are
  authenticated data calls. They bootstrap a non-attested (Tier-1) session from
  your backend-issued session token, mint a non-extractable ES256 DPoP key, and
  carry the SDK security envelope on every request. This gates the API for abuse
  protection without requiring Apple App Attest (which web/Node can't do) and
  without weakening the iOS attestation path.

### Session scopes

The data methods require the partner backend to mint the session token with the
matching read scopes — `supported:read`, `quotes:read`, `transactions:read`
(defined in core-utils `CLIENT_ROUTE_SCOPE_MAP`). A session missing a scope gets
`insufficient_scope` on that method.

### Platform adapters

Crypto / storage / HTTP / fingerprint are pluggable (`config.adapters`). Defaults:
WebCrypto (web + Node), in-memory token storage (secure default — inject your own
to persist), global `fetch`. React Native must inject a crypto adapter until v0.2.

> The data routes (`GET /headless/v1/sdk/...`) are the agreed cross-repo contract
> (core-utils scope map) but are not yet served by headless — they land in the
> ONR-533 headless follow-up. Base URLs in `src/config/defaults.ts` still need
> verification against the live environments.
