import { FillGradient } from 'pixi.js';
import type { Graphics } from 'pixi.js';
import type { PlacementChecks, BuildingAffordability } from '../simulation/economy.ts';
import type {
  Building,
  BuildingSpec,
  BuildingType,
  Good,
  Inventory,
  PresentationPreferences,
  ProductionBlockReason,
  Sprite,
  Tile,
  TilePoint,
  Unit,
} from '../types.ts';
import { observePresentation } from '../ui/domain-feedback.ts';
import type { GameRuntime } from '../runtime.ts';
import { requireCanvas2D } from './canvas-context.ts';
import { createShadowCache } from './shadow-cache.ts';
import { circlePoints, dashed, rotate, scale, translate } from './scene.ts';
import type { PremultipliedTint, RendererPresentation, SceneLayer } from './scene.ts';

/** Live display pose of one walker, keyed by unit id across frames. */
export interface UnitPose {
  x: number;
  y: number;
  distance: number;
  dir: string;
  dustStep?: number;
}
/** Reconciled building snapshot driving spawn/completion/demolish effects. */
export interface SeenBuilding {
  done: boolean;
  x: number;
  y: number;
  present: boolean;
}
/** Recent production pulse shown as a floating good chip. */
export interface WorkPulse {
  t: number;
  good: Good;
}
/** One scheduled cosmetic effect; `i` seeds its deterministic randomness. */
export interface FXEffect {
  k: string;
  x: number;
  y: number;
  t: number;
  i?: number;
  c?: string;
  r?: number;
  n?: number;
}
/** Cached live placement feedback for the hovered tile (getPlacementPreview). */
export interface PlacementPreview {
  key: string;
  x: number;
  y: number;
  resources: number[];
  checks: PlacementChecks;
  spending: BuildingAffordability;
  canBuild: boolean;
  operatingSupport: { ok: boolean; reason: string } | null;
  path: number[] | null;
  storage: Building | null;
  haulSeconds: number | null;
  summary: string;
}
/** Cached road-drawing feedback for the anchor/hover pair (getRoadPreview). */
export interface RoadPreview {
  key: string;
  ok: boolean;
  reason: string;
  cost: Inventory;
  path: number[] | null;
  paved: Record<number, boolean>;
  count: number;
  beforeSeconds: number;
  afterSeconds: number;
  summary: string;
}
/** In-flight eased zoom tween around a fixed screen/world anchor. */
export interface ZoomAnim {
  t0: number;
  d: number;
  fz: number;
  tz: number;
  ax: number;
  ay: number;
  wx: number;
  wy: number;
}
/** Reused y-sort entry; `o` carries the building/unit for its kind. */
interface SortEntry {
  k: number;
  t: number;
  x: number;
  y: number;
  tl: Tile | null;
  o: Building | Unit | null;
}
/** Border/preview segment as four endpoints: x1, y1, x2, y2. */
type LineSeg = [number, number, number, number];

