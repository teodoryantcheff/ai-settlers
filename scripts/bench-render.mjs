// Frame-time benchmark on a hardware rendering profile (headless Chromium, real WebGL).
// Grows a deterministic autoplay colony, then measures main-thread and GPU time
// per frame at each zoom level with the simulation running and paused.
//
//   SETTLERS_RENDER_PROFILE=<hardware profile> npm run bench:render -- [options]
//
// Builds first. The profile (scripts/render-profile.mjs) chooses the GPU and ANGLE
// backend; the run stops before measuring if Chromium renders with anything else.
//
// Options (all optional):
//   --minutes 20       simulated autoplay minutes before measuring
//   --zooms 0,3        zoom indexes (0 = farthest; default: every zoom)
//   --modes running,paused
//   --speed 1          simulation speed while "running" (1, 2, 4 or 8)
//   --ms 3000          measurement window per zoom/mode
//   --seed 2024        map seed
//   --size 1920x1080   viewport
//   --quality 1        rendering quality (1 or 0.75)
//   --profile 0,3      write V8 CPU profiles for these zooms (running mode)
//   --port 8790        static server port
// Results: a table on stdout and JSON (plus profiles) under output/bench/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DRAW_CALLS, benchOptions, summarize } from './bench-render-helpers.mjs';
import {
  launchOptions,
  resolveProfile,
  startVerifiedBrowser,
  verifyRenderer,
} from './render-profile.mjs';

const root = path.resolve(import.meta.dirname, '..');
let options, profile, launch;
try {
  options = benchOptions(process.argv.slice(2));
  profile = resolveProfile({ purpose: 'performance' });
  // Exposes EXT_disjoint_timer_query_webgl2 for GPU frame timing.
  launch = launchOptions(profile, {
    args: ['--enable-privileged-webgl-extensions'],
    fullChromium: true,
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const { minutes, modes, speed, windowMs, seed, width, height, quality, port } = options;
const outDir = path.join(root, 'output', 'bench', new Date().toISOString().replace(/[:.]/g, '-'));
const origin = `http://127.0.0.1:${port}`;

if (!fs.existsSync(path.join(root, 'tests', 'game.html'))) {
  console.error('Missing tests/game.html: run `npm run build` first.');
  process.exit(1);
}
// Another server on the port could be serving a different checkout.
const responseFrom = (url) =>
  fetch(url, { signal: AbortSignal.timeout(1000) }).then(
    (response) => response,
    () => null,
  );
if (await responseFrom(origin)) {
  console.error(`Port ${port} is already in use; pick another with --port.`);
  process.exit(1);
}
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: root,
  stdio: 'ignore',
});
let serverExited = false;
server.on('exit', () => (serverExited = true));
server.on('error', () => (serverExited = true));

/** Installed before boot: per-frame rAF callback time, GPU timer queries and GL call counts. */
function instrument(drawCalls) {
  const state = { recording: false, frames: [], gpu: [], gl: {} };
  window.__bench = state;
  const counted = [...drawCalls, 'bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D'];
  const proto = WebGL2RenderingContext.prototype;
  for (const name of counted) {
    const original = proto[name];
    proto[name] = function (...args) {
      if (state.recording) {
        const entry = (state.gl[name] ||= { calls: 0, bytes: 0 });
        entry.calls++;
        // bufferData(target, src, usage, srcOffset?, length?) and
        // bufferSubData(target, dstOffset, src, srcOffset?, length?); length 0 means the rest.
        const data = args[{ bufferData: 1, bufferSubData: 2 }[name]];
        if (data?.BYTES_PER_ELEMENT)
          entry.bytes += (args[4] || data.length - (args[3] || 0)) * data.BYTES_PER_ELEMENT;
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

const rows = [];
let browser;
try {
  for (let tries = 0; !(await responseFrom(origin + '/tests/game.html'))?.ok; tries++) {
    if (serverExited || tries >= 50) throw new Error(`The static server on port ${port} failed.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const started = await startVerifiedBrowser(profile, launch, { performance: true });
  browser = started.browser;
  const rendering = started.evidence;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  // Pin the preferences that change what is drawn, so runs stay comparable.
  await context.addInitScript((quality) => {
    localStorage.setItem(
      'settlers.prefs',
      JSON.stringify({ muted: true, music: false, reducedMotion: false, weather: true, quality }),
    );
  }, quality);
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('pageerror:', error.message));
  await page.addInitScript(instrument, DRAW_CALLS);
  // `renderbench` freezes the cosmetic clock at noon with no rain, so rain,
  // night veils and dusk particles never differ between compared runs.
  await page.goto(`${origin}/tests/game.html?seed=${seed}&renderbench`);
  await page.waitForFunction(() => window.productionArtPreview?.game, null, { timeout: 60000 });
  const boot = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    const gl =
      document.getElementById('pixi-view')?.getContext('webgl2') ||
      document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      rendering: game.renderingAvailable !== false && !!gl,
      gpu:
        gl && (info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
      zoomCount: game.zooms.length,
      pinned: game.TESTMODE === true,
      night: game.nightAmt(),
      rain: game.rainAmt(),
    };
  });
  // The game's own canvas must render on the verified GPU too.
  verifyRenderer(profile, { available: boot.rendering, renderer: boot.gpu });
  // Verify the pinned cosmetic state instead of trusting the URL flag.
  if (!boot.pinned || boot.night !== 0 || boot.rain !== 0)
    throw new Error('Cosmetic state is not pinned: expected noon with no rain.');
  const scene = { time: 'noon', rain: false };
  console.log('Scene: noon, no rain (pinned)');
  const zooms = options.zooms ?? Array.from({ length: boot.zoomCount }, (_, zoom) => zoom);
  const invalid = [...zooms, ...options.profile].filter((zoom) => zoom >= boot.zoomCount);
  if (invalid.length)
    throw new Error(`Zoom indexes run from 0 to ${boot.zoomCount - 1}, not ${invalid.join(',')}.`);
  fs.mkdirSync(outDir, { recursive: true });

  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.closeLayer('start');
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
      const profile = mode === 'running' && options.profile.includes(zoom);
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
      const row = { zoom, mode, ...summarize(sample, before) };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  console.log();
  console.table(rows);
  if (rows.some((row) => row.gpuP50 === null))
    console.warn('Warning: GPU timer queries were unavailable; GPU columns are empty.');
  fs.writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify(
      {
        rendering,
        seed,
        minutes,
        speed,
        quality,
        scene,
        viewport: { width, height },
        colony,
        rows,
      },
      null,
      2,
    ),
  );
  console.log('Results:', path.relative(root, outDir));
} finally {
  await browser?.close();
  server.kill();
}
