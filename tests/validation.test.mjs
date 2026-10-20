import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { runSteps, validationSteps } from '../scripts/validate.mjs';

async function workspace(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'settlers-validation-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let text = '';
  return {
    directory,
    logDirectory: path.join(directory, 'logs'),
    output: { write: (chunk) => (text += chunk) },
    text: () => text,
  };
}
const step = (name, code, after = []) => ({
  name,
  command: process.execPath,
  args: ['-e', code],
  after,
});
const summaryOf = async (context) =>
  JSON.parse(await fs.readFile(path.join(context.logDirectory, 'summary.json')));

test('a step waits for the steps it names; logs retain stdout, stderr and a summary', async (t) => {
  const context = await workspace(t);
  await runSteps(
    [
      step(
        'first',
        `setTimeout(() => {
          require('node:fs').writeFileSync('ready', 'yes');
          console.log('stdout evidence');
          console.error('stderr evidence');
        }, 80);`,
      ),
      step(
        'second',
        `require('node:assert/strict').equal(require('node:fs').readFileSync('ready', 'utf8'), 'yes')`,
        ['first'],
      ),
    ],
    context,
  );
  const summary = await summaryOf(context);
  assert.equal(summary.complete, true);
  assert.deepEqual(
    summary.results.map((entry) => entry.passed),
    [true, true],
  );
  const log = await fs.readFile(summary.results[0].log, 'utf8');
  assert.match(log, /stdout evidence/);
  assert.match(log, /stderr evidence/);
  assert.match(context.text(), /Validation passed/);
});

test('independent steps run concurrently', async (t) => {
  const context = await workspace(t);
  // Each step waits for the other's marker, so serial execution would deadlock.
  const meet = (mine, theirs) => `
    const fs = require('node:fs');
    fs.writeFileSync('${mine}', '');
    const until = Date.now() + 5000;
    (function poll() {
      if (fs.existsSync('${theirs}')) return;
      if (Date.now() > until) process.exit(1);
      setTimeout(poll, 10);
    })();`;
  await runSteps([step('a', meet('a', 'b')), step('b', meet('b', 'a'))], context);
  assert.equal((await summaryOf(context)).passed, true);
});

test('every failure is reported; dependents are skipped and independent steps still run', async (t) => {
  const context = await workspace(t);
  await assert.rejects(
    runSteps(
      [
        step('assertion', `require('node:assert/strict').equal(1, 2, 'cargo mismatch')`),
        step('publish', `require('node:fs').writeFileSync('published', 'bad')`, ['assertion']),
        step('lint', `console.error('lint finding'); process.exitCode = 1`),
        step('types', `require('node:fs').writeFileSync('typed', 'yes')`),
      ],
      context,
    ),
    /Validation failed: assertion, publish, lint/,
  );
  await assert.rejects(fs.access(path.join(context.directory, 'published')));
  assert.equal(await fs.readFile(path.join(context.directory, 'typed'), 'utf8'), 'yes');
  assert.match(context.text(), /cargo mismatch/);
  assert.match(context.text(), /lint finding/);
  assert.match(context.text(), /SKIP publish/);
  assert.match(context.text(), /Full log:/);
  const summary = await summaryOf(context);
  assert.equal(summary.complete, false);
  assert.equal(summary.passed, false);
  assert.deepEqual(
    summary.results.map((entry) => [entry.name, entry.passed]),
    [
      ['assertion', false],
      ['lint', false],
      ['types', true],
    ],
  );
});

test('launch failures and terminated commands fail and skip their dependents', async (t) => {
  for (const first of [
    { name: 'missing', command: '/nonexistent/settlers-validation-command', args: [] },
    step('terminated', `process.kill(process.pid, 'SIGTERM')`),
  ]) {
    const context = await workspace(t);
    await assert.rejects(
      runSteps(
        [
          first,
          step('publish', `require('node:fs').writeFileSync('published', 'bad')`, [first.name]),
        ],
        context,
      ),
      /Validation failed/,
    );
    await assert.rejects(fs.access(path.join(context.directory, 'published')));
    assert.match(context.text(), /FAIL/);
    assert.equal((await summaryOf(context)).results[0].passed, false);
  }
});

