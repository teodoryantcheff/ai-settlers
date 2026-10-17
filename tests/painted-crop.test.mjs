import test from 'node:test';
import assert from 'node:assert/strict';
import { scanPaintedCrop } from '../src/rendering/painted-crop.ts';

/** An RGBA sheet whose listed pixels carry the given alpha; everything else is clear. */
function sheet(width, height, pixels) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, alpha] of pixels) rgba[(y * width + x) * 4 + 3] = alpha;
  return rgba;
}

test('the crop keeps visible pixels plus two pixels of transparent padding', () => {
  const rgba = sheet(40, 30, [
    [12, 9, 255],
    [20, 15, 4],
    [25, 5, 3], // at or below the threshold counts as empty padding
  ]);
  assert.deepEqual(
    scanPaintedCrop({ data: rgba, width: 40, height: 30 }, { x: 5, y: 2, w: 30, h: 25 }),
    {
      x: 10,
      y: 7,
      w: 13,
      h: 11,
    },
  );
});

test('padding is clamped to the authored region', () => {
  const rgba = sheet(20, 20, [
    [4, 4, 255],
    [10, 11, 255],
  ]);
  assert.deepEqual(
    scanPaintedCrop({ data: rgba, width: 20, height: 20 }, { x: 3, y: 4, w: 9, h: 9 }),
    {
      x: 3,
      y: 4,
      w: 9,
      h: 9,
    },
  );
});

test('regions outside the sheet, empty art and opaque backgrounds are rejected', () => {
  const rgba = sheet(10, 10, [[5, 5, 255]]);
  assert.throws(
    () => scanPaintedCrop({ data: rgba, width: 10, height: 10 }, { x: 2, y: 2, w: 9, h: 4 }),
    /Artwork crop exceeds its sheet/,
  );
  assert.throws(
    () => scanPaintedCrop({ data: rgba, width: 10, height: 10 }, { x: 0, y: 0, w: 4, h: 4 }),
    /no visible pixels/,
  );
  const opaque = sheet(
    4,
    4,
    Array.from({ length: 16 }, (_, i) => [i % 4, i >> 2, 255]),
  );
  assert.throws(
    () => scanPaintedCrop({ data: opaque, width: 4, height: 4 }, { x: 0, y: 0, w: 4, h: 4 }),
    /requires a transparent background/,
  );
});
