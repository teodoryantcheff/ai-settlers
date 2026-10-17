import type { GameRuntime } from '../runtime.ts';
import type { BuildingType, Sprite } from '../types.ts';
import { CanvasContextError, requireCanvas2D } from './canvas-context.ts';

interface PaintedRegion {
  sheet: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface PaintedManifest {
  version: 1;
  sheets: Record<string, string>;
  buildings: Record<BuildingType, PaintedRegion>;
  site: PaintedRegion;
  trees: PaintedRegion[];
  rocks: PaintedRegion[];
  terrain: { sheet: string; worldSize: number };
  mountains: { dry: PaintedRegion[]; snowy: PaintedRegion[]; foothill: PaintedRegion };
}

/** World-pixel boxes for each building sprite. The box bottom is the entrance
 * row of the 24px tile, so footprints and anchors stay put for any painted pack. */
export const BUILDING_FRAMES: Readonly<Record<BuildingType, { w: number; h: number }>> = {
  hq: { w: 48, h: 56 },
  warehouse: { w: 38, h: 46 },
  lumberjack: { w: 36, h: 42 },
  forester: { w: 38, h: 42 },
  sawmill: { w: 36, h: 44 },
  quarry: { w: 38, h: 44 },
  fisherman: { w: 36, h: 40 },
  farm: { w: 44, h: 46 },
  windmill: { w: 44, h: 58 },
  bakery: { w: 38, h: 44 },
  pigfarm: { w: 38, h: 44 },
  butcher: { w: 38, h: 44 },
  well: { w: 34, h: 40 },
  brewery: { w: 38, h: 44 },
  smelter: { w: 36, h: 44 },
  workshop: { w: 38, h: 44 },
  mine_coal: { w: 34, h: 42 },
  mine_iron: { w: 34, h: 42 },
  mine_gold: { w: 34, h: 42 },
  toolsmith: { w: 36, h: 44 },
  armory: { w: 36, h: 46 },
  guard: { w: 34, h: 50 },
};
const SITE_FRAME = { w: 34, h: 38 };
/** Tree canvases keep one root row for every growth stage; rocks share one box. */
const TREE_FRAME = { w: 36, h: 42, root: 39 };
const ROCK_FRAME = { w: 32, h: 24 };
const TREE_GROWTH = [0.34, 0.49, 0.72, 1];

const buildingTypes = Object.keys(BUILDING_FRAMES) as BuildingType[];

/** Reject incomplete packs before changing any installed sprite or terrain. */
export function validatePaintedManifest(input: unknown): PaintedManifest {
  const manifest = input as PaintedManifest;
  if (!manifest || manifest.version !== 1 || !manifest.sheets || !manifest.buildings)
    throw new Error('Unsupported painted artwork manifest.');
  function region(value: PaintedRegion, name: string) {
    if (
      !value ||
      !manifest.sheets[value.sheet] ||
      ![value.x, value.y, value.w, value.h].every(Number.isInteger) ||
      value.x < 0 ||
      value.y < 0 ||
      value.w <= 0 ||
      value.h <= 0
    )
      throw new Error('Invalid painted artwork region: ' + name);
  }
  for (const type of buildingTypes) region(manifest.buildings[type], type);
  region(manifest.site, 'construction site');
  if (!Array.isArray(manifest.trees) || manifest.trees.length !== 3)
    throw new Error('Painted artwork requires three tree species.');
  if (!Array.isArray(manifest.rocks) || manifest.rocks.length !== 2)
    throw new Error('Painted artwork requires two rock variants.');
  manifest.trees.forEach((item, index) => region(item, 'tree ' + index));
  manifest.rocks.forEach((item, index) => region(item, 'rock ' + index));
  if (
    !manifest.mountains ||
    !Array.isArray(manifest.mountains.dry) ||
    manifest.mountains.dry.length !== 3 ||
    !Array.isArray(manifest.mountains.snowy) ||
    manifest.mountains.snowy.length !== 2
  )
    throw new Error('Painted mountains require three dry and two snowy variants.');
  manifest.mountains.dry.forEach((item, index) => region(item, 'dry mountain ' + index));
  manifest.mountains.snowy.forEach((item, index) => region(item, 'snowy mountain ' + index));
  region(manifest.mountains.foothill, 'mountain foothill');
  if (
    !manifest.terrain ||
    !manifest.sheets[manifest.terrain.sheet] ||
    !Number.isFinite(manifest.terrain.worldSize) ||
    manifest.terrain.worldSize <= 0
  )
    throw new Error('Invalid painted meadow material.');
  for (const file of Object.values(manifest.sheets))
    if (typeof file !== 'string' || !file) throw new Error('Missing painted artwork sheet.');
  return manifest;
}

/** Uniform fitting retains painted proportions and the existing entrance/foot point. */
export function fitPaintedSprite(
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  baseY = height,
  scale = 1,
): { x: number; y: number; w: number; h: number } {
  const ratio = Math.min(width / sourceWidth, baseY / sourceHeight) * scale;
  const w = sourceWidth * ratio;
  const h = sourceHeight * ratio;
  return { x: (width - w) / 2, y: baseY - h, w, h };
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = requireCanvas2D(canvas, undefined, { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return context;
}

function loadImage(url: URL): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => {
      image.src = '';
      reject(new Error('Artwork image timed out: ' + url.pathname));
    }, 15000);
    image.onload = () => {
      clearTimeout(timeout);
      if (!image.naturalWidth || !image.naturalHeight) reject(new Error('Empty artwork image.'));
      else resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Artwork image failed to load: ' + url.pathname));
    };
    image.src = url.href;
  });
}

