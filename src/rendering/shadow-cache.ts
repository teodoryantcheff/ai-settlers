import type { GameRuntime } from '../runtime.ts';
import type { Sprite } from '../types.ts';
import { requireCanvas2D } from './canvas-context.ts';
import type { RendererPresentation } from './scene.ts';

/** One world-space shadow layer. Casts and contacts keep separate planes so
 * moonlight/rain can fade the casts without lifting the shade at tree roots. */
export function createShadowCache(
  game: GameRuntime,
  presentation: RendererPresentation,
  failure: (reason: string) => void,
) {
  const width = game.W * game.TS,
    height = game.H * game.TS;
  const cast = game.Acan(width, height),
    contacts = game.Acan(width, height);
  const cg = requireCanvas2D(cast, failure, { willReadFrequently: true });
  const rg = requireCanvas2D(contacts, failure, { willReadFrequently: true });
  const chunkSize = game.TS * 8,
    columns = Math.ceil(width / chunkSize),
    rows = Math.ceil(height / chunkSize);
  const dirty = new Set<number>();
  const trees = new Uint8Array(game.W * game.H);
  const tinted = new WeakMap<object, HTMLCanvasElement>();
  let full = true,
    paints = 0;
  let buildings = new Map<number, { x: number; y: number; art: Sprite }>();

  function dirtyBounds(left: number, top: number, right: number, bottom: number) {
    for (
      let cy = Math.max(0, Math.floor(top / chunkSize));
      cy <= Math.min(rows - 1, Math.floor(bottom / chunkSize));
      cy++
    )
      for (
        let cx = Math.max(0, Math.floor(left / chunkSize));
        cx <= Math.min(columns - 1, Math.floor(right / chunkSize));
        cx++
      )
        dirty.add(cy * columns + cx);
  }
  function dirtyBuilding(x: number, y: number, art: Sprite) {
    const dx = art.ox - 12,
      dy = art.oy - 22;
    dirtyBounds(
      x * game.TS + 12 + dx - 0.64 * (dy + art.h) - 1,
      y * game.TS + 22 - 0.38 * (dy + art.h) - 1,
      x * game.TS + 12 + dx + art.w - 0.64 * dy + 1,
      y * game.TS + 22 - 0.38 * dy + 1,
    );
  }
  function tint(source: HTMLCanvasElement) {
    if (typeof source !== 'object' || !source.width || !source.height) return source;
    const existing = tinted.get(source);
    if (existing) return existing;
    const canvas = game.Acan(source.width, source.height);
    const g = requireCanvas2D(canvas, failure, { willReadFrequently: true });
    g.drawImage(source, 0, 0);
    const pixels = g.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] = Math.round((pixels.data[i] * 36) / 255);
      pixels.data[i + 1] = Math.round((pixels.data[i + 1] * 60) / 255);
      pixels.data[i + 2] = Math.round((pixels.data[i + 2] * 51) / 255);
    }
    g.putImageData(pixels, 0, 0);
    tinted.set(source, canvas);
    return canvas;
  }
  function project(
    source: HTMLCanvasElement,
    x: number,
    y: number,
    dx: number,
    dy: number,
    w: number,
    h: number,
  ) {
    cg.save();
    cg.transform(1, 0, -0.64, -0.38, x, y);
    cg.globalAlpha = 0.17;
    cg.drawImage(tint(source), dx, dy, w, h);
    cg.restore();
  }
  function paint(rect: { x: number; y: number; width: number; height: number }) {
    for (const g of [cg, rg]) {
      g.save();
      g.beginPath();
      g.rect(rect.x, rect.y, rect.width, rect.height);
      g.clip();
      g.clearRect(rect.x, rect.y, rect.width, rect.height);
    }
    // Include off-region roots whose projected canopies cross this chunk.
    const x0 = Math.max(0, Math.floor(rect.x / game.TS) - 5),
      x1 = Math.min(game.W - 1, Math.ceil((rect.x + rect.width) / game.TS) + 5);
    const y0 = Math.max(0, Math.floor(rect.y / game.TS) - 5),
      y1 = Math.min(game.H - 1, Math.ceil((rect.y + rect.height) / game.TS) + 5);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = game.idx(x, y),
          tile = game.tiles[i];
        if (!tile.tree) continue;
        const hash = game.tileHash(i),
          scale = 0.87 + ((hash >> 3) % 15) / 100;
        const jx = ((hash >> 2) % 7) - 3,
          jy = ((hash >> 5) % 5) - 2;
        const w = 38 * scale,
          h = 46 * scale;
        project(
          game.ART.tree[tile.tree - 1][hash % 3][0],
          x * game.TS + 10.5 + jx,
          y * game.TS + 28.5 + jy,
          -w / 2,
          -h,
          w,
          h,
        );
        rg.drawImage(
          game.ART.shadowSoft,
          x * game.TS + 10.5 + jx - 9 * scale,
          y * game.TS + 25.5 + jy,
          20 * scale,
          7 * scale,
        );
      }
    for (const { x, y, art } of buildings.values()) {
      project(art.img, x * game.TS + 12, y * game.TS + 22, art.ox - 12, art.oy - 22, art.w, art.h);
    }
    cg.restore();
    rg.restore();
    paints++;
  }
  function refresh() {
    const current = new Map<number, { x: number; y: number; art: Sprite }>();
    for (const b of game.buildings)
      if (b.done) {
        const art = game.bldImg(b),
          old = buildings.get(b.id);
        current.set(b.id, { x: b.x, y: b.y, art });
        if (
          !old ||
          old.x !== b.x ||
          old.y !== b.y ||
          old.art.img !== art.img ||
          old.art.w !== art.w ||
          old.art.h !== art.h ||
          old.art.ox !== art.ox ||
          old.art.oy !== art.oy
        ) {
          if (old) dirtyBuilding(old.x, old.y, old.art);
          dirtyBuilding(b.x, b.y, art);
        }
      }
    for (const [id, old] of buildings) if (!current.has(id)) dirtyBuilding(old.x, old.y, old.art);
    buildings = current;
    if (full) {
      paint({ x: 0, y: 0, width, height });
      for (let i = 0; i < trees.length; i++) trees[i] = game.tiles[i].tree;
      presentation.invalidate(cast);
      presentation.invalidate(contacts);
    } else
      for (const key of dirty) {
        const x = (key % columns) * chunkSize,
          y = Math.floor(key / columns) * chunkSize;
        const rect = {
          x,
          y,
          width: Math.min(chunkSize, width - x),
          height: Math.min(chunkSize, height - y),
        };
        paint(rect);
        presentation.invalidate(cast, rect);
        presentation.invalidate(contacts, rect);
      }
    full = false;
    dirty.clear();
  }
  return {
    cast,
    contacts,
    refresh,
    get paints() {
      return paints;
    },
    tileChanged(index: number) {
      const tile = game.tiles[index];
      if (!tile || tile.tree === trees[index]) return;
      trees[index] = tile.tree;
      const x = (index % game.W) * game.TS,
        y = Math.floor(index / game.W) * game.TS;
      dirtyBounds(x - 13, y + 22, x + 68, y + 51);
    },
    reset() {
      full = true;
      dirty.clear();
      buildings.clear();
    },
  };
}
