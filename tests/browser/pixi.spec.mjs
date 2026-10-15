import { test, expect } from '@playwright/test';

// Exercise a real WebGL renderer on machines without a physical display/GPU.
test.use({
  launchOptions: {
    args: [
      '--enable-webgl',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-accelerated-2d-canvas',
    ],
  },
});

test.setTimeout(60000);

function captureErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function frozenGame(page) {
  await page.addInitScript(() => {
    // Manual draws make cache verification independent of browser scheduling.
    window.requestAnimationFrame = (frame) => {
      window.__testGameFrame = frame;
      return 0;
    };
    localStorage.setItem(
      'settlers.prefs',
      JSON.stringify({ reducedMotion: true, weather: false, quality: 1 }),
    );
  });
  await page.goto('/tests/game.html?devshot&detail&capture&seed=2024');
  await page.waitForFunction(() => window.productionArtPreview?.game, null, { polling: 100 });
  await page.evaluate(() => window.productionArtPreview.game.draw());
}

test('production boots with painted artwork and native Pixi rendering', async ({ page }) => {
  const errors = captureErrors(page);
  const sheets = new Map();
  page.on('response', (response) => {
    const match = response.url().match(/\/assets\/art\/(buildings|foliage|meadow)\.png$/);
    if (match) sheets.set(match[1], response.status());
  });
  await page.goto('/?seed=2024');
  await expect(page.getByRole('button', { name: 'SETTLE!', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.productionRendererStats?.backend), { timeout: 30000 })
    .toBe('PixiJS WebGL');
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'pixi');
  await expect(page.locator('#pixi-view')).toBeVisible();
  await expect(page.locator('#view')).toHaveCSS('opacity', '0');
  await expect(page.locator('#painted-art-status')).toHaveCount(0);
  expect(Object.fromEntries(sheets)).toEqual({ buildings: 200, foliage: 200, meadow: 200 });
  await expect
    .poll(() => page.evaluate(() => window.productionRendererStats?.nativeSprites || 0), {
      timeout: 30000,
    })
    .toBeGreaterThan(0);
  const stats = await page.evaluate(() => window.productionRendererStats);
  expect(stats.nativeSprites).toBeGreaterThan(0);
  expect(stats.nativeGraphics).toBeGreaterThan(0);
  expect(stats.cachedTextures).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'SETTLE!', exact: true }).click({ force: true });
  await expect(page.locator('#start')).toBeHidden();
  expect(errors).toEqual([]);
});

