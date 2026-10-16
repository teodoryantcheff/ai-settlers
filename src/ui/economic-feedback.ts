import { ingredientShortages } from '../gameplay/production-rules.ts';
import type { Building, BuildingSpec, BuildingType, Good, SimulationState } from '../types.ts';
import {
  deliberatePause,
  productionBlockage as blockage,
  type BlockageReason,
} from '../observations/production-condition.ts';

export const ECONOMIC_BLOCKAGE_DELAY_MS = 12_000;
export const ECONOMIC_GLOBAL_COOLDOWN_MS = 8_000;
export const ECONOMIC_BUILDING_COOLDOWN_MS = 20_000;
const MAX_SAMPLE_GAP_MS = 1_500;
const MAX_NOTICE_EXAMPLES = 3;

export type EconomicFeedbackKind = 'started' | 'blocked' | 'recovered';
export type EconomicBlockageReason = BlockageReason;
export interface EconomicFeedbackNotice {
  kind: EconomicFeedbackKind;
  reason: EconomicBlockageReason | null;
  at: number;
  count: number;
  /** Bounded examples; count includes every building in the coalesced transition. */
  buildings: ReadonlyArray<{
    id: number;
    type: BuildingType;
    x: number;
    y: number;
    name: string;
  }>;
  message: string;
}
interface EconomicFeedbackSource {
  readonly buildings: readonly Building[];
  readonly state: Pick<SimulationState, 'time' | 'paused' | 'won'>;
  readonly BSPEC: Record<BuildingType, BuildingSpec>;
  readonly GOODS: Record<Good, { name: string }>;
}
interface Observation {
  seen: number;
  produced: number;
  hasProduced: boolean;
  reason: EconomicBlockageReason | null;
  since: number;
  announced: boolean;
  warned: boolean;
  started: boolean;
  recovered: boolean;
  lastNotice: number;
}

/**
 * Presentation-only observer. It never writes buildings, metrics, state or RNG.
 * Counters, not timers or delivered stock, prove that production actually happened.
 */