export function createRenderer(
  game: GameRuntime,
  scenePresentation: RendererPresentation,
  internals?: RendererInternals,
): RendererSubsystem {
  const presentation = scenePresentation;
  function reportGraphicsFailure(reason: string) {
    if (presentation.reportFailure) presentation.reportFailure(reason);
    else {
      presentation.available = false;
      game.emitGameEvent('rendererFailed', { reason });
    }
  }
  let staticDirty = true;
  // ==================== RENDERER ====================
  // Layered presentation over the unchanged simulation:
  //   scan  — cached connected terrain, mineral seams, shadows and roads
  //   bcan  — quiet territory survey line
  //   per-frame — native Pixi graphics for water, y-sorted buildings/trees/rocks/units,
  //   effects and overlays, rebuilt each frame from simulation state

  const scan = game.Acan(game.W * game.TS * game.ST, game.H * game.TS * game.ST),
    sctx = requireCanvas2D(scan, reportGraphicsFailure, { willReadFrequently: true });
  const bcan = game.Acan(game.W * game.TS, game.H * game.TS),
    bctx = requireCanvas2D(bcan, reportGraphicsFailure, { willReadFrequently: true });
  const shadowCache = createShadowCache(game, presentation, reportGraphicsFailure);
  let borderDirty = true;
  const borderOwned = new Uint8Array(game.W * game.H);
  let borderReady = false;
  const FXL: FXEffect[] = [];
  let NOW = 0,
    BAR_H = 44,
    terrainRevision = 0;
  function renderPrefs(): PresentationPreferences {
    return typeof game.presentationPrefs === 'object'
      ? game.presentationPrefs
      : {
          showFps: false,
          atlasExpanded: false,
          minimapVisible: true,
          reducedMotion: false,
          weather: true,
          clarity: false,
          quality: 1,
          overlay: 'none',
        };
  }
  function motionTime(now: number): number {
    return renderPrefs().reducedMotion ? 0 : now;
  }
  const renderStats = {
    samples: 0,
    drawMs: 0,
    frameMs: 0,
    p95Ms: 0,
    objects: 0,
    effects: 0,
    resolution: 1,
  };
  const _frameSamples: number[] = [];
  let _sampleCursor = 0,
    _sampleTotal = 0,
    _perfRefresh = 0;
  function sampleRender(frameMs: number, drawMs: number) {
    renderStats.drawMs = drawMs;
    renderStats.frameMs = frameMs;
    renderStats.samples++;
    if (frameMs > 0 && frameMs < 1000) {
      _frameSamples[_sampleCursor] = frameMs;
      _sampleCursor = (_sampleCursor + 1) % 120;
      _sampleTotal = Math.min(120, _sampleTotal + 1);
    }
    if (NOW - _perfRefresh > 1000 && _sampleTotal) {
      const sorted = _frameSamples.slice(0, _sampleTotal).sort(function (a, b) {
        return a - b;
      });
      renderStats.p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
      _perfRefresh = NOW;
    }
    renderStats.objects = objN;
    renderStats.effects = FXL.length + atmosphereCount;
    renderStats.resolution = dpr;
  }
  sctx.imageSmoothingEnabled = true;
  function tileHash(i: number): number {
    return game.landscapeHash(i % game.W, (i / game.W) | 0, 19) % 1000;
  }
  function diamond(g: Graphics, x: number, y: number, r: number): Graphics {
    return g.poly([x, y - r, x + r, y, x, y + r, x - r, y]);
  }
  // Static scenery is clipped to its tile. Neighbour-aware contours and world-space
  // marks meet at tile edges, so an isolated harvest or road redraw cannot leave a seam.
  function paintTileFull(g: CanvasRenderingContext2D, i: number) {
    const x = i % game.W,
      y = (i / game.W) | 0,
      tl = game.tiles[i],
      TSS = game.TS * game.ST,
      px = x * TSS,
      py = y * TSS,
      h = tileHash(i);
    g.save();
    g.beginPath();
    g.rect(px, py, TSS, TSS);
    g.clip();
    g.translate(px, py);
    g.scale(game.ST, game.ST);
    game.paintLandscapeTile(g, x, y, tl, h);
    g.restore();
  }
  function drawTile(g: CanvasRenderingContext2D, i: number) {
    shadowCache.tileChanged(i);
    terrainRevision++;
    paintTileFull(g, i);
    if (macroCan) paintMacroTile(g, i);
    miniTiles.add(i);
    // Both painters clip to the tile, so the upload can be limited to its rect.
    const tss = game.TS * game.ST;
    presentation.invalidate(g.canvas, {
      x: (i % game.W) * tss,
      y: ((i / game.W) | 0) * tss,
      width: tss,
      height: tss,
    });
  }
  let macroCan: HTMLCanvasElement | null = null;
  function buildMacro() {
    macroCan = game.Acan(game.W, game.H);
    const g = requireCanvas2D(macroCan, reportGraphicsFailure),
      n1 = game.fbm(game.seed + 777),
      n2 = game.fbm(game.seed + 555),
      img = g.createImageData(game.W, game.H);
    for (let y = 0; y < game.H; y++)
      for (let x = 0; x < game.W; x++) {
        const v = n1(x / game.W, y / game.W),
          v2 = n2(x / game.W + 3, y / game.W + 3),
          o = (y * game.W + x) * 4;
        let a = 0;
        if (v > 0.56) {
          a = Math.min(0.13, (v - 0.56) * 0.8);
          img.data[o] = 235;
          img.data[o + 1] = 214;
          img.data[o + 2] = 140;
        } else if (v < 0.44) {
          a = Math.min(0.13, (0.44 - v) * 0.8);
          img.data[o] = 52;
          img.data[o + 1] = 70;
          img.data[o + 2] = 44;
        }
        if (v2 > 0.62) {
          const a2 = Math.min(0.08, (v2 - 0.62) * 0.7);
          if (a2 > a) {
            a = a2;
            img.data[o] = 255;
            img.data[o + 1] = 246;
            img.data[o + 2] = 215;
          }
        }
        img.data[o + 3] = Math.round(a * 255);
      }
    g.putImageData(img, 0, 0);
    return macroCan;
  }
  function paintMacroTile(g: CanvasRenderingContext2D, i: number) {
    if (!macroCan) return;
    // Include surrounding source pixels in the resampling footprint. Enlarging only
    // the centre pixel changes a smooth wash into a conspicuous flat square.
    const x = i % game.W,
      y = (i / game.W) | 0,
      size = game.TS * game.ST;
    g.save();
    g.beginPath();
    g.rect(x * size, y * size, size, size);
    g.clip();
    g.imageSmoothingEnabled = true;
    g.drawImage(macroCan, x - 1, y - 1, 3, 3, (x - 1) * size, (y - 1) * size, 3 * size, 3 * size);
    g.restore();
  }
  const borderChunkTiles = 8,
    borderChunkSize = borderChunkTiles * game.TS,
    borderColumns = Math.ceil(game.W / borderChunkTiles),
    borderRows = Math.ceil(game.H / borderChunkTiles);
  function paintBorderChunk(cx: number, cy: number) {
    const rect = {
      x: cx * borderChunkSize,
      y: cy * borderChunkSize,
      width: Math.min(borderChunkSize, bcan.width - cx * borderChunkSize),
      height: Math.min(borderChunkSize, bcan.height - cy * borderChunkSize),
    };
    const g = bctx;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.beginPath();
    g.rect(rect.x, rect.y, rect.width, rect.height);
    g.clip();
    g.clearRect(rect.x, rect.y, rect.width, rect.height);
    const borderSegs: LineSeg[] = [];
    const minX = Math.max(0, cx * borderChunkTiles - 1),
      minY = Math.max(0, cy * borderChunkTiles - 1),
      maxX = Math.min(game.W - 1, (cx + 1) * borderChunkTiles),
      maxY = Math.min(game.H - 1, (cy + 1) * borderChunkTiles);
    for (let y2 = minY; y2 <= maxY; y2++)
      for (let x2 = minX; x2 <= maxX; x2++) {
        const i2 = game.idx(x2, y2);
        if (!game.owned[i2]) continue;
        const px = x2 * game.TS,
          py = y2 * game.TS;
        for (let d2 = 0; d2 < 4; d2++) {
          const nx2 = x2 + game.DX[d2],
            ny2 = y2 + game.DY[d2];
          if (game.inB(nx2, ny2) && game.owned[game.idx(nx2, ny2)]) continue;
          let s2: LineSeg;
          if (d2 === 0) s2 = [px + game.TS, py, px + game.TS, py + game.TS];
          else if (d2 === 1) s2 = [px, py, px, py + game.TS];
          else if (d2 === 2) s2 = [px, py + game.TS, px + game.TS, py + game.TS];
          else s2 = [px, py, px + game.TS, py];
          borderSegs.push(s2);
        }
      }
    g.lineCap = 'round';
    function strokeAll(col: string, w2: number) {
      g.strokeStyle = col;
      g.lineWidth = w2;
      g.beginPath();
      for (let i = 0; i < borderSegs.length; i++) {
        const s3 = borderSegs[i];
        g.moveTo(s3[0], s3[1]);
        g.lineTo(s3[2], s3[3]);
      }
      g.stroke();
    }
    // A restrained survey line leaves ore, roads and building silhouettes dominant.
    strokeAll('rgba(49,52,27,0.30)', 3.4);
    strokeAll('rgba(244,218,144,0.50)', 1.6);
    strokeAll('rgba(255,239,186,0.72)', 0.65);
    g.restore();
    return rect;
  }
  function drawBorders(full = false) {
    full ||= !borderReady;
    const chunks = new Set<number>();
    if (full) {
      for (let i = 0; i < borderColumns * borderRows; i++) chunks.add(i);
    } else {
      for (let i = 0; i < game.owned.length; i++) {
        if (game.owned[i] === borderOwned[i]) continue;
        miniTiles.add(i);
        const x = (i % game.W) * game.TS,
          y = ((i / game.W) | 0) * game.TS;
        // Include round caps and antialiasing on either side of a chunk edge.
        const x0 = Math.floor(Math.max(0, x - 3) / borderChunkSize),
          y0 = Math.floor(Math.max(0, y - 3) / borderChunkSize),
          x1 = Math.floor(Math.min(bcan.width - 1, x + game.TS + 2) / borderChunkSize),
          y1 = Math.floor(Math.min(bcan.height - 1, y + game.TS + 2) / borderChunkSize);
        for (let cy = y0; cy <= y1; cy++)
          for (let cx = x0; cx <= x1; cx++) chunks.add(cy * borderColumns + cx);
      }
    }
    // Fixed integer clips and identical neighbouring paths make partial paints
    // byte-identical to a full rebuild, including Canvas round-cap rasterization.
    // Separate chunks also keep distant changes from uploading the whole map.
    for (const chunk of chunks) {
      paintBorderChunk(chunk % borderColumns, (chunk / borderColumns) | 0);
    }
    borderOwned.set(game.owned);
    borderReady = true;
    borderDirty = false;
    if (full) presentation.invalidate(bcan);
    else {
      // One upload per connected region avoids repeated driver synchronization
      // for neighbouring chunks while keeping distant changes separate.
      for (const first of chunks) {
        const pending = [first];
        chunks.delete(first);
        let x0 = first % borderColumns,
          x1 = x0,
          y0 = (first / borderColumns) | 0,
          y1 = y0;
        while (pending.length) {
          const chunk = pending.pop();
          if (chunk === undefined) break;
          const x = chunk % borderColumns,
            y = (chunk / borderColumns) | 0;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
          for (let d = 0; d < 4; d++) {
            const nx = x + game.DX[d],
              ny = y + game.DY[d];
            if (nx < 0 || ny < 0 || nx >= borderColumns || ny >= borderRows) continue;
            const next = ny * borderColumns + nx;
            if (chunks.delete(next)) pending.push(next);
          }
        }
        presentation.invalidate(bcan, {
          x: x0 * borderChunkSize,
          y: y0 * borderChunkSize,
          width: Math.min(bcan.width, (x1 + 1) * borderChunkSize) - x0 * borderChunkSize,
          height: Math.min(bcan.height, (y1 + 1) * borderChunkSize) - y0 * borderChunkSize,
        });
      }
    }
  }
  function drawStatic() {
    shadowCache.reset();
    terrainRevision++;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.imageSmoothingEnabled = true;
    for (let y = 0; y < game.H; y++)
      for (let x = 0; x < game.W; x++) paintTileFull(sctx, game.idx(x, y));
    const macro = macroCan || buildMacro();
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(macro, 0, 0, game.W * game.TS * game.ST, game.H * game.TS * game.ST);
    drawBorders(true);
    miniDirty = true;
    miniTiles.clear();
    game.staticDirty = false;
    presentation.invalidate(scan);
  }

  // ---------- camera ----------
  const view = document.getElementById('view') as HTMLCanvasElement;
  const mini = document.getElementById('mini') as HTMLCanvasElement,
    mctx = requireCanvas2D(mini, reportGraphicsFailure);
  let dpr = window.devicePixelRatio || 1,
    z = 1;
  const zooms = [0.55, 0.7, 0.85, 1, 1.3, 1.7, 2.2];
  let zi = 3;
  let cam = { x: 0, y: 0 },
    vw = 0,
    vh = 0;
  const mouse = { x: 0, y: 0 };
  let ht = { x: 0, y: 0 },
    hoverIn = false,
    mouseSeen = false;
  let backdropGradient: FillGradient | null = null;
  function resize() {
    const centerX = cam.x + vw / z / 2,
      centerY = cam.y + vh / z / 2,
      hadViewport = vw > 0 && vh > 0;
    const bar = document.getElementById('bar'),
      prefs = renderPrefs();
    BAR_H = bar ? Math.ceil(bar.getBoundingClientRect().height) : 44;
    const main = document.getElementById('main');
    if (main) main.style.top = '0px';
    document.body.style.setProperty?.('--bar-height', BAR_H + 'px');
    dpr = Math.min(2, window.devicePixelRatio || 1) * (prefs.quality || 1);
    // The DOM map host defines the viewport; input uses this same canvas rect.
    vw = main?.clientWidth || window.innerWidth;
    vh = Math.max(1, main?.clientHeight || window.innerHeight);
    view.width = Math.round(vw * dpr);
    view.height = Math.round(vh * dpr);
    view.style.width = vw + 'px';
    view.style.height = vh + 'px';
    if (!mouseSeen) {
      mouse.x = vw / 2;
      mouse.y = vh / 2;
    }
    if (hadViewport) {
      cam.x = centerX - vw / z / 2;
      cam.y = centerY - vh / z / 2;
    }
    backdropGradient?.destroy();
    backdropGradient = null;
    clampCam();
  }
  function clampCam() {
    const mx = game.W * game.TS - vw / z,
      my = game.H * game.TS - vh / z;
    cam.x = Math.max(0, Math.min(mx, cam.x));
    cam.y = Math.max(0, Math.min(my, cam.y));
    if (mx < 0) cam.x = mx / 2;
    if (my < 0) cam.y = my / 2;
  }
  function screenToWorld(mx: number, my: number): TilePoint {
    return { x: cam.x + mx / z, y: cam.y + my / z };
  }
  let zoomAnim: ZoomAnim | null = null;
  function zoomAt(nzi: number, ax?: number, ay?: number) {
    ax ??= vw / 2;
    ay ??= vh / 2;
    const w = screenToWorld(ax, ay);
    zi = Math.max(0, Math.min(zooms.length - 1, nzi));
    const nz = zooms[zi];
    if (game.TESTMODE || renderPrefs().reducedMotion) {
      z = nz;
      cam.x = w.x - ax / nz;
      cam.y = w.y - ay / nz;
      clampCam();
    } else
      zoomAnim = { t0: performance.now(), d: 150, fz: z, tz: nz, ax: ax, ay: ay, wx: w.x, wy: w.y };
    const w2 = screenToWorld(mouse.x, mouse.y);
    ht.x = Math.floor(w2.x / game.TS);
    ht.y = Math.floor(w2.y / game.TS);
    hoverIn = game.inB(ht.x, ht.y);
    game.refreshGhost();
  }
  function stepZoom(now: number) {
    // eased zoom around the anchor point; cancels cleanly (zoomAnim=null)
    if (!zoomAnim) return;
    const za = zoomAnim,
      p = (now - za.t0) / za.d;
    if (p >= 1) {
      z = za.tz;
      zoomAnim = null;
    } else z = za.fz + (za.tz - za.fz) * (1 - Math.pow(1 - p, 3));
    cam.x = za.wx - za.ax / z;
    cam.y = za.wy - za.ay / z;
    clampCam();
  }
  function miniClick(e: MouseEvent) {
    const r = mini.getBoundingClientRect();
    const fx2 = (e.clientX - r.left) / r.width,
      fy2 = (e.clientY - r.top) / r.height;
    zoomAnim = null;
    cam.x = fx2 * game.W * game.TS - vw / z / 2;
    cam.y = fy2 * game.H * game.TS - vh / z / 2;
    clampCam();
  }
  const keys = { l: false, r: false, u: false, d: false };

  // ---------- objects ----------
  function bldImg(b: Building): Sprite {
    const image = game.ART.bld[b.type];
    if (!image) throw new Error('Missing building artwork: ' + b.type);
    return image;
  }
  // Two small, reusable artwork variants per source. Only the alpha contour is
  // extended; the original pixels, entrance anchor and gameplay footprint stay put.
  const buildingContours = new WeakMap<HTMLCanvasElement, HTMLCanvasElement[]>();
  function buildingContour(img: Sprite) {
    let variants = buildingContours.get(img.img);
    const clarity = renderPrefs().clarity ? 1 : 0,
      pad = 3,
      scale = 2;
    if (!variants) {
      variants = [];
      buildingContours.set(img.img, variants);
    }
    if (variants[clarity]) return variants[clarity];
    const mask = game.Acan((img.w + pad * 2) * scale, (img.h + pad * 2) * scale),
      mg = requireCanvas2D(mask, reportGraphicsFailure),
      canvas = game.Acan(mask.width, mask.height),
      cg = requireCanvas2D(canvas, reportGraphicsFailure);
    mg.drawImage(img.img, pad * scale, pad * scale, img.w * scale, img.h * scale);
    mg.globalCompositeOperation = 'source-in';
    mg.fillStyle = clarity ? '#f1e4b9' : '#233b2c';
    mg.fillRect(0, 0, mask.width, mask.height);
    const radius = (clarity ? 1.5 : 0.65) * scale;
    cg.globalAlpha = clarity ? 0.95 : 0.7;
    for (let d = 0; d < 8; d++) {
      const angle = (d * Math.PI) / 4;
      cg.drawImage(mask, Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    cg.globalAlpha = 1;
    cg.drawImage(img.img, pad * scale, pad * scale, img.w * scale, img.h * scale);
    variants[clarity] = canvas;
    return canvas;
  }
  function drawSprite(s: SceneLayer, type: BuildingType, cx: number, cy: number, alpha: number) {
    const img = game.ART.bld[type];
    if (!img) return;
    s.image(img.img, cx - 12 + img.ox, cy - 12 + img.oy, img.w, img.h, alpha);
  }
  function drawSpriteIcon(
    g: CanvasRenderingContext2D,
    type: BuildingType,
    cx: number,
    cy: number,
    size: number,
  ) {
    const img = game.ART.bld[type] || game.ART.site;
    const s = Math.min(size / img.w, size / img.h);
    const dw = img.w * s,
      dh = img.h * s;
    g.drawImage(img.img, cx - dw / 2, cy - dh / 2, dw, dh);
  }
  const flagSheets = new Map<string, HTMLCanvasElement>();
  function drawFlag(s: SceneLayer, ax: number, ay: number, col: string, now: number, ph: number) {
    const count = 24,
      size = 20,
      resolution = 4;
    let sheet = flagSheets.get(col);
    if (!sheet) {
      sheet = game.Acan(size * resolution * count, size * resolution);
      const paint = requireCanvas2D(sheet, reportGraphicsFailure);
      for (let i = 0; i < count; i++) {
        paint.save();
        paint.translate(i * size * resolution, 0);
        paint.scale(resolution, resolution);
        paintFlag(paint, 2, 3, col, (i / count) * Math.PI * 2 * 240, 0);
        paint.restore();
      }
      flagSheets.set(col, sheet);
    }
    const phase = (motionTime(now) / 240 + ph) / (Math.PI * 2);
    const frame = ((Math.round(phase * count) % count) + count) % count;
    s.image(sheet, ax - 2, ay - 3, size, size, 1, {
      x: frame * size * resolution,
      y: 0,
      width: size * resolution,
      height: size * resolution,
    });
  }
  function paintFlag(
    g: CanvasRenderingContext2D,
    ax: number,
    ay: number,
    col: string,
    now: number,
    ph: number,
  ) {
    g.strokeStyle = '#5a3e22';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(ax, ay + 13);
    g.stroke();
    g.fillStyle = '#e8c477';
    g.beginPath();
    g.arc(ax, ay - 0.8, 1, 0, 7);
    g.fill();
    const fw = Math.sin(now / 240 + ph) * 1.8,
      fw2 = Math.sin(now / 240 + ph + 1.2) * 1.2;
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(ax + 1.2, ay + 0.5);
    g.quadraticCurveTo(ax + 7, ay + 1.2 + fw, ax + 14, ay + 2.6 + fw * 0.6);
    g.lineTo(ax + 10.6, ay + 4.2 + fw2 * 0.4);
    g.quadraticCurveTo(ax + 7, ay + 5.2 + fw2 * 0.5, ax + 1.2, ay + 6.5);
    g.closePath();
    g.fill();
    // highlight stripe along the top of the pennant
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.moveTo(ax + 1.4, ay + 1);
    g.quadraticCurveTo(ax + 6, ay + 1.6 + fw * 0.7, ax + 11, ay + 2.4 + fw * 0.5);
    g.lineTo(ax + 9.6, ay + 3.4 + fw2 * 0.4);
    g.quadraticCurveTo(ax + 6, ay + 3.4 + fw2 * 0.5, ax + 1.4, ay + 3);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.beginPath();
    g.moveTo(ax + 1.2, ay + 4.2);
    g.quadraticCurveTo(ax + 7, ay + 5.2 + fw2 * 0.5, ax + 10.6, ay + 4.2 + fw2 * 0.4);
    g.lineTo(ax + 10.2, ay + 5.6 + fw2 * 0.4);
    g.quadraticCurveTo(ax + 7, ay + 6.4 + fw2 * 0.5, ax + 1.2, ay + 5.4);
    g.closePath();
    g.fill();
  }
  function drawSmoke(s: SceneLayer, x: number, y: number, now: number, sd: number) {
    if (renderPrefs().clarity || renderPrefs().reducedMotion || game.state.paused) return;
    const count = renderPrefs().quality < 1 ? 3 : 5,
      g = s.g;
    for (let k = 0; k < count; k++) {
      const ph = (now / 2200 + (sd % 7) * 0.13 + k / count) % 1;
      const r = 0.9 + ph * 3.4,
        a = 0.19 * Math.sin(Math.PI * ph);
      // Warm translucent smoke catches sunlight, then disperses downwind.
      g.save();
      translate(g, x + ph * 7 + Math.sin(ph * 5 + sd) * 1.6, y - ph * 24);
      rotate(g, -0.3);
      g.ellipse(0, 0, r * 1.35, r).fill({ color: 0xebdcbd, alpha: a });
      g.restore();
    }
  }
  let badgeGradient: FillGradient | null = null,
    progressGradient: FillGradient | null = null;
  function drawBadge(s: SceneLayer, cx: number, cy: number) {
    // Decorative pulse: holds still with the paused frame clock.
    const pulse = renderPrefs().reducedMotion
        ? 1
        : 1 + Math.sin((_pausedNow ?? NOW) / 420 + cx * 0.3) * 0.035,
      g = s.g;
    badgeGradient ??= new FillGradient({
      type: 'linear',
      start: { x: 0, y: -5.5 },
      end: { x: 0, y: 5.5 },
      colorStops: [
        { offset: 0, color: '#ef5a4a' },
        { offset: 1, color: '#a02525' },
      ],
      textureSpace: 'global',
    });
    g.save();
    translate(g, cx, cy);
    scale(g, pulse);
    g.roundRect(-5, -4, 12.6, 12.6, 3.4).fill({ color: 0x000000, alpha: 0.35 });
    g.roundRect(-5.5, -5.5, 11, 11, 3).fill(badgeGradient).stroke({ color: 0xffd0c0, width: 1 });
    // A drawn exclamation mark keeps the whole object pass in one graphics run.
    g.roundRect(-0.8, -3.9, 1.6, 4.5, 0.7).fill(0xffffff);
    g.circle(0, 2.1, 0.9).fill(0xffffff);
    g.restore();
  }
  function chip(g: Graphics, x: number, y: number, c: string, alpha: number) {
    g.roundRect(x, y, 5, 5, 1).fill({ color: 0x000000, alpha: 0.38 * alpha });
    g.roundRect(x + 0.5, y + 0.5, 4, 4, 0.8).fill({ color: c, alpha });
    g.rect(x + 1, y + 0.9, 3.4, 0.9).fill({ color: 0xffffff, alpha: 0.35 * alpha });
  }
  function drawBuilding(s: SceneLayer, b: Building) {
    const g = s.g,
      bx = b.x * game.TS,
      by = b.y * game.TS;
    g.save();
    translate(g, bx + 12, by + 22);
    scale(g, 1.06);
    translate(g, -bx - 12, -by - 22);
    try {
      const now = game.villageWorkTime(b);
      if (!b.done) {
        const p = Math.min(1, Math.max(0, b.constructionProgress));
        game.drawVillageConstruction(s, b, p);
        const bw = game.TS - 16;
        progressGradient ??= new FillGradient({
          type: 'linear',
          start: { x: 0, y: 0 },
          end: { x: bw, y: 0 },
          colorStops: [
            { offset: 0, color: '#ffe08a' },
            { offset: 1, color: '#e8a53c' },
          ],
          textureSpace: 'global',
        });
        g.roundRect(bx + 8, by + game.TS - 5, bw, 3.4, 1.6).fill({ color: 0x000000, alpha: 0.55 });
        if (p > 0) {
          g.save();
          translate(g, bx + 8, by + game.TS - 5);
          g.roundRect(0, 0, bw * p, 3.4, 1.6).fill(progressGradient);
          g.restore();
        }
        g.rect(bx + 8, by + game.TS - 5, bw, 1).fill({ color: 0xffffff, alpha: 0.3 });
        if (game.bStatus(b).bad) drawBadge(s, bx + game.TS - 6, by + 4);
        if (p > 0 && game.siteReady(b)) drawWorker(s, b, now, 'build');
        return;
      }
      const img2 = bldImg(b),
        sp = game.BSPEC[b.type];
      game.drawVillageYard(s, b);
      // Shared restrained contact shade also grounds installed painted packs.
      // Keep it at the established south threshold, below the sprite/details.
      const contactWidth = Math.min(38, img2.w * 0.78);
      s.image(
        game.ART.shadowSoft,
        bx + 12 - contactWidth / 2,
        by + 19,
        contactWidth,
        10,
        renderPrefs().clarity ? 0.28 : 0.5,
      );
      s.image(buildingContour(img2), bx + img2.ox - 3, by + img2.oy - 3, img2.w + 6, img2.h + 6);
      game.drawVillageDetails(s, b);
      const active = game.buildingWorking(b);
      const anc = game.ART.anchors[b.type];
      if (active && anc && anc.blade) {
        const an = anc.blade;
        g.save();
        translate(g, bx + an.x, by + an.y);
        rotate(g, (now / 130) % (Math.PI * 2));
        s.image(game.ART.blade, -4.5, -4.5, 9, 9);
        g.restore();
      }
      if (active && anc && anc.bob) {
        const bo = anc.bob,
          bb = by + bo.y + Math.sin(now / 700 + b.id) * 1.2;
        g.circle(bx + bo.x, bb, 1.6).fill(0xe05555);
        g.circle(bx + bo.x, bb - 0.5, 0.8).fill(0xf4f6f8);
      }
      if (anc) {
        if (anc.flag && (b.type !== 'guard' || b.manned))
          drawFlag(
            s,
            bx + anc.flag.x,
            by + anc.flag.y,
            b.type === 'warehouse' ? '#e8a030' : '#d84a3a',
            now,
            b.id,
          );
        else if (b.type === 'guard' && anc.flag)
          drawFlag(s, bx + anc.flag.x, by + anc.flag.y, '#8f8f8f', now, b.id);
        if (anc.chim && active)
          for (let ci = 0; ci < anc.chim.length; ci++)
            drawSmoke(s, bx + anc.chim[ci].x, by + anc.chim[ci].y, now, b.id * 7 + ci * 3);
      }
      if (game.bStatus(b).bad) drawBadge(s, bx + game.TS - 5, by + 5);
      if (active) drawWorker(s, b, now, sp.prod);
      const pulse = workPulses[b.id];
      if (pulse && performance.now() - pulse.t < 600 && !renderPrefs().reducedMotion) {
        const fade = 1 - (performance.now() - pulse.t) / 600;
        chip(g, bx + 26, by + 12 - fade * 5, game.GOODS[pulse.good].c, fade);
      }
      if (b.disabled) {
        g.rect(bx + 16, by + 3, 2, 7).fill(0xead9b6);
        g.rect(bx + 20, by + 3, 2, 7).fill(0xead9b6);
      }
    } finally {
      g.restore();
    }
  }
  function drawWorker(
    s: SceneLayer,
    b: Building,
    now: number,
    work: BuildingSpec['prod'] | 'build',
  ) {
    if (z < 0.7) return;
    const g = s.g,
      anim = renderPrefs().reducedMotion ? 0 : Math.sin(now / 420 + b.id * 1.7);
    let x = b.x * game.TS + 25,
      y = b.y * game.TS + 18;
    if (work === 'fish') {
      x = b.x * game.TS + 27;
      y = b.y * game.TS + 10;
    }
    if (work === 'mine') {
      x = b.x * game.TS + 20;
      y = b.y * game.TS + 19;
    }
    if (work === 'farm') {
      x = b.x * game.TS + 4 + (Math.floor(now / 5000 + b.id) % 3) * 5;
      y = b.y * game.TS + 20;
    }
    g.ellipse(x, y, 4, 1.2).fill({ color: 0x201c14, alpha: 0.2 });
    g.moveTo(x - 1, y - 3)
      .lineTo(x - 1.5, y)
      .moveTo(x + 1, y - 3)
      .lineTo(x + 1.5, y)
      .stroke({ color: 0x514130, width: 1.4 });
    g.roundRect(x - 2.2, y - 7, 4.4, 4.8, 1).fill(
      work === 'rock' || work === 'mine'
        ? 0x907b68
        : work === 'plant'
          ? 0x6f8b61
          : work === 'build'
            ? 0xb89a60
            : 0x6a91a0,
    );
    g.circle(x, y - 8.6, 1.7).fill(0xe1bf94);
    g.ellipse(x, y - 9.7, 2.4, 0.7).fill(0xc9ad72);
    const hammer = work === 'gather' || work === 'rock' || work === 'build' || work === 'craft';
    const arm = hammer ? anim * 2.2 : anim * 0.8;
    g.moveTo(x + 1.7, y - 6.1)
      .lineTo(x + 4, y - 5 + arm)
      .stroke({ color: 0xd6b38e, width: 1.1 });
    if (hammer) {
      g.moveTo(x + 3.5, y - 4 + arm)
        .lineTo(x + 5.5, y - 8 + arm)
        .stroke({ color: 0x7b5d3b, width: 1 });
      g.rect(x + 4.7, y - 9 + arm, 3, 1.8).fill(work === 'gather' ? 0xc3cbd0 : 0x919da1);
    } else if (work === 'fish') {
      g.moveTo(x + 2, y - 5)
        .lineTo(x + 8, y - 11 + anim * 0.5)
        .stroke({ color: 0x785c39, width: 0.8 });
    } else if (work === 'plant' || work === 'farm') {
      g.moveTo(x + 3, y - 5 + arm)
        .lineTo(x + 5, y + 1)
        .stroke({ color: 0x775c37, width: 0.9 });
    } else if (work === 'mine') {
      const cx = x - 3 + anim * 0.9,
        output = game.BSPEC[b.type].out;
      g.rect(cx, y - 3.2, 6, 2.8).fill(0x6f6a61);
      g.rect(cx + 0.6, y - 4.2, 4.8, 1.8).fill(output ? game.GOODS[output].c : 0x6f6a61);
      g.circle(cx + 1, y, 0.8)
        .circle(cx + 5, y, 0.8)
        .fill(0x403b35);
    }
    if (work) game.drawVillageWorkEffects(s, b, work, now);
    if (work === 'fish' && !game.state.paused && !renderPrefs().reducedMotion) {
      // Cast-line rings only where there really is water beside this fishery.
      for (let side = 0; side < 4; side++) {
        const wx = b.x + game.DX[side],
          wy = b.y + game.DY[side];
        if (!game.inB(wx, wy) || game.tiles[game.idx(wx, wy)].t !== game.WATER) continue;
        const wave = (now / 1800 + b.id * 0.17) % 1;
        g.ellipse(
          (wx + 0.5) * game.TS,
          (wy + 0.5) * game.TS,
          1 + wave * 6,
          0.5 + wave * 2.2,
        ).stroke({ color: 0xf0e8bf, alpha: 0.24 * Math.sin(wave * Math.PI), width: 0.55 });
        break;
      }
    }
  }
  function drawTree(s: SceneLayer, x: number, y: number, tl: Tile, now: number) {
    const h = tileHash(game.idx(x, y)),
      v = h % 3,
      sw = renderPrefs().reducedMotion ? 0 : ((now / 2400 + h * 0.61) | 0) % 2;
    const spr = game.ART.tree[tl.tree - 1][v][sw];
    const jx = ((h >> 2) % 7) - 3,
      jy = ((h >> 5) % 5) - 2;
    const size = 0.87 + ((h >> 3) % 15) / 100,
      tw = 38 * size,
      th = 46 * size;
    s.image(
      spr,
      x * game.TS + 10.5 + jx - tw / 2,
      y * game.TS + 28.5 + jy - th,
      tw,
      th,
      renderPrefs().clarity ? 0.62 : 1,
    );
  }
  const pebbles: HTMLCanvasElement[] = [];
  function pebble(variant: number) {
    if (pebbles[variant]) return pebbles[variant];
    const canvas = game.Acan(44, 28),
      g = requireCanvas2D(canvas, reportGraphicsFailure);
    g.scale(4, 4);
    g.fillStyle = 'rgba(148,143,128,0.9)';
    g.beginPath();
    g.ellipse(5, 3, 2.6 + variant * 0.5, 1.8, 0, 0, 7);
    g.fill();
    g.fillStyle = 'rgba(62,58,50,0.3)';
    g.beginPath();
    g.ellipse(6, 4, 2, 0.9, 0, 0, 7);
    g.fill();
    pebbles[variant] = canvas;
    return canvas;
  }
  function drawRock(s: SceneLayer, x: number, y: number) {
    const h = tileHash(game.idx(x, y));
    if (z < 0.75) {
      const rx2 = ((h >> 2) % 13) - 6,
        ry2 = ((h >> 5) % 11) - 5;
      s.image(pebble(h % 3), x * game.TS + 6 + rx2, y * game.TS + 11 + ry2, 11, 7);
      return;
    }
    s.image(
      game.ART.rock[h % 2],
      x * game.TS - 1 + ((h >> 4) % 5) - 2,
      y * game.TS + 6.4 + ((h >> 6) % 5) - 2,
      24,
      18,
      0.96,
    );
  }
  let unitPoses: Record<string, UnitPose> = {};
  function unitDirection(dx: number, dy: number): string {
    const octant = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
    return ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'][octant];
  }
  function drawUnit(s: SceneLayer, u: Unit, now: number) {
    const px = u.x * game.TS,
      py = u.y * game.TS;
    let pose = unitPoses[u.id];
    if (!pose) pose = unitPoses[u.id] = { x: u.x, y: u.y, distance: 0, dir: 's' };
    const dx = u.x - pose.x,
      dy = u.y - pose.y,
      travel = Math.hypot(dx, dy);
    if (travel < 4) pose.distance += travel;
    pose.x = u.x;
    pose.y = u.y;
    // A zero component is an authoritative horizontal/vertical heading. Falling
    // back to displacement there can turn a walker back toward an earlier segment.
    const fx = u.faceDX !== undefined && Number.isFinite(u.faceDX) ? u.faceDX : dx,
      fy = u.faceDY !== undefined && Number.isFinite(u.faceDY) ? u.faceDY : dy;
    if (Math.abs(fx) + Math.abs(fy) > 0.001) pose.dir = unitDirection(fx, fy);
    s.image(game.ART.shadowSoft, px - 9, py - 2, 18, 9);
    const distance = u.walkDistance === undefined ? pose.distance : u.walkDistance;
    const moving = !game.state.paused && u.path && u.pi < u.path.length;
    const dustStep = Math.floor(distance * 2);
    if (pose.dustStep === undefined) pose.dustStep = dustStep;
    if (
      moving &&
      !renderPrefs().clarity &&
      !renderPrefs().reducedMotion &&
      rainAmt() < 0.2 &&
      travel < 1 &&
      dustStep !== pose.dustStep &&
      (renderPrefs().quality >= 1 || dustStep % 2 === 0)
    ) {
      const groundX = Math.floor(u.x),
        groundY = Math.floor(u.y);
      if (game.inB(groundX, groundY) && game.tiles[game.idx(groundX, groundY)].t !== game.WATER)
        pushFX({ k: 'stepDust', x: u.x, y: u.y, t: now, i: u.id });
    }
    pose.dustStep = dustStep;
    const dirset = game.ART.unitDirections[u.kind]?.[pose.dir];
    if (!dirset) throw new Error('Missing settler artwork: ' + u.kind + '/' + pose.dir);
    const fr = Math.floor(distance * 4) % dirset.walk.length;
    const walking = moving && !renderPrefs().reducedMotion;
    const spr = walking ? dirset.walk[fr] : dirset.idle;
    const footY = py + (walking ? Math.abs(Math.sin(distance * Math.PI)) * 0.25 : 0) - 1;
    s.image(spr, px - 7.5, footY - 18, 15, 19);
    const cargo = u.carry && game.ART.cargo[u.carry];
    if (cargo) {
      const rightFacing = pose.dir === 'e' || pose.dir === 'ne' || pose.dir === 'se';
      let cargoX = rightFacing ? 0.4 : -9.2;
      if (pose.dir === 'n' || pose.dir === 's') cargoX = -5;
      s.image(cargo, px + cargoX, footY - 14, 10, 7.5);
    } else if (u.carry) {
      const g = s.g;
      g.roundRect(px - 7.4, footY - 15.4, 7.6, 5, 1).fill({ color: 0x000000, alpha: 0.28 });
      g.roundRect(px - 7.8, footY - 16, 7.4, 4.8, 1).fill(game.GOODS[u.carry].c);
      g.rect(px - 7, footY - 15.5, 6.4, 1).fill({ color: 0xffffff, alpha: 0.32 });
      if (u.carry === 'gold') g.rect(px - 4.4, footY - 15.2, 1.4, 1).fill(0xfff6c8);
    }
  }
  const objPool: SortEntry[] = [];
  let objN = 0; // reused y-sort entries — no per-frame object churn
  function objGet(): SortEntry {
    let o;
    if (objN < objPool.length) o = objPool[objN++];
    else {
      o = { k: 0, t: 0, x: 0, y: 0, tl: null, o: null };
      objPool.push(o);
      objN++;
    }
    return o;
  }
  function drawObjects(now: number) {
    objN = 0;
    const vx0 = Math.max(0, Math.floor(cam.x / game.TS) - 1),
      vx1 = Math.min(game.W - 1, Math.ceil((cam.x + vw / z) / game.TS) + 1);
    const vy0 = Math.max(0, Math.floor(cam.y / game.TS) - 1),
      vy1 = Math.min(game.H - 1, Math.ceil((cam.y + vh / z) / game.TS) + 1);
    for (let wy = vy0; wy <= vy1; wy++)
      for (let wx = vx0; wx <= vx1; wx++) {
        const wi = game.idx(wx, wy),
          tl = game.tiles[wi];
        if (tl.tree) {
          const ot = objGet();
          ot.k = wy * game.TS + 19;
          ot.t = 1;
          ot.x = wx;
          ot.y = wy;
          ot.tl = tl;
        } else if (tl.rock) {
          const or2 = objGet();
          or2.k = wy * game.TS + 21;
          or2.t = 2;
          or2.x = wx;
          or2.y = wy;
        }
      }
    for (let bi = 0; bi < game.buildings.length; bi++) {
      const b = game.buildings[bi];
      if (b.x < vx0 - 1 || b.x > vx1 + 1 || b.y < vy0 - 1 || b.y > vy1 + 1) continue;
      const ob = objGet();
      ob.k = b.y * game.TS + 22;
      ob.t = 0;
      ob.o = b;
    }
    for (let ui2 = 0; ui2 < game.units.length; ui2++) {
      const u = game.units[ui2];
      if (u.x < vx0 - 1 || u.x > vx1 + 1 || u.y < vy0 - 1 || u.y > vy1 + 1) continue;
      const ou = objGet();
      ou.k = u.y * game.TS + 3;
      ou.t = 3;
      ou.o = u;
    }
    objPool.length = objN;
    objPool.sort(function (a, b2) {
      return a.k - b2.k;
    });
    // The whole sorted pass is one graphics run of sprites and small shapes.
    presentation.layer('objects', function (s) {
      for (let i = 0; i < objPool.length; i++) {
        const q = objPool[i];
        if (q.t === 0) drawBuilding(s, q.o as Building);
        else if (q.t === 1) {
          if (q.tl) drawTree(s, q.x, q.y, q.tl, now);
        } else if (q.t === 2) drawRock(s, q.x, q.y);
        else drawUnit(s, q.o as Unit, now);
      }
    });
  }

  function atmosphereHash(x: number, y: number, salt: number): number {
    let value = Math.imul(x + salt * 173, 374761393) ^ Math.imul(y + (game.seed || 0), 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return (value ^ (value >>> 16)) >>> 0;
  }
  let atmosphereCount = 0;
  function meadowParticles(s: SceneLayer, now: number) {
    atmosphereCount = 0;
    if (
      renderPrefs().clarity ||
      renderPrefs().reducedMotion ||
      rainAmt() > 0.25 ||
      nightCool() > 0.65
    )
      return;
    // Sparse fixed world cells prevent camera panning from dragging particles along.
    // The maximum remains bounded even at the widest zoom and on a large monitor.
    const cell = game.TS * 7,
      g = s.g;
    let count = 0,
      butterflies = 0;
    const limit = renderPrefs().quality < 1 ? 20 : 56,
      time = game.state.paused ? 0 : now / 1000,
      x0 = Math.max(0, Math.floor((cam.x - 30) / cell)),
      x1 = Math.min(Math.floor((game.W * game.TS) / cell), Math.ceil((cam.x + vw / z + 30) / cell)),
      y0 = Math.max(0, Math.floor((cam.y - 30) / cell)),
      y1 = Math.min(Math.floor((game.H * game.TS) / cell), Math.ceil((cam.y + vh / z + 30) / cell));
    for (let cy = y0; cy <= y1 && count < limit; cy++)
      for (let cx = x0; cx <= x1 && count < limit; cx++) {
        const hash = atmosphereHash(cx, cy, 23),
          bx = cx * cell + (hash % (cell - 32)) + 16,
          by = cy * cell + ((hash >>> 9) % (cell - 32)) + 16,
          tx = Math.floor(bx / game.TS),
          ty = Math.floor(by / game.TS);
        if (!game.inB(tx, ty) || game.tiles[game.idx(tx, ty)].t !== game.GRASS) continue;
        for (let mote = 0; mote < (renderPrefs().quality < 1 ? 1 : 2) && count < limit; mote++) {
          const phase = (time / (9 + (hash % 7)) + (hash % 1000) / 1000 + mote * 0.5) % 1,
            px = bx + phase * 24 + Math.sin(time * 0.42 + hash + mote) * 5,
            py = by - phase * 13 + Math.sin(time * 0.3 + hash * 0.1) * 4;
          if (
            px < cam.x - 2 ||
            px > cam.x + vw / z + 2 ||
            py < cam.y - 2 ||
            py > cam.y + vh / z + 2
          )
            continue;
          count++;
          g.circle(px, py, mote ? 0.7 : 0.95).fill({
            color: 0xffecab,
            alpha: 0.55 * Math.sin(Math.PI * phase),
          });
        }
        if (renderPrefs().quality < 1 || z < 0.85 || hash % 4 || butterflies >= 3) continue;
        const tile = game.tiles[game.idx(tx, ty)];
        if (tile.tree || tile.road || tile.rock) continue;
        const flutterX = bx + Math.sin(time * 0.3 + hash) * 12,
          flutterY = by - 8 + Math.cos(time * 0.24 + hash) * 7;
        if (
          flutterX < cam.x ||
          flutterX > cam.x + vw / z ||
          flutterY < cam.y ||
          flutterY > cam.y + vh / z
        )
          continue;
        butterflies++;
        const wing = 0.5 + Math.abs(Math.sin(time * 8 + hash)) * 1.6,
          color = hash % 3 ? 0xf4cf76 : 0xe1dfc2;
        for (const side of [-1, 1]) {
          g.save();
          translate(g, flutterX + side * wing * 0.6, flutterY);
          rotate(g, side * 0.4);
          g.ellipse(0, 0, wing, 1.35).fill(color);
          g.restore();
        }
        g.rect(flutterX - 0.25, flutterY - 1, 0.5, 2).fill(0x715c3e);
      }
    atmosphereCount = count + butterflies;
  }

  // ---------- effects ----------
  function pushFX(effect: FXEffect) {
    if (renderPrefs().clarity || renderPrefs().reducedMotion) return;
    // Bursts remain bounded at 8x speed and during a large wave of deliveries.
    const limit = renderPrefs().quality < 1 ? 48 : 120;
    while (FXL.length >= limit) FXL.shift();
    effect.i =
      effect.i === undefined
        ? tileHash(Math.floor(effect.x) + Math.floor(effect.y) * game.W)
        : effect.i;
    FXL.push(effect);
  }
  const FX = {
    coin: function (x: number, y: number) {
      const first = game.state.gold <= 1,
        n = first ? 5 : 2;
      for (let i = 0; i < n; i++) pushFX({ k: 'coin', x: x + 0.5, y: y + 0.5, t: NOW, i: i });
      if (first || game.state.gold % 25 === 0)
        pushFX({ k: 'ring', x: x + 0.5, y: y + 0.6, t: NOW, c: '#ffd23f', r: first ? 28 : 16 });
    },
    ring: function (x: number, y: number, c: string, r: number) {
      pushFX({ k: 'ring', x: x, y: y, t: NOW, c: c, r: r });
    },
    spark: function (x: number, y: number, c: string, n: number) {
      pushFX({ k: 'spark', x: x, y: y, t: NOW, c: c, n: n || 6 });
    },
    dust: function (x: number, y: number) {
      pushFX({ k: 'dust', x: x, y: y, t: NOW });
    },
    pop: function (x: number, y: number) {
      pushFX({ k: 'ring', x: x, y: y, t: NOW, c: '#ffdf6e', r: game.state.won ? 46 : 13 });
      pushFX({
        k: game.state.won ? 'spark' : 'dust',
        x: x,
        y: y,
        t: NOW,
        c: '#ffd23f',
        n: game.state.won ? 16 : 4,
      });
    },
  };
  function fxDraw(s: SceneLayer, now: number) {
    if (renderPrefs().clarity || renderPrefs().reducedMotion) {
      FXL.length = 0;
      return;
    }
    for (let i = FXL.length - 1; i >= 0; i--) {
      const f = FXL[i],
        age = now - f.t;
      const duration =
        f.k === 'coin'
          ? 850
          : f.k === 'ring'
            ? 650
            : f.k === 'spark'
              ? 520
              : f.k === 'dust'
                ? 620
                : f.k === 'stepDust'
                  ? 480
                  : 700;
      if (age > duration || age < 0) {
        FXL.splice(i, 1);
        continue;
      }
      // Retire offscreen effects on schedule without submitting their geometry.
      if (
        f.x * game.TS < cam.x - 60 ||
        f.x * game.TS > cam.x + vw / z + 60 ||
        f.y * game.TS < cam.y - 60 ||
        f.y * game.TS > cam.y + vh / z + 60
      )
        continue;
      const g = s.g,
        p = age / duration,
        x = f.x * game.TS,
        y = f.y * game.TS;
      if (f.k === 'stepDust') {
        for (let puff = 0; puff < 2; puff++)
          g.ellipse(x + puff * 2.4 + p * 2.5, y + 2 - p * 1.5, 0.7 + p * 2.2, 0.5 + p).fill({
            color: 0xe0cd97,
            alpha: 0.16 * Math.sin(Math.PI * p),
          });
      } else if (f.k === 'ring') {
        g.circle(x, y + 3, 4 + p * (f.r || 20)).stroke({
          color: f.c ?? '#ffd23f',
          alpha: 0.55 * (1 - p),
          width: 2.4 - 1.8 * p,
        });
      } else if (f.k === 'coin') {
        const cxp = x + 2 + ((f.i ?? 0) - 2.5) * 7 * p * 0.9,
          cyp = y - 4 - 30 * Math.sin(Math.PI * Math.min(1, p * 1.05)) * 0.9 + 14 * p * p,
          r2 = 2.1 * (1 - p * 0.25),
          alpha = Math.max(0, 1 - p * p);
        g.circle(cxp + 0.7, cyp + 0.7, r2).fill({ color: 0xc98a1e, alpha });
        g.circle(cxp, cyp, r2).fill({ color: 0xffd23f, alpha });
        g.rect(cxp - r2 * 0.4, cyp - r2 * 0.55, r2 * 0.8, 0.8).fill({ color: 0xfff2b0, alpha });
      } else if (f.k === 'spark') {
        for (let k = 0; k < (f.n || 6); k++) {
          const a2 = k * 2.39996 + (f.i ?? 0),
            sp2 = 14 + ((k * 53) % 9),
            cxp = x + Math.cos(a2) * sp2 * p,
            cyp = y + 3 + Math.sin(a2) * sp2 * p + p * 10;
          g.moveTo(cxp, cyp).lineTo(cxp + Math.cos(a2) * 3, cyp + Math.sin(a2) * 3);
        }
        g.stroke({ color: f.c ?? '#ffd23f', alpha: (1 - p) * 0.9, width: 1.2 });
      } else if (f.k === 'dust') {
        for (let k = 0; k < 6; k++) {
          const a3 = k * 1.047 + rnd0(f.i ?? 0);
          g.circle(
            x + Math.cos(a3) * (3 + p * 11),
            y + 12 + Math.sin(a3) * (1.5 + p * 4),
            1.6 + p * 3,
          ).fill({ color: 0xb8a276, alpha: (1 - p) * 0.22 });
        }
      } else {
        g.circle(x + game.TS / 2, y + game.TS / 2, 3 + p * 16).stroke({
          color: 0xff5046,
          alpha: 0.5 * (1 - p),
          width: 2,
        });
      }
    }
  }
  function rnd0(i: number): number {
    return (((i * 2654435761) >>> 0) % 628) / 100;
  }

  // ---------- animated overlays ----------
  function waterAnim(s: SceneLayer, now: number) {
    // The full painted material is cached at both quality levels. Only a sparse
    // veil of curved reflections breathes; no texture swapping or raster uploads.
    if (renderPrefs().reducedMotion || renderPrefs().quality < 1) return;
    const vx0 = Math.max(0, Math.floor(cam.x / game.TS)),
      vx1 = Math.min(game.W - 1, Math.ceil((cam.x + vw / z) / game.TS)),
      vy0 = Math.max(0, Math.floor(cam.y / game.TS)),
      vy1 = Math.min(game.H - 1, Math.ceil((cam.y + vh / z) / game.TS)),
      g = s.g;
    for (let y = vy0; y <= vy1; y++)
      for (let x = vx0; x <= vx1; x++) {
        const i = game.idx(x, y),
          h = tileHash(i);
        if (game.tiles[i].t !== game.WATER || h % 3 !== 0) continue;
        const px = x * game.TS + 6,
          py = y * game.TS + 8 + (h % 8);
        const phase = now / 2600 + h * 0.17;
        g.moveTo(px, py)
          .quadraticCurveTo(px + 4, py - 0.7, px + 9 + (h % 4), py - 0.2)
          .stroke({
            color: 0xdee2b8,
            alpha: 0.075 + 0.055 * Math.sin(phase),
            width: 0.65,
            cap: 'round',
          });
      }
  }
  function highlights(s: SceneLayer, now: number) {
    now = motionTime(now);
    const g = s.g;
    if (game.mode && game.mode.type === 'build' && game.hlTiles && game.hlTiles.length) {
      const pu = 0.5 + 0.5 * Math.sin(now / 260);
      for (let hi = 0; hi < game.hlTiles.length; hi++) {
        const hti = game.hlTiles[hi],
          hx2 = (hti % game.W) * game.TS,
          hy2 = ((hti / game.W) | 0) * game.TS;
        if (
          hx2 > cam.x + vw / z ||
          hx2 + game.TS < cam.x ||
          hy2 > cam.y + vh / z ||
          hy2 + game.TS < cam.y
        )
          continue;
        diamond(g, hx2 + 12, hy2 + 12, 12.2).fill({ color: 0xffd640, alpha: 0.06 + 0.1 * pu });
        diamond(g, hx2 + 12, hy2 + 12, 11.4).stroke({
          color: 0xffdf6e,
          alpha: 0.55 + 0.4 * pu,
          width: 2,
        });
      }
    }
    if (game.mode && game.mode.type === 'build' && game.hlSpots && game.hlSpots.length) {
      const pu2 = 0.5 + 0.5 * Math.sin(now / 260 + 2);
      for (let si2 = 0; si2 < game.hlSpots.length; si2++) {
        const sti = game.hlSpots[si2],
          sx4 = (sti % game.W) * game.TS,
          sy4 = ((sti / game.W) | 0) * game.TS;
        if (
          sx4 > cam.x + vw / z ||
          sx4 + game.TS < cam.x ||
          sy4 > cam.y + vh / z ||
          sy4 + game.TS < cam.y
        )
          continue;
        diamond(g, sx4 + 12, sy4 + 12, 5.4).fill({ color: 0x82ff8c, alpha: 0.14 + 0.16 * pu2 });
        g.circle(sx4 + 12, sy4 + 12, 1.5).fill({ color: 0xbeffbe, alpha: 0.5 + 0.4 * pu2 });
      }
    }
  }
  function demoMarkers(s: SceneLayer) {
    if (!game.mode || game.mode.type !== 'demolish') return;
    const g = s.g;
    for (let di4 = 0; di4 < game.buildings.length; di4++) {
      const b5 = game.buildings[di4];
      if (b5.type === 'hq') continue;
      const bx = b5.x * game.TS,
        by = b5.y * game.TS,
        armed = game.demoArm === b5;
      const pu = renderPrefs().reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(NOW / 420);
      const style = armed
        ? { color: 0xffd23f, width: 3 }
        : { color: 0xff5448, alpha: 0.75 + 0.25 * pu, width: 2 };
      g.roundRect(bx - 0.5, by - 0.5, game.TS + 1, game.TS + 1, 3).stroke(style);
      g.moveTo(bx + 7, by + 7)
        .lineTo(bx + game.TS - 7, by + game.TS - 7)
        .moveTo(bx + game.TS - 7, by + 7)
        .lineTo(bx + 7, by + game.TS - 7)
        .stroke(style);
    }
  }
  function selection(s: SceneLayer, now: number) {
    if (!game.selected) return;
    const g = s.g,
      b = game.selected,
      sp = game.BSPEC[b.type],
      rr2 = (sp.rad || 3) * game.TS,
      ccx = b.x * game.TS + game.TS / 2,
      ccy = b.y * game.TS + game.TS / 2;
    g.circle(ccx, ccy, rr2).fill({ color: 0xffd650, alpha: 0.05 });
    dashed(g, circlePoints(ccx, ccy, rr2), 5, 4, -motionTime(now) / 60).stroke({
      color: 0xffd23f,
      alpha: 0.55,
      width: 1.2,
    });
    // Two soft, wider strokes stand in for a blurred glow; blur is screen-sized.
    const device = Math.max(0.01, dpr * z);
    for (const [spread, alpha] of [
      [1, 0.064],
      [0.5, 0.128],
    ])
      g.roundRect(b.x * game.TS - 2, b.y * game.TS - 2, game.TS + 4, game.TS + 4, 4).stroke({
        color: 0xffd23f,
        alpha,
        width: 2 + (7 * spread) / device,
      });
    g.roundRect(b.x * game.TS - 2, b.y * game.TS - 2, game.TS + 4, game.TS + 4, 4).stroke({
      color: 0xffd23f,
      width: 2,
    });
  }
  function anchorDraw(s: SceneLayer, now: number) {
    if (!game.anchor) return;
    const g = s.g,
      pu = renderPrefs().reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 420),
      a = game.anchor.x * game.TS,
      b2 = game.anchor.y * game.TS,
      L = 8,
      T = game.TS;
    g.rect(a, b2, T, T).fill({ color: 0x8fd6d0, alpha: 0.1 + 0.1 * pu });
    g.moveTo(a, b2 + L)
      .lineTo(a, b2)
      .lineTo(a + L, b2)
      .moveTo(a + T - L, b2)
      .lineTo(a + T, b2)
      .lineTo(a + T, b2 + L)
      .moveTo(a + T, b2 + T - L)
      .lineTo(a + T, b2 + T)
      .lineTo(a + T - L, b2 + T)
      .moveTo(a + L, b2 + T)
      .lineTo(a, b2 + T)
      .lineTo(a, b2 + T - L)
      .stroke({ color: 0x8fd6d0, width: 2 });
  }
  function ghostDraw(s: SceneLayer) {
    if (!game.ghost || !game.ghost.in || !game.mode || game.mode.type !== 'build') return;
    const gx = game.ghost.x,
      gy = game.ghost.y,
      ok = game.ghost.ok;
    s.g.ellipse(gx * game.TS + 12, gy * game.TS + 16, 13, 5).fill({
      color: ok ? 0x6ee06e : 0xff5050,
      alpha: 0.2,
    });
    drawSprite(s, game.mode.bt, gx * game.TS + 12, gy * game.TS + 12, 0.66);
    const g = s.g;
    g.roundRect(gx * game.TS - 1, gy * game.TS - 1, game.TS + 2, game.TS + 2, 3.5).stroke({
      color: ok ? 0x6ee06e : 0xff5050,
      width: 2,
    });
    const sp2 = game.BSPEC[game.mode.bt];
    if (ok && sp2.rad && sp2.rad >= 4)
      g.circle(gx * game.TS + 12, gy * game.TS + 12, sp2.rad * game.TS).stroke({
        color: 0x6ee06e,
        alpha: 0.35,
        width: 1,
      });
  }
  // ---------- logistics and placement feedback ----------
  /**
   * @typedef {Object} PlacementPreview
   * @property {string} key
   * @property {number} x
   * @property {number} y
   * @property {number[]} resources Tile indices within the producer's work area.
   * @property {number[]|null} path Current preferred route from storage.
   * @property {Object|null} storage Closest completed storage building.
   * @property {number|null} haulSeconds Estimated one-way travel time.
   * @property {string} summary Player-facing resource and delivery estimate.
   * @typedef {Object} RoadPreview
   * @property {string} key
   * @property {number[]|null} path Current preferred route between the endpoints.
   * @property {Object<number,boolean>} paved Clear owned tiles that become roads.
   * @property {number} count Number of new road tiles.
   * @property {number} beforeSeconds Travel time along the preview route today.
   * @property {number} afterSeconds Travel time along that route after paving.
   * @property {string} summary Player-facing benefit and count.
   */
  let _placementCache: PlacementPreview | null = null,
    _roadCache: RoadPreview | null = null,
    _logisticsCaption = '';
  let workloadSummary: { busy: number; carriers: number; waiting: number } | null = null;
  function logisticsWorldKey() {
    let key = terrainRevision + ':' + (game.state.upgrades ? game.state.upgrades.haul || 0 : 0);
    // Completion and manning alter storage choice and territory without changing
    // the building count. These states also need to refresh a paused preview.
    for (let i = 0; i < game.buildings.length; i++) {
      const b = game.buildings[i];
      key +=
        ':' +
        b.id +
        ',' +
        b.x +
        ',' +
        b.y +
        ',' +
        (b.done ? 1 : 0) +
        ',' +
        (b.manned ? 1 : 0) +
        ',' +
        (b.disabled ? 1 : 0);
    }
    return key;
  }
  function pathSeconds(path: number[], sx: number, sy: number, paved?: Record<number, boolean>) {
    let seconds = 0,
      px = sx,
      py = sy;
    for (let i = 0; i < path.length; i++) {
      const n = path[i],
        x = n % game.W,
        y = (n / game.W) | 0;
      let speed =
        typeof game.speedOn === 'function'
          ? game.speedOn({ x: px + 0.5, y: py + 0.5 }, n)
          : 2.7 / game.moveCost(n);
      // The preview only paves the exact clear, owned tiles commitRoad will accept.
      if (paved && paved[n]) speed *= game.moveCost(n) / 0.3;
      seconds += Math.hypot(x - px, y - py) / Math.max(0.1, speed);
      px = x;
      py = y;
    }
    return seconds;
  }
  function resourceWorkArea(type: BuildingType, x: number, y: number) {
    const sp = game.BSPEC[type];
    let r = sp.resKind ? 1 : sp.prod === 'fish' ? 2 : sp.rad || 0;
    if (sp.prod === 'plant') {
      let closest: Building | null = null,
        dist = Infinity;
      for (let i = 0; i < game.buildings.length; i++) {
        const b = game.buildings[i];
        if (!b.done || b.type !== 'lumberjack') continue;
        const d = Math.abs(b.x - x) + Math.abs(b.y - y);
        if (d < dist) {
          dist = d;
          closest = b;
        }
      }
      if (closest) {
        x = closest.x;
        y = closest.y;
        r = 5;
      }
    }
    return { x: x, y: y, r: r };
  }
  function resourceTilesAt(type: BuildingType, x: number, y: number) {
    const sp = game.BSPEC[type],
      area = resourceWorkArea(type, x, y),
      found = [],
      r = area.r;
    x = area.x;
    y = area.y;
    for (let yy = y - r; yy <= y + r; yy++)
      for (let xx = x - r; xx <= x + r; xx++) {
        if (!game.inB(xx, yy)) continue;
        const dx = xx - x,
          dy = yy - y;
        if (!sp.resKind && sp.prod !== 'fish' && dx * dx + dy * dy > r * r) continue;
        const i = game.idx(xx, yy),
          tl = game.tiles[i];
        let hit = false;
        if (sp.prod === 'gather') hit = tl.tree >= 3;
        else if (sp.prod === 'rock') hit = !!tl.rock;
        else if (sp.prod === 'fish')
          hit = tl.t === game.WATER && Math.max(Math.abs(dx), Math.abs(dy)) <= 2;
        else if (sp.resKind)
          hit = !!tl.deposit && tl.deposit.kind === sp.resKind && tl.deposit.amt > 0;
        else if (sp.prod === 'plant')
          hit =
            tl.t === game.GRASS &&
            !tl.tree &&
            !tl.rock &&
            !tl.road &&
            !!game.owned[i] &&
            !game.buildingAt(xx, yy);
        if (hit) found.push(i);
      }
    return found;
  }
  function placementStockKey(type: BuildingType) {
    const goods = Object.keys(game.BSPEC[type].cost || {}) as Good[];
    let key = '';
    for (const store of game.storages())
      for (const good of goods)
        key +=
          ':' +
          store.id +
          ',' +
          good +
          ',' +
          (store.stock[good] || 0) +
          ',' +
          (store.reservedStock[good] || 0);
    for (const job of game.jobs)
      if (job.kind === 'transfer' && job.good && goods.includes(job.good))
        key += ':' + job.sourceId + ',' + job.to + ',' + job.good + ',' + job.status;
    for (const unit of game.units)
      if (unit.job?.kind === 'transfer' && unit.carry) key += ':cargo' + unit.id + ',' + unit.carry;
    return key;
  }
  /** @returns {PlacementPreview|null} */
  function getPlacementPreview() {
    if (!game.mode || game.mode.type !== 'build' || !game.ghost || !game.ghost.in) return null;
    const key =
      game.mode.bt +
      ':' +
      game.ghost.x +
      ':' +
      game.ghost.y +
      ':' +
      logisticsWorldKey() +
      ':' +
      placementStockKey(game.mode.bt) +
      ':' +
      Math.floor(game.state.time / 2);
    if (_placementCache && _placementCache.key === key) return _placementCache;
    const checks = game.placementChecks(game.mode.bt, game.ghost.x, game.ghost.y);
    const spending = game.buildingAffordability(game.mode.bt, game.ghost);
    const sp = game.BSPEC[game.mode.bt],
      resources = resourceTilesAt(game.mode.bt, game.ghost.x, game.ghost.y),
      storage = game.nearestStoragePos(game.ghost.x, game.ghost.y);
    const path =
      storage && game.passI(game.idx(game.ghost.x, game.ghost.y))
        ? game.findPath(storage.x, storage.y, game.ghost.x, game.ghost.y)
        : null;
    const haul = path && storage ? pathSeconds(path, storage.x, storage.y) : null;
    let supply = '';
    if (sp.prod === 'gather') supply = resources.length + ' mature trees';
    else if (sp.prod === 'rock') supply = resources.length + ' rock tiles';
    else if (sp.resKind) {
      let amount = 0;
      for (let i = 0; i < resources.length; i++)
        amount += game.tiles[resources[i]].deposit?.amt ?? 0;
      supply = amount + ' ' + game.GOODS[sp.resKind].name.toLowerCase() + ' in reach';
    } else if (sp.prod === 'fish')
      supply = resources.length ? 'Shore in reach' : 'No shore in reach';
    else if (sp.prod === 'plant') supply = resources.length + ' clear nursery tiles';
    const summary =
      (supply ? supply + ' · ' : '') +
      (haul === null || !storage
        ? 'No storage route'
        : 'Estimated one-way walk: ~' +
          haul.toFixed(1) +
          's to ' +
          game.BSPEC[storage.type].name.toLowerCase());
    return (_placementCache = {
      key: key,
      x: game.ghost.x,
      y: game.ghost.y,
      resources: resources,
      checks,
      spending,
      canBuild: checks.ok && spending.affordable,
      operatingSupport: sp.water
        ? {
            ok: game.hasLocalWater(game.ghost),
            reason: game.hasLocalWater(game.ghost)
              ? 'Working connected Well within 6 tiles'
              : 'No working connected Well within 6 tiles. Construction is allowed; production will wait.',
          }
        : null,
      path: path,
      storage: storage,
      haulSeconds: haul,
      summary: summary,
    });
  }
  /** @returns {RoadPreview|null} */
  function getRoadPreview() {
    if (
      !game.mode ||
      game.mode.type !== 'road' ||
      !game.anchor ||
      !hoverIn ||
      !game.inB(ht.x, ht.y)
    )
      return null;
    const key =
      game.anchor.x +
      ':' +
      game.anchor.y +
      ':' +
      ht.x +
      ':' +
      ht.y +
      ':' +
      logisticsWorldKey() +
      ':' +
      Math.floor(NOW / 600);
    if (_roadCache && _roadCache.key === key) return _roadCache;
    const plan = game.planRoad(game.anchor, ht);
    if (plan.ok === false)
      return (_roadCache = {
        key: key,
        ok: false,
        reason:
          plan.reason === 'blocked-start'
            ? 'Road must start on clear ground inside your territory'
            : 'No walking route connects these endpoints',
        cost: {},
        path: null,
        paved: {},
        count: 0,
        beforeSeconds: 0,
        afterSeconds: 0,
        summary:
          plan.reason === 'blocked-start'
            ? 'Road must start on clear ground inside your territory'
            : 'No route here',
      });
    const { path, paved: pave, count } = plan;
    const before = pathSeconds(path, game.anchor.x, game.anchor.y),
      after = pathSeconds(path, game.anchor.x, game.anchor.y, pave);
    const pct = before > 0 ? Math.round(((before - after) / before) * 100) : 0;
    return (_roadCache = {
      key: key,
      ok: true,
      reason: '',
      cost: {},
      path: path,
      paved: pave,
      count: count,
      beforeSeconds: before,
      afterSeconds: after,
      summary:
        count +
        ' new tiles · 0 goods · estimated walk ~' +
        before.toFixed(1) +
        's → ' +
        after.toFixed(1) +
        's (' +
        pct +
        '% faster along this route)',
    });
  }
  const LABEL_FONT = '600 11px system-ui,sans-serif';
  function worldLabel(s: SceneLayer, x: number, y: number, label: string, color: string) {
    while (label.length > 8 && s.measureText(label, LABEL_FONT) > vw - 32)
      label = label.slice(0, -4) + '…';
    const width = s.measureText(label, LABEL_FONT) + 14;
    const screenX = (x - cam.x) * z,
      screenY = (y - cam.y) * z;
    x = cam.x + Math.max(width / 2 + 8, Math.min(vw - width / 2 - 8, screenX)) / z;
    y = cam.y + Math.max(28, Math.min(vh - 12, screenY)) / z;
    const g = s.g;
    g.save();
    translate(g, x, y);
    scale(g, 1 / z);
    g.roundRect(-width / 2, -18, width, 21, 5)
      .fill({ color: 0x101b19, alpha: 0.9 })
      .stroke({ color: color || '#dbc79b', alpha: 0.66, width: 1 });
    g.restore();
    s.text(label, x, y - 4 / z, {
      font: LABEL_FONT,
      fill: color || '#f4ead6',
      align: 'center',
      scale: 1 / z,
    });
  }
  function traceRoute(
    s: SceneLayer,
    x: number,
    y: number,
    path: number[],
    start: number,
    color: string,
    isDashed: boolean,
  ) {
    if (!path || !path.length) return;
    const g = s.g,
      points = [x * game.TS, y * game.TS];
    for (let p = start || 0; p < path.length; p++) {
      const n = path[p];
      points.push(((n % game.W) + 0.5) * game.TS, (((n / game.W) | 0) + 0.5) * game.TS);
    }
    for (const style of [
      { color: 0x111f1d, alpha: 0.72, width: 4 / z },
      { color, width: 1.7 / z },
    ]) {
      if (isDashed) dashed(g, points, 6 / z, 4 / z);
      else g.poly(points, false);
      g.stroke(style);
    }
  }
  function reachDraw(s: SceneLayer, type: BuildingType, x: number, y: number, resources: number[]) {
    const g = s.g,
      sp = game.BSPEC[type],
      area = resourceWorkArea(type, x, y),
      r = area.r * game.TS,
      fill = { color: 0x89cfb1, alpha: 0.04 },
      edge = { color: 0xb3e6c5, alpha: 0.72, width: 1 / z };
    x = area.x;
    y = area.y;
    if (sp.resKind || sp.prod === 'fish')
      g.roundRect(
        (x - area.r) * game.TS,
        (y - area.r) * game.TS,
        (area.r * 2 + 1) * game.TS,
        (area.r * 2 + 1) * game.TS,
        3,
      )
        .fill(fill)
        .stroke(edge);
    else
      g.circle((x + 0.5) * game.TS, (y + 0.5) * game.TS, r)
        .fill(fill)
        .stroke(edge);
    for (let i = 0; i < resources.length; i++) {
      const n = resources[i],
        px = (n % game.W) * game.TS,
        py = ((n / game.W) | 0) * game.TS;
      g.rect(px + 1, py + 1, game.TS - 2, game.TS - 2).fill({ color: 0xbce199, alpha: 0.15 });
      g.roundRect(px + 3, py + 3, game.TS - 6, game.TS - 6, 3).stroke({
        color: 0xc5dfaa,
        width: 1.3 / z,
      });
    }
  }
  const _reasonNames: Partial<Record<ProductionBlockReason, string>> = {
    inputs: 'Waiting for inputs',
    output: 'Waiting for collection',
    reserve: 'Construction reserve',
    exhausted: 'Deposit exhausted',
    resources: 'Resources depleted',
    paused: 'Production paused',
    demand: 'Stocks are sufficient',
  };
  const clarityNames = {
    hq: 'HQ',
    warehouse: 'STORE',
    lumberjack: 'WOOD',
    forester: 'TREE',
    quarry: 'STONE',
    fisherman: 'FISH',
    farm: 'GRAIN',
    windmill: 'FLOUR',
    bakery: 'BREAD',
    pigfarm: 'PIGS',
    butcher: 'MEAT',
    well: 'WATER',
    brewery: 'BEER',
    smelter: 'BARS',
    workshop: 'WORK',
    mine_coal: 'COAL',
    mine_iron: 'IRON',
    mine_gold: 'GOLD',
    sawmill: 'SAW',
    toolsmith: 'TOOLS',
    armory: 'ARMS',
    guard: 'POST',
  };
  function clarityRoads(s: SceneLayer) {
    if (!renderPrefs().clarity) return;
    const g = s.g,
      x0 = Math.max(0, Math.floor(cam.x / game.TS)),
      x1 = Math.min(game.W - 1, Math.ceil((cam.x + vw / z) / game.TS)),
      y0 = Math.max(0, Math.floor(cam.y / game.TS)),
      y1 = Math.min(game.H - 1, Math.ceil((cam.y + vh / z) / game.TS));
    let any = false;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!game.tiles[game.idx(x, y)].road) continue;
        any = true;
        const cx = (x + 0.5) * game.TS,
          cy = (y + 0.5) * game.TS;
        // Include isolated road tiles and exactly the same orthogonal joins as
        // the painted roads. No connectivity or movement rules change.
        g.moveTo(cx - 0.5, cy).lineTo(cx + 0.5, cy);
        for (let d = 0; d < 4; d++) {
          const nx = x + game.DX[d],
            ny = y + game.DY[d];
          if (!game.inB(nx, ny) || (!game.tiles[game.idx(nx, ny)].road && !game.buildingAt(nx, ny)))
            continue;
          g.moveTo(cx, cy).lineTo(cx + (game.DX[d] * game.TS) / 2, cy + (game.DY[d] * game.TS) / 2);
        }
      }
    // Lift the earth surface in clarity mode without drawing a lane marking.
    if (any) g.stroke({ color: 0xe5cc97, alpha: 0.16, width: 5, cap: 'round' });
  }
  const TAG_FONT = '700 8px system-ui,sans-serif';
  function clarityBuildings(s: SceneLayer) {
    if (!renderPrefs().clarity) return;
    for (const b of game.buildings) {
      if (!visibleAt(b.x, b.y)) continue;
      const sp = game.BSPEC[b.type],
        reason = b.disabled ? 'paused' : b.blockedReason,
        warning =
          (reason && reason !== 'demand' && reason !== 'paused') ||
          (!reason && b.done && game.bStatus(b).bad),
        symbol = !b.done
          ? '+'
          : reason === 'paused'
            ? 'Ⅱ'
            : warning
              ? '!'
              : game.buildingWorking(b)
                ? '▶'
                : '·',
        color = warning ? '#ffcead' : reason === 'paused' ? '#e9dbb5' : '#e0efcb',
        tag = z < 0.85 ? symbol : clarityNames[b.type] + ' ' + symbol,
        x = (b.x + 0.5) * game.TS,
        y = b.y * game.TS,
        width = s.measureText(tag, TAG_FONT) + 8,
        g = s.g;
      // A U-shaped threshold marks the existing south-facing entrance.
      const threshold = [x - 3, y + 22, x - 3, y + 27, x + 3, y + 27, x + 3, y + 22];
      g.poly(threshold, false).stroke({ color: 0x25392c, width: 4 / z });
      g.poly(threshold, false).stroke({ color: 0xfff0b7, width: 1.8 / z });
      g.save();
      translate(g, x, y + 37);
      scale(g, 1 / z);
      g.roundRect(-width / 2, -7, width, 13, 3)
        .fill({ color: 0x14241c, alpha: 0.94 })
        .stroke({ color, width: 0.8 });
      g.restore();
      s.text(tag, x, y + 37 + 2 / z, {
        font: TAG_FONT,
        fill: color,
        align: 'center',
        scale: 1 / z,
      });
      if (game.selected === b || (game.hoverIn && game.ht.x === b.x && game.ht.y === b.y)) {
        const status = !b.done
          ? 'Under construction'
          : (reason && _reasonNames[reason]) ||
            (warning ? game.bStatus(b).lines.find((line) => line.w)?.t : '') ||
            (game.buildingWorking(b)
              ? 'Working'
              : sp.guard
                ? b.manned
                  ? 'Manned'
                  : 'Awaiting soldier'
                : sp.store
                  ? 'Storage'
                  : 'Idle');
        worldLabel(s, x, y - 35, sp.name + ' · ' + status, color);
      }
    }
  }
  const BADGE_FONT = '700 9px system-ui,sans-serif';
  function workloadBadge(
    s: SceneLayer,
    b: Building,
    waiting: number,
    assigned: number,
    max: number,
  ) {
    const width = 72;
    const screenX = ((b.x + 0.5) * game.TS - cam.x) * z;
    const screenY = (b.y * game.TS - 18 - cam.y) * z;
    const x = cam.x + Math.max(width / 2 + 8, Math.min(vw - width / 2 - 8, screenX)) / z,
      y = cam.y + Math.max(40, Math.min(vh - 8, screenY)) / z,
      rows = [
        [0, waiting, 'W', '#e3b475'],
        [1, assigned, 'A', '#9bcbba'],
      ] as const,
      g = s.g;
    g.save();
    translate(g, x, y);
    scale(g, 1 / z);
    g.roundRect(-36, -32, 72, 34, 5)
      .fill({ color: 0x101b19, alpha: 0.94 })
      .stroke({ color: waiting ? 0xb78b58 : 0x638f80, width: 1 });
    for (const [row, count, , color] of rows) {
      const rowY = -25 + row * 14;
      g.rect(-17, rowY, 31, 6).fill(0x25372f);
      if (count) g.rect(-17, rowY, (31 * count) / max, 6).fill(color);
    }
    g.restore();
    for (const [row, count, label, color] of rows) {
      const rowY = y + (-25 + row * 14 + 6) / z;
      s.text(label, x - 30 / z, rowY, { font: BADGE_FONT, fill: color, scale: 1 / z });
      s.text(String(count), x + 31 / z, rowY, {
        font: BADGE_FONT,
        fill: color,
        align: 'right',
        scale: 1 / z,
      });
    }
  }
  function logisticsDraw(s: SceneLayer) {
    const overlay = renderPrefs().overlay || 'none';
    _logisticsCaption = '';
    workloadSummary = null;
    if (overlay === 'routes') {
      let busy = 0;
      for (let i = 0; i < game.units.length; i++) {
        const u = game.units[i];
        if (!u.path || !u.path.length || u.kind !== 'carrier') continue;
        busy++;
        if (busy <= 48)
          traceRoute(
            s,
            u.x,
            u.y,
            u.path,
            u.pi,
            u.carry ? game.GOODS[u.carry].c : '#a4d4df',
            !u.carry,
          );
      }
      _logisticsCaption =
        'Delivery routes · ' + busy + ' carriers travelling · dashed: going to collect';
    } else if (overlay === 'workload') {
      let busyN = 0,
        carrierN = 0;
      for (let ui = 0; ui < game.units.length; ui++)
        if (game.units[ui].kind === 'carrier') {
          carrierN++;
          if (game.units[ui].job || game.units[ui].carry) busyN++;
        }
      const counts = new Map<number, { waiting: number; assigned: number }>();
      let waitingJobs = 0;
      for (const job of game.jobs) {
        if (job.status === 'pending') waitingJobs++;
        for (const id of new Set([job.to, job.sourceId])) {
          if (id === undefined) continue;
          const count = counts.get(id) || { waiting: 0, assigned: 0 };
          if (job.status === 'pending') count.waiting++;
          else count.assigned++;
          counts.set(id, count);
        }
      }
      // One scale for the whole colony keeps equal-length bars comparable.
      const max = Math.max(1, ...[...counts.values()].flatMap((c) => [c.waiting, c.assigned]));
      for (const b of game.buildings) {
        const count = counts.get(b.id);
        if (!count || !visibleAt(b.x, b.y)) continue;
        workloadBadge(s, b, count.waiting, count.assigned, max);
      }
      workloadSummary = { busy: busyN, carriers: carrierN, waiting: waitingJobs };
      _logisticsCaption = 'Carrier workload';
    } else if (overlay === 'reach') {
      const list = game.selected ? [game.selected] : game.buildings;
      let count = 0;
      for (let ri = 0; ri < list.length; ri++) {
        const rb = list[ri],
          spec = game.BSPEC[rb.type];
        if (spec.store || spec.guard || !spec.rad || !visibleAt(rb.x, rb.y)) continue;
        if (++count > 18) break;
        reachDraw(s, rb.type, rb.x, rb.y, resourceTilesAt(rb.type, rb.x, rb.y));
      }
      _logisticsCaption = game.selected
        ? 'Resource reach · pale tiles can supply the selected building'
        : 'Resource reach · select a building to focus';
    } else if (overlay === 'stalls') {
      let stalled = 0;
      for (let si = 0; si < game.buildings.length; si++) {
        const sb = game.buildings[si],
          reason = sb.blockedReason || (game.bStatus(sb).bad ? 'inputs' : '');
        if (!reason) continue;
        stalled++;
        if (!visibleAt(sb.x, sb.y)) continue;
        const color = reason === 'demand' || reason === 'paused' ? '#d7d3b6' : '#ffc2a5';
        s.g
          .roundRect(sb.x * game.TS - 2, sb.y * game.TS - 2, game.TS + 4, game.TS + 4, 3)
          .stroke({ color, width: 2 / z });
        worldLabel(
          s,
          (sb.x + 0.5) * game.TS,
          sb.y * game.TS - 21,
          _reasonNames[reason] || reason,
          color,
        );
      }
      _logisticsCaption = 'Production status · ' + stalled + ' buildings waiting or paused';
    }
    const placement = getPlacementPreview();
    if (placement) {
      if (placement.resources.length)
        reachDraw(
          s,
          (game.mode as { type: 'build'; bt: BuildingType }).bt,
          placement.x,
          placement.y,
          placement.resources,
        );
      if (placement.path && placement.storage)
        traceRoute(
          s,
          placement.storage.x + 0.5,
          placement.storage.y + 0.5,
          placement.path,
          0,
          '#c1e4ce',
          true,
        );
      worldLabel(
        s,
        (placement.x + 0.5) * game.TS,
        (placement.y + 2.1) * game.TS,
        (placement.canBuild
          ? 'Ready to build · '
          : !placement.checks.ok
            ? game.placementText(placement.checks.reason) + ' · '
            : 'Not enough reachable stock · ') + placement.summary,
        placement.canBuild ? '#d3efd0' : '#ffd0b4',
      );
    }
    const road = getRoadPreview();
    if (road) {
      if (road.path && game.anchor)
        traceRoute(s, game.anchor.x + 0.5, game.anchor.y + 0.5, road.path, 0, '#e6d49d', true);
      worldLabel(
        s,
        (ht.x + 0.5) * game.TS,
        (ht.y + 1.9) * game.TS,
        road.summary,
        road.path ? '#f0dfad' : '#ffd0b4',
      );
    }
  }
  /** Screen-space caption above the atmosphere, in CSS pixels. */
  function logisticsCaption(s: SceneLayer) {
    if (!_logisticsCaption) return;
    let top = BAR_H;
    if (workloadSummary) {
      const { busy, carriers, waiting } = workloadSummary;
      const width = Math.min(vw - 24, 340),
        x = (vw - width) / 2;
      if (vw < 700) top += (document.getElementById('adv')?.offsetHeight || 54) + 12;
      const g = s.g;
      g.roundRect(x, top + 12, width, 94, 8)
        .fill({ color: 0x121f1c, alpha: 0.96 })
        .stroke({ color: 0xd2dbb5, alpha: 0.45, width: 1 });
      g.rect(x + 12, top + 42, width - 24, 8).fill(0x30443b);
      if (carriers && busy)
        g.rect(x + 12, top + 42, ((width - 24) * busy) / carriers, 8).fill(0x9bcbba);
      const bold = '700 12px system-ui,sans-serif',
        body = '600 11px system-ui,sans-serif',
        small = '600 10px system-ui,sans-serif';
      s.text('Carrier workload', x + 12, top + 32, { font: bold, fill: '#efe8cf' });
      s.text(waiting + ' waiting', x + width - 12, top + 32, {
        font: bold,
        fill: '#e3b475',
        align: 'right',
      });
      s.text(busy + '/' + carriers + ' carriers busy', x + 12, top + 65, {
        font: body,
        fill: '#9bcbba',
      });
      s.text(
        carriers ? Math.round((busy / carriers) * 100) + '%' : 'No carriers',
        x + width - 12,
        top + 65,
        { font: body, fill: '#c8d2c3', align: 'right' },
      );
      s.text('W  Waiting jobs', x + 12, top + 88, { font: small, fill: '#e3b475' });
      s.text('A  Assigned jobs', x + width / 2, top + 88, { font: small, fill: '#9bcbba' });
      return;
    }
    const font = '600 12px system-ui,sans-serif',
      maxWidth = Math.min(vw - 24, 580);
    let label = _logisticsCaption;
    while (label.length > 8 && s.measureText(label, font) > maxWidth - 22)
      label = label.slice(0, -4) + '…';
    const width = s.measureText(label, font) + 22,
      x = Math.max(12, (vw - width) / 2);
    s.g
      .roundRect(x, top + 12, width, 28, 7)
      .fill({ color: 0x121f1c, alpha: 0.92 })
      .stroke({ color: 0xd2dbb5, alpha: 0.45, width: 1 });
    s.text(label, x + 11, top + 31, { font, fill: '#efe8cf' });
  }
  const clouds: { x0: number; y0: number; s: number; v: number; w: number }[] = [],
    birds: { x: number; y: number; vx: number; vy: number; f: number }[] = [];
  function initSky() {
    for (let i = 0; i < 6; i++)
      clouds.push({
        x0: Math.random() * (game.W * game.TS + 600),
        y0: Math.random() * (game.H * game.TS + 400),
        s: 0.75 + Math.random() * 0.9,
        v: 5 + Math.random() * 5,
        w: 300 + Math.random() * 260,
      });
    for (let i = 0; i < 3; i++)
      birds.push({
        x: Math.random() * (game.W * game.TS + 700),
        y: 60 + Math.random() * (game.H * game.TS - 120),
        vx: 16 + Math.random() * 12,
        vy: (Math.random() - 0.5) * 6,
        f: Math.random() * 9,
      });
  }
  function cloudsDraw(s: SceneLayer, now: number) {
    if (!renderPrefs().weather || renderPrefs().reducedMotion || renderPrefs().quality < 1) return;
    s.clip({ x: 0, y: 0, width: game.W * game.TS, height: game.H * game.TS });
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const px = ((c.x0 + now * 0.001 * c.v) % (game.W * game.TS + c.w)) - c.w;
      const py = c.y0 + Math.sin(now / 9000 + i) * 30;
      s.image(game.ART.cloud, px, py, c.w * c.s, c.w * 0.62 * c.s, 0.8);
    }
    s.clip();
  }
  function birdsDraw(s: SceneLayer, now: number) {
    if (renderPrefs().reducedMotion || renderPrefs().quality < 1) return;
    const g = s.g;
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      const x = ((b.x + now * 0.001 * b.vx) % (game.W * game.TS + 800)) - 400;
      const y = b.y + Math.sin(now / 4000 + i * 2) * 40;
      const fl = Math.sin(now / 90 + b.f);
      for (let k = 0; k < 4; k++) {
        const bx = x - k * 6,
          by = y + Math.abs(k) * 3.4 + (k % 2 ? 2 : 0);
        g.moveTo(bx - 3.4, by - fl * 2.2)
          .lineTo(bx, by + 1)
          .lineTo(bx + 3.4, by - fl * 2.2);
      }
      g.stroke({ color: 0x403a2e, alpha: 0.55, width: 1.1 });
    }
  }

  // ---------- day/night + weather (wall-clock, cosmetic only; frozen at noon in TESTMODE) ----------
  const DAYLEN = 600000; // full cycle = 10 real minutes
  function nightAmt() {
    // 0 = noon, 1 = midnight (t=0 dawn start of the run)
    if (game.TESTMODE) return 0;
    const t = (performance.now() / DAYLEN) % 1;
    return 0.5 - 0.5 * Math.cos(t * 6.28318);
  }
  function nightCool() {
    const n = nightAmt();
    return n < 0.45 ? 0 : (n - 0.45) / 0.55;
  } // 0..1 blue tint driver
  function nightWarm() {
    const n = nightAmt();
    return n <= 0 ? 0 : Math.exp(-Math.pow((n - 0.5) / 0.14, 2)) * 0.15;
  } // dawn/dusk bell
  let _rain = 0,
    _rainTarget = 0,
    _rainNext = 0,
    _flashT = -9999,
    RSEEDS: [number, number, number][] | null = null;
  function rainAmt() {
    return game.TESTMODE || !renderPrefs().weather ? 0 : _rain;
  }
  function weatherTick(now: number, dt: number) {
    if (game.TESTMODE || !renderPrefs().weather) {
      _rain = 0;
      return;
    }
    if (now > _rainNext) {
      _rainTarget = _rainTarget > 0 ? 0 : Math.random() < 0.5 ? 1 : 0;
      _rainNext =
        now + (_rainTarget > 0 ? 45000 + Math.random() * 45000 : 120000 + Math.random() * 240000);
    }
    _rain += (_rainTarget - _rain) * Math.min(1, dt * 0.35);
    if (_rain > 0.55 && Math.random() < dt * 0.05) {
      game.SND.thunder();
      if (!renderPrefs().reducedMotion) _flashT = now;
    }
  }
  /** Screen-space rain streaks, in CSS pixels. */
  function rainDraw(s: SceneLayer, now: number) {
    if (renderPrefs().reducedMotion) return;
    if (!RSEEDS) {
      RSEEDS = [];
      for (let i = 0; i < 110; i++)
        RSEEDS.push([Math.random(), Math.random(), 0.75 + Math.random() * 0.5]);
    }
    const g = s.g,
      n = (RSEEDS.length * _rain) | 0;
    if (!n) return;
    for (let k = 0; k < n; k++) {
      const r = RSEEDS[k],
        fall = now * 0.001 * r[2];
      const y = (r[1] * vh + fall * 900) % vh,
        x = (r[0] * vw + y * 0.22) % vw;
      g.moveTo(x, y).lineTo(x - 2.6, y - 10);
    }
    g.stroke({ color: 0xbed6e8, alpha: 0.34 * _rain, width: 1 });
  }
  function glowsDraw(s: SceneLayer) {
    // warm window auras at night, above the tint
    const vx0 = Math.max(0, Math.floor(cam.x / game.TS) - 1),
      vx1 = Math.min(game.W - 1, Math.ceil((cam.x + vw / z) / game.TS) + 1);
    const vy0 = Math.max(0, Math.floor(cam.y / game.TS) - 1),
      vy1 = Math.min(game.H - 1, Math.ceil((cam.y + vh / z) / game.TS) + 1);
    const light = Math.min(0.7, nightCool() * 1.25);
    for (let bi = 0; bi < game.buildings.length; bi++) {
      const b = game.buildings[bi];
      if (!b.done) continue;
      if (UNLIT_AT_NIGHT.has(b.type)) continue;
      if (b.x < vx0 || b.x > vx1 || b.y < vy0 || b.y > vy1) continue;
      const sc = game.BSPEC[b.type].store ? 34 : 24,
        lx = b.x * game.TS + 12,
        ly = b.y * game.TS + 8;
      s.image(game.ART.glow, lx - sc / 2, ly - sc / 2, sc, sc, light);
      // A broad faint pool reaches the entrance without obscuring road traffic.
      s.image(game.ART.glow, lx - 15, b.y * game.TS + 19, 30, 9, light * 0.3);
    }
  }

  // Premultiplied [r, g, b, alpha] of the screen-space veils stacked source-over.
  const screenTint: [number, number, number, number] = [0, 0, 0, 0];
  function veil(r: number, g: number, b: number, alpha: number) {
    const keep = 1 - alpha;
    screenTint[0] = (r / 255) * alpha + screenTint[0] * keep;
    screenTint[1] = (g / 255) * alpha + screenTint[1] * keep;
    screenTint[2] = (b / 255) * alpha + screenTint[2] * keep;
    screenTint[3] = alpha + screenTint[3] * keep;
  }
  function composeScreenTint(): PremultipliedTint {
    screenTint.fill(0);
    // Visual clarity suppresses every veil; Reduced Motion suppresses the flash.
    if (renderPrefs().clarity) return screenTint;
    const cool = nightCool(),
      warm = nightWarm();
    if (cool > 0.01) veil(20, 34, 66, cool * 0.29);
    if (warm > 0.01) veil(255, 177, 98, warm * 0.75);
    if (_rain > 0.01) veil(37, 52, 64, _rain * 0.16);
    if (!renderPrefs().reducedMotion && renderPrefs().weather && NOW - _flashT < 180)
      veil(255, 255, 255, (1 - (NOW - _flashT) / 180) * 0.26);
    return screenTint;
  }

  // ---------- guard-post placement preview (the *actual* new border, not the naive radius) ----------
  function guardPreview(s: SceneLayer, now: number) {
    now = motionTime(now);
    if (
      !game.mode ||
      game.mode.type !== 'build' ||
      game.mode.bt !== 'guard' ||
      !game.ghost ||
      !game.ghost.in ||
      !game.ghost.ok
    )
      return;
    if (game.gpDirty || game.gpX !== game.ghost.x || game.gpY !== game.ghost.y)
      game.computeGuardPreview(game.ghost.x, game.ghost.y);
    const g = s.g;
    for (let i = 0; i < game.gpFill.length; i++) {
      const fi = game.gpFill[i];
      g.rect((fi % game.W) * game.TS, ((fi / game.W) | 0) * game.TS, game.TS, game.TS);
    }
    if (game.gpFill.length) g.fill({ color: 0xffd23f, alpha: 0.07 });
    // One dash pattern continues along every border segment.
    const pu = 0.5 + 0.5 * Math.sin(now / 240);
    let offset = -now / 40;
    for (let i = 0; i < game.gpSegs.length; i++) {
      const s2 = game.gpSegs[i];
      dashed(g, s2, 7, 5, offset);
      offset += Math.hypot(s2[2] - s2[0], s2[3] - s2[1]);
    }
    if (game.gpSegs.length) g.stroke({ color: 0xffe282, alpha: 0.5 + 0.35 * pu, width: 2 });
  }
  function cloudsShadowDraw(s: SceneLayer, now: number) {
    // drifting ground shadows under the sky blobs (sun NW -> SE offset)
    if (!renderPrefs().weather || renderPrefs().reducedMotion || renderPrefs().quality < 1) return;
    s.clip({ x: 0, y: 0, width: game.W * game.TS, height: game.H * game.TS });
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const px = ((c.x0 + now * 0.001 * c.v) % (game.W * game.TS + c.w)) - c.w;
      const py = c.y0 + Math.sin(now / 9000 + i) * 30;
      s.image(game.ART.cloudShadow, px + 46, py + 58, c.w * 0.78 * c.s, c.w * 0.5 * c.s, 0.9);
    }
    s.clip();
  }

  // ---------- event reconciliation (fx for things the engine did) ----------
  let _seen: Record<string, SeenBuilding> = {},
    _warmup = false,
    _nextHam = 0;
  let workPulses: Record<string, WorkPulse> = {},
    _renderEventsReady = false;
  function initRenderEvents() {
    if (_renderEventsReady || typeof game.gameEvents === 'undefined') return;
    _renderEventsReady = true;
    observePresentation(game, 'goodsProduced', function (e) {
      const b = e.building;
      if (!b) return;
      workPulses[b.id] = { t: performance.now(), good: e.good };
      if (visibleAt(b.x, b.y) && !renderPrefs().reducedMotion)
        FX.spark(b.x + 0.9, b.y + 0.65, game.GOODS[e.good].c, 3);
    });
    observePresentation(game, 'goodsDelivered', function (e) {
      const b = e.building;
      if (!b || !visibleAt(b.x, b.y)) return;
      workPulses[b.id] = { t: performance.now(), good: e.good };
    });
    observePresentation(
      game,
      'tileChanged',
      function (e) {
        shadowCache.tileChanged(e.index);
        if (game.tiles[e.index] && !game.staticDirty) drawTile(sctx, e.index);
      },
      (error) => {
        const reason = error instanceof Error ? error.message : 'Terrain update failed';
        reportGraphicsFailure(reason);
      },
    );
  }
  initRenderEvents();
  observePresentation(game, 'worldLoaded', () => {
    game.staticDirty = true;
    resetPresentation();
  });
  observePresentation(game, 'territoryChanged', () => {
    borderDirty = true;
    for (let i = 0; i < game.owned.length; i++)
      if (game.owned[i] !== borderOwned[i]) miniTiles.add(i);
    _placementCache = null;
    _roadCache = null;
  });
  // A committed load clears every transient presentation cache through this one
  // sanctioned method; loaders never poke renderer internals field by field.
  function resetPresentation() {
    shadowCache.reset();
    _pausedNow = null;
    FXL.length = 0;
    _seen = {};
    _warmup = false;
    macroCan = null;
    _placementCache = null;
    _roadCache = null;
    unitPoses = {};
    workPulses = {};
    borderReady = false;
    borderDirty = true;
    miniDirty = true;
    miniTiles.clear();
  }
  function visibleAt(x: number, y: number) {
    return (
      x * game.TS + game.TS > cam.x - 24 &&
      x * game.TS < cam.x + vw / z + 24 &&
      y * game.TS + game.TS > cam.y - 24 &&
      y * game.TS < cam.y + vh / z + 24
    );
  }
  function reconcileFx() {
    for (const key in _seen) _seen[key].present = false;
    for (let i = 0; i < game.buildings.length; i++) {
      const b = game.buildings[i],
        s = _seen[b.id];
      if (!s) {
        _seen[b.id] = { done: b.done, x: b.x, y: b.y, present: true };
        if (_warmup && visibleAt(b.x, b.y)) FX.dust(b.x + 0.5, b.y + 0.5);
        continue;
      }
      if (!s.done && b.done) {
        s.done = true;
        if (_warmup) FX.pop(b.x + 0.5, b.y + 0.6);
      }
      s.x = b.x;
      s.y = b.y;
      s.present = true;
    }
    for (const id in _seen) {
      const s2 = _seen[id];
      if (!s2.present) {
        if (visibleAt(s2.x, s2.y)) {
          FX.dust(s2.x + 0.5, s2.y + 0.5);
          FX.ring(s2.x + 0.5, s2.y + 0.5, '#d8c07c', 9);
        }
        delete _seen[id];
        delete workPulses[id];
      }
    }
    if (renderStats.samples % 120 === 0) {
      const live: Record<string, boolean> = {};
      for (let ui = 0; ui < game.units.length; ui++) live[game.units[ui].id] = true;
      for (const uid in unitPoses) if (!live[uid]) delete unitPoses[uid];
    }
    _warmup = true;
  }
  function ambFX(now: number) {
    if (!game.AC || game.muted || game.state.paused || document.visibilityState !== 'visible')
      return;
    if (now < _nextHam) return;
    _nextHam = now + 620 + Math.random() * 760;
    // Production sounds are dispatched from goodsProduced by the audio system.
    const site = [];
    for (let i = 0; i < game.buildings.length; i++) {
      const b3 = game.buildings[i];
      if (!b3.done && b3.constructionProgress > 0 && game.siteReady(b3) && visibleAt(b3.x, b3.y))
        site.push(b3);
    }
    if (site.length) {
      const b4 = site[(Math.random() * site.length) | 0];
      game.SND.hammer(b4.x, b4.y);
    }
  }

  // ---------- frame ----------
  let _lastNow = 0,
    _pausedNow: number | null = null;
  function draw() {
    if (!presentation.available) return;
    const drawStart = performance.now(),
      frameMs = _lastNow ? drawStart - _lastNow : 0;
    const wallNow = performance.now();
    if (game.state.paused) _pausedNow ??= wallNow;
    else _pausedNow = null;
    NOW = wallNow;
    const decorativeNow = _pausedNow ?? wallNow;
    initRenderEvents();
    stepZoom(wallNow);
    weatherTick(wallNow, Math.min(0.1, (wallNow - _lastNow) / 1000) || 0.016);
    _lastNow = wallNow;
    if (game.staticDirty) drawStatic();
    else if (borderDirty) drawBorders();
    reconcileFx();
    presentation.begin({
      width: Math.round(vw * dpr),
      height: Math.round(vh * dpr),
      cssWidth: vw,
      cssHeight: vh,
      dpr,
      scale: dpr * z,
      camX: cam.x,
      camY: cam.y,
    });
    const mapW = game.W * game.TS,
      mapH = game.H * game.TS;
    presentation.layer('backdrop', function (s) {
      // The opaque terrain hides everything beneath it, so fill only the bands
      // of the viewport the map leaves uncovered (screen pixels).
      const left = Math.min(vw, Math.max(0, -cam.x * z)),
        right = Math.min(vw, Math.max(0, (mapW - cam.x) * z)),
        top = Math.min(vh, Math.max(0, -cam.y * z)),
        bottom = Math.min(vh, Math.max(0, (mapH - cam.y) * z));
      if (left <= 0 && top <= 0 && right >= vw && bottom >= vh) return;
      backdropGradient ??= new FillGradient({
        type: 'linear',
        start: { x: 0, y: 0 },
        end: { x: 0, y: vh },
        colorStops: [
          { offset: 0, color: '#12222e' },
          { offset: 1, color: '#0a141d' },
        ],
        textureSpace: 'global',
      });
      const g = s.g;
      if (right <= left || bottom <= top) g.rect(0, 0, vw, vh);
      else {
        if (top > 0) g.rect(0, 0, vw, top);
        if (bottom < vh) g.rect(0, bottom, vw, vh - bottom);
        if (left > 0) g.rect(0, top, left, bottom - top);
        if (right < vw) g.rect(right, top, vw - right, bottom - top);
      }
      g.fill(backdropGradient);
      // Drop shadows offset south-east; only their strips beyond the map show.
      for (const [dx, dy, alpha] of [
        [4, 5, 0.5],
        [2, 2, 0.35],
      ]) {
        g.rect((mapW - cam.x) * z, (dy - cam.y) * z, dx * z, mapH * z)
          .rect((dx - cam.x) * z, (mapH - cam.y) * z, (mapW - dx) * z, dy * z)
          .fill({ color: 0x04080c, alpha });
      }
    });
    presentation.layer('terrain', function (s) {
      // Show only the visible terrain rectangle instead of the whole 48 MB atlas.
      const sx = Math.max(0, cam.x),
        sy = Math.max(0, cam.y),
        sw = Math.min(mapW - sx, cam.x + vw / z - sx),
        sh2 = Math.min(mapH - sy, cam.y + vh / z - sy);
      if (sw > 0 && sh2 > 0) {
        s.blit(scan, sx * game.ST, sy * game.ST, sw * game.ST, sh2 * game.ST, sx, sy, sw, sh2);
        s.blit(bcan, sx, sy, sw, sh2, sx, sy, sw, sh2);
        // Quiet the high-frequency ground material without rebuilding terrain.
        if (renderPrefs().clarity) s.g.rect(sx, sy, sw, sh2).fill({ color: 0x9eaf7d, alpha: 0.2 });
      }
    });
    presentation.layer('ground-effects', function (s) {
      shadowCache.refresh();
      const castOpacity = renderPrefs().clarity
        ? 0.06 / 0.17
        : (1 - nightCool()) * (1 - rainAmt() * 0.8);
      s.shadows(
        shadowCache.cast,
        shadowCache.contacts,
        castOpacity < 0.02 / 0.17 ? 0 : castOpacity,
        renderPrefs().clarity ? 0.62 : 1,
      );
      waterAnim(s, decorativeNow);
      highlights(s, decorativeNow);
      guardPreview(s, decorativeNow);
      demoMarkers(s);
      clarityRoads(s);
      if (!renderPrefs().clarity) cloudsShadowDraw(s, decorativeNow);
    });
    drawObjects(decorativeNow);
    presentation.layer('foreground-effects', function (s) {
      fxDraw(s, wallNow);
      meadowParticles(s, decorativeNow);
      clarityBuildings(s);
      selection(s, decorativeNow);
      anchorDraw(s, decorativeNow);
      ghostDraw(s);
      logisticsDraw(s);
      if (!renderPrefs().clarity) {
        cloudsDraw(s, decorativeNow);
        birdsDraw(s, decorativeNow);
      }
    });
    // Night, dusk, rain and lightning veils reach the atmosphere pass as one tint.
    presentation.screenTint?.(composeScreenTint());
    presentation.layer('above-atmosphere', function (s) {
      // lantern glows sit above the night tint
      if (!renderPrefs().clarity && nightCool() > 0.04) glowsDraw(s);
    });
    presentation.layer('overlay', function (s) {
      if (!renderPrefs().clarity && _rain > 0.02) rainDraw(s, decorativeNow);
      logisticsCaption(s);
    });
    presentation.end();
    ambFX(NOW);
    sampleRender(frameMs, performance.now() - drawStart);
  }

  // ---------- minimap ----------
  const mscan = game.Acan(192, 192),
    msctx = requireCanvas2D(mscan, reportGraphicsFailure);
  let miniDirty = true;
  let _miniRendered = 0;
  const miniTiles = new Set<number>();
  let miniVignette: CanvasGradient | null = null;
  function paintMiniTile(i: number, vignette: CanvasGradient) {
    const s = 192 / game.W,
      x = (i % game.W) * s,
      y = ((i / game.W) | 0) * s,
      tl = game.tiles[i];
    let c;
    if (tl.t === game.WATER) c = '#447b89';
    else if (tl.t === game.SAND) c = '#d7c39b';
    else if (tl.t === game.MTN) c = '#aaa79a';
    else c = tl.tree ? '#4b7040' : '#6b8750';
    msctx.fillStyle = c;
    msctx.fillRect(x, y, s, s);
    if (tl.deposit && tl.deposit.amt > 0) {
      msctx.fillStyle =
        tl.deposit.kind === 'gold' ? '#ffd23f' : tl.deposit.kind === 'iron' ? '#d0763a' : '#565e68';
      msctx.fillRect(x, y, s, s);
      const fraction = tl.deposit.amt / (tl.deposit.amt0 || tl.deposit.amt);
      if (fraction < 0.999) {
        msctx.fillStyle = 'rgba(0,0,0,' + ((1 - fraction) * 0.55).toFixed(2) + ')';
        msctx.fillRect(x, y, s, s);
      }
    }
    if (game.owned[i]) {
      msctx.fillStyle = 'rgba(255,214,110,0.16)';
      msctx.fillRect(x, y, s, s);
    }
    if (tl.road) {
      msctx.fillStyle = '#c2a878';
      msctx.fillRect(x, y, s, s);
    }
    // Use the same world-aligned vignette on both full and incremental paints.
    msctx.fillStyle = vignette;
    msctx.fillRect(x, y, s, s);
  }
  function drawMiniStatic() {
    if (!miniVignette) {
      miniVignette = msctx.createRadialGradient(96, 96, 60, 96, 96, 140);
      miniVignette.addColorStop(0, 'rgba(0,0,0,0)');
      miniVignette.addColorStop(1, 'rgba(0,0,0,0.22)');
    }
    if (miniDirty) {
      msctx.fillStyle = '#101418';
      msctx.fillRect(0, 0, 192, 192);
      for (let i = 0; i < game.tiles.length; i++) paintMiniTile(i, miniVignette);
    } else {
      for (const i of miniTiles) paintMiniTile(i, miniVignette);
    }
    miniTiles.clear();
    miniDirty = false;
  }
  function miniDia(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    c: string,
    edge?: string,
  ) {
    g.beginPath();
    g.moveTo(x, y - r);
    g.lineTo(x + r, y);
    g.lineTo(x, y + r);
    g.lineTo(x - r, y);
    g.closePath();
    if (edge) {
      g.strokeStyle = edge;
      g.lineWidth = 1;
      g.stroke();
    }
    g.fillStyle = c;
    g.fill();
  }
  function drawMini() {
    if (!miniDirty && !miniTiles.size && NOW - _miniRendered < 100) return;
    _miniRendered = NOW;
    if (miniDirty || miniTiles.size) drawMiniStatic();
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.drawImage(mscan, 0, 0);
    const s = 192 / game.W;
    for (let i = 0; i < game.buildings.length; i++) {
      const b = game.buildings[i],
        cxm = b.x * s + s / 2,
        cym = b.y * s + s / 2;
      if (game.selected === b) {
        miniDia(mctx, cxm, cym, 3.4, '#baf6ff', '#123a44');
        miniDia(mctx, cxm, cym, 2, '#5ce8ff');
      } else miniDia(mctx, cxm, cym, 2.2, '#ffd23f', 'rgba(60,40,10,0.9)');
    }
    for (let pi = 0; pi < game.buildings.length; pi++) {
      // red pulses for buildings needing attention
      const pb = game.buildings[pi];
      if (!game.bStatus(pb).bad) continue;
      const pu = renderPrefs().reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(NOW / 230 + pb.id);
      mctx.fillStyle = 'rgba(255,70,56,' + (0.3 + 0.6 * pu).toFixed(3) + ')';
      mctx.beginPath();
      mctx.arc(pb.x * s + s / 2, pb.y * s + s / 2, 2.2 + pu * 1.6, 0, 7);
      mctx.fill();
    }
    for (let i = 0; i < game.units.length; i++) {
      const u = game.units[i];
      mctx.fillStyle = u.kind === 'soldier' ? '#ff7a7a' : '#d8ecff';
      mctx.fillRect(u.x * s - 0.8, u.y * s - 0.8, 1.9, 1.9);
    }
    mctx.strokeStyle = 'rgba(255,255,255,0.28)';
    mctx.lineWidth = 3;
    mctx.strokeRect(
      (cam.x / (game.W * game.TS)) * 192,
      (cam.y / (game.H * game.TS)) * 192,
      Math.min(192, (vw / z / (game.W * game.TS)) * 192),
      Math.min(192, (vh / z / (game.H * game.TS)) * 192),
    );
    mctx.strokeStyle = '#fff';
    mctx.lineWidth = 1;
    mctx.strokeRect(
      (cam.x / (game.W * game.TS)) * 192,
      (cam.y / (game.H * game.TS)) * 192,
      Math.min(192 - (cam.x / (game.W * game.TS)) * 192, (vw / z / (game.W * game.TS)) * 192),
      Math.min(192 - (cam.y / (game.H * game.TS)) * 192, (vh / z / (game.H * game.TS)) * 192),
    );
    if (hoverIn) {
      const cxm2 = ((cam.x + mouse.x / z) / (game.W * game.TS)) * 192,
        cym2 = ((cam.y + mouse.y / z) / (game.H * game.TS)) * 192;
      mctx.strokeStyle = '#ffd23f';
      mctx.lineWidth = 1;
      mctx.beginPath();
      mctx.moveTo(cxm2 - 5, cym2);
      mctx.lineTo(cxm2 - 2, cym2);
      mctx.moveTo(cxm2 + 2, cym2);
      mctx.lineTo(cxm2 + 5, cym2);
      mctx.moveTo(cxm2, cym2 - 5);
      mctx.lineTo(cxm2, cym2 - 2);
      mctx.moveTo(cxm2, cym2 + 2);
      mctx.lineTo(cxm2, cym2 + 5);
      mctx.stroke();
      mctx.fillStyle = '#ffd23f';
      mctx.fillRect(cxm2 - 0.7, cym2 - 0.7, 1.4, 1.4);
    }
  }

  // Test-only view of closure internals; never merged into the runtime.
  if (internals) {
    Object.assign(internals, {
      paintTileFull,
      drawStatic,
      drawBorders,
      drawMiniStatic,
      buildingContour,
      drawBuilding,
      shadowCache,
      drawTree,
      drawSmoke,
      drawUnit,
      meadowParticles,
      fxDraw,
      getPlacementPreview,
      getRoadPreview,
      clarityBuildings,
      glowsDraw,
    });
    Object.defineProperties(internals, {
      terrainRevision: {
        get: () => terrainRevision,
        set: (value) => {
          terrainRevision = value;
        },
        enumerable: true,
      },
      miniDirty: {
        get: () => miniDirty,
        set: (value) => {
          miniDirty = value;
        },
        enumerable: true,
      },
      atmosphereCount: {
        get: () => atmosphereCount,
        set: (value) => {
          atmosphereCount = value;
        },
        enumerable: true,
      },
      _rain: {
        get: () => _rain,
        set: (value) => {
          _rain = value;
        },
        enumerable: true,
      },
    });
  }

  // Live bindings preserve replacement of arrays and mutable subsystem state.
  return {
    reportGraphicsFailure,
    get staticDirty() {
      return staticDirty;
    },
    set staticDirty(value: boolean) {
      staticDirty = value;
    },
    get renderingAvailable() {
      return !!presentation?.available;
    },
    get sctx() {
      return sctx;
    },
    get borderDirty() {
      return borderDirty;
    },
    set borderDirty(value: typeof borderDirty) {
      borderDirty = value;
    },
    get FXL() {
      return FXL;
    },
    get NOW() {
      return NOW;
    },
    set NOW(value: typeof NOW) {
      NOW = value;
    },
    renderPrefs,
    get renderStats() {
      return renderStats;
    },
    tileHash,
    drawTile,
    get macroCan() {
      return macroCan;
    },
    set macroCan(value: typeof macroCan) {
      macroCan = value;
    },
    get view() {
      return view;
    },
    get mini() {
      return mini;
    },
    get z() {
      return z;
    },
    set z(value: typeof z) {
      z = value;
    },
    get zooms() {
      return zooms;
    },
    get zi() {
      return zi;
    },
    set zi(value: typeof zi) {
      zi = value;
    },
    get cam() {
      return cam;
    },
    set cam(value: typeof cam) {
      cam = value;
    },
    get vw() {
      return vw;
    },
    set vw(value: typeof vw) {
      vw = value;
    },
    get vh() {
      return vh;
    },
    set vh(value: typeof vh) {
      vh = value;
    },
    get mouse() {
      return mouse;
    },
    get ht() {
      return ht;
    },
    set ht(value: typeof ht) {
      ht = value;
    },
    get hoverIn() {
      return hoverIn;
    },
    set hoverIn(value: typeof hoverIn) {
      hoverIn = value;
    },
    get mouseSeen() {
      return mouseSeen;
    },
    set mouseSeen(value: typeof mouseSeen) {
      mouseSeen = value;
    },
    placementPreview: getPlacementPreview,
    roadPreview: getRoadPreview,
    resize,
    clampCam,
    screenToWorld,
    get zoomAnim() {
      return zoomAnim;
    },
    set zoomAnim(value: typeof zoomAnim) {
      zoomAnim = value;
    },
    zoomAt,
    miniClick,
    get keys() {
      return keys;
    },
    bldImg,
    drawSpriteIcon,
    get unitPoses() {
      return unitPoses;
    },
    set unitPoses(value: typeof unitPoses) {
      unitPoses = value;
    },
    get FX() {
      return FX;
    },
    get _placementCache() {
      return _placementCache;
    },
    set _placementCache(value: typeof _placementCache) {
      _placementCache = value;
    },
    get _roadCache() {
      return _roadCache;
    },
    set _roadCache(value: typeof _roadCache) {
      _roadCache = value;
    },
    initSky,
    nightAmt,
    rainAmt,
    get _seen() {
      return _seen;
    },
    set _seen(value: typeof _seen) {
      _seen = value;
    },
    get _warmup() {
      return _warmup;
    },
    set _warmup(value: typeof _warmup) {
      _warmup = value;
    },
    get workPulses() {
      return workPulses;
    },
    set workPulses(value: typeof workPulses) {
      workPulses = value;
    },
    resetPresentation,
    drawMini,
    draw,
  };
}

