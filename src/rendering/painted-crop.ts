/** A rectangle in sheet pixels. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Alpha at or below this is empty padding; above it, antialiasing and painted
 * contact shadows are retained. */
const ALPHA_THRESHOLD = 3;
const PADDING = 2;

/**
 * The art pack's crop rule: the visible bounds of an authored region plus two
 * pixels of padding, clamped to the region. `rgba` is the whole sheet,
 * unpremultiplied, row-major. `scripts/crop-pack.mjs` writes the result into the
 * manifest; the runtime only reads it.
 */
export function scanPaintedCrop(
  rgba: ArrayLike<number>,
  sheetWidth: number,
  sheetHeight: number,
  region: CropRect,
): CropRect {
  const right = region.x + region.w;
  const bottom = region.y + region.h;
  if (right > sheetWidth || bottom > sheetHeight || region.w <= 0 || region.h <= 0)
    throw new Error('Artwork crop exceeds its sheet.');
  let left = right;
  let top = bottom;
  let maxX = -1;
  let maxY = -1;
  let transparent = false;
  for (let y = region.y; y < bottom; y++)
    for (let x = region.x; x < right; x++) {
      if (rgba[(y * sheetWidth + x) * 4 + 3] <= ALPHA_THRESHOLD) {
        transparent = true;
        continue;
      }
      if (x < left) left = x;
      if (y < top) top = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  if (maxX < left || maxY < top) throw new Error('Artwork crop contains no visible pixels.');
  if (!transparent) throw new Error('Artwork sprite requires a transparent background.');
  const x = Math.max(region.x, left - PADDING);
  const y = Math.max(region.y, top - PADDING);
  return {
    x,
    y,
    w: Math.min(right, maxX + PADDING + 1) - x,
    h: Math.min(bottom, maxY + PADDING + 1) - y,
  };
}
