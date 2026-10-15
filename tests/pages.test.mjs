import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { packagePages } from '../scripts/package-pages.mjs';

test('Pages packaging isolates production files and fingerprints code and all artwork', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'settlers-pages-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'assets/art/reference'), { recursive: true });
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.writeFile(path.join(root, 'index.html'), '<script src="game.min.js?v=old"></script>');
  await fs.writeFile(path.join(root, 'game.min.js'), 'release');
  await fs.writeFile(path.join(root, 'game.test.js'), 'development');
  await fs.writeFile(path.join(root, 'assets/art/manifest.json'), '{}');
  await fs.writeFile(path.join(root, 'assets/art/reference/concept.png'), 'reference');
  await fs.writeFile(path.join(root, 'scripts/pages-headers.txt'), '/releases/*\n');

  const release = await packagePages(root);
  const output = path.join(root, 'dist');
  assert.deepEqual((await fs.readdir(output)).sort(), [
    '404.html',
    '_headers',
    'index.html',
    'releases',
  ]);
  assert.equal(
    await fs.readFile(path.join(output, 'index.html'), 'utf8'),
    `<script src="${release}/game.min.js"></script>`,
  );
  assert.equal(
    await fs.readFile(path.join(output, release, 'assets/art/reference/concept.png'), 'utf8'),
    'reference',
  );
  await fs.writeFile(path.join(output, 'stale.js'), 'stale');
  assert.equal(await packagePages(root), release);
  await assert.rejects(fs.access(path.join(output, 'stale.js')));
  await fs.writeFile(path.join(root, 'assets/art/manifest.json'), '{"version":2}');
  const changedArt = await packagePages(root);
  assert.notEqual(changedArt, release);
  await assert.rejects(fs.access(path.join(output, release)));
  await fs.writeFile(path.join(root, 'game.min.js'), 'updated release');
  assert.notEqual(await packagePages(root), changedArt);
  await fs.writeFile(path.join(root, 'index.html'), '<script src="wrong.js"></script>');
  await assert.rejects(packagePages(root), /Release script not found/);
  await fs.access(path.join(output, 'index.html'));
});
