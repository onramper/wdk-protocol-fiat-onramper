/** Minimal single-value TTL cache for the supported lists. */
export class TtlCache<T> {
  private value?: T;
  private expiresAt = 0;

  /** @param ttlMs - Lifetime of a stored value, in milliseconds. */
  constructor(private readonly ttlMs: number) {}

  /** Returns the cached value, or `undefined` once the TTL has elapsed or nothing has been stored. Expiry is evaluated lazily on read. */
  get(): T | undefined {
    if (this.value !== undefined && Date.now() < this.expiresAt) {
      return this.value;
    }
    return undefined;
  }

  /** Stores `value` and restarts the TTL window from now. */
  set(value: T): void {
    this.value = value;
    this.expiresAt = Date.now() + this.ttlMs;
  }
}
