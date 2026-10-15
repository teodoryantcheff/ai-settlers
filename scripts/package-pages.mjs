import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function packagePages(root) {
  const files = ['game.min.js'];
  async function collect(directory) {
    for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
      const name = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) await collect(name);
      else if (entry.isFile()) files.push(name);
      else throw new Error(`Unsupported deployment asset: ${name}`);
    }
  }
  await collect('assets/art');
  files.sort();
  if (files.length + 3 > 20000) throw new Error('Pages file count limit exceeded.');
  const hash = createHash('sha256');
  for (const name of files) {
    const bytes = await fs.readFile(path.join(root, name));
    if (bytes.length > 25 * 1024 * 1024) throw new Error(`Pages asset exceeds 25 MiB: ${name}`);
    hash.update(name).update('\0').update(bytes).update('\0');
  }
  const release = `releases/${hash.digest('hex').slice(0, 16)}`;
  const source = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  if (!/src="game\.min\.js(?:\?[^"]*)?"/.test(source)) {
    throw new Error('Release script not found in index.html.');
  }
  const html = source.replace(/src="game\.min\.js(?:\?[^"]*)?"/, `src="${release}/game.min.js"`);
  // dist is generated output only. Never upload the repository root.
  const output = path.join(root, 'dist');
  await fs.rm(output, { recursive: true, force: true });
  for (const name of files) {
    const destination = path.join(output, release, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(root, name), destination);
  }
  await fs.writeFile(path.join(output, 'index.html'), html);
  await fs.copyFile(path.join(root, 'scripts/pages-headers.txt'), path.join(output, '_headers'));
  await fs.writeFile(
    path.join(output, '404.html'),
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title><h1>Page not found</h1><p><a href="/">Return to the game</a></p></html>\n',
  );
  return release;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const release = await packagePages(path.resolve(import.meta.dirname, '..'));
  console.log(`Packaged Pages production site in dist/ (${release}).`);
}
