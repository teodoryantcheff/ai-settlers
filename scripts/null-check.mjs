import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
const located = /^(.+?)\(\d+,\d+\): error TS\d+:/;

/**
 * Typechecks `directory` with strict null checks. Errors count only outside `exclusions`,
 * and every excluded file must still have errors, so the list can only shrink.
 */
export function nullCheck({ directory, exclusions }) {
  const run = spawnSync(
    process.execPath,
    [tsc, '--project', directory, '--noEmit', '--strictNullChecks', '--pretty', 'false'],
    { cwd: directory, encoding: 'utf8' },
  );
  // tsc exits 1 or 2 when it reports diagnostics; anything else means it did not finish checking.
  if (run.error || ![0, 1, 2].includes(run.status))
    return {
      passed: false,
      unexpected: [`tsc failed: ${run.error?.message || run.signal || run.status}\n${run.stderr}`],
      stale: [],
    };
  const lines = run.stdout.split('\n').filter((line) => line && !/^\s/.test(line));
  const erroneous = new Set(lines.map((line) => line.match(located)?.[1]));
  const unexpected = lines.filter((line) => !exclusions.includes(line.match(located)?.[1]));
  const stale = exclusions.filter((file) => !erroneous.has(file));
  return { passed: !unexpected.length && !stale.length, unexpected, stale };
}

function main() {
  const list = path.join(root, 'scripts/null-check-exclusions.json');
  const result = nullCheck({ directory: root, exclusions: JSON.parse(fs.readFileSync(list)) });
  for (const line of result.unexpected) console.log(line);
  if (result.unexpected.length)
    console.log(`${result.unexpected.length} strict null check errors outside ${list}`);
  for (const file of result.stale)
    console.log(`${file} has no strict null check errors; remove it from ${list}`);
  if (result.passed) console.log('Strict null checks pass outside the exclusion list');
  else process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
