import { createAttention, type AttentionSubsystem } from '../observations/attention.ts';
import { attachSubsystem } from '../core/attach.ts';
import { createEvents, type EventsSubsystem } from '../core/events.ts';
import { createWorld, type WorldSubsystem } from '../core/world.ts';
import {
  createPersistence,
  type PersistenceInternals,
  type PersistenceSubsystem,
  type StoragePort,
} from '../core/persistence.ts';
import { createSimulationState, type SimulationStateSubsystem } from './state.ts';
import { createMap, type MapInternals, type MapSubsystem } from './map.ts';
import { createNavigation, type NavigationSubsystem } from './navigation.ts';
import { createObservations, type ObservationSubsystem } from './observations.ts';
import { createEconomy, type EconomyInternals, type EconomySubsystem } from './economy.ts';
import { createTransport, type TransportSubsystem } from './transport.ts';
import { createAutoplay, type AutoplayInternals, type AutoplaySubsystem } from './autoplay.ts';
import { createRoads, type RoadsSubsystem } from './roads.ts';
import {
  createProgression,
  type ProgressionInternals,
  type ProgressionSubsystem,
} from '../gameplay/progression.ts';
import { createAdvisor, type AdvisorSubsystem } from '../gameplay/advisor.ts';

import { createEngineStartup, type EngineSubsystem } from './startup.ts';

export type SimulationEngine = WorldSubsystem &
  EventsSubsystem &
  SimulationStateSubsystem &
  MapSubsystem &
  NavigationSubsystem &
  ObservationSubsystem &
  EconomySubsystem &
  TransportSubsystem &
  AttentionSubsystem &
  AutoplaySubsystem &
  RoadsSubsystem &
  ProgressionSubsystem &
  AdvisorSubsystem &
  PersistenceSubsystem &
  EngineSubsystem;
export interface EngineOptions {
  seed: number;
  search?: string;
  storage?: StoragePort;
  /** Development builds only: test-only persistence hooks (see `src/dev/`). */
  persistenceInternals?: PersistenceInternals;
}

/** One domain factory order shared by production and partial test assemblies. */
export const DOMAIN_SUBSYSTEMS = [
  domainSubsystem('world', (_game, options) =>
    createWorld(options.search ?? '?seed=' + options.seed),
  ),
  domainSubsystem('events', () => createEvents()),
  domainSubsystem('state', () => createSimulationState()),
  domainSubsystem('map', (game, _options, hooks?: MapInternals) => createMap(game, hooks)),
  domainSubsystem('navigation', (game) => createNavigation(game)),
  domainSubsystem('observations', (game) => createObservations(game)),
  domainSubsystem('economy', (game, _options, hooks?: EconomyInternals) =>
    createEconomy(game, hooks),
  ),
  domainSubsystem('transport', (game) => createTransport(game)),
  domainSubsystem('attention', (game) => createAttention(game)),
  domainSubsystem('progression', (game, _options, hooks?: ProgressionInternals) =>
    createProgression(game, hooks),
  ),
  domainSubsystem('advisor', (game) => createAdvisor(game)),
  domainSubsystem('roads', (game) => createRoads(game)),
  domainSubsystem('autoplay', (game, _options, hooks?: AutoplayInternals) =>
    createAutoplay(game, hooks),
  ),
  domainSubsystem('persistence', (game, options, hooks?: PersistenceInternals) =>
    createPersistence(game, hooks ?? options.persistenceInternals, options.storage),
  ),
  domainSubsystem('startup', (game) => createEngineStartup(game)),
] as const;

function domainSubsystem<Name extends string, Hooks extends object = never>(
  name: Name,
  create: (game: SimulationEngine, options: EngineOptions, hooks?: Hooks) => object,
) {
  return { name, create };
}

/** Attach live descriptors without initializing a colony or starting a frame loop. */
export function createEngine(options: EngineOptions): SimulationEngine {
  const game = {} as SimulationEngine;
  for (const { create } of DOMAIN_SUBSYSTEMS) attachSubsystem(game, create(game, options));
  return game;
}
