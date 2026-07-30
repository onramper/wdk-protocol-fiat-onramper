// Runnable integration harness for @onramper/wdk-protocol-fiat-onramper.
// Exercises every method against a real environment in many combinations and
// prints a PASS / EXPECTED / SKIP / FAIL matrix. See ./README.md.
//
// In your own project: import { OnramperFiatProtocol } from '@onramper/wdk-protocol-fiat-onramper'
import { OnramperError, OnramperErrorCode, OnramperFiatProtocol } from '../../dist/index.node.js';

const API_KEY = process.env.ONRAMPER_API_KEY;
const ENV = process.env.ONRAMPER_ENV ?? 'production';
if (!API_KEY) {
  console.error('Set ONRAMPER_API_KEY (a publishable pk_test_… / pk_prod_… key).');
  process.exit(2);
}

// A `signUrl` callback. In production this calls YOUR backend, which signs the
// widget params. For the example we fall back to a local echo so buy/sell
// still produce a URL without a backend.
const signUrl = process.env.ONRAMPER_SIGN_URL
  ? async (params) => {
      const r = await fetch(process.env.ONRAMPER_SIGN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!r.ok) throw new Error(`sign-url backend returned HTTP ${r.status}`);
      const body = await r.json().catch(() => ({}));
      if (typeof body.url !== 'string') throw new Error('sign-url backend did not return { url: string }');
      return body.url;
    }
  : async (params) => {
      const q = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      );
      return `https://widget.example/?${q}`;
    };

// The session-gated group runs only when a session is supplied (see README).
const haveSession = Boolean(process.env.ONRAMPER_SESSION_ID && process.env.ONRAMPER_SESSION_TOKEN);
const getSessionToken = haveSession
  ? async () => ({ sessionId: process.env.ONRAMPER_SESSION_ID, sessionToken: process.env.ONRAMPER_SESSION_TOKEN })
  : undefined;
const checkoutSessionId = process.env.ONRAMPER_CHECKOUT_SESSION_ID ?? 'sess_example';

let fiat;
try {
  fiat = new OnramperFiatProtocol(undefined, { apiKey: API_KEY, environment: ENV, signUrl, getSessionToken });
} catch (e) {
  const code = e instanceof OnramperError ? `${e.code}: ` : '';
  console.error(`\nCould not initialise the SDK — ${code}${e.message ?? e}`);
  process.exit(2);
}

/** Strip secrets/PII (apiKey, address) from a URL before logging. */
const redact = (url) => String(url).replace(/([?&](?:apiKey|address)=)[^&]*/gi, '$1***');

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

// Log only the key TYPE (pk_test_/pk_prod_), never the identifier.
const keyType = API_KEY.replace(/^(pk_(?:test|prod)_).*/i, '$1***');
console.log(`\n@onramper/wdk-protocol-fiat-onramper — integration run (env=${ENV}, key=${keyType})`);

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

// Amounts are integers in the asset's smallest unit: fiat minor units (cents)
// for a buy spend, base units (wei/sat) for a sell.
group('Quotes — buy (spend an exact fiat amount), several pairs');
for (const [fiatCurrency, cryptoAsset, fiatAmount] of [
  ['eur', 'btc', 500_00n], // €500.00
  ['usd', 'eth', 100_00n], // $100.00
  ['gbp', 'usdc', 250_00n], // £250.00
  ['eur', 'btc', 50_000_00n], // €50,000.00
]) {
  await scenario(
    `quoteBuy ${fiatCurrency}→${cryptoAsset} ${fiatAmount}`,
    () => fiat.quoteBuy({ fiatCurrency, cryptoAsset, fiatAmount }),
    { expectErrors: Q_UNAVAIL, summarize: (q) => `${q.metadata.provider} rate=${q.rate} out=${q.cryptoAmount}` },
  );
}

group('Quotes — sell (sell an exact crypto amount)');
for (const [fiatCurrency, cryptoAsset, cryptoAmount] of [
  ['usd', 'eth', 500_000_000_000_000_000n], // 0.5 ETH (18 decimals)
  ['eur', 'btc', 2_000_000n], // 0.02 BTC (8 decimals)
]) {
  await scenario(
    `quoteSell ${cryptoAsset}→${fiatCurrency} ${cryptoAmount}`,
    () => fiat.quoteSell({ fiatCurrency, cryptoAsset, cryptoAmount }),
    { expectErrors: Q_UNAVAIL, summarize: (q) => `${q.metadata.provider} rate=${q.rate} out=${q.fiatAmount}` },
  );
}

group('Widget URLs — buy / sell (signed via your signUrl callback)');
await scenario(
  'buy usd→eth $120 → recipient',
  () =>
    fiat.buy({
      fiatCurrency: 'usd',
      cryptoAsset: 'eth',
      fiatAmount: 120_00n,
      recipient: '0xabc0000000000000000000000000000000000001',
    }),
  { expectErrors: [OnramperErrorCode.UNSUPPORTED_ASSET], summarize: (r) => `${redact(r.buyUrl).slice(0, 72)}…` },
);
await scenario(
  'buy eur→btc €500 + quoteId + network',
  () =>
    fiat.buy({
      fiatCurrency: 'eur',
      cryptoAsset: 'btc',
      fiatAmount: 500_00n,
      recipient: 'bc1qexample',
      config: { networkCode: 'bitcoin', quoteId: 'q-123' },
    }),
  {
    expectErrors: [OnramperErrorCode.UNSUPPORTED_ASSET],
    summarize: (r) => (r.buyUrl.includes('quoteId=q-123') ? 'quoteId forwarded ✓' : 'quoteId MISSING'),
  },
);
await scenario(
  'sell eth→usd 0.25 → refundAddress',
  () =>
    fiat.sell({
      fiatCurrency: 'usd',
      cryptoAsset: 'eth',
      cryptoAmount: 250_000_000_000_000_000n, // 0.25 ETH
      refundAddress: '0xrefund',
    }),
  {
    expectErrors: [OnramperErrorCode.UNSUPPORTED_ASSET],
    summarize: (r) =>
      r.sellUrl.includes('mode=sell') || r.sellUrl.includes('direction=sell')
        ? 'sell URL ✓'
        : redact(r.sellUrl).slice(0, 50),
  },
);

group('Checkout / session — getTransactionDetail');
if (!haveSession) {
  tally.SKIP++;
  console.log(
    `  ${C.dim}SKIP        getTransactionDetail — set ONRAMPER_SESSION_ID + ONRAMPER_SESSION_TOKEN (see README)${C.reset}`,
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
    summarize: (d) => `status=${d.status} provider=${d.metadata.provider ?? ''}`,
  });
}

console.log(
  `\n${C.cyan}── summary ──${C.reset}  ${C.green}${tally.PASS} pass${C.reset}  ${C.yellow}${tally.EXPECTED} expected${C.reset}  ${C.dim}${tally.SKIP} skip${C.reset}  ${C.red}${tally.FAIL} fail${C.reset}\n`,
);
process.exit(tally.FAIL > 0 ? 1 : 0);
