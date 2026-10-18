/** Возвращает первый элемент массива; для пустого массива возвращает null. */
export function firstOrNull(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  return values[values.length];
}
