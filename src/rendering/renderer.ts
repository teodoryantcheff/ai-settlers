import type { PlacementChecks, BuildingAffordability } from '../simulation/economy.ts';
import type {
  Building,
  BuildingSpec,
  BuildingType,
  Good,
  Inventory,
  LayerName,
  PresentationPreferences,
  ProductionBlockReason,
  Sprite,
  Tile,
  TilePoint,
  Unit,
} from '../types.ts';
import { observePresentation } from '../ui/domain-feedback.ts';
import type { GameRuntime } from '../runtime.ts';

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

/** Ordered scene commands consumed by the PixiJS world renderer. */
export interface RendererPresentation {
  available: boolean;
  /** Surface observer/cache failures through the same visible GPU failure boundary. */
  reportFailure?: (reason: string) => void;
  /** Refresh the GPU copy of a cached canvas. `rect` (canvas pixels) limits the
   * upload to the changed region; omitting it refreshes the whole canvas. */
  invalidate: (
    canvas: HTMLCanvasElement,
    rect?: { x: number; y: number; width: number; height: number },
  ) => void;
  begin: (ctx: CanvasRenderingContext2D) => void;
  layer: (name: LayerName, ctx: CanvasRenderingContext2D, paint: () => void) => void;
  end: (ctx: CanvasRenderingContext2D) => void;
}

