import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { cropPack } from '../scripts/crop-pack.mjs';

/** Encode RGBA rows as a PNG, cycling through every scanline filter. */
function png(width, height, pixel) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 4);
    for (let x = 0; x < width; x++) row.set(pixel(x, y), x * 4);
    rows.push(row);
  }
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  rows.forEach((row, y) => {
    const filter = y % 5;
    const up = rows[y - 1] ?? Buffer.alloc(row.length);
    const offset = y * (row.length + 1);
    raw[offset] = filter;
    for (let i = 0; i < row.length; i++) {
      const a = i >= 4 ? row[i - 4] : 0;
      const c = i >= 4 ? up[i - 4] : 0;
      const predictor = [0, a, up[i], (a + up[i]) >> 1, paeth(a, up[i], c)][filter];
      raw[offset + 1 + i] = (row[i] - predictor) & 255;
    }
  });
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    // The decoder does not verify CRCs; browsers do, but tests never load these.
    return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function pack(manifest, pixel) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'crop-pack-'));
  await fs.writeFile(path.join(directory, 'sprites.png'), png(24, 16, pixel));
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  return directory;
}

test('crop-pack writes each region crop into the manifest', async (t) => {
  const manifest = {
    version: 1,
    sheets: { sprites: 'sprites.png' },
    site: { sheet: 'sprites', x: 0, y: 0, w: 12, h: 16 },
    trees: [{ sheet: 'sprites', x: 12, y: 0, w: 12, h: 16, crop: { x: 0, y: 0, w: 1, h: 1 } }],
  };
  // A soft blob at (5..6, 7..9) in the site cell, a stem at (18, 3..12) in the tree cell.
  const directory = await pack(manifest, (x, y) =>
    (x >= 5 && x <= 6 && y >= 7 && y <= 9) || (x === 18 && y >= 3 && y <= 12)
      ? [90, 120 + x, 40 + y, 200]
      : [x * 9, y * 13, 77, 3],
  );
  t.after(() => fs.rm(directory, { recursive: true }));
  await cropPack(directory);
  const written = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.deepEqual(written.site, { ...manifest.site, crop: { x: 3, y: 5, w: 6, h: 7 } });
  assert.deepEqual(written.trees[0].crop, { x: 16, y: 1, w: 5, h: 14 });
  assert.deepEqual(written.sheets, manifest.sheets);
  assert.deepEqual(await fs.readdir(directory), ['manifest.json', 'sprites.png']);
});

test('crop-pack fails on unusable art and leaves the manifest untouched', async (t) => {
  const manifest = {
    version: 1,
    sheets: { sprites: 'sprites.png' },
    rocks: [
      { sheet: 'sprites', x: 0, y: 0, w: 4, h: 4 },
      { sheet: 'sprites', x: 4, y: 0, w: 4, h: 4 },
    ],
  };
  const directory = await pack(manifest, (x) => [0, 0, 0, x < 4 ? 255 : 0]);
  t.after(() => fs.rm(directory, { recursive: true }));
  const before = await fs.readFile(path.join(directory, 'manifest.json'), 'utf8');
  await assert.rejects(cropPack(directory), /rocks\.0: Artwork sprite requires a transparent/);
  assert.equal(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'), before);
});
