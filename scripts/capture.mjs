import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';

// Capture the release page and the matching development colony with the same
// production Pixi art/renderer, plus a curated set of interface views. Browser
// tests assert behaviour; these images are for people reviewing the look.
const output = new URL('../output/captures/', import.meta.url);
await fs.mkdir(output, { recursive: true });
const views = [];
async function shot(target, name) {
  await target.screenshot({ path: new URL(name + '.png', output).pathname });
  views.push(name);
  console.log(name + ' captured');
}
const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
  ],
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 850 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    window.__raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (frame) => {
      window.__gameFrame = frame;
      return 1;
    };
    localStorage.setItem(
      'settlers.prefs',
      JSON.stringify({ reducedMotion: false, weather: true, quality: 1 }),
    );
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
      console.error(message.text());
    }
  });
  await page.goto('http://127.0.0.1:8765/?seed=2024&capture', { waitUntil: 'domcontentloaded' });
  console.log('Release DOM loaded');
  await page.waitForFunction(() => !document.getElementById('boot'), null, { polling: 100 });
  await page.evaluate(() => {
    console.log('Rendering release frame');
    window.__gameFrame(performance.now());
    console.log('Rendered release frame');
    window.requestAnimationFrame = window.__raf;
  });
  console.log('Clicking settle');
  await page.getByRole('button', { name: 'SETTLE!', exact: true }).click({ force: true });
  console.log('Reading GPU canvas');
  const releaseImage = await page
    .locator('#pixi-view')
    .evaluate((canvas) => canvas.toDataURL('image/png'));
  await fs.writeFile(
    new URL('release.png', output),
    Buffer.from(releaseImage.split(',')[1], 'base64'),
  );
  console.log('Release frame captured');

  // Restart the release page's own frame loop, so it follows the resize.
  await page.evaluate(() => requestAnimationFrame(window.__gameFrame));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(
    () =>
      document.getElementById('pixi-view').getBoundingClientRect().right >= innerWidth - 1 &&
      !document.getElementById('spd').textContent.includes('SUSPENDED'),
  );
  await shot(page, 'hud');
  await shot(page.locator('#minimap-panel'), 'minimap');

  // Panels open on the standard development colony; frames are submitted
  // explicitly so every view shows the same paused moment.
  await page.goto('http://127.0.0.1:8765/tests/game.html?seed=2024&capture', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => !!window.productionArtPreview?.game, null, { polling: 100 });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { polling: 100 });
  const frame = () => page.evaluate(() => window.__gameFrame(performance.now()));
  await frame();
  await page.locator('#startb').click();
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.state.paused = true;
    game.inspectContributor(game.anyStorage().id);
    game.hudTick();
  });
  await frame();
  await shot(page, 'panel-inspector');
  for (const workspace of ['colony', 'economy', 'logistics']) {
    const toggle = page.locator('#atlas-toggle');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await page.locator(`#workspace-nav [data-workspace="${workspace}"]`).click();
    await frame();
    await shot(page, 'panel-' + workspace);
  }

  // The economy display yard shows the painted production buildings up close.
  await page.goto('http://127.0.0.1:8765/tests/game.html?economyshot&seed=2024&z=4&capture', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => !!window.productionArtPreview?.game, null, { polling: 100 });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { polling: 100 });
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.hudTick();
    window.__gameFrame(performance.now());
  });
  await shot(page, 'buildings');
  await page.setViewportSize({ width: 1200, height: 850 });

  await page.goto('http://127.0.0.1:8765/tests/game.html?devshot&detail&seed=2024&adv=0&capture', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => !!window.productionArtPreview, null, { polling: 100 });
  await page.evaluate(() => {
    window.requestAnimationFrame = window.__raf;
  });
  await page.evaluate(() => {
    for (const id of ['adv', 'palette', 'mini', 'hint', 'tooltip', 'devres']) {
      const element = document.getElementById(id);
      if (element) element.style.display = 'none';
    }
    const game = window.productionArtPreview.game;
    game.hoverIn = false;
    game.presentationPrefs.reducedMotion = true;
    game.presentationPrefs.weather = false;
    game.units.forEach((unit, i) => {
      unit.x = 50.1 + (i % 3) * 0.45;
      unit.y = 49.7 + Math.floor(i / 3) * 0.65;
      unit.carry = ['planks', 'logs', 'stone', 'gold', 'food', 'tools'][i % 6];
      unit.faceDX = i % 2 ? 1 : -1;
      unit.faceDY = (i % 3) - 1;
    });
    if (window.productionRendererStats.backend !== 'PixiJS WebGL')
      throw new Error('Pixi renderer did not initialize');
    if (!game.ART.paintedTerrain) throw new Error('Painted assets did not load');
  });
  const scenes = [];
  for (const [scene, zoom] of [
    ['overview', 1.3],
    ['detail', 2.2],
  ]) {
    const result = await page.evaluate((zoom) => {
      const game = window.productionArtPreview.game;
      game.z = zoom;
      game.cam.x = 49.5 * game.TS - game.vw / zoom / 2;
      game.cam.y = 46.5 * game.TS - game.vh / zoom / 2;
      game.clampCam();
      game.draw();
      return {
        image: window.productionArtPreview.canvas.toDataURL('image/png'),
        stats: game.renderStats,
        renderer: window.productionRendererStats,
        art: game.ART.paintedStatus,
      };
    }, zoom);
    await fs.writeFile(
      new URL(scene + '.png', output),
      Buffer.from(result.image.split(',')[1], 'base64'),
    );
    delete result.image;
    scenes.push({ scene, ...result });
    console.log(scene + ' captured');
  }
  // Advance only the display clock: the artificial inventory remains unchanged.
  // This shows real renderer animation without simulating the screenshot fixture.
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.presentationPrefs.reducedMotion = false;
    game.presentationPrefs.weather = true;
    game.state.paused = false;
    game.step = (dt) => {
      game.state.time += dt;
    };
  });
  const frames = new URL('frames/', output);
  await fs.mkdir(frames, { recursive: true });
  for (let frame = 0; frame < 40; frame++) {
    await page.waitForTimeout(100);
    const image = await page.evaluate(() => {
      window.productionArtPreview.game.state.time += 0.1;
      window.productionArtPreview.game.draw();
      return window.productionArtPreview.canvas.toDataURL('image/png');
    });
    await fs.writeFile(
      new URL(String(frame).padStart(3, '0') + '.png', frames),
      Buffer.from(image.split(',')[1], 'base64'),
    );
  }
  const animation = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    return { stats: game.renderStats, burstEffects: game.FXL.length };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.presentationPrefs.quality = 0.75;
    game.resize();
    game.z = 0.6;
    game.draw();
    game.presentationPrefs.reducedMotion = true;
    game.draw();
  });
  if (errors.length) throw new Error(errors.join('; '));
  await fs.writeFile(
    new URL('capture.json', output),
    JSON.stringify({ views, scenes, animation, errors }, null, 2),
  );
  await promisify(execFile)('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    '10',
    '-i',
    new URL('frames/%03d.png', output).pathname,
    '-vf',
    'scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192[p];[b][p]paletteuse=dither=sierra2_4a',
    new URL('particles.gif', output).pathname,
  ]);
  await fs.rm(frames, { recursive: true, force: true });
  console.log(JSON.stringify({ views, scenes, animation, errors }, null, 2));
  await context.close();
} finally {
  await browser.close();
}
