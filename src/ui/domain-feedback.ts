import type { GameRuntime } from '../runtime.ts';
import type { GameEvents } from '../types.ts';
import type { EventsSubsystem } from '../core/events.ts';

/** Domain exceptions still propagate. Only passive presentation observers are isolated. */
export function observePresentation<K extends keyof GameEvents>(
  source: EventsSubsystem,
  name: K,
  listener: (event: GameEvents[K]) => void,
  report: (error: unknown) => void = (error) =>
    console.error('Presentation observer failed', error),
): () => boolean {
  return source.gameEvents.on(name, (event) => {
    try {
      listener(event);
    } catch (error) {
      try {
        report(error);
      } catch (reportError) {
        console.error('Presentation failure reporting failed', reportError);
      }
    }
  });
}
export function bindDomainFeedback(game: GameRuntime): () => void {
  const subscriptions: Array<() => boolean> = [];
  function on<K extends keyof GameEvents>(name: K, listener: (event: GameEvents[K]) => void) {
    subscriptions.push(observePresentation(game, name, listener));
  }
  // A sound device/effect failure must never suppress text or abort a command.
  function effect(action: () => void) {
    try {
      action();
    } catch (error) {
      console.error('Presentation effect failed', error);
    }
  }
  on('placementRejected', (e) => {
    const advice = game.suggestFor(e.reason);
    const text = game.placementText(e.reason);
    game.msg(
      e.reason.code === 'stock'
        ? '✖ ' + text + ' — ' + advice
        : '✖ ' + game.BSPEC[e.type].name + ': ' + text + (advice ? ' — ' + advice : ''),
    );
    effect(() => game.FX.ring(e.x + 0.5, e.y + 0.5, '#ff5a4a', 16));
    effect(() => game.SND.fail());
  });
  on('siteCleared', (e) =>
    game.msg('⚒ Site cleared (removed ' + (e.tree ? 'trees' : 'a rock') + ')'),
  );
  on('buildingPlaced', (e) => {
    game.msg('✓ Construction started: ' + game.BSPEC[e.building.type].name, {
      workspace: 'activity',
      entity: e.building,
    });
    effect(() => game.SND.place());
  });
  on('buildingCompleted', (e) => {
    game.msg(game.BSPEC[e.building.type].name + ' completed', {
      workspace: 'activity',
      entity: e.building,
    });
    effect(() => game.SND.done());
    if (game.state.auto)
      game.msg(
        'Advisor: ' +
          game.BSPEC[e.building.type].name +
          ' is ready. ' +
          (game.BSPEC[e.building.type].guard
            ? 'A soldier must arrive to extend its full border.'
            : game.BSPEC[e.building.type].store
              ? 'Set storage targets to request local reserves.'
              : game.BSPEC[e.building.type].out
                ? 'Watch its deliveries in the Routes overlay.'
                : e.building.type === 'well'
                  ? 'Nearby supported producers can draw local water.'
                  : 'Inspect its current work and local conditions.'),
      );
  });
  on('demolitionRejected', (e) =>
    game.msg(
      e.reason === 'headquarters'
        ? 'The headquarters cannot be razed'
        : 'Cannot demolish the last storehouse',
    ),
  );
  on('buildingDemolished', (e) => {
    game.msg(game.BSPEC[e.type].name + ' torn down', { workspace: 'activity', entity: e });
    effect(() => game.SND.demolish());
  });
  on('rocksExhausted', () => game.msg('Quarry: no rocks in range'));
  on('foodBlocked', (e) => game.msg(game.BSPEC[e.building.type].name + ': waiting for food'));
  on('depositExhausted', (e) => {
    game.msg(game.BSPEC[e.building.type].name + ': deposit exhausted');
    effect(() => game.SND.gone());
  });
  on('goldBanked', (e) => effect(() => game.FX.coin(e.building.x, e.building.y)));
  on('firstGold', () => {
    if (game.started) game.msg('First gold delivered! Bank it or invest in your colony.');
  });
  on('outpostManned', () => {
    game.msg('A soldier mans the outpost');
    effect(() => game.SND.man());
  });
  on('settlerSpawned', () => game.msg('A new settler reports for duty'));
  on('roadRejected', (e) =>
    game.msg(
      e.reason === 'no-route'
        ? 'No route for a road there'
        : '✖ Road must start on clear ground inside your territory',
    ),
  );
  on('roadBuilt', (e) => {
    game.msg(
      e.count ? '✓ Road built (' + e.count + ' tiles) — carriers prefer it' : 'No new road tiles',
    );
    if (e.count) effect(() => game.SND.road(e.count));
  });
  on('contractRejected', () => {
    game.msg('Keep enough unreserved goods to fulfill this contract');
    effect(() => game.SND.fail());
  });
  on('contractFulfilled', (e) => {
    game.msg('Contract fulfilled: ' + e.name);
    effect(() => game.SND.ui());
    effect(() => game.FX.pop(e.x + 0.5, e.y + 0.5));
  });
  on('upgradeRejected', (e) => {
    game.msg('This upgrade needs ' + e.price + ' unreserved gold');
    effect(() => game.SND.fail());
  });
  on('upgradePurchased', (e) => {
    game.msg(
      (e.kind === 'haul' ? 'Carrier training' : 'Workshop methods') +
        ' upgraded to level ' +
        e.level,
    );
    effect(() => game.SND.ui());
  });
  on('milestoneReached', (e) => {
    if (!game.started) return;
    game.msg('Milestone: ' + e.title);
    const store = game.anyStorage();
    if (store) effect(() => game.FX.ring(store.x + 0.5, store.y + 0.5, '#a4d987', 15));
  });
  on('storageResult', (e) => {
    game.msg(e.message);
    effect(() => (e.ok ? game.SND.ui() : game.SND.fail()));
  });
  return () => {
    for (const unsubscribe of subscriptions) unsubscribe();
  };
}
