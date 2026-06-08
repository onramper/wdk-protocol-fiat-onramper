import { defineConfig } from 'tsdown';

// Per-platform entry points let bundlers dead-code-eliminate the two platforms
// a given consumer is NOT using. The big win is keeping the React Native crypto
// fallback (`@noble/curves`) and any RN-only code out of the browser bundle —
// a web app should never ship the pure-JS P-256 implementation when it has
// WebCrypto. The bare `index` entry is the generic fallback for bundlers that
// don't honour the `browser`/`node`/`react-native` export conditions.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'index.browser': 'src/index.ts',
    'index.node': 'src/index.ts',
    'index.native': 'src/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  // es2021 is the floor for React Native's Hermes engine; going higher (core-utils
  // uses es2023) risks emitting syntax Hermes can't parse.
  target: 'es2021',
  // `neutral` keeps tsdown from injecting Node builtins, so the same bytes run in
  // a browser and in RN. The Node-specific adapter reaches for `node:*` lazily.
  platform: 'neutral',
  outDir: 'dist',
  deps: {
    // Optional peers — never inline them; the platform adapter that needs them
    // imports them lazily so they stay out of bundles that don't.
    neverBundle: ['@noble/curves', '@noble/hashes', 'react-native', '@react-native-async-storage/async-storage'],
  },
});
