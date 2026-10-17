import {
  ACTIVITY_KINDS,
  type AttentionData,
  type EntityReference,
  type IssueBaseline,
  type ActivityEvent,
  type AttentionReason,
} from './attention.ts';
import type { BuildingType, Good, Building, BuildingSpec } from '../types.ts';
const attentionReasons: readonly AttentionReason[] = [
  'inputs',
  'output',
  'resources',
  'exhausted',
  'water',
];
/** Standalone schema boundary. Historical references need not identify a live entity. */
export function validateAttention(
  raw: unknown,
  time: number,
  width: number,
  height: number,
  specs: Record<BuildingType, BuildingSpec>,
  goods: object,
  buildings: Building[],
  nextEntityId: number,
): AttentionData {
  const fail: () => never = () => {
    throw new Error('Invalid attention/activity history');
  };
  const obj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const num = (v: unknown, max = time): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  const int = (v: unknown, max = 1e9): v is number => num(v, max) && Number.isInteger(v);
  const entity = (v: unknown): EntityReference => {
    if (
      !obj(v) ||
      !int(v.id) ||
      v.id < 1 ||
      v.id >= nextEntityId ||
      typeof v.type !== 'string' ||
      !Object.hasOwn(specs, v.type) ||
      !int(v.x, width - 1) ||
      !int(v.y, height - 1)
    )
      fail();
    return { id: v.id as number, type: v.type as BuildingType, x: v.x as number, y: v.y as number };
  };
  if (
    !obj(raw) ||
    !num(raw.started) ||
    !int(raw.nextId) ||
    raw.nextId < 1 ||
    !Array.isArray(raw.events) ||
    raw.events.length > 200 ||
    !Array.isArray(raw.conditions) ||
    raw.conditions.length > width * height
  )
    fail();
  let priorId = 0,
    priorTime = raw.started as number;
  const events = (raw.events as unknown[]).map((value): ActivityEvent => {
    if (
      !obj(value) ||
      !int(value.id) ||
      value.id <= priorId ||
      value.id >= (raw.nextId as number) ||
      !num(value.time) ||
      value.time < priorTime ||
      !ACTIVITY_KINDS.includes(value.kind as ActivityEvent['kind']) ||
      !['urgent', 'bottleneck', 'info'].includes(value.severity as string) ||
      typeof value.message !== 'string' ||
      !value.message.trim() ||
      value.message.length > 1000 ||
      (value.good !== undefined &&
        (typeof value.good !== 'string' || !Object.hasOwn(goods, value.good)))
    )
      fail();
    priorId = value.id as number;
    priorTime = value.time as number;
    return {
      id: priorId,
      time: priorTime,
      kind: value.kind as ActivityEvent['kind'],
      severity: value.severity as ActivityEvent['severity'],
      message: value.message as string,
      ...(value.entity !== undefined ? { entity: entity(value.entity) } : {}),
      ...(value.good !== undefined ? { good: value.good as Good } : {}),
    };
  });
  const seen = new Set<number>();
  const conditions = (raw.conditions as unknown[]).map((value): IssueBaseline => {
    if (
      !obj(value) ||
      typeof value.produced !== 'boolean' ||
      typeof value.active !== 'boolean' ||
      !num(value.since) ||
      value.since < (raw.started as number) ||
      (value.reason !== null && !attentionReasons.includes(value.reason as AttentionReason)) ||
      (value.active && value.reason === null) ||
      (value.active && time - (value.since as number) < 12 - 1e-9)
    )
      fail();
    const ref = entity(value.entity),
      live = buildings.find((b) => b.id === ref.id);
    if (
      seen.has(ref.id) ||
      !live ||
      !live.done ||
      !specs[live.type].prod ||
      specs[live.type].prod === 'none' ||
      live.type !== ref.type ||
      live.x !== ref.x ||
      live.y !== ref.y ||
      value.produced !== (live.produced || 0) > 0
    )
      fail();
    seen.add(ref.id);
    return {
      entity: ref,
      produced: value.produced as boolean,
      active: value.active as boolean,
      since: value.since as number,
      reason: value.reason as IssueBaseline['reason'],
    };
  });
  return { started: raw.started as number, nextId: raw.nextId as number, events, conditions };
}
