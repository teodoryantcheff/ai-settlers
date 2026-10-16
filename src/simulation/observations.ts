import { eligibleIngredients } from '../gameplay/production-rules.ts';
import type { SimulationStateSubsystem } from './state.ts';
import type {
  CargoSample,
  CargoObservations,
  CargoWindow,
  EconomicFlow,
  EconomicObservations,
  EconomicTotals,
  EconomicWindow,
  Good,
  Inventory,
  ProductionRateWindow,
  ResourceAccounting,
} from '../types.ts';

export const ECONOMIC_FLOWS: readonly EconomicFlow[] = [
  'produced',
  'consumed',
  'inputArrived',
  'outputStored',
  'constructionSpent',
  'contractSpent',
  'upgradeSpent',
  'contractReward',
  'refund',
  'salvage',
  'transferred',
];
export function emptyEconomicTotals(): EconomicTotals {
  return Object.fromEntries(ECONOMIC_FLOWS.map((flow) => [flow, {}])) as EconomicTotals;
}
export function freshCargoObservations(time: number): CargoObservations {
  return { started: time, totals: {}, recent: [{ time, totals: {} }] };
}
export function freshEconomicObservations(time: number): EconomicObservations {
  return {
    cargo: freshCargoObservations(time),
    started: time,
    totals: emptyEconomicTotals(),
    recent: [{ time, totals: emptyEconomicTotals() }],
  };
}

