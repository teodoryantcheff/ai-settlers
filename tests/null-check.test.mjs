import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { nullCheck } from '../scripts/null-check.mjs';

/** A throwaway TypeScript project whose files are given as name → source. */
async function project(t, files) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'settlers-null-check-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(directory, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: false, noEmit: true }, include: ['src/**/*.ts'] }),
  );
  await fs.mkdir(path.join(directory, 'src'));
  for (const [name, source] of Object.entries(files))
    await fs.writeFile(path.join(directory, 'src', name), source);
  return directory;
}
const nullError = 'export const size: number = document.getElementById("map").clientWidth;\n';
const clean = 'export const size: number = 3;\n';

test('a new file with a null error fails the gate', async (t) => {
  const directory = await project(t, { 'fresh.ts': nullError, 'old.ts': clean });
  const result = nullCheck({ directory, exclusions: [] });
  assert.equal(result.passed, false);
  assert.equal(result.unexpected.length, 1);
  assert.match(result.unexpected[0], /^src\/fresh\.ts\(1,\d+\): error TS\d+: .*null/);
  assert.deepEqual(result.stale, []);
});

test('errors in excluded files pass while every excluded file still has errors', async (t) => {
  const directory = await project(t, { 'legacy.ts': nullError, 'old.ts': clean });
  assert.deepEqual(nullCheck({ directory, exclusions: ['src/legacy.ts'] }), {
    passed: true,
    unexpected: [],
    stale: [],
  });
});

test('an excluded file without null errors must leave the list', async (t) => {
  const directory = await project(t, { 'legacy.ts': nullError, 'fixed.ts': clean });
  const exclusions = ['src/legacy.ts', 'src/fixed.ts', 'src/gone.ts', 'src/legacy.ts'];
  const result = nullCheck({ directory, exclusions });
  assert.equal(result.passed, false);
  assert.deepEqual(result.unexpected, []);
  assert.deepEqual(result.stale, ['src/fixed.ts', 'src/gone.ts', 'src/legacy.ts']);
});
