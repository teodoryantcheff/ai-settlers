import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  SOFTWARE_PROFILE,
  describeRendering,
  isSoftwareRenderer,
  launchOptions,
  renderEvidence,
  resolveProfile,
  verifyRenderer,
} from '../scripts/render-profile.mjs';

// The workstation configuration from the issue: AMD through DRI_PRIME on ANGLE OpenGL.
const AMD = {
  gpu: 'AMD Radeon 500 Series',
  angle: 'gl',
  env: { DRI_PRIME: 'pci-0000_02_00_0' },
};
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'settlers-render-profile-'));
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
let files = 0;
/** Environment naming a profile file with `config` as its contents (an object or raw text). */
function withConfig(config, env = {}) {
  const file = path.join(directory, `profiles-${files++}.json`);
  fs.writeFileSync(file, typeof config === 'string' ? config : JSON.stringify(config));
  return { SETTLERS_RENDER_PROFILES: file, ...env };
}
const noConfig = (env = {}) => ({
  SETTLERS_RENDER_PROFILES: path.join(directory, 'absent.json'),
  ...env,
});

test('software rendering is selected explicitly and needs no machine configuration', () => {
  const profile = resolveProfile({ env: noConfig({ SETTLERS_RENDER_PROFILE: 'software' }) });
  assert.equal(profile.name, 'software');
  assert.equal(profile.mode, 'software');
  assert.equal(profile.angle, 'swiftshader');
});

test('a hardware profile comes from the machine configuration, by name or as its default', () => {
  const config = { default: 'amd', profiles: { amd: AMD, intel: { gpu: 'UHD', angle: 'gl' } } };
  assert.deepEqual(resolveProfile({ env: withConfig(config) }), {
    name: 'amd',
    mode: 'hardware',
    ...AMD,
  });
  assert.equal(
    resolveProfile({ env: withConfig(config, { SETTLERS_RENDER_PROFILE: 'intel' }) }).name,
    'intel',
  );
});

test('missing or invalid configuration fails before any browser starts', () => {
  for (const [env, message] of [
    [noConfig(), /No rendering profile selected/],
    [noConfig({ SETTLERS_RENDER_PROFILE: 'amd' }), /Unknown rendering profile "amd"/],
    [withConfig('{ not json', { SETTLERS_RENDER_PROFILE: 'software' }), /not valid JSON/],
    [
      withConfig({ profiles: { amd: { angle: 'gl' } } }, { SETTLERS_RENDER_PROFILE: 'amd' }),
      /"gpu"/,
    ],
    [
      withConfig({ profiles: { amd: { gpu: 'AMD' } } }, { SETTLERS_RENDER_PROFILE: 'amd' }),
      /"angle"/,
    ],
    [withConfig({ profiles: { amd: { ...AMD, angle: 'swiftshader' } } }), /"angle"/],
    [withConfig({ profiles: { amd: { ...AMD, angle: 'opengl' } } }), /"angle"/],
    [withConfig({ profiles: { amd: { ...AMD, env: { HOME: '/root' } } } }), /HOME/],
    [withConfig({ profiles: { amd: { ...AMD, fastest: true } } }), /fastest/],
    [withConfig({ profiles: { software: AMD } }), /software/],
    [withConfig({ default: 'amd', profiles: {} }), /default "amd"/],
    // Software rendering is never a machine default: it must be named per run.
    [withConfig({ default: 'software', profiles: { amd: AMD } }), /default "software"/],
  ])
    assert.throws(() => resolveProfile({ env }), message, JSON.stringify(env));
});

test('a performance run refuses the software profile', () => {
  assert.throws(
    () =>
      resolveProfile({
        env: noConfig({ SETTLERS_RENDER_PROFILE: 'software' }),
        purpose: 'performance',
      }),
    /hardware profile/,
  );
  const env = withConfig({ profiles: { amd: AMD } }, { SETTLERS_RENDER_PROFILE: 'amd' });
  assert.equal(resolveProfile({ env, purpose: 'performance' }).mode, 'hardware');
});

const amd = { name: 'amd', mode: 'hardware', ...AMD };