export function createEconomicFeedback(source: EconomicFeedbackSource) {
  const observations = new Map<Building, Observation>();
  let buildingsSource: readonly Building[];
  let stateSource: EconomicFeedbackSource['state'];
  let lastNow = 0;
  let lastSimulationTime = 0;
  let activeTime = 0;
  let pendingElapsed = 0;
  let wasActive = false;
  let generation = 0;
  let nextNotice = -Infinity;

  function baseline(b: Building, reason: EconomicBlockageReason | null): Observation {
    return {
      seen: generation,
      produced: b.produced || 0,
      hasProduced: (b.produced || 0) > 0,
      reason,
      since: activeTime,
      announced: false,
      warned: false,
      started: false,
      recovered: false,
      lastNotice: -Infinity,
    };
  }
  function reasonText(b: Building, reason: EconomicBlockageReason) {
    const sp = source.BSPEC[b.type];
    if (reason === 'inputs') {
      const missing = ingredientShortages(b, sp).map(({ good }) =>
        source.GOODS[good].name.toLowerCase(),
      );
      return 'needs ' + missing.join(' and ');
    }
    if (reason === 'output') return 'output store full — awaiting collection';
    if (reason === 'exhausted') return 'deposit exhausted';
    return sp.prod === 'gather'
      ? 'no mature trees in range'
      : sp.prod === 'rock'
        ? 'no rocks in range'
        : sp.prod === 'fish'
          ? 'no nearby water'
          : 'natural resources unavailable';
  }
  function notice(
    kind: EconomicFeedbackKind,
    reason: EconomicBlockageReason | null,
    group: Building[],
    now: number,
  ): EconomicFeedbackNotice {
    const examples = group.slice(0, MAX_NOTICE_EXAMPLES).map((b) => ({
      id: b.id,
      type: b.type,
      x: b.x,
      y: b.y,
      name: source.BSPEC[b.type].name,
    }));
    const labels = examples.map((b) => b.name + ' (' + b.x + ', ' + b.y + ')').join('; ');
    const others =
      group.length > examples.length ? ' + ' + (group.length - examples.length) + ' more' : '';
    let description: string;
    const output = source.BSPEC[group[0].type].out;
    if (kind === 'started' && output)
      description = 'first ' + source.GOODS[output].name.toLowerCase() + ' produced';
    else if (kind === 'recovered') description = 'production resumed';
    else if (!reason) description = 'production resumed';
    else if (group.length === 1) description = 'blocked — ' + reasonText(group[0], reason);
    else
      description =
        'blocked — ' +
        {
          inputs: 'waiting for inputs',
          output: 'output stores full',
          resources: 'natural resources unavailable',
          exhausted: 'deposits exhausted',
        }[reason];
    const prefix = kind === 'blocked' ? '! ' : kind === 'recovered' ? '✓ ' : '▶ ';
    return {
      kind,
      reason,
      at: now,
      count: group.length,
      buildings: examples,
      message: prefix + labels + others + ': ' + description,
    };
  }

  function update(
    realNowMs: number,
    { active = true, canNotify = true }: { active?: boolean; canNotify?: boolean } = {},
  ): EconomicFeedbackNotice | null {
    if (!Number.isFinite(realNowMs)) return null;
    const reset =
      buildingsSource !== source.buildings ||
      stateSource !== source.state ||
      source.state.time < lastSimulationTime ||
      realNowMs < lastNow;
    // Victory is a milestone, not the end of the simulation: feedback remains
    // available after the player chooses to continue settling.
    const running = active && !source.state.paused;
    const progressed = !reset && source.state.time > lastSimulationTime;
    if (reset) {
      observations.clear();
      activeTime = 0;
      pendingElapsed = 0;
      nextNotice = -Infinity;
      buildingsSource = source.buildings;
      stateSource = source.state;
    } else {
      const elapsed = realNowMs - lastNow;
      // Pauses, hidden tabs and long frame gaps cannot mature a blockage or
      // unleash a catch-up burst. Accumulate substep-free frames at high refresh
      // rates, but only spend that wall time when simulation really advances.
      if (running && wasActive && elapsed <= MAX_SAMPLE_GAP_MS)
        pendingElapsed = Math.min(MAX_SAMPLE_GAP_MS, pendingElapsed + elapsed);
      else pendingElapsed = 0;
      if (progressed && running) {
        activeTime += pendingElapsed;
        pendingElapsed = 0;
      }
    }
    lastNow = realNowMs;
    lastSimulationTime = source.state.time;
    wasActive = running;
    generation++;

    for (const b of source.buildings) {
      const sp = source.BSPEC[b.type];
      // Foresters have no goods output; construction, stores and outposts are
      // already explained by their own existing event messages.
      if (!b.done || !sp.out || sp.store) continue;
      const reason = blockage(b, sp);
      let observation = observations.get(b);
      const produced = b.produced || 0;
      if (!observation || produced < observation.produced) {
        observation = baseline(b, reason);
        observations.set(b, observation);
        continue;
      }
      observation.seen = generation;
      const output = produced > observation.produced;
      observation.produced = produced;
      if (output && running && progressed && !b.disabled && b.blockedReason !== 'paused') {
        if (observation.warned) {
          observation.recovered = true;
          observation.started = false;
        } else if (!observation.hasProduced) observation.started = true;
      }
      if (deliberatePause(b)) {
        observation.reason = null;
        observation.since = activeTime;
        observation.announced = observation.warned = false;
        // At 8x the frame can end demand-limited just after real output. That
        // automatic pause is not an issue, but must not hide the proven success.
        if (b.disabled || b.blockedReason === 'paused')
          observation.started = observation.recovered = false;
      } else {
        if (output) observation.warned = false;
        if (output || reason !== observation.reason) {
          observation.since = activeTime;
          observation.announced = false;
        }
        if (!running) observation.since = activeTime;
        observation.reason = reason;
        // A new sustained stall supersedes an undelivered, now-stale success.
        if (reason && activeTime - observation.since >= ECONOMIC_BLOCKAGE_DELAY_MS) {
          observation.started = false;
          observation.recovered = false;
        }
      }
      observation.hasProduced ||= produced > 0;
    }
    for (const [b, observation] of observations)
      if (observation.seen !== generation) observations.delete(b);

    if (reset || !running || !progressed || !canNotify || realNowMs < nextNotice) return null;
    // At most one grouped notice per real-time global window. Blocking issues
    // take precedence; every matching building commits together, even muted.
    for (const kind of ['blocked', 'recovered', 'started'] as const) {
      const group: Building[] = [];
      let groupKey: string | undefined;
      let reason: EconomicBlockageReason | null = null;
      for (const [b, observation] of observations) {
        if (realNowMs - observation.lastNotice < ECONOMIC_BUILDING_COOLDOWN_MS) continue;
        const eligible =
          kind === 'blocked'
            ? observation.reason &&
              !observation.announced &&
              activeTime - observation.since >= ECONOMIC_BLOCKAGE_DELAY_MS
            : observation[kind];
        if (!eligible) continue;
        const key =
          kind === 'blocked'
            ? observation.reason
            : kind === 'started'
              ? source.BSPEC[b.type].out
              : kind;
        if (!key) continue;
        if (groupKey !== undefined && key !== groupKey) continue;
        groupKey = key;
        reason = kind === 'blocked' ? observation.reason : null;
        group.push(b);
      }
      if (!group.length) continue;
      const result = notice(kind, reason, group, realNowMs);
      for (const b of group) {
        const observation = observations.get(b);
        if (!observation) continue;
        observation.lastNotice = realNowMs;
        if (kind === 'blocked') {
          observation.announced = true;
          observation.warned = true;
        } else observation[kind] = false;
      }
      nextNotice = realNowMs + ECONOMIC_GLOBAL_COOLDOWN_MS;
      return result;
    }
    return null;
  }
  return { update };
}