export interface RendererSubsystem {
  reportGraphicsFailure: (reason: string) => void;
  staticDirty: boolean;
  readonly renderingAvailable: boolean;
  readonly sctx: CanvasRenderingContext2D;
  borderDirty: boolean;
  readonly FXL: FXEffect[];
  NOW: number;
  renderPrefs: () => PresentationPreferences;
  readonly renderStats: {
    samples: number;
    drawMs: number;
    frameMs: number;
    p95Ms: number;
    objects: number;
    effects: number;
    resolution: number;
  };
  tileHash: (i: number) => number;
  drawTile: (g: CanvasRenderingContext2D, i: number) => void;
  macroCan: HTMLCanvasElement | null;
  readonly view: HTMLCanvasElement;
  readonly mini: HTMLCanvasElement;
  z: number;
  readonly zooms: number[];
  zi: number;
  cam: { x: number; y: number };
  vw: number;
  vh: number;
  readonly mouse: { x: number; y: number };
  ht: { x: number; y: number };
  hoverIn: boolean;
  mouseSeen: boolean;
  /** Cached current-world queries consumed by the production placement UI. */
  placementPreview: () => PlacementPreview | null;
  roadPreview: () => RoadPreview | null;
  resize: () => void;
  clampCam: () => void;
  screenToWorld: (mx: number, my: number) => TilePoint;
  zoomAnim: ZoomAnim | null;
  zoomAt: (nzi: number, ax?: number, ay?: number) => void;
  miniClick: (e: MouseEvent) => void;
  readonly keys: { l: boolean; r: boolean; u: boolean; d: boolean };
  bldImg: (b: Building) => Sprite;
  drawSpriteIcon: (
    g: CanvasRenderingContext2D,
    type: BuildingType,
    cx: number,
    cy: number,
    size: number,
  ) => void;
  unitPoses: Record<string, UnitPose>;
  readonly FX: {
    coin: (x: number, y: number) => void;
    ring: (x: number, y: number, c: string, r: number) => void;
    spark: (x: number, y: number, c: string, n: number) => void;
    dust: (x: number, y: number) => void;
    pop: (x: number, y: number) => void;
  };
  _placementCache: PlacementPreview | null;
  _roadCache: RoadPreview | null;
  initSky: () => void;
  nightAmt: () => number;
  rainAmt: () => number;
  _seen: Record<string, SeenBuilding>;
  _warmup: boolean;
  workPulses: Record<string, WorkPulse>;
  resetPresentation: () => void;
  drawMini: () => void;
  draw: () => void;
}

