/** Helpers inmutables para los editores de lista dinámicos (añadir/quitar/reordenar). */

export function replaceAt<T>(items: readonly T[], index: number, item: T): T[] {
  const next = [...items];
  next[index] = item;
  return next;
}

export function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}

/** Mueve el elemento una posición arriba (-1) o abajo (+1); no-op en los bordes. */
export function moveItem<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}
