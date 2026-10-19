import type { Building, EconomicFlow, Good, Inventory } from '../types.ts';
import type { SimulationStateSubsystem } from './state.ts';
import type { NavigationSubsystem } from './navigation.ts';
import type { EconomySubsystem } from './economy.ts';
import type { ObservationSubsystem } from './observations.ts';

type Place = Pick<Building, 'x' | 'y'>;

/**
 * Where goods entering storage come from, which decides the treasury effect.
 * `storage`: already colony storage stock (transfers, returned cargo, a
 * demolished storehouse's goods), so banked gold stays banked. `producer`:
 * delivered from a producer; gold is banked and counted as delivered.
 * `external`: new to colony storage (rewards, refunds, equipment); gold is banked.
 */
export type StockSource = 'storage' | 'producer' | 'external';

/**
 * Colony stock ledger: the single owner of storage quantities. Stored stock is
 * what a completed storehouse holds; reserved stock is the part of it promised
 * for collection; available stock is the remainder.
 */
export function createStockLedger(game: StockLedgerDependencies): StockLedgerSubsystem {
  function stored(store: Building, good: Good) {
    return (store.stock[good] ?? 0) | 0;
  }
  function reserved(store: Building, good: Good) {
    return (store.reservedStock[good] ?? 0) | 0;
  }
  function availableAt(store: Building, good: Good) {
    return stored(store, good) - reserved(store, good);
  }
  function reachable(store: Building, near: Place | undefined) {
    return !near || game.connectedLand(near.x, near.y, store.x, store.y);
  }
  function storedStock(good: Good) {
    let total = 0;
    for (const store of game.storages()) total += stored(store, good);
    return total;
  }
  function availableStock(good: Good, near?: Place) {
    let total = 0;
    for (const store of game.storages())
      if (reachable(store, near)) total += Math.max(0, availableAt(store, good));
    return total;
  }
  function uncollectedTransfers(store: Building, good: Good) {
    let n = 0;
    for (const job of game.jobs)
      if (job.kind === 'transfer' && job.sourceId === store.id && job.good === good) {
        let collected = false;
        for (const unit of game.units)
          if (unit.job === job && unit.carry) {
            collected = true;
            break;
          }
        if (!collected) n++;
      }
    return n;
  }
  function spendableAt(store: Building, good: Good) {
    return Math.max(
      0,
      Math.min(stored(store, good), availableAt(store, good) + uncollectedTransfers(store, good)),
    );
  }
  function reclaimableStock(good: Good, near?: Place) {
    let total = 0;
    for (const store of game.storages())
      if (reachable(store, near))
        total +=
          spendableAt(store, good) -
          Math.max(0, Math.min(stored(store, good), availableAt(store, good)));
    return total;
  }
  function spendableStock(good: Good, near?: Place) {
    let total = 0;
    for (const store of game.storages())
      if (reachable(store, near)) total += spendableAt(store, good);
    return total;
  }
  function reserveStock(store: Building, good: Good) {
    store.reservedStock[good] = reserved(store, good) + 1;
  }
  function releaseReservation(store: Building, good: Good) {
    store.reservedStock[good] = Math.max(0, reserved(store, good) - 1);
  }
  function moveReservation(from: Building | null, to: Building, good: Good) {
    if (from === to) return;
    if (from) releaseReservation(from, good);
    reserveStock(to, good);
  }
  function collectReserved(store: Building, good: Good) {
    store.stock[good] = stored(store, good) - 1;
    releaseReservation(store, good);
  }
  function storeGoods(
    store: Building,
    good: Good,
    amount: number,
    source: StockSource,
    flow?: EconomicFlow,
  ) {
    store.stock[good] = stored(store, good) + amount;
    if (flow) game.recordEconomicFlow(flow, good, amount);
    if (good !== 'gold' || source === 'storage') return;
    game.state.gold += amount;
    if (source === 'producer') game.state.goldDelivered = (game.state.goldDelivered || 0) + amount;
  }
  function withdrawStock(cost: Inventory, purpose: 'contractSpent' | 'upgradeSpent') {
    for (const name in cost) {
      const good = name as Good;
      let remaining = cost[good] ?? 0;
      for (const store of game.storages()) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Math.max(0, availableAt(store, good)));
        store.stock[good] = stored(store, good) - take;
        remaining -= take;
        game.recordEconomicFlow(purpose, good, take);
        if (good === 'gold') {
          game.state.gold = Math.max(0, game.state.gold - take);
          game.state.spentGold += take;
        }
      }
    }
  }
  return {
    storedStock,
    availableAt,
    availableStock,
    reclaimableStock,
    spendableStock,
    reserveStock,
    releaseReservation,
    moveReservation,
    collectReserved,
    storeGoods,
    withdrawStock,
  };
}

export interface StockLedgerSubsystem {
  /** Stored stock across all storage, reservations included. */
  storedStock: (good: Good) => number;
  /** Stored minus reserved stock in one storehouse. */
  availableAt: (store: Building, good: Good) => number;
  /** Available stock across storage, limited to storage connected to `near` when given. */
  availableStock: (good: Good, near?: Place) => number;
  /**
   * Stock held for uncollected warehouse transfers. Construction and explicit
   * spending may cancel those transfers; producer fetches never do.
   */
  reclaimableStock: (good: Good, near?: Place) => number;
  /** Available plus reclaimable stock: what construction and spending can draw on. */
  spendableStock: (good: Good, near?: Place) => number;
  /** Promise one stored unit for collection. */
  reserveStock: (store: Building, good: Good) => void;
  /** Withdraw one promise without collecting the unit. */
  releaseReservation: (store: Building, good: Good) => void;
  /** Re-source one promise; `from` may already be gone. */
  moveReservation: (from: Building | null, to: Building, good: Good) => void;
  /** A carrier takes one reserved unit: it leaves stored and reserved stock together. */
  collectReserved: (store: Building, good: Good) => void;
  /**
   * Put goods into a storehouse, recording `flow` when given. The treasury
   * (`state.gold`) always equals stored gold plus gold carried between
   * storehouses; only this ledger changes it.
   */
  storeGoods: (
    store: Building,
    good: Good,
    amount: number,
    source: StockSource,
    flow?: EconomicFlow,
  ) => void;
  /**
   * Spend available stock, storehouse by storehouse, debiting the treasury for
   * gold. Callers first secure the cost (see `requestStock`); reservations stay.
   */
  withdrawStock: (cost: Inventory, purpose: 'contractSpent' | 'upgradeSpent') => void;
}

export interface StockLedgerDependencies
  extends
    Pick<SimulationStateSubsystem, 'jobs' | 'units' | 'state'>,
    Pick<NavigationSubsystem, 'connectedLand'>,
    Pick<ObservationSubsystem, 'recordEconomicFlow'>,
    Pick<EconomySubsystem, 'storages'> {}