test('repeated native frames reuse installed painted textures without uploads', async ({
  page,
}) => {
  const errors = captureErrors(page);
  await frozenGame(page);
  const result = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    // Freeze cosmetic time as well as simulation for genuinely unchanged frames.
    performance.now = () => 5000;
    game.draw();
    game.draw();
    const canvas = document.querySelector('#pixi-view');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    let rasterUploads = 0;
    const originals = {};
    for (const name of ['texImage2D', 'texSubImage2D']) {
      originals[name] = gl[name];
      gl[name] = function (...args) {
        rasterUploads++;
        return originals[name].apply(this, args);
      };
    }
    const before = { ...window.productionRendererStats };
    const simulation = JSON.stringify({ state: game.state, tiles: game.tiles, units: game.units });
    for (let frame = 0; frame < 5; frame++) game.draw();
    const after = { ...window.productionRendererStats };
    const unchangedUploads = rasterUploads;
    const simulationUnchanged =
      JSON.stringify({ state: game.state, tiles: game.tiles, units: game.units }) === simulation;
    // Road/harvest tile redraws must refresh the installed terrain texture.
    game.drawTile(game.sctx, game.idx(game.buildings[0].x, game.buildings[0].y));
    game.draw();
    for (const name of Object.keys(originals)) gl[name] = originals[name];
    return {
      before,
      after,
      unchangedUploads,
      simulationUnchanged,
      dirty: { ...window.productionRendererStats },
      painted: game.ART.paintedStatus.state,
      buildingTypes: Object.keys(game.ART.bld).length,
      treeSpecies: game.ART.tree[3].length,
      terrain: Boolean(game.ART.paintedTerrain),
    };
  });
  expect(result.painted).toBe('loaded');
  expect(result.buildingTypes).toBe(22);
  expect(result.treeSpecies).toBe(3);
  expect(result.terrain).toBe(true);
  expect(result.after.backend).toBe('PixiJS WebGL');
  expect(result.after.textureUploads).toBe(result.before.textureUploads);
  expect(result.after.textureUpdates).toBe(result.before.textureUpdates);
  expect(result.after.cachedTextures).toBe(result.before.cachedTextures);
  expect(result.after.spriteFrameUpdates).toBe(result.before.spriteFrameUpdates);
  expect(result.after.graphicsBuilds).toBe(result.before.graphicsBuilds);
  expect(result.unchangedUploads).toBe(0);
  expect(result.simulationUnchanged).toBe(true);
  // A dirty tile must refresh the terrain texture — as a full update or a
  // partial sub-region upload.
  const refreshes = (s) => s.textureUpdates + (s.partialTextureUpdates || 0);
  expect(refreshes(result.dirty)).toBeGreaterThan(refreshes(result.after));
  expect(result.dirty.textureUploads).toBe(result.after.textureUploads);
  expect(result.dirty.cachedTextures).toBe(result.after.cachedTextures);
  expect(errors).toEqual([]);
});

test('road plans render and refresh through real terrain events while paused', async ({ page }) => {
  const errors = captureErrors(page);
  await frozenGame(page);
  const before = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    performance.now = () => 5000;
    game.state.paused = true;
    const hq = game.anyStorage();
    let endpoints;
    for (let y = hq.y - 5; y <= hq.y + 5 && !endpoints; y++)
      for (let x = hq.x - 7; x <= hq.x + 4 && !endpoints; x++) {
        const a = { x, y };
        const b = { x: x + 3, y };
        const plan = game.planRoad(a, b);
        if (plan.ok && plan.count === 4 && plan.path.length === 3) endpoints = { a, b };
      }
    if (!endpoints) throw new Error('No short clear road in the seeded colony');
    game.setMode('road');
    game.anchor = endpoints.a;
    game.ht = endpoints.b;
    game.hoverIn = true;
    game.cam.x = (endpoints.a.x + 2) * game.TS - game.vw / game.z / 2;
    game.cam.y = (endpoints.a.y + 0.5) * game.TS - game.vh / game.z / 2;
    game.clampCam();
    const colony = JSON.stringify({
      state: game.state,
      tiles: game.tiles,
      buildings: game.buildings,
      units: game.units,
      jobs: game.jobs,
      rng: game.SR.getState(),
    });
    game.draw();
    const preview = game._roadCache;
    game.draw();
    const stats = window.productionRendererStats;
    return {
      endpoints,
      preview,
      reused: game._roadCache === preview,
      unchanged:
        colony ===
        JSON.stringify({
          state: game.state,
          tiles: game.tiles,
          buildings: game.buildings,
          units: game.units,
          jobs: game.jobs,
          rng: game.SR.getState(),
        }),
      roadsBuilt: game.state.roadsBuilt,
      time: game.state.time,
      rng: game.SR.getState(),
      refreshes: stats.textureUpdates + (stats.partialTextureUpdates || 0),
    };
  });
  expect(before.preview.count).toBe(4);
  expect(before.preview.summary).toContain('4 new tiles');
  expect(before.preview.afterSeconds).toBeLessThan(before.preview.beforeSeconds);
  expect(before.reused).toBe(true);
  expect(before.unchanged).toBe(true);
  await page.screenshot({ path: test.info().outputPath('road-plan-preview.png') });
  const after = await page.evaluate(({ a, b }) => {
    const game = window.productionArtPreview.game;
    const committed = game.commitRoad(a, b);
    game.draw(); // Real tileChanged observers must invalidate the same-frame preview.
    const stats = window.productionRendererStats;
    return {
      committed,
      preview: game._roadCache,
      roadsBuilt: game.state.roadsBuilt,
      time: game.state.time,
      rng: game.SR.getState(),
      refreshes: stats.textureUpdates + (stats.partialTextureUpdates || 0),
      backend: stats.backend,
    };
  }, before.endpoints);
  expect(after.committed).toBe(true);
  expect(after.roadsBuilt - before.roadsBuilt).toBe(before.preview.count);
  expect(after.preview.count).toBe(0);
  expect(after.preview.summary).toContain('0 new tiles');
  expect(after.preview.beforeSeconds).toBeCloseTo(before.preview.afterSeconds, 8);
  expect(after.refreshes).toBeGreaterThan(before.refreshes);
  expect(after.time).toBe(before.time);
  expect(after.rng).toBe(before.rng);
  expect(after.backend).toBe('PixiJS WebGL');
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('road-plan-built.png') });
});

