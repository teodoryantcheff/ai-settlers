import type { RecoveryViewSubsystem } from './ui/recovery-view.ts';
import type { ReferenceViewSubsystem } from './ui/reference-view.ts';
import type { AttentionViewSubsystem } from './ui/attention-view.ts';
import type { AttentionSubsystem } from './observations/attention.ts';
import type { SessionSubsystem } from './ui/session-view.ts';
import type { SaveViewSubsystem } from './ui/save-view.ts';
import type { AudioSubsystem } from './audio/audio.ts';
import type { PersistenceSubsystem } from './core/persistence.ts';
import type { WorldSubsystem } from './core/world.ts';
import type { ProgressionSubsystem } from './gameplay/progression.ts';
import type { ArtSubsystem } from './rendering/art.ts';
import type { LandscapeSubsystem } from './rendering/landscape.ts';
import type { RendererSubsystem } from './rendering/renderer.ts';
import type { VillageSubsystem } from './rendering/village.ts';
import type { AutoplaySubsystem } from './simulation/autoplay.ts';
import type { ObservationSubsystem } from './simulation/observations.ts';
import type { TransportSubsystem } from './simulation/transport.ts';
import type { EconomySubsystem } from './simulation/economy.ts';
import type { MapSubsystem } from './simulation/map.ts';
import type { NavigationSubsystem } from './simulation/navigation.ts';
import type { SimulationStateSubsystem } from './simulation/state.ts';
import type { WorkspaceSubsystem } from './ui/workspace.ts';
import type { LogisticsViewSubsystem } from './ui/logistics-view.ts';
import type { EconomyViewSubsystem } from './ui/economy-view.ts';
import type { HudSubsystem } from './ui/hud.ts';

/** Subsystems own their state; this composition surface exposes live bindings. */
import type { EventsSubsystem } from './core/events.ts';
import type { AdvisorSubsystem } from './gameplay/advisor.ts';
import type { RoadsSubsystem } from './simulation/roads.ts';
import type { EngineSubsystem } from './simulation/engine.ts';
import type { InteractionSubsystem } from './ui/interaction.ts';
import type { MessagesSubsystem } from './ui/messages.ts';
import type { EconomicNoticesSubsystem } from './ui/economic-notices.ts';
import type { ProgressionViewSubsystem } from './ui/progression-view.ts';
import type { LoopSubsystem } from './application/loop.ts';
export type GameRuntime = ReferenceViewSubsystem &
  RecoveryViewSubsystem &
  SessionSubsystem &
  SaveViewSubsystem &
  EventsSubsystem &
  AdvisorSubsystem &
  RoadsSubsystem &
  EngineSubsystem &
  InteractionSubsystem &
  MessagesSubsystem &
  EconomicNoticesSubsystem &
  ProgressionViewSubsystem &
  LoopSubsystem &
  WorldSubsystem &
  MapSubsystem &
  NavigationSubsystem &
  SimulationStateSubsystem &
  PersistenceSubsystem &
  ObservationSubsystem &
  EconomySubsystem &
  TransportSubsystem &
  AttentionSubsystem &
  AttentionViewSubsystem &
  AutoplaySubsystem &
  AudioSubsystem &
  ArtSubsystem &
  LandscapeSubsystem &
  VillageSubsystem &
  RendererSubsystem &
  ProgressionSubsystem &
  EconomyViewSubsystem &
  LogisticsViewSubsystem &
  HudSubsystem &
  WorkspaceSubsystem;

export { attachSubsystem } from './core/attach.ts';
