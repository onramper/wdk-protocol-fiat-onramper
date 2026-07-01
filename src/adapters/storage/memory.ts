import type { StorageAdapter } from '../types.ts';

/**
 * In-memory token store — the default on every platform.
 *
 * This is a deliberate security choice, not a placeholder: refresh tokens in
 * `localStorage` are exfiltratable by XSS, so we keep them in process memory and
 * let consumers opt into persistence by injecting their own adapter (e.g.
 * AsyncStorage / SecureStore on RN). Tokens are short-lived and the DPoP key is
 * non-extractable, so an in-memory session is the safe baseline.
 *
 * @returns A storage adapter backed by a process-local `Map`.
 */
export function createMemoryStorageAdapter(): StorageAdapter {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}
