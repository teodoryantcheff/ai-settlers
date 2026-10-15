import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const common = {
  entryPoints: [path.join(root, 'src/main.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  legalComments: 'none',
  logLevel: 'warning',
};
await build({ ...common, outfile: path.join(root, 'game.min.js'), minify: true });
// Development scenarios live in a separate bundle and page, never in the release asset.
await build({
  ...common,
  entryPoints: [path.join(root, 'src/dev/main.ts')],
  outfile: path.join(root, 'game.test.js'),
});
const revision = createHash('sha256')
  .update(await fs.readFile(path.join(root, 'game.min.js')))
  .digest('hex')
  .slice(0, 12);
const html = (await fs.readFile(path.join(root, 'index.html'), 'utf8')).replace(
  /src="game\.min\.js(?:\?[^"]*)?"/,
  'src="game.min.js?v=' + revision + '"',
);
await fs.writeFile(path.join(root, 'index.html'), html);
await fs.writeFile(
  path.join(root, 'tests/game.html'),
  html.replace(/src="game\.min\.js[^"]*"/, 'src="../game.test.js?v=' + revision + '"'),
);
const bytes = await fs.readFile(path.join(root, 'game.min.js'));
await fs.writeFile(path.join(root, 'game.min.js.gz'), zlib.gzipSync(bytes, { level: 9 }));
await fs.writeFile(
  path.join(root, 'game.min.js.br'),
  zlib.brotliCompressSync(bytes, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }),
);
const size = (await fs.stat(path.join(root, 'game.min.js'))).size;
console.log(`Built release and development bundles (${size} bytes minified).`);