test('a profile alone chooses the backend and GPU; capability options add to it', () => {
  const hardware = launchOptions(amd, {
    args: ['--enable-privileged-webgl-extensions'],
    env: { PATH: '/usr/bin' },
  });
  assert.equal(hardware.headless, true);
  // Correctness runs use Playwright's headless shell; benchmarks ask for full Chromium.
  assert.equal(hardware.channel, undefined);
  assert.equal(launchOptions(amd, { env: {}, fullChromium: true }).channel, 'chromium');
  assert.ok(hardware.args.includes('--use-angle=gl'));
  assert.ok(hardware.args.includes('--enable-privileged-webgl-extensions'));
  assert.ok(!hardware.args.some((arg) => /swiftshader/.test(arg)));
  assert.deepEqual(hardware.env, { PATH: '/usr/bin', DRI_PRIME: 'pci-0000_02_00_0' });
  // An inherited selection that agrees with the profile is no conflict.
  assert.equal(
    launchOptions(amd, { env: { DRI_PRIME: 'pci-0000_02_00_0' } }).env.DRI_PRIME,
    'pci-0000_02_00_0',
  );

  // SwiftShader ignores GPU selection, so an exported DRI_PRIME does not matter.
  const software = launchOptions(SOFTWARE_PROFILE, { env: { DRI_PRIME: '1' } });
  assert.ok(software.args.includes('--use-angle=swiftshader'));
  assert.ok(software.args.includes('--enable-unsafe-swiftshader'));
});

test('conflicting backend options or GPU selections are refused', () => {
  for (const arg of [
    '--use-angle=swiftshader',
    '--use-gl=egl',
    '--enable-unsafe-swiftshader',
    '--disable-gpu',
    '--use-vulkan',
  ])
    assert.throws(() => launchOptions(amd, { args: [arg], env: {} }), /conflicts/, arg);
  assert.throws(
    () => launchOptions(amd, { env: { DRI_PRIME: '1' } }),
    /DRI_PRIME=1 conflicts with profile "amd"/,
  );
  const intel = { name: 'intel', mode: 'hardware', gpu: 'UHD', angle: 'gl', env: {} };
  assert.throws(() => launchOptions(intel, { env: { DRI_PRIME: '1' } }), /DRI_PRIME/);
});

// Renderer names reported by Chromium 156 on the reference workstation.
const RENDERERS = {
  amdGl: 'ANGLE (AMD, AMD Radeon 500 Series (radeonsi polaris12 ACO), OpenGL 4.6)',
  amdVulkan:
    'ANGLE (AMD, Vulkan 1.4.335 (AMD Radeon 500 Series (RADV POLARIS12) (0x0000699F)), radv)',
  intelGl: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)',
  intelEgl: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL ES 3.2)',
  swiftshader:
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
  llvmpipe: 'ANGLE (Mesa, llvmpipe (LLVM 19.1.1, 256 bits), OpenGL 4.5)',
};
const actual = (renderer) => ({ available: true, renderer });

test('a hardware run accepts only its configured GPU on its configured backend', () => {
  assert.doesNotThrow(() => verifyRenderer(amd, actual(RENDERERS.amdGl)));
  const intelEgl = { name: 'intel', mode: 'hardware', gpu: 'UHD Graphics 620', angle: 'gl-egl' };
  assert.doesNotThrow(() => verifyRenderer(intelEgl, actual(RENDERERS.intelEgl)));
  // Intel integrated graphics are hardware too, but not the GPU this profile expects.
  assert.throws(
    () => verifyRenderer(amd, actual(RENDERERS.intelGl)),
    /expected a renderer containing "AMD Radeon 500 Series"/,
  );
  assert.throws(() => verifyRenderer(amd, actual(RENDERERS.amdVulkan)), /backend "gl"/);
  assert.throws(() => verifyRenderer(intelEgl, actual(RENDERERS.intelGl)), /backend "gl-egl"/);
});

test('software fallback and unavailable WebGL never satisfy a hardware run', () => {
  for (const renderer of [RENDERERS.swiftshader, RENDERERS.llvmpipe])
    assert.throws(() => verifyRenderer(amd, actual(renderer)), /software fallback/, renderer);
  // Even a profile whose GPU text would match a software rasterizer.
  const loose = { ...amd, gpu: 'ANGLE' };
  assert.throws(() => verifyRenderer(loose, actual(RENDERERS.llvmpipe)), /software fallback/);
  for (const unavailable of [{ available: false, renderer: null }, actual(null), actual('')])
    assert.throws(() => verifyRenderer(amd, unavailable), /WebGL 2 is unavailable/);
});

test('the explicit software profile accepts SwiftShader only', () => {
  assert.doesNotThrow(() => verifyRenderer(SOFTWARE_PROFILE, actual(RENDERERS.swiftshader)));
  for (const renderer of [RENDERERS.llvmpipe, RENDERERS.amdGl])
    assert.throws(() => verifyRenderer(SOFTWARE_PROFILE, actual(renderer)), /SwiftShader/);
  assert.throws(() => verifyRenderer(SOFTWARE_PROFILE, actual(null)), /unavailable/);
});