test('scene capture failure pauses the colony and reports the graphics error visibly', async ({
  page,
}) => {
  const errors = captureErrors(page);
  await frozenGame(page);
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.state.paused = false;
    game.drawVillageYard = () => {
      throw new Error('Scene capture failed');
    };
    game.draw();
  });
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'unavailable');
  await expect(page.locator('#renderer-status')).toContainText('Scene capture failed');
  await expect(page.locator('#renderer-status')).toHaveAttribute('role', 'alert');
  expect(await page.evaluate(() => window.productionArtPreview.game.state.paused)).toBe(true);
  await page.evaluate(() => window.productionArtPreview.game.draw());
  expect(errors).toEqual([]);
});

test('clarity keeps camera, simulation and artwork anchors intact and reuses native textures', async ({
  page,
}) => {
  const errors = captureErrors(page);
  await frozenGame(page);
  await page.evaluate(() => {
    performance.now = () => 5000;
    const game = window.productionArtPreview.game;
    game.z = 1;
    const sawmill = game.buildings.find((b) => b.type === 'sawmill');
    sawmill.blockedReason = 'inputs';
    sawmill.stock.logs = 0;
    game.draw();
  });
  await page.screenshot({ path: test.info().outputPath('standard-view.png') });
  const result = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    const snapshot = () =>
      JSON.stringify({
        state: game.state,
        tiles: game.tiles,
        units: game.units,
        rng: game.SR.getState(),
        buildings: game.buildings.map(({ id, x, y, timer, stock, metrics, blockedReason }) => ({
          id,
          x,
          y,
          timer,
          stock,
          metrics,
          blockedReason,
        })),
        camera: game.cam,
        zoom: game.z,
        anchors: Object.values(game.ART.bld).map(({ w, h, ox, oy }) => ({ w, h, ox, oy })),
      });
    const before = snapshot();
    game.presentationPrefs.clarity = true;
    document.body.classList.add('clarity-view');
    game.draw();
    game.draw();
    const warm = { ...window.productionRendererStats };
    for (let i = 0; i < 4; i++) game.draw();
    const after = { ...window.productionRendererStats };
    game.presentationPrefs.quality = 0.75;
    game.resize();
    game.draw();
    return {
      unchanged: snapshot() === before,
      warm,
      after,
      lowQuality: window.productionRendererStats.backend,
    };
  });
  expect(result.unchanged).toBe(true);
  expect(result.lowQuality).toBe('PixiJS WebGL');
  expect(result.after.textureUploads).toBe(result.warm.textureUploads);
  expect(result.after.textureUpdates).toBe(result.warm.textureUpdates);
  expect(result.after.partialTextureUpdates).toBe(result.warm.partialTextureUpdates);
  expect(result.after.graphicsBuilds).toBe(result.warm.graphicsBuilds);
  await page.screenshot({ path: test.info().outputPath('clarity-view.png') });
  expect(errors).toEqual([]);
});

