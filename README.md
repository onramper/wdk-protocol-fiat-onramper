# @onramper/wdk-protocol-fiat

Onramper implementation of Tether's WDK [`IFiatProtocol`](https://github.com/tetherto/wdk-wallet/blob/main/src/protocols/fiat-protocol.js) for web and Node. Mirrors [`@tetherto/wdk-protocol-fiat-moonpay`](https://github.com/tetherto/wdk-protocol-fiat-moonpay).

> Status: v0.1 (web + Node). React Native is out of scope for now.

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
  // Optional — only needed for getTransactionDetail. Returns a session your
  // backend created.
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
- **`quoteBuy` / `quoteSell` / `getSupported*`** hit the public data endpoints
  (`/quotes/{source}/{destination}`, `/supported`, `/supported/countries`)
  authenticated by the publishable apiKey alone — the same contract every other
  Onramper client uses.
- **`getTransactionDetail(sessionId)`** reads a checkout session's transaction
  detail. It is the one session-gated call: provide `getSessionToken` and the SDK
  handles the session exchange and token lifecycle for you. The other methods
  don't need it.

### Callbacks

- **`signUrl(params)`** — your backend signs the widget params and returns the
  URL. The SDK never holds your signing secret.
- **`getSessionToken()`** — your backend returns `{ sessionId, sessionToken }`
  for a session it created. Called on first session-gated use and whenever the
  SDK needs to refresh, so return a fresh value each call.

### Platform adapters

Crypto / storage / HTTP / fingerprint are pluggable (`config.adapters`). Defaults:
WebCrypto (web + Node), in-memory token storage (secure default — inject your own
to persist), global `fetch`.
