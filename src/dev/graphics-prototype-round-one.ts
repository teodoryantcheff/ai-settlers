/** THROWAWAY: three motion directions on the real map, ?graphicsPrototype&variant=A|B|C.
 * Question: which balance of character, industry and atmosphere deserves production art?
 * Display fixture only: no simulation, saves or gameplay commands. */
import type { GameRuntime } from '../runtime.ts';
import type { DevInternals } from '../app.ts';
import { translate, rotate, scale, type SceneLayer } from '../rendering/scene.ts';
import type { BuildingType } from '../types.ts';
import { requireCanvas2D } from '../rendering/canvas-context.ts';
import manifest from '../../assets/art/prototype/manifest.json';

const variants = [
  {
    key: 'A',
    name: 'Quiet storybook',
    note: 'Two neighbours, unhurried machinery, light passing shade.',
    people: 2,
    pace: 0.65,
    wind: 0.35,
    clouds: 2,
  },
  {
    key: 'B',
    name: 'Busy workshop',
    note: 'Six carriers, purposeful machinery, sparks and sawdust.',
    people: 6,
    pace: 1.25,
    wind: 0.45,
    clouds: 1,
  },
  {
    key: 'C',
    name: 'Breezy countryside',
    note: 'Four carriers, sweeping cloud shadows, grass and drifting seeds.',
    people: 4,
    pace: 0.85,
    wind: 1,
    clouds: 4,
  },
];

