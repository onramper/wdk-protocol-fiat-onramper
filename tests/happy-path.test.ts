import { describe, expect, it } from 'vitest';
import { OnramperFiatProtocol } from '../src/index.ts';
import { decodeProofPayload } from './dpop-helpers.ts';
import { baseConfig, json, mockHttp, tokenRoute } from './helpers.ts';

const txRoute = {
  match: '/checkout/session/',
  handler: () =>
    json(200, {
      valid: true,
      transactionInformation: { transactionId: 'tx_1', status: 'pending', onramp: 'provider-a' },
    }),
};

describe('happy paths not covered by the conformance suite', () => {
  it('quoteSell() hits /quotes/{crypto}/{fiat}?type=sell and maps the best quote', async () => {
    // sell flips source/destination vs buy: source = crypto, destination = fiat.
    const http = mockHttp([
      {
        match: '/quotes/eth/usd',
        handler: () => json(200, [{ rate: 3000, payout: 300, ramp: 'provider-b', paymentMethod: 'sepa' }]),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const quote = await proto.quoteSell({ fiatCurrency: 'usd', cryptoAsset: 'eth', cryptoAmount: '0.1' });

    expect(quote.provider).toBe('provider-b');
    expect(quote.rate).toBe('3000');
    const call = http.calls.find((c) => c.url.includes('/quotes/eth/usd'));
    expect(call?.url).toContain('type=sell');
    expect(call?.url).toContain('amount=0.1');
    expect(call?.headers.Authorization).toBe('pk_test_abc123');
    expect(call?.headers['X-Onramper-DPoP']).toBeUndefined(); // public data path, no envelope
  });

  it('getSupportedFiatCurrencies() maps the fiat list from the {message} envelope', async () => {
    const http = mockHttp([
      {
        match: '/supported',
        handler: () =>
          json(200, {
            message: {
              crypto: [{ code: 'eth', network: 'ethereum', decimals: 18, name: 'Ethereum' }],
              fiat: [
                { code: 'eur', decimals: 2, name: 'Euro' },
                { code: 'gbp', decimals: 2, name: 'British Pound' },
              ],
            },
          }),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const fiats = await proto.getSupportedFiatCurrencies();

    expect(fiats).toEqual([
      { code: 'eur', decimals: 2, name: 'Euro' },
      { code: 'gbp', decimals: 2, name: 'British Pound' },
    ]);
  });

  it('a valid access token is reused — a second session-gated call does not re-exchange', async () => {
    let mints = 0;
    const http = mockHttp([
      {
        match: 'client-sessions/tokens',
        handler: () => {
          mints += 1;
          return json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 900, tier: 1 });
        },
      },
      txRoute,
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    await proto.getTransactionDetail('a');
    await proto.getTransactionDetail('b'); // sequential — the cached, unexpired token is reused

    expect(mints).toBe(1);
  });

  it('the authenticated checkout call binds its DPoP proof to the exact request URL + access token', async () => {
    const http = mockHttp([tokenRoute, txRoute]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    await proto.getTransactionDetail('sess_abc');

    const txCall = http.calls.find((c) => c.url.includes('/checkout/session/'));
    const proof = decodeProofPayload(txCall?.headers['X-Onramper-DPoP'] as string);
    expect(proof.htm).toBe('GET');
    expect(proof.htu).toBe('https://api-stg.onramper.com/checkout/session/sess_abc/transaction');
    expect(proof.ath).toBeTruthy(); // access-token hash binding (ath) present
    expect(txCall?.headers['X-Onramper-SDK-Session']).toBe('Bearer at_test_token');
  });
});
