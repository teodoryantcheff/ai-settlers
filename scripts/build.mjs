import fs from 'node:fs/promises';
import path from 'node:path';
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
  // Coverage runs map browser V8 coverage back to `src/` through linked source maps.
  sourcemap: process.env.SETTLERS_SOURCEMAP ? 'linked' : false,
};
// Development scenarios live in a separate bundle and page, never in the release asset.
await Promise.all([
  build({ ...common, outfile: path.join(root, 'game.min.js'), minify: true }),
  build({
    ...common,
    entryPoints: [path.join(root, 'src/dev/main.ts')],
    outfile: path.join(root, 'game.test.js'),
  }),
]);
// The tracked index.html is never rewritten; releases get content-hashed paths from
// package-pages. The generated test page cache-busts its development bundle.
const revision = createHash('sha256')
  .update(await fs.readFile(path.join(root, 'game.test.js')))
  .digest('hex')
  .slice(0, 12);
const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
if (!html.includes('src="game.min.js"')) throw new Error('Release script not found in index.html.');
await fs.writeFile(
  path.join(root, 'tests/game.html'),
  html.replace('src="game.min.js"', 'src="../game.test.js?v=' + revision + '"'),
);
const size = (await fs.stat(path.join(root, 'game.min.js'))).size;
console.log(`Built release and development bundles (${size} bytes minified).`);
