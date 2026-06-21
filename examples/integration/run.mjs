// Runnable integration harness for @onramper/wdk-protocol-fiat.
// Exercises every method against a real environment in many combinations and
// prints a PASS / EXPECTED / SKIP / FAIL matrix. See ./README.md.
//
// In your own project: import { OnramperFiatProtocol } from '@onramper/wdk-protocol-fiat'
import { OnramperError, OnramperErrorCode, OnramperFiatProtocol } from '../../dist/index.node.js';

const API_KEY = process.env.ONRAMPER_API_KEY;
const ENV = process.env.ONRAMPER_ENV ?? 'staging';
if (!API_KEY) {
  console.error('Set ONRAMPER_API_KEY (a publishable pk_test_… / pk_prod_… key).');
  process.exit(2);
}

// A `signUrl` callback. In production this calls YOUR backend, which signs the
// widget params with your Security-V2 key. For the example we fall back to a
// local echo so buy/sell still produce a URL without a backend.
const signUrl = process.env.ONRAMPER_SIGN_URL
  ? async (params) => {
      const r = await fetch(process.env.ONRAMPER_SIGN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
      });
      return (await r.json()).url;
    }
  : async (params) => {
      const q = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      );
      return `https://buy.onramper.dev/?${q}`;
    };

// The session-gated group runs only when a session is supplied (see README).
const haveSession = Boolean(process.env.ONRAMPER_SESSION_ID && process.env.ONRAMPER_SESSION_TOKEN);
const getSessionToken = haveSession
  ? async () => ({ sessionId: process.env.ONRAMPER_SESSION_ID, sessionToken: process.env.ONRAMPER_SESSION_TOKEN })
  : undefined;
const checkoutSessionId = process.env.ONRAMPER_CHECKOUT_SESSION_ID ?? 'sess_example';

const fiat = new OnramperFiatProtocol(undefined, { apiKey: API_KEY, environment: ENV, signUrl, getSessionToken });

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
};
const tally = { PASS: 0, EXPECTED: 0, SKIP: 0, FAIL: 0 };
const mark = { PASS: C.green, EXPECTED: C.yellow, SKIP: C.dim, FAIL: C.red };

/**
 * Run one scenario. `expectErrors` lists OnramperError codes that are a correct
 * outcome for this input (e.g. quote_unavailable on a staging pair) → EXPECTED.
 */
async function scenario(name, fn, { expectErrors = [], summarize = (v) => v } = {}) {
  const t0 = Date.now();
  let status;
  let note;
  try {
    const v = await fn();
    status = 'PASS';
    note = summarize(v);
  } catch (e) {
    const code = e instanceof OnramperError ? e.code : undefined;
    if (code && expectErrors.includes(code)) {
      status = 'EXPECTED';
      note = `${code}: ${e.message}`;
    } else if (e instanceof OnramperError) {
      status = 'FAIL';
      note = `unexpected ${code}: ${e.message}`;
    } else {
      status = 'FAIL';
      note = `RAW (non-OnramperError!) ${e}`;
    }
  }
  tally[status]++;
  const ms = `${Date.now() - t0}ms`.padStart(7);
  console.log(
    `  ${mark[status]}${status.padEnd(8)}${C.reset}${C.dim}${ms}${C.reset}  ${name}  ${C.dim}${note ?? ''}${C.reset}`,
  );
}

function group(title) {
  console.log(`\n${C.cyan}▌ ${title}${C.reset}`);
}

const Q_UNAVAIL = [
  OnramperErrorCode.QUOTE_UNAVAILABLE,
  OnramperErrorCode.UPSTREAM_ERROR,
  OnramperErrorCode.UNSUPPORTED_ASSET,
];

console.log(`\n@onramper/wdk-protocol-fiat — integration run (env=${ENV}, key=${API_KEY.slice(0, 12)}…)`);

group('Supported');
await scenario('getSupportedCryptoAssets()', () => fiat.getSupportedCryptoAssets(), {
  summarize: (a) => `${a.length} assets${a[0] ? ` e.g. ${a[0].code}/${a[0].networkCode}` : ''}`,
});
await scenario('getSupportedFiatCurrencies()', () => fiat.getSupportedFiatCurrencies(), {
  summarize: (a) => `${a.length} fiats${a[0] ? ` e.g. ${a[0].code}` : ''}`,
});
await scenario('getSupportedCountries()', () => fiat.getSupportedCountries(), {
  summarize: (a) => `${a.length} countries${a[0] ? ` e.g. ${a[0].code}/${a[0].name}` : ''}`,
});

