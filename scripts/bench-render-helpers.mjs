// Pure helpers for scripts/bench-render.mjs, kept apart so Node tests can import them.

const DEFAULTS = {
  minutes: '20',
  zooms: '',
  modes: 'running,paused',
  speed: '1',
  ms: '3000',
  seed: '2024',
  size: '1920x1080',
  quality: '1',
  profile: '',
  port: '8790',
};
const list = (value) => value.split(',').filter(Boolean);

/** Command-line options; `zooms: null` means every zoom level the game defines. */
export function benchOptions(argv) {
  const raw = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    if (!Object.hasOwn(DEFAULTS, name)) throw new Error(`Unknown option ${argv[i]}`);
    if (argv[i + 1] === undefined) throw new Error(`Missing value for --${name}`);
    raw[name] = argv[i + 1];
  }
  const fail = (name, expected) => {
    throw new Error(`--${name} must be ${expected}, not "${raw[name]}"`);
  };
  const number = (name, valid, expected) => {
    const value = Number(raw[name]);
    return raw[name] !== '' && valid(value) ? value : fail(name, expected);
  };
  const indexes = (name) =>
    list(raw[name]).map((value) =>
      /^\d+$/.test(value) ? Number(value) : fail(name, 'zoom indexes such as 0,3 (0 = farthest)'),
    );
  const modes = list(raw.modes);
  if (!modes.length || modes.some((mode) => mode !== 'running' && mode !== 'paused'))
    fail('modes', 'running, paused or both');
  const zooms = raw.zooms ? indexes('zooms') : null;
  const profile = indexes('profile');
  if (zooms && profile.some((zoom) => !zooms.includes(zoom)))
    fail('profile', 'among the measured --zooms');
  // Profiles are taken in running mode only.
  if (profile.length && !modes.includes('running'))
    throw new Error('--profile needs --modes to include running');
  const size = /^(\d+)x(\d+)$/.exec(raw.size) || fail('size', 'WIDTHxHEIGHT');
  return {
    minutes: number('minutes', (value) => value >= 0, 'a non-negative number'),
    zooms,
    modes,
    speed: number('speed', (value) => [1, 2, 4, 8].includes(value), '1, 2, 4 or 8'),
    windowMs: number('ms', (value) => value > 0, 'a positive number'),
    seed: number('seed', Number.isInteger, 'an integer'),
    width: Number(size[1]),
    height: Number(size[2]),
    quality: number('quality', (value) => value === 1 || value === 0.75, '1 or 0.75'),
    profile,
    port: number('port', (value) => Number.isInteger(value) && value > 0, 'a TCP port'),
  };
}

const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
const round = (value, digits = 1) => Number(value.toFixed(digits));

/** Unmasked WebGL renderer names of CPU rasterizers, whose timings say nothing about the GPU. */
export const isSoftwareRenderer = (name) =>
  /swiftshader|llvmpipe|softpipe|basic render/i.test(name);

/** Per-frame costs for one zoom/mode window; `before` holds the renderer stats at its start. */
export function summarize(sample, before) {
  // Several rAF callbacks may share one frame timestamp; attribute them together.
  const perFrame = new Map();
  for (const [ts, ms] of sample.frames) perFrame.set(ts, (perFrame.get(ts) || 0) + ms);
  const stamps = [...perFrame.keys()].sort((a, b) => a - b);
  const frames = Math.max(1, stamps.length);
  const cpu = [...perFrame.values()].sort((a, b) => a - b);
  const gpu = [...sample.gpu].sort((a, b) => a - b);
  const gl = sample.gl;
  const calls = (name) => gl[name]?.calls || 0;
  const bytes = (name) => gl[name]?.bytes || 0;
  return {
    scale: sample.z,
    fps: stamps.length > 1 ? round(((stamps.length - 1) * 1000) / (stamps.at(-1) - stamps[0])) : 0,
    cpuMean: round(cpu.reduce((a, b) => a + b, 0) / frames),
    cpuP95: round(percentile(cpu, 0.95)),
    drawMs: round((sample.phases.draw || 0) / frames),
    stepMs: round((sample.phases.step || 0) / frames),
    miniMs: round((sample.phases.drawMini || 0) / frames),
    hudMs: round((sample.phases.hudTick || 0) / frames),
    gpuP50: gpu.length ? round(percentile(gpu, 0.5)) : null,
    gpuP95: gpu.length ? round(percentile(gpu, 0.95)) : null,
    sprites: sample.stats.nativeSprites,
    graphics: sample.stats.nativeGraphics,
    graphicsBuilds: round((sample.stats.graphicsBuilds - before.graphicsBuilds) / frames),
    drawCalls: round((calls('drawElements') + calls('drawArrays')) / frames),
    uploadKB: round((bytes('bufferData') + bytes('bufferSubData')) / frames / 1024, 0),
    texUploads: round((calls('texImage2D') + calls('texSubImage2D')) / frames),
  };
}
