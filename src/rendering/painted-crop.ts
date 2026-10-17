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

/** A decoded sheet: unpremultiplied RGBA, row-major, as in `ImageData`. */
export interface SheetPixels {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/** Every authored sprite region in a manifest, named by its JSON path. */
export function* paintedRegions(value: unknown, name = ''): Generator<[string, CropRect]> {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* paintedRegions(item, name + '.' + index);
  } else if (value && typeof value === 'object') {
    const region = value as Partial<CropRect> & { sheet?: unknown };
    if (typeof region.sheet === 'string' && Number.isInteger(region.w))
      yield [name.slice(1), region as CropRect];
    else
      for (const [key, item] of Object.entries(value))
        yield* paintedRegions(item, name + '.' + key);
  }
}

/**
 * The art pack's crop rule: the visible bounds of an authored region plus two
 * pixels of padding, clamped to the region. `scripts/crop-pack.mjs` writes the
 * result into the manifest; the runtime only reads it.
 */
export function scanPaintedCrop(sheet: SheetPixels, region: CropRect): CropRect {
  const { data: rgba, width: sheetWidth } = sheet;
  const right = region.x + region.w;
  const bottom = region.y + region.h;
  if (right > sheet.width || bottom > sheet.height || region.w <= 0 || region.h <= 0)
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
