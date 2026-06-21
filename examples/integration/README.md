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

`getTransactionDetail` is the one session-gated call. The SDK never holds your
partner secret — your backend mints a session via a single Security-V2 call to
`POST /partners/v2/{apiKey}/client-sessions` and returns `{ sessionId, sessionToken }`.
For this to succeed the partner must have **tier-2 (unattested) sessions
enabled**:

```jsonc
// partner config → security.clientSessions.unattested
{ "channels": ["wdk-web"], "maxScope": ["checkout:read", "checkout:write"], "maxTtlSec": 900 }
```

Then supply a freshly minted session to the example:

| Var | Purpose |
|---|---|
| `ONRAMPER_SESSION_ID` | `sessionId` from your create-session call |
| `ONRAMPER_SESSION_TOKEN` | `sessionToken` from your create-session call |
| `ONRAMPER_CHECKOUT_SESSION_ID` | a checkout-v2 session id to look up (from an intent) |

Without these the checkout group is skipped (everything else still runs live).
