import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { paintedRegions, scanPaintedCrop } from '../src/rendering/painted-crop.ts';

const root = path.resolve(import.meta.dirname, '..');

/**
 * Decode a non-interlaced 8-bit RGBA PNG, the only format painted sprite sheets
 * use. Anything else is rejected rather than guessed at; `boot.spec` re-checks the
 * resulting crops against the browser's own decoder.
 */
export function decodeRGBA(buffer, name = 'image') {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error(name + ' is not a PNG.');
  let offset = 8;
  let width = 0;
  let height = 0;
  const compressed = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, color, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || color !== 6 || interlace !== 0)
        throw new Error(name + ' must be a non-interlaced 8-bit RGBA PNG.');
    } else if (type === 'IDAT') compressed.push(body);
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed));
  const stride = width * 4;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? data[row + i - 4] : 0;
      const b = y ? data[row - stride + i] : 0;
      const c = y && i >= 4 ? data[row - stride + i - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(name + ' has an unknown PNG filter.');
      data[row + i] = (raw[source + i] + predictor) & 255;
    }
  }
  return { data, width, height };
}

/**
 * Recompute each region's `crop` from its sheet and write the manifest. Failures
 * reject before anything is written; the write itself is an atomic rename.
 */
export async function cropPack(directory = path.join(root, 'assets/art')) {
  const file = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  const sheets = new Map();
  for (const [name, region] of paintedRegions(manifest)) {
    const sheetFile = manifest.sheets?.[region.sheet];
    if (typeof sheetFile !== 'string') throw new Error(name + ': unknown sheet ' + region.sheet);
    if (!sheets.has(sheetFile))
      sheets.set(
        sheetFile,
        decodeRGBA(await fs.readFile(path.join(directory, sheetFile)), sheetFile),
      );
    const sheet = sheets.get(sheetFile);
    try {
      region.crop = scanPaintedCrop(sheet, region);
    } catch (error) {
      throw new Error(name + ': ' + error.message, { cause: error });
    }
  }
  const temporary = file + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n');
  await fs.rename(temporary, file);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await cropPack(process.argv[2] && path.resolve(process.argv[2]));
    console.log('Painted art crops written to the manifest.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
