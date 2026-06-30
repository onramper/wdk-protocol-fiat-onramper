import { readFileSync } from 'node:fs';
import { FiatProtocol } from '@tetherto/wdk-wallet/protocols';
import { describe, expect, it } from 'vitest';
import { OnramperFiatProtocol } from '../src/index.ts';
import { baseConfig } from './helpers.ts';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const pkg = JSON.parse(read('../package.json'));

// Bare can't run inside vitest (Node rejects the Bare-only `with { imports }`
// attribute in bare.js), so validate the wiring structurally + assert the class
// genuinely extends the real WDK base. Mirrors @tetherto/wdk-protocol-fiat-moonpay.
describe('Bare runtime support', () => {
  it('declares a bare export condition pointing at bare.js', () => {
    expect(pkg.exports['.'].bare).toEqual({ types: './dist/index.d.ts', default: './bare.js' });
  });

  it('ships bare.js and depends on bare-node-runtime', () => {
    expect(pkg.files).toContain('bare.js');
    expect(pkg.dependencies['bare-node-runtime']).toBeTruthy();
  });

  it('bare.js loads the global shim and re-exports the build through bare-node-runtime', () => {
    const bare = read('../bare.js');
    expect(bare).toContain("import 'bare-node-runtime/global'");
    expect(bare).toContain("from './dist/index.js' with { imports: 'bare-node-runtime/imports' }");
  });

  it('extends the real @tetherto/wdk-wallet FiatProtocol', () => {
    expect(OnramperFiatProtocol.prototype).toBeInstanceOf(FiatProtocol);
    expect(new OnramperFiatProtocol(undefined, baseConfig())).toBeInstanceOf(FiatProtocol);
  });

  it('default-exports the protocol class (WDK `import X from …` parity)', async () => {
    const mod = await import('../src/index.ts');
    expect(mod.default).toBe(OnramperFiatProtocol);
  });
});
