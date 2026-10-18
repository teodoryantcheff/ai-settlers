/** THROWAWAY: Round two: integrated activity and planted-foot gait, ?graphicsPrototype&variant=D|E|F.
 * Question: which balance of character, industry and atmosphere deserves production art?
 * Display fixture only: no simulation, saves or gameplay commands. */
import type { GameRuntime } from '../runtime.ts';
import type { DevInternals } from '../app.ts';
import { translate, rotate, scale, type SceneLayer } from '../rendering/scene.ts';
import type { BuildingType } from '../types.ts';
import { requireCanvas2D } from '../rendering/canvas-context.ts';
import { paintCarrier, type CarrierParts } from './graphics-prototype-rig.ts';
import manifest from '../../assets/art/prototype/manifest.json';

const variants = [
  {
    key: 'D',
    name: 'Quiet craft',
    note: 'Painted sails, chimney breath and firelight. Activity stays inside the original artwork.',
    people: 4,
    pace: 1,
    wind: 0.35,
    clouds: 2,
  },
  {
    key: 'E',
    name: 'Working machinery',
    note: 'A moving saw in the existing bench, cut-synchronised sawdust and furnace draught.',
    people: 4,
    pace: 1,
    wind: 0.35,
    clouds: 2,
  },
  {
    key: 'F',
    name: 'People at work',
    note: 'Workers tend the bench and furnace; carriers pause to load and unload, then take shorter steps under load.',
    people: 4,
    pace: 1,
    wind: 0.35,
    clouds: 2,
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
  const [mill, rotorImage, rigImage] = await Promise.all([
    load(manifest.windmill.source),
    load(manifest.rotor.source),
    load(manifest.rig.source),
  ]);
  const prepared = (source: HTMLImageElement, rect: number[]) => {
    const [x, y, w, h] = rect;
    const canvas = game.Acan(w, h);
    requireCanvas2D(canvas, game.reportGraphicsFailure).drawImage(source, x, y, w, h, 0, 0, w, h);
    return canvas;
  };
  const rotor = prepared(rotorImage, manifest.rotor.crop);
  const parts = Object.fromEntries(
    Object.entries(manifest.rig.parts).map(([key, rect]) => [key, prepared(rigImage, rect)]),
  ) as CarrierParts;
  const body = prepared(mill, manifest.windmill.crop);
  let index = Math.max(
    0,
    variants.findIndex((v) => v.key === new URLSearchParams(location.search).get('variant')),
  );
  let industryTime = 0;
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
  // All effect anchors are measured in the original painted images, then fitted
  // with the same bottom-aligned aspect-preserving rule as the production pack.
  function anchor(type: 'sawmill' | 'smelter', px: number, py: number) {
    const img = game.ART.bld[type];
    if (!img) throw new Error('Missing activity artwork');
    const [w, h] = type === 'sawmill' ? [312, 262] : [310, 315];
    const r = Math.min(img.w / w, img.h / h);
    return { x: img.ox + (img.w - w * r) / 2 + px * r, y: img.oy + img.h - h * r + py * r };
  }
  const ember = game.Acan(64, 64),
    puff = game.Acan(64, 64);
  for (const [canvas, rgb] of [
    [ember, '255,148,38'],
    [puff, '181,170,148'],
  ] as const) {
    const ctx = requireCanvas2D(canvas, game.reportGraphicsFailure);
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
    gradient.addColorStop(0, `rgba(${rgb},0.65)`);
    gradient.addColorStop(0.45, `rgba(${rgb},0.28)`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  const details = game.drawVillageDetails;
  game.drawVillageDetails = (s, b) => {
    details(s, b);
    if (baseline) return;
    const x = b.x * game.TS,
      y = b.y * game.TS,
      t = industryTime;
    if (b.type === 'windmill') {
      const g = s.g;
      g.save();
      translate(g, x + 12, y - 14);
      // Opposite to round one's clockwise rotor; fixed hub and painted sails.
      rotate(g, -t / 7500);
      s.image(rotor, -24, -24, 48, 48);
      g.restore();
      return;
    }
    if (b.type !== 'sawmill' && b.type !== 'smelter') return;
    const type = b.type;
    const fire = anchor('smelter', 142, 208);
    const bench = anchor('sawmill', 192, 178);
    const chimney = type === 'smelter' ? anchor(type, 222, 15) : anchor(type, 83, 15);
    if (working) {
      // Soft smoke begins at the chimney lip, never at a generic tile position.
      for (let k = 0; k < 4; k++) {
        const phase = (t / 3400 + k / 4) % 1;
        const size = 2 + phase * 5;
        s.image(
          puff,
          x + chimney.x + phase * 2 - size / 2,
          y + chimney.y - phase * 12 - size / 2,
          size,
          size * 1.3,
          Math.sin(phase * Math.PI) * 0.22,
        );
      }
    }
    if (type === 'smelter') {
      const flicker = working ? 0.32 + Math.sin(t / 137) * 0.035 + Math.sin(t / 311) * 0.055 : 0.03;
      s.image(ember, x + fire.x - 3.4, y + fire.y - 2.8, 6.8, 5.6, flicker);
      if (index > 0 && working) {
        // Tiny embers rise only inside the mouth, then disappear under its arch.
        const g = s.g;
        for (let k = 0; k < 3; k++) {
          const phase = (t / 1400 + k / 3) % 1;
          g.circle(x + fire.x + (k - 1) * 0.7, y + fire.y + 0.7 - phase * 2.7, 0.15).fill({
            color: 0xffd287,
            alpha: 0.7 * (1 - phase),
          });
        }
        s.image(ember, x + fire.x - 3, y + fire.y + 2, 6, 2.5, 0.12 + Math.sin(t / 800) * 0.03);
      }
    } else {
      const g = s.g;
      if (index === 1) {
        // Thin saw emerges from the existing shadowed opening into its painted log.
        const travel = Math.sin(t / 210) * 0.7;
        g.moveTo(x + bench.x, y + bench.y - 1.8 + travel)
          .lineTo(x + bench.x, y + bench.y + 1.5 + travel)
          .stroke({ color: 0xaca998, width: 0.5 });
        for (let k = 0; k < 4; k++)
          g.moveTo(x + bench.x, y + bench.y - 1.5 + travel + k * 0.7)
            .lineTo(x + bench.x + 0.35, y + bench.y - 1.2 + travel + k * 0.7)
            .stroke({ color: 0xd4ccb2, width: 0.25 });
      }
      if (working && !reduced)
        for (let k = 0; k < (index === 0 ? 2 : 5); k++) {
          const phase = (t / 840 + k / 5) % 1;
          if (phase > 0.6) continue;
          g.rect(x + bench.x + phase * 2.5, y + bench.y + 1 + phase * phase * 3, 0.25, 0.2).fill({
            color: 0xc5a26c,
            alpha: (1 - phase) * 0.55,
          });
        }
    }
    if (index === 2) {
      const work = type === 'sawmill' ? anchor(type, 233, 260) : anchor(type, 190, 309);
      const g = s.g;
      g.save();
      translate(g, x + work.x, y + work.y);
      scale(g, 0.57, 0.57);
      paintCarrier(
        s,
        parts,
        0,
        0,
        working ? t / 300 : 0,
        -1,
        false,
        index,
        true,
        type === 'sawmill' ? 'saw' : 'poker',
      );
      g.restore();
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
    const distanceAcross = 8 * game.TS;
    for (let n = 0; n < v.people; n++) {
      // Same route and density for a fair comparison. F adds a loading dwell.
      const legDuration = 12000;
      const dwell = index === 2 ? 1200 : 0;
      const duration = 2 * (legDuration + dwell);
      const elapsed = (time + (n * duration) / v.people) % duration;
      const outbound = elapsed < legDuration + dwell;
      const legTime = outbound ? elapsed : elapsed - legDuration - dwell;
      const moving = legTime < legDuration;
      const progress = Math.min(1, legTime / legDuration);
      const distance = progress * distanceAcross;
      const x = (cx - 4) * game.TS + (outbound ? distance : distanceAcross - distance);
      const y = (cy + 1.5 + (outbound ? 0 : 0.35)) * game.TS;
      s.image(game.ART.shadowSoft, x - 5, y - 1.5, 10, 3, 0.4);
      if (baseline) {
        const g = s.g;
        g.save();
        translate(g, x, y);
        scale(g, outbound ? 1 : -1, 1);
        const old = game.ART.unitDirections.carrier?.e;
        if (old) s.image(old.walk[Math.floor(distance / 3) % 8], -7.5, -18, 15, 19);
        g.restore();
      } else {
        paintCarrier(s, parts, x, y, distance, outbound ? 1 : -1, outbound, index, !moving);
      }
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
          s.image(cloud, x - 45, (cy - 4 + k * 1.4) * game.TS, 220, 100, 0.22);
        }
      }
    });
  const draw = game.draw;
  game.draw = () => {
    const now = performance.now();
    if (!paused && !reduced) {
      const delta = Math.min(50, now - last);
      time += delta;
      if (working) industryTime += delta;
    }
    last = now;
    draw();
  };
  const style = document.createElement('style');
  style.textContent = `#graphics-prototype{position:fixed;z-index:10000;inset:0;pointer-events:none;font:14px/1.5 system-ui;color:#f5ead2} #graphics-prototype section,#graphics-prototype nav{pointer-events:auto;background:#202921f2;border:1px solid #c6b78566;box-shadow:0 8px 35px #0005;border-radius:14px;padding:18px} #graphics-prototype section{position:absolute;left:20px;top:80px;width:290px;max-height:calc(100vh - 180px);overflow:auto} #graphics-prototype h2{font:23px Georgia;margin:5px 0 10px} #graphics-prototype p{margin:8px 0;color:#d2c9ae} #graphics-prototype small{color:#b9ba8b;letter-spacing:1px} #graphics-prototype button{font:inherit;background:#3d4937;color:#fff1cd;border:1px solid #a39c7466;border-radius:7px;padding:7px 10px;cursor:pointer} #graphics-prototype button[aria-pressed=true]{background:#c9ad6e;color:#20291d} #graphics-prototype .row{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0} #graphics-prototype nav{position:absolute;bottom:22px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:15px;white-space:nowrap} #graphics-prototype output{display:block;font:11px/1.6 monospace;white-space:pre-wrap;color:#bdc8b2} #map-modes,#minimap-wrap,#atlas,#inspector{visibility:hidden} @media(max-width:700px){#graphics-prototype section{top:70px;left:8px;width:220px;padding:10px} #graphics-prototype nav{bottom:8px;padding:10px;gap:7px}}`;
  document.head.append(style);
  const ui = document.createElement('div');
  ui.id = 'graphics-prototype';
  document.body.append(ui);
  function render() {
    const v = variants[index];
    game.ART.bld.windmill = baseline ? originalMill : prototypeMill;
    const params = new URLSearchParams(location.search);
    params.set('variant', v.key);
    params.set('round', '2');
    history.replaceState(null, '', '?' + params);
    ui.innerHTML = `<section><small>ROUND TWO · GRAPHICS STUDY</small><h2>${v.name}</h2><p>${v.note}</p><div class="row"><button data-action="baseline" aria-pressed="${baseline}">Original art</button><button data-action="pause" aria-pressed="${paused}">${paused ? 'Play' : 'Pause'}</button></div><div class="row"><button data-action="working" aria-pressed="${working}">Industry ${working ? 'on' : 'off'}</button><button data-action="reduced" aria-pressed="${reduced}">Reduced motion</button></div><div class="row"><button data-action="village">Village</button><button data-action="normal">Normal zoom</button><button data-action="carrier">Carrier close-up</button><button data-action="industry">Industry close-up</button></div><p>Compare the same colony. Carriers follow a display loop; the economy is paused. No saves.</p><details><summary>Comparison state</summary><output>${JSON.stringify({ variant: v.key, carriers: v.people, pace: v.pace, wind: v.wind, clouds: v.clouds, rotation: 'counter-clockwise', gait: 'planted feet', working, paused, reduced, baseline, focus }, null, 2)}</output></details><p style="font-size:11px">Counter-clockwise painted sails. Grounded, jointed walk. Side-view prototype only. <a href="?uitest&graphicsPrototype&round=1&variant=A" style="color:#e9d499">Review round one</a></p></section><nav aria-label="Prototype variants"><button data-action="prev" aria-label="Previous variant">←</button><strong>${v.key} · ${v.name}</strong><button data-action="next" aria-label="Next variant">→</button></nav>`;
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
    if (action === 'industry') {
      focus = action;
      center(5, cx + 0.7, cy + 0.1);
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
