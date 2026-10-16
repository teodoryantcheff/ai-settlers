// Frame-time benchmark on the machine's real GPU (headless Chromium, ANGLE/EGL).
// Grows a deterministic autoplay colony, then measures main-thread and GPU time
// per frame at each zoom level with the simulation running and paused.
//
//   npm run bench:render -- [options]   (builds first)
//
// Options (all optional):
//   --minutes 20       simulated autoplay minutes before measuring
//   --zooms 0,1,...,6  zoom indexes (0 = farthest)
//   --modes running,paused
//   --speed 1          simulation speed while "running"
//   --ms 3000          measurement window per zoom/mode
//   --seed 2024        map seed
//   --size 1920x1080   viewport
//   --profile 0,3      write V8 CPU profiles for these zooms (running mode)
//   --port 8790
// Results: a table on stdout and JSON (plus profiles) under output/bench/.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf('--' + name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const list = (value) => value.split(',').filter(Boolean);
const minutes = Number(option('minutes', '20'));
const zooms = list(option('zooms', '0,1,2,3,4,5,6')).map(Number);
const modes = list(option('modes', 'running,paused'));
const speed = Number(option('speed', '1'));
const windowMs = Number(option('ms', '3000'));
const seed = Number(option('seed', '2024'));
const [width, height] = option('size', '1920x1080').split('x').map(Number);
const profileZooms = list(option('profile', '')).map(Number);
const port = Number(option('port', '8790'));
const outDir = path.join(root, 'output', 'bench', new Date().toISOString().replace(/[:.]/g, '-'));

if (!fs.existsSync(path.join(root, 'tests', 'game.html'))) {
  console.error('Missing tests/game.html: run `npm run build` first.');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: root,
  stdio: 'ignore',
});
const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: [
    '--headless=new',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--use-angle=gl-egl',
    // Exposes EXT_disjoint_timer_query_webgl2 for GPU frame timing.
    '--enable-privileged-webgl-extensions',
  ],
});

/** Installed before boot: per-frame rAF callback time, GPU timer queries and GL call counts. */
function instrument() {
  const state = { recording: false, frames: [], gpu: [], gl: {} };
  window.__bench = state;
  const counted = [
    'drawElements',
    'drawArrays',
    'bufferData',
    'bufferSubData',
    'texImage2D',
    'texSubImage2D',
  ];
  const proto = WebGL2RenderingContext.prototype;
  for (const name of counted) {
    const original = proto[name];
    proto[name] = function (...args) {
      if (state.recording) {
        const entry = (state.gl[name] ||= { calls: 0, bytes: 0 });
        entry.calls++;
        const data = name === 'bufferData' ? args[1] : name === 'bufferSubData' ? args[2] : null;
        if (data && data.BYTES_PER_ELEMENT)
          entry.bytes +=
            (name === 'bufferSubData' && args.length >= 5 ? args[4] : data.length) *
            data.BYTES_PER_ELEMENT;
      }
      return original.apply(this, args);
    };
  }
  const raf = window.requestAnimationFrame.bind(window);
  const pending = [];
  let gl = null,
    timer = null,
    active = false;
  window.requestAnimationFrame = (callback) =>
    raf((ts) => {
      if (!gl) {
        const canvas = document.getElementById('pixi-view');
        gl = canvas ? canvas.getContext('webgl2') : null;
        timer = gl ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
      }
      let query = null;
      if (timer && state.recording && !active) {
        query = gl.createQuery();
        gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
        active = true;
      }
      const start = performance.now();
      callback(ts);
      const elapsed = performance.now() - start;
      if (query) {
        gl.endQuery(timer.TIME_ELAPSED_EXT);
        active = false;
        pending.push(query);
      }
      while (
        timer &&
        pending.length &&
        gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)
      ) {
        const done = pending.shift();
        const ns = gl.getQueryParameter(done, gl.QUERY_RESULT);
        if (!gl.getParameter(timer.GPU_DISJOINT_EXT) && state.recording && ns > 0)
          state.gpu.push(ns / 1e6);
        gl.deleteQuery(done);
      }
      if (state.recording) state.frames.push([ts, elapsed]);
    });
}

