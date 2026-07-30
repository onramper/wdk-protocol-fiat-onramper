import { randomId } from '../../utils/format.ts';
import type { FingerprintAdapter, StorageAdapter } from '../types.ts';

const FINGERPRINT_KEY = 'onramper.wdk.fingerprint';

/**
 * Fingerprint for runtimes with no browser signals (Node, and RN until a richer
 * adapter is injected): a random id generated once and persisted via the storage
 * adapter. With the default in-memory storage this is per-process; inject a
 * durable storage adapter to make it stable across restarts.
 *
 * @param storage - The storage adapter to persist the generated id in.
 * @returns A fingerprint adapter whose `get()` returns the same id for the life of `storage`.
 */
export function createPersistedFingerprintAdapter(storage: StorageAdapter): FingerprintAdapter {
  return {
    /** Returns the persisted id, generating and storing one on first call. */
    async get(): Promise<string> {
      const existing = await storage.get(FINGERPRINT_KEY);
      if (existing) {
        return existing;
      }
      const id = randomId('fp');
      await storage.set(FINGERPRINT_KEY, id);
      return id;
    },
  };
}
