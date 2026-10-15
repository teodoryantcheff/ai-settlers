import { createEventBus, type EventBus } from './state.ts';
import type { GameEvents } from '../types.ts';
/** One synchronous domain bus per colony, available before any producer starts. */
export function createEvents(): EventsSubsystem {
  const gameEvents = createEventBus<GameEvents>();
  return { gameEvents, emitGameEvent: gameEvents.emit };
}
export interface EventsSubsystem {
  readonly gameEvents: EventBus<GameEvents>;
  emitGameEvent: <K extends keyof GameEvents>(name: K, payload: GameEvents[K]) => void;
}
