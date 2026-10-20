import type { ObservationSubsystem } from '../simulation/observations.ts';
import type { EconomySubsystem } from '../simulation/economy.ts';
import type { SpendPurpose, StockLedgerSubsystem } from '../simulation/stock-ledger.ts';
import type { SimulationStateSubsystem } from '../simulation/state.ts';
import type { EventsSubsystem } from '../core/events.ts';
import type { Building, BuildingType, Good, Inventory } from '../types.ts';
import { goodsIn, inventoryEntries } from '../core/inventory.ts';

export function createProgression(
  game: ProgressionDependencies,
  internals?: ProgressionInternals,
): ProgressionSubsystem {
  const tutorialSteps: LessonStep[] = [
    {
      title: 'Start the timber chain',
      text: 'Place a Lumberjack where its reach covers mature trees.',
      building: 'lumberjack',
      check: function () {
        return producedTotal('logs') >= 2;
      },
    },
    {
      title: 'Make your own planks',
      text: 'Build a Sawmill near the timber supply. Carriers bring it logs.',
      building: 'sawmill',
      check: function () {
        return producedTotal('planks') >= 1;
      },
    },
    {
      title: 'Connect your settlement',
      text: 'Draw a road between clear tiles near producers and your headquarters.',
      building: 'road',
      check: function () {
        return game.state.roadsBuilt >= 5;
      },
    },
    {
      title: 'Keep the pantry supplied',
      text: 'Catch fish by water, or grow grain, mill flour and bake bread beside a Well. Mines need prepared food.',
      building: 'fisherman',
      check: function () {
        return producedTotal('fish') + producedTotal('bread') + producedTotal('meat') >= 3;
      },
    },
    {
      title: 'Reach the mountains',
      text: 'Build an Outpost toward gold deposits. A soldier extends its border.',
      building: 'guard',
      check: function () {
        return game.buildings.some(function (b) {
          return b.type === 'guard' && b.manned;
        });
      },
    },
    {
      title: 'Bank your first gold',
      text: 'Place a Gold Mine beside a glowing deposit, then connect its haul route.',
      building: 'mine_gold',
      check: function () {
        return game.state.goldDelivered > 0;
      },
    },
  ];
  const contracts: Array<{ name: string; cost: Inventory; reward: Inventory }> = [
    { name: 'Timber for the realm', cost: { planks: 12 }, reward: { tools: 4, gold: 5 } },
    { name: 'A winter provision', cost: { bread: 12 }, reward: { stone: 8, gold: 8 } },
    {
      name: 'Build the market square',
      cost: { planks: 18, stone: 18 },
      reward: { tools: 5, gold: 12 },
    },
    { name: 'Grain for the granary', cost: { grain: 12 }, reward: { stone: 6, gold: 6 } },
    { name: 'Beer for the harvest feast', cost: { beer: 10 }, reward: { tools: 5, gold: 12 } },
    { name: 'Tools for the frontier', cost: { tools: 8 }, reward: { planks: 10, gold: 10 } },
  ];
  function producedTotal(g: Good) {
    let n = 0;
    for (const b of game.buildings) n += (b.metrics && b.metrics.produced[g]) || 0;
    return n;
  }
  function actionAvailability(cost: Inventory): ActionAvailability {
    const materials = inventoryEntries(cost).map(([good, required]) => {
      const accounting = game.resourceAccounting(good);
      const spendable = game.spendableStock(good);
      return {
        good,
        required,
        available: accounting.available,
        spendable,
        reserved: accounting.reserved,
        reclaim: Math.max(
          0,
          Math.min(required - accounting.available, spendable - accounting.available),
        ),
        missing: Math.max(0, required - spendable),
      };
    });
    return { affordable: materials.every((material) => material.missing === 0), materials };
  }
  function spendStock(cost: Inventory, purpose: SpendPurpose = 'contractSpent') {
    if (!game.requestStock(cost)) return false;
    game.withdrawStock(cost, purpose);
    return true;
  }
  function claimContract(index: number) {
    const c = contracts[index];
    if (!c || game.state.contracts.indexOf(index) >= 0) return;
    if (!spendStock(c.cost, 'contractSpent')) {
      game.emitGameEvent('contractRejected', { reason: 'stock' });
      return;
    }
    const store = game.anyStorage();
    if (!store) return;
    for (const g of goodsIn(c.reward))
      game.storeGoods(store, g, c.reward[g] || 0, 'external', 'contractReward');
    game.state.contracts.push(index);
    game.emitGameEvent('contractFulfilled', { index, name: c.name, x: store.x, y: store.y });
  }
  function buyUpgrade(kind: 'haul' | 'production') {
    if (!['haul', 'production'].includes(kind)) return;
    const level = game.state.upgrades[kind] || 0;
    if (level >= 3) return;
    const price = 15 * (level + 1);
    if (!spendStock({ gold: price }, 'upgradeSpent')) {
      game.emitGameEvent('upgradeRejected', { kind, price });
      return;
    }
    game.state.upgrades[kind]++;
    game.emitGameEvent('upgradePurchased', { kind, level: level + 1 });
  }
  function gameTick() {
    // Milestone checks scan every building, so cadence-gate them to roughly once
    // per 0.5 sim-second. The gate is a pure function of sim time, staying correct
    // across save continuation and fast-forward without bookkeeping. The first
    // sim minute remains ungated so early tutorial feedback stays immediate.
    const tickN = Math.floor(game.state.time * 60);
    if (tickN >= 60 && tickN % 30 !== 0) return;
    for (let i = 0; i < tutorialSteps.length; i++)
      if (game.state.milestones.indexOf(i) < 0 && tutorialSteps[i].check()) {
        game.state.milestones.push(i);
        game.emitGameEvent('milestoneReached', { index: i, title: tutorialSteps[i].title });
      }
  }
  function pendingOutpost() {
    return game.buildings.find(function (b) {
      return b.type === 'guard' && !b.manned;
    });
  }
  function currentLesson() {
    for (let i = 0; i < tutorialSteps.length; i++)
      if (game.state.milestones.indexOf(i) < 0) return { step: tutorialSteps[i], index: i };
    return null;
  }
  // Test-only view of closure internals; never merged into the runtime.
  if (internals) {
    Object.assign(internals, { producedTotal, spendStock });
  }

  // Live bindings preserve replacement of arrays and mutable subsystem state.
  return {
    claimContract,
    actionAvailability,
    buyUpgrade,
    gameTick,
    pendingOutpost,
    currentLesson,
    get journeySteps() {
      return tutorialSteps.map(({ title, text, building }) => ({ title, text, building }));
    },
    get contracts() {
      return contracts;
    },
  };
}

