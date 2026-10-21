import { test, expect, frame, holdFrames, load, seedPrefs } from './helpers/test.mjs';

test.setTimeout(60000);

test('frontier construction clears its silhouette without revealing new land', async ({ page }) => {
  const result = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.resetColony(42, 'Frontier roofs', true);
    g.draw();
    const mask = window.productionArtPreview.internals.renderer.fogCanvas;
    const alpha = () => {
      const scale = mask.width / g.W;
      return mask
        .getContext('2d')
        .getImageData(Math.floor(48.5 * scale), Math.floor(37.4 * scale), 1, 1).data[3];
    };
    const before = alpha();
    const discovery = Array.from(g.revealed);
    const allowed = g.canPlace('windmill', 48, 39);
    g.placeBuilding('windmill', 48, 39);
    g.draw();
    return {
      before,
      after: alpha(),
      allowed: allowed[0],
      site: g.buildings.some((b) => b.type === 'windmill' && !b.done && b.x === 48 && b.y === 39),
      discoveryUnchanged: JSON.stringify(discovery) === JSON.stringify(Array.from(g.revealed)),
    };
  });
  expect(result.allowed).toBe(true);
  expect(result.site).toBe(true);
  expect(result.before).toBeGreaterThan(0);
  expect(result.after).toBe(0);
  expect(result.discoveryUnchanged).toBe(true);
});

test('fog has a broad smooth inward fade while unknown and owned land stay protected', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.resetColony(42, 'Soft exploration', true);
    const b = g.newBuilding('guard', 59, 48);
    Object.assign(b, { done: true, constructionProgress: 1, manned: true });
    g.buildings.push(b);
    g.recomputeTerritory();
    g.demolish(b);
    const rng = g.SR.getState();
    const time = g.state.time;
    const revealed = Array.from(g.revealed);
    g.draw();
    const masks = window.productionArtPreview.internals.renderer;
    const measure = (canvas) => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const scale = canvas.width / g.W;
      const alpha = (x, y) =>
        data[(Math.floor(y * scale) * canvas.width + Math.floor(x * scale)) * 4 + 3];
      let hiddenLeaks = 0;
      let ownedFog = 0;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
          const i = g.idx(Math.floor(x / scale), Math.floor(y / scale));
          const a = data[(y * canvas.width + x) * 4 + 3];
          if (!g.isRevealed(i) && a !== 255) hiddenLeaks++;
          if (g.owned[i] && a !== 0) ownedFog++;
        }
      const profile = [];
      for (let x = 63 * scale; x < 71 * scale; x++) profile.push(alpha((x + 0.5) / scale, 48.5));
      return { hiddenLeaks, ownedFog, profile, haze: alpha(66.2, 48.5) };
    };
    const world = measure(masks.fogCanvas);
    const mini = measure(masks.miniFogCanvas);
    const profile = world.profile;
    return {
      haze: world.haze,
      jump: Math.max(...profile.slice(1).map((v, i) => Math.abs(v - profile[i]))),
      intermediate: new Set(profile.filter((v) => v > 0 && v < 255)).size,
      hiddenLeaks: world.hiddenLeaks,
      ownedFog: world.ownedFog,
      mini,
      unchanged: rng === g.SR.getState() && time === g.state.time,
      discoveryUnchanged: JSON.stringify(revealed) === JSON.stringify(Array.from(g.revealed)),
    };
  });
  expect(result.haze).toBeGreaterThan(10);
  expect(result.haze).toBeLessThan(255);
  expect(result.jump).toBeLessThan(64);
  expect(result.intermediate).toBeGreaterThanOrEqual(8);
  expect(result.hiddenLeaks).toBe(0);
  expect(result.ownedFog).toBe(0);
  expect(result.mini.hiddenLeaks).toBe(0);
  expect(result.mini.ownedFog).toBe(0);
  expect(result.mini.haze).toBeLessThan(result.haze);
  expect(result.unchanged).toBe(true);
  expect(result.discoveryUnchanged).toBe(true);
});

