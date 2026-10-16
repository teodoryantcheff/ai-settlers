import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const config = path.join(root, '.oxlintrc.json');

function lint(...targets) {
  const result = spawnSync(
    process.execPath,
    ['node_modules/oxlint/bin/oxlint', '-c', config, '-f', 'unix', ...targets],
    { cwd: root, encoding: 'utf8' },
  );
  return { status: result.status, output: result.stdout + result.stderr };
}

test('declaration rules apply as errors without per-file overrides', async () => {
  const settings = JSON.parse(await fs.readFile(config, 'utf8'));
  for (const rule of ['no-var', 'prefer-const']) {
    assert.equal(settings.rules[rule], 'error', `${rule} must remain an error`);
    for (const override of settings.overrides ?? [])
      assert.equal(
        Object.hasOwn(override.rules ?? {}, rule),
        false,
        `${rule} must have no per-file override`,
      );
  }
});

for (const [name, source, rule] of [
  ['var declarations', 'export function same(a: unknown) { var b = a; return b === 1; }', 'no-var'],
  [
    'unreassigned let bindings',
    'export function same(a: unknown) { let b = a; return b === 1; }',
    'prefer-const',
  ],
  ['loose equality', 'export function same(a: unknown) { const b = a; return b == 1; }', 'eqeqeq'],
]) {
  test(`${name} fail lint independently`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'settlers-lint-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'fresh.ts');
    await fs.writeFile(file, source + '\n');
    const { status, output } = lint(file);
    assert.equal(status, 1, output);
    assert.deepEqual(
      [...output.matchAll(/\((no-var|prefer-const|eqeqeq)\)/g)].map((match) => match[1]),
      [rule],
      output,
    );
  });
}

test('const bindings with strict equality pass lint', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'settlers-lint-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'fresh.ts');
  await fs.writeFile(file, 'export function same(a: unknown) { const b = a; return b === 1; }\n');
  const { status, output } = lint(file);
  assert.equal(status, 0, output);
});