/** One tutorial milestone: place a building (or draw road) and verify its effect. */
export interface LessonStep {
  title: string;
  text: string;
  building: BuildingType | 'road';
  check: () => boolean;
}

export interface ActionAvailability {
  affordable: boolean;
  materials: Array<{
    good: Good;
    required: number;
    available: number;
    spendable: number;
    reserved: number;
    reclaim: number;
    missing: number;
  }>;
}
export interface ProgressionSubsystem {
  actionAvailability: (cost: Inventory) => ActionAvailability;
  readonly journeySteps: ReadonlyArray<Pick<LessonStep, 'title' | 'text' | 'building'>>;
  claimContract: (index: number) => void;
  buyUpgrade: (kind: 'haul' | 'production') => void;
  gameTick: () => void;
  pendingOutpost: () => Building | undefined;
  currentLesson: () => {
    step: LessonStep;
    index: number;
  } | null;
  readonly contracts: Array<{ name: string; cost: Inventory; reward: Inventory }>;
}

/** Test-only view of closure internals; never merged into the runtime. */
export interface ProgressionInternals {
  producedTotal: (g: Good) => number;
  spendStock: (cost: Inventory) => boolean;
}

export interface ProgressionDependencies
  extends
    Pick<EconomySubsystem, 'anyStorage' | 'requestStock'>,
    Pick<StockLedgerSubsystem, 'spendableStock' | 'storeGoods' | 'withdrawStock'>,
    Pick<SimulationStateSubsystem, 'buildings' | 'state'>,
    Pick<ObservationSubsystem, 'resourceAccounting'>,
    Pick<EventsSubsystem, 'emitGameEvent'> {}
