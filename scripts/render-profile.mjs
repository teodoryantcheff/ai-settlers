// The rendering-profile contract shared by every Chromium developer command: browser
// tests, render and territory benchmarks, captures and the production smoke check.
//
// A profile names the WebGL configuration a run must get. `software` (SwiftShader) is
// built in and is only ever used when selected explicitly. Hardware profiles describe
// one machine, so they live outside the repository, in a JSON file at
// $SETTLERS_RENDER_PROFILES, or else $XDG_CONFIG_HOME/ai-settlers/render-profiles.json
// (~/.config by default):
//
//   {
//     "default": "amd",
//     "profiles": {
//       "amd": { "gpu": "AMD Radeon 500 Series", "angle": "gl",
//                "env": { "DRI_PRIME": "pci-0000_02_00_0" } },
//       "intel": { "gpu": "UHD Graphics 620", "angle": "gl" }
//     }
//   }
//
// SETTLERS_RENDER_PROFILE selects a profile by name, overriding the file's default.
// `gpu` must appear in the actual WebGL renderer name; `angle` is the ANGLE backend.
// Every launch is verified against its profile before any test, capture or sample.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** ANGLE backends a hardware profile may name, with the renderer-name mark each one leaves. */
export const HARDWARE_BACKENDS = {
  gl: /\bOpenGL (?!ES)\d/,
  'gl-egl': /\bOpenGL ES\b/,
  vulkan: /\bVulkan\b/,
  d3d11: /\bDirect3D11\b/,
  metal: /\bMetal\b/,
};

/** Environment variables that choose a GPU or driver; the only ones a profile may set or a run records. */
export const GPU_SELECTION_ENV = [
  'DRI_PRIME',
  'MESA_VK_DEVICE_SELECT',
  '__NV_PRIME_RENDER_OFFLOAD',
  '__GLX_VENDOR_LIBRARY_NAME',
  '__VK_LAYER_NV_optimus',
  'LIBGL_ALWAYS_SOFTWARE',
  'GALLIUM_DRIVER',
  'MESA_LOADER_DRIVER_OVERRIDE',
];

/** The built-in correctness profile: CPU rasterized WebGL, for CI and machines without a usable GPU. */
export const SOFTWARE_PROFILE = Object.freeze({
  name: 'software',
  mode: 'software',
  gpu: 'SwiftShader',
  angle: 'swiftshader',
  env: Object.freeze({}),
});

const HELP =
  'Set SETTLERS_RENDER_PROFILE=software for SwiftShader correctness runs, or name a hardware ' +
  'profile from the rendering-profile file (README, "Rendering profiles").';

/** Where this machine's hardware profiles live. */
export function profilesPath(env = process.env) {
  if (env.SETTLERS_RENDER_PROFILES) return path.resolve(env.SETTLERS_RENDER_PROFILES);
  const config = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(config, 'ai-settlers', 'render-profiles.json');
}

