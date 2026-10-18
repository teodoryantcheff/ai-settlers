import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { paintedRegions } from '../src/rendering/painted-crop.ts';
import { createHash } from 'node:crypto';
import { cropPack, decodeRGBA } from '../scripts/crop-pack.mjs';

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

// Original manifest crops before the lossless split in #69. Keep this independent
// of the active manifest so a shifted or truncated extraction cannot pass.
const originalCrops = [
  ['buildings.hq', 'buildings.png', [30, 45, 303, 291]],
  ['buildings.warehouse', 'buildings.png', [348, 75, 280, 256]],
  ['buildings.lumberjack', 'buildings.png', [644, 94, 285, 241]],
  ['buildings.forester', 'buildings.png', [964, 96, 262, 238]],
  ['buildings.sawmill', 'buildings.png', [26, 367, 312, 262]],
  ['buildings.quarry', 'buildings.png', [350, 363, 280, 268]],
  ['buildings.fisherman', 'buildings.png', [652, 362, 267, 268]],
  ['buildings.farm', 'buildings.png', [937, 387, 304, 252]],
  ['buildings.mine_coal', 'buildings.png', [23, 675, 295, 250]],
  ['buildings.mine_iron', 'buildings.png', [337, 677, 293, 249]],
  ['buildings.mine_gold', 'buildings.png', [637, 681, 296, 239]],
  ['buildings.toolsmith', 'buildings.png', [948, 664, 282, 273]],
  ['buildings.armory', 'buildings.png', [34, 948, 290, 264]],
  ['buildings.guard', 'buildings.png', [354, 949, 237, 269]],
  ['site', 'buildings.png', [634, 976, 287, 235]],
  ['trees.0', 'foliage.png', [13, 43, 381, 422]],
  ['trees.1', 'foliage.png', [397, 66, 377, 392]],
  ['trees.2', 'foliage.png', [775, 16, 312, 449]],
  ['rocks.0', 'foliage.png', [27, 808, 342, 243]],
  ['rocks.1', 'foliage.png', [422, 825, 307, 218]],
  ['mountains.dry.0', 'mountains.png', [19, 42, 493, 462]],
  ['mountains.dry.1', 'mountains.png', [530, 80, 494, 428]],
  ['mountains.dry.2', 'mountains.png', [1024, 112, 498, 397]],
  ['mountains.snowy.0', 'mountains.png', [12, 512, 500, 469]],
  ['mountains.snowy.1', 'mountains.png', [512, 513, 512, 466]],
  ['mountains.foothill', 'mountains.png', [1024, 607, 500, 366]],
];
const originalHashes = {
  'buildings.png': '7d54f7460fa42fd0e59cd8a8580df7d1343fa5f464a7c9126859003c89ed56eb',
  'foliage.png': 'a9e108c25cab17a4482951b6a9a3b5c8de08fef8957eaa510e8d833ceb292581',
  'mountains.png': '54be40d596bd2c0e01df5d79fe0e746f0b004ef997759a5d187d0326348d300e',
};

test('supplied painted pack uses individual PNGs with the exact original crop pixels', async () => {
  const art = new URL('../assets/art/', import.meta.url);
  const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', art), 'utf8'));
  const regions = new Map(paintedRegions(manifest));
  assert.equal(regions.size, 34);
  assert.equal(Object.keys(manifest.sheets).length, 35);
  const files = [...regions.values()].map((region) => manifest.sheets[region.sheet]);
  files.push(manifest.sheets[manifest.terrain.sheet]);
  assert.equal(new Set(files).size, 35, 'every active asset has its own source');
  assert.deepEqual(new Set(files), new Set(Object.values(manifest.sheets)));
  assert.ok(files.every((file) => file.endsWith('.png') && !file.includes('/')));
  const originals = new Map();
  for (const [file, hash] of Object.entries(originalHashes)) {
    const bytes = await fs.readFile(new URL('source/' + file, art));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, file);
    originals.set(file, decodeRGBA(bytes, file));
    assert.ok(!files.includes(file), file + ' is source-only');
  }
  for (const [name, file, [x, y, w, h]] of originalCrops) {
    const region = regions.get(name);
    const activeFile = manifest.sheets[region.sheet];
    const image = decodeRGBA(await fs.readFile(new URL(activeFile, art)), activeFile);
    assert.deepEqual([image.width, image.height], [w, h], name);
    assert.deepEqual(
      region,
      { sheet: region.sheet, x: 0, y: 0, w, h, crop: { x: 0, y: 0, w, h } },
      name,
    );
    const original = originals.get(file);
    for (let row = 0; row < h; row++)
      assert.deepEqual(
        image.data.subarray(row * w * 4, (row + 1) * w * 4),
        original.data.subarray(
          ((y + row) * original.width + x) * 4,
          ((y + row) * original.width + x + w) * 4,
        ),
        name + ' row ' + row,
      );
  }
});
