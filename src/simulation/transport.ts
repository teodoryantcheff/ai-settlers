import type { Building, Good, Job, TilePoint, Unit } from '../types.ts';
import type { SimulationStateSubsystem } from './state.ts';
import type { WorldSubsystem } from '../core/world.ts';
import type { EconomySubsystem } from './economy.ts';

import { deliveryStage } from './delivery-stage.ts';
import type { DeliveryStage } from './delivery-stage.ts';
export type { DeliveryStage } from './delivery-stage.ts';
export interface TransportEndpoint extends TilePoint {
  id: number;
  type: Building['type'];
  done: boolean;
}
export interface TransportRoute {
  points: TilePoint[];
  next: number;
}
export interface TransportRow {
  key: string;
  kind: Exclude<Job['kind'], 'soldier'> | 'recovered';
  stage: DeliveryStage;
  good: Good;
  source: TransportEndpoint | null;
  sourceId: number | null;
  target: TransportEndpoint | null;
  targetId: number | null;
  carrierId: number | null;
  position: TilePoint | null;
  route: TransportRoute | null;
}
export interface CarrierWorkload {
  id: number;
  position: TilePoint;
  cargo: Good | null;
  state: 'idle' | 'pickup' | 'carrying' | 'moving';
  route: TransportRoute | null;
}
export interface TransportSnapshot {
  rows: TransportRow[];
  carriers: CarrierWorkload[];
  deployments: number;
}

/** Read projections never plan routes or mutate jobs. Transient keys retain DOM focus as jobs move. */
export function createTransport(game: TransportDependencies): TransportSubsystem {
  const keys = new WeakMap<Job, string>();
  let nextKey = 1;
  function endpoint(id: number | null | undefined): TransportEndpoint | null {
    const building = id ? game.byId(id) : null;
    return building
      ? { id: building.id, type: building.type, x: building.x, y: building.y, done: building.done }
      : null;
  }
  function route(unit: Unit | undefined): TransportRoute | null {
    return unit?.path?.length
      ? {
          points: unit.path.map((index) => ({ x: index % game.W, y: Math.floor(index / game.W) })),
          next: unit.pi,
        }
      : null;
  }
  function currentTransport(): TransportSnapshot {
    const carriers = game.units.filter((unit) => !unit.dead && unit.kind === 'carrier');
    const liveJobs = new Set(game.jobs);
    const rows: TransportRow[] = [];
    for (const job of game.jobs) {
      if (job.kind === 'soldier' || !job.good) continue;
      let key = keys.get(job);
      if (!key) {
        key = 'job-' + nextKey++;
        keys.set(job, key);
      }
      const unit = carriers.find((carrier) => carrier.job === job);
      const sourceId = job.kind === 'deliver' ? job.from : job.s;
      const targetId = unit?.carry ? unit.dropB : job.to;
      rows.push({
        key,
        kind: job.kind,
        good: unit?.carry || job.good,
        stage: deliveryStage(job, unit),
        source: endpoint(sourceId),
        sourceId: sourceId || null,
        target: endpoint(targetId),
        targetId: targetId || null,
        carrierId: unit?.id || null,
        position: unit ? { x: unit.x, y: unit.y } : null,
        route: route(unit),
      });
    }
    for (const unit of carriers) {
      if (!unit.carry || (unit.job && liveJobs.has(unit.job))) continue;
      rows.push({
        key: 'cargo-' + unit.id,
        kind: 'recovered',
        stage: 'carrying',
        good: unit.carry,
        source: endpoint(unit.carryProducer),
        sourceId: unit.carryProducer || null,
        target: endpoint(unit.dropB),
        targetId: unit.dropB,
        carrierId: unit.id,
        position: { x: unit.x, y: unit.y },
        route: route(unit),
      });
    }
    return {
      rows,
      carriers: carriers.map((unit) => ({
        id: unit.id,
        position: { x: unit.x, y: unit.y },
        cargo: unit.carry,
        state: unit.carry
          ? 'carrying'
          : unit.job
            ? 'pickup'
            : unit.phase === 'idle'
              ? 'idle'
              : 'moving',
        route: route(unit),
      })),
      deployments: game.jobs.filter((job) => job.kind === 'soldier').length,
    };
  }
  return { currentTransport };
}
export interface TransportSubsystem {
  currentTransport: () => TransportSnapshot;
}
export interface TransportDependencies
  extends
    Pick<SimulationStateSubsystem, 'jobs' | 'units'>,
    Pick<WorldSubsystem, 'W'>,
    Pick<EconomySubsystem, 'byId'> {}