test('outpost completion and manning clear the already uploaded fog', async ({ page }) => {
  const result = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    performance.now = () => 5000;
    g.resetColony(42, 'Expansion', true);
    g.state.paused = true;
    g.z = 1;
    g.cam.x = 53 * g.TS;
    g.cam.y = 43 * g.TS;
    const canvas = document.getElementById('pixi-view');
    const gl = canvas.getContext('webgl2');
    const pixel = (x, y) => {
      const data = new Uint8Array(4);
      const scale = canvas.width / g.vw;
      gl.readPixels(
        Math.floor(((x + 0.5) * g.TS - g.cam.x) * scale),
        canvas.height - 1 - Math.floor(((y + 0.5) * g.TS - g.cam.y) * scale),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        data,
      );
      return Array.from(data);
    };
    g.draw();
    const before = [pixel(62, 48), pixel(66, 48), pixel(75, 48), pixel(65, 48)];
    const b = g.newBuilding('guard', 59, 48);
    Object.assign(b, { done: true, constructionProgress: 1 });
    g.buildings.push(b);
    g.recomputeTerritory();
    g.draw();
    const completed = pixel(62, 48);
    b.manned = true;
    g.recomputeTerritory();
    g.draw();
    const manned = pixel(66, 48);
    const owned = pixel(65, 48);
    const unknown = pixel(75, 48);
    const uploads = window.productionRendererStats.textureUpdates;
    g.draw();
    return {
      before,
      completed,
      manned,
      owned,
      claimed: g.owned[g.idx(65, 48)],
      unknown,
      known: [g.isRevealed(g.idx(64, 48)), g.isRevealed(g.idx(68, 48))],
      stable: pixel(66, 48),
      uploads,
      unchangedUploads: window.productionRendererStats.textureUpdates,
    };
  });
  expect(result.known).toEqual([true, true]);
  expect(result.completed).not.toEqual(result.before[0]);
  expect(result.manned).not.toEqual(result.before[1]);
  expect(result.claimed).toBe(1);
  expect(result.owned).not.toEqual(result.before[3]);
  expect(result.unknown).toEqual(result.before[2]);
  expect(result.stable).toEqual(result.manned);
  expect(result.unchangedUploads).toBe(result.uploads);
});

test('exploration choice starts off, stays with the colony, and conceals terrain on the real WebGL map', async ({
  freshPage: page,
}) => {
  await holdFrames(page);
  await seedPrefs(page);
  await load(page);
  await frame(page);
  await expect(page.locator('#new-colony-fog')).not.toBeChecked();
  await page.locator('#new-colony-fog').check();
  await page.locator('#new-colony-seed').fill('42');
  await page.locator('#startb').click();
  await frame(page, 1100);
  const initial = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.state.paused = true;
    g.drawMini();
    g.draw();
    const mini = document.getElementById('mini').getContext('2d');
    g.selectMapTarget(null, { x: 10, y: 10 });
    return {
      enabled: g.state.explorationFog,
      hidden: g.isRevealed(g.idx(10, 10)),
      known: g.isRevealed(g.idx(48, 48)),
      color: Array.from(mini.getImageData(20, 20, 1, 1).data),
      description: document.getElementById('infobody').textContent,
      saved: g.exportSave(),
      camera: { ...g.cam },
    };
  });
  expect(initial.enabled).toBe(true);
  expect(initial.hidden).toBe(false);
  expect(initial.known).toBe(true);
  expect(initial.color).toEqual([68, 76, 72, 255]);
  expect(initial.description).toContain('Unexplored land');
  const result = await page.evaluate((save) => {
    const g = window.productionArtPreview.game;
    for (const quality of [1, 0.75]) {
      g.presentationPrefs.quality = quality;
      g.presentationPrefs.reducedMotion = true;
      g.resize();
      g.draw();
    }
    g.cam.x += 100;
    g.cam.y += 50;
    g.draw();
    const camera = { ...g.cam };
    g.importSave(save);
    g.draw();
    return {
      camera,
      after: { ...g.cam },
      enabled: g.state.explorationFog,
      hidden: g.isRevealed(g.idx(10, 10)),
      failure: document.getElementById('renderer-status').classList.contains('show'),
    };
  }, initial.saved);
  expect(result.enabled).toBe(true);
  expect(result.hidden).toBe(false);
  expect(result.after).toEqual(initial.camera);
  expect(result.failure).toBe(false);
});

test('settlers over unexplored land stay visible and inspectable without revealing their route', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const g = window.productionArtPreview.game;
    g.resetColony(42, 'Walkers', true);
    const before = Array.from(g.revealed);
    const u = g.units[0];
    u.x = 65;
    u.y = 48;
    g.cam.x = 60 * g.TS;
    g.cam.y = 43 * g.TS;
    g.draw();
    g.selectMapTarget(null, { x: 65, y: 48 });
    return {
      before,
      after: Array.from(g.revealed),
      info: document.getElementById('infobody').textContent,
      id: u.id,
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.info).toContain(`carrier #${result.id}`);
  expect(result.info).toContain('Unexplored land');
});