group('Quotes — buy (fiat → crypto), several pairs & amounts');
for (const [fiatCurrency, cryptoAsset, fiatAmount] of [
  ['eur', 'btc', 500],
  ['usd', 'eth', 100],
  ['gbp', 'usdc', 250],
  ['eur', 'btc', 50_000],
]) {
  await scenario(
    `quoteBuy ${fiatCurrency}→${cryptoAsset} ${fiatAmount}`,
    () => fiat.quoteBuy({ fiatCurrency, cryptoAsset, fiatAmount }),
    { expectErrors: Q_UNAVAIL, summarize: (q) => `${q.provider} rate=${q.rate} out=${q.cryptoAmount}` },
  );
}

group('Quotes — sell (crypto → fiat)');
for (const [fiatCurrency, cryptoAsset, cryptoAmount] of [
  ['usd', 'eth', '0.5'],
  ['eur', 'btc', '0.02'],
]) {
  await scenario(
    `quoteSell ${cryptoAsset}→${fiatCurrency} ${cryptoAmount}`,
    () => fiat.quoteSell({ fiatCurrency, cryptoAsset, cryptoAmount }),
    { expectErrors: Q_UNAVAIL, summarize: (q) => `${q.provider} rate=${q.rate}` },
  );
}

group('Widget URLs — buy / sell (pure signed-URL builders, no backend call)');
await scenario(
  'buy usd→eth 120 → recipient',
  () =>
    fiat.buy({
      fiatCurrency: 'usd',
      cryptoAsset: 'eth',
      fiatAmount: 120,
      recipient: '0xabc0000000000000000000000000000000000001',
    }),
  { summarize: (r) => r.buyUrl.slice(0, 64) + '…' },
);
await scenario(
  'buy eur→btc 500 + quoteId + network',
  () =>
    fiat.buy({
      fiatCurrency: 'eur',
      cryptoAsset: 'btc',
      fiatAmount: 500,
      recipient: 'bc1qexample',
      networkCode: 'bitcoin',
      quoteId: 'q-123',
    }),
  { summarize: (r) => (r.buyUrl.includes('quoteId=q-123') ? 'quoteId forwarded ✓' : 'quoteId MISSING') },
);
await scenario(
  'sell eth→usd 0.25 → refundAddress',
  () => fiat.sell({ fiatCurrency: 'usd', cryptoAsset: 'eth', cryptoAmount: '0.25', refundAddress: '0xrefund' }),
  {
    summarize: (r) =>
      r.sellUrl.includes('mode=sell') || r.sellUrl.includes('direction=sell') ? 'sell URL ✓' : r.sellUrl.slice(0, 50),
  },
);

group('Checkout / session — getTransactionDetail (bootstrap → DPoP envelope → checkout v2)');
if (!haveSession) {
  tally.SKIP++;
  console.log(
    `  ${C.dim}SKIP        getTransactionDetail — set ONRAMPER_SESSION_ID + ONRAMPER_SESSION_TOKEN (tier-2 must be enabled on the partner; see README)${C.reset}`,
  );
} else {
  await scenario(
    'getTransactionDetail no-callback fast-fail',
    () => new OnramperFiatProtocol(undefined, { apiKey: API_KEY, environment: ENV, signUrl }).getTransactionDetail('x'),
    {
      expectErrors: [OnramperErrorCode.INVALID_CONFIG],
    },
  );
  await scenario(`getTransactionDetail(${checkoutSessionId})`, () => fiat.getTransactionDetail(checkoutSessionId), {
    expectErrors: [
      OnramperErrorCode.INVALID_SDK_SESSION,
      OnramperErrorCode.INVALID_GRANT,
      OnramperErrorCode.UNAUTHORIZED,
    ],
    summarize: (d) => `status=${d.status} provider=${d.provider} tx=${d.transactionId ?? ''}`,
  });
}

console.log(
  `\n${C.cyan}── summary ──${C.reset}  ${C.green}${tally.PASS} pass${C.reset}  ${C.yellow}${tally.EXPECTED} expected${C.reset}  ${C.dim}${tally.SKIP} skip${C.reset}  ${C.red}${tally.FAIL} fail${C.reset}\n`,
);
process.exit(tally.FAIL > 0 ? 1 : 0);
