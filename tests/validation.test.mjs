import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
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
const step = (name, code) => ({ name, command: process.execPath, args: ['-e', code] });

test('validation waits for each command and retains stdout, stderr and summary', async (t) => {
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
      ),
    ],
    context,
  );
  const summary = JSON.parse(await fs.readFile(path.join(context.logDirectory, 'summary.json')));
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

test('a real failing assertion is printed and prevents the next command', async (t) => {
  const context = await workspace(t);
  await assert.rejects(
    runSteps(
      [
        step('assertion', `require('node:assert/strict').equal(1, 2, 'cargo mismatch')`),
        step('publish', `require('node:fs').writeFileSync('published', 'bad')`),
      ],
      context,
    ),
    /remaining steps were not run/,
  );
  await assert.rejects(fs.access(path.join(context.directory, 'published')));
  assert.match(context.text(), /AssertionError/);
  assert.match(context.text(), /cargo mismatch/);
  assert.match(context.text(), /Full log:/);
  const summary = JSON.parse(await fs.readFile(path.join(context.logDirectory, 'summary.json')));
  assert.equal(summary.complete, false);
  assert.equal(summary.results.length, 1);
  assert.equal(summary.results[0].passed, false);
});

test('launch failures and terminated commands fail validation', async (t) => {
  for (const first of [
    { name: 'missing', command: '/nonexistent/settlers-validation-command', args: [] },
    step('terminated', `process.kill(process.pid, 'SIGTERM')`),
  ]) {
    const context = await workspace(t);
    await assert.rejects(
      runSteps(
        [first, step('publish', `require('node:fs').writeFileSync('published', 'bad')`)],
        context,
      ),
      /Validation stopped/,
    );
    await assert.rejects(fs.access(path.join(context.directory, 'published')));
    assert.match(context.text(), /FAIL/);
    const summary = JSON.parse(await fs.readFile(path.join(context.logDirectory, 'summary.json')));
    assert.equal(summary.results[0].passed, false);
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
    /Validation stopped/,
  );
  const summary = JSON.parse(await fs.readFile(path.join(context.logDirectory, 'summary.json')));
  assert.ok((await fs.stat(summary.results[0].log)).size > 40000);
  assert.ok(context.text().length < 18000);
  assert.match(context.text(), /timeout detail/);
  assert.match(context.text(), /Earlier output retained/);
});

test('the full plan includes every Node test before build and single-worker browsers', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const plan = await validationSteps(root);
  const files = (await fs.readdir(path.join(root, 'tests')))
    .filter((name) => /\.test\.(cjs|mjs)$/.test(name))
    .sort();
  assert.deepEqual(
    plan.map((entry) => entry.name),
    ['format', 'typecheck', ...files, 'build', 'browser'],
  );
  assert.ok(plan.at(-1).args.includes('--workers=1'));
  for (const entry of plan.filter((entry) => files.includes(entry.name)))
    assert.deepEqual(entry.args, ['--test-reporter=spec', path.join('tests', entry.name)]);
  assert.deepEqual(
    (await validationSteps(root, { nodeOnly: true })).map((entry) => entry.name),
    ['typecheck', ...files],
  );
  const { scripts } = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
  assert.equal(scripts.check, 'node scripts/validate.mjs');
  assert.equal(scripts['build:pages'], 'npm run build && node scripts/package-pages.mjs');
  assert.match(scripts.deploy, /^npm test && npm run build:pages && wrangler pages deploy /);
});

test('pull-request CI validates on the supported Node and never publishes', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const workflow = await fs.readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const { engines } = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
  assert.match(workflow, /^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]\n/m);
  assert.equal(`>=${workflow.match(/node-version: '([\d.]+)'/)[1]}`, engines.node);
  const commands = [...workflow.matchAll(/^ +run: (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(commands, ['npm ci', 'npm run format:check', 'npm test']);
  assert.match(workflow, /if: failure\(\)\n(?: {8}.+\n)*? {8}uses: actions\/upload-artifact@/);
  assert.match(workflow, /^ {10}path: output\/validation\/$/m);
  assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
  assert.doesNotMatch(workflow, /secrets[.:]|deploy|wrangler|build:pages|CLOUDFLARE/i);
});
