import { test, expect, holdFrames, seedPrefs, load } from './helpers/test.mjs';

test('native owners reuse prepared geometry across camera and immediate-scene changes', async ({
  freshPage: page,
}) => {
  await holdFrames(page);
  await seedPrefs(page);
  await load(page);
  const result = await page.evaluate(() => {
    const { presentation: p, owners, renderer } = window.productionArtPreview.internals.pixi;
    const a = {},
      b = {},
      group = {};
    const view = {
      width: 400,
      height: 300,
      cssWidth: 400,
      cssHeight: 300,
      dpr: 1,
      scale: 1,
      camX: 0,
      camY: 0,
    };
    const image = document.createElement('canvas');
    image.width = image.height = 16;
    image.getContext('2d').fillRect(0, 0, 16, 16);
    let paints = 0;
    const paint = (s) => {
      paints++;
      for (let i = 0; i < 256; i++)
        s.image(image, (i % 16) * 16, Math.floor(i / 16) * 16, 16, 16, 1, {
          x: 0,
          y: 0,
          width: 8,
          height: 8,
        });
      s.g.circle(40, 40, 5).fill(0xff0000);
    };
    function draw(first, second) {
      p.begin(view);
      p.layer('objects', (s) => {
        s.group(group, (batch) => {
          batch.retain(a, first);
          batch.retain(b, second);
        });
        s.g.rect(0, 0, 2, 2).fill(0xffffff);
      });
      p.end();
    }
    draw(paint, paint);
    const owner = owners.get(b);
    const graphic = owner.graphics[0];
    const gpu = renderer.graphicsContext.getGpuContext(graphic.context);
    const batch = gpu.batches[0];
    const source = owner.sprites[0].texture.source;
    let uploaded = 0;
    const gl = renderer.gl;
    const upload = gl.bufferSubData;
    gl.bufferSubData = function (...args) {
      uploaded += args[2]?.byteLength || 0;
      return upload.apply(this, args);
    };
    for (let i = 0; i < 4; i++) {
      view.camX += 3;
      view.scale += 0.1;
      draw();
    }
    gl.bufferSubData = upload;
    const bounded = uploaded < 8192; // Four small immediate frames, not 512 sprite quads/frame.
    const reused =
      owners.get(b) === owner &&
      gpu.batches[0] === batch &&
      owner.sprites[0].texture.source === source;
    draw((s) => s.g.rect(1, 1, 4, 4).fill(0x00ff00));
    const independent = gpu.batches[0] === batch;
    p.release(a);
    const released = !owners.has(a);
    p.release(b);
    return {
      paints,
      reused,
      bounded,
      independent,
      released,
      remaining: owners.size,
      destroyed: owner.root.destroyed,
    };
  });
  expect(result).toEqual({
    paints: 2,
    reused: true,
    bounded: true,
    independent: true,
    released: true,
    remaining: 0,
    destroyed: true,
  });
});

