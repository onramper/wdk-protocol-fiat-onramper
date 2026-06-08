/** Minimal single-value TTL cache for the supported lists. */
export class TtlCache<T> {
  private value?: T;
  private expiresAt = 0;

  constructor(private readonly ttlMs: number) {}

  get(): T | undefined {
    if (this.value !== undefined && Date.now() < this.expiresAt) {
      return this.value;
    }
    return undefined;
  }

  set(value: T): void {
    this.value = value;
    this.expiresAt = Date.now() + this.ttlMs;
  }
}
