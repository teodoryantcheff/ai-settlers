import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(import.meta.dirname, '..');

const testFiles = async (directory) =>
  (await fs.readdir(directory).catch(() => []))
    .filter((name) => /\.test\.(cjs|mjs)$/.test(name))
    .sort();

// Leave headroom for the browser workers that share the machine with Node tests.
const nodeConcurrency = Math.max(1, Math.min(4, os.availableParallelism() - 2));

/**
 * The validation plan. Steps without `after` start together; a step waits for the
 * steps it names and is skipped when one of them fails. Node tests run in one
 * `node --test` invocation, one process per file. `nodeOnly` is routine validation
 * and omits build and browsers; `soakOnly` runs just the slow soak suite in
 * `tests/soak/`, which the full check does not include. `files` narrows routine Node
 * tests while preserving the repository-wide format, lint and typecheck steps.
 */
export async function validationSteps(
  directory,
  { nodeOnly = false, soakOnly = false, files = [] } = {},
) {
  if (nodeOnly && soakOnly) throw new Error('--node-tests and --soak are mutually exclusive');
  if (files.length && !nodeOnly)
    throw new Error('--file requires --node-tests (use npm test -- --file tests/<name>.test.cjs)');
  const node = (name, args, after = []) => ({ name, command: process.execPath, args, after });
  const nodeTests = (name, selected, concurrency) =>
    node(name, [
      '--test',
      `--test-concurrency=${concurrency}`,
      '--test-reporter=spec',
      ...selected.map((file) => path.join('tests', file)),
    ]);
  const tests = await testFiles(path.join(directory, 'tests'));
  if (soakOnly) {
    const soak = await testFiles(path.join(directory, 'tests', 'soak'));
    if (!soak.length) throw new Error('No soak test files found');
    // Each soak file is a long, CPU-bound playthrough; run them side by side.
    return [
      nodeTests(
        'soak',
        soak.map((name) => path.posix.join('soak', name)),
        nodeConcurrency,
      ),
    ];
  }
  if (!tests.length) throw new Error('No Node test files found');
  const selected = new Set();
  for (const file of files) {
    const name = path.relative(path.join(directory, 'tests'), path.resolve(directory, file));
    if (!tests.includes(name)) throw new Error(`Not a routine Node test file: ${file}`);
    selected.add(name);
  }
  const routine = files.length ? tests.filter((name) => selected.has(name)) : tests;
  return [
    node('format', [
      'node_modules/prettier/bin/prettier.cjs',
      '--check',
      'src',
      'scripts',
      'tests',
      'index.html',
      'tsconfig.json',
    ]),
    node('lint', [
      'node_modules/oxlint/bin/oxlint',
      '--deny-warnings',
      'src',
      'scripts',
      'tests',
      'playwright.config.mjs',
    ]),
    // Plain diagnostics: TypeScript 7 picks pretty output from the terminal otherwise.
    node('typecheck', ['node_modules/typescript/bin/tsc', '--noEmit', '--pretty', 'false']),
    nodeTests('node-tests', routine, nodeConcurrency),
    ...(!nodeOnly
      ? [
          node('build', ['scripts/build.mjs']),
          node('browser', ['node_modules/@playwright/test/cli.js', 'test'], ['build']),
        ]
      : []),
  ];
}

async function logTail(filename) {
  const file = await fs.open(filename);
  try {
    const { size } = await file.stat();
    const buffer = Buffer.alloc(Math.min(size, 16000));
    await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
    return (size > buffer.length ? '[Earlier output retained in log]\n' : '') + buffer.toString();
  } finally {
    await file.close();
  }
}

function runStep(step, { directory, log }) {
  const fd = openSync(log, 'w');
  return new Promise((resolve) => {
    let launchError;
    // A plan started from inside a test must still run its own `node --test` files.
    const { NODE_TEST_CONTEXT: _, ...env } = process.env;
    const child = spawn(step.command, step.args, {
      cwd: directory,
      env: { ...env, FORCE_COLOR: '0' },
      stdio: ['ignore', fd, fd],
    });
    child.on('error', (error) => {
      launchError = error.message;
    });
    child.on('close', (code, signal) => {
      closeSync(fd);
      resolve({ child, code, signal, launchError });
    });
    step.child = child;
  });
}

/**
 * Run the plan as a dependency graph: independent steps run concurrently, every
 * failure is reported, and a failed, interrupted or unlaunchable step skips the
 * steps that wait for it. Rejects after all runnable steps finish if any failed.
 */