test('producer inspector switches recent and lifetime rates without changing paused history', async ({
  page,
}) => {
  const errors = captureErrors(page);
  await frozenGame(page);
  const metrics = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    const mill = game.buildings.find((b) => b.type === 'sawmill');
    game.buildings = [game.buildings[0], mill];
    game.units = [];
    game.jobs = [];
    game.spawnT = game.serfT = 1e6;
    game.state.paused = false;
    mill.timer = 0;
    for (let i = 0; i < 240; i++) {
      mill.stock.logs = 4;
      mill.stock.planks = 0;
      game.step(0.25);
    }
    mill.stock.logs = mill.stock.planks = 0;
    for (let i = 0; i < 180; i++) game.step(0.25);
    game.state.paused = true;
    game.selected = mill;
    delete mill._st;
    game.updateInfo();
    game.draw();
    return JSON.stringify(mill.metrics);
  });
  const window = page.locator('[data-rate-window]');
  const stats = page.locator('[data-production-stats]');
  await expect(window).toHaveValue('30');
  await expect(stats.locator('[data-produced-rate]')).toHaveText('0.0');
  await expect(stats.getByRole('meter')).toHaveAttribute('aria-valuenow', '100');
  await expect(stats).toContainText('2s samples');
  await window.focus();
  await window.selectOption('lifetime');
  await expect(window).toBeFocused();
  await expect(stats.locator('[data-produced-rate]')).not.toHaveText('0.0');
  await expect(stats).toContainText('Observed 105.0s of simulation time');
  await window.selectOption('120');
  await expect(window).toHaveValue('120');
  await page.screenshot({ path: test.info().outputPath('recent-rates-inspector.png') });
  const after = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    for (let i = 0; i < 3; i++) game.draw();
    return JSON.stringify(game.selected.metrics);
  });
  expect(after).toBe(metrics);
  expect(errors).toEqual([]);
});

test('actual frame loop shows restrained economic transitions at 8x even when muted', async ({
  page,
}) => {
  const errors = captureErrors(page);
  await frozenGame(page);
  const notices = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    const mill = game.buildings.find((b) => b.type === 'sawmill');
    game.buildings = [game.buildings[0], mill];
    game.units = [];
    game.jobs = [];
    game.msgs.length = 0;
    game.spawnT = game.serfT = 1e6;
    game.state.paused = false;
    game.state.speed = 8;
    game.setMuted(true);
    mill.timer = 0;
    let now = 1000;
    performance.now = () => now;
    const observed = [];
    const update = game.updateEconomicFeedback;
    game.updateEconomicFeedback = (time, active) => {
      const notice = update(time, active);
      if (notice)
        observed.push({
          kind: notice.kind,
          at: notice.at,
          message: notice.message,
          visible: game.msgs.some((m) => m.t === notice.message),
        });
      return notice;
    };
    // Exercise the real frame loop but submit the GPU scene only for the final
    // capture, avoiding hundreds of unnecessary software-WebGL draws.
    const draw = game.draw;
    game.draw = () => {};
    window.__testGameFrame(now);
    for (let i = 0; i < 10; i++) {
      mill.stock.logs = 4;
      mill.stock.planks = 0;
      window.__testGameFrame((now += 100));
    }
    mill.stock.logs = mill.stock.planks = 0;
    for (let i = 0; i < 220; i++) window.__testGameFrame((now += 100));
    for (let i = 0; i < 200; i++) {
      mill.stock.logs = 4;
      mill.stock.planks = 0;
      window.__testGameFrame((now += 100));
    }
    game.draw = draw;
    game.selected = mill;
    game.updateInfo();
    game.draw();
    return observed;
  });
  expect(notices.map((notice) => notice.kind)).toEqual(['started', 'blocked', 'recovered']);
  expect(notices.every((notice) => notice.visible)).toBe(true);
  expect(notices[1].at - notices[0].at).toBeGreaterThanOrEqual(20000);
  expect(notices[2].at - notices[1].at).toBeGreaterThanOrEqual(20000);
  await expect(page.locator('#msgs')).toHaveAttribute('role', 'log');
  await expect(page.locator('#msgs')).toContainText('production resumed');
  await page.screenshot({ path: test.info().outputPath('muted-economic-recovery.png') });
  const stableLog = await page.evaluate(() => {
    const feed = document.getElementById('msgs');
    const notice = [...feed.children].find((node) =>
      node.textContent.includes('production resumed'),
    );
    const now = performance.now();
    performance.now = () => now + 1000;
    window.productionArtPreview.game.draw();
    window.productionArtPreview.game.hudTick();
    return (
      notice.style.opacity === '1' &&
      notice === [...feed.children].find((node) => node.textContent.includes('production resumed'))
    );
  });
  expect(stableLog).toBe(true);
  expect(errors).toEqual([]);
});