test('CPU rasterizers are told apart from hardware GPUs', () => {
  for (const name of [
    RENDERERS.swiftshader,
    RENDERERS.llvmpipe,
    'softpipe',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)',
  ])
    assert.equal(isSoftwareRenderer(name), true, name);
  for (const name of [RENDERERS.amdGl, RENDERERS.intelGl, RENDERERS.amdVulkan])
    assert.equal(isSoftwareRenderer(name), false, name);
});

test('saved evidence names the configuration, the actual GPU and the source it measured', () => {
  const launch = launchOptions(amd, {
    args: ['--enable-privileged-webgl-extensions'],
    env: { PATH: '/usr/bin', API_TOKEN: 'secret' },
  });
  const base = { profile: amd, renderer: RENDERERS.amdGl, browserVersion: '156.0.8078.4', launch };
  const evidence = renderEvidence(base);
  assert.equal(evidence.mode, 'hardware');
  assert.equal(evidence.profile, 'amd');
  assert.equal(evidence.backend, 'gl');
  assert.equal(evidence.expectedGpu, 'AMD Radeon 500 Series');
  assert.equal(evidence.actualRenderer, RENDERERS.amdGl);
  assert.equal(evidence.browser, 'Chromium 156.0.8078.4 headless shell');
  assert.match(evidence.commit, /^[0-9a-f]{40}$/);
  assert.equal(typeof evidence.dirty, 'boolean');
  assert.deepEqual(evidence.launchArgs, launch.args);
  // Only GPU selection is recorded, never the rest of the environment.
  assert.deepEqual(evidence.gpuSelection, { DRI_PRIME: 'pci-0000_02_00_0' });
  assert.doesNotMatch(JSON.stringify(evidence), /secret|\/usr\/bin/);

  const full = launchOptions(amd, { env: {}, fullChromium: true });
  assert.equal(renderEvidence({ ...base, launch: full }).browser, 'Chromium 156.0.8078.4');

  assert.equal(
    describeRendering(evidence),
    'Rendering: hardware profile "amd" (ANGLE gl), expected "AMD Radeon 500 Series", ' +
      `actual "${RENDERERS.amdGl}", Chromium 156.0.8078.4 headless shell`,
  );
});

const repository = path.resolve(import.meta.dirname, '..');
const source = (file) => fs.readFileSync(path.join(repository, file), 'utf8');

test('every Chromium command launches through the shared profile contract', () => {
  const commands = {
    'scripts/bench-render.mjs': 'performance',
    'scripts/bench-territory.mjs': 'performance',
    'scripts/capture.mjs': 'correctness',
    'scripts/test-pages.mjs': 'correctness',
    'tests/browser/helpers/rendering.mjs': 'correctness',
  };
  for (const [file, purpose] of Object.entries(commands)) {
    const text = source(file);
    assert.match(text, /from '\.\/render-profile\.mjs'|scripts\/render-profile\.mjs'/, file);
    assert.match(text, /startVerifiedBrowser\(/, file);
    assert.doesNotMatch(text, /chromium\.launch\(/, file);
    assert.doesNotMatch(text, /--use-angle|--use-gl|swiftshader|--enable-gpu/i, file);
    if (purpose === 'performance') assert.match(text, /purpose: 'performance'/, file);
    else assert.doesNotMatch(text, /purpose:/, file);
  }
  // No other script or test launches Chromium on its own.
  const launchers = [];
  for (const directory of ['scripts', 'tests', 'tests/browser', 'tests/browser/helpers'])
    for (const name of fs.readdirSync(path.join(repository, directory))) {
      const file = path.posix.join(directory, name);
      if (/\.(mjs|cjs)$/.test(name) && /chromium\.launch\(/.test(source(file)))
        launchers.push(file);
    }
  assert.deepEqual(launchers, ['scripts/render-profile.mjs']);
});

test('browser tests take their launch options and renderer check from the selected profile', async (t) => {
  const saved = {
    SETTLERS_RENDER_PROFILES: process.env.SETTLERS_RENDER_PROFILES,
    SETTLERS_RENDER_PROFILE: process.env.SETTLERS_RENDER_PROFILE,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  process.env.SETTLERS_RENDER_PROFILES = path.join(directory, 'absent.json');
  process.env.SETTLERS_RENDER_PROFILE = 'software';
  const { default: config } = await import('../playwright.config.mjs');
  assert.deepEqual(config.use.launchOptions, launchOptions(SOFTWARE_PROFILE));
  assert.equal(
    path.resolve(config.globalSetup),
    path.join(repository, 'tests/browser/helpers/rendering.mjs'),
  );
});