export function createRenderer(
  game: GameRuntime,
  scenePresentation: RendererPresentation,
  internals?: RendererInternals,
): RendererSubsystem {
  const presentation = scenePresentation;
  let staticDirty = true;
  function layer(name: LayerName, paint: () => void) {
    presentation.layer(name, ctx, paint);
  }
  // ==================== RENDERER ====================
  // Layered presentation over the unchanged simulation:
  //   scan  — cached connected terrain, mineral seams, shadows and roads
  //   bcan  — quiet territory survey line
  //   per-frame — animated water, y-sorted buildings/trees/rocks/units, effects, ghost

  const scan = game.Acan(game.W * game.TS * game.ST, game.H * game.TS * game.ST),
    sctx = scan.getContext('2d', { willReadFrequently: true });
  const bcan = game.Acan(game.W * game.TS, game.H * game.TS),
    bctx = bcan.getContext('2d', { willReadFrequently: true });
  let borderDirty = true;
  const borderSegs: LineSeg[] = [];
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
  function diaPath(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
    g.beginPath();
    g.moveTo(x, y - r);
    g.lineTo(x + r, y);
    g.lineTo(x, y + r);
    g.lineTo(x - r, y);
    g.closePath();
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
    terrainRevision++;
    paintTileFull(g, i);
    if (macroCan) paintMacroTile(g, i);
    miniDirty = true;
    // Both painters clip to the tile, so the upload can be limited to its rect.
    const tss = game.TS * game.ST;
    presentation?.invalidate(g.canvas, {
      x: (i % game.W) * tss,
      y: ((i / game.W) | 0) * tss,
      width: tss,
      height: tss,
    });
  }
  let macroCan: HTMLCanvasElement | null = null;
  function buildMacro() {
    macroCan = game.Acan(game.W, game.H);
    const g = macroCan.getContext('2d'),
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
  }
  function paintMacroTile(g: CanvasRenderingContext2D, i: number) {
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
  function drawBorders() {
    const g = bctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, game.W * game.TS, game.H * game.TS);
    borderSegs.length = 0;
    for (let y2 = 0; y2 < game.H; y2++)
      for (let x2 = 0; x2 < game.W; x2++) {
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
    borderDirty = false;
    miniDirty = true;
    presentation?.invalidate(bcan);
  }
  function drawStatic() {
    terrainRevision++;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.imageSmoothingEnabled = true;
    for (let y = 0; y < game.H; y++)
      for (let x = 0; x < game.W; x++) paintTileFull(sctx, game.idx(x, y));
    if (!macroCan) buildMacro();
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(macroCan, 0, 0, game.W * game.TS * game.ST, game.H * game.TS * game.ST);
    drawBorders();
    game.staticDirty = false;
    presentation?.invalidate(scan);
  }

  // ---------- camera ----------
  const view = document.getElementById('view') as HTMLCanvasElement,
    ctx = game.Acan(1, 1).getContext('2d');
  const mini = document.getElementById('mini') as HTMLCanvasElement,
    mctx = mini.getContext('2d');
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
  let bgGrad: CanvasGradient | null = null;
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
    view.width = ctx.canvas.width = Math.round(vw * dpr);
    view.height = ctx.canvas.height = Math.round(vh * dpr);
    view.style.width = vw + 'px';
    view.style.height = vh + 'px';
    ctx.canvas.style.width = view.style.width;
    ctx.canvas.style.height = view.style.height;
    if (!mouseSeen) {
      mouse.x = vw / 2;
      mouse.y = vh / 2;
    }
    if (hadViewport) {
      cam.x = centerX - vw / z / 2;
      cam.y = centerY - vh / z / 2;
    }
    bgGrad = null;
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
    ax = ax === undefined || ax === null ? vw / 2 : ax;
    ay = ay === undefined || ay === null ? vh / 2 : ay;
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
    if (game.ART.bld2[b.type])
      return ((b.id * 2654435761) >>> 0) % 2 ? game.ART.bld2[b.type] : game.ART.bld[b.type];
    return game.ART.bld[b.type];
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
      mg = mask.getContext('2d'),
      canvas = game.Acan(mask.width, mask.height),
      cg = canvas.getContext('2d');
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
  function drawSprite(g: CanvasRenderingContext2D, type: BuildingType, cx: number, cy: number) {
    const img = game.ART.bld[type];
    if (!img) return;
    g.drawImage(img.img, cx - 12 + img.ox, cy - 12 + img.oy, img.w, img.h);
  }
  function drawSpriteIcon(
    g: CanvasRenderingContext2D,
    type: BuildingType,
    cx: number,
    cy: number,
    size: number,
  ) {
    const img = game.ART.bld[type] || game.ART.site;
    size = size || 30;
    const s = Math.min(size / img.w, size / img.h);
    const dw = img.w * s,
      dh = img.h * s;
    g.drawImage(img.img, cx - dw / 2, cy - dh / 2, dw, dh);
  }
  function drawFlag(
    g: CanvasRenderingContext2D,
    ax: number,
    ay: number,
    col: string,
    now: number,
    ph: number,
  ) {
    now = motionTime(now);
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
  function drawSmoke(g: CanvasRenderingContext2D, x: number, y: number, now: number, sd: number) {
    if (renderPrefs().clarity || renderPrefs().reducedMotion || game.state.paused) return;
    const count = renderPrefs().quality < 1 ? 3 : 5;
    for (let k = 0; k < count; k++) {
      const ph = (now / 2200 + (sd % 7) * 0.13 + k / count) % 1;
      const r = 0.9 + ph * 3.4,
        a = 0.19 * Math.sin(Math.PI * ph);
      // Warm translucent smoke catches sunlight, then disperses downwind.
      g.fillStyle = 'rgba(235,220,189,' + a.toFixed(3) + ')';
      g.beginPath();
      g.ellipse(x + ph * 7 + Math.sin(ph * 5 + sd) * 1.6, y - ph * 24, r * 1.35, r, -0.3, 0, 7);
      g.fill();
    }
  }
  function drawBadge(g: CanvasRenderingContext2D, cx: number, cy: number) {
    const pulse = renderPrefs().reducedMotion ? 1 : 1 + Math.sin(NOW / 420 + cx * 0.3) * 0.035;
    g.save();
    g.translate(cx, cy);
    g.scale(pulse, pulse);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    game.rr(g, -5, -4, 12.6, 12.6, 3.4);
    g.fill();
    const gr = g.createLinearGradient(0, -5.5, 0, 5.5);
    gr.addColorStop(0, '#ef5a4a');
    gr.addColorStop(1, '#a02525');
    g.fillStyle = gr;
    game.rr(g, -5.5, -5.5, 11, 11, 3);
    g.fill();
    g.strokeStyle = '#ffd0c0';
    g.lineWidth = 1;
    game.rr(g, -5.5, -5.5, 11, 11, 3);
    g.stroke();
    g.fillStyle = '#fff';
    g.font = 'bold 9px Verdana,sans-serif';
    g.textAlign = 'center';
    g.fillText('!', 0, 3.2);
    g.textAlign = 'left';
    g.restore();
  }
  function chip(g: CanvasRenderingContext2D, x: number, y: number, c: string) {
    g.fillStyle = 'rgba(0,0,0,0.38)';
    game.rr(g, x, y, 5, 5, 1);
    g.fill();
    g.fillStyle = c;
    game.rr(g, x + 0.5, y + 0.5, 4, 4, 0.8);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(x + 1, y + 0.9, 3.4, 0.9);
  }
  function drawBuilding(g: CanvasRenderingContext2D, b: Building) {
    g.save();
    g.translate(b.x * game.TS + 12, b.y * game.TS + 22);
    g.scale(1.06, 1.06);
    g.translate(-b.x * game.TS - 12, -b.y * game.TS - 22);
    try {
      const now = game.villageWorkTime(b);
      if (!b.done) {
        const p = Math.min(1, Math.max(0, b.prog));
        game.drawVillageConstruction(g, b, p);
        const bw = game.TS - 16;
        g.fillStyle = 'rgba(0,0,0,0.55)';
        game.rr(g, b.x * game.TS + 8, b.y * game.TS + game.TS - 5, bw, 3.4, 1.6);
        g.fill();
        const pgr = g.createLinearGradient(b.x * game.TS + 8, 0, b.x * game.TS + 8 + bw, 0);
        pgr.addColorStop(0, '#ffe08a');
        pgr.addColorStop(1, '#e8a53c');
        g.fillStyle = pgr;
        game.rr(g, b.x * game.TS + 8, b.y * game.TS + game.TS - 5, bw * Math.min(1, p), 3.4, 1.6);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.3)';
        g.fillRect(b.x * game.TS + 8, b.y * game.TS + game.TS - 5, bw, 1);
        if (game.bStatus(b).bad) drawBadge(g, b.x * game.TS + game.TS - 6, b.y * game.TS + 4);
        if (p > 0 && game.siteReady(b)) drawWorker(g, b, now, 'build');
        return;
      }
      const img2 = bldImg(b),
        sp = game.BSPEC[b.type];
      game.drawVillageYard(g, b);
      // Shared restrained contact shade also grounds installed painted packs.
      // Keep it at the established south threshold, below the sprite/details.
      g.save();
      g.globalAlpha *= renderPrefs().clarity ? 0.28 : 0.5;
      const contactWidth = Math.min(38, img2.w * 0.78);
      g.drawImage(
        game.ART.shadowSoft,
        b.x * game.TS + 12 - contactWidth / 2,
        b.y * game.TS + 19,
        contactWidth,
        10,
      );
      g.restore();
      g.drawImage(
        buildingContour(img2),
        b.x * game.TS + img2.ox - 3,
        b.y * game.TS + img2.oy - 3,
        img2.w + 6,
        img2.h + 6,
      );
      game.drawVillageDetails(g, b);
      const active = game.buildingWorking(b);
      const anc = game.ART.anchors[b.type];
      if (active && anc && anc.blade) {
        const an = anc.blade;
        g.save();
        g.translate(b.x * game.TS + an.x, b.y * game.TS + an.y);
        g.rotate((now / 130) % (Math.PI * 2));
        g.drawImage(game.ART.blade, -4.5, -4.5, 9, 9);
        g.restore();
      }
      if (active && anc && anc.bob) {
        const bo = anc.bob,
          bb = b.y * game.TS + bo.y + Math.sin(now / 700 + b.id) * 1.2;
        g.fillStyle = '#e05555';
        g.beginPath();
        g.arc(b.x * game.TS + bo.x, bb, 1.6, 0, 7);
        g.fill();
        g.fillStyle = '#f4f6f8';
        g.beginPath();
        g.arc(b.x * game.TS + bo.x, bb - 0.5, 0.8, 0, 7);
        g.fill();
      }
      if (anc) {
        if (anc.flag && (b.type !== 'guard' || b.man))
          drawFlag(
            g,
            b.x * game.TS + anc.flag.x,
            b.y * game.TS + anc.flag.y,
            b.type === 'warehouse' ? '#e8a030' : '#d84a3a',
            now,
            b.id,
          );
        else if (b.type === 'guard')
          drawFlag(g, b.x * game.TS + anc.flag.x, b.y * game.TS + anc.flag.y, '#8f8f8f', now, b.id);
        if (anc.chim && active)
          for (let ci = 0; ci < anc.chim.length; ci++)
            drawSmoke(
              g,
              b.x * game.TS + anc.chim[ci].x,
              b.y * game.TS + anc.chim[ci].y,
              now,
              b.id * 7 + ci * 3,
            );
      }
      if (game.bStatus(b).bad) drawBadge(g, b.x * game.TS + game.TS - 5, b.y * game.TS + 5);
      if (active) drawWorker(g, b, now, sp.prod);
      const pulse = workPulses[b.id];
      if (pulse && NOW - pulse.t < 600 && !renderPrefs().reducedMotion) {
        const fade = 1 - (NOW - pulse.t) / 600;
        g.globalAlpha = fade;
        chip(g, b.x * game.TS + 26, b.y * game.TS + 12 - fade * 5, game.GOODS[pulse.good].c);
        g.globalAlpha = 1;
      }
      if (b.disabled) {
        g.fillStyle = '#ead9b6';
        g.fillRect(b.x * game.TS + 16, b.y * game.TS + 3, 2, 7);
        g.fillRect(b.x * game.TS + 20, b.y * game.TS + 3, 2, 7);
      }
    } finally {
      g.restore();
    }
  }
  function drawWorker(
    g: CanvasRenderingContext2D,
    b: Building,
    now: number,
    work: BuildingSpec['prod'] | 'build',
  ) {
    if (z < 0.7) return;
    const anim = renderPrefs().reducedMotion ? 0 : Math.sin(now / 420 + b.id * 1.7);
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
    g.fillStyle = 'rgba(32,28,20,0.20)';
    g.beginPath();
    g.ellipse(x, y, 4, 1.2, 0, 0, 7);
    g.fill();
    g.strokeStyle = '#514130';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x - 1, y - 3);
    g.lineTo(x - 1.5, y);
    g.moveTo(x + 1, y - 3);
    g.lineTo(x + 1.5, y);
    g.stroke();
    g.fillStyle =
      work === 'rock' || work === 'mine'
        ? '#907b68'
        : work === 'plant'
          ? '#6f8b61'
          : work === 'build'
            ? '#b89a60'
            : '#6a91a0';
    game.rr(g, x - 2.2, y - 7, 4.4, 4.8, 1);
    g.fill();
    g.fillStyle = '#e1bf94';
    g.beginPath();
    g.arc(x, y - 8.6, 1.7, 0, 7);
    g.fill();
    g.fillStyle = '#c9ad72';
    g.beginPath();
    g.ellipse(x, y - 9.7, 2.4, 0.7, 0, 0, 7);
    g.fill();
    const hammer = work === 'gather' || work === 'rock' || work === 'build' || work === 'craft';
    const arm = hammer ? anim * 2.2 : anim * 0.8;
    g.strokeStyle = '#d6b38e';
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(x + 1.7, y - 6.1);
    g.lineTo(x + 4, y - 5 + arm);
    g.stroke();
    if (work === 'gather' || work === 'rock' || work === 'build' || work === 'craft') {
      g.strokeStyle = '#7b5d3b';
      g.lineWidth = 1.0;
      g.beginPath();
      g.moveTo(x + 3.5, y - 4 + arm);
      g.lineTo(x + 5.5, y - 8 + arm);
      g.stroke();
      g.fillStyle = work === 'gather' ? '#c3cbd0' : '#919da1';
      g.fillRect(x + 4.7, y - 9 + arm, 3, 1.8);
    } else if (work === 'fish') {
      g.strokeStyle = '#785c39';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(x + 2, y - 5);
      g.lineTo(x + 8, y - 11 + anim * 0.5);
      g.stroke();
    } else if (work === 'plant' || work === 'farm') {
      g.strokeStyle = '#775c37';
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(x + 3, y - 5 + arm);
      g.lineTo(x + 5, y + 1);
      g.stroke();
    } else if (work === 'mine') {
      const cx = x - 3 + anim * 0.9;
      g.fillStyle = '#6f6a61';
      g.fillRect(cx, y - 3.2, 6, 2.8);
      g.fillStyle = game.GOODS[game.BSPEC[b.type].out].c;
      g.fillRect(cx + 0.6, y - 4.2, 4.8, 1.8);
      g.fillStyle = '#403b35';
      g.beginPath();
      g.arc(cx + 1, y, 0.8, 0, 7);
      g.arc(cx + 5, y, 0.8, 0, 7);
      g.fill();
    }
    game.drawVillageWorkEffects(g, b, work, now);
    if (work === 'fish' && !game.state.paused && !renderPrefs().reducedMotion) {
      // Cast-line rings only where there really is water beside this fishery.
      for (let side = 0; side < 4; side++) {
        const wx = b.x + game.DX[side],
          wy = b.y + game.DY[side];
        if (!game.inB(wx, wy) || game.tiles[game.idx(wx, wy)].t !== game.WATER) continue;
        const wave = (now / 1800 + b.id * 0.17) % 1;
        g.strokeStyle = 'rgba(240,232,191,' + (0.24 * Math.sin(wave * Math.PI)).toFixed(3) + ')';
        g.lineWidth = 0.55;
        g.beginPath();
        g.ellipse(
          (wx + 0.5) * game.TS,
          (wy + 0.5) * game.TS,
          1 + wave * 6,
          0.5 + wave * 2.2,
          0,
          0,
          7,
        );
        g.stroke();
        break;
      }
    }
  }
  function drawTree(g: CanvasRenderingContext2D, x: number, y: number, tl: Tile, now: number) {
    const h = tileHash(game.idx(x, y)),
      v = h % 3,
      sw = renderPrefs().reducedMotion ? 0 : ((now / 2400 + h * 0.61) | 0) % 2;
    const spr = game.ART.tree[tl.tree - 1][v][sw];
    const jx = ((h >> 2) % 7) - 3,
      jy = ((h >> 5) % 5) - 2;
    const scale = 0.87 + ((h >> 3) % 15) / 100,
      tw = 38 * scale,
      th = 46 * scale;
    g.save();
    if (renderPrefs().clarity) g.globalAlpha *= 0.62;
    // The canopy cast shadow lives in the ground pass; this smaller cached
    // patch stays attached to the root when sunlight and weather change.
    g.drawImage(
      game.ART.shadowSoft,
      x * game.TS + 10.5 + jx - 9 * scale,
      y * game.TS + 25.5 + jy,
      20 * scale,
      7 * scale,
    );
    g.drawImage(spr, x * game.TS + 10.5 + jx - tw / 2, y * game.TS + 28.5 + jy - th, tw, th);
    g.restore();
  }
  function drawRock(g: CanvasRenderingContext2D, x: number, y: number) {
    const h = tileHash(game.idx(x, y));
    if (z < 0.75) {
      // LOD: scattered pebbles at far zoom
      const rx2 = ((h >> 2) % 13) - 6,
        ry2 = ((h >> 5) % 11) - 5;
      g.fillStyle = 'rgba(148,143,128,0.9)';
      g.beginPath();
      g.ellipse(x * game.TS + 11 + rx2, y * game.TS + 14 + ry2, 2.6 + (h % 3) * 0.5, 1.8, 0, 0, 7);
      g.fill();
      g.fillStyle = 'rgba(62,58,50,0.3)';
      g.beginPath();
      g.ellipse(x * game.TS + 12 + rx2, y * game.TS + 15 + ry2, 2, 0.9, 0, 0, 7);
      g.fill();
      return;
    }
    g.globalAlpha = 0.96;
    g.drawImage(
      game.ART.rock[h % 2],
      x * game.TS - 1 + ((h >> 4) % 5) - 2,
      y * game.TS + 6.4 + ((h >> 6) % 5) - 2,
      24,
      18,
    );
    g.globalAlpha = 1;
  }
  let unitPoses: Record<string, UnitPose> = {};
  function unitDirection(dx: number, dy: number): string {
    const octant = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
    return ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'][octant];
  }
  function drawUnit(g: CanvasRenderingContext2D, u: Unit, now: number) {
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
    const fx = Number.isFinite(u.faceDX) ? u.faceDX : dx,
      fy = Number.isFinite(u.faceDY) ? u.faceDY : dy;
    if (Math.abs(fx) + Math.abs(fy) > 0.001) pose.dir = unitDirection(fx, fy);
    g.drawImage(game.ART.shadowSoft, px - 9, py - 2, 18, 9);
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
    const dirset = game.ART.unitDirections[u.kind][pose.dir],
      fr = Math.floor(distance * 4) % dirset.walk.length;
    const spr = moving && !renderPrefs().reducedMotion ? dirset.walk[fr] : dirset.idle;
    g.save();
    g.translate(
      px,
      py +
        (moving && !renderPrefs().reducedMotion
          ? Math.abs(Math.sin(distance * Math.PI)) * 0.25
          : 0) -
        1,
    );
    g.drawImage(spr, -7.5, -18, 15, 19);
    if (u.carry && game.ART.cargo && game.ART.cargo[u.carry]) {
      const rightFacing = pose.dir === 'e' || pose.dir === 'ne' || pose.dir === 'se';
      let cargoX = rightFacing ? 0.4 : -9.2;
      if (pose.dir === 'n' || pose.dir === 's') cargoX = -5;
      g.drawImage(game.ART.cargo[u.carry], cargoX, -14, 10, 7.5);
    } else if (u.carry) {
      const c = game.GOODS[u.carry].c;
      g.fillStyle = 'rgba(0,0,0,0.28)';
      game.rr(g, -7.4, -15.4, 7.6, 5, 1);
      g.fill();
      g.fillStyle = c;
      game.rr(g, -7.8, -16, 7.4, 4.8, 1);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.32)';
      g.fillRect(-7, -15.5, 6.4, 1);
      if (u.carry === 'gold') {
        g.fillStyle = '#fff6c8';
        g.fillRect(-4.4, -15.2, 1.4, 1);
      }
    }
    g.restore();
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
  function drawObjects(g: CanvasRenderingContext2D, now: number) {
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
    // One capture for the whole sorted pass: per-object captures would reinstall
    // the context interception per object. beginPath isolates path state between
    // painters, matching the per-capture reset they previously relied on.
    presentation.layer('objects', g, function () {
      for (let i = 0; i < objPool.length; i++) {
        const q = objPool[i];
        g.beginPath();
        if (q.t === 0) drawBuilding(g, q.o as Building);
        else if (q.t === 1) drawTree(g, q.x, q.y, q.tl, now);
        else if (q.t === 2) drawRock(g, q.x, q.y);
        else drawUnit(g, q.o as Unit, now);
      }
    });
  }

  function atmosphereHash(x: number, y: number, salt: number): number {
    let value = Math.imul(x + salt * 173, 374761393) ^ Math.imul(y + (game.seed || 0), 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return (value ^ (value >>> 16)) >>> 0;
  }
  let atmosphereCount = 0;
  function meadowParticles(g: CanvasRenderingContext2D, now: number) {
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
    const cell = game.TS * 7;
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
          g.fillStyle = 'rgba(255,236,171,' + (0.55 * Math.sin(Math.PI * phase)).toFixed(3) + ')';
          g.beginPath();
          g.arc(px, py, mote ? 0.7 : 0.95, 0, 7);
          g.fill();
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
        const wing = 0.5 + Math.abs(Math.sin(time * 8 + hash)) * 1.6;
        g.fillStyle = hash % 3 ? '#f4cf76' : '#e1dfc2';
        g.beginPath();
        g.ellipse(flutterX - wing * 0.6, flutterY, wing, 1.35, -0.4, 0, 7);
        g.ellipse(flutterX + wing * 0.6, flutterY, wing, 1.35, 0.4, 0, 7);
        g.fill();
        g.fillStyle = '#715c3e';
        g.fillRect(flutterX - 0.25, flutterY - 1, 0.5, 2);
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
  function fxDraw(g: CanvasRenderingContext2D, now: number) {
    if (renderPrefs().clarity || renderPrefs().reducedMotion) {
      FXL.length = 0;
      return;
    }
    for (let i = FXL.length - 1; i >= 0; i--) {
      const f = FXL[i],
        age = now - f.t;
      let p, life, cxp, cyp;
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
      // Retire offscreen effects on schedule without submitting their paint calls.
      if (
        f.x * game.TS < cam.x - 60 ||
        f.x * game.TS > cam.x + vw / z + 60 ||
        f.y * game.TS < cam.y - 60 ||
        f.y * game.TS > cam.y + vh / z + 60
      )
        continue;
      if (f.k === 'stepDust') {
        p = age / duration;
        g.fillStyle = 'rgba(224,205,151,' + (0.16 * Math.sin(Math.PI * p)).toFixed(3) + ')';
        for (let puff = 0; puff < 2; puff++) {
          g.beginPath();
          g.ellipse(
            f.x * game.TS + puff * 2.4 + p * 2.5,
            f.y * game.TS + 2 - p * 1.5,
            0.7 + p * 2.2,
            0.5 + p,
            0,
            0,
            7,
          );
          g.fill();
        }
      } else if (f.k === 'ring') {
        life = 650;
        if (age > life) {
          FXL.splice(i, 1);
          continue;
        }
        p = age / life;
        g.strokeStyle = game.rgba(f.c, 0.55 * (1 - p));
        g.lineWidth = 2.4 - 1.8 * p;
        g.beginPath();
        g.arc(f.x * game.TS, f.y * game.TS + 3, 4 + p * (f.r || 20), 0, 7);
        g.stroke();
      } else if (f.k === 'coin') {
        life = 850;
        if (age > life) {
          FXL.splice(i, 1);
          continue;
        }
        p = age / life;
        cxp = f.x * game.TS + 2 + (f.i - 2.5) * 7 * p * 0.9;
        cyp = f.y * game.TS - 4 - 30 * Math.sin(Math.PI * Math.min(1, p * 1.05)) * 0.9 + 14 * p * p;
        const r2 = 2.1 * (1 - p * 0.25);
        g.globalAlpha = Math.max(0, 1 - p * p);
        g.fillStyle = '#c98a1e';
        g.beginPath();
        g.arc(cxp + 0.7, cyp + 0.7, r2, 0, 7);
        g.fill();
        g.fillStyle = '#ffd23f';
        g.beginPath();
        g.arc(cxp, cyp, r2, 0, 7);
        g.fill();
        g.fillStyle = '#fff2b0';
        g.fillRect(cxp - r2 * 0.4, cyp - r2 * 0.55, r2 * 0.8, 0.8);
        g.globalAlpha = 1;
      } else if (f.k === 'spark') {
        life = 520;
        if (age > life) {
          FXL.splice(i, 1);
          continue;
        }
        p = age / life;
        g.strokeStyle = game.rgba(f.c, (1 - p) * 0.9);
        g.lineWidth = 1.2;
        for (let k = 0; k < (f.n || 6); k++) {
          const a2 = k * 2.39996 + f.i,
            sp2 = 14 + ((k * 53) % 9);
          cxp = f.x * game.TS + Math.cos(a2) * sp2 * p;
          cyp = f.y * game.TS + 3 + Math.sin(a2) * sp2 * p + p * 10;
          g.beginPath();
          g.moveTo(cxp, cyp);
          g.lineTo(cxp + Math.cos(a2) * 3, cyp + Math.sin(a2) * 3);
          g.stroke();
        }
      } else if (f.k === 'dust') {
        life = 620;
        if (age > life) {
          FXL.splice(i, 1);
          continue;
        }
        p = age / life;
        for (let k = 0; k < 6; k++) {
          const a3 = k * 1.047 + rnd0(f.i);
          g.fillStyle = 'rgba(184,162,118,' + ((1 - p) * 0.22).toFixed(3) + ')';
          g.beginPath();
          g.arc(
            f.x * game.TS + Math.cos(a3) * (3 + p * 11),
            f.y * game.TS + 12 + Math.sin(a3) * (1.5 + p * 4),
            1.6 + p * 3,
            0,
            7,
          );
          g.fill();
        }
      } else {
        life = 700;
        if (age > life) {
          FXL.splice(i, 1);
          continue;
        }
        p = age / life;
        g.strokeStyle = 'rgba(255,80,70,' + (0.5 * (1 - p)).toFixed(3) + ')';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(f.x * game.TS + game.TS / 2, f.y * game.TS + game.TS / 2, 3 + p * 16, 0, 7);
        g.stroke();
      }
    }
  }
  function rnd0(i: number): number {
    return (((i * 2654435761) >>> 0) % 628) / 100;
  }

  // ---------- animated overlays ----------
  function waterAnim(g: CanvasRenderingContext2D, now: number) {
    // The full painted material is cached at both quality levels. Only a sparse
    // veil of curved reflections breathes; no texture swapping or raster uploads.
    if (renderPrefs().reducedMotion || renderPrefs().quality < 1) return;
    const vx0 = Math.max(0, Math.floor(cam.x / game.TS)),
      vx1 = Math.min(game.W - 1, Math.ceil((cam.x + vw / z) / game.TS)),
      vy0 = Math.max(0, Math.floor(cam.y / game.TS)),
      vy1 = Math.min(game.H - 1, Math.ceil((cam.y + vh / z) / game.TS));
    g.save();
    g.lineCap = 'round';
    g.lineWidth = 0.65;
    for (let y = vy0; y <= vy1; y++)
      for (let x = vx0; x <= vx1; x++) {
        const i = game.idx(x, y),
          h = tileHash(i);
        if (game.tiles[i].t !== game.WATER || h % 3 !== 0) continue;
        const px = x * game.TS + 6,
          py = y * game.TS + 8 + (h % 8);
        const phase = now / 2600 + h * 0.17;
        g.strokeStyle = 'rgba(222,226,184,' + (0.075 + 0.055 * Math.sin(phase)).toFixed(3) + ')';
        g.beginPath();
        g.moveTo(px, py);
        g.quadraticCurveTo(px + 4, py - 0.7, px + 9 + (h % 4), py - 0.2);
        g.stroke();
      }
    g.restore();
  }
  function highlights(g: CanvasRenderingContext2D, now: number) {
    now = motionTime(now);
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
        g.fillStyle = 'rgba(255,214,64,' + (0.06 + 0.1 * pu).toFixed(3) + ')';
        diaPath(g, hx2 + 12, hy2 + 12, 12.2);
        g.fill();
        g.strokeStyle = 'rgba(255,223,110,' + (0.55 + 0.4 * pu).toFixed(3) + ')';
        g.lineWidth = 2;
        diaPath(g, hx2 + 12, hy2 + 12, 11.4);
        g.stroke();
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
        g.fillStyle = 'rgba(130,255,140,' + (0.14 + 0.16 * pu2).toFixed(3) + ')';
        diaPath(g, sx4 + 12, sy4 + 12, 5.4);
        g.fill();
        g.fillStyle = 'rgba(190,255,190,' + (0.5 + 0.4 * pu2).toFixed(3) + ')';
        g.beginPath();
        g.arc(sx4 + 12, sy4 + 12, 1.5, 0, 7);
        g.fill();
      }
    }
  }
  function demoMarkers(g: CanvasRenderingContext2D) {
    if (!game.mode || game.mode.type !== 'demolish') return;
    for (let di4 = 0; di4 < game.buildings.length; di4++) {
      const b5 = game.buildings[di4];
      if (b5.type === 'hq') continue;
      const bx = b5.x * game.TS,
        by = b5.y * game.TS,
        armed = game.demoArm === b5;
      const pu = renderPrefs().reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(NOW / 420);
      g.strokeStyle = armed ? '#ffd23f' : 'rgba(255,84,72,' + (0.75 + 0.25 * pu).toFixed(2) + ')';
      g.lineWidth = armed ? 3 : 2;
      game.rr(g, bx - 0.5, by - 0.5, game.TS + 1, game.TS + 1, 3);
      g.stroke();
      g.beginPath();
      g.moveTo(bx + 7, by + 7);
      g.lineTo(bx + game.TS - 7, by + game.TS - 7);
      g.moveTo(bx + game.TS - 7, by + 7);
      g.lineTo(bx + 7, by + game.TS - 7);
      g.stroke();
    }
  }
  function selection(g: CanvasRenderingContext2D, now: number) {
    if (!game.selected) return;
    const b = game.selected,
      sp = game.BSPEC[b.type],
      rr2 = (sp.rad || 3) * game.TS,
      ccx = b.x * game.TS + game.TS / 2,
      ccy = b.y * game.TS + game.TS / 2;
    g.fillStyle = 'rgba(255,214,80,0.05)';
    g.beginPath();
    g.arc(ccx, ccy, rr2, 0, 7);
    g.fill();
    g.strokeStyle = 'rgba(255,210,63,0.55)';
    g.lineWidth = 1.2;
    g.setLineDash([5, 4]);
    g.lineDashOffset = -motionTime(now) / 60;
    g.beginPath();
    g.arc(ccx, ccy, rr2, 0, 7);
    g.stroke();
    g.setLineDash([]);
    g.save();
    g.shadowColor = 'rgba(255,210,63,0.8)';
    g.shadowBlur = 7;
    g.strokeStyle = '#ffd23f';
    g.lineWidth = 2;
    game.rr(g, b.x * game.TS - 2, b.y * game.TS - 2, game.TS + 4, game.TS + 4, 4);
    g.stroke();
    g.restore();
  }
  function anchorDraw(g: CanvasRenderingContext2D, now: number) {
    if (!game.anchor) return;
    const pu = renderPrefs().reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 420);
    g.fillStyle = 'rgba(143,214,208,' + (0.1 + 0.1 * pu).toFixed(3) + ')';
    g.fillRect(game.anchor.x * game.TS, game.anchor.y * game.TS, game.TS, game.TS);
    g.strokeStyle = '#8fd6d0';
    g.lineWidth = 2;
    const a = game.anchor.x * game.TS,
      b2 = game.anchor.y * game.TS,
      L = 8;
    g.beginPath();
    g.moveTo(a, b2 + L);
    g.lineTo(a, b2);
    g.lineTo(a + L, b2);
    g.moveTo(a + game.TS - L, b2);
    g.lineTo(a + game.TS, b2);
    g.lineTo(a + game.TS, b2 + L);
    g.moveTo(a + game.TS, b2 + game.TS - L);
    g.lineTo(a + game.TS, b2 + game.TS);
    g.lineTo(a + game.TS - L, b2 + game.TS);
    g.moveTo(a + L, b2 + game.TS);
    g.lineTo(a, b2 + game.TS);
    g.lineTo(a, b2 + game.TS - L);
    g.stroke();
  }
  function ghostDraw(g: CanvasRenderingContext2D) {
    if (!game.ghost || !game.ghost.in || !game.mode || game.mode.type !== 'build') return;
    const gx = game.ghost.x,
      gy = game.ghost.y,
      ok = game.ghost.ok;
    g.fillStyle = ok ? 'rgba(110,224,110,0.20)' : 'rgba(255,80,80,0.20)';
    g.beginPath();
    g.ellipse(gx * game.TS + 12, gy * game.TS + 16, 13, 5, 0, 0, 7);
    g.fill();
    g.globalAlpha = 0.66;
    drawSprite(g, game.mode.bt, gx * game.TS + 12, gy * game.TS + 12);
    g.globalAlpha = 1;
    g.strokeStyle = ok ? '#6ee06e' : '#ff5050';
    g.lineWidth = 2;
    game.rr(g, gx * game.TS - 1, gy * game.TS - 1, game.TS + 2, game.TS + 2, 3.5);
    g.stroke();
    const sp2 = game.BSPEC[game.mode.bt];
    if (ok && sp2.rad && sp2.rad >= 4) {
      const grx = gx * game.TS + 12,
        gry = gy * game.TS + 12,
        gr = sp2.rad * game.TS;
      g.strokeStyle = 'rgba(110,224,110,0.35)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(grx, gry, gr, 0, 7);
      g.stroke();
    }
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
        (b.man ? 1 : 0) +
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
        else if (sp.resKind) hit = tl.res && tl.res.kind === sp.resKind && tl.res.amt > 0;
        else if (sp.prod === 'plant')
          hit =
            tl.t === game.GRASS &&
            !tl.tree &&
            !tl.rock &&
            !tl.road &&
            game.owned[i] &&
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
          (store.res[good] || 0);
    for (const job of game.jobs)
      if (job.kind === 'transfer' && goods.includes(job.good))
        key += ':' + job.s + ',' + job.to + ',' + job.good + ',' + job.state;
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
      res = resourceTilesAt(game.mode.bt, game.ghost.x, game.ghost.y),
      storage = game.nearestStoragePos(game.ghost.x, game.ghost.y);
    const path =
      storage && game.passI(game.idx(game.ghost.x, game.ghost.y))
        ? game.findPath(storage.x, storage.y, game.ghost.x, game.ghost.y)
        : null;
    const haul = path ? pathSeconds(path, storage.x, storage.y) : null;
    let supply = '';
    if (sp.prod === 'gather') supply = res.length + ' mature trees';
    else if (sp.prod === 'rock') supply = res.length + ' rock tiles';
    else if (sp.resKind) {
      let amount = 0;
      for (let i = 0; i < res.length; i++) amount += game.tiles[res[i]].res.amt;
      supply = amount + ' ' + game.GOODS[sp.resKind].name.toLowerCase() + ' in reach';
    } else if (sp.prod === 'fish') supply = res.length ? 'Shore in reach' : 'No shore in reach';
    else if (sp.prod === 'plant') supply = res.length + ' clear nursery tiles';
    const summary =
      (supply ? supply + ' · ' : '') +
      (haul === null
        ? 'No storage route'
        : 'Estimated one-way walk: ~' +
          haul.toFixed(1) +
          's to ' +
          game.BSPEC[storage.type].name.toLowerCase());
    return (_placementCache = {
      key: key,
      x: game.ghost.x,
      y: game.ghost.y,
      resources: res,
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
  function worldLabel(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    label: string,
    color: string,
  ) {
    g.save();
    g.font = '600 11px system-ui,sans-serif';
    while (label.length > 8 && g.measureText(label).width > vw - 32)
      label = label.slice(0, -4) + '…';
    const width = g.measureText(label).width + 14;
    const screenX = (x - cam.x) * z,
      screenY = (y - cam.y) * z;
    x = cam.x + Math.max(width / 2 + 8, Math.min(vw - width / 2 - 8, screenX)) / z;
    y = cam.y + Math.max(28, Math.min(vh - 12, screenY)) / z;
    g.translate(x, y);
    g.scale(1 / z, 1 / z);
    g.fillStyle = 'rgba(16,27,25,0.90)';
    game.rr(g, -width / 2, -18, width, 21, 5);
    g.fill();
    g.strokeStyle = game.rgba(color || '#dbc79b', 0.66);
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = color || '#f4ead6';
    g.textAlign = 'center';
    g.fillText(label, 0, -4);
    g.restore();
  }
  function traceRoute(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    path: number[],
    start: number,
    color: string,
    dashed: boolean,
  ) {
    if (!path || !path.length) return;
    g.strokeStyle = 'rgba(17,31,29,0.72)';
    g.lineWidth = 4 / z;
    g.setLineDash(dashed ? [6 / z, 4 / z] : []);
    function line() {
      g.beginPath();
      g.moveTo(x * game.TS, y * game.TS);
      for (let p = start || 0; p < path.length; p++) {
        const n = path[p];
        g.lineTo(((n % game.W) + 0.5) * game.TS, (((n / game.W) | 0) + 0.5) * game.TS);
      }
      g.stroke();
    }
    line();
    g.strokeStyle = color;
    g.lineWidth = 1.7 / z;
    line();
    g.setLineDash([]);
  }
  function reachDraw(
    g: CanvasRenderingContext2D,
    type: BuildingType,
    x: number,
    y: number,
    resources: number[],
  ) {
    const sp = game.BSPEC[type],
      area = resourceWorkArea(type, x, y),
      r = area.r * game.TS;
    x = area.x;
    y = area.y;
    g.fillStyle = 'rgba(137,207,177,0.04)';
    g.strokeStyle = 'rgba(179,230,197,0.72)';
    g.lineWidth = 1 / z;
    if (sp.resKind || sp.prod === 'fish') {
      game.rr(
        g,
        (x - area.r) * game.TS,
        (y - area.r) * game.TS,
        (area.r * 2 + 1) * game.TS,
        (area.r * 2 + 1) * game.TS,
        3,
      );
      g.fill();
      g.stroke();
    } else {
      g.beginPath();
      g.arc((x + 0.5) * game.TS, (y + 0.5) * game.TS, r, 0, 7);
      g.fill();
      g.stroke();
    }
    for (let i = 0; i < resources.length; i++) {
      const n = resources[i],
        px = (n % game.W) * game.TS,
        py = ((n / game.W) | 0) * game.TS;
      g.fillStyle = 'rgba(188,225,153,0.15)';
      g.fillRect(px + 1, py + 1, game.TS - 2, game.TS - 2);
      g.strokeStyle = '#c5dfaa';
      g.lineWidth = 1.3 / z;
      game.rr(g, px + 3, py + 3, game.TS - 6, game.TS - 6, 3);
      g.stroke();
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
  function clarityRoads(g: CanvasRenderingContext2D) {
    if (!renderPrefs().clarity) return;
    const x0 = Math.max(0, Math.floor(cam.x / game.TS)),
      x1 = Math.min(game.W - 1, Math.ceil((cam.x + vw / z) / game.TS)),
      y0 = Math.max(0, Math.floor(cam.y / game.TS)),
      y1 = Math.min(game.H - 1, Math.ceil((cam.y + vh / z) / game.TS));
    g.save();
    g.lineCap = 'round';
    g.beginPath();
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!game.tiles[game.idx(x, y)].road) continue;
        const cx = (x + 0.5) * game.TS,
          cy = (y + 0.5) * game.TS;
        // Include isolated road tiles and exactly the same orthogonal joins as
        // the painted roads. No connectivity or movement rules change.
        g.moveTo(cx - 0.5, cy);
        g.lineTo(cx + 0.5, cy);
        for (let d = 0; d < 4; d++) {
          const nx = x + game.DX[d],
            ny = y + game.DY[d];
          if (!game.inB(nx, ny) || (!game.tiles[game.idx(nx, ny)].road && !game.buildingAt(nx, ny)))
            continue;
          g.moveTo(cx, cy);
          g.lineTo(cx + (game.DX[d] * game.TS) / 2, cy + (game.DY[d] * game.TS) / 2);
        }
      }
    // Lift the earth surface in clarity mode without drawing a lane marking.
    g.strokeStyle = 'rgba(229,204,151,0.16)';
    g.lineWidth = 5;
    g.stroke();
    g.restore();
  }
  function clarityBuildings(g: CanvasRenderingContext2D) {
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
        y = b.y * game.TS;
      g.save();
      // A U-shaped threshold marks the existing south-facing entrance.
      g.beginPath();
      g.moveTo(x - 3, y + 22);
      g.lineTo(x - 3, y + 27);
      g.lineTo(x + 3, y + 27);
      g.lineTo(x + 3, y + 22);
      g.strokeStyle = '#25392c';
      g.lineWidth = 4 / z;
      g.stroke();
      g.strokeStyle = '#fff0b7';
      g.lineWidth = 1.8 / z;
      g.stroke();
      g.translate(x, y + 37);
      g.scale(1 / z, 1 / z);
      g.font = '700 8px system-ui,sans-serif';
      const width = g.measureText(tag).width + 8;
      g.fillStyle = 'rgba(20,36,28,0.94)';
      game.rr(g, -width / 2, -7, width, 13, 3);
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 0.8;
      g.stroke();
      g.fillStyle = color;
      g.textAlign = 'center';
      g.fillText(tag, 0, 2);
      g.restore();
      if (game.selected === b || (game.hoverIn && game.ht.x === b.x && game.ht.y === b.y)) {
        const status = !b.done
          ? 'Under construction'
          : _reasonNames[reason] ||
            (warning ? game.bStatus(b).lines.find((line) => line.w)?.t : '') ||
            (game.buildingWorking(b)
              ? 'Working'
              : sp.guard
                ? b.man
                  ? 'Manned'
                  : 'Awaiting soldier'
                : sp.store
                  ? 'Storage'
                  : 'Idle');
        worldLabel(g, x, y - 35, sp.name + ' · ' + status, color);
      }
    }
  }
  function workloadBadge(
    g: CanvasRenderingContext2D,
    b: Building,
    waiting: number,
    assigned: number,
    max: number,
  ) {
    const width = 72;
    const screenX = ((b.x + 0.5) * game.TS - cam.x) * z;
    const screenY = (b.y * game.TS - 18 - cam.y) * z;
    g.save();
    g.translate(
      cam.x + Math.max(width / 2 + 8, Math.min(vw - width / 2 - 8, screenX)) / z,
      cam.y + Math.max(40, Math.min(vh - 8, screenY)) / z,
    );
    g.scale(1 / z, 1 / z);
    g.fillStyle = 'rgba(16,27,25,0.94)';
    game.rr(g, -36, -32, 72, 34, 5);
    g.fill();
    g.strokeStyle = waiting ? '#b78b58' : '#638f80';
    g.lineWidth = 1;
    g.stroke();
    g.font = '700 9px system-ui,sans-serif';
    for (const [row, count, label, color] of [
      [0, waiting, 'W', '#e3b475'],
      [1, assigned, 'A', '#9bcbba'],
    ] as const) {
      const y = -25 + row * 14;
      g.textAlign = 'left';
      g.fillStyle = color;
      g.fillText(label, -30, y + 6);
      g.fillStyle = '#25372f';
      g.fillRect(-17, y, 31, 6);
      g.fillStyle = color;
      if (count) g.fillRect(-17, y, (31 * count) / max, 6);
      g.textAlign = 'right';
      g.fillText(String(count), 31, y + 6);
    }
    g.restore();
  }
  function logisticsDraw(g: CanvasRenderingContext2D) {
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
            g,
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
        if (job.state === 'p') waitingJobs++;
        for (const id of new Set([job.to, job.from, job.s])) {
          if (id === undefined) continue;
          const count = counts.get(id) || { waiting: 0, assigned: 0 };
          if (job.state === 'p') count.waiting++;
          else count.assigned++;
          counts.set(id, count);
        }
      }
      // One scale for the whole colony keeps equal-length bars comparable.
      const max = Math.max(1, ...[...counts.values()].flatMap((c) => [c.waiting, c.assigned]));
      for (const b of game.buildings) {
        const count = counts.get(b.id);
        if (!count || !visibleAt(b.x, b.y)) continue;
        workloadBadge(g, b, count.waiting, count.assigned, max);
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
        reachDraw(g, rb.type, rb.x, rb.y, resourceTilesAt(rb.type, rb.x, rb.y));
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
        g.strokeStyle = color;
        g.lineWidth = 2 / z;
        game.rr(g, sb.x * game.TS - 2, sb.y * game.TS - 2, game.TS + 4, game.TS + 4, 3);
        g.stroke();
        worldLabel(
          g,
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
          g,
          (game.mode as { type: 'build'; bt: BuildingType }).bt,
          placement.x,
          placement.y,
          placement.resources,
        );
      if (placement.path)
        traceRoute(
          g,
          placement.storage.x + 0.5,
          placement.storage.y + 0.5,
          placement.path,
          0,
          '#c1e4ce',
          true,
        );
      worldLabel(
        g,
        (placement.x + 0.5) * game.TS,
        (placement.y + 2.1) * game.TS,
        (placement.canBuild
          ? 'Ready to build · '
          : !placement.checks.ok
            ? placement.checks.reason + ' · '
            : 'Not enough reachable stock · ') + placement.summary,
        placement.canBuild ? '#d3efd0' : '#ffd0b4',
      );
    }
    const road = getRoadPreview();
    if (road) {
      if (road.path)
        traceRoute(g, game.anchor.x + 0.5, game.anchor.y + 0.5, road.path, 0, '#e6d49d', true);
      worldLabel(
        g,
        (ht.x + 0.5) * game.TS,
        (ht.y + 1.9) * game.TS,
        road.summary,
        road.path ? '#f0dfad' : '#ffd0b4',
      );
    }
  }
  function logisticsCaption(g: CanvasRenderingContext2D) {
    if (!_logisticsCaption) return;
    if (workloadSummary) {
      const { busy, carriers, waiting } = workloadSummary;
      const width = Math.min(vw - 24, 340),
        x = (vw - width) / 2;
      g.save();
      g.translate(0, BAR_H);
      if (vw < 700) {
        const advisor = document.getElementById('adv');
        g.translate(0, (advisor?.offsetHeight || 54) + 12);
      }
      g.fillStyle = 'rgba(18,31,28,0.96)';
      game.rr(g, x, 12, width, 94, 8);
      g.fill();
      g.strokeStyle = 'rgba(210,219,181,0.45)';
      g.lineWidth = 1;
      g.stroke();
      g.font = '700 12px system-ui,sans-serif';
      g.textAlign = 'left';
      g.fillStyle = '#efe8cf';
      g.fillText('Carrier workload', x + 12, 32);
      g.textAlign = 'right';
      g.fillStyle = '#e3b475';
      g.fillText(waiting + ' waiting', x + width - 12, 32);
      g.fillStyle = '#30443b';
      g.fillRect(x + 12, 42, width - 24, 8);
      g.fillStyle = '#9bcbba';
      if (carriers && busy) g.fillRect(x + 12, 42, ((width - 24) * busy) / carriers, 8);
      g.font = '600 11px system-ui,sans-serif';
      g.textAlign = 'left';
      g.fillText(busy + '/' + carriers + ' carriers busy', x + 12, 65);
      g.textAlign = 'right';
      g.fillStyle = '#c8d2c3';
      g.fillText(
        carriers ? Math.round((busy / carriers) * 100) + '%' : 'No carriers',
        x + width - 12,
        65,
      );
      g.font = '600 10px system-ui,sans-serif';
      g.textAlign = 'left';
      g.fillStyle = '#e3b475';
      g.fillText('W  Waiting jobs', x + 12, 88);
      g.fillStyle = '#9bcbba';
      g.fillText('A  Assigned jobs', x + width / 2, 88);
      g.restore();
      return;
    }
    g.save();
    g.translate(0, BAR_H);
    g.font = '600 12px system-ui,sans-serif';
    const maxWidth = Math.min(vw - 24, 580);
    let label = _logisticsCaption;
    while (label.length > 8 && g.measureText(label).width > maxWidth - 22)
      label = label.slice(0, -4) + '…';
    const width = g.measureText(label).width + 22,
      x = Math.max(12, (vw - width) / 2);
    g.fillStyle = 'rgba(18,31,28,0.92)';
    game.rr(g, x, 12, width, 28, 7);
    g.fill();
    g.strokeStyle = 'rgba(210,219,181,0.45)';
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = '#efe8cf';
    g.fillText(label, x + 11, 31);
    g.restore();
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
  function cloudsDraw(g: CanvasRenderingContext2D, now: number) {
    if (!renderPrefs().weather || renderPrefs().reducedMotion || renderPrefs().quality < 1) return;
    g.save();
    g.beginPath();
    g.rect(0, 0, game.W * game.TS, game.H * game.TS);
    g.clip();
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const px = ((c.x0 + now * 0.001 * c.v) % (game.W * game.TS + c.w)) - c.w;
      const py = c.y0 + Math.sin(now / 9000 + i) * 30;
      g.globalAlpha = 0.8;
      g.drawImage(game.ART.cloud, px, py, c.w * c.s, c.w * 0.62 * c.s);
    }
    g.globalAlpha = 1;
    g.restore();
  }
  function birdsDraw(g: CanvasRenderingContext2D, now: number) {
    if (renderPrefs().reducedMotion || renderPrefs().quality < 1) return;
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      const x = ((b.x + now * 0.001 * b.vx) % (game.W * game.TS + 800)) - 400;
      const y = b.y + Math.sin(now / 4000 + i * 2) * 40;
      const fl = Math.sin(now / 90 + b.f);
      g.strokeStyle = 'rgba(64,58,46,0.55)';
      g.lineWidth = 1.1;
      for (let k = 0; k < 4; k++) {
        const bx = x - k * 6,
          by = y + Math.abs(k) * 3.4 + (k % 2 ? 2 : 0);
        g.beginPath();
        g.moveTo(bx - 3.4, by - fl * 2.2);
        g.lineTo(bx, by + 1);
        g.lineTo(bx + 3.4, by - fl * 2.2);
        g.stroke();
      }
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
  function rainDraw(g: CanvasRenderingContext2D, now: number) {
    if (renderPrefs().reducedMotion) return;
    if (!RSEEDS) {
      RSEEDS = [];
      for (let i = 0; i < 110; i++)
        RSEEDS.push([Math.random(), Math.random(), 0.75 + Math.random() * 0.5]);
    }
    g.strokeStyle = 'rgba(190,214,232,' + (0.34 * _rain).toFixed(3) + ')';
    g.lineWidth = 1;
    const n = (RSEEDS.length * _rain) | 0;
    g.beginPath();
    for (let k = 0; k < n; k++) {
      const r = RSEEDS[k],
        fall = now * 0.001 * r[2];
      const y = (r[1] * vh + fall * 900) % vh,
        x = (r[0] * vw + y * 0.22) % vw;
      g.moveTo(x, y);
      g.lineTo(x - 2.6, y - 10);
    }
    g.stroke();
  }
  function glowsDraw(g: CanvasRenderingContext2D) {
    // warm window auras at night, above the tint
    if (!game.ART.glow) return;
    const vx0 = Math.max(0, Math.floor(cam.x / game.TS) - 1),
      vx1 = Math.min(game.W - 1, Math.ceil((cam.x + vw / z) / game.TS) + 1);
    const vy0 = Math.max(0, Math.floor(cam.y / game.TS) - 1),
      vy1 = Math.min(game.H - 1, Math.ceil((cam.y + vh / z) / game.TS) + 1);
    const light = Math.min(0.7, nightCool() * 1.25);
    g.save();
    g.globalAlpha = light;
    for (let bi = 0; bi < game.buildings.length; bi++) {
      const b = game.buildings[bi];
      if (!b.done) continue;
      if (UNLIT_AT_NIGHT.has(b.type)) continue;
      if (b.x < vx0 || b.x > vx1 || b.y < vy0 || b.y > vy1) continue;
      const sc = game.BSPEC[b.type].store ? 34 : 24,
        lx = b.x * game.TS + 12,
        ly = b.y * game.TS + 8;
      g.drawImage(game.ART.glow, lx - sc / 2, ly - sc / 2, sc, sc);
      // A broad faint pool reaches the entrance without obscuring road traffic.
      g.globalAlpha = light * 0.3;
      g.drawImage(game.ART.glow, lx - 15, b.y * game.TS + 19, 30, 9);
      g.globalAlpha = light;
    }
    g.restore();
  }

  // ---------- guard-post placement preview (the *actual* new border, not the naive radius) ----------
  function guardPreview(g: CanvasRenderingContext2D, now: number) {
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
    g.fillStyle = 'rgba(255,210,63,0.07)';
    for (let i = 0; i < game.gpFill.length; i++) {
      const fi = game.gpFill[i];
      g.fillRect((fi % game.W) * game.TS, ((fi / game.W) | 0) * game.TS, game.TS, game.TS);
    }
    const pu = 0.5 + 0.5 * Math.sin(now / 240);
    g.strokeStyle = 'rgba(255,226,130,' + (0.5 + 0.35 * pu).toFixed(3) + ')';
    g.lineWidth = 2;
    g.setLineDash([7, 5]);
    g.lineDashOffset = -now / 40;
    g.beginPath();
    for (let i = 0; i < game.gpSegs.length; i++) {
      const s2 = game.gpSegs[i];
      g.moveTo(s2[0], s2[1]);
      g.lineTo(s2[2], s2[3]);
    }
    g.stroke();
    g.setLineDash([]);
  }
  function cloudsShadowDraw(g: CanvasRenderingContext2D, now: number) {
    // drifting ground shadows under the sky blobs (sun NW -> SE offset)
    if (!renderPrefs().weather || renderPrefs().reducedMotion || renderPrefs().quality < 1) return;
    if (!game.ART.cloudShadow) return;
    g.save();
    g.beginPath();
    g.rect(0, 0, game.W * game.TS, game.H * game.TS);
    g.clip();
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const px = ((c.x0 + now * 0.001 * c.v) % (game.W * game.TS + c.w)) - c.w;
      const py = c.y0 + Math.sin(now / 9000 + i) * 30;
      g.globalAlpha = 0.9;
      g.drawImage(game.ART.cloudShadow, px + 46, py + 58, c.w * 0.78 * c.s, c.w * 0.5 * c.s);
    }
    g.globalAlpha = 1;
    g.restore();
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
        if (game.tiles[e.index] && !game.staticDirty) drawTile(sctx, e.index);
      },
      (error) => {
        const reason = error instanceof Error ? error.message : 'Terrain update failed';
        if (presentation.reportFailure) presentation.reportFailure(reason);
        else {
          presentation.available = false;
          game.emitGameEvent('rendererFailed', { reason });
          console.error('Terrain update failed', error);
        }
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
    _placementCache = null;
    _roadCache = null;
  });
  // A committed load clears every transient presentation cache through this one
  // sanctioned method; loaders never poke renderer internals field by field.
  function resetPresentation() {
    FXL.length = 0;
    _seen = {};
    _warmup = false;
    macroCan = null;
    _placementCache = null;
    _roadCache = null;
    unitPoses = {};
    workPulses = {};
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
      if (!b3.done && b3.prog > 0 && game.siteReady(b3) && visibleAt(b3.x, b3.y)) site.push(b3);
    }
    if (site.length) {
      const b4 = site[(Math.random() * site.length) | 0];
      game.SND.hammer(b4.x, b4.y);
    }
  }

  // ---------- frame ----------
  let _lastNow = 0;
  function draw() {
    if (!presentation?.available) return;
    const drawStart = performance.now(),
      frameMs = _lastNow ? drawStart - _lastNow : 0;
    NOW = performance.now();
    initRenderEvents();
    stepZoom(NOW);
    weatherTick(NOW, Math.min(0.1, (NOW - _lastNow) / 1000) || 0.016);
    _lastNow = NOW;
    if (game.staticDirty) drawStatic();
    else if (borderDirty) drawBorders();
    reconcileFx();
    presentation.begin(ctx);
    layer('backdrop', function () {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!bgGrad) {
        bgGrad = ctx.createLinearGradient(0, 0, 0, vh);
        bgGrad.addColorStop(0, '#12222e');
        bgGrad.addColorStop(1, '#0a141d');
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, vw, vh);
      ctx.setTransform(dpr * z, 0, 0, dpr * z, -cam.x * z * dpr, -cam.y * z * dpr);
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = 'rgba(4,8,12,0.5)';
      ctx.fillRect(4, 5, game.W * game.TS, game.H * game.TS);
      ctx.fillStyle = 'rgba(4,8,12,0.35)';
      ctx.fillRect(2, 2, game.W * game.TS, game.H * game.TS);
    });
    layer('terrain', function () {
      // Blit only the visible terrain rectangle instead of submitting the 48 MB atlas.
      const sx = Math.max(0, cam.x),
        sy = Math.max(0, cam.y),
        sw = Math.min(game.W * game.TS - sx, cam.x + vw / z - sx),
        sh2 = Math.min(game.H * game.TS - sy, cam.y + vh / z - sy);
      if (sw > 0 && sh2 > 0) {
        ctx.drawImage(
          scan,
          sx * game.ST,
          sy * game.ST,
          sw * game.ST,
          sh2 * game.ST,
          sx,
          sy,
          sw,
          sh2,
        );
        ctx.drawImage(bcan, sx, sy, sw, sh2, sx, sy, sw, sh2);
        if (renderPrefs().clarity) {
          // Quiet the high-frequency ground material without rebuilding terrain.
          ctx.fillStyle = 'rgba(158,175,125,0.20)';
          ctx.fillRect(sx, sy, sw, sh2);
        }
      }
    });
    layer('ground-effects', function () {
      waterAnim(ctx, NOW);
      highlights(ctx, NOW);
      guardPreview(ctx, NOW);
      demoMarkers(ctx);
      clarityRoads(ctx);
      if (!renderPrefs().clarity) cloudsShadowDraw(ctx, NOW);
    });
    drawObjects(ctx, NOW);
    layer('foreground-effects', function () {
      fxDraw(ctx, NOW);
      meadowParticles(ctx, NOW);
      clarityBuildings(ctx);
      selection(ctx, NOW);
      anchorDraw(ctx, NOW);
      ghostDraw(ctx);
      logisticsDraw(ctx);
      if (!renderPrefs().clarity) {
        cloudsDraw(ctx, NOW);
        birdsDraw(ctx, NOW);
      }
      // day/night + weather tint (screen space)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cool = renderPrefs().clarity ? 0 : nightCool(),
        warm = renderPrefs().clarity ? 0 : nightWarm();
      if (cool > 0.01) {
        ctx.fillStyle = 'rgba(20,34,66,' + (cool * 0.29).toFixed(3) + ')';
        ctx.fillRect(0, 0, vw, vh);
      }
      if (warm > 0.01) {
        ctx.fillStyle = 'rgba(255,177,98,' + (warm * 0.75).toFixed(3) + ')';
        ctx.fillRect(0, 0, vw, vh);
      }
      if (!renderPrefs().clarity && _rain > 0.01) {
        ctx.fillStyle = 'rgba(37,52,64,' + (_rain * 0.16).toFixed(3) + ')';
        ctx.fillRect(0, 0, vw, vh);
      }
      if (
        !renderPrefs().clarity &&
        !renderPrefs().reducedMotion &&
        renderPrefs().weather &&
        NOW - _flashT < 180
      ) {
        ctx.fillStyle = 'rgba(255,255,255,' + ((1 - (NOW - _flashT) / 180) * 0.26).toFixed(3) + ')';
        ctx.fillRect(0, 0, vw, vh);
      }
      if (cool > 0.04) {
        // lantern glows sit above the night tint
        ctx.setTransform(dpr * z, 0, 0, dpr * z, -cam.x * z * dpr, -cam.y * z * dpr);
        glowsDraw(ctx);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!renderPrefs().clarity && _rain > 0.02) rainDraw(ctx, NOW);
      logisticsCaption(ctx);
    });
    presentation.end(ctx);
    ambFX(NOW);
    sampleRender(frameMs, performance.now() - drawStart);
  }

  // ---------- minimap ----------
  const mscan = game.Acan(192, 192),
    msctx = mscan.getContext('2d');
  let miniDirty = true;
  let _miniRendered = 0;
  function drawMiniStatic() {
    const s = 192 / game.W;
    msctx.fillStyle = '#101418';
    msctx.fillRect(0, 0, 192, 192);
    for (let y = 0; y < game.H; y++)
      for (let x = 0; x < game.W; x++) {
        const i = game.idx(x, y),
          tl = game.tiles[i];
        let c;
        if (tl.t === game.WATER) c = '#447b89';
        else if (tl.t === game.SAND) c = '#d7c39b';
        else if (tl.t === game.MTN) c = '#aaa79a';
        else c = tl.tree ? '#4b7040' : '#6b8750';
        msctx.fillStyle = c;
        msctx.fillRect(x * s, y * s, s, s);
        if (tl.res && tl.res.amt > 0) {
          msctx.fillStyle =
            tl.res.kind === 'gold' ? '#ffd23f' : tl.res.kind === 'iron' ? '#d0763a' : '#565e68';
          msctx.fillRect(x * s, y * s, s, s);
          const fr2 = tl.res.amt / (tl.res.amt0 || tl.res.amt);
          if (fr2 < 0.999) {
            msctx.fillStyle = 'rgba(0,0,0,' + ((1 - fr2) * 0.55).toFixed(2) + ')';
            msctx.fillRect(x * s, y * s, s, s);
          }
        }
      }
    msctx.fillStyle = 'rgba(255,214,110,0.16)';
    for (let y = 0; y < game.H; y++)
      for (let x = 0; x < game.W; x++)
        if (game.owned[game.idx(x, y)]) msctx.fillRect(x * s, y * s, s, s);
    for (let y = 0; y < game.H; y++)
      for (let x = 0; x < game.W; x++)
        if (game.tiles[game.idx(x, y)].road) {
          msctx.fillStyle = '#c2a878';
          msctx.fillRect(x * s, y * s, s, s);
        }
    const vg = msctx.createRadialGradient(96, 96, 60, 96, 96, 140);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.22)');
    msctx.fillStyle = vg;
    msctx.fillRect(0, 0, 192, 192);
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
    if (!miniDirty && NOW - _miniRendered < 100) return;
    _miniRendered = NOW;
    if (miniDirty) drawMiniStatic();
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
      buildingContour,
      drawBuilding,
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
  paintTileFull: (g: CanvasRenderingContext2D, i: number) => void;
  drawStatic: () => void;
  buildingContour: (img: Sprite) => HTMLCanvasElement;
  drawBuilding: (g: CanvasRenderingContext2D, b: Building) => void;
  drawTree: (g: CanvasRenderingContext2D, x: number, y: number, tl: Tile, now: number) => void;
  drawSmoke: (g: CanvasRenderingContext2D, x: number, y: number, now: number, sd: number) => void;
  drawUnit: (g: CanvasRenderingContext2D, u: Unit, now: number) => void;
  meadowParticles: (g: CanvasRenderingContext2D, now: number) => void;
  fxDraw: (g: CanvasRenderingContext2D, now: number) => void;
  getPlacementPreview: () => PlacementPreview | null;
  getRoadPreview: () => RoadPreview | null;
  clarityBuildings: (g: CanvasRenderingContext2D) => void;
  glowsDraw: (g: CanvasRenderingContext2D) => void;
  terrainRevision: number;
  miniDirty: boolean;
  atmosphereCount: number;
  _rain: number;
}
