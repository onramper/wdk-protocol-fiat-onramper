// Bare runtime entrypoint, resolved through the package `bare` export condition.
// It loads the built ESM bundle and remaps web/Node globals (fetch, crypto,
// URL, …) through bare-node-runtime so the same protocol runs under Bare.
// Mirrors @tetherto/wdk-protocol-fiat-moonpay. Lint-ignored and unbundled: the
// `with { imports }` attribute is Bare-only, so Node would reject it at runtime.

import 'bare-node-runtime/global';

export * from './dist/index.js' with { imports: 'bare-node-runtime/imports' };

export { default } from './dist/index.js' with { imports: 'bare-node-runtime/imports' };
