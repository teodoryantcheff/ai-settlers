// Opt-in territory-cache benchmark on the reference hardware GPU.
// Run npm run build first, then node scripts/bench-territory.mjs.
// Uses two projections from the real colony rules while preserving building art,
// so the changed frame isolates border/minimap work from guard animation changes.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isSoftwareRenderer } from './bench-render-helpers.mjs';

const root = path.resolve(import.meta.dirname, '..');
const origin = 'http://127.0.0.1:8795';
const out = path.join(
  root,
  'output/bench-territory',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
if (!fs.existsSync(path.join(root, 'tests/game.html'))) throw new Error('Run npm run build first.');
const responseFrom = () => fetch(origin, { signal: AbortSignal.timeout(1000) }).catch(() => null);
if (await responseFrom()) throw new Error('Port 8795 is already in use.');
const server = spawn('python3', ['-m', 'http.server', '8795', '--bind', '127.0.0.1'], {
  cwd: root,
  stdio: 'ignore',
});
let exited = false;
server.on('error', () => (exited = true));
server.on('exit', () => (exited = true));
let browser;
try {
  for (let tries = 0; !(await responseFrom())?.ok; tries++) {
    if (exited || tries >= 50) throw new Error('Benchmark server failed.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: ['--headless=new', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl-egl'],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    window.__territoryRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (frame) => {
      window.__territoryFrame = frame;
      return 0;
    };
    localStorage.setItem(
      'settlers.prefs',
      JSON.stringify({
        muted: true,
        music: false,
        reducedMotion: false,
        weather: true,
        quality: 1,
      }),
    );
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin + '/tests/game.html?seed=2024&renderbench');
  await page.waitForFunction(() => window.productionArtPreview?.game, null, {
    polling: 100,
    timeout: 60000,
  });
  const gpu = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    const gl = document.getElementById('pixi-view').getContext('webgl2');
    if (!gl || !g.renderingAvailable) throw new Error('WebGL 2 is unavailable.');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    g.closeLayer('start');
    g.state.paused = true;
    g.state.auto = true;
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  if (isSoftwareRenderer(gpu)) throw new Error('Hardware GPU required: ' + gpu);
  console.log('GPU:', gpu);
  for (let minute = 0; minute < 20; minute++)
    await page.evaluate(() => {
      const g = window.productionArtPreview.game;
      for (let step = 0; step < 3600; step++) g.step(1 / 60, false);
    });
  const colony = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    const hq = g.anyStorage();
    const guard = g.buildings.find((b) => b.type === 'guard' && b.done && b.manned);
    if (!hq || !guard) throw new Error('Reference colony needs storage and a manned outpost.');
    g.state.paused = true;
    g.zi = 3;
    g.z = g.zooms[3];
    g.cam.x = (hq.x + 0.5) * g.TS - g.vw / g.z / 2;
    g.cam.y = (hq.y + 0.5) * g.TS - g.vh / g.z / 2;
    g.clampCam();
    window.__territoryCurrent = g.projectTerritory();
    window.__territoryWithout = g.projectTerritory(guard.id);
    window.__territoryAlternate = false;
    window.__territoryClock = performance.now.bind(performance);
    performance.now = () => 5000;
    for (let frame = 0; frame < 30; frame++) window.__territoryFrame(5000);
    return {
      seconds: Math.round(g.state.time),
      buildings: g.buildings.length,
      units: g.units.length,
      outpost: { x: guard.x, y: guard.y },
    };
  });
  const pairs = [];
  for (let pair = 0; pair < 80; pair++)
    pairs.push(
      await page.evaluate(async () => {
        const g = window.productionArtPreview.game;
        // Native rAF boundaries let the compositor present each sample instead
        // of shifting queued upload/driver stalls onto the next manual draw.
        const measure = () =>
          new Promise((resolve) =>
            window.__territoryRaf(() => {
              const start = window.__territoryClock();
              window.__territoryFrame(5000);
              resolve(window.__territoryClock() - start);
            }),
          );
        const normal = await measure();
        window.__territoryAlternate = !window.__territoryAlternate;
        const previous = g.owned.slice();
        g.owned.set(
          window.__territoryAlternate ? window.__territoryWithout : window.__territoryCurrent,
        );
        g.emitGameEvent('territoryChanged', {});
        const changedCells = g.owned.reduce((n, value, i) => n + (value !== previous[i]), 0);
        const changed = await measure();
        return { normal, changed, extra: changed - normal, changedCells };
      }),
    );
  if (errors.length) throw new Error(errors.join('\n'));
  if (pairs.some((pair) => !pair.changedCells))
    throw new Error('Territory sample changed no cells.');
  const summary = (values) => {
    const sorted = values.toSorted((a, b) => a - b);
    const round = (n) => Number(n.toFixed(3));
    return {
      mean: round(values.reduce((a, b) => a + b, 0) / values.length),
      p50: round(sorted[Math.floor(sorted.length * 0.5)]),
      p95: round(sorted[Math.floor(sorted.length * 0.95)]),
      max: round(sorted.at(-1)),
    };
  };
  const results = {
    gpu,
    seed: 2024,
    viewport: { width: 1920, height: 1080 },
    quality: 1,
    colony,
    normal: summary(pairs.map((p) => p.normal)),
    changed: summary(pairs.map((p) => p.changed)),
    extra: summary(pairs.map((p) => p.extra)),
    pairs,
  };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  await page.screenshot({ path: path.join(out, 'territory.png') });
  console.table({ normal: results.normal, changed: results.changed, extra: results.extra });
  console.log('Results:', path.relative(root, out));
} finally {
  await browser?.close();
  server.kill();
}
