import { saveName } from '../core/save-catalog.ts';
import type { WorldSubsystem } from '../core/world.ts';
import type { EventsSubsystem } from '../core/events.ts';
import type { PersistenceSubsystem } from '../core/persistence.ts';
import { createSimulationState, type SimulationStateSubsystem } from './state.ts';
import type { MapSubsystem } from './map.ts';
import { freshEconomicObservations, type ObservationSubsystem } from './observations.ts';
import type { EconomySubsystem } from './economy.ts';
import type { AutoplaySubsystem } from './autoplay.ts';

export function createEngineStartup(game: EngineStartupDependencies): EngineSubsystem {
  function initializeColony() {
    game.genMap();
    const hq = game.newBuilding('hq', game.W >> 1, game.H >> 1);
    hq.done = true;
    hq.constructionProgress = 1;
    hq.stock = {
      planks: 48,
      stone: 48,
      food: 20,
      tools: 16,
      weapons: 6,
      logs: 0,
      coal: 0,
      iron: 0,
      gold: 0,
    };
    game.buildings.push(hq);
    game.recomputeTerritory();
    for (let i = 0; i < 8; i++) game.spawnCarrier(hq);
    return hq;
  }
  function resetColony(seed: number, name = 'Unnamed colony', explorationFog = false) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)
      throw new Error('Seed must be an integer from 0 to 2147483647');
    const colonyName = saveName(name);
    const defaults = createSimulationState();
    Object.assign(game.state, defaults.state);
    game.state.explorationFog = explorationFog;
    game.revealed.fill(explorationFog ? 0 : 1);
    game.buildings = defaults.buildings;
    game.units = defaults.units;
    game.jobs = defaults.jobs;
    for (const key of [
      'nextId',
      'serfPool',
      'soldierPool',
      'spawnT',
      'serfT',
      'solT',
      'assignT',
      'treeGrowthT',
    ] as const)
      game[key] = defaults[key];
    game.tiles = new Array(game.W * game.H);
    game.seed = seed;
    game.SR = game.mulberry32(seed + 0x5bd1e995);
    game.autoT = 0;
    game.observationData = freshEconomicObservations(0);
    game.setColonyName(colonyName);
    const hq = initializeColony();
    game.emitGameEvent('worldLoaded', { reason: 'new' });
    return hq;
  }
  return { initializeColony, resetColony };
}
export interface EngineSubsystem {
  initializeColony: () => import('../types.ts').Building;
  resetColony: (
    seed: number,
    name?: string,
    explorationFog?: boolean,
  ) => import('../types.ts').Building;
}
export interface EngineStartupDependencies
  extends
    Pick<WorldSubsystem, 'W' | 'H' | 'tiles' | 'seed' | 'SR' | 'mulberry32'>,
    Pick<
      SimulationStateSubsystem,
      | 'buildings'
      | 'units'
      | 'jobs'
      | 'state'
      | 'nextId'
      | 'serfPool'
      | 'soldierPool'
      | 'spawnT'
      | 'serfT'
      | 'solT'
      | 'assignT'
      | 'treeGrowthT'
    >,
    Pick<AutoplaySubsystem, 'autoT'>,
    Pick<ObservationSubsystem, 'observationData'>,
    Pick<PersistenceSubsystem, 'setColonyName'>,
    Pick<EventsSubsystem, 'emitGameEvent'>,
    Pick<MapSubsystem, 'genMap' | 'recomputeTerritory' | 'revealed'>,
    Pick<EconomySubsystem, 'newBuilding' | 'spawnCarrier'> {}
