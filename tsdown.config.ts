import { defineConfig } from 'tsdown';

// Per-platform entry points let bundlers dead-code-eliminate the platform a
// given consumer is NOT using. The bare `index` entry is the generic fallback
// for bundlers that don't honour the `browser`/`node` export conditions.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'index.browser': 'src/index.ts',
    'index.node': 'src/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: 'es2021',
  // `neutral` keeps tsdown from injecting Node builtins, so the same bytes run
  // in any browser. The Node-specific adapter reaches for `node:*` lazily.
  platform: 'neutral',
  outDir: 'dist',
});
