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

test('the full plan includes every Node and soak test before build and single-worker browsers', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const plan = await validationSteps(root);
  const testFiles = async (directory) =>
    (await fs.readdir(path.join(root, directory)))
      .filter((name) => /\.test\.(cjs|mjs)$/.test(name))
      .sort();
  const files = await testFiles('tests');
  const soak = (await testFiles('tests/soak')).map((name) => `soak/${name}`);
  assert.ok(soak.includes('soak/economy-autoplay.test.cjs'));
  assert.deepEqual(
    plan.map((entry) => entry.name),
    ['format', 'lint', 'typecheck', ...files, ...soak, 'build', 'browser'],
  );
  assert.ok(plan.at(-1).args.includes('--workers=1'));
  for (const entry of plan.filter((entry) => [...files, ...soak].includes(entry.name)))
    assert.deepEqual(entry.args, ['--test-reporter=spec', path.join('tests', entry.name)]);
  assert.deepEqual(
    (await validationSteps(root, { nodeOnly: true })).map((entry) => entry.name),
    ['lint', 'typecheck', ...files],
  );
  assert.deepEqual(
    (await validationSteps(root, { soakOnly: true })).map((entry) => entry.name),
    soak,
  );
  assert.deepEqual(plan.find((entry) => entry.name === 'lint').args.slice(-4), [
    'src',
    'scripts',
    'tests',
    'playwright.config.mjs',
  ]);
  const { scripts } = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
  assert.equal(scripts.check, 'node scripts/validate.mjs');
  assert.equal(scripts['test:soak'], 'node scripts/validate.mjs --soak');
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
  assert.deepEqual(commands, [
    'npm ci',
    'npm run format:check',
    'npm test',
    'npm ci',
    'npm run test:soak',
  ]);
  assert.match(workflow, /if: failure\(\)\n(?: {8}.+\n)*? {8}uses: actions\/upload-artifact@/);
  assert.match(workflow, /^ {10}path: output\/validation\/$/m);
  assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
  assert.doesNotMatch(workflow, /secrets[.:]|deploy|wrangler|build:pages|CLOUDFLARE/i);
});

test('focused validation keeps lint and types, selects exact routine files and removes duplicates', async () => {
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
    ['lint', 'typecheck', 'typecheck.test.mjs', 'validation.test.mjs'],
  );
  assert.deepEqual(plan.at(-1).args, [
    '--test-reporter=spec',
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

test('focused CLI runs real checks, retains selected-test logs and stops at a failure', async (t) => {
  const root = path.resolve(import.meta.dirname, '..');
  const { directory } = await workspace(t);
  for (const name of ['scripts', 'src', 'tests']) await fs.mkdir(path.join(directory, name));
  await fs.copyFile(
    path.join(root, 'scripts/validate.mjs'),
    path.join(directory, 'scripts/validate.mjs'),
  );
  await fs.symlink(
    path.join(root, 'node_modules'),
    path.join(directory, 'node_modules'),
    'junction',
  );
  await fs.writeFile(path.join(directory, 'src/index.ts'), 'export const ready = true;\n');
  await fs.writeFile(path.join(directory, 'playwright.config.mjs'), 'export default {};\n');
  await fs.writeFile(
    path.join(directory, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { types: [] }, files: ['src/index.ts'] }),
  );
  await fs.writeFile(
    path.join(directory, 'tests/excluded.test.mjs'),
    'throw new Error("unselected test ran");\n',
  );
  await fs.writeFile(
    path.join(directory, 'tests/success.test.mjs'),
    'console.log("selected success");\n',
  );
  await fs.writeFile(
    path.join(directory, 'tests/failure.test.mjs'),
    'console.error("selected diagnostic"); process.exitCode = 1;\n',
  );
  await fs.writeFile(
    path.join(directory, 'tests/later.test.mjs'),
    'import fs from "node:fs"; fs.writeFileSync("later-ran", "bad");\n',
  );
  const run = async (files) => {
    const result = spawnSync(
      process.execPath,
      ['scripts/validate.mjs', '--node-tests', ...files.flatMap((file) => ['--file', file])],
      { cwd: directory, encoding: 'utf8', timeout: 30000 },
    );
    assert.ifError(result.error);
    const logDirectory = result.stdout.match(/Validation logs: (.+)/)?.[1];
    assert.ok(logDirectory, result.stdout + result.stderr);
    const summary = JSON.parse(await fs.readFile(path.join(logDirectory, 'summary.json')));
    return { result, summary };
  };
  const success = await run(['tests/success.test.mjs']);
  assert.equal(success.result.status, 0, success.result.stdout + success.result.stderr);
  assert.equal(success.summary.complete, true);
  assert.equal(success.summary.passed, true);
  assert.deepEqual(
    success.summary.results.map((entry) => entry.name),
    ['lint', 'typecheck', 'success.test.mjs'],
  );
  assert.match(await fs.readFile(success.summary.results.at(-1).log, 'utf8'), /selected success/);

  const failure = await run(['tests/later.test.mjs', 'tests/failure.test.mjs']);
  assert.equal(failure.result.status, 1);
  assert.equal(failure.summary.complete, false);
  assert.equal(failure.summary.passed, false);
  assert.deepEqual(
    failure.summary.results.map((entry) => entry.name),
    ['lint', 'typecheck', 'failure.test.mjs'],
  );
  assert.match(
    await fs.readFile(failure.summary.results.at(-1).log, 'utf8'),
    /selected diagnostic/,
  );
  assert.match(failure.result.stdout, /selected diagnostic/);
  await assert.rejects(fs.access(path.join(directory, 'later-ran')));
});
