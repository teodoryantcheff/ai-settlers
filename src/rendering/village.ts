import type { Graphics } from 'pixi.js';
import { requireCanvas2D } from './canvas-context.ts';
import type { GameRuntime } from '../runtime.ts';
import type { Building, BuildingType, Good, Sprite } from '../types.ts';
import type { SceneLayer } from './scene.ts';

/** One displayed good pile on a building's stock heap. */
export interface VillageStockSlot {
  good: Good;
  quantity: number;
  output?: boolean;
}
/** Cached stock display; quantities detect changes without rebuilding slots. */
interface VillageStockView {
  done: boolean;
  quantities: number[];
  slots: VillageStockSlot[];
}

export function createVillage(game: GameRuntime, internals?: VillageInternals): VillageSubsystem {
  // ==================== VILLAGE PRESENTATION ====================
  // Small cached additions use the existing tile footprint and ground anchor.
  // The caches are bounded by building type, construction stage and crop stage.
  const villageYards: Record<string, HTMLCanvasElement> = Object.create(null),
    villageSurroundings: Record<string, HTMLCanvasElement> = Object.create(null);
  let villageSites: Record<string, Sprite> = Object.create(null);
  const villageCrops: HTMLCanvasElement[] = [],
    villageMotion: WeakMap<Building, { last: number; time: number }> = new WeakMap(),
    villageStockViews: WeakMap<Building, VillageStockView> = new WeakMap(),
    villageGoods: Good[] = [
      'logs',
      'planks',
      'stone',
      'food',
      'grain',
      'flour',
      'bread',
      'pigs',
      'meat',
      'fish',
      'beer',
      'iron_bars',
      'coal',
      'iron',
      'tools',
      'weapons',
      'gold',
    ];

  function villageWorkTime(b: Building): number {
    // Screenshot scenarios reproduce the same pose after save/load or a different
    // wall-clock delay. Simulation time already stops while the colony is paused.
    if (game.TESTMODE) return game.renderPrefs().reducedMotion ? 0 : game.state.time * 1000;
    let clock = villageMotion.get(b);
    if (!clock) {
      clock = { last: game.NOW, time: 0 };
      villageMotion.set(b, clock);
    }
    const elapsed = Math.max(0, Math.min(50, game.NOW - clock.last));
    clock.last = game.NOW;
    if (!game.state.paused && !game.renderPrefs().reducedMotion) clock.time += elapsed;
    return game.renderPrefs().reducedMotion ? 0 : clock.time;
  }
  function villageCanvas(
    w: number,
    h: number,
    paint: (g: CanvasRenderingContext2D) => void,
  ): HTMLCanvasElement {
    const c = game.Acan(w * game.SS, h * game.SS),
      g = requireCanvas2D(c, game.reportGraphicsFailure);
    g.scale(game.SS, game.SS);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    paint(g);
    return c;
  }
  function villageLine(
    g: CanvasRenderingContext2D,
    color: string,
    width: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): void {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  }
  function villageEllipse(
    g: CanvasRenderingContext2D,
    color: string,
    x: number,
    y: number,
    rx: number,
    ry: number,
  ): void {
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Live per-frame marks, drawn natively into the object layer.
  function sceneLine(
    g: Graphics,
    color: number,
    width: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): void {
    g.moveTo(x1, y1).lineTo(x2, y2).stroke({ color, width });
  }
  function sceneEllipse(g: Graphics, color: number, x: number, y: number, rx: number, ry: number) {
    g.ellipse(x, y, rx, ry).fill(color);
  }
  function villageYard(type: string) {
    if (villageYards[type]) return villageYards[type];
    return (villageYards[type] = villageCanvas(36, 32, function (g) {
      g.translate(6, 4);
      const industrial = type === 'quarry' || type.indexOf('mine_') === 0,
        store = type === 'hq' || type === 'warehouse',
        seed = Array.from(type).reduce(function (sum, letter) {
          return sum * 31 + letter.charCodeAt(0);
        }, 73),
        random = game.mulberry32(seed);
      // Cached ground wear extends beyond the tiny tile, grounding the full sprite.
      const soil = g.createRadialGradient(11, 19, 1, 11, 19, 17);
      soil.addColorStop(0, industrial ? 'rgba(117,100,73,0.48)' : 'rgba(167,134,75,0.48)');
      soil.addColorStop(0.6, 'rgba(170,143,83,0.27)');
      soil.addColorStop(1, 'rgba(161,139,82,0)');
      g.fillStyle = soil;
      g.beginPath();
      g.ellipse(11, 19, 17, 8, -0.08, 0, Math.PI * 2);
      g.fill();
      villageEllipse(
        g,
        industrial ? 'rgba(120,110,90,0.25)' : 'rgba(156,132,91,0.23)',
        12,
        19,
        11.5,
        4.4,
      );
      villageEllipse(g, 'rgba(183,165,114,0.14)', 11, 20, 10, 3.8);
      // The clear entrance meets the south road at the existing tile centre.
      g.fillStyle = 'rgba(191,168,118,0.39)';
      g.beginPath();
      g.moveTo(9, 18);
      g.lineTo(14, 18);
      g.lineTo(15.3, 24);
      g.lineTo(8.5, 24);
      g.closePath();
      g.fill();
      if (store) {
        for (let slab = 0; slab < 3; slab++) {
          g.fillStyle = slab % 2 ? 'rgba(182,179,151,0.6)' : 'rgba(211,200,160,0.6)';
          g.fillRect(8.5, 18.5 + slab * 1.9, 6, 1.5);
          villageLine(g, 'rgba(83,80,64,0.28)', 0.45, 8.7, 20 + slab * 1.9, 14.2, 20 + slab * 1.9);
        }
      }
      if (industrial) {
        // Parallel cart ruts lead into the working yard without moving the door.
        villageLine(g, 'rgba(77,66,44,0.32)', 0.65, 9.4, 18.5, 9, 24);
        villageLine(g, 'rgba(77,66,44,0.32)', 0.65, 13.8, 18.5, 14.4, 24);
      } else if (
        type === 'guard' ||
        type === 'toolsmith' ||
        type === 'armory' ||
        type === 'smelter'
      ) {
        for (let paving = 0; paving < 4; paving++) {
          villageEllipse(
            g,
            'rgba(96,94,79,0.48)',
            10.2 + (paving % 2) * 3,
            20 + Math.floor(paving / 2) * 2.5,
            1.4,
            0.85,
          );
          villageLine(
            g,
            'rgba(220,209,169,0.45)',
            0.45,
            9.4 + (paving % 2) * 3,
            19.6 + Math.floor(paving / 2) * 2.5,
            11 + (paving % 2) * 3,
            19.6 + Math.floor(paving / 2) * 2.5,
          );
        }
      } else if (type === 'farm' || type === 'pigfarm' || type === 'lumberjack') {
        villageLine(g, 'rgba(112,87,45,0.25)', 1.4, 11.5, 19, 11.9, 24);
      }
      // Gentle wear and pebbles sit below buildings rather than floating above them.
      for (let pebble = 0; pebble < 7; pebble++) {
        const px = 1.5 + ((pebble * 7.7) % 21),
          py = 20 + ((pebble * 2.3) % 3.5);
        villageEllipse(
          g,
          pebble % 2 ? 'rgba(102,108,77,0.3)' : 'rgba(218,208,158,0.4)',
          px,
          py,
          0.7,
          0.3,
        );
      }
      for (let fleck = 0; fleck < 75; fleck++) {
        const fx = -3 + random() * 30,
          fy = 14 + random() * 13,
          edge = Math.abs(fx - 11) / 15;
        if (Math.pow((fx - 11) / 16, 2) + Math.pow((fy - 20) / 7, 2) > 1) continue;
        villageEllipse(
          g,
          fleck % 3 === 0 ? 'rgba(77,69,43,0.18)' : 'rgba(228,204,144,0.26)',
          fx,
          fy,
          0.25 + random() * 0.65,
          0.13 + random() * 0.23,
        );
        if (edge > 0.65) {
          villageLine(g, '#6b7b3f', 0.45, fx, fy, fx - 0.6, fy - 1.4);
          villageLine(g, '#a2aa61', 0.4, fx + 0.4, fy, fx + 0.8, fy - 1.8);
        }
      }
      if (!industrial) {
        // Small living borders stay away from the readable south-facing entrance.
        for (let sprig = 0; sprig < 10; sprig++) {
          const sx = sprig < 5 ? -2.5 + random() * 4 : 22 + random() * 4,
            sy = 17 + random() * 7;
          villageEllipse(g, 'rgba(48,68,35,0.33)', sx + 0.7, sy + 0.3, 1.6, 0.55);
          villageLine(g, '#6b813f', 0.6, sx, sy, sx + 0.4, sy - 2);
          villageEllipse(g, '#809548', sx - 0.5, sy - 1.1, 0.9, 0.45);
          villageEllipse(g, '#b2bb68', sx + 0.8, sy - 1.5, 0.7, 0.35);
          if (sprig % 3 === 0) {
            villageEllipse(g, '#e4cb7d', sx + 0.4, sy - 2.2, 0.55, 0.35);
            villageEllipse(g, '#f4e4b3', sx + 0.15, sy - 2.45, 0.25, 0.2);
          }
        }
      }
    }));
  }
  function drawVillageYard(s: SceneLayer, b: Building): void {
    if (game.z < 0.55) return;
    s.image(villageYard(b.type), b.x * game.TS - 6, b.y * game.TS - 4, 36, 32);
  }

  function villageSurrounding(type: BuildingType): HTMLCanvasElement {
    if (villageSurroundings[type]) return villageSurroundings[type];
    // Static furnishings are painted once, then reused as native Pixi textures.
    // They describe the workplace, never its physical inventory. The entrance
    // corridor (x=8..16) and the original building anchor remain clear.
    return (villageSurroundings[type] = villageCanvas(36, 32, function (g) {
      g.translate(6, 4);
      function fence(left: number, right: number, y: number): void {
        villageLine(g, 'rgba(43,39,23,0.2)', 1.6, left + 1, y + 0.5, right + 1, y + 0.5);
        for (let rail = 0; rail < 2; rail++) {
          villageLine(g, '#81603a', 0.85, left, y - 1.6 - rail * 1.7, right, y - 1.6 - rail * 1.7);
          villageLine(g, '#c2a170', 0.35, left, y - 1.9 - rail * 1.7, right, y - 1.9 - rail * 1.7);
        }
        for (let post = left; post <= right; post += 3.2) {
          villageLine(g, '#715334', 1.05, post, y, post, y - 5);
          villageLine(g, '#d0b17a', 0.35, post - 0.25, y - 0.5, post - 0.25, y - 4.8);
        }
      }
      function barrel(x: number, y: number): void {
        villageEllipse(g, 'rgba(42,35,21,0.25)', x + 0.8, y + 0.4, 2.6, 0.85);
        g.fillStyle = '#967048';
        g.fillRect(x - 1.8, y - 4, 3.6, 3.8);
        villageEllipse(g, '#795434', x, y - 0.3, 1.8, 0.65);
        villageLine(g, '#c19b62', 0.45, x - 0.9, y - 3.6, x - 0.9, y - 0.8);
        villageLine(g, '#594c37', 0.55, x - 1.8, y - 2.8, x + 1.8, y - 2.8);
        villageLine(g, '#594c37', 0.55, x - 1.8, y - 1, x + 1.8, y - 1);
        villageEllipse(g, '#cfb47e', x, y - 4, 1.8, 0.65);
        villageEllipse(g, '#aa8859', x, y - 4, 1.3, 0.35);
      }
      function sack(x: number, y: number): void {
        villageEllipse(g, 'rgba(47,37,20,0.23)', x + 0.5, y + 0.4, 2.3, 0.7);
        villageEllipse(g, '#b5a070', x, y - 1.7, 1.8, 2.1);
        villageEllipse(g, '#dbc595', x - 0.45, y - 2, 0.9, 1.4);
        villageLine(g, '#7f704b', 0.6, x - 0.7, y - 3.7, x + 0.7, y - 3.7);
      }
      function woodpile(x: number, y: number): void {
        villageEllipse(g, 'rgba(42,35,21,0.23)', x + 3, y + 0.4, 4.2, 1);
        for (let log = 0; log < 5; log++) {
          const lx = x + (log % 3) * 1.8,
            ly = y - Math.floor(log / 3) * 1.7;
          villageLine(g, '#705032', 1.7, lx, ly, lx + 3.8, ly - 1.1);
          villageLine(g, '#af8450', 0.45, lx, ly - 0.5, lx + 3.7, ly - 1.5);
          villageEllipse(g, '#d6b77e', lx, ly, 0.8, 0.65);
          villageEllipse(g, '#8e673e', lx, ly, 0.3, 0.25);
        }
      }
      function garden(x: number, y: number, flowers: boolean): void {
        g.fillStyle = '#75633d';
        g.fillRect(x, y - 3.5, 4.8, 3.8);
        villageLine(g, '#b29663', 0.65, x, y + 0.4, x + 4.8, y + 0.4);
        for (let plant = 0; plant < 6; plant++) {
          const px = x + 0.7 + (plant % 3) * 1.6,
            py = y - Math.floor(plant / 3) * 1.7;
          villageLine(g, '#526638', 0.5, px, py, px, py - 1.7);
          villageEllipse(g, '#819748', px - 0.35, py - 1, 0.8, 0.4);
          villageEllipse(g, '#a7b65f', px + 0.3, py - 1.5, 0.6, 0.35);
          if (flowers)
            villageEllipse(g, plant % 2 ? '#dfb878' : '#e6d6a3', px, py - 1.9, 0.5, 0.35);
        }
      }
      if (type === 'farm' || type === 'pigfarm') {
        fence(-3, 6.6, 24.5);
        fence(18, 27, 24.5);
        sack(25, 21);
        if (type === 'farm') garden(-3.5, 19.8, false);
        else {
          g.fillStyle = '#685138';
          g.fillRect(-3, 18, 6, 1.9);
          villageLine(g, '#b99c6a', 0.7, -3, 18, 3, 18);
          villageEllipse(g, '#ccb879', 0, 18.8, 2.2, 0.45);
        }
      } else if (type === 'lumberjack' || type === 'sawmill' || type === 'forester') {
        woodpile(20, 24);
        if (type === 'forester') garden(-3, 24, false);
        else {
          villageEllipse(g, '#785c39', -1, 22, 2.5, 1.4);
          villageEllipse(g, '#c9ad78', -1, 20.5, 2.4, 0.85);
          villageEllipse(g, '#9a7c4d', -1, 20.5, 1.4, 0.5);
        }
      } else if (type === 'quarry' || type.indexOf('mine_') === 0) {
        fence(-3, 5, 24);
        for (let rock = 0; rock < 5; rock++) {
          const rx = 21 + (rock % 3) * 1.9,
            ry = 24 - Math.floor(rock / 3) * 1.5;
          villageEllipse(g, '#726e60', rx, ry, 1.7, 0.8);
          villageEllipse(g, '#a9a38a', rx - 0.4, ry - 0.6, 1.2, 0.7);
          villageLine(g, '#c9c3a3', 0.4, rx - 0.9, ry - 1, rx + 0.4, ry - 1.1);
        }
      } else if (type === 'hq' || type === 'warehouse') {
        barrel(-1.5, 23.5);
        barrel(2.3, 22.2);
        sack(25.3, 24);
        fence(19, 27, 18);
      } else if (type === 'bakery' || type === 'windmill' || type === 'butcher') {
        sack(-1.5, 24);
        sack(1.5, 22);
        barrel(25.5, 24);
        if (type === 'bakery') garden(20.5, 21, true);
      } else if (type === 'brewery' || type === 'well' || type === 'fisherman') {
        barrel(-1.2, 24);
        barrel(25, 23);
        if (type === 'brewery') garden(20, 20, false);
        if (type === 'fisherman') {
          villageLine(g, '#82623e', 0.7, 20, 20, 25, 17);
          for (let net = 0; net < 5; net++)
            villageLine(g, '#c0b991', 0.4, 20 + net, 20 - net * 0.6, 21 + net, 23 - net * 0.6);
        }
      } else if (type === 'guard') {
        fence(-3, 5.5, 24.5);
        fence(19, 27, 24.5);
        barrel(-1, 19);
      } else {
        barrel(-1.5, 24);
        woodpile(20.5, 24);
      }
    }));
  }

  // A small pile counts physical goods; reservations do not hide goods before pickup.
  // Large warehouse holdings are represented by four bundles so drawing cost is fixed.
  function villageStockPlan(b: Building): VillageStockSlot[] {
    let view = villageStockViews.get(b);
    const physical = b.done ? b.stock : b.got;
    let changed = !view || view.done !== b.done;
    if (!view) {
      view = { done: b.done, quantities: [], slots: [] };
      villageStockViews.set(b, view);
    }
    for (let count = 0; count < villageGoods.length; count++) {
      const quantity = (physical[villageGoods[count]] ?? 0) | 0;
      if (view.quantities[count] !== quantity) changed = true;
      view.quantities[count] = quantity;
    }
    if (!changed) return view.slots;
    view.done = b.done;
    const sp = game.BSPEC[b.type],
      slots = view.slots;
    slots.length = 0;
    if (!b.done) {
      (['planks', 'stone', 'tools', 'weapons'] as Good[]).forEach(function (good) {
        const quantity = (b.got[good] ?? 0) | 0;
        if (quantity > 0) slots.push({ good: good, quantity: quantity });
      });
      return slots;
    }
    if (sp.store) {
      for (let goodIndex = 0; goodIndex < villageGoods.length; goodIndex++) {
        const good = villageGoods[goodIndex],
          stored = (b.stock[good] ?? 0) | 0;
        if (stored > 0) slots.push({ good: good, quantity: stored });
      }
      slots.sort(function (a, b2) {
        return b2.quantity - a.quantity;
      });
      slots.length = Math.min(2, slots.length);
      return slots;
    }
    if (sp.in) {
      for (const input in sp.in) {
        if (((b.stock[input as Good] ?? 0) | 0) > 0) {
          slots.push({ good: input as Good, quantity: (b.stock[input as Good] ?? 0) | 0 });
          break;
        }
      }
    }
    if (sp.out && ((b.stock[sp.out] ?? 0) | 0) > 0)
      slots.push({ good: sp.out, quantity: (b.stock[sp.out] ?? 0) | 0, output: true });
    return slots;
  }
  function drawVillageGood(
    s: SceneLayer,
    good: Good,
    quantity: number,
    x: number,
    y: number,
    size: number,
  ): void {
    if (quantity <= 0) return;
    const bundles = Math.min(4, Math.ceil(quantity / 2)),
      img = game.ART.cargo[good];
    for (let pile = 0; pile < bundles; pile++) {
      const px = x + (pile % 2) * size * 1.1,
        py = y - Math.floor(pile / 2) * size * 2.3;
      if (img) s.image(img, px, py - 5.5 * size, 7.4 * size, 5.5 * size);
      else {
        s.g.rect(px, py - 2 * size, 5 * size, 2 * size).fill(game.GOODS[good].c);
        s.g.rect(px, py - 2 * size, 5 * size, 0.6 * size).fill({ color: 0xffffff, alpha: 0.3 });
      }
    }
  }
  function drawVillageStock(s: SceneLayer, b: Building): void {
    if (game.z < 0.65) return;
    const slots = villageStockPlan(b);
    for (let slot = 0; slot < slots.length; slot++) {
      const item = slots[slot],
        right = item.output || slot % 2 === 1,
        x = b.x * game.TS + (right ? 16 : 0.4),
        y = b.y * game.TS + 23.5 - Math.floor(slot / 2) * 3;
      drawVillageGood(s, item.good, item.quantity, x, y, b.done ? 0.85 : 0.75);
    }
  }
  function villageCrop(stage: number): HTMLCanvasElement {
    if (villageCrops[stage]) return villageCrops[stage];
    return (villageCrops[stage] = villageCanvas(game.TS, 13, function (g) {
      const random = game.mulberry32(3187 + stage * 41),
        soil = g.createLinearGradient(0, 0, 24, 13);
      soil.addColorStop(0, '#a0894e');
      soil.addColorStop(1, '#746037');
      g.fillStyle = soil;
      g.fillRect(0.7, 0.8, 22.5, 11.2);
      for (let row = 0; row < 5; row++) {
        const ry = 2.1 + row * 2;
        villageLine(g, 'rgba(71,55,26,0.45)', 0.8, 0.8, ry + 1.6, 23, ry + 1.6);
        villageLine(g, 'rgba(228,200,119,0.38)', 0.5, 1, ry + 2, 22.8, ry + 2);
        for (let stalk = 0; stalk < 11; stalk++) {
          const x = 1.3 + stalk * 1.9 + (row % 2) * 0.45 + random() * 0.5,
            height = (stage === 0 ? 1.4 : stage === 1 ? 2.7 : 3.8) + random() * 0.6,
            y = ry + 1.2;
          villageLine(g, 'rgba(55,50,25,0.27)', 0.8, x + 0.5, y + 0.5, x + 1.2, y - height + 0.4);
          villageLine(g, stage === 2 ? '#d9b853' : '#779544', 0.65, x, y, x + 0.3, y - height);
          if (stage > 0) {
            villageLine(
              g,
              stage === 2 ? '#ecd17d' : '#a2b35a',
              0.8,
              x - 0.6,
              y - height + 1.4,
              x + 0.2,
              y - height + 0.6,
            );
            villageLine(
              g,
              stage === 2 ? '#efd68a' : '#98b34f',
              0.65,
              x + 1,
              y - height + 1,
              x + 0.2,
              y - height + 0.1,
            );
            villageLine(
              g,
              stage === 2 ? '#f4dc8e' : '#b6bd6c',
              0.4,
              x + 0.2,
              y - height - 0.7,
              x + 0.2,
              y - height + 1.4,
            );
            if (stage === 2) villageEllipse(g, '#ffe7a2', x - 0.1, y - height + 0.4, 0.3, 0.8);
          }
        }
      }
      villageLine(g, '#967145', 0.8, 0.8, 12, 9, 12);
      villageLine(g, '#967145', 0.8, 15, 12, 23, 12);
    }));
  }
  function drawVillageDetails(s: SceneLayer, b: Building): void {
    if (game.z < 0.8) return;
    const x = b.x * game.TS,
      y = b.y * game.TS;
    s.image(villageSurrounding(b.type), x - 6, y - 4, 36, 32);
    const g = s.g;
    if (b.type === 'farm') {
      // Timer follows the real fifteen-second harvest cycle and freezes when blocked.
      const stage = b.timer > 10 ? 0 : b.timer > 5 ? 1 : 2;
      s.image(villageCrop(stage), x, y + 10.5, game.TS, 13);
    } else if (b.type === 'forester') {
      g.rect(x + 0.5, y + 18.8, 5, 4.4).fill(0x87663e);
      g.rect(x + 0.9, y + 19.2, 4.2, 3.6).fill(0x544c30);
      for (let seedling = 0; seedling < 4; seedling++) {
        const sx = x + 1.5 + (seedling % 2) * 2.2,
          sy = y + 20.5 + Math.floor(seedling / 2) * 1.9;
        sceneLine(g, 0xd5c19a, 0.5, sx, sy, sx, sy - 2);
        sceneEllipse(g, 0x617e39, sx, sy - 1.8, 1.3, 0.65);
        sceneEllipse(g, 0x9ab75d, sx - 0.35, sy - 2.1, 0.8, 0.45);
      }
    } else if (b.type === 'sawmill') {
      sceneLine(g, 0x624b30, 0.9, x + 0.9, y + 18, x + 1.3, y + 21);
      sceneLine(g, 0x624b30, 0.9, x + 6.5, y + 18, x + 6.1, y + 21);
      g.rect(x + 0.3, y + 17.2, 7, 1.4).fill(0xc9a56d);
      sceneLine(g, 0xead299, 0.5, x + 0.6, y + 17.3, x + 7, y + 17.3);
    } else if (
      b.type === 'toolsmith' ||
      b.type === 'armory' ||
      b.type === 'smelter' ||
      b.type === 'workshop'
    ) {
      g.rect(x + 19.5, y + 14.8, 4.5, 1.2)
        .rect(x + 21.1, y + 16, 1.4, 2.7)
        .rect(x + 20, y + 18.5, 3.8, 1)
        .fill(0x514a42);
      sceneLine(g, 0xb3b8b0, 0.6, x + 19.5, y + 14.7, x + 23.9, y + 14.7);
      sceneLine(g, 0x967452, 0.8, x + 17.8, y + 19, x + 18.8, y + 14.8);
      sceneLine(g, 0xced4cb, 1.2, x + 17.5, y + 15.2, x + 20, y + 14.9);
    }
    drawVillageStock(s, b);
  }

  function villageConstructionStage(progress: number): number {
    return progress < 0.18 ? 0 : progress < 0.44 ? 1 : progress < 0.74 ? 2 : 3;
  }
  function villageSite(type: BuildingType, stage: number): Sprite {
    if (stage === 1) return game.ART.site;
    const key = type + ':' + stage;
    if (villageSites[key]) return villageSites[key];
    const art = game.ART.bld[type];
    if (!art) throw new Error('Missing building artwork: ' + type);
    const width = Math.min(28, Math.max(18, art.w * 0.7)),
      body = Math.min(24, Math.max(13, art.h * 0.4));
    const img = villageCanvas(40, 50, function (g) {
      g.translate(8, 26);
      const left = 12 - width / 2,
        right = 12 + width / 2,
        floor = 19,
        top = floor - body;
      villageEllipse(g, 'rgba(37,31,20,0.21)', 12, 20, 14, 4);
      g.fillStyle = '#897e67';
      g.fillRect(left, floor - 2, width, 4);
      g.fillStyle = '#b6ae8d';
      g.fillRect(left, floor - 2, width, 1.2);
      for (let stone = 0; stone < 6; stone++)
        villageLine(
          g,
          'rgba(73,65,48,0.47)',
          0.5,
          left + (stone * width) / 6,
          floor - 1,
          left + (stone * width) / 6,
          floor + 2,
        );
      if (stage === 0) {
        villageLine(g, '#b8a477', 0.55, left, top + 6, right, top + 6);
        villageLine(g, '#b8a477', 0.55, left, top + 6, left, floor);
        villageLine(g, '#b8a477', 0.55, right, top + 6, right, floor);
        for (let peg = 0; peg < 4; peg++) {
          const px = peg % 2 ? right : left,
            py = peg > 1 ? floor : top + 6;
          villageLine(g, '#88623b', 1, px, py + 1, px, py - 2);
        }
        return;
      }
      if (stage >= 2) {
        const stoneWall = type === 'guard' || type === 'warehouse',
          woodWall = type === 'lumberjack' || type === 'farm';
        g.fillStyle = stoneWall ? '#aea899' : woodWall ? '#aa8051' : '#d9c99a';
        g.fillRect(left + 1, top, width - 2, body - 1.5);
        g.fillStyle = 'rgba(64,51,33,0.15)';
        g.fillRect(right - 5, top, 4, body - 1.5);
        for (let seam = 0; seam < 5; seam++)
          villageLine(
            g,
            'rgba(81,62,42,0.26)',
            0.5,
            left + 1,
            top + 3 + seam * 3,
            right - 1,
            top + 3 + seam * 3,
          );
        g.fillStyle = '#54442e';
        g.fillRect(9.5, floor - 8, 5.2, 6);
        g.fillRect(left + 3, top + 3, 3.2, 3.2);
      }
      villageLine(g, '#755432', 1.5, left + 0.7, floor, left + 0.7, top);
      villageLine(g, '#755432', 1.5, right - 0.7, floor, right - 0.7, top);
      villageLine(g, '#987147', 1.4, left, top, right, top);
      villageLine(g, '#987147', 1.1, left + 1, floor - 1, right - 1, top + 1);
      villageLine(g, '#b6925d', 0.6, left, top - 0.4, right, top - 0.4);
      // The pitched rafters establish the eventual roof silhouette as a separate stage.
      villageLine(g, '#89633e', 1.1, left - 1, top + 0.5, 12, top - 8);
      villageLine(g, '#89633e', 1.1, 12, top - 8, right + 1, top + 0.5);
      villageLine(g, '#b08b56', 0.9, 12, top - 8, 12, top);
      if (stage >= 2) {
        for (let slat = 0; slat < 3; slat++) {
          const ratio = (slat + 1) / 4;
          villageLine(
            g,
            '#af8654',
            0.7,
            left - 1 + (width / 2 + 1) * ratio,
            top + 0.5 - 8.5 * ratio,
            right + 1 - (width / 2 + 1) * ratio,
            top + 0.5 - 8.5 * ratio,
          );
        }
      }
    });
    const site: Sprite = { img, w: 40, h: 50, ox: -8, oy: -26 };
    villageSites[key] = site;
    return site;
  }
  function drawVillageScaffold(g: Graphics, b: Building, progress: number): void {
    const x = b.x * game.TS,
      y = b.y * game.TS,
      level = progress >= 0.74 ? 3 : progress >= 0.44 ? 2 : 1,
      top = y + 8 - level * 4;
    // Side scaffolding leaves the centre door and road approach unobstructed.
    sceneLine(g, 0x87613d, 1, x + 2, y + 18, x + 2, top);
    sceneLine(g, 0x87613d, 1, x + 7, y + 18, x + 7, top);
    for (let step = 0; step < level + 2; step++) {
      const sy = y + 15 - step * 4;
      sceneLine(g, 0xc4a16c, 0.7, x + 2, sy, x + 7, sy);
    }
    sceneLine(g, 0xad8456, 1.4, x + 1, top + 1, x + 8, top + 1);
    sceneLine(g, 0x624a30, 0.7, x + 2, y + 17, x + 7, top + 3);
  }
  function drawVillageConstruction(s: SceneLayer, b: Building, progress: number): void {
    drawVillageYard(s, b);
    const stage = villageConstructionStage(progress),
      img = stage === 3 ? game.bldImg(b) : villageSite(b.type, stage);
    s.image(img.img, b.x * game.TS + img.ox, b.y * game.TS + img.oy, img.w, img.h);
    if (stage > 0) drawVillageScaffold(s.g, b, progress);
    drawVillageStock(s, b);
  }
  function drawVillageWorkEffects(s: SceneLayer, b: Building, work: string, now: number): void {
    if (game.z < 0.85 || game.state.paused || game.renderPrefs().reducedMotion) return;
    const phase = (now / 1100 + b.id * 0.23) % 1;
    if (phase > 0.32) return;
    let x = b.x * game.TS + 24,
      y = b.y * game.TS + 16;
    const forge =
        work === 'craft' &&
        (b.type === 'toolsmith' ||
          b.type === 'armory' ||
          b.type === 'smelter' ||
          b.type === 'workshop'),
      saw = b.type === 'sawmill';
    if (!(
      forge ||
      saw ||
      work === 'gather' ||
      work === 'rock' ||
      work === 'mine' ||
      work === 'build'
    ))
      return;
    if (forge) {
      x = b.x * game.TS + 22;
      y = b.y * game.TS + 14;
    }
    if (saw) {
      x = b.x * game.TS + 17.3;
      y = b.y * game.TS + 10.5;
    }
    const g = s.g,
      travel = phase / 0.32;
    for (let particle = 0; particle < 3; particle++) {
      const px = x + (particle - 1) * travel * 4,
        py = y - travel * (forge ? 6 : 3) + travel * travel * 7;
      g.rect(px, py, forge ? 0.8 : 1.1, forge ? 1.5 : 0.7).fill(
        forge
          ? particle % 2
            ? 0xef9f45
            : 0xf8da87
          : { color: 0xd7c194, alpha: 0.6 * (1 - travel) },
      );
    }
  }

  // Test-only view of closure internals; never merged into the runtime.
  if (internals) {
    Object.assign(internals, {
      villageStockPlan,
      drawVillageStock,
      villageConstructionStage,
    });
    Object.defineProperties(internals, {
      villageSites: {
        get: () => villageSites,
        set: (value) => {
          villageSites = value;
        },
        enumerable: true,
      },
    });
  }

  // Live bindings preserve replacement of arrays and mutable subsystem state.
  return {
    villageWorkTime,
    drawVillageYard,
    drawVillageDetails,
    drawVillageConstruction,
    drawVillageWorkEffects,
  };
}

export interface VillageSubsystem {
  villageWorkTime: (b: Building) => number;
  drawVillageYard: (s: SceneLayer, b: Building) => void;
  drawVillageDetails: (s: SceneLayer, b: Building) => void;
  drawVillageConstruction: (s: SceneLayer, b: Building, progress: number) => void;
  drawVillageWorkEffects: (s: SceneLayer, b: Building, work: string, now: number) => void;
}

/** Test-only view of closure internals; never merged into the runtime. */
export interface VillageInternals {
  villageStockPlan: (b: Building) => VillageStockSlot[];
  drawVillageStock: (s: SceneLayer, b: Building) => void;
  villageConstructionStage: (progress: number) => number;
  villageSites: Record<string, Sprite>;
}
