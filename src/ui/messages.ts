import type { Building, BuildingStatus, GameMessage } from '../types.ts';
import type { EconomySubsystem } from '../simulation/economy.ts';
import type { EventsSubsystem } from '../core/events.ts';

export function createMessages(
  game: Pick<EconomySubsystem, 'buildingStatus'> & EventsSubsystem,
): MessagesSubsystem {
  const msgs: GameMessage[] = [];
  let cache = new WeakMap<Building, { status: BuildingStatus; at: number; disabled: boolean }>();
  function msg(txt: string, context?: GameMessage['context']) {
    const now = performance.now();
    for (let i = msgs.length - 1; i >= 0; i--)
      if (msgs[i].t === txt && now - msgs[i].at < 2500) return;
    msgs.push({ t: txt, at: now, ...(context ? { context } : {}) });
    if (msgs.length > 8) msgs.shift();
  }
  function bStatus(b: Building): BuildingStatus {
    const now = performance.now();
    let entry = cache.get(b);
    if (!entry || entry.disabled !== !!b.disabled || now - entry.at > 800) {
      entry = { status: game.buildingStatus(b), at: now, disabled: !!b.disabled };
      cache.set(b, entry);
    }
    return entry.status;
  }
  const dispose = game.gameEvents.on('worldLoaded', () => {
    cache = new WeakMap();
    msgs.length = 0;
  });
  return {
    get msgs() {
      return msgs;
    },
    msg,
    bStatus,
    disposeMessages: () => {
      dispose();
    },
  };
}
export interface MessagesSubsystem {
  readonly msgs: GameMessage[];
  msg: (txt: string, context?: GameMessage['context']) => void;
  bStatus: (b: Building) => BuildingStatus;
  disposeMessages: () => void;
}
