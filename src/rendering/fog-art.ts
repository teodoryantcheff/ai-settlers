/** Cosmetic distance fields only: authoritative discovery is never modified. */
export interface FogFields {
  width: number;
  height: number;
  unknown: Float32Array;
  protected: Float32Array;
}

/** Exact Euclidean distance to source tile centres, in two separable passes. */
function distances(width: number, height: number, source: (i: number) => boolean) {
  const result = new Float32Array(width * height);
  const size = Math.max(width, height);
  const values = new Float64Array(size);
  const sites = new Int32Array(size);
  const edges = new Float64Array(size + 1);
  function scan(length: number, start: number, stride: number, initialize: boolean) {
    for (let q = 0; q < length; q++)
      values[q] = initialize ? (source(start + q * stride) ? 0 : 1e9) : result[start + q * stride];
    let k = 0;
    sites[0] = 0;
    edges[0] = -Infinity;
    edges[1] = Infinity;
    for (let q = 1; q < length; q++) {
      let crossing: number;
      do {
        const p = sites[k];
        crossing = (values[q] + q * q - values[p] - p * p) / (2 * (q - p));
        if (crossing > edges[k]) break;
        k--;
      } while (k >= 0);
      sites[++k] = q;
      edges[k] = crossing;
      edges[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q++) {
      while (edges[k + 1] < q) k++;
      const d = q - sites[k];
      result[start + q * stride] = d * d + values[sites[k]];
    }
  }
  for (let y = 0; y < height; y++) scan(width, y * width, 1, true);
  for (let x = 0; x < width; x++) scan(height, x, width, false);
  for (let i = 0; i < result.length; i++) result[i] = Math.sqrt(result[i]);
  return result;
}

export function fogFields(
  width: number,
  height: number,
  isRevealed: (i: number) => boolean,
  protectedTiles: Uint8Array,
): FogFields {
  return {
    width,
    height,
    unknown: distances(width, height, (i) => !isRevealed(i)),
    protected: distances(width, height, (i) => protectedTiles[i] === 1),
  };
}

function smooth(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

/** Smoothly sample tile-centred fields so contours do not follow tile edges. */
function sample(field: Float32Array, width: number, height: number, x: number, y: number) {
  const px = Math.max(0, Math.min(width - 1, x - 0.5));
  const py = Math.max(0, Math.min(height - 1, y - 0.5));
  const x0 = Math.floor(px),
    y0 = Math.floor(py);
  const x1 = Math.min(width - 1, x0 + 1),
    y1 = Math.min(height - 1, y0 + 1);
  const fx = px - x0,
    fy = py - y0;
  const top = field[y0 * width + x0] * (1 - fx) + field[y0 * width + x1] * fx;
  const bottom = field[y1 * width + x0] * (1 - fx) + field[y1 * width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Paint once per discovery/territory change, at a fixed world-space resolution.
 * The opaque core covers whole unknown tiles; the two-tile fade stays inward.
 * Protection smoothly narrows that fade before reaching owned land/buildings. */
export function paintFog(context: CanvasRenderingContext2D, fields: FogFields, feather: number) {
  const { width, height } = context.canvas;
  const pixels = context.createImageData(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const tx = ((x + 0.5) / width) * fields.width;
      const ty = ((y + 0.5) / height) * fields.height;
      const unknown = sample(fields.unknown, fields.width, fields.height, tx, ty);
      const protectedDistance = sample(fields.protected, fields.width, fields.height, tx, ty);
      const tile = Math.floor(ty) * fields.width + Math.floor(tx);
      const alpha =
        fields.unknown[tile] === 0
          ? 1
          : (1 - smooth((unknown - 1) / feather)) * smooth((protectedDistance - 1) / 0.5);
      const i = (y * width + x) * 4;
      pixels.data[i] = 68;
      pixels.data[i + 1] = 76;
      pixels.data[i + 2] = 72;
      pixels.data[i + 3] = Math.round(alpha * 255);
    }
  context.putImageData(pixels, 0, 0);
}
