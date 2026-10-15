import type { GameRuntime } from '../runtime.ts';
import type { BuildingType, Sprite } from '../types.ts';

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
  mountains?: { dry: PaintedRegion[]; snowy: PaintedRegion[]; foothill: PaintedRegion };
}

const buildingTypes: BuildingType[] = [
  'hq',
  'warehouse',
  'lumberjack',
  'forester',
  'quarry',
  'fisherman',
  'farm',
  'windmill',
  'bakery',
  'pigfarm',
  'butcher',
  'well',
  'brewery',
  'smelter',
  'workshop',
  'mine_coal',
  'mine_iron',
  'mine_gold',
  'sawmill',
  'toolsmith',
  'armory',
  'guard',
];

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
  if (manifest.mountains) {
    if (
      !Array.isArray(manifest.mountains.dry) ||
      manifest.mountains.dry.length !== 3 ||
      !Array.isArray(manifest.mountains.snowy) ||
      manifest.mountains.snowy.length !== 2
    )
      throw new Error('Painted mountains require three dry and two snowy variants.');
    manifest.mountains.dry.forEach((item, index) => region(item, 'dry mountain ' + index));
    manifest.mountains.snowy.forEach((item, index) => region(item, 'snowy mountain ' + index));
    region(manifest.mountains.foothill, 'mountain foothill');
  }
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
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Artwork canvas is unavailable.');
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

function fittedBuilding(image: HTMLCanvasElement, original: Sprite): Sprite {
  return {
    ...original,
    img: fittedCanvas(image, original.img.width, original.img.height),
  };
}

export function artworkAssetURL(file = 'manifest.json'): URL {
  // Resolve beside the release or test bundle, preserving deployment subpaths.
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'));
  const script = scripts
    .reverse()
    .find((item) => /\/game\.(?:min|test)\.js$/.test(new URL(item.src).pathname));
  return new URL('assets/art/' + file, script?.src || document.baseURI);
}

function showFallback(message: string) {
  let warning = document.getElementById('painted-art-status');
  if (!warning) {
    warning = document.createElement('div');
    warning.id = 'painted-art-status';
    warning.setAttribute('role', 'status');
    warning.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:100;padding:12px;max-width:380px;border:1px solid #ad8c4c;border-radius:6px;background:#f6f0e2;color:#284535;font:13px/1.5 system-ui;box-shadow:0 5px 24px #132d2340';
    document.body.append(warning);
  }
  warning.textContent = 'Painted artwork could not load. Standard artwork is active.';
  warning.title = message;
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Why standard artwork is active';
  details.appendChild(summary);
  const explanation = document.createElement('p');
  explanation.textContent =
    message +
    ' The incomplete pack was not installed. The native WebGL world remains playable with the existing standard artwork; simulation and checkpoints are unchanged.';
  details.appendChild(explanation);
  const reference = document.createElement('button');
  reference.textContent = 'Artwork recovery reference';
  reference.dataset.reference = 'settings';
  details.appendChild(reference);
  const keep = document.createElement('button');
  keep.textContent = 'Keep playing with standard artwork';
  keep.onclick = () => warning.remove();
  warning.appendChild(details);
  warning.appendChild(keep);
}

/** Load before game.init(); installation is atomic, so failures preserve working art. */
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
    const buildings: Partial<Record<BuildingType, Sprite>> = {};
    const variants: Partial<Record<BuildingType, Sprite>> = {};
    for (const type of buildingTypes) {
      const original = game.ART.bld[type];
      if (!original) throw new Error('Missing original sprite anchor: ' + type);
      buildings[type] = fittedBuilding(crop(manifest.buildings[type]), original);
      // Every visual variant uses the painted asset instead of alternating to the
      // procedural atlas when a building ID happens to have the other parity.
      if (game.ART.bld2[type]) variants[type] = buildings[type];
    }
    const site = fittedBuilding(crop(manifest.site), game.ART.site);
    const trees = manifest.trees.map(crop);
    const growth = [0.34, 0.49, 0.72, 1];
    const treeAtlas = growth.map((scale, stage) =>
      trees.map((image, variant) => {
        const original = game.ART.tree[stage][variant][0];
        // The renderer keeps its existing fixed canvas/root placement. A smaller
        // growth stage scales around the same root, never around the image center.
        const base = original.height * (39 / 42);
        return [0, 1].map((frame) =>
          fittedCanvas(image, original.width, original.height, base, scale, frame ? scale : 0),
        );
      }),
    );
    const rocks = manifest.rocks.map((region, index) => {
      const original = game.ART.rock[index];
      return fittedCanvas(crop(region), original.width, original.height);
    });
    const paintedMountains = manifest.mountains
      ? {
          dry: manifest.mountains.dry.map(crop),
          snowy: manifest.mountains.snowy.map(crop),
          foothill: crop(manifest.mountains.foothill),
        }
      : undefined;
    // Keep the decoded material immutable; repeatedly sampling a large mutable
    // Canvas forces costly snapshots on some accelerated Canvas implementations.
    const meadow = sheets[manifest.terrain.sheet];
    // Painted terrain variants share one immutable meadow thumbnail.
    const grass = makeCanvas(game.ART.grass[0].width, game.ART.grass[0].height);
    canvasContext(grass).drawImage(meadow, 0, 0, grass.width, grass.height);
    Object.assign(game.ART, {
      bld: buildings,
      bld2: variants,
      site,
      tree: treeAtlas,
      rock: rocks,
      grass: game.ART.grass.map(() => grass),
      paintedTerrain: { image: meadow, worldSize: manifest.terrain.worldSize },
      paintedMountains,
      paintedStatus: { state: 'loaded', message: 'Painted artwork loaded.' },
    });
    game.staticDirty = true;
    document.getElementById('painted-art-status')?.remove();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    game.ART.paintedStatus = { state: 'fallback', message };
    showFallback(message);
    console.warn('Painted artwork fallback:', message);
  }
}
