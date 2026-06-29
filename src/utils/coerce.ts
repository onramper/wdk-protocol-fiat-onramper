/** Coerce an optional number/string to its decimal string form, preserving `undefined`. */
export function toOptionalString(value: number | string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'number' ? String(value) : value;
}