test('failed artwork sheet preserves a usable native renderer and shows fallback', async ({
  page,
}) => {
  const errors = captureErrors(page);
  await page.route('**/assets/art/foliage.png', (route) =>
    route.fulfill({ status: 404, body: 'Artwork unavailable' }),
  );
  await frozenGame(page);
  await expect(page.locator('#painted-art-status')).toContainText('Standard artwork is active');
  const result = await page.evaluate(() => ({
    status: window.productionArtPreview.game.ART.paintedStatus.state,
    terrain: Boolean(window.productionArtPreview.game.ART.paintedTerrain),
    buildingTypes: Object.keys(window.productionArtPreview.game.ART.bld).length,
    renderer: window.productionRendererStats,
  }));
  expect(result.status).toBe('fallback');
  expect(result.terrain).toBe(false);
  expect(result.buildingTypes).toBe(22);
  expect(result.renderer.backend).toBe('PixiJS WebGL');
  expect(result.renderer.nativeSprites).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('unavailable WebGL shows a useful boot error without starting a colony', async ({ page }) => {
  const errors = captureErrors(page);
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return getContext.call(this, type, ...args);
    };
  });
  await page.goto('/tests/game.html?seed=2024');
  await expect(page.locator('#boot')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#boot')).toContainText(/WebGL/i);
  await expect(page.locator('#boot')).toContainText(/required/i);
  await expect(page.locator('#pixi-view')).toHaveCount(0);
  expect(await page.evaluate(() => Boolean(window.productionArtPreview?.game))).toBe(false);
  expect(await page.evaluate(() => window.productionRendererStats.backend)).toBe('unavailable');
  expect(await page.evaluate(() => window.productionRendererStats.error)).toBe('WebGL unavailable');
  expect(errors).toEqual([]);
});

test('WebGL context loss pauses the colony and reports rendering as unavailable', async ({
  page,
}) => {
  const errors = captureErrors(page);
  await frozenGame(page);
  const colony = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.state.paused = false;
    return { buildings: game.buildings.map((building) => building.id), seed: game.seed };
  });
  const supported = await page.locator('#pixi-view').evaluate((canvas) => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  expect(supported).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.productionRendererStats?.backend), { timeout: 30000 })
    .toBe('unavailable');
  await page.evaluate(() => window.productionArtPreview.game.draw());
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'unavailable');
  await expect(page.locator('#renderer-status')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#renderer-status')).toContainText(/WebGL|render/i);
  await expect(page.locator('#renderer-status')).toContainText(/reload/i);
  await expect(page.locator('#pixi-view')).toBeHidden();
  await expect(page.locator('#view')).toHaveCSS('opacity', '0');
  expect(await page.evaluate(() => window.productionArtPreview.game.state.paused)).toBe(true);
  const after = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    return { buildings: game.buildings.map((building) => building.id), seed: game.seed };
  });
  expect(after).toEqual(colony);
  expect(await page.evaluate(() => window.productionRendererStats.error)).toBe(
    'WebGL context lost',
  );
  expect(errors).toEqual([]);
});

