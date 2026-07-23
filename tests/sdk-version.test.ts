import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildEnvelopeHeaders, SDK_VERSION } from '../src/client/headers.ts';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('SDK version header', () => {
  // Guards the drift the Tether review caught: the reported version and the
  // published package version are two literals that must never disagree.
  it('SDK_VERSION equals the package.json version', () => {
    expect(SDK_VERSION).toBe(pkg.version);
  });

  it('stamps X-Onramper-SDK-Version as <platform>-<version> for both channels', () => {
    const base = {
      apiKey: 'pk',
      accessToken: 'at',
      dpopProof: 'proof',
      deviceFingerprint: 'fp',
      nonce: 'n',
    };
    const web = buildEnvelopeHeaders({ ...base, channel: 'wdk-web' });
    const node = buildEnvelopeHeaders({ ...base, channel: 'wdk-node' });
    expect(web['X-Onramper-SDK-Version']).toBe(`web-${pkg.version}`);
    expect(node['X-Onramper-SDK-Version']).toBe(`node-${pkg.version}`);
  });
});
