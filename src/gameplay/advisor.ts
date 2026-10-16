import { countsAsWell, hasWellCoverage, wellRadius, wellReaches } from './colony-rules.ts';
import { ingredientAlternatives, ingredientShortages } from './production-rules.ts';
import type { SimulationStateSubsystem } from '../simulation/state.ts';
import type { WorldSubsystem } from '../core/world.ts';
import type { EconomySubsystem } from '../simulation/economy.ts';
import type { ProgressionSubsystem } from './progression.ts';
import type { NavigationSubsystem } from '../simulation/navigation.ts';
import type { MapSubsystem } from '../simulation/map.ts';
import type { Building, BuildingType, Good } from '../types.ts';
/** Advisor recommendation row: a building-type target with counts and rationale. */
export interface AdvTarget {
  bt: BuildingType;
  have: number;
  site: number;
  target: number;
  why: string;
  def: number;
  waiting?: Building | null;
}

/** What the advisor wants to show: an action, a waiting outpost, or a bottleneck. */
export interface AdvisorDecision {
  action?: AdvTarget;
  bottleneck?: Building;
  missing?: Good;
  shortage?: boolean;
  waiting?: Building | null;
}

export function createAdvisor(game: AdvisorDependencies): AdvisorSubsystem {
  function advTargets() {
    var counts: Partial<Record<BuildingType, number>> = {},
      countsSite: Partial<Record<BuildingType, number>> = {},
      mines = 0,
      foodRate = 0,
      far = false;
    for (var b of game.buildings) {
      if (b.exhausted || b.norock) continue;
      var c = b.done ? counts : countsSite;
      c[b.type] = (c[b.type] || 0) + 1;
      if (b.done && !b.exhausted && game.BSPEC[b.type].prod === 'mine') {
        mines++;
        foodRate += 1 / game.BSPEC[b.type].time;
      }
      var store = game.nearestStoragePos(b.x, b.y);
      if (store && Math.hypot(b.x - store.x, b.y - store.y) > 14) far = true;
    }
    var have = function (bt: BuildingType) {
      return (counts[bt] || 0) + (countsSite[bt] || 0);
    };
    var coast = false;
    if (!have('fisherman')) {
      for (var i = 0; i < game.tiles.length && !coast; i++)
        if (
          game.owned[i] &&
          game.passI(i) &&
          game.canPlace('fisherman', i % game.W, (i / game.W) | 0)[0]
        )
          coast = true;
    } else coast = true;
    var enoughTimber = have('lumberjack') && have('sawmill');
    var neededFood = Math.max(1, Math.ceil(foodRate * 1.3 * (coast ? 9 : 15)));
    var breadChains = have('well') ? Math.min(have('farm'), have('windmill'), have('bakery')) : 0;
    var foodCount = have('fisherman') + breadChains + Math.min(have('pigfarm'), have('butcher'));
    var foundations = enoughTimber && foodCount && have('quarry');
    var needMetal =
      foundations &&
      (game.totalGood('tools') < Math.max(10, game.stockTargetTotal('tools')) ||
        game.totalGood('weapons') < Math.max(3, game.stockTargetTotal('weapons')));
    var breadTarget = coast
      ? foundations || have('bakery') || have('windmill')
        ? 1
        : 0
      : neededFood;
    breadTarget += Math.min(3, Math.ceil(game.stockTargetTotal('bread') / 12));
    var unwatered = game.buildings.filter(function (b) {
      return game.BSPEC[b.type].water && !hasWellCoverage(game, b, 'planned');
    }).length;
    var breweryTarget = foundations && have('farm') && have('well') ? 1 : have('brewery');
    var waterTarget = Math.max(
      have('well') + unwatered,
      Math.ceil((breadTarget + breweryTarget) / 3),
    );
    // A well can serve several producers, but its service neighborhood may
    // fill up before the target is met. Request another service area when no
    // remaining consumer can be placed beside an existing or planned well.
    var waterConsumer: BuildingType | null =
      breadTarget > have('bakery') ? 'bakery' : breweryTarget > have('brewery') ? 'brewery' : null;
    if (waterConsumer && have('well') && waterTarget <= have('well')) {
      var serviceSpace = false,
        radius = wellRadius(game);
      for (var well of game.buildings) {
        if (!countsAsWell(well, 'planned')) continue;
        for (var wy = well.y - radius; wy <= well.y + radius && !serviceSpace; wy++)
          for (var wx = well.x - radius; wx <= well.x + radius && !serviceSpace; wx++)
            if (
              game.inB(wx, wy) &&
              wellReaches(game, well, wx, wy) &&
              game.canPlace(waterConsumer, wx, wy)[0]
            )
              serviceSpace = true;
        if (serviceSpace) break;
      }
      if (!serviceSpace) waterTarget = have('well') + 1;
    }
    var rows: Array<[BuildingType, number, string]> = [
      [
        'lumberjack',
        Math.max(1, Math.ceil((have('sawmill') * 7) / 8)),
        'Logs supply the sawmill and keep construction moving.',
      ],
      [
        'sawmill',
        have('lumberjack') ? Math.max(1, Math.floor((have('lumberjack') * 8) / 7)) : 0,
        'Turns two logs into one plank every eight seconds.',
      ],
      ['forester', have('lumberjack'), 'Replants within the lumberjack’s reach so timber lasts.'],
      ['quarry', enoughTimber ? 1 : 0, 'Replenish the stone spent on expansion.'],
      [
        'workshop',
        enoughTimber ? 1 : 0,
        'Makes basic tools from planks and stone, keeping expansion possible before smelting.',
      ],
      [
        'fisherman',
        coast ? Math.max(have('fisherman'), neededFood - breadChains) : 0,
        'Fish feed mines directly. Allow spare capacity for delivery delays.',
      ],
      [
        'farm',
        breadTarget + have('pigfarm') + have('brewery') + (foundations ? 1 : 0),
        'Grain supplies windmills, pig farms and breweries; grain itself does not feed mines.',
      ],
      ['windmill', Math.max(breadTarget, have('bakery')), 'Mill grain into flour for the bakery.'],
      [
        'well',
        waterTarget,
        `Bakery and brewery need an enabled well within ${wellRadius(game)} tiles.`,
      ],
      ['bakery', breadTarget, 'Bake flour into bread with nearby well service to feed mines.'],
      [
        'brewery',
        breweryTarget,
        'Brew grain with nearby well service for the optional harvest feast contract.',
      ],
      ['pigfarm', have('butcher'), 'Raise pigs from grain for the butcher.'],
      ['butcher', have('pigfarm'), 'Turn pigs into meat that feeds mines.'],
      [
        'mine_gold',
        foundations ? 2 : 0,
        'Gold deliveries grow the treasury toward ' + game.GOAL + ' coins.',
      ],
      ['mine_iron', needMetal ? 1 : have('mine_iron'), 'Mine iron ore for the smelter.'],
      [
        'mine_coal',
        needMetal ? 1 : have('mine_coal'),
        'Coal fuels smelting and weapon production.',
      ],
      [
        'smelter',
        have('mine_iron') && have('mine_coal') ? 1 : have('smelter'),
        'Smelt iron ore and coal into iron bars.',
      ],
      [
        'toolsmith',
        have('smelter') ? 1 : have('toolsmith'),
        'Iron bars and planks replace tools spent on construction.',
      ],
      [
        'armory',
        have('smelter') ? 1 : have('armory'),
        'Iron bars and coal supply weapons for outposts.',
      ],
      ['warehouse', far || mines >= 2 ? 1 : 0, 'Shorten long hauls and add eight carrier places.'],
    ];
    var list: AdvTarget[] = [];
    for (var row of rows) {
      var bt = row[0],
        target = row[1];
      if (target > 0)
        list.push({
          bt: bt,
          have: counts[bt] || 0,
          site: countsSite[bt] || 0,
          target: target,
          why: row[2],
          def: Math.max(0, target - have(bt)),
        });
    }
    var wanted = list.filter(function (r) {
      return r.def > 0 && game.BSPEC[r.bt].resKind;
    });
    var needExpand = false;
    for (var r of wanted) {
      var accessible = false;
      for (var ti = 0; ti < game.tiles.length && !accessible; ti++) {
        var tile = game.tiles[ti];
        if (!tile.res || tile.res.kind !== game.BSPEC[r.bt].resKind || tile.res.amt <= 0) continue;
        for (var d = 0; d < 8; d++) {
          var x = (ti % game.W) + game.DX[d],
            y = ((ti / game.W) | 0) + game.DY[d];
          if (game.inB(x, y) && game.canPlace(r.bt, x, y)[0]) {
            accessible = true;
            break;
          }
        }
      }
      if (!accessible) needExpand = true;
    }
    if (needExpand || have('guard'))
      list.push({
        bt: 'guard',
        have: counts.guard || 0,
        site: countsSite.guard || 0,
        target: have('guard') + (needExpand && !game.pendingOutpost() ? 1 : 0),
        why: 'Expand toward a wanted deposit, then wait for the soldier to arrive.',
        def: needExpand && !game.pendingOutpost() ? 1 : 0,
        waiting: needExpand ? game.pendingOutpost() : null,
      });
    var lesson = game.currentLesson(),
      preferred = lesson && lesson.step.building;
    list.sort(function (a, b) {
      var ap = a.def > 0 ? (a.bt === preferred ? 100 : 20) : 0,
        bp = b.def > 0 ? (b.bt === preferred ? 100 : 20) : 0;
      return bp - ap;
    });
    return list;
  }
  function advisorDecision() {
    var list = advTargets(),
      action = list.find(function (r) {
        return r.def > 0;
      });
    if (
      game.buildings.some(function (b) {
        return b.done && !b.disabled && b.blockedReason === 'water';
      })
    ) {
      var water = list.find(function (row) {
        return row.bt === 'well' && row.def > 0;
      });
      if (water) return { action: water };
    }
    var bottleneck: Building | null = null,
      missing: Good | null = null;
    for (var b of game.buildings) {
      var sp = game.BSPEC[b.type],
        good = ingredientShortages(b, sp)[0]?.good;
      if (
        b.done &&
        good &&
        !b.disabled &&
        !['output', 'reserve', 'demand'].includes(b.blockedReason) &&
        b.metrics &&
        b.metrics.elapsed > 30 &&
        b.metrics.inputBlocked / b.metrics.elapsed > 0.35 &&
        !b.exhausted &&
        (!bottleneck ||
          b.metrics.inputBlocked / b.metrics.elapsed >
            bottleneck.metrics.inputBlocked / bottleneck.metrics.elapsed)
      ) {
        bottleneck = b;
        missing = good as Good;
      }
    }
    if (!bottleneck) {
      var expansion = list.find(function (r) {
        return r.waiting;
      });
      return expansion && (!action || game.BSPEC[action.bt].resKind)
        ? { waiting: expansion.waiting }
        : { action: action };
    }
    var alternatives = ingredientAlternatives(game.BSPEC[bottleneck.type], missing);
    var ready = alternatives.reduce(function (sum, good) {
      return sum + game.totalGood(good);
    }, 0);
    for (var source of game.buildings)
      if (alternatives.includes(game.BSPEC[source.type].out))
        ready += source.stock[game.BSPEC[source.type].out] || 0;
    for (var u of game.units) if (alternatives.includes(u.carry)) ready++;
    if (!ready) {
      var supplier = list.find(function (r) {
        return (
          r.def > 0 &&
          (game.BSPEC[r.bt].out === missing ||
            (missing === 'food' &&
              ['fisherman', 'farm', 'windmill', 'well', 'bakery'].includes(r.bt)) ||
            (missing === 'logs' && r.bt === 'forester'))
        );
      });
      if (supplier) return { action: supplier };
      return { bottleneck: bottleneck, missing: missing, shortage: true };
    }
    if (action && (action.bt === 'lumberjack' || action.bt === 'sawmill'))
      return { action: action };
    return { bottleneck: bottleneck, missing: missing, shortage: false };
  }
  return { advTargets, advisorDecision };
}
export interface AdvisorSubsystem {
  advTargets: () => AdvTarget[];
  advisorDecision: () => AdvisorDecision;
}

export interface AdvisorDependencies
  extends
    Pick<SimulationStateSubsystem, 'BSPEC' | 'buildings' | 'units'>,
    Pick<WorldSubsystem, 'DX' | 'DY' | 'GOAL' | 'W' | 'inB' | 'passI' | 'tiles'>,
    Pick<EconomySubsystem, 'canPlace' | 'nearestStoragePos' | 'stockTargetTotal' | 'totalGood'>,
    Pick<ProgressionSubsystem, 'currentLesson' | 'pendingOutpost'>,
    Pick<MapSubsystem, 'owned'>,
    Pick<NavigationSubsystem, 'connectedLand'> {}
