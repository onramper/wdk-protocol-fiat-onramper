import type { FingerprintAdapter, StorageAdapter } from '../types.ts';

const FINGERPRINT_KEY = 'onramper.wdk.fingerprint';

/**
 * Fingerprint for runtimes with no browser signals (Node, and RN until a richer
 * adapter is injected): a random id generated once and persisted via the storage
 * adapter. With the default in-memory storage this is per-process; inject a
 * durable storage adapter to make it stable across restarts.
 */
export function createPersistedFingerprintAdapter(storage: StorageAdapter): FingerprintAdapter {
  return {
    async get(): Promise<string> {
      const existing = await storage.get(FINGERPRINT_KEY);
      if (existing) {
        return existing;
      }
      const id =
        globalThis.crypto?.randomUUID?.() ?? `fp_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
      await storage.set(FINGERPRINT_KEY, id);
      return id;
    },
  };
}