/** Open yards and mine mouths have no domestic window to illuminate at night. */
export const UNLIT_AT_NIGHT: ReadonlySet<BuildingType> = new Set<BuildingType>([
  'well',
  'pigfarm',
  'quarry',
  'mine_coal',
  'mine_iron',
  'mine_gold',
]);

/** Test-only view of closure internals; never merged into the runtime. */
export interface RendererInternals {
  shadowCache: ReturnType<typeof createShadowCache>;
  paintTileFull: (g: CanvasRenderingContext2D, i: number) => void;
  drawStatic: () => void;
  drawBorders: (full?: boolean) => void;
  drawMiniStatic: () => void;
  buildingContour: (img: Sprite) => HTMLCanvasElement;
  drawBuilding: (s: SceneLayer, b: Building) => void;
  drawTree: (s: SceneLayer, x: number, y: number, tl: Tile, now: number) => void;
  drawSmoke: (s: SceneLayer, x: number, y: number, now: number, sd: number) => void;
  drawUnit: (s: SceneLayer, u: Unit, now: number) => void;
  meadowParticles: (s: SceneLayer, now: number) => void;
  fxDraw: (s: SceneLayer, now: number) => void;
  getPlacementPreview: () => PlacementPreview | null;
  getRoadPreview: () => RoadPreview | null;
  clarityBuildings: (s: SceneLayer) => void;
  glowsDraw: (s: SceneLayer) => void;
  terrainRevision: number;
  miniDirty: boolean;
  atmosphereCount: number;
  _rain: number;
}
