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
| **Checkout / session** | `getTransactionDetail` | a session (see below) |

Each scenario prints one of:

- `PASS` — returned the expected shape.
- `EXPECTED` — a typed `OnramperError` that is correct for the input (e.g.
  `quote_unavailable` when a provider can't price a pair). The SDK surfacing a
  typed error *is* the pass condition here.
- `SKIP` — a prerequisite (a session) wasn't supplied.
- `FAIL` — an unexpected result or a raw (non-`OnramperError`) throw.

## Config (environment variables)

| Var | Default | Purpose |
|---|---|---|
| `ONRAMPER_API_KEY` | — (required) | Your publishable `pk_test_…` / `pk_prod_…` key |
| `ONRAMPER_ENV` | `production` | environment name |
| `ONRAMPER_SIGN_URL` | — | A URL your backend exposes that signs widget params (`buy`/`sell`). If unset, the example uses a local stub that just echoes the params so the builder still runs. |

### The checkout / session group

`getTransactionDetail` is the one session-gated call; it resolves a checkout
session into its transaction detail (provider URL and status). Provide
`getSessionToken` — a callback returning `{ sessionId, sessionToken }` your
backend created — and set these to run the group:

| Var | Purpose |
|---|---|
| `ONRAMPER_SESSION_ID` | `sessionId` from your backend |
| `ONRAMPER_SESSION_TOKEN` | `sessionToken` from your backend |
| `ONRAMPER_CHECKOUT_SESSION_ID` | a checkout session id to look up |

Without these the checkout group is skipped (everything else still runs live).
