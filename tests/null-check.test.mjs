import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { nullCheck } from '../scripts/null-check.mjs';
import { runSteps, validationSteps } from '../scripts/validate.mjs';

const root = path.resolve(import.meta.dirname, '..');

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

/** Run npm test's gate command and logger against an isolated project. */
async function validation(t, files, exclusions) {
  const directory = await project(t, files);
  await fs.mkdir(path.join(directory, 'scripts'));
  await fs.copyFile(
    path.join(root, 'scripts/null-check.mjs'),
    path.join(directory, 'scripts/null-check.mjs'),
  );
  await fs.writeFile(
    path.join(directory, 'scripts/null-check-exclusions.json'),
    JSON.stringify(exclusions),
  );
  await fs.symlink(
    path.join(root, 'node_modules'),
    path.join(directory, 'node_modules'),
    'junction',
  );
  const gate = (await validationSteps(root, { nodeOnly: true })).find(
    (step) => step.name === 'null-check',
  );
  assert.ok(gate, 'npm test must include the null-check gate');
  const logDirectory = path.join(directory, 'logs');
  let output = '';
  return {
    directory,
    logDirectory,
    run: () =>
      runSteps(
        [
          gate,
          {
            name: 'later-step',
            command: process.execPath,
            args: ['-e', "require('node:fs').writeFileSync('later-step-ran', 'yes')"],
          },
        ],
        { directory, logDirectory, output: { write: (chunk) => (output += chunk) } },
      ),
    output: () => output,
  };
}

test('npm test gate stops on new null errors and retains the diagnostic log', async (t) => {
  const context = await validation(
    t,
    { 'legacy.ts': nullError, 'fresh.ts': 'export function size(): number { return null; }\n' },
    ['src/legacy.ts'],
  );
  await assert.rejects(context.run(), /Validation stopped at null-check/);
  await assert.rejects(fs.access(path.join(context.directory, 'later-step-ran')));
  const summary = JSON.parse(await fs.readFile(path.join(context.logDirectory, 'summary.json')));
  assert.equal(summary.complete, false);
  assert.equal(summary.passed, false);
  assert.equal(summary.results.length, 1);
  assert.equal(summary.results[0].name, 'null-check');
  assert.equal(summary.results[0].code, 1);
  assert.equal(summary.results[0].passed, false);
  const diagnostic = /src\/fresh\.ts\(1,\d+\): error TS\d+: .*null/;
  assert.match(await fs.readFile(summary.results[0].log, 'utf8'), diagnostic);
  assert.match(context.output(), diagnostic);
});

test('npm test gate requires fixed files to leave the exclusions before validation continues', async (t) => {
  const context = await validation(t, { 'legacy.ts': nullError, 'fixed.ts': clean }, [
    'src/legacy.ts',
    'src/fixed.ts',
  ]);
  await assert.rejects(context.run(), /Validation stopped at null-check/);
  await assert.rejects(fs.access(path.join(context.directory, 'later-step-ran')));
  const summary = JSON.parse(await fs.readFile(path.join(context.logDirectory, 'summary.json')));
  const diagnostic = /src\/fixed\.ts has no strict null check errors.*remove it/;
  assert.match(await fs.readFile(summary.results[0].log, 'utf8'), diagnostic);
  assert.match(context.output(), diagnostic);

  await fs.writeFile(
    path.join(context.directory, 'scripts/null-check-exclusions.json'),
    JSON.stringify(['src/legacy.ts']),
  );
  await context.run();
  assert.equal(await fs.readFile(path.join(context.directory, 'later-step-ran'), 'utf8'), 'yes');
  const passed = JSON.parse(await fs.readFile(path.join(context.logDirectory, 'summary.json')));
  assert.equal(passed.complete, true);
  assert.equal(passed.passed, true);
  assert.ok(passed.results[0].durationMs > 0);
  assert.match(
    await fs.readFile(passed.results[0].log, 'utf8'),
    /Strict null checks pass outside the exclusion list/,
  );
});