function cropRegion(image: HTMLImageElement, region: PaintedRegion): HTMLCanvasElement {
  const x = region.x;
  const y = region.y;
  const right = x + region.w;
  const bottom = y + region.h;
  if (right > image.naturalWidth || bottom > image.naturalHeight || right <= x || bottom <= y)
    throw new Error('Artwork crop exceeds its sheet.');
  const canvas = makeCanvas(right - x, bottom - y);
  const context = canvasContext(canvas);
  context.drawImage(image, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width;
  let top = canvas.height;
  let maxX = -1;
  let maxY = -1;
  let transparent = false;
  for (let py = 0; py < canvas.height; py++)
    for (let px = 0; px < canvas.width; px++) {
      // Retain antialiasing and painted contact shadows, discard only empty padding.
      if (pixels[(py * canvas.width + px) * 4 + 3] <= 3) {
        transparent = true;
        continue;
      }
      left = Math.min(left, px);
      top = Math.min(top, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  if (maxX < left || maxY < top) throw new Error('Artwork crop contains no visible pixels.');
  if (!transparent) throw new Error('Artwork sprite requires a transparent background.');
  left = Math.max(0, left - 2);
  top = Math.max(0, top - 2);
  const width = Math.min(canvas.width, maxX + 3) - left;
  const height = Math.min(canvas.height, maxY + 3) - top;
  const trimmed = makeCanvas(width, height);
  canvasContext(trimmed).drawImage(canvas, left, top, width, height, 0, 0, width, height);
  return trimmed;
}

function fittedCanvas(
  image: HTMLCanvasElement,
  width: number,
  height: number,
  baseY = height,
  scale = 1,
  sway = 0,
): HTMLCanvasElement {
  const canvas = makeCanvas(width, height);
  const box = fitPaintedSprite(image.width, image.height, width, height, baseY, scale);
  canvasContext(canvas).drawImage(image, box.x + sway, box.y, box.w, box.h);
  return canvas;
}

/** Fit painted art into a building box whose bottom row is the tile's entrance. */
function fittedBuilding(image: HTMLCanvasElement, frame: { w: number; h: number }, ss: number) {
  const sprite: Sprite = {
    img: fittedCanvas(image, frame.w * ss, frame.h * ss),
    w: frame.w,
    h: frame.h,
    ox: -(frame.w - 24) / 2,
    oy: -(frame.h - 24),
  };
  return sprite;
}

export function artworkAssetURL(file = 'manifest.json'): URL {
  // Resolve beside the release or test bundle, preserving deployment subpaths.
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'));
  const script = scripts
    .reverse()
    .find((item) => /\/game\.(?:min|test)\.js$/.test(new URL(item.src).pathname));
  return new URL('assets/art/' + file, script?.src || document.baseURI);
}

/** Load before game.init(). Installation is atomic: any missing or invalid image
 * rejects before the atlas changes, and boot reports the failure. */
export async function loadPaintedAssets(game: GameRuntime): Promise<void> {
  game.ART.paintedStatus = { state: 'loading', message: 'Loading painted artwork.' };
  try {
    const url = artworkAssetURL();
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Artwork manifest failed: HTTP ' + response.status);
    const manifest = validatePaintedManifest(await response.json());
    const sheets = Object.fromEntries(
      await Promise.all(
        Object.entries(manifest.sheets).map(async ([id, file]) => [
          id,
          await loadImage(new URL(file, url)),
        ]),
      ),
    ) as Record<string, HTMLImageElement>;
    const crop = (region: PaintedRegion) => cropRegion(sheets[region.sheet], region);
    const ss = game.SS;
    const buildings: Partial<Record<BuildingType, Sprite>> = {};
    for (const type of buildingTypes)
      buildings[type] = fittedBuilding(crop(manifest.buildings[type]), BUILDING_FRAMES[type], ss);
    const site = fittedBuilding(crop(manifest.site), SITE_FRAME, ss);
    const trees = manifest.trees.map(crop);
    const treeAtlas = TREE_GROWTH.map((scale) =>
      trees.map((image) =>
        // A smaller growth stage scales around the same root, never the image centre.
        [0, 1].map((frame) =>
          fittedCanvas(
            image,
            TREE_FRAME.w * ss,
            TREE_FRAME.h * ss,
            TREE_FRAME.root * ss,
            scale,
            frame ? scale : 0,
          ),
        ),
      ),
    );
    const rocks = manifest.rocks.map((region) =>
      fittedCanvas(crop(region), ROCK_FRAME.w * ss, ROCK_FRAME.h * ss),
    );
    const mountains = {
      dry: manifest.mountains.dry.map(crop),
      snowy: manifest.mountains.snowy.map(crop),
      foothill: crop(manifest.mountains.foothill),
    };
    // Keep the decoded material immutable; repeatedly sampling a large mutable
    // Canvas forces costly snapshots on some accelerated Canvas implementations.
    const meadow = sheets[manifest.terrain.sheet];
    Object.assign(game.ART, {
      bld: buildings,
      site,
      tree: treeAtlas,
      rock: rocks,
      paintedTerrain: { image: meadow, worldSize: manifest.terrain.worldSize },
      paintedMountains: mountains,
      paintedStatus: { state: 'loaded', message: 'Painted artwork loaded.' },
    });
    game.staticDirty = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    game.ART.paintedStatus = { state: 'failed', message };
    if (error instanceof CanvasContextError) {
      game.reportGraphicsFailure(error.message);
      throw error;
    }
    throw new Error('Painted artwork could not load: ' + message, { cause: error });
  }
}