test('failure summaries stay bounded while the full diagnostic log is retained', async (t) => {
  const context = await workspace(t);
  await assert.rejects(
    runSteps(
      [
        step(
          'verbose',
          `console.log('x'.repeat(40000)); console.error('timeout detail'); process.exitCode = 1;`,
        ),
      ],
      context,
    ),
    /Validation failed/,
  );
  const summary = await summaryOf(context);
  assert.ok((await fs.stat(summary.results[0].log)).size > 40000);
  assert.ok(context.text().length < 18000);
  assert.match(context.text(), /timeout detail/);
  assert.match(context.text(), /Earlier output retained/);
});

test('the full plan runs every routine Node test file and browsers after the build, never soak', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const plan = await validationSteps(root);
  const files = (await fs.readdir(path.join(root, 'tests')))
    .filter((name) => /\.test\.(cjs|mjs)$/.test(name))
    .sort()
    .map((name) => path.join('tests', name));
  assert.deepEqual(
    plan.map((entry) => entry.name),
    ['format', 'lint', 'typecheck', 'node-tests', 'build', 'browser'],
  );
  const byName = Object.fromEntries(plan.map((entry) => [entry.name, entry]));
  assert.deepEqual(byName.browser.after, ['build']);
  assert.deepEqual(byName['node-tests'].args.slice(-files.length), files);
  assert.ok(!plan.some((entry) => entry.args.some((arg) => arg.includes('soak'))));
  assert.deepEqual(
    (await validationSteps(root, { nodeOnly: true })).map((entry) => entry.name),
    ['lint', 'typecheck', 'node-tests'],
  );
  const [soak] = await validationSteps(root, { soakOnly: true });
  assert.ok(soak.args.includes(path.join('tests', 'soak', 'economy-autoplay.test.cjs')));
});

test('pull-request CI validates on the supported Node and never publishes', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const workflow = await fs.readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const { engines } = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
  assert.equal(`>=${workflow.match(/node-version: '([\d.]+)'/)[1]}`, engines.node);
  assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
  assert.doesNotMatch(workflow, /secrets[.:]|deploy|wrangler|build:pages|CLOUDFLARE/i);
});

test('focused validation keeps lint and types and selects exact routine files once', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const plan = await validationSteps(root, {
    nodeOnly: true,
    files: [
      'tests/validation.test.mjs',
      path.join(root, 'tests/typecheck.test.mjs'),
      'tests/validation.test.mjs',
    ],
  });
  assert.deepEqual(
    plan.map((entry) => entry.name),
    ['lint', 'typecheck', 'node-tests'],
  );
  assert.deepEqual(plan.at(-1).args.slice(-2), [
    path.join('tests', 'typecheck.test.mjs'),
    path.join('tests', 'validation.test.mjs'),
  ]);
});

test('focused validation rejects unknown or non-routine files and incompatible modes', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  for (const file of [
    '',
    'tests/missing.test.mjs',
    'tests/*.test.mjs',
    'tests/helpers/game.cjs',
    'tests/browser/pixi.spec.mjs',
    'tests/soak/economy-autoplay.test.cjs',
    'scripts/validate.mjs',
    '../validation.test.mjs',
  ]) {
    await assert.rejects(
      validationSteps(root, { nodeOnly: true, files: ['tests/validation.test.mjs', file] }),
      /Not a routine Node test file/,
    );
  }
  for (const options of [{}, { soakOnly: true }])
    await assert.rejects(
      validationSteps(root, { ...options, files: ['tests/validation.test.mjs'] }),
      /--file requires --node-tests/,
    );
  await assert.rejects(
    validationSteps(root, { nodeOnly: true, soakOnly: true }),
    /mutually exclusive/,
  );
});

test('the CLI rejects malformed options before starting validation', () => {
  const script = path.resolve(import.meta.dirname, '../scripts/validate.mjs');
  for (const args of [
    ['--node-tests', '--file'],
    ['--node-tests', '--unknown'],
    ['--node-tests', 'tests/validation.test.mjs'],
    ['--node-tests', '--soak'],
    ['--file', 'tests/validation.test.mjs'],
    ['--node-tests', '--file='],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.doesNotMatch(result.stdout, /Validation logs:/);
    assert.match(
      result.stderr,
      /--file|--unknown|Unexpected argument|mutually exclusive|Not a routine Node test file/,
    );
  }
});