/** A passive ledger on the simulation clock. Report reads never initialize or mutate state. */
export function createObservations(game: ObservationDependencies): ObservationSubsystem {
  let observationData = freshEconomicObservations(game.state.time);
  function recordEconomicFlow(flow: EconomicFlow, good: Good, amount: number) {
    if (amount <= 0) return;
    observationData.totals[flow][good] = (observationData.totals[flow][good] || 0) + amount;
  }
  function recordCargoArrival(good: Good) {
    const cargo = observationData.cargo;
    cargo.totals[good] = (cargo.totals[good] || 0) + 1;
  }
  function cargoWindow(window: ProductionRateWindow): CargoWindow {
    const cargo = observationData.cargo,
      now = game.state.time;
    const baseline: CargoSample =
      window === 'lifetime'
        ? { time: cargo.started, totals: {} }
        : cargo.recent.find(
            (sample) => sample.time >= Math.max(cargo.started, now - window) - 1e-9,
          ) || { time: now, totals: cargo.totals };
    const elapsed = Math.max(0, now - baseline.time),
      totals: Inventory = {},
      rates: Inventory = {};
    for (const good of Object.keys(cargo.totals) as Good[]) {
      const amount = (cargo.totals[good] || 0) - (baseline.totals[good] || 0);
      totals[good] = amount;
      if (elapsed) rates[good] = (amount * 60) / elapsed;
    }
    return { from: baseline.time, to: now, elapsed, available: elapsed > 0, totals, rates };
  }
  function sampleEconomy() {
    const samples = observationData.recent;
    const now = game.state.time;
    if (now - samples[samples.length - 1].time >= 2 - 1e-9)
      samples.push({ time: now, totals: structuredClone(observationData.totals) });
    while (samples.length > 301 || samples[0].time < now - 600 - 1e-9) samples.shift();
    const cargo = observationData.cargo;
    if (now - cargo.recent.at(-1)!.time >= 2 - 1e-9)
      cargo.recent.push({ time: now, totals: { ...cargo.totals } });
    while (cargo.recent.length > 301 || cargo.recent[0].time < now - 600 - 1e-9)
      cargo.recent.shift();
  }
  function economicWindow(window: ProductionRateWindow): EconomicWindow {
    const now = game.state.time;
    const baseline =
      window === 'lifetime'
        ? { time: observationData.started, totals: emptyEconomicTotals() }
        : observationData.recent.find((sample) => sample.time >= now - window - 1e-9) || {
            time: now,
            totals: observationData.totals,
          };
    const elapsed = Math.max(0, now - baseline.time);
    const totals = emptyEconomicTotals(),
      rates = emptyEconomicTotals();
    for (const flow of ECONOMIC_FLOWS)
      for (const good of Object.keys(observationData.totals[flow]) as Good[]) {
        totals[flow][good] =
          (observationData.totals[flow][good] || 0) - (baseline.totals[flow][good] || 0);
        if (elapsed > 0) rates[flow][good] = ((totals[flow][good] || 0) * 60) / elapsed;
      }
    return {
      window,
      from: baseline.time,
      to: now,
      elapsed,
      available: elapsed > 0,
      sampleInterval: window === 'lifetime' ? 0 : 2,
      totals,
      rates,
    };
  }
  function economicHistory(window: 30 | 120 | 600 = 600) {
    return observationData.recent
      .filter((sample) => sample.time >= game.state.time - window - 1e-9)
      .map((sample) => ({ time: sample.time, totals: structuredClone(sample.totals) }));
  }
  function resourceAccounting(good: Good): ResourceAccounting {
    const result: ResourceAccounting = {
      good,
      stored: 0,
      reserved: 0,
      available: 0,
      inTransit: 0,
      producerInputs: 0,
      awaitingCollection: 0,
      otherLocal: 0,
      constructionMaterials: 0,
      physicalGoods: 0,
      reclaimable: 0,
      contributors: [],
    };
    for (const b of game.buildings) {
      const spec = game.BSPEC[b.type];
      const stock = b.stock[good] || 0;
      let stored = 0,
        reserved = 0,
        input = 0,
        output = 0,
        other = 0;
      if (b.done && spec.store) {
        stored = stock;
        reserved = b.reservedStock[good] || 0;
        result.stored += stored;
        result.reserved += reserved;
      } else {
        if (b.done && spec.out === good) {
          output = stock;
          result.awaitingCollection += output;
        } else if (b.done && eligibleIngredients(b, spec)[good]) {
          input = stock;
          result.producerInputs += input;
        } else {
          other = stock;
          result.otherLocal += other;
        }
      }
      const construction = !b.done ? b.got[good] || 0 : 0;
      result.constructionMaterials += construction;
      if (stored || reserved || input || output || other || construction)
        result.contributors.push({
          id: b.id,
          type: b.type,
          x: b.x,
          y: b.y,
          stored,
          reserved,
          input,
          output,
          other,
          construction,
        });
    }
    for (const unit of game.units) if (!unit.dead && unit.carry === good) result.inTransit++;
    for (const job of game.jobs) {
      if (job.kind !== 'transfer' || job.good !== good) continue;
      const collected = game.units.some((unit) => !unit.dead && unit.job === job && unit.carry);
      if (!collected) result.reclaimable++;
    }
    result.available = result.stored - result.reserved;
    result.physicalGoods =
      result.stored +
      result.inTransit +
      result.producerInputs +
      result.awaitingCollection +
      result.otherLocal +
      result.constructionMaterials;
    return result;
  }
  return {
    get observationData() {
      return observationData;
    },
    set observationData(data) {
      observationData = data;
    },
    recordEconomicFlow,
    recordCargoArrival,
    cargoWindow,
    sampleEconomy,
    economicWindow,
    economicHistory,
    resourceAccounting,
  };
}
export interface ObservationSubsystem {
  observationData: EconomicObservations;
  recordCargoArrival: (good: Good) => void;
  cargoWindow: (window: ProductionRateWindow) => CargoWindow;
  recordEconomicFlow: (flow: EconomicFlow, good: Good, amount: number) => void;
  sampleEconomy: () => void;
  economicWindow: (window: ProductionRateWindow) => EconomicWindow;
  economicHistory: (window?: 30 | 120 | 600) => EconomicObservations['recent'];
  resourceAccounting: (good: Good) => ResourceAccounting;
}
export interface ObservationDependencies extends Pick<
  SimulationStateSubsystem,
  'state' | 'buildings' | 'jobs' | 'units' | 'BSPEC'
> {}
