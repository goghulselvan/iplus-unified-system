import type { FigureBox } from "./questionRow";

export interface PixelRect { sx: number; sy: number; sw: number; sh: number }

/** Padding added around a picture, as a fraction of the page. */
export const CROP_PADDING = 0.03;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Pixel rectangle of a figure box on a rendered page: the box grown by `pad`
 * (a fraction of the page) on every side, then kept inside the page.
 */
export function cropRect(box: FigureBox, pageW: number, pageH: number, pad = CROP_PADDING): PixelRect {
  const x0 = clamp(box.x - pad, 0, 1);
  const y0 = clamp(box.y - pad, 0, 1);
  const x1 = clamp(box.x + box.w + pad, 0, 1);
  const y1 = clamp(box.y + box.h + pad, 0, 1);
  const sx = Math.round(x0 * pageW);
  const sy = Math.round(y0 * pageH);
  const sw = Math.max(1, Math.min(pageW - sx, Math.round(x1 * pageW) - sx));
  const sh = Math.max(1, Math.min(pageH - sy, Math.round(y1 * pageH) - sy));
  return { sx, sy, sw, sh };
}

export function validBox(b: unknown): b is FigureBox {
  if (!b || typeof b !== "object") return false;
  const { x, y, w, h } = b as Record<string, unknown>;
  return [x, y, w, h].every((v) => typeof v === "number" && Number.isFinite(v)) && (w as number) > 0 && (h as number) > 0;
}
