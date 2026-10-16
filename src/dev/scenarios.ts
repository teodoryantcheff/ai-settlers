import type { GameRuntime } from '../runtime.ts';
import type { Building, BuildingType, Good } from '../types.ts';

/** Scenario failure evidence: the message and the frame that threw. */
function failureDetail(e: unknown) {
  return e instanceof Error ? e.message + ' | ' + String(e.stack).split('\n')[1] : String(e);
}

export function runScenarios(game: GameRuntime) {
  if (/[?&]shortagefeedback(?:&|$)/.test(location.search)) {
    // A legacy producer with no suppliers isolates the real persistent-notice path.
    game.closeLayer('start');
    const hq = game.anyStorage();
    const x = hq.x + 4,
      y = hq.y;
    for (let ty = y - 2; ty <= y + 2; ty++)
      for (let tx = x - 2; tx <= x + 2; tx++) {
        const index = game.idx(tx, ty);
        Object.assign(game.tiles[index], { t: game.GRASS, tree: 0, rock: null, res: null });
        game.emitGameEvent('tileChanged', { index });
      }
    const armory = game.newBuilding('armory', x, y);
    Object.assign(armory, {
      done: true,
      prog: 1,
      legacyIndustry: true,
      stock: /[?&]missing=coal(?:&|$)/.test(location.search) ? { iron: 1 } : { coal: 1 },
    });
    hq.stock = {};
    game.buildings = [hq, armory];
    game.units = [];
    game.jobs = [];
    game.serfPool = 0;
    game.recomputeTerritory();
    game.selected = armory;
    game.updateInfo();
    game.setMuted(true);
    game.state.paused = false;
  }
  if (/shot/.test(location.search)) {
    game.closeLayer('start');
    game.state.paused = false;
    const zm = location.search.match(/[?&]z=(\d+)/);
    if (zm) {
      game.zi = Math.max(0, Math.min(game.zooms.length - 1, +zm[1]));
      game.z = game.zooms[game.zi];
    }
    const fc = location.search.match(/[?&]at=(-?\d+),(-?\d+)/);
    if (fc) {
      const fx9 = +fc[1] + 0.5,
        fy9 = +fc[2] + 0.5;
      game.cam.x = fx9 * game.TS - game.vw / game.z / 2;
      game.cam.y = fy9 * game.TS - game.vh / game.z / 2;
      game.clampCam();
    }
  }
  if (/devshot/.test(location.search)) {
    game.closeLayer('start');
    const TYPES: BuildingType[] = [
      'lumberjack',
      'forester',
      'sawmill',
      'quarry',
      'fisherman',
      'farm',
      'mine_gold',
      'toolsmith',
      'armory',
      'warehouse',
      'guard',
    ];
    const cx0 = game.W >> 1,
      cy0 = game.H >> 1;
    let placed = 0;
    for (let ti = 0; ti < TYPES.length; ti++) {
      const bt = TYPES[ti];
      let ps = null;
      for (let ry = cy0 - 8; ry <= cy0 + 8 && !ps; ry++)
        for (let rx = cx0 - 9; rx <= cx0 + 11 && !ps; rx++) {
          if (!game.inB(rx, ry) || Math.hypot(rx - cx0, ry - cy0) < 3.2) continue;
          if (game.canPlace(bt, rx, ry)[0]) ps = [rx, ry];
        }
      if (ps) {
        const nb = game.newBuilding(bt, ps[0], ps[1]);
        nb.done = true;
        nb.prog = 1;
        game.buildings.push(nb);
        placed++;
      }
    }
    // one construction site at 40% (closest to HQ so it lands on camera)
    let siteAt = null,
      bestD = 1e9;
    for (let ry2 = cy0 - 8; ry2 <= cy0 + 8; ry2++)
      for (let rx2 = cx0 - 9; rx2 <= cx0 + 11; rx2++) {
        if (!game.inB(rx2, ry2) || Math.hypot(rx2 - cx0, ry2 - cy0) < 3.4) continue;
        const dd = Math.hypot(rx2 - (cx0 - 2), ry2 - (cy0 - 4));
        if (dd < bestD && game.canPlace('lumberjack', rx2, ry2)[0]) {
          bestD = dd;
          siteAt = [rx2, ry2];
        }
      }
    let nb2: Building;
    if (siteAt) {
      nb2 = game.newBuilding('lumberjack', siteAt[0], siteAt[1]);
      nb2.prog = 0.4;
      nb2.got = { planks: 2, tools: 1 };
      game.buildings.push(nb2);
    }
    game.recomputeTerritory();
    for (let si = 0; si < 6; si++) game.spawnCarrier(game.anyStorage());
    if (/[?&]detail(?:&|$)/.test(location.search)) {
      // Explicit art fixture: show physical stocks and every construction stage.
      // This branch belongs only to the development bundle, never saved real play.
      for (const sample of game.buildings) {
        if (!sample.done) continue;
        const sampleSpec = game.BSPEC[sample.type];
        if (sampleSpec.out) sample.stock[sampleSpec.out] = 6;
        if (sampleSpec.in)
          for (const ingredient in sampleSpec.in) sample.stock[ingredient as Good] = 4;
      }
      const stageMatch = location.search.match(/[?&]stage=(0|1|2|3)(?:&|$)/);
      if (nb2 && stageMatch) nb2.prog = [0.1, 0.4, 0.7, 0.93][+stageMatch[1]];
    }
    // a road for visual inspection
    let ra = null,
      rb = null;
    for (let ry3 = cy0 + 2; ry3 <= cy0 + 3 && !ra; ry3++)
      for (let rx3 = cx0 + 2; rx3 <= cx0 + 8 && !ra; rx3++) {
        if (
          game.inB(rx3, ry3) &&
          game.owned[game.idx(rx3, ry3)] &&
          !game.buildingAt(rx3, ry3) &&
          !game.tiles[game.idx(rx3, ry3)].tree &&
          !game.tiles[game.idx(rx3, ry3)].rock
        )
          ra = { x: rx3, y: ry3 };
      }
    if (ra)
      for (let rx4 = cx0 + 2; rx4 <= cx0 + 9; rx4++) {
        if (
          game.inB(rx4, ra.y + 4) &&
          game.owned[game.idx(rx4, ra.y + 4)] &&
          !game.buildingAt(rx4, ra.y + 4) &&
          !game.tiles[game.idx(rx4, ra.y + 4)].tree &&
          !game.tiles[game.idx(rx4, ra.y + 4)].rock
        ) {
          rb = { x: rx4, y: ra.y + 4 };
          break;
        }
      }
    if (ra && rb) game.commitRoad(ra, rb);
    // camera synchronously: virtual-time freezes rAF, so setTimeout recentering never renders
    if (siteAt && /[?&]focus=site/.test(location.search)) {
      game.cam.x = (siteAt[0] + 0.5) * game.TS - game.vw / game.z / 2;
      game.cam.y = (siteAt[1] + 0.5) * game.TS - game.vh / game.z / 2;
    } else if (!/[?&]at=/.test(location.search)) {
      game.cam.x = (cx0 + 3) * game.TS - game.vw / game.z / 2;
      game.cam.y = cy0 * game.TS - game.vh / game.z / 2;
    }
    game.clampCam();
    game.state.paused = true;
    if (/[?&]adv=0/.test(location.search)) document.getElementById('adv').style.display = 'none';
    const dv = document.createElement('div');
    dv.id = 'devres';
    dv.textContent = 'DEVSHOT placed=' + placed + ' site=' + (siteAt ? siteAt.join(',') : 'none');
    document.body.appendChild(dv);
  }

  if (/[?&]economyshot(?:&|$)/.test(location.search)) {
    game.closeLayer('start');
    game.state.paused = true;
    const previewTypes: BuildingType[] = [
      'farm',
      'windmill',
      'bakery',
      'pigfarm',
      'butcher',
      'well',
      'brewery',
      'smelter',
      'workshop',
      'toolsmith',
    ];
    const centerX = game.W >> 1,
      centerY = game.H >> 1;
    // A development-only display yard keeps each new silhouette inspectable.
    for (let y = centerY - 9; y <= centerY + 9; y++) {
      for (let x = centerX - 14; x <= centerX + 14; x++) {
        const tile = game.tiles[game.idx(x, y)];
        tile.t = game.GRASS;
        tile.tree = 0;
        tile.rock = null;
        tile.res = null;
        tile.road = y === centerY - 3 || y === centerY + 4;
        game.emitGameEvent('tileChanged', { index: game.idx(x, y) });
      }
    }
    previewTypes.forEach((type, index) => {
      const x = centerX - 10 + (index % 5) * 5;
      const y = centerY - 5 + Math.floor(index / 5) * 7;
      const building = game.newBuilding(type, x, y);
      building.done = true;
      building.prog = 1;
      const spec = game.BSPEC[type];
      if (spec.out) building.stock[spec.out] = 4;
      for (const good in spec.in) building.stock[good as Good] = 3;
      game.buildings.push(building);
    });
    game.recomputeTerritory();
    game.cam.x = (centerX + 0.5) * game.TS - game.vw / game.z / 2;
    game.cam.y = (centerY - 1) * game.TS - game.vh / game.z / 2;
    game.clampCam();
    document.getElementById('adv').style.display = 'none';
    game.selected = game.buildings.find((building) => building.type === 'smelter');
    game.updateInfo();
  }

  if (/uitest/.test(location.search)) {
    game.closeLayer('start');
    const uit: string[] = [];
    function tap(el: Element) {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    function viewTap(tx: number, ty: number, button?: number) {
      const r = game.view.getBoundingClientRect();
      const cx = r.left + (tx * game.TS - game.cam.x) * game.z + game.TS / 2,
        cy = r.top + (ty * game.TS - game.cam.y) * game.z + game.TS / 2;
      game.view.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }),
      );
      game.view.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: cx,
          clientY: cy,
          button: button === undefined ? 0 : button,
        }),
      );
      game.view.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: cx,
          clientY: cy,
          button: button === undefined ? 0 : button,
        }),
      );
    }
    setTimeout(function () {
      try {
        const n0 = game.buildings.length;
        let spot = null;
        outer: for (let ty = (game.W >> 1) - 3; ty <= (game.W >> 1) + 3; ty++)
          for (let tx = (game.W >> 1) - 3; tx <= (game.W >> 1) + 3; tx++)
            if (game.canPlace('lumberjack', tx, ty)[0]) {
              spot = [tx, ty];
              break outer;
            }
        if (!spot) {
          uit.push('nospot');
        } else {
          const btn = document.querySelector('.pb[data-b=lumberjack]');
          tap(btn);
          uit.push(
            'mode=' +
              (game.mode && game.mode.type === 'build' && game.mode.bt === 'lumberjack'
                ? 'ok'
                : 'BAD:' + JSON.stringify(game.mode)),
          );
          viewTap(spot[0], spot[1]);
          uit.push('placed=' + (game.buildings.length > n0) + ' n=' + game.buildings.length);
          const n1 = game.buildings.length;
          tap(document.querySelector('.pb[data-b=road]'));
          uit.push('rmode=' + (game.mode && game.mode.type === 'road' ? 'ok' : 'BAD'));
          let r1 = null;
          outer2: for (let ty2 = (game.W >> 1) - 4; ty2 <= (game.W >> 1) + 4; ty2++)
            for (let tx2 = (game.W >> 1) - 4; tx2 <= (game.W >> 1) + 4; tx2++) {
              if (
                game.canPlace('lumberjack', tx2, ty2)[0] &&
                game.canPlace('lumberjack', tx2 + 1, ty2)[0]
              ) {
                r1 = [tx2, ty2];
                break outer2;
              }
            }
          if (r1) {
            viewTap(r1[0], r1[1]);
            viewTap(r1[0] + 1, r1[1]);
            let roadTiles = 0;
            for (let ri = 0; ri < game.tiles.length; ri++) if (game.tiles[ri].road) roadTiles++;
            uit.push('roads=' + (roadTiles >= 2 ? 'ok' : 'BAD:' + roadTiles));
          } else uit.push('roads=BAD:nospot');
          game.cancelMode();
          let lj = null;
          for (let li = 0; li < game.buildings.length; li++)
            if (game.buildings[li].type === 'lumberjack') lj = game.buildings[li];
          if (lj) {
            tap(document.querySelector('.pb[data-b=demolish]'));
            viewTap(lj.x, lj.y);
            const armedOk = game.buildings.length >= n1;
            tap(document.getElementById('demolition-confirm'));
            uit.push('demol=' + (armedOk && game.buildings.length < n1 ? 'ok' : 'BAD'));
          }
          tap(document.querySelector('.pb[data-b=forester]'));
          const modeBefore = game.mode && game.mode.type === 'build' && game.mode.bt === 'forester';
          const r = game.view.getBoundingClientRect();
          game.view.dispatchEvent(
            new MouseEvent('mousedown', {
              bubbles: true,
              clientX: r.left + 200,
              clientY: r.top + 200,
              button: 2,
            }),
          );
          game.view.dispatchEvent(
            new MouseEvent('mousemove', {
              bubbles: true,
              clientX: r.left + 320,
              clientY: r.top + 280,
            }),
          );
          game.view.dispatchEvent(
            new MouseEvent('mouseup', {
              bubbles: true,
              clientX: r.left + 320,
              clientY: r.top + 280,
              button: 2,
            }),
          );
          game.view.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              clientX: r.left + 320,
              clientY: r.top + 280,
            }),
          );
          uit.push(
            'panKeepsMode=' +
              (modeBefore && game.mode && game.mode.type === 'build'
                ? 'ok'
                : 'BAD:' + JSON.stringify(game.mode)),
          );
          game.view.dispatchEvent(
            new MouseEvent('mousedown', {
              bubbles: true,
              clientX: r.left + 300,
              clientY: r.top + 250,
              button: 2,
            }),
          );
          game.view.dispatchEvent(
            new MouseEvent('mouseup', {
              bubbles: true,
              clientX: r.left + 300,
              clientY: r.top + 250,
              button: 2,
            }),
          );
          game.view.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              clientX: r.left + 300,
              clientY: r.top + 250,
            }),
          );
          uit.push('clickCancelsMode=' + (game.mode === null ? 'ok' : 'BAD'));
          const d = document.createElement('div');
          d.id = 'uitres';
          d.textContent =
            'UITEST_' + (uit.join(' ').indexOf('BAD') < 0 ? 'OK' : 'FAIL') + ' | ' + uit.join(' ');
          document.body.appendChild(d);
        }
      } catch (e) {
        const d2 = document.createElement('div');
        d2.id = 'uitres';
        d2.textContent = 'UITEST_ERR ' + failureDetail(e);
        document.body.appendChild(d2);
      }
    }, 100);
  }
  if (/buildrules/.test(location.search)) {
    game.closeLayer('start');
    setTimeout(function () {
      try {
        const out: string[] = [];
        let contr = 0;
        const types: BuildingType[] = [
          'warehouse',
          'lumberjack',
          'forester',
          'sawmill',
          'quarry',
          'fisherman',
          'farm',
          'mine_coal',
          'mine_iron',
          'mine_gold',
          'toolsmith',
          'armory',
          'guard',
        ];
        function spacingOK(x: number, y: number) {
          for (let i = 0; i < game.buildings.length; i++)
            if (Math.hypot(game.buildings[i].x - x, game.buildings[i].y - y) < 1.9) return false;
          return true;
        }
        function auditPhase(tag: string) {
          for (let t = 0; t < types.length; t++) {
            const bt = types[t];
            let legal = 0,
              pred = 0;
            const rej: Record<string, number> = {};
            for (let y = 1; y < game.H - 1; y++)
              for (let x = 1; x < game.W - 1; x++) {
                const i = game.idx(x, y),
                  tl = game.tiles[i];
                if (!game.owned[i] || !spacingOK(x, y) || game.buildingAt(x, y)) continue;
                let landOK = true;
                for (let d = 0; d < 4; d++)
                  if (
                    game.passI(game.idx(x + game.DX[d], y + game.DY[d])) &&
                    !game.owned[game.idx(x + game.DX[d], y + game.DY[d])]
                  ) {
                    landOK = false;
                    break;
                  }
                if (!landOK) continue;
                let specOK = false;
                if (bt === 'fisherman') {
                  if (tl.t !== game.GRASS && tl.t !== game.SAND) continue;
                  let wa = false;
                  for (let wy = y - 2; wy <= y + 2 && !wa; wy++)
                    for (let wx = x - 2; wx <= x + 2 && !wa; wx++)
                      if (game.inB(wx, wy) && game.tiles[game.idx(wx, wy)].t === game.WATER)
                        wa = true;
                  if (wa) specOK = true;
                } else {
                  if (tl.t !== game.GRASS) continue;
                  const sp = game.BSPEC[bt];
                  if (sp.resKind) {
                    let dep = false;
                    for (let dd = 0; dd < 8; dd++) {
                      const mt = game.tiles[game.idx(x + game.DX[dd], y + game.DY[dd])];
                      if (
                        mt.t === game.MTN &&
                        mt.res &&
                        mt.res.kind === sp.resKind &&
                        mt.res.amt > 0
                      )
                        dep = true;
                    }
                    if (!dep) continue;
                  }
                  if (bt === 'quarry') {
                    let found = false;
                    for (let yy = y - 5; yy <= y + 5 && !found; yy++)
                      for (let xx = x - 5; xx <= x + 5 && !found; xx++) {
                        if (!game.inB(xx, yy)) continue;
                        if ((x - xx) * (x - xx) + (y - yy) * (y - yy) > 25) continue;
                        if (game.tiles[game.idx(xx, yy)].rock) found = true;
                      }
                    if (!found) continue;
                  }
                  specOK = true;
                }
                if (!specOK) continue;
                pred++;
                const cp = game.canPlace(bt, x, y);
                if (cp[0]) legal++;
                else {
                  const r3 = cp[1].code;
                  rej[r3] = (rej[r3] | 0) + 1;
                  if (r3 === 'territory' || r3 === 'meadow' || r3 === 'shore-land') contr++;
                }
              }
            const bad = rej.territory || 0;
            out.push(
              tag +
                ':' +
                bt +
                '=' +
                legal +
                '/' +
                pred +
                ' ok' +
                (bad ? ' CONTRADICTION=' + bad : '') +
                (pred === 0 ? ' none' : ''),
            );
          }
        }
        auditPhase('start');
        const hx = game.W >> 1,
          hy = game.H >> 1;
        for (let py = hy - 22; py <= hy + 22; py++)
          for (let px2 = hx - 22; px2 <= hx + 22; px2++)
            if (game.inB(px2, py) && game.passI(game.idx(px2, py)))
              game.owned[game.idx(px2, py)] = 1;
        game.borderDirty = true;
        auditPhase('wide');
        const d = document.createElement('div');
        d.id = 'brres';
        d.textContent =
          'BUILD_RULES ' + (contr === 0 ? 'OK' : 'FAIL(' + contr + ')') + ' | ' + out.join(' | ');
        document.body.appendChild(d);
      } catch (e) {
        const d2 = document.createElement('div');
        d2.id = 'brres';
        d2.textContent = 'BUILD_RULES_ERR ' + failureDetail(e);
        document.body.appendChild(d2);
      }
    }, 100);
  }

  if (/saveload/.test(location.search)) {
    game.closeLayer('start');
    game.state.paused = false;
    function slSum() {
      const s = {
        g: game.state.gold,
        t: Math.round(game.state.time),
        b: game.buildings.length,
        u: game.units.length,
        j: game.jobs.length,
        sp: game.serfPool,
        so: game.soldierPool,
        pl: game.totalGood('planks'),
      };
      let th = 0;
      for (let i2 = 0; i2 < game.tiles.length; i2++) {
        const tl6 = game.tiles[i2];
        th +=
          (tl6.t * 7 +
            tl6.tree * 3 +
            (tl6.rock ? tl6.rock.amt : 0) +
            (tl6.res ? tl6.res.amt : 0) +
            (tl6.road ? 5 : 0)) *
            31 +
          (i2 % 7);
      }
      Object.assign(s, { th });
      let st = 0;
      for (let i2 = 0; i2 < game.buildings.length; i2++)
        for (const k9 in game.buildings[i2].stock) st += game.buildings[i2].stock[k9 as Good] | 0;
      Object.assign(s, { st });
      return JSON.stringify(s);
    }
    let slSn = 0,
      slBefore: string | null = null,
      slSaved = false;
    const slIv = setInterval(function () {
      try {
        if (slSn < 20) game.step(0.25);
        if (slSn === 20) {
          slBefore = slSum();
          slSaved = game.saveGame();
        }
        if (slSn > 20 && slSn < 80) game.step(0.25);
        if (slSn === 80) {
          clearInterval(slIv);
          const mid = slSum();
          const loaded = game.loadGame();
          const after = slSum();
          const ok = slSaved && loaded && slBefore === after && mid !== slBefore;
          const d = document.createElement('div');
          d.id = 'slres';
          d.textContent =
            'SAVELOAD_' +
            (ok ? 'OK' : 'FAIL') +
            ' saved=' +
            slSaved +
            ' loaded=' +
            loaded +
            ' midDiff=' +
            (mid !== slBefore) +
            ' restored=' +
            (slBefore === after) +
            ' before=' +
            slBefore +
            ' mid=' +
            mid +
            ' after=' +
            after;
          document.body.appendChild(d);
        }
        slSn++;
      } catch (e) {
        clearInterval(slIv);
        const d2 = document.createElement('div');
        d2.id = 'slres';
        d2.textContent = 'SAVELOAD_ERR ' + failureDetail(e);
        document.body.appendChild(d2);
      }
    }, 1);
  }
}
