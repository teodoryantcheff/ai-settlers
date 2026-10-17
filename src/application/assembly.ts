import { createAttentionView } from '../ui/attention-view.ts';
import { createInteraction } from '../ui/interaction.ts';
import { createMessages } from '../ui/messages.ts';
import { createEconomicNotices } from '../ui/economic-notices.ts';
import { createProgressionView } from '../ui/progression-view.ts';
import { bindDomainFeedback } from '../ui/domain-feedback.ts';
import { createLoop, type LoopInternals } from './loop.ts';
import { createAudio, type AudioInternals } from '../audio/audio.ts';
import { createArt } from '../rendering/art.ts';
import { createLandscape, type LandscapeInternals } from '../rendering/landscape.ts';
import { createRenderer, type RendererInternals } from '../rendering/renderer.ts';
import type { RendererPresentation } from '../rendering/scene.ts';
import { createVillage, type VillageInternals } from '../rendering/village.ts';
import { attachSubsystem, type GameRuntime } from '../runtime.ts';
import { createSaveView } from '../ui/save-view.ts';
import { createWorkspace } from '../ui/workspace.ts';
import { createLogisticsView } from '../ui/logistics-view.ts';
import { createEconomyView } from '../ui/economy-view.ts';
import { createSessionView } from '../ui/session-view.ts';
import { createRecoveryView } from '../ui/recovery-view.ts';
import { createReferenceView } from '../ui/reference-view.ts';
import { createHud, type HudInternals } from '../ui/hud.ts';

export interface PresentationOptions {
  presentation: RendererPresentation;
}

/** Production and partial tests use these same factories in this same order. */
export const PRESENTATION_SUBSYSTEMS = [
  presentationSubsystem('interaction', (game) => createInteraction(game)),
  presentationSubsystem('messages', (game) => createMessages(game)),
  presentationSubsystem('economicNotices', (game) => createEconomicNotices(game)),
  presentationSubsystem('audio', (game, _options, hooks?: AudioInternals) =>
    createAudio(game, hooks),
  ),
  presentationSubsystem('art', (game) => createArt(game)),
  presentationSubsystem('landscape', (game, _options, hooks?: LandscapeInternals) =>
    createLandscape(game, hooks),
  ),
  presentationSubsystem('village', (game, _options, hooks?: VillageInternals) =>
    createVillage(game, hooks),
  ),
  presentationSubsystem('renderer', (game, options, hooks?: RendererInternals) =>
    createRenderer(game, options.presentation, hooks),
  ),
  presentationSubsystem('progressionView', (game) => createProgressionView(game)),
  presentationSubsystem('workspace', (game) => createWorkspace(game)),
  presentationSubsystem('saveView', (game) => createSaveView(game)),
  presentationSubsystem('economyView', (game) => createEconomyView(game)),
  presentationSubsystem('logisticsView', (game) => createLogisticsView(game)),
  presentationSubsystem('reference', (game) => createReferenceView(game)),
  presentationSubsystem('recovery', (game) => createRecoveryView(game)),
  presentationSubsystem('attentionView', (game) => createAttentionView(game)),
  presentationSubsystem('hud', (game, _options, hooks?: HudInternals) => createHud(game, hooks)),
  presentationSubsystem('session', (game) => createSessionView(game)),
  presentationSubsystem('loop', (game, _options, hooks?: LoopInternals) => createLoop(game, hooks)),
] as const;

function presentationSubsystem<Name extends string, Hooks extends object = never>(
  name: Name,
  create: (game: GameRuntime, options: PresentationOptions, hooks?: Hooks) => object,
) {
  return { name, create };
}

/** Bind after construction, when commands and their presentation collaborators exist. */
export function connectPresentation(game: GameRuntime, installed?: ReadonlySet<string>) {
  if (!installed || (installed.has('economy') && installed.has('messages')))
    bindDomainFeedback(game);
}

/** Assembly installs observers and live descriptors but never initializes or starts play. */
export function assemblePresentation(game: GameRuntime, options: PresentationOptions): void {
  for (const { create } of PRESENTATION_SUBSYSTEMS) attachSubsystem(game, create(game, options));
  connectPresentation(game);
}
