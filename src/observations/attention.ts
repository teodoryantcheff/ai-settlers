import { productionOutputLimit } from '../gameplay/colony-rules.ts';
import type { Building, BuildingType, Good, ProductionBlockReason } from '../types.ts';
import type { SimulationStateSubsystem } from '../simulation/state.ts';
import type { EventsSubsystem } from '../core/events.ts';
import type { EconomySubsystem } from '../simulation/economy.ts';
import type { TransportSubsystem } from '../simulation/transport.ts';
import { ingredientAlternatives, ingredientShortages } from '../gameplay/production-rules.ts';
import {
  deliberatePause,
  productionBlockage,
  type BlockageReason,
} from './production-condition.ts';
export const ATTENTION_DELAY = 12;
export const ACTIVITY_KINDS = [
  'building-placed',
  'building-completed',
  'building-demolished',
  'production-started',
  'issue-opened',
  'issue-resolved',
  'road-built',
  'contract',
  'upgrade',
  'milestone',
  'first-gold',
  'outpost',
  'victory',
  'storage-failed',
  'storage-recovered',
  'renderer-failed',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export type Severity = 'urgent' | 'bottleneck' | 'info';
export interface EntityReference {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
}
export interface ActivityEvent {
  id: number;
  time: number;
  kind: ActivityKind;
  severity: Severity;
  message: string;
  entity?: EntityReference;
  good?: Good;
}
export type AttentionReason = Extract<ProductionBlockReason, BlockageReason | 'water'>;
export interface IssueBaseline {
  entity: EntityReference;
  produced: boolean;
  reason: AttentionReason | null;
  since: number;
  active: boolean;
}
export interface AttentionData {
  started: number;
  nextId: number;
  events: ActivityEvent[];
  conditions: IssueBaseline[];
}
export interface AttentionIssue {
  key: string;
  severity: Severity;
  since: number;
  reason: AttentionReason;
  entity: EntityReference;
  title: string;
  evidence: string[];
  advice: string;
  goods: Good[];
  contributors: EntityReference[];
}
export function freshAttention(time: number): AttentionData {
  return { started: time, nextId: 1, events: [], conditions: [] };
}
const reference = (b: EntityReference): EntityReference => ({
  id: b.id,
  type: b.type,
  x: b.x,
  y: b.y,
});
const labels: Record<AttentionReason, string> = {
  water: 'Local well support unavailable',
  inputs: 'Input shortage',
  output: 'Output awaiting collection',
  resources: 'Local resources unavailable',
  exhausted: 'Deposit exhausted',
};

/** Durable observation only. Never schedules work, changes stock, advances time or uses RNG. */
export function createAttention(game: AttentionDependencies): AttentionSubsystem {
  let data = freshAttention(game.state.time);
  let lastSample = -Infinity;
  let storageFailed = false,
    rendererFailed = false;
  function append(
    kind: ActivityKind,
    message: string,
    entity?: EntityReference,
    severity: Severity = 'info',
    good?: Good,
  ) {
    data.events.push({
      id: data.nextId++,
      time: game.state.time,
      kind,
      severity,
      message: message.slice(0, 1000),
      ...(entity ? { entity: reference(entity) } : {}),
      ...(good ? { good } : {}),
    });
    if (data.events.length > 200) data.events.splice(0, data.events.length - 200);
  }
  function currentReason(b: Building): AttentionReason | null {
    return (
      productionBlockage(b, game.BSPEC[b.type]) ||
      (b.done &&
      !deliberatePause(b) &&
      b.blockedReason === 'water' &&
      game.BSPEC[b.type].water &&
      !game.hasLocalWater(b)
        ? 'water'
        : null)
    );
  }
  function baseline(b: Building): IssueBaseline {
    const entry = {
      entity: reference(b),
      produced: (b.produced || 0) > 0,
      reason: currentReason(b),
      since: game.state.time,
      active: false,
    };
    data.conditions.push(entry);
    return entry;
  }
  function resolve(entry: IssueBaseline, explanation: string) {
    if (entry.active)
      append(
        'issue-resolved',
        game.BSPEC[entry.entity.type].name + ': ' + explanation,
        entry.entity,
      );
    entry.active = false;
  }
  function sample(force = false) {
    const bucket = Math.floor((game.state.time + 1e-9) * 2);
    if (!force && bucket === lastSample) return;
    lastSample = bucket;
    const live = new Set<number>();
    const known = new Map(data.conditions.map((entry) => [entry.entity.id, entry]));
    for (const b of game.buildings) {
      const sp = game.BSPEC[b.type];
      if (!b.done || !sp.prod || sp.prod === 'none') continue;
      live.add(b.id);
      const entry = known.get(b.id) || baseline(b),
        reason = currentReason(b);
      if (entry.reason !== reason) {
        resolve(
          entry,
          deliberatePause(b)
            ? 'alarm cleared: intentionally paused or demand/reserve satisfied.'
            : reason
              ? 'previous constraint ended; observing the new constraint.'
              : 'constraint cleared; production can resume.',
        );
        entry.reason = reason;
        entry.since = game.state.time;
      }
      if (reason && !entry.active && game.state.time - entry.since >= ATTENTION_DELAY - 1e-9) {
        entry.active = true;
        append(
          'issue-opened',
          sp.name +
            ': ' +
            labels[reason] +
            ' persisted for at least ' +
            ATTENTION_DELAY +
            ' simulation seconds.',
          b,
          'bottleneck',
          sp.out,
        );
      }
    }
    for (const entry of data.conditions)
      if (!live.has(entry.entity.id))
        resolve(entry, 'building no longer present. Former location retained.');
    data.conditions = data.conditions.filter((entry) => live.has(entry.entity.id));
  }
  game.gameEvents.on('simulationObserved', () => sample());
  game.gameEvents.on('productionControlChanged', () => sample(true));
  game.gameEvents.on('worldLoaded', (e) => {
    if (e.reason === 'new') data = freshAttention(game.state.time);
    lastSample = Math.floor((game.state.time + 1e-9) * 2);
    storageFailed = false;
    rendererFailed = false;
    // Historical saves begin coverage silently. Existing production is never a new start.
    for (const b of game.buildings)
      if (
        b.done &&
        game.BSPEC[b.type].prod &&
        game.BSPEC[b.type].prod !== 'none' &&
        !data.conditions.some((entry) => entry.entity.id === b.id)
      )
        baseline(b);
  });
  game.gameEvents.on('goodsProduced', (e) => {
    let entry = data.conditions.find((entry) => entry.entity.id === e.building.id);
    // A first output can occur before the first half-second observation.
    if (!entry) {
      entry = baseline(e.building);
      entry.produced = false;
    }
    if (!entry.produced) {
      append(
        'production-started',
        game.BSPEC[e.building.type].name + ': first observed production.',
        e.building,
        'info',
        e.good,
      );
      entry.produced = true;
    }
  });
  for (const [name, kind, suffix] of [
    ['buildingPlaced', 'building-placed', 'construction started.'],
    ['buildingCompleted', 'building-completed', 'construction completed.'],
  ] as const)
    game.gameEvents.on(name, (e) =>
      append(kind, game.BSPEC[e.building.type].name + ': ' + suffix, e.building),
    );
  game.gameEvents.on('buildingDemolished', (e) => {
    const entry = data.conditions.find((entry) => entry.entity.id === e.id);
    if (entry)
      resolve(entry, 'issue closed because the building was demolished. Former location retained.');
    data.conditions = data.conditions.filter((entry) => entry.entity.id !== e.id);
    append(
      'building-demolished',
      game.BSPEC[e.type].name + ': demolished. Former location retained.',
      e,
    );
  });
  game.gameEvents.on('roadBuilt', (e) => {
    if (e.count > 0) append('road-built', e.count + ' road tiles built.');
  });
  game.gameEvents.on('contractFulfilled', (e) =>
    append('contract', 'Contract fulfilled: ' + e.name),
  );
  game.gameEvents.on('upgradePurchased', (e) =>
    append(
      'upgrade',
      (e.kind === 'haul' ? 'Hauling' : 'Production') + ' upgrade purchased: level ' + e.level,
    ),
  );
  game.gameEvents.on('milestoneReached', (e) =>
    append('milestone', 'Milestone reached: ' + e.title),
  );
  game.gameEvents.on('firstGold', (e) =>
    append('first-gold', 'First gold delivered.', e.building, 'info', 'gold'),
  );
  game.gameEvents.on('outpostManned', (e) =>
    append('outpost', 'Outpost manned; territory expanded.', e.building),
  );
  game.gameEvents.on('victory', (e) =>
    append('victory', 'Gold objective reached: ' + e.gold + ' gold.'),
  );
  game.gameEvents.on('saveHealthChanged', (e) => {
    if (!e.ok && !storageFailed) append('storage-failed', e.message, undefined, 'urgent');
    if (e.ok && storageFailed)
      append('storage-recovered', 'Browser storage recovered. ' + e.message);
    storageFailed = !e.ok;
  });
  game.gameEvents.on('rendererFailed', (e) => {
    if (!rendererFailed)
      append('renderer-failed', 'Graphics failure: ' + e.reason, undefined, 'urgent');
    rendererFailed = true;
  });

  function activeAttention(): AttentionIssue[] {
    const transport = game.currentTransport();
    return data.conditions.flatMap((entry) => {
      const b = game.byId(entry.entity.id);
      if (!entry.active || !b || currentReason(b) !== entry.reason) return [];
      const sp = game.BSPEC[b.type],
        goods: Good[] = [],
        evidence: string[] = [],
        contributors: EntityReference[] = [];
      let title = labels[entry.reason],
        advice = '';
      if (entry.reason === 'inputs') {
        let hasMissing = false,
          hasDelayed = false;
        for (const shortage of ingredientShortages(b, sp)) {
          const alternatives = ingredientAlternatives(sp, shortage.good);
          goods.push(...alternatives);
          const deliveries = transport.rows.filter(
            (row) => row.targetId === b.id && alternatives.includes(row.good),
          );
          const stages = ['queued', 'assigned', 'carrying', 'unknown']
            .map(
              (stage) => [stage, deliveries.filter((row) => row.stage === stage).length] as const,
            )
            .filter(([, count]) => count);
          const available = alternatives.reduce((sum, good) => sum + game.availGood(good, b), 0);
          const label = alternatives.map((good) => game.GOODS[good].name).join(' or ');
          evidence.push(
            label +
              ': local input ' +
              shortage.have +
              '/' +
              shortage.need +
              '; ' +
              (stages.length
                ? stages
                    .map(
                      ([stage, count]) =>
                        count +
                        ' ' +
                        (stage === 'unknown' ? 'assignment evidence unavailable' : stage),
                    )
                    .join(', ')
                : 'no matching delivery job') +
              '.',
          );
          if (deliveries.length) {
            hasDelayed = true;
            evidence.push(
              'Supply has a delivery request; queued and assigned goods are not physically carried.',
            );
          } else if (available <= 0) {
            hasMissing = true;
            evidence.push(
              'No reachable available stored ' +
                label +
                '. This is missing accessible supply, not proof that no producer exists.',
            );
          } else {
            hasDelayed = true;
            evidence.push(
              available +
                ' reachable available stored units; no delivery request is currently recorded. Scheduling/route cause is unavailable.',
            );
          }
          for (const other of game.buildings)
            if (other.done && alternatives.includes(game.BSPEC[other.type].out))
              contributors.push(reference(other));
        }
        title =
          hasMissing && hasDelayed
            ? 'Missing supply and waiting deliveries'
            : hasMissing
              ? 'Missing accessible supply'
              : 'Waiting for input delivery';
        advice =
          'Inspect the affected recipe and suppliers. Use Economy to check stock and creation; Logistics shows current delivery stages. No measured ETA is recorded.';
      } else if (entry.reason === 'output') {
        if (sp.out) goods.push(sp.out);
        const rows = transport.rows.filter(
          (row) => row.sourceId === b.id && row.kind === 'deliver',
        );
        evidence.push(
          (b.stock[sp.out] || 0) +
            ' ' +
            game.GOODS[sp.out].name +
            ` awaiting collection; the next batch would exceed the local output limit of ${productionOutputLimit}.`,
          rows.length
            ? rows
                .map((row) =>
                  row.stage === 'unknown' ? 'Assignment evidence unavailable' : row.stage,
                )
                .join(', ') + ' collection jobs.'
            : 'No collection job currently recorded.',
        );
        advice =
          'Inspect storage capacity and current carrier workload in Logistics. A road may improve an existing land route; it does not create carrier capacity.';
      } else if (entry.reason === 'water') {
        evidence.push(
          'No completed, enabled well within 6 tiles and connected by land currently supports this building. Water is local support, not a transported inventory good.',
        );
        advice =
          'Inspect or build a well within its support radius; complete and enable it, and preserve a land connection. Carrier jobs and transported provisions cannot substitute for local water.';
      } else {
        evidence.push(
          entry.reason === 'exhausted'
            ? 'The producer records its deposit as exhausted.'
            : 'The producer records no usable local gathering resource. This is local evidence, not a global stock shortage.',
        );
        advice =
          'Inspect the local gathering area. A forester can replenish nearby trees; exhausted rocks and mineral deposits do not regrow. Locate explicitly to review another site.';
      }
      return [
        {
          key: 'building-' + b.id,
          severity: 'bottleneck' as const,
          since: entry.since,
          reason: entry.reason,
          entity: reference(b),
          title,
          evidence,
          advice,
          goods: [...new Set(goods)],
          contributors: [...new Map(contributors.map((ref) => [ref.id, ref])).values()],
        },
      ];
    });
  }
  return {
    get attentionData() {
      return data;
    },
    set attentionData(next) {
      data = next;
      lastSample = Math.floor((game.state.time + 1e-9) * 2);
    },
    activeAttention,
    activityHistory: () => structuredClone({ started: data.started, events: data.events }),
  };
}
export interface AttentionSubsystem {
  attentionData: AttentionData;
  activeAttention: () => AttentionIssue[];
  activityHistory: () => { started: number; events: ActivityEvent[] };
}
export interface AttentionDependencies
  extends
    Pick<SimulationStateSubsystem, 'state' | 'buildings' | 'BSPEC' | 'GOODS'>,
    Pick<EventsSubsystem, 'gameEvents'>,
    Pick<EconomySubsystem, 'byId' | 'availGood' | 'hasLocalWater'>,
    Pick<TransportSubsystem, 'currentTransport'> {}