const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
const round = (value, digits = 1) => Number(value.toFixed(digits));
const rows = [];
try {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('pageerror:', error.message));
  await page.addInitScript(instrument);
  await page.goto(`http://127.0.0.1:${port}/tests/game.html?seed=${seed}`);
  await page.waitForFunction(() => window.productionArtPreview?.game, null, { timeout: 60000 });
  const gpuName = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  console.log('GPU:', gpuName);
  if (/swiftshader|llvmpipe/i.test(gpuName))
    console.warn('Warning: software rendering; GPU timings are not representative.');

  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.closeLayer('start');
    game.setMuted?.(true);
    game.state.paused = true;
    game.state.auto = true;
  });
  const steps = Math.round(minutes * 3600);
  for (let done = 0; done < steps; done += 3600)
    await page.evaluate(
      (count) => {
        const game = window.productionArtPreview.game;
        for (let i = 0; i < count; i++) game.step(1 / 60, false);
      },
      Math.min(3600, steps - done),
    );
  const colony = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    return {
      seconds: Math.round(game.state.time),
      buildings: game.buildings.length,
      units: game.units.length,
      trees: game.tiles.filter((tile) => tile.tree).length,
    };
  });
  console.log('Colony:', JSON.stringify(colony));

  // Time the loop's top-level phases through the runtime's live bindings.
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    const state = window.__bench;
    state.phases = {};
    for (const name of ['step', 'draw', 'drawMini', 'hudTick']) {
      const original = game[name];
      game[name] = function (...args) {
        const start = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          if (state.recording)
            state.phases[name] = (state.phases[name] || 0) + performance.now() - start;
        }
      };
    }
  });

  const cdp = await context.newCDPSession(page);
  for (const zoom of zooms)
    for (const mode of modes) {
      await page.evaluate(
        ({ zoom, mode, speed }) => {
          const game = window.productionArtPreview.game;
          game.zi = zoom;
          game.z = game.zooms[zoom];
          const hq = game.anyStorage();
          game.cam.x = (hq.x + 0.5) * game.TS - game.vw / game.z / 2;
          game.cam.y = (hq.y + 0.5) * game.TS - game.vh / game.z / 2;
          game.clampCam();
          game.state.speed = speed;
          game.state.paused = mode === 'paused';
        },
        { zoom, mode, speed },
      );
      await page.waitForTimeout(1000);
      const profile = mode === 'running' && profileZooms.includes(zoom);
      if (profile) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
        await cdp.send('Profiler.start');
      }
      const before = await page.evaluate(() => {
        const state = window.__bench;
        Object.assign(state, { frames: [], gpu: [], gl: {}, phases: {}, recording: true });
        return { ...window.productionRendererStats };
      });
      await page.waitForTimeout(windowMs);
      const sample = await page.evaluate(() => {
        const state = window.__bench;
        state.recording = false;
        const game = window.productionArtPreview.game;
        return {
          frames: state.frames,
          gpu: state.gpu,
          gl: state.gl,
          phases: state.phases,
          stats: { ...window.productionRendererStats },
          z: game.z,
        };
      });
      if (profile) {
        const { profile: data } = await cdp.send('Profiler.stop');
        await cdp.send('Profiler.disable');
        fs.writeFileSync(path.join(outDir, `zoom${zoom}-${mode}.cpuprofile`), JSON.stringify(data));
      }
      // Several rAF callbacks may share one frame timestamp; attribute them together.
      const perFrame = new Map();
      for (const [ts, ms] of sample.frames) perFrame.set(ts, (perFrame.get(ts) || 0) + ms);
      const stamps = [...perFrame.keys()].sort((a, b) => a - b);
      const frames = Math.max(1, stamps.length);
      const cpu = [...perFrame.values()].sort((a, b) => a - b);
      const gpu = [...sample.gpu].sort((a, b) => a - b);
      const gl = sample.gl;
      const row = {
        zoom,
        scale: sample.z,
        mode,
        fps:
          stamps.length > 1 ? round(((stamps.length - 1) * 1000) / (stamps.at(-1) - stamps[0])) : 0,
        cpuMean: round(cpu.reduce((a, b) => a + b, 0) / frames),
        cpuP95: round(percentile(cpu, 0.95)),
        drawMs: round((sample.phases.draw || 0) / frames),
        stepMs: round((sample.phases.step || 0) / frames),
        gpuP50: gpu.length ? round(percentile(gpu, 0.5)) : null,
        gpuP95: gpu.length ? round(percentile(gpu, 0.95)) : null,
        sprites: sample.stats.nativeSprites,
        graphics: sample.stats.nativeGraphics,
        graphicsBuilds: round((sample.stats.graphicsBuilds - before.graphicsBuilds) / frames),
        drawCalls: round(((gl.drawElements?.calls || 0) + (gl.drawArrays?.calls || 0)) / frames),
        uploadKB: round(
          ((gl.bufferData?.bytes || 0) + (gl.bufferSubData?.bytes || 0)) / frames / 1024,
          0,
        ),
      };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  console.log();
  console.table(rows);
  fs.writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify(
      { gpu: gpuName, seed, minutes, speed, viewport: { width, height }, colony, rows },
      null,
      2,
    ),
  );
  console.log('Results:', path.relative(root, outDir));
} finally {
  await browser.close();
  server.kill();
}
