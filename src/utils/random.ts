/** UUID when the runtime exposes one, else a prefixed time+random fallback. */
export function randomId(prefix: string): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  );
}
