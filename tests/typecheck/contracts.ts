import { createEventBus } from '../../src/core/state.ts';
import { UNLIT_AT_NIGHT, type RendererPresentation } from '../../src/rendering/renderer.ts';
import type { GameRuntime } from '../../src/runtime.ts';
import type {
  Building,
  GameEvents,
  Good,
  InteractionMode,
  Job,
  LayerName,
  OverlayName,
} from '../../src/types.ts';

// Compiler regression tests: these mistakes must not be silently accepted.
declare const game: GameRuntime;
declare const building: Building;
declare const job: Job;
declare const mode: InteractionMode;
declare const presentation: RendererPresentation;
const events = createEventBus<GameEvents>();
events.emit('goodsProduced', { building, good: 'logs', amount: 1 });
game.newBuilding('farm', 48, 48);

// @ts-expect-error Unknown resource names are not valid inventory keys.
const unknownGood: Good = 'wood';
// @ts-expect-error Building definitions are a closed set.
game.newBuilding('castle', 48, 48);
// @ts-expect-error Simulation entities require the complete building contract.
game.buildings.push({ id: 1, type: 'farm' });
// @ts-expect-error Typed events require their payload fields.
events.emit('goodsProduced', { building, good: 'logs' });
// @ts-expect-error Event names are a closed set.
events.emit('unknownEvent', {});
// @ts-expect-error The runtime must retain the event payload contract too.
game.emitGameEvent('victory', { building });
// @ts-expect-error Seeded RNG continuation uses a numeric state.
game.SR.setState('123');
const deadClauseJob: Job = {
  kind: 'transfer',
  good: 'logs',
  from: 1,
  to: 2,
  s: 3,
  // Job records have no `d` field (the deleteJobsFor regression: a leftover
  // clause comparing j.d compiled only while parameters were implicitly any).
  // @ts-expect-error Unknown Job fields are rejected on assignment too.
  d: 4,
  state: 'p',
};
// @ts-expect-error Unknown Job fields do not exist.
const deadClauseRead = job.d;
// @ts-expect-error Map tools are a closed set.
game.setMode('blast');
// @ts-expect-error Build modes carry their building type.
const incompleteMode: InteractionMode = { type: 'build' };
// @ts-expect-error Non-build modes expose no building type.
const roadModeBt = mode.bt;
// @ts-expect-error Scene layers are a closed set.
presentation.layer('bogus-layer', null as unknown as CanvasRenderingContext2D, () => {});
// @ts-expect-error Diagnostic overlays are a closed set.
game.presentationPrefs.overlay = 'bogus-overlay';
// @ts-expect-error Implicitly-any parameters are gone: tile hashes take tile indexes.
game.tileHash('12');
// @ts-expect-error Night-glow exclusions name real building types.
const misspelledUnlit: typeof UNLIT_AT_NIGHT = new Set(['coalmine']);
void unknownGood;
void misspelledUnlit;
void deadClauseJob;
void deadClauseRead;
void incompleteMode;
void roadModeBt;
// Narrowing still works where the unions were introduced.
const layerName: LayerName = 'terrain';
const overlayName: OverlayName = 'routes';
void layerName;
void overlayName;

// Node tests run source through type stripping, so syntax must erase to plain JavaScript.
// @ts-expect-error Enums emit runtime code.
enum Direction {
  North,
}
void Direction.North;
// @ts-expect-error Type-only imports must say so, because Node cannot tell them from values.
import { TilePoint } from '../../src/types.ts';
const origin: TilePoint = { x: 0, y: 0 };
void origin;

// Domain ports must not regain presentation dependencies, including type-only imports.
import type { EconomyDependencies } from '../../src/simulation/economy.ts';
import type { AutoplayDependencies } from '../../src/simulation/autoplay.ts';
import type { MapDependencies } from '../../src/simulation/map.ts';
import type { ProgressionDependencies } from '../../src/gameplay/progression.ts';
import type { PersistenceDependencies } from '../../src/core/persistence.ts';
declare const economy: EconomyDependencies;
declare const autoplay: AutoplayDependencies;
declare const map: MapDependencies;
declare const progression: ProgressionDependencies;
declare const persistence: PersistenceDependencies;
// @ts-expect-error Audio belongs to presentation.
economy.SND;
// @ts-expect-error Effects belong to presentation.
economy.FX;
// @ts-expect-error Selection belongs to interaction.
economy.selected;
// @ts-expect-error Tools are translated into an explicit simulation input.
autoplay.mode;
// @ts-expect-error Territory publishes facts instead of accessing the renderer.
map.borderDirty;
// @ts-expect-error HUD refreshes do not drive rules.
progression.gameplayHUD;
// @ts-expect-error Persistence publishes a completed load instead of calling presentation.
persistence.resetPresentation;
// @ts-expect-error Camera is a presentation concern.
persistence.cam;
