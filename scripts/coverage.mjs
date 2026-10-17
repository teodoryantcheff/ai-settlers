import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { CoverageReport } from 'monocart-coverage-reports';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/coverage');
const raw = path.join(output, 'raw');
const baselineFile = path.join(root, 'tests/coverage-baseline.json');
// Percentage points a file may lose before the guard fails; absorbs refactor noise.
const TOLERANCE = 0.5;

const { values } = parseArgs({
  options: {
    update: { type: 'boolean', default: false },
    'report-only': { type: 'boolean', default: false },
    workers: { type: 'string', default: '3' },
  },
});

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: '0', ...env },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${[command, ...args].join(' ')} failed (${code ?? signal})`)),
    );
  });
}

const node = (args, env) => run(process.execPath, args, env);

if (!values['report-only']) {
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(raw, { recursive: true });
  const tests = (await fs.readdir(path.join(root, 'tests')))
    .filter((name) => /\.test\.(cjs|mjs)$/.test(name))
    .sort()
    .map((name) => path.join('tests', name));
  await node(['--test', '--test-concurrency=4', '--test-reporter=dot', ...tests], {
    NODE_V8_COVERAGE: path.join(raw, 'node'),
  });
  await node(['scripts/build.mjs'], { SETTLERS_SOURCEMAP: '1' });
  await node(['node_modules/@playwright/test/cli.js', 'test', `--workers=${values.workers}`], {
    SETTLERS_BROWSER_COVERAGE: path.join(raw, 'browser'),
  });
}

const baseUrl = pathToFileURL(root + '/').href;
const repositoryPath = (file) => {
  const absolute = file.startsWith('file:') ? fileURLToPath(file) : path.resolve(root, file);
  return path.relative(root, absolute).split(path.sep).join('/');
};
// Runtime modules only: development scenarios and bundled dependencies are out of scope.
const runtimeSources = new Set(
  (await fs.readdir(path.join(root, 'src'), { recursive: true }))
    .map((name) => path.posix.join('src', name.split(path.sep).join('/')))
    .filter((name) => name.endsWith('.ts') && !name.startsWith('src/dev/')),
);
const isRuntimeSource = (file) => runtimeSources.has(repositoryPath(file));

/**
 * One environment's per-file coverage. Node runs type-stripped TypeScript; the
 * browser runs esbuild output mapped back through source maps. Their branch
 * structures differ (esbuild lowers `??=` and `?.` into new branches), so the two
 * are measured and guarded separately rather than merged into one number.
 */
async function measure(environment, add) {
  const mcr = new CoverageReport({
    name: `Settlers ${environment} coverage`,
    outputDir: path.join(output, 'report', environment),
    reports: ['v8', 'console-summary'],
    logging: 'error',
    all: {
      dir: ['./src'],
      filter: (file) => file.endsWith('.ts') && isRuntimeSource(file) && 'js',
      transformer: (entry) => {
        entry.source = stripTypeScriptTypes(entry.source);
      },
    },
    sourcePath: repositoryPath,
    entryFilter: (entry) =>
      /\/game\.(?:min|test)\.js$/.test(entry.url) ||
      (entry.url.startsWith(baseUrl) && isRuntimeSource(entry.url)),
    sourceFilter: isRuntimeSource,
    // Give the parser the same type-stripped code V8 ran.
    onEntry: (entry) => {
      if (entry.url.startsWith(baseUrl) && entry.url.endsWith('.ts'))
        entry.source = stripTypeScriptTypes(entry.source);
    },
  });
  await add(mcr);
  console.log(`${environment}:`);
  const results = await mcr.generate();
  const measured = {};
  for (const file of results.files) {
    if (measured[file.sourcePath]) throw new Error(`Duplicate coverage for ${file.sourcePath}`);
    measured[file.sourcePath] = {
      lines: file.summary.lines.pct,
      branches: file.summary.branches.pct,
    };
  }
  return measured;
}

const nodeCoverage = await measure('node', (mcr) => mcr.addFromDir(path.join(raw, 'node')));
const browserCoverage = await measure('browser', async (mcr) => {
  const bundles = {};
  for (const name of await fs.readdir(path.join(raw, 'browser'))) {
    const { result } = JSON.parse(await fs.readFile(path.join(raw, 'browser', name), 'utf8'));
    for (const entry of result) {
      const file = fileURLToPath(entry.url);
      bundles[file] ??= {
        source: await fs.readFile(file, 'utf8'),
        sourceMap: JSON.parse(await fs.readFile(file + '.map', 'utf8')),
      };
      await mcr.add([{ ...entry, ...bundles[file] }]);
    }
  }
});
const current = {};
for (const file of new Set([...Object.keys(nodeCoverage), ...Object.keys(browserCoverage)]))
  current[file] = { node: nodeCoverage[file], browser: browserCoverage[file] };
const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));

if (values.update) {
  await fs.writeFile(baselineFile, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`Coverage baseline written: ${Object.keys(sorted).length} files.`);
} else {
  const baseline = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
  const failures = [];
  for (const [file, environments] of Object.entries(baseline))
    for (const [environment, expected] of Object.entries(environments)) {
      const actual = current[file]?.[environment];
      // A removed file has no coverage to lose; its lines leave the denominator with it.
      if (!actual || !expected) continue;
      for (const metric of ['lines', 'branches'])
        if (actual[metric] < expected[metric] - TOLERANCE)
          failures.push(
            `${file} ${environment} ${metric}: ${actual[metric]}% < baseline ${expected[metric]}%`,
          );
    }
  for (const file of Object.keys(current))
    if (!baseline[file]) failures.push(`${file}: not in baseline (run with --update)`);
  if (failures.length) {
    console.error(`Coverage regressed:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  } else console.log(`Coverage holds against the baseline (${TOLERANCE} pp tolerance).`);
}