test('domain actions retain outpost, gold, contract and upgrade feedback in the native game', async ({
  page,
}) => {
  const errors = captureErrors(page);
  await frozenGame(page);
  const result = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    const hq = game.anyStorage();
    game.buildings = [hq];
    game.units = [];
    game.jobs = [];
    game.msgs.length = 0;
    game.state.auto = false;
    game.setMuted(true);
    game.recomputeTerritory();
    const placed = game.placeBuilding('guard', 51, 48);
    const guard = game.buildings.at(-1);
    guard.got = { ...guard.needs };
    guard.prog = 0.999;
    for (let i = 0; i < 1200; i++) game.step(1 / 60);
    const outpostNotice = game.msgs.some((m) => m.t === 'A soldier mans the outpost');
    const mine = game.newBuilding('mine_gold', 50, 51);
    mine.done = true;
    mine.timer = 1e6;
    game.buildings.push(mine);
    game.spawnCarrier(hq);
    const carrier = game.units.find((u) => u.kind === 'carrier' && u.phase === 'idle');
    const job = { kind: 'deliver', good: 'gold', from: mine.id, state: 't' };
    game.jobs.push(job);
    carrier.job = job;
    carrier.phase = 'd';
    carrier.carry = 'gold';
    carrier.carryTransfer = false;
    carrier.dropB = hq.id;
    carrier.dropIsSite = false;
    carrier.path = [];
    carrier.pi = 0;
    game.step(1 / 60);
    const banked = game.state.gold;
    hq.stock.gold = 30;
    game.state.gold = 30;
    game.claimContract(0);
    game.buyUpgrade('haul');
    game.draw();
    game.drawMini();
    game.hudTick();
    return {
      placed,
      manned: guard.man,
      outpostNotice,
      banked,
      contracts: game.state.contracts,
      level: game.state.upgrades.haul,
    };
  });
  expect(result).toEqual({
    placed: true,
    manned: true,
    outpostNotice: true,
    banked: 1,
    contracts: [0],
    level: 1,
  });
  await expect(page.locator('#msgs')).toContainText('Contract fulfilled: Timber for the realm');
  await expect(page.locator('#msgs')).toContainText('Carrier training upgraded to level 1');
  await page.screenshot({ path: test.info().outputPath('domain-feedback.png') });
  expect(errors).toEqual([]);
});

test('expanded economy buildings render and expose their recipes', async ({ page }) => {
  const errors = captureErrors(page);
  await page.addInitScript(() => {
    window.requestAnimationFrame = (frame) => {
      window.__testGameFrame = frame;
      return 0;
    };
    localStorage.setItem(
      'settlers.prefs',
      JSON.stringify({ reducedMotion: true, weather: false, quality: 0.75, clarity: true }),
    );
  });
  await page.goto('/tests/game.html?economyshot&seed=2024&z=4');
  await page.waitForFunction(() => window.productionArtPreview?.game, null, { polling: 100 });
  const result = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.hudTick();
    game.gameplayHUD();
    game.resize();
    game.drawMini();
    const types = [
      'windmill',
      'bakery',
      'pigfarm',
      'butcher',
      'well',
      'brewery',
      'smelter',
      'workshop',
    ];
    const before = JSON.stringify({
      state: game.state,
      buildings: game.buildings,
      units: game.units,
    });
    game.draw();
    game.draw();
    return {
      art: game.ART.paintedStatus.state,
      buildings: types.map((type) => ({
        type,
        exists: game.buildings.some((building) => building.type === type),
        selectable: !!document.querySelector('.pb[data-b="' + type + '"]'),
      })),
      unchanged:
        before ===
        JSON.stringify({ state: game.state, buildings: game.buildings, units: game.units }),
    };
  });
  expect(result.art).toBe('loaded');
  expect(result.buildings.every((building) => building.exists && building.selectable)).toBe(true);
  expect(result.unchanged).toBe(true);
  await expect(page.locator('#infobody')).toContainText('iron ore');
  await expect(page.locator('#infobody')).toContainText('Iron bars');
  await page.screenshot({ path: test.info().outputPath('expanded-economy.png') });
  expect(errors).toEqual([]);
});

