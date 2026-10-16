import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');

const testFiles = async (directory) =>
  (await fs.readdir(directory).catch(() => []))
    .filter((name) => /\.test\.(cjs|mjs)$/.test(name))
    .sort();

/**
 * Each test file gets its own process and reports its actual tests and assertions.
 * `nodeOnly` is routine validation and omits the slow soak suite in `tests/soak/`;
 * `soakOnly` runs just that suite.
 */
export async function validationSteps(directory, { nodeOnly = false, soakOnly = false } = {}) {
  const node = (name, ...args) => ({ name, command: process.execPath, args });
  const testStep = (name) => node(name, '--test-reporter=spec', path.join('tests', name));
  const tests = await testFiles(path.join(directory, 'tests'));
  const soak = (await testFiles(path.join(directory, 'tests', 'soak'))).map((name) =>
    path.posix.join('soak', name),
  );
  if (!tests.length) throw new Error('No Node test files found');
  if (soakOnly) {
    if (!soak.length) throw new Error('No soak test files found');
    return soak.map(testStep);
  }
  return [
    ...(!nodeOnly
      ? [
          node(
            'format',
            'node_modules/prettier/bin/prettier.cjs',
            '--check',
            'src',
            'scripts',
            'tests',
            'index.html',
            'tsconfig.json',
          ),
        ]
      : []),
    node(
      'lint',
      'node_modules/oxlint/bin/oxlint',
      '--deny-warnings',
      'src',
      'scripts',
      'tests',
      'playwright.config.mjs',
    ),
    node('typecheck', 'node_modules/typescript/bin/tsc', '--noEmit'),
    ...tests.map(testStep),
    ...(!nodeOnly
      ? [
          ...soak.map(testStep),
          node('build', 'scripts/build.mjs'),
          node('browser', 'node_modules/@playwright/test/cli.js', 'test', '--workers=1'),
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

/** Fail closed: a failed command, launch error or interruption stops the sequence. */
export async function runSteps(steps, { directory, logDirectory, output = process.stdout }) {
  await fs.mkdir(logDirectory, { recursive: true });
  output.write(`Validation logs: ${logDirectory}\n`);
  const results = [];
  for (const [index, step] of steps.entries()) {
    const filename = `${String(index + 1).padStart(2, '0')}-${step.name.replace(/[^\w.-]/g, '-')}.log`;
    const log = path.join(logDirectory, filename);
    const started = Date.now();
    output.write(`[${index + 1}/${steps.length}] ${step.name}\n`);
    const fd = openSync(log, 'w');
    let child;
    let interrupted;
    const interrupt = (signal) => {
      interrupted = signal;
      child?.kill(signal);
    };
    const onInterrupt = () => interrupt('SIGINT');
    const onTerminate = () => interrupt('SIGTERM');
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
    const heartbeat = setInterval(() => {
      output.write(`  Running ${step.name} (${Math.round((Date.now() - started) / 1000)}s)\n`);
    }, 30000);
    let result;
    try {
      result = await new Promise((resolve) => {
        let launchError;
        child = spawn(step.command, step.args, {
          cwd: directory,
          env: { ...process.env, FORCE_COLOR: '0' },
          stdio: ['ignore', fd, fd],
        });
        child.on('error', (error) => {
          launchError = error.message;
        });
        child.on('close', (code, signal) => resolve({ code, signal, launchError }));
      });
    } finally {
      clearInterval(heartbeat);
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
      closeSync(fd);
    }
    if (result.launchError) await fs.appendFile(log, `Launch failed: ${result.launchError}\n`);
    const passed = result.code === 0 && !result.signal && !result.launchError && !interrupted;
    results.push({
      name: step.name,
      command: [step.command, ...step.args],
      ...result,
      interrupted,
      passed,
      durationMs: Date.now() - started,
      log,
    });
    await fs.writeFile(
      path.join(logDirectory, 'summary.json'),
      JSON.stringify(
        {
          complete: results.length === steps.length,
          passed: results.length === steps.length && results.every((entry) => entry.passed),
          results,
        },
        null,
        2,
      ) + '\n',
    );
    if (!passed) {
      output.write(
        `FAIL ${step.name} (exit ${result.code}, signal ${interrupted || result.signal || 'none'})\n`,
      );
      output.write(`${await logTail(log)}\nFull log: ${log}\n`);
      throw new Error(`Validation stopped at ${step.name}; remaining steps were not run`);
    }
    output.write(`  PASS (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
  }
  output.write(`Validation passed. Logs: ${logDirectory}\n`);
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const modes = ['--node-tests', '--soak'];
  if (args.length && (args.length !== 1 || !modes.includes(args[0])))
    throw new Error('Usage: node scripts/validate.mjs [--node-tests | --soak]');
  const base = path.join(root, 'output/validation');
  await fs.mkdir(base, { recursive: true });
  const logDirectory = await fs.mkdtemp(
    path.join(base, new Date().toISOString().replace(/[:.]/g, '-') + '-'),
  );
  const steps = await validationSteps(root, {
    nodeOnly: args[0] === '--node-tests',
    soakOnly: args[0] === '--soak',
  });
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
