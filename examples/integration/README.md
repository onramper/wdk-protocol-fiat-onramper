# Integration example

A runnable harness that exercises every `@onramper/wdk-protocol-fiat` method
against a real Onramper environment, in many quote/buy/sell/checkout
combinations. Use it to smoke-test an integration end to end.

```sh
# from the repo root
npm run build
ONRAMPER_API_KEY=pk_test_… node examples/integration/run.mjs
```

> In your own project you'd `import { OnramperFiatProtocol } from '@onramper/wdk-protocol-fiat'`.
> This in-repo example imports the freshly built `dist/` so it always runs the
> local source.

## What it runs

| Group | Methods | Needs |
|---|---|---|
| **Supported** | `getSupportedCryptoAssets` / `…FiatCurrencies` / `…Countries` | apiKey only |
| **Quotes** | `quoteBuy` / `quoteSell` across several fiat→crypto pairs and amounts | apiKey only |
| **Widget URLs** | `buy` / `sell` across several pairs (pure signed-URL builders) | a `signUrl` callback |
| **Checkout / session** | `getTransactionDetail` (bootstrap → DPoP-bound envelope → checkout v2) | a session (see below) |

Each scenario prints one of:

- `PASS` — returned the expected shape.
- `EXPECTED` — a typed `OnramperError` that is correct for the input (e.g.
  `quote_unavailable` when a staging provider can't price a pair). The SDK
  surfacing a typed error *is* the pass condition here.
- `SKIP` — a prerequisite (a session) wasn't supplied.
- `FAIL` — an unexpected result or a raw (non-`OnramperError`) throw.

## Config (environment variables)

| Var | Default | Purpose |
|---|---|---|
| `ONRAMPER_API_KEY` | — (required) | Your publishable `pk_test_…` / `pk_prod_…` key |
| `ONRAMPER_ENV` | `staging` | `production` \| `staging` \| `sandbox` |
| `ONRAMPER_SIGN_URL` | — | A URL your backend exposes that signs widget params (`buy`/`sell`). If unset, the example uses a local stub that just echoes the params so the builder still runs. |

### Enabling the checkout / session group

`getTransactionDetail` is the one session-gated call. It resolves a checkout-v2
session (created earlier by a checkout intent) into its transaction detail — the
provider buy/sell URL and status.

#### The tier-2 flow

The SDK never holds your partner secret. It bootstraps a short-lived, DPoP-bound
**tier-2 (unattested)** access token and presents it as an envelope on the
checkout call:

1. **Your backend mints a session.** One Security-V2-signed call to
   `POST /partners/v2/{apiKey}/client-sessions` returns `{ sessionId, sessionToken }`.
   The `sessionToken` (`st_…`) is **single-use**.
2. **The SDK exchanges it** for a tier-2 access token (`at_…`) directly against
   `POST /partners/v2/{apiKey}/client-sessions/tokens`, with a DPoP proof, an
   `X-Onramper-Channel`, and `attestation: { type: 'none' }`. No App Attest or
   device challenge — that is what *unattested* means.
3. **The SDK calls checkout** — a DPoP-enveloped
   `GET /checkout/session/{id}/transaction` bound to that session. The token is
   reused across calls and silently re-bootstrapped (your `getSessionToken` is
   called again) when it expires.

> The checkout session is bound to the SDK session that created it, so
> `getTransactionDetail` only succeeds on that same session — a different or
> stale session surfaces as `invalid_sdk_session` / `unauthorized`, not the data.

#### Wiring `getSessionToken`

Give the SDK a callback that returns a freshly minted pair from your backend:

```js
import { OnramperFiatProtocol } from '@onramper/wdk-protocol-fiat';

const fiat = new OnramperFiatProtocol(undefined, {
  apiKey: 'pk_test_…',
  environment: 'staging',
  // 'wdk-web' in a browser / 'wdk-node' under Node is auto-detected; pin it only
  // to override — it must be in the partner's channel allowlist (see below).
  channel: 'wdk-web',
  // Called on first use and on every re-bootstrap. Must hit YOUR backend, which
  // signs the create-session request. session_token is single-use, so return a
  // fresh pair each call.
  getSessionToken: async () => {
    const res = await fetch('/api/onramper/session', { method: 'POST' });
    const { sessionId, sessionToken } = await res.json();
    return { sessionId, sessionToken };
  },
});

const detail = await fiat.getTransactionDetail(checkoutSessionId);
```

#### Partner config prerequisite

The exchange in step 2 only succeeds if the partner has tier-2 sessions enabled,
with the channel allowed and the SDK's requested scope/TTL within the ceilings
(both are clamped down to these, never up):

```jsonc
// partner config → security.clientSessions.unattested
{
  "channels": ["wdk-web"],                          // must include the SDK's channel
  "maxScope": ["checkout:read", "checkout:write"],  // requested scope is clamped to this
  "maxTtlSec": 900                                   // token TTL is clamped to this
}
```

#### Running this group

The example takes the session as env vars (a single, single-use pair — enough
for one bootstrap), plus a checkout session id to look up:

| Var | Purpose |
|---|---|
| `ONRAMPER_SESSION_ID` | `sessionId` from your create-session call |
| `ONRAMPER_SESSION_TOKEN` | `sessionToken` from your create-session call |
| `ONRAMPER_CHECKOUT_SESSION_ID` | a checkout-v2 session id to look up (from an intent) |

Without these the checkout group is skipped (everything else still runs live).
