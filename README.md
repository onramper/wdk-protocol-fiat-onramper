# @onramper/wdk-protocol-fiat-onramper

Onramper's implementation of Tether's WDK fiat protocol. `OnramperFiatProtocol`
extends [`FiatProtocol`](https://github.com/tetherto/wdk-wallet/blob/main/src/protocols/fiat-protocol.js)
from [`@tetherto/wdk-wallet`](https://github.com/tetherto/wdk-wallet), so a WDK
wallet wires Onramper in behind the same interface it uses for
[`@tetherto/wdk-protocol-fiat-moonpay`](https://github.com/tetherto/wdk-protocol-fiat-moonpay)
and every other provider — no per-provider application logic. Runs on web, Node,
and Bare.

> Status: v0.2 (web · Node · Bare). React Native is out of scope for now.

## Install

```sh
npm i @onramper/wdk-protocol-fiat-onramper
```

## Usage

```ts
import { OnramperFiatProtocol } from '@onramper/wdk-protocol-fiat-onramper';

const fiat = new OnramperFiatProtocol(account, {  // `account` (a WDK wallet account) is optional
  apiKey: 'pk_prod_…',                 // publishable partner key
  environment: 'production',
  // Your backend signs the widget URL (same flow you use today).
  signUrl: async (params) => {
    const r = await fetch('/onramper/sign-url', { method: 'POST', body: JSON.stringify(params) });
    return (await r.json()).url;
  },
  // Optional — only needed for getTransactionDetail. Returns a session your backend created.
  getSessionToken: async () => {
    const r = await fetch('/onramper/session', { method: 'POST' });
    return r.json();                   // { sessionId, sessionToken }
  },
});

// Amounts are integers in the asset's smallest unit (cents for fiat, wei for ETH),
// exactly like the rest of WDK. quoteBuy spends an exact fiat amount; quoteSell
// sells an exact crypto amount.
const quote = await fiat.quoteBuy({ fiatCurrency: 'usd', cryptoAsset: 'eth', fiatAmount: 100_00n }); // $100.00
quote.cryptoAmount; // bigint — wei
quote.fee;          // bigint — fiat minor units
quote.rate;         // string
quote.metadata;     // Onramper extras: provider, quoteId, fee breakdown, …

const { buyUrl } = await fiat.buy({ fiatCurrency: 'usd', cryptoAsset: 'eth', fiatAmount: 100_00n, recipient: '0xabc' });
```

## WDK contract

Shapes follow `@tetherto/wdk-wallet/protocols` exactly:

- **`FiatQuote`** — `{ cryptoAmount, fiatAmount, fee: bigint; rate: string }`,
  amounts in base units. Onramper's provider / fee breakdown / quoteId ride along
  under `quote.metadata`.
- **`getTransactionDetail().status`** — one of `in_progress | failed | completed`.
  The hash, provider and amounts are under `.metadata`.
- Provider-specific request knobs (paymentMethod, networkCode, country, memo,
  quoteId) go under an optional `config` field, so the base options stay
  WDK-shaped.

## Design

- **`buy()` / `sell()`** return a hosted widget deep link via your `signUrl`
  callback. They read the cached supported list once to render the base-unit
  amount in the widget's decimal form, then sign — no session. The recipient /
  refund address defaults to the wallet account's when omitted.
- **`quoteBuy` / `quoteSell` / `getSupported*`** hit the public data endpoints
  authenticated by the publishable apiKey alone. `quoteBuy` prices an exact fiat
  spend and `quoteSell` an exact crypto amount; the reverse directions (an exact
  crypto target / fiat target) aren't priced by the Onramper quotes API and
  reject with `UNSUPPORTED_OPERATION`.
- **`getTransactionDetail(sessionId)`** is the one session-gated call: provide
  `getSessionToken` and the SDK handles the session exchange and token lifecycle.

### Callbacks

- **`signUrl(params)`** — your backend signs the widget params and returns the
  URL. The SDK never holds your signing secret.
- **`getSessionToken()`** — your backend returns `{ sessionId, sessionToken }`
  for a session it created. Called on first session-gated use and whenever the
  SDK refreshes, so return a fresh value each call.

### Platform adapters

Crypto / storage / HTTP / fingerprint are pluggable (`config.adapters`). Defaults:
WebCrypto (web · Node · Bare), in-memory token storage (secure default — inject
your own to persist), global `fetch`.