test('real nature updates only changed owners through growth, culling, art and world replacement', async ({
  freshPage: page,
}) => {
  await holdFrames(page);
  await seedPrefs(page, { quality: 1, reducedMotion: false, weather: false, muted: true });
  await load(page);
  const result = await page.evaluate(() => {
    const {
      game: g,
      internals: { renderer: r, pixi: p },
    } = window.productionArtPreview;
    let clock = 5000;
    performance.now = () => clock;
    const index = g.idx(50, 50);
    g.cam.x = g.cam.y = 40 * g.TS;
    g.state.paused = false;
    g.tiles[index].tree = 1;
    g.tiles[index].rock = null;
    g.emitGameEvent('tileChanged', { index });
    g.draw();
    const view = r.nature.get(index),
      owner = p.owners.get(view),
      sprite = owner.sprites[0];
    const footprint = [sprite.x, sprite.y, sprite.width, sprite.height];
    const growth = [];
    for (const stage of [2, 3, 4]) {
      g.tiles[index].tree = stage;
      g.emitGameEvent('tileChanged', { index });
      g.draw();
      growth.push(
        p.owners.get(view) === owner &&
          sprite === owner.sprites[0] &&
          footprint.every(
            (v, i) => Math.abs(v - [sprite.x, sprite.y, sprite.width, sprite.height][i]) < 1e-9,
          ),
      );
    }
    g.state.paused = true;
    g.draw();
    let updates = window.productionRendererStats.retainedUpdates;
    clock += 2400;
    g.draw();
    const paused = updates === window.productionRendererStats.retainedUpdates;
    g.state.paused = false;
    g.draw();
    const swaying = window.productionRendererStats.retainedUpdates > updates;
    g.presentationPrefs.reducedMotion = true;
    g.draw();
    updates = window.productionRendererStats.retainedUpdates;
    clock += 2400;
    g.draw();
    const reduced = window.productionRendererStats.retainedUpdates === updates;
    g.presentationPrefs.clarity = true;
    g.draw();
    const clarity = sprite.alpha === 0.62 && footprint[0] === sprite.x && footprint[1] === sprite.y;
    g.cam.x = g.cam.y = 0;
    g.z = 2.2;
    g.draw();
    const culled = !owner.root.parent;
    g.cam.x = g.cam.y = 40 * g.TS;
    g.z = 1;
    g.draw();
    const restored = p.owners.get(view) === owner && owner.sprites[0] === sprite;
    const v = view.hash % 3;
    const replacement = document.createElement('canvas');
    replacement.width = replacement.height = 32;
    g.ART.tree[3][v][0] = replacement;
    g.draw();
    const artChanged = sprite.texture.source.resource === replacement;
    g.tiles[index].tree = 0;
    g.tiles[index].rock = { amt: 10 };
    g.emitGameEvent('tileChanged', { index });
    g.z = 0.7;
    g.draw();
    const pebble = sprite.texture;
    g.z = 0.75;
    g.draw();
    const rock = sprite.texture;
    g.z = 0.7;
    g.draw();
    const threshold = rock !== pebble && sprite.texture === pebble;
    g.tiles[index].rock = null;
    g.emitGameEvent('tileChanged', { index });
    g.draw();
    const removed = !p.owners.has(view) && owner.root.destroyed;
    g.tiles[index].tree = 4;
    g.emitGameEvent('tileChanged', { index });
    g.draw();
    const old = [...p.owners.values()];
    g.tiles = g.tiles.map((t) => ({ ...t }));
    g.emitGameEvent('worldLoaded', { reason: 'load' });
    const released = p.owners.size === 0 && old.every((o) => o.root.destroyed);
    g.draw();
    return {
      growth,
      paused,
      swaying,
      reduced,
      clarity,
      culled,
      restored,
      artChanged,
      threshold,
      removed,
      released,
      reloaded: p.owners.size > 0,
      backend: window.productionRendererStats.backend,
    };
  });
  expect(result).toEqual({
    growth: [true, true, true],
    paused: true,
    swaying: true,
    reduced: true,
    clarity: true,
    culled: true,
    restored: true,
    artChanged: true,
    threshold: true,
    removed: true,
    released: true,
    reloaded: true,
    backend: 'PixiJS WebGL',
  });
});

test('a retained owner update failure reaches visible graphics recovery', async ({
  freshPage: page,
}) => {
  await holdFrames(page);
  await seedPrefs(page);
  await load(page);
  await page.evaluate(() => {
    const {
      game,
      internals: { renderer },
    } = window.productionArtPreview;
    game.draw();
    const view = [...renderer.nature.values()][0];
    view.source = null;
    view.paint = () => {
      throw new Error('Retained artwork update failed');
    };
    game.draw();
  });
  await expect(page.locator('#renderer-status')).toBeVisible();
  await expect(page.locator('#renderer-status')).toContainText('Retained artwork update failed');
  expect(await page.evaluate(() => window.productionArtPreview.game.state.paused)).toBe(true);
});

test('discarded nested batches release ordering identities while keeping owned geometry reusable', async ({
  freshPage: page,
}) => {
  await holdFrames(page);
  await seedPrefs(page);
  await load(page);
  const result = await page.evaluate(() => {
    const { presentation: p, owners } = window.productionArtPreview.internals.pixi;
    const ownerKey = {};
    const source = document.createElement('canvas');
    source.width = source.height = 16;
    const view = {
      width: 200,
      height: 200,
      cssWidth: 200,
      cssHeight: 200,
      dpr: 1,
      scale: 1,
      camX: 0,
      camY: 0,
    };
    function draw(prepare = false) {
      p.begin(view);
      p.layer('objects', (s) =>
        s.group({}, (outer) =>
          outer.group({}, (inner) =>
            inner.retain(ownerKey, prepare ? (s) => s.image(source, 10, 10, 16, 16) : undefined),
          ),
        ),
      );
      p.end();
    }
    draw(true);
    const owner = owners.get(ownerKey),
      sprite = owner.sprites[0];
    let released = true,
      reused = true;
    for (let i = 0; i < 10; i++) {
      const inner = owner.root.parent,
        outer = inner.parent;
      p.begin(view);
      p.end();
      released &&= inner.destroyed && outer.destroyed && owner.root.parent === null;
      draw();
      reused &&= !owner.root.destroyed && owner.sprites[0] === sprite;
    }
    p.release(ownerKey);
    return {
      released,
      reused,
      owners: owners.size,
      backend: window.productionRendererStats.backend,
    };
  });
  expect(result).toEqual({ released: true, reused: true, owners: 0, backend: 'PixiJS WebGL' });
});