function readProfiles(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { default: undefined, profiles: {} };
    throw error;
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new Error(`Rendering-profile file ${file} is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }
  const fail = (message) => {
    throw new Error(`Rendering-profile file ${file}: ${message}`);
  };
  const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(config)) fail('expected an object with "profiles"');
  for (const key of Object.keys(config))
    if (key !== 'default' && key !== 'profiles') fail(`unknown field "${key}"`);
  const profiles = {};
  for (const [name, entry] of Object.entries(config.profiles ?? {})) {
    const where = `profile "${name}"`;
    if (name === SOFTWARE_PROFILE.name) fail(`"${name}" is the built-in software profile`);
    if (!isObject(entry)) fail(`${where} must be an object`);
    for (const key of Object.keys(entry))
      if (!['gpu', 'angle', 'env'].includes(key)) fail(`${where} has unknown field "${key}"`);
    if (typeof entry.gpu !== 'string' || !entry.gpu.trim())
      fail(`${where} needs "gpu": text that appears in the expected WebGL renderer name`);
    if (!Object.hasOwn(HARDWARE_BACKENDS, entry.angle))
      fail(`${where} needs "angle": one of ${Object.keys(HARDWARE_BACKENDS).join(', ')}`);
    const env = entry.env ?? {};
    if (!isObject(env)) fail(`${where} "env" must be an object`);
    for (const [key, value] of Object.entries(env)) {
      if (!GPU_SELECTION_ENV.includes(key))
        fail(`${where} "env" may only set ${GPU_SELECTION_ENV.join(', ')}, not ${key}`);
      if (typeof value !== 'string') fail(`${where} "env.${key}" must be text`);
    }
    profiles[name] = {
      name,
      mode: 'hardware',
      gpu: entry.gpu,
      angle: entry.angle,
      env: { ...env },
    };
  }
  if (
    config.default !== undefined &&
    config.default !== SOFTWARE_PROFILE.name &&
    !profiles[config.default]
  )
    fail(`default "${config.default}" is not a defined profile`);
  return { default: config.default, profiles };
}

/**
 * The selected rendering profile. `purpose: 'performance'` admits only hardware
 * profiles. Throws, naming the problem, on a missing selection or invalid configuration.
 */
export function resolveProfile({ env = process.env, purpose = 'correctness' } = {}) {
  const file = profilesPath(env);
  const config = readProfiles(file);
  const name = env.SETTLERS_RENDER_PROFILE || config.default;
  if (!name) throw new Error(`No rendering profile selected. ${HELP}`);
  const profile = name === SOFTWARE_PROFILE.name ? SOFTWARE_PROFILE : config.profiles[name];
  if (!profile) {
    const known = [SOFTWARE_PROFILE.name, ...Object.keys(config.profiles)].join(', ');
    throw new Error(`Unknown rendering profile "${name}" (known: ${known}; file ${file}). ${HELP}`);
  }
  if (purpose === 'performance' && profile.mode !== 'hardware')
    throw new Error(
      `Performance runs need a hardware profile; "${profile.name}" is ${profile.mode} rendering. ` +
        `Define one in ${file} and select it with SETTLERS_RENDER_PROFILE (README, "Rendering profiles").`,
    );
  return profile;
}

/** Unmasked WebGL renderer names of CPU rasterizers, whose timings say nothing about the GPU. */
export const isSoftwareRenderer = (name) =>
  /swiftshader|llvmpipe|softpipe|basic render/i.test(name);

/**
 * Check what a browser actually renders with (`{ available, renderer }`, the unmasked
 * WebGL 2 renderer name) against its profile. Throws on unavailable WebGL, a software
 * rasterizer under a hardware profile, another GPU, or another ANGLE backend.
 */
export function verifyRenderer(profile, { available, renderer }) {
  const label = `Rendering profile "${profile.name}"`;
  if (!available || !renderer) throw new Error(`${label}: WebGL 2 is unavailable in Chromium.`);
  if (profile.mode === 'software') {
    if (!/SwiftShader/i.test(renderer))
      throw new Error(`${label} expected SwiftShader software rendering, got "${renderer}".`);
    return;
  }
  if (isSoftwareRenderer(renderer))
    throw new Error(
      `${label} needs ${profile.gpu}, but Chromium used software fallback "${renderer}".`,
    );
  if (!renderer.toLowerCase().includes(profile.gpu.toLowerCase()))
    throw new Error(`${label} expected a renderer containing "${profile.gpu}", got "${renderer}".`);
  if (!HARDWARE_BACKENDS[profile.angle].test(renderer))
    throw new Error(`${label} expected ANGLE backend "${profile.angle}", got "${renderer}".`);
}

/** Chromium switches that pick or disable a WebGL backend; only the profile sets these. */
const BACKEND_SWITCHES =
  /^--(use-angle|use-gl|use-vulkan|enable-unsafe-swiftshader|disable-gpu|disable-webgl|disable-software-rasterizer|ignore-gpu-blocklist|enable-gpu)(=|$)/;

/**
 * Playwright `chromium.launch` options for a profile. `args` adds capability-specific
 * switches (GPU timer queries, sandboxing), never backend choices. `env` is the
 * inherited environment; a hardware profile's GPU selection is applied on top, and an
 * inherited selection that disagrees with it is refused rather than overridden.
 * Commands run Playwright's headless shell unless `fullChromium` asks for the full
 * browser, which the benchmarks have always measured.
 */
export function launchOptions(
  profile,
  { args = [], env = process.env, fullChromium = false } = {},
) {
  for (const arg of args)
    if (BACKEND_SWITCHES.test(arg))
      throw new Error(
        `${arg} conflicts with rendering profile "${profile.name}"; select a profile instead.`,
      );
  if (profile.mode === 'hardware')
    for (const key of GPU_SELECTION_ENV)
      if (env[key] !== undefined && env[key] !== profile.env[key])
        throw new Error(
          `${key}=${env[key]} conflicts with profile "${profile.name}" ` +
            `(${profile.env[key] === undefined ? 'unset' : `${key}=${profile.env[key]}`}); ` +
            'unset it or put the selection in the profile.',
        );
  const backend =
    profile.mode === 'software'
      ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : [
          '--enable-gpu',
          '--ignore-gpu-blocklist',
          '--use-gl=angle',
          `--use-angle=${profile.angle}`,
        ];
  return {
    headless: true,
    ...(fullChromium ? { channel: 'chromium' } : {}),
    args: [...backend, ...args],
    env: { ...env, ...profile.env },
  };
}

const root = path.resolve(import.meta.dirname, '..');
function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

/**
 * What a run rendered with, for saved results: profile, expected and actual GPU,
 * browser and source revision. `performance` adds the launch switches and the GPU
 * selection variables (never the rest of the environment).
 */
export function renderEvidence({ profile, renderer, browserVersion, launch, performance = false }) {
  const status = git(['status', '--porcelain']);
  const evidence = {
    mode: profile.mode,
    profile: profile.name,
    backend: profile.angle,
    expectedGpu: profile.gpu,
    actualRenderer: renderer,
    browser: `Chromium ${browserVersion}${launch.channel === 'chromium' ? '' : ' headless shell'}`,
    commit: git(['rev-parse', 'HEAD']),
    dirty: status === null ? null : status !== '',
  };
  if (!performance) return evidence;
  const gpuSelection = {};
  for (const key of GPU_SELECTION_ENV)
    if (launch.env?.[key] !== undefined) gpuSelection[key] = launch.env[key];
  return { ...evidence, launchArgs: launch.args, gpuSelection };
}

/** One line for command output. */
export const describeRendering = (evidence) =>
  `Rendering: ${evidence.mode} profile "${evidence.profile}" (ANGLE ${evidence.backend}), ` +
  `expected "${evidence.expectedGpu}", actual "${evidence.actualRenderer}", ${evidence.browser}`;

/** The WebGL 2 renderer a page gets; runs in the page through `page.evaluate`. */
export function pageRenderer() {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return { available: false, renderer: null };
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    available: true,
    renderer: gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
  };
}

/**
 * Launch Chromium with `launch` (from `launchOptions(profile)`), verify its actual
 * renderer against the profile and print the configuration. Closes the browser and
 * throws on any mismatch, so nothing is tested, captured or measured on the wrong GPU.
 */
export async function startVerifiedBrowser(profile, launch, { performance = false } = {}) {
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage();
    const actual = await page.evaluate(pageRenderer);
    await page.close();
    verifyRenderer(profile, actual);
    const evidence = renderEvidence({
      profile,
      renderer: actual.renderer,
      browserVersion: browser.version(),
      launch,
      performance,
    });
    console.log(describeRendering(evidence));
    return { browser, evidence };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