export async function runSteps(steps, { directory, logDirectory, output = process.stdout }) {
  await fs.mkdir(logDirectory, { recursive: true });
  output.write(`Validation logs: ${logDirectory}\n`);
  for (const step of steps)
    for (const name of step.after ?? [])
      if (!steps.some((other) => other.name === name))
        throw new Error(`${step.name} waits for unknown step ${name}`);
  const results = new Map();
  const running = new Set();
  let interrupted;
  const interrupt = (signal) => {
    interrupted = signal;
    for (const step of running) step.child?.kill(signal);
  };
  const onInterrupt = () => interrupt('SIGINT');
  const onTerminate = () => interrupt('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  const started = Date.now();
  const heartbeat = setInterval(() => {
    const names = [...running].map((step) => step.name).join(', ');
    output.write(`  Running ${names} (${Math.round((Date.now() - started) / 1000)}s)\n`);
  }, 30000);
  const writeSummary = () =>
    fs.writeFile(
      path.join(logDirectory, 'summary.json'),
      JSON.stringify(
        {
          complete: results.size === steps.length && !interrupted,
          passed:
            results.size === steps.length && [...results.values()].every((entry) => entry.passed),
          results: steps.filter((step) => results.has(step.name)).map((s) => results.get(s.name)),
        },
        null,
        2,
      ) + '\n',
    );

  async function execute(step, index) {
    const filename = `${String(index + 1).padStart(2, '0')}-${step.name.replace(/[^\w.-]/g, '-')}.log`;
    const log = path.join(logDirectory, filename);
    const begin = Date.now();
    output.write(`[start] ${step.name}\n`);
    running.add(step);
    const result = await runStep(step, { directory, log });
    running.delete(step);
    if (result.launchError) await fs.appendFile(log, `Launch failed: ${result.launchError}\n`);
    const passed = result.code === 0 && !result.signal && !result.launchError && !interrupted;
    const durationMs = Date.now() - begin;
    results.set(step.name, {
      name: step.name,
      command: [step.command, ...step.args],
      code: result.code,
      signal: result.signal,
      launchError: result.launchError,
      interrupted,
      passed,
      durationMs,
      log,
    });
    await writeSummary();
    if (passed) output.write(`  PASS ${step.name} (${(durationMs / 1000).toFixed(1)}s)\n`);
    else {
      output.write(
        `FAIL ${step.name} (exit ${result.code}, signal ${interrupted || result.signal || 'none'})\n`,
      );
      output.write(`${await logTail(log)}\nFull log: ${log}\n`);
    }
  }

  try {
    const pending = new Map(steps.map((step, index) => [step, index]));
    const active = new Map();
    while (pending.size || active.size) {
      for (const [step, index] of pending) {
        const waits = (step.after ?? []).map((name) => results.get(name));
        if (interrupted || waits.some((entry) => entry && !entry.passed)) {
          pending.delete(step);
          output.write(`SKIP ${step.name}\n`);
        } else if (waits.every(Boolean)) {
          pending.delete(step);
          active.set(
            step,
            execute(step, index).then(() => active.delete(step)),
          );
        }
      }
      if (active.size) await Promise.race(active.values());
      else if (pending.size)
        throw new Error(
          `Circular step order: ${[...pending.keys()].map((s) => s.name).join(', ')}`,
        );
    }
  } finally {
    clearInterval(heartbeat);
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
  await writeSummary();
  const failed = steps.filter((step) => !results.get(step.name)?.passed).map((step) => step.name);
  if (failed.length) throw new Error(`Validation failed: ${failed.join(', ')}`);
  output.write(
    `Validation passed in ${((Date.now() - started) / 1000).toFixed(1)}s. Logs: ${logDirectory}\n`,
  );
  return steps.map((step) => results.get(step.name));
}

async function main() {
  const { values } = parseArgs({
    options: {
      'node-tests': { type: 'boolean', default: false },
      soak: { type: 'boolean', default: false },
      file: { type: 'string', multiple: true, default: [] },
    },
  });
  const steps = await validationSteps(root, {
    nodeOnly: values['node-tests'],
    soakOnly: values.soak,
    files: values.file,
  });
  const base = path.join(root, 'output/validation');
  await fs.mkdir(base, { recursive: true });
  const logDirectory = await fs.mkdtemp(
    path.join(base, new Date().toISOString().replace(/[:.]/g, '-') + '-'),
  );
  const browser = steps.find((step) => step.name === 'browser');
  if (browser) browser.args.push(`--output=${path.join(logDirectory, 'browser-artifacts')}`);
  await runSteps(steps, { directory: root, logDirectory });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