export async function mountGraphicsPrototype(game: GameRuntime, internals: DevInternals) {
  const pixi = internals.pixi;
  if (!pixi) throw new Error('Graphics prototype requires development renderer hooks.');
  const load = async (path: string) => {
    const img = new Image();
    img.src = '../assets/art/prototype/' + path;
    await img.decode();
    return img;
  };
  const [carrier, mill] = await Promise.all([
    load(manifest.carrier.source),
    load(manifest.windmill.source),
  ]);
  const prepared = (source: HTMLImageElement, rect: number[]) => {
    const [x, y, w, h] = rect;
    const canvas = game.Acan(w, h);
    requireCanvas2D(canvas, game.reportGraphicsFailure).drawImage(source, x, y, w, h, 0, 0, w, h);
    return canvas;
  };
  const walkers = manifest.carrier.frames.map((rect) => prepared(carrier, rect));
  const body = prepared(mill, manifest.windmill.crop);
  let index = Math.max(
    0,
    variants.findIndex((v) => v.key === new URLSearchParams(location.search).get('variant')),
  );
  let time = 0,
    last = performance.now(),
    paused = false,
    baseline = false,
    working = true;
  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let focus = 'village';
  const cx = 48,
    cy = 46;
  game.closeLayer('start');
  game.state.paused = true;
  game.presentationPrefs.weather = false;
  game.presentationPrefs.reducedMotion = true;
  game.presentationPrefs.clarity = false;
  game.presentationPrefs.quality = 1;
  game.setMuted(true);
  game.units = [];
  game.jobs = [];
  const buildings = (
    [
      ['windmill', cx - 3, cy],
      ['sawmill', cx, cy],
      ['smelter', cx + 3, cy],
    ] as [BuildingType, number, number][]
  ).map(([type, x, y]) => {
    const b = game.newBuilding(type, x, y);
    Object.assign(b, { done: true, constructionProgress: 1 });
    return b;
  });
  game.buildings = buildings;
  for (let y = cy - 5; y <= cy + 6; y++) {
    for (let x = cx - 9; x <= cx + 9; x++) {
      const i = game.idx(x, y);
      const trees = (y < cy - 2 || y > cy + 3) && (x * 7 + y * 3) % 5 === 0;
      Object.assign(game.tiles[i], {
        t: game.GRASS,
        tree: trees ? 3 : 0,
        rock: null,
        deposit: null,
        road: y === cy + 1 || (y === cy && [cx - 3, cx, cx + 3].includes(x)),
      });
      game.emitGameEvent('tileChanged', { index: i });
    }
  }
  game.recomputeTerritory();
  game.staticDirty = true;
  const center = (zoom: number, x = cx + 0.5, y = cy + 0.5) => {
    game.zoomAnim = null;
    game.z = zoom;
    game.cam.x = x * game.TS - game.vw / zoom / 2;
    game.cam.y = y * game.TS - game.vh / zoom / 2;
    game.clampCam();
  };
  game.resize();
  center(3);
  const originalMill = game.ART.bld.windmill;
  if (!originalMill) throw new Error('Missing windmill reference artwork.');
  const prototypeMill = {
    ...originalMill,
    img: body,
    h: 46,
    oy: originalMill.oy + originalMill.h - 46,
  };
  game.ART.bld.windmill = prototypeMill;
  const originalStatus = game.bStatus;
  game.bStatus = (b) => ({ ...originalStatus(b), bad: false });
  const originalWork = game.buildingWorking;
  // The fixture supplies its own machinery; hide unrelated generic worker glyphs.
  game.buildingWorking = (b) => (buildings.includes(b) ? false : originalWork(b));
  game.villageWorkTime = () => time;
  const details = game.drawVillageDetails;
  game.drawVillageDetails = (s, b) => {
    details(s, b);
    if (baseline) return;
    const g = s.g,
      x = b.x * game.TS,
      y = b.y * game.TS;
    const t = working ? time * variants[index].pace : 0;
    if (b.type === 'windmill') {
      g.save();
      translate(g, x + 12, y - 14);
      rotate(g, t / 4300);
      for (let a = 0; a < 4; a++) {
        rotate(g, Math.PI / 2);
        g.moveTo(0, 0).lineTo(0, -23).stroke({ color: 0x674027, width: 1.2 });
        g.poly([1, -7, 7, -7, 7, -23, 1, -23])
          .fill(0xe4cf9a)
          .stroke({ color: 0x87552f, width: 0.8 });
        for (let r = 9; r < 23; r += 3)
          g.moveTo(1, -r).lineTo(7, -r).stroke({ color: 0xa37e4c, width: 0.5 });
        g.moveTo(4, -7).lineTo(4, -23).stroke({ color: 0x9a683e, width: 0.5 });
      }
      g.circle(0, 0, 2.3).fill(0x865b35).stroke({ color: 0xd9bb7b, width: 0.7 });
      g.restore();
    } else if (b.type === 'sawmill') {
      const shift = Math.sin(t / 190) * 2;
      g.roundRect(x + 13 + shift, y + 7, 12, 3.5, 1)
        .fill(0xa7753d)
        .stroke({ color: 0x5d432a, width: 0.5 });
      g.moveTo(x + 17, y + 4)
        .lineTo(x + 17, y + 13)
        .stroke({ color: 0xc8c6b5, width: 1.1 });
      for (let k = 0; k < 5; k++)
        g.moveTo(x + 17, y + 4 + k * 1.8)
          .lineTo(x + 18, y + 5 + k * 1.8)
          .stroke({ color: 0xe4dfc8, width: 0.6 });
      if (working && !reduced)
        for (let k = 0; k < 5; k++) {
          const phase = (t / 700 + k / 5) % 1;
          g.rect(x + 18 + phase * 7, y + 10 + phase * phase * 6 - k * 0.5, 0.8, 0.7).fill({
            color: 0xe2c398,
            alpha: 1 - phase,
          });
        }
    } else if (b.type === 'smelter') {
      const pulse = working ? 0.6 + Math.sin(t / 230) * 0.16 : 0.08;
      g.ellipse(x + 10, y + 4, 3.5, 2.5).fill({ color: 0xffad38, alpha: pulse });
      g.save();
      translate(g, x + 23, y + 9);
      scale(g, 1, working ? 0.75 + Math.sin(t / 420) * 0.2 : 0.65);
      g.poly([0, 0, 7, -3, 9, 0, 7, 3]).fill(0x754532).stroke({ color: 0xb68b53, width: 0.7 });
      g.restore();
      if (working && !reduced)
        for (let k = 0; k < 4; k++) {
          const phase = (t / 1300 + k / 4) % 1;
          g.circle(x + 10 + Math.sin(k * 9 + phase * 4) * 2, y + 2 - phase * 9, 0.45).fill({
            color: 0xffd889,
            alpha: 1 - phase,
          });
        }
    }
  };
  // Prepaint cloud lobes once. Every moving frame reuses their GPU textures.
  const cloud = game.Acan(256, 128),
    shadow = game.Acan(256, 128);
  for (const [canvas, color] of [
    [cloud, '255,249,229'],
    [shadow, '35,49,47'],
  ] as const) {
    const g = requireCanvas2D(canvas, game.reportGraphicsFailure);
    for (let k = 0; k < 7; k++) {
      const x = 36 + k * 29,
        y = 65 + Math.sin(k * 2.1) * 13,
        r = 29 + (k % 3) * 7;
      const gradient = g.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, `rgba(${color},0.25)`);
      gradient.addColorStop(0.55, `rgba(${color},0.14)`);
      gradient.addColorStop(1, `rgba(${color},0)`);
      g.fillStyle = gradient;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  const layer = pixi.presentation.layer;
  function carriers(s: SceneLayer) {
    const v = variants[index];
    for (let n = 0; n < v.people; n++) {
      const phase = ((time / 22000) * v.pace + n / v.people) % 1;
      const outbound = phase < 0.5;
      const progress = outbound ? phase * 2 : (1 - phase) * 2;
      const x = (cx - 4 + progress * 8) * game.TS,
        y = (cy + 1.5 + (n % 2) * 0.25) * game.TS;
      const frame = reduced ? 0 : Math.floor((time / 160) * v.pace + n) % 4;
      s.image(game.ART.shadowSoft, x - 6, y - 2, 12, 4, 0.6);
      const g = s.g;
      g.save();
      translate(g, x, y);
      scale(g, outbound ? 1 : -1, 1);
      if (baseline) {
        const old = game.ART.unitDirections.carrier?.e;
        if (old) s.image(old.walk[frame * 2], -7.5, -18, 15, 19);
        const cargo = game.ART.cargo.planks;
        if (outbound && cargo) s.image(cargo, -2, -13, 10, 7.5);
      } else {
        const img = walkers[frame + (outbound ? 4 : 0)];
        s.image(img, ((-img.width / 514) * 22) / 2, -22, (img.width / 514) * 22, 22);
      }
      g.restore();
    }
  }
  pixi.presentation.layer = (name, paint) =>
    layer(name, (s) => {
      paint(s);
      const v = variants[index];
      if (name === 'ground-effects' && !baseline) {
        for (let k = 0; k < v.clouds; k++) {
          const x = (cx - 10) * game.TS + (((time / 150) * v.wind + k * 210) % 900);
          s.image(shadow, x, (cy - 2 + k * 1.4) * game.TS, 240, 100, 0.55);
        }
        const g = s.g;
        for (let n = 0; n < 70; n++) {
          const x = (cx - 6) * game.TS + ((n * 71) % 580),
            y = (cy + 2.6) * game.TS + ((n * 19) % 85);
          const sway = reduced ? 0 : Math.sin(time / 900 + n * 0.6) * v.wind * 2;
          g.moveTo(x, y)
            .quadraticCurveTo(x + sway, y - 3, x + sway + 1, y - 5)
            .stroke({ color: n % 3 ? 0x778849 : 0xb0ad68, width: 0.6, alpha: 0.7 });
        }
      }
      if (name === 'objects') carriers(s);
      if (name === 'foreground-effects' && !baseline) {
        for (let k = 0; k < v.clouds; k++) {
          const x = (cx - 10) * game.TS + (((time / 150) * v.wind + k * 210) % 900);
          s.image(cloud, x - 45, (cy - 4 + k * 1.4) * game.TS, 220, 100, index === 2 ? 0.7 : 0.25);
        }
        if (index === 2)
          for (let n = 0; n < 16; n++) {
            const x = (cx - 6) * game.TS + ((n * 51 + time / 180) % 600),
              y = (cy - 2) * game.TS + n * 9 + Math.sin(time / 1800 + n) * 4;
            s.g.ellipse(x, y, 0.8, 0.4).fill({ color: 0xf7e4ae, alpha: 0.65 });
          }
      }
    });
  const draw = game.draw;
  game.draw = () => {
    const now = performance.now();
    if (!paused && !reduced) time += Math.min(50, now - last);
    last = now;
    draw();
  };
  const style = document.createElement('style');
  style.textContent = `#graphics-prototype{position:fixed;z-index:10000;inset:0;pointer-events:none;font:14px/1.5 system-ui;color:#f5ead2} #graphics-prototype section,#graphics-prototype nav{pointer-events:auto;background:#202921f2;border:1px solid #c6b78566;box-shadow:0 8px 35px #0005;border-radius:14px;padding:18px} #graphics-prototype section{position:absolute;left:20px;top:80px;width:290px} #graphics-prototype h2{font:23px Georgia;margin:5px 0 10px} #graphics-prototype p{margin:8px 0;color:#d2c9ae} #graphics-prototype small{color:#b9ba8b;letter-spacing:1px} #graphics-prototype button{font:inherit;background:#3d4937;color:#fff1cd;border:1px solid #a39c7466;border-radius:7px;padding:7px 10px;cursor:pointer} #graphics-prototype button[aria-pressed=true]{background:#c9ad6e;color:#20291d} #graphics-prototype .row{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0} #graphics-prototype nav{position:absolute;bottom:22px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:15px;white-space:nowrap} #graphics-prototype output{display:block;font:11px/1.6 monospace;white-space:pre-wrap;color:#bdc8b2} #map-modes,#minimap-wrap,#atlas,#inspector{visibility:hidden} @media(max-width:700px){#graphics-prototype section{top:70px;left:8px;width:220px;padding:10px} #graphics-prototype nav{bottom:8px;padding:10px;gap:7px}}`;
  document.head.append(style);
  const ui = document.createElement('div');
  ui.id = 'graphics-prototype';
  document.body.append(ui);
  function render() {
    const v = variants[index];
    game.ART.bld.windmill = baseline ? originalMill : prototypeMill;
    const params = new URLSearchParams(location.search);
    params.set('variant', v.key);
    history.replaceState(null, '', '?' + params);
    ui.innerHTML = `<section><small>THROWAWAY GRAPHICS STUDY</small><h2>${v.name}</h2><p>${v.note}</p><div class="row"><button data-action="baseline" aria-pressed="${baseline}">Original art</button><button data-action="pause" aria-pressed="${paused}">${paused ? 'Play' : 'Pause'}</button></div><div class="row"><button data-action="working" aria-pressed="${working}">Industry ${working ? 'on' : 'off'}</button><button data-action="reduced" aria-pressed="${reduced}">Reduced motion</button></div><div class="row"><button data-action="village">Village</button><button data-action="normal">Normal zoom</button><button data-action="carrier">Carrier close-up</button></div><p>Compare the same colony. Carriers follow a display loop; the economy is paused. No saves.</p><output>${JSON.stringify({ variant: v.key, carriers: v.people, pace: v.pace, wind: v.wind, clouds: v.clouds, working, paused, reduced, baseline, focus }, null, 2)}</output><p style="font-size:11px">Draft art: side-view walk only; generated poses need cleanup before production.</p></section><nav aria-label="Prototype variants"><button data-action="prev" aria-label="Previous variant">←</button><strong>${v.key} · ${v.name}</strong><button data-action="next" aria-label="Next variant">→</button></nav>`;
    console.info('Graphics prototype', {
      variant: v.key,
      ...v,
      working,
      paused,
      reduced,
      baseline,
      focus,
    });
  }
  ui.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest('button')?.dataset.action;
    if (!action) return;
    if (action === 'prev' || action === 'next') index = (index + (action === 'next' ? 1 : 2)) % 3;
    if (action === 'baseline') baseline = !baseline;
    if (action === 'pause') paused = !paused;
    if (action === 'working') working = !working;
    if (action === 'reduced') reduced = !reduced;
    if (action === 'village') {
      focus = action;
      center(3);
    }
    if (action === 'normal') {
      focus = action;
      center(1.7);
    }
    if (action === 'carrier') {
      focus = action;
      center(6, cx, cy + 1.5);
    }
    render();
  });
  // Keep host UI visible as scale context, but prevent fixture edits or persistence.
  for (const kind of ['click', 'pointerdown', 'wheel'] as const)
    document.addEventListener(
      kind,
      (event) => {
        if (!(event.target as HTMLElement).closest('#graphics-prototype')) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      { capture: true, passive: false },
    );
  window.addEventListener(
    'keydown',
    (event) => {
      if ((event.target as HTMLElement).closest('input,textarea,[contenteditable]')) return;
      event.stopImmediatePropagation();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        index = (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
        render();
      }
    },
    true,
  );
  render();
}
