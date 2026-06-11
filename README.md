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
  // Your backend signs the widget URL (same flow you use today).
  signUrl: async (params) => {
    const r = await fetch('/onramper/sign-url', { method: 'POST', body: JSON.stringify(params) });
    return (await r.json()).url;
  },
  // Optional — only needed for getTransactionDetail. Your backend mints a
  // session token (the single Security V2 call).
  getSessionToken: async () => {
    const r = await fetch('/onramper/session', { method: 'POST' });
    return r.json();                   // { sessionId, sessionToken }
  },
});

const quote = await fiat.quoteBuy({ fiatCurrency: 'usd', cryptoAsset: 'eth', fiatAmount: 100 });
const { buyUrl } = await fiat.buy({ fiatCurrency: 'usd', cryptoAsset: 'eth', fiatAmount: 100, recipient: '0xabc' });
```

## Design

- **`buy()` / `sell()`** are pure signed-URL builders. They call your `signUrl`
  callback and return a hosted widget deep link. No backend call, no session.
- **`quoteBuy` / `quoteSell` / `getSupported*`** hit the existing public data
  endpoints (`/quotes/{source}/{destination}`, `/supported`,
  `/supported/countries`) authenticated by the publishable apiKey alone — the
  same contract every other Onramper client uses.
- **`getTransactionDetail(sessionId)`** reads the checkout v2 session
  transaction and is the one session-gated call: it bootstraps a non-attested
  session from your backend-issued session token, mints a non-extractable ES256
  DPoP key, and carries the SDK security envelope. Checkout v2 accepts that
  envelope as an alternative to the partner's Security V2 request signature, so
  existing signature-authenticated integrations are unaffected. Requires
  `getSessionToken`; the session must carry the `checkout:read` scope.

### Platform adapters

Crypto / storage / HTTP / fingerprint are pluggable (`config.adapters`). Defaults:
WebCrypto (web + Node), in-memory token storage (secure default — inject your own
to persist), global `fetch`. React Native must inject a crypto adapter until v0.2.

> Checkout v2's session-envelope acceptance (the `getTransactionDetail` path)
> is a server-side follow-up; the public data endpoints work today. The
> headless BFF stays attested-clients-only — this package's tokens never reach
> it beyond the OAuth bootstrap proxy.
