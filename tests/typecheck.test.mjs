import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runSteps, validationSteps } from '../scripts/validate.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('the main typecheck rejects null errors, retains diagnostics and accepts guarded access', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'settlers-typecheck-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(directory, 'tsconfig.json'),
    JSON.stringify({ extends: path.join(root, 'tsconfig.json'), include: ['src/**/*.ts'] }),
  );
  await fs.mkdir(path.join(directory, 'src'));
  await fs.writeFile(
    path.join(directory, 'src', 'nullable.ts'),
    'export function size(): number { return null; }\n',
  );
  await fs.writeFile(
    path.join(directory, 'src', 'element.ts'),
    'export const width = document.getElementById("map").clientWidth;\n',
  );
  await fs.symlink(
    path.join(root, 'node_modules'),
    path.join(directory, 'node_modules'),
    'junction',
  );
  const typecheck = (await validationSteps(root, { nodeOnly: true })).find(
    (step) => step.name === 'typecheck',
  );
  assert.ok(typecheck);
  const logDirectory = path.join(directory, 'logs');
  let output = '';
  const run = () =>
    runSteps(
      [
        typecheck,
        {
          name: 'later-step',
          command: process.execPath,
          args: ['-e', "require('node:fs').writeFileSync('later-step-ran', 'yes')"],
        },
      ],
      { directory, logDirectory, output: { write: (chunk) => (output += chunk) } },
    );

  await assert.rejects(run(), /Validation stopped at typecheck/);
  await assert.rejects(fs.access(path.join(directory, 'later-step-ran')));
  const summary = JSON.parse(await fs.readFile(path.join(logDirectory, 'summary.json')));
  assert.equal(summary.complete, false);
  assert.equal(summary.passed, false);
  assert.equal(summary.results.length, 1);
  assert.equal(summary.results[0].name, 'typecheck');
  assert.equal(summary.results[0].passed, false);
  const log = await fs.readFile(summary.results[0].log, 'utf8');
  for (const file of ['nullable', 'element']) {
    const diagnostic = new RegExp(`src/${file}\\.ts\\(1,\\d+\\): error TS\\d+: .*null`);
    assert.match(log, diagnostic);
    assert.match(output, diagnostic);
  }

  await fs.writeFile(
    path.join(directory, 'src', 'nullable.ts'),
    'export function size(value: number | null): number { return value ?? 0; }\n',
  );
  await fs.writeFile(
    path.join(directory, 'src', 'element.ts'),
    'export const width = document.getElementById("map")?.clientWidth ?? 0;\n',
  );
  await run();
  assert.equal(await fs.readFile(path.join(directory, 'later-step-ran'), 'utf8'), 'yes');
  const passed = JSON.parse(await fs.readFile(path.join(logDirectory, 'summary.json')));
  assert.equal(passed.complete, true);
  assert.equal(passed.passed, true);
});