test('mine production dashboard compares edible deliveries and consumption', async ({ page }) => {
  await frozenGame(page);
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    const mine = game.newBuilding('mine_gold', game.W >> 1, (game.H >> 1) + 3);
    mine.done = true;
    Object.assign(mine.metrics, {
      elapsed: 120,
      inputBlocked: 15,
      produced: { gold: 8 },
      consumed: { bread: 3, fish: 5 },
      inputDelivered: { bread: 3, fish: 5 },
      outputDelivered: { gold: 8 },
      deliveryStarted: 0,
      recent: [
        {
          elapsed: 0,
          inputBlocked: 0,
          produced: {},
          consumed: {},
          inputDelivered: {},
          outputDelivered: {},
        },
      ],
    });
    game.selected = mine;
    game.updateInfo();
  });
  await page.locator('[data-rate-window]').selectOption('120');
  const stats = page.locator('[data-production-stats]');
  await expect(stats.locator('[data-produced-rate]')).toHaveText('4.0');
  await expect(stats.locator('[data-delivered-rate]')).toHaveText('4.0');
  await expect(stats.getByRole('meter')).toHaveAttribute('aria-valuenow', '13');
  await expect(stats.locator('.production-resource')).toHaveCount(2);
  await expect(stats.locator('[aria-label="Bread: Consumed 1.5 per minute"]')).toBeVisible();
  await expect(stats.locator('[aria-label="Fish: Delivered in 2.5 per minute"]')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('production-dashboard.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const info = page.locator('#info');
  await expect(info).toBeVisible();
  expect(await info.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('production-dashboard-mobile.png') });
});

test('graphical workload overlay preserves jobs and renders at both quality levels', async ({
  page,
}) => {
  const errors = captureErrors(page);
  await frozenGame(page);
  const before = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    const mill = game.buildings.find((b) => b.type === 'sawmill');
    const farm = game.buildings.find((b) => b.type === 'farm');
    game.jobs = [
      ...Array.from({ length: 4 }, () => ({ kind: 'fetch', to: mill.id, state: 'p' })),
      ...Array.from({ length: 2 }, () => ({
        kind: 'deliver',
        from: mill.id,
        to: farm.id,
        state: 't',
      })),
      { kind: 'fetch', to: farm.id, state: 'p' },
    ];
    game.units[0].job = game.jobs[4];
    game.units[1].job = game.jobs[5];
    game.presentationPrefs.overlay = 'workload';
    game.presentationPrefs.weather = false;
    game.presentationPrefs.clarity = true;
    game.state.paused = true;
    game.draw();
    return JSON.stringify({ jobs: game.jobs, units: game.units, rng: game.state.rng });
  });
  await page.screenshot({ path: test.info().outputPath('workload.png') });
  const after = await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.presentationPrefs.quality = 0.75;
    game.draw();
    game.draw();
    return JSON.stringify({ jobs: game.jobs, units: game.units, rng: game.state.rng });
  });
  expect(after).toBe(before);
  expect(errors).toEqual([]);
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'pixi');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const game = window.productionArtPreview.game;
    game.units = [];
    game.jobs = [];
    game.resize();
    game.draw();
  });
  await page.screenshot({ path: test.info().outputPath('workload-empty-mobile.png') });
  expect(errors).toEqual([]);
});
