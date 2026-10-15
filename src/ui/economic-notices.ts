import type { GameRuntime } from '../runtime.ts';
import { observePresentation } from './domain-feedback.ts';
import { createEconomicFeedback, type EconomicFeedbackNotice } from './economic-feedback.ts';

type EconomicNoticeSource = Pick<
  GameRuntime,
  'buildings' | 'state' | 'BSPEC' | 'GOODS' | 'msgs' | 'msg' | 'gameEvents' | 'emitGameEvent'
> & {
  readonly SND?: Partial<
    Record<'chainStart' | 'chainBlocked' | 'chainRecovered', (x: number, y: number) => void>
  >;
};

/** Independent presentation reports; audio is an optional, failure-isolated effect. */
export function createEconomicNotices(game: EconomicNoticeSource): EconomicNoticesSubsystem {
  // This observer exists before AudioContext initialization, so muted players and
  // browsers that have not unlocked audio still receive the same information.
  const source = {
    get buildings() {
      return game.buildings;
    },
    get state() {
      return game.state;
    },
    get BSPEC() {
      return game.BSPEC;
    },
    get GOODS() {
      return game.GOODS;
    },
  };
  let economicFeedback = createEconomicFeedback(source);
  observePresentation(game, 'worldLoaded', () => {
    economicFeedback = createEconomicFeedback(source);
    // Establish the committed world's baseline now, before the next frame can
    // complete production. This never reinstalls subscriptions or keeps old arrays.
    economicFeedback.update(performance.now(), { active: false, canNotify: false });
  });
  function updateEconomicFeedback(realNowMs: number, active = true): EconomicFeedbackNotice | null {
    var messages = game.msgs || [];
    var canNotify = typeof game.msg === 'function';
    // Never evict a still-visible message from the eight-entry shared feed, and
    // leave fresh player actions/errors room to read before adding a quiet cue.
    if (messages.length >= 8 && realNowMs - messages[0].at < 7000) canNotify = false;
    for (var message of messages) {
      var age = realNowMs - message.at;
      if (
        age < 750 ||
        (age < 3500 && /failed|failure|cannot|can't|✖|exhausted|error|no route/i.test(message.t))
      )
        canNotify = false;
    }
    var notification = economicFeedback.update(realNowMs, {
      active: active && (typeof document === 'undefined' || document.visibilityState !== 'hidden'),
      canNotify,
    });
    if (notification) {
      game.msg(notification.message, {
        workspace: notification.kind === 'blocked' ? 'attention' : 'activity',
        entity: notification.buildings[0],
      });
      // Text commits before this optional effect: a missing or failed audio
      // engine cannot swallow the report or interrupt the frame loop.
      try {
        var b = notification.buildings[0];
        var method = (
          {
            started: 'chainStart',
            blocked: 'chainBlocked',
            recovered: 'chainRecovered',
          } as const
        )[notification.kind];
        game.SND?.[method]?.(b.x, b.y);
      } catch (error) {
        console.error('Economic notice sound failed', error);
      }
    }
    return notification;
  }

  return { updateEconomicFeedback };
}

export interface EconomicNoticesSubsystem {
  /** Observe completed simulation work, including paused frames for load baselines. */
  updateEconomicFeedback: (realNowMs: number, active?: boolean) => EconomicFeedbackNotice | null;
}
