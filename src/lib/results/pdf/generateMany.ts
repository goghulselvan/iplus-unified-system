/** Run generators one at a time, yielding to the event loop between items so progress UIs repaint. */
export async function generateMany<T, R>(
  items: T[],
  make: (item: T, index: number) => Promise<R>,
  onProgress?: (pct: number, done: number, total: number) => void,
  onResult?: (result: R, item: T, index: number) => void | Promise<void>,
): Promise<R[]> {
  const out: R[] = [];
  onProgress?.(0, 0, items.length);
  for (let i = 0; i < items.length; i++) {
    const r = await make(items[i], i);
    if (onResult) await onResult(r, items[i], i); else out.push(r);
    onProgress?.(Math.round(((i + 1) / items.length) * 100), i + 1, items.length);
    await new Promise<void>((res) => setTimeout(res, 0));
  }
  return out;
}
