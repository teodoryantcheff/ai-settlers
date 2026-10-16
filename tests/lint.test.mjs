import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const config = path.join(root, '.oxlintrc.json');

function lint(configPath, ...targets) {
  const result = spawnSync(
    process.execPath,
    ['node_modules/oxlint/bin/oxlint', '-c', configPath, '-f', 'unix', ...targets],
    { cwd: root, encoding: 'utf8' },
  );
  return { status: result.status, output: result.stdout + result.stderr };
}

// Files that still used var or reassignable bindings when linting began; the list may only shrink.
const declarationBaseline = [
  'src/application/loop.ts',
  'src/audio/ambience.ts',
  'src/audio/audio.ts',
  'src/audio/music.ts',
  'src/audio/world-effects.ts',
  'src/core/persistence.ts',
  'src/core/world.ts',
  'src/dev/scenarios.ts',
  'src/gameplay/advisor.ts',
  'src/gameplay/progression.ts',
  'src/rendering/art.ts',
  'src/rendering/landscape.ts',
  'src/rendering/renderer.ts',
  'src/rendering/village.ts',
  'src/simulation/autoplay.ts',
  'src/simulation/economy.ts',
  'src/simulation/map.ts',
  'src/simulation/navigation.ts',
  'src/simulation/roads.ts',
  'src/simulation/state.ts',
  'src/ui/economic-notices.ts',
  'src/ui/hud.ts',
  'src/ui/inspector-view.ts',
  'src/ui/interaction.ts',
  'tests/browser/report-windows.spec.mjs',
  'tests/controls.test.cjs',
  'tests/production-progress.test.cjs',
];

test('the declaration exclusion list holds exactly the files still failing no-var or prefer-const', async (t) => {
  const settings = JSON.parse(await fs.readFile(config, 'utf8'));
  const overrides = settings.overrides.filter((entry) => entry.rules['no-var'] === 'off');
  assert.equal(overrides.length, 1);
  const excluded = overrides[0].files;
  assert.deepEqual(overrides[0].rules, { 'no-var': 'off', 'prefer-const': 'off' });
  for (const file of excluded) assert.ok(declarationBaseline.includes(file), `${file} was added`);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'settlers-lint-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const strict = path.join(directory, 'strict.json');
  await fs.writeFile(strict, JSON.stringify({ ...settings, overrides: [] }));
  const { output } = lint(strict, 'src', 'scripts', 'tests');
  const failing = [
    ...new Set(
      output
        .split('\n')
        .filter((line) => /\((no-var|prefer-const)\)\]$/.test(line))
        .map((line) => line.split(':')[0]),
    ),
  ].sort();
  assert.deepEqual([...excluded].sort(), failing);
});

test('a new file declaring with var or comparing loosely fails lint', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'settlers-lint-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'fresh.ts');
  await fs.writeFile(
    file,
    'export function same(a: unknown) {\n  var b = a;\n  return b == 1;\n}\n',
  );
  const { status, output } = lint(config, file);
  assert.notEqual(status, 0);
  assert.match(output, /no-var/);
  assert.match(output, /eqeqeq/);
});
