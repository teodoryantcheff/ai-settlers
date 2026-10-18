import { validateAttention } from '../observations/validate-attention.ts';
import { saveName } from './save-catalog.ts';
import { unpackSaveHistories } from './save-codec.ts';
import { ECONOMIC_FLOWS, emptyEconomicTotals } from '../simulation/observations.ts';
import { ingredientAlternatives } from '../gameplay/production-rules.ts';
import type {
  Building,
  EconomicTotals,
  EconomicObservations,
  EconomicSample,
  CargoSample,
  BuildingSpec,
  BuildingType,
  Good,
  Inventory,
  Job,
  ProductionBlockReason,
  ProductionMetrics,
  ProductionSample,
  SavedUnit,
  SaveData,
  ValidatedSave,
  SimulationState,
} from '../types.ts';

export interface EventBus<Events extends object> {
  on<K extends keyof Events>(name: K, listener: (payload: Events[K]) => void): () => boolean;
  emit<K extends keyof Events>(name: K, payload: Events[K]): void;
}

/** Presentation consumers subscribe without coupling the simulation to DOM or audio. */
export function createEventBus<
  Events extends object = Record<string, unknown>,
>(): EventBus<Events> {
  // Keyed by event name, so each set only ever receives its own event's payload.
  const listeners: { [K in keyof Events]?: Set<(payload: Events[K]) => void> } =
    Object.create(null);
  return {
    on(name, listener) {
      const named = (listeners[name] ??= new Set());
      named.add(listener);
      return () => named.delete(listener);
    },
    emit(name, payload) {
      for (const listener of listeners[name] || []) listener(payload);
    },
  };
}

// A record, so adding a reason to ProductionBlockReason cannot be missed here.
const BLOCK_REASONS: Record<ProductionBlockReason, true> = {
  '': true,
  paused: true,
  exhausted: true,
  output: true,
  demand: true,
  reserve: true,
  water: true,
  inputs: true,
  resources: true,
};

/**
 * Validate and normalize a save before changing either the running world or storage.
 * Validation rewrites fields of its input, so it works on a copy unless the caller passes
 * `detached` for input nothing else references (a fresh snapshot or freshly parsed JSON).
 */
export function validateSave(
  input: unknown,
  width: number,
  height: number,
  specs: Record<BuildingType, BuildingSpec>,
  goods: Record<Good, { name: string; c: string }>,
  detached = false,
): ValidatedSave {
  const fail: (message: string) => never = (message) => {
    throw new Error(message);
  };
  // Imported JSON remains dynamically shaped until every schema field is validated.
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !array(v);
  const array = (v: unknown): v is unknown[] => Array.isArray(v);
  const knownKey = <K extends string>(table: Record<K, unknown>, v: unknown): v is K =>
    typeof v === 'string' && Object.hasOwn(table, v);
  const oneOf = <T extends string | number>(v: unknown, values: readonly T[]): v is T =>
    values.some((value) => value === v);
  const num = (v: unknown, min = 0, max = 1e9): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const int = (v: unknown, min = 0, max = 1e9): v is number =>
    Number.isInteger(v) && num(v, min, max);
  const bool = (v: unknown): v is boolean => typeof v === 'boolean';
  const record = (v: unknown, max = 1e7): Inventory => {
    if (!object(v)) fail('Invalid resource table');
    const out: Inventory = {};
    for (const [key, value] of Object.entries(v)) {
      if (!knownKey(goods, key) || !int(value, 0, max)) fail('Invalid resource quantity');
      out[key] = value;
    }
    return out;
  };
  // A cumulative sample never exceeds its total nor falls below the previous sample. Checked
  // records hold only nonnegative amounts, so a good absent from both is 0 and needs no visit.
  const bounded = (amounts: Inventory, total: Inventory | undefined, before?: Inventory) => {
    for (const key in amounts) {
      const good = key as Good;
      const amount = amounts[good] || 0;
      if (amount > (total?.[good] || 0) || amount < (before?.[good] || 0)) return false;
    }
    if (before)
      for (const key in before)
        if (!Object.hasOwn(amounts, key) && before[key as Good]) return false;
    return true;
  };
  const size = width * height;
  // Only the current structure loads; marked historical saves are never adopted.
  if (!object(input) || Object.hasOwn(input, 'v') || Object.hasOwn(input, 'economy'))
    fail('Unsupported save format');
  const d = detached ? input : structuredClone(input);
  // Packed sample histories become plain samples before any rule checks them.
  unpackSaveHistories(d, fail);
  if (!int(d.seed, -2147483648, 2147483647) || !int(d.nextId, 1) || !array(d.t) || d.t.length !== 5)
    fail('Invalid world header');
  const terrain = d.t;
  if (!terrain.every((a): a is unknown[] => array(a) && a.length === size))
    fail('Wrong map dimensions');
  for (let i = 0; i < size; i++) {
    if (
      !int(terrain[0][i], 0, 3) ||
      !int(terrain[1][i], 0, 4) ||
      !int(terrain[2][i], 0, 1e6) ||
      !oneOf(terrain[3][i], [0, 1])
    )
      fail('Invalid terrain');
    const r = terrain[4][i];
    if (
      r !== null &&
      (!array(r) ||
        ![2, 3].includes(r.length) ||
        !oneOf(r[0], ['gold', 'iron', 'coal']) ||
        !int(r[1], 0, 1e6) ||
        (r.length === 3 && !int(r[2], 0, 1e6)) ||
        terrain[0][i] !== 3)
    )
      fail('Invalid deposit');
  }
  if (
    !array(d.b) ||
    d.b.length < 1 ||
    d.b.length > size ||
    !array(d.j) ||
    d.j.length > 50000 ||
    !array(d.u) ||
    d.u.length > 5000
  )
    fail('Invalid entity arrays');
  // Hydrate only checked fields; imported own __proto__ keys never reach live entities.
  // Only the terrain columns are asserted here, after validating every cell.
  const checkedTerrain = terrain as SaveData['t'];
  const pick = <R extends object>(value: object, keys: string[]): R =>
    Object.fromEntries(keys.map((key) => [key, (value as Record<string, unknown>)[key]])) as R;
  const checkedBuildings: Building[] = [];
  const checkedJobs: Job[] = [];
  const checkedUnits: SavedUnit[] = [];
  const ids = new Set<number>();
  const positions = new Set();
  for (const b of d.b) {
    if (!object(b)) fail('Invalid building');
    if (
      !int(b.id, 1) ||
      ids.has(b.id) ||
      !knownKey(specs, b.type) ||
      !int(b.x, 0, width - 1) ||
      !int(b.y, 0, height - 1) ||
      !bool(b.done) ||
      !num(b.constructionProgress, 0, 2) ||
      !num(b.timer, -100, 1e6) ||
      !oneOf(b.priority, [0, 1, 2]) ||
      !int(b.produced) ||
      !bool(b.disabled) ||
      !bool(b.manned) ||
      !bool(b.exhausted) ||
      !bool(b.foodBlockedNoticeSent) ||
      !bool(b.rocksExhaustedNoticeSent) ||
      !knownKey(BLOCK_REASONS, b.blockedReason)
    )
      fail('Invalid building');
    // An old armory is otherwise canonical and would silently switch recipes.
    if (Object.hasOwn(b, 'legacyIndustry')) fail('Unsupported legacy industry');
    const pos = b.y * width + b.x;
    if (positions.has(pos) || oneOf(terrain[0][pos], [0, 3])) fail('Invalid building site');
    positions.add(pos);
    ids.add(b.id);
    for (const key of ['needs', 'got', 'stock', 'reservedStock'] as const) b[key] = record(b[key]);
    b.targets = record(b.targets, 500);
    const m = b.metrics;
    if (!object(m)) fail('Invalid production metrics');
    const metrics = {} as ProductionMetrics;
    b.metrics = metrics;
    for (const key of ['elapsed', 'active', 'blocked', 'inputBlocked', 'outputBlocked'] as const) {
      const value = m[key];
      if (!num(value)) fail('Invalid production metrics');
      metrics[key] = value;
    }
    for (const key of [
      'produced',
      'consumed',
      'delivered',
      'inputDelivered',
      'outputDelivered',
    ] as const)
      metrics[key] = record(m[key]);
    if (!num(m.deliveryStarted, 0, metrics.elapsed)) fail('Invalid production delivery coverage');
    metrics.deliveryStarted = m.deliveryStarted;
    const flowKeys = ['produced', 'consumed', 'inputDelivered', 'outputDelivered'] as const;
    if (!array(m.recent) || !m.recent.length || m.recent.length > 301)
      fail('Invalid production history');
    let previous: ProductionSample | null = null;
    metrics.recent = m.recent.map((sample) => {
      if (
        !object(sample) ||
        !num(sample.elapsed, Math.max(0, metrics.elapsed - 600 - 1e-9), metrics.elapsed) ||
        !num(sample.inputBlocked, 0, metrics.inputBlocked) ||
        (previous &&
          ((sample.elapsed as number) <= previous.elapsed ||
            (sample.inputBlocked as number) < previous.inputBlocked))
      )
        fail('Invalid production history coverage');
      const clean = {
        elapsed: sample.elapsed,
        inputBlocked: sample.inputBlocked,
      } as ProductionSample;
      for (const key of flowKeys) {
        if (!object(sample[key])) fail('Invalid production history flow');
        clean[key] = record(sample[key]);
        if (!bounded(clean[key], metrics[key], previous?.[key]))
          fail('Invalid production history totals');
      }
      previous = clean;
      return clean;
    });
    checkedBuildings.push(
      pick<Building>(b, [
        'id',
        'type',
        'x',
        'y',
        'done',
        'constructionProgress',
        'needs',
        'got',
        'stock',
        'reservedStock',
        'manned',
        'exhausted',
        'produced',
        'timer',
        'foodBlockedNoticeSent',
        'rocksExhaustedNoticeSent',
        'metrics',
        'blockedReason',
        'priority',
        'targets',
        'disabled',
      ]),
    );
  }
  if (checkedBuildings.filter((b) => b.type === 'hq' && b.done).length !== 1)
    fail('Missing headquarters');
  const buildings = new Map<number, Building>(checkedBuildings.map((b) => [b.id, b]));
  for (const j of d.j) {
    if (!object(j)) fail('Invalid job');
    if (
      !oneOf(j.kind, ['fetch', 'deliver', 'soldier', 'transfer']) ||
      !oneOf(j.status, ['pending', 'assigned'])
    )
      fail('Invalid job');
    if (j.good !== null && j.good !== undefined && !knownKey(goods, j.good)) fail('Invalid cargo');
    if (j.kind !== 'soldier' && !knownKey(goods, j.good)) fail('Invalid cargo');
    for (const key of ['to', 'sourceId'] as const)
      if (j[key] !== undefined && !int(j[key])) fail('Invalid job reference');
    const target = typeof j.to === 'number' ? buildings.get(j.to) : undefined;
    const source = typeof j.sourceId === 'number' ? buildings.get(j.sourceId) : undefined;
    if ((j.kind === 'fetch' || j.kind === 'soldier' || j.kind === 'transfer') && !target)
      fail('Missing job destination');
    if (j.kind === 'fetch' && (!source || !source.done || !specs[source.type].store))
      fail('Missing source store');
    if ((j.kind === 'deliver' || j.kind === 'transfer') && !source) fail('Missing job source');
    if (
      j.kind === 'transfer' &&
      (!source ||
        !target ||
        !source.done ||
        !target.done ||
        !specs[source.type].store ||
        !specs[target.type].store)
    )
      fail('Invalid transfer');
    if (j.kind === 'fetch') {
      if (!target || !knownKey(goods, j.good)) fail('Invalid fetch destination');
      // A mine's food requirement accepts any edible good.
      const needed = target.done ? specs[target.type].in : target.needs;
      const meal =
        target.done &&
        specs[target.type].prod === 'mine' &&
        ingredientAlternatives(specs[target.type], 'food').includes(j.good);
      if ((!needed || !needed[j.good]) && !meal) fail('Invalid fetch destination');
    }
    if (j.kind === 'deliver') {
      if (!source) fail('Missing job source');
      if (!source.done || specs[source.type].out !== j.good) fail('Invalid delivery source');
    }
    if (
      j.kind === 'soldier' &&
      (!target || !target.done || !specs[target.type].guard || target.manned)
    )
      fail('Invalid soldier destination');
    const status = j.status;
    if (j.kind === 'soldier') {
      if (!int(j.to, 1)) fail('Missing job destination');
      checkedJobs.push({ kind: j.kind, to: j.to, status });
    } else {
      if (!knownKey(goods, j.good) || !int(j.sourceId, 1)) fail('Missing job source');
      if (j.kind === 'deliver')
        checkedJobs.push({ kind: j.kind, good: j.good, sourceId: j.sourceId, status });
      else {
        if (!int(j.to, 1)) fail('Missing job destination');
        const cargo = { good: j.good, sourceId: j.sourceId, to: j.to, status };
        checkedJobs.push(
          j.kind === 'fetch' ? { kind: 'fetch', ...cargo } : { kind: 'transfer', ...cargo },
        );
      }
    }
  }
  const jobOwners = new Set();
  const ownerByJob = new Map<number, SavedUnit>();
  for (const u of d.u) {
    if (
      !object(u) ||
      !int(u.id, 1) ||
      ids.has(u.id) ||
      !oneOf(u.kind, ['carrier', 'soldier']) ||
      !num(u.x, 0, width) ||
      !num(u.y, 0, height) ||
      !oneOf(u.phase, ['idle', 'p', 'd']) ||
      !int(u.ji, -1, checkedJobs.length - 1) ||
      !num(u.lx, -1, 1) ||
      !num(u.ly, -1, 1)
    )
      fail('Invalid settler');
    ids.add(u.id);
    if (u.carry !== null && !knownKey(goods, u.carry)) fail('Invalid carried resource');
    if (
      u.path !== null &&
      (!array(u.path) ||
        u.path.length > size * 2 ||
        !u.path.every((n) => int(n, 0, size - 1) && !oneOf(terrain[0][n], [0, 3])))
    )
      fail('Invalid route');
    if (!int(u.pi, 0, array(u.path) ? u.path.length : size * 2)) fail('Invalid route progress');
    if (u.dropB !== null && (!int(u.dropB) || (u.dropB !== 0 && !buildings.has(u.dropB))))
      fail('Missing drop destination');
    if (u.ji >= 0) {
      if (jobOwners.has(u.ji) || checkedJobs[u.ji].status !== 'assigned')
        fail('Invalid job ownership');
      jobOwners.add(u.ji);
    }
    if (!bool(u.carryTransfer)) fail('Invalid cargo origin');
    const job = u.ji >= 0 ? checkedJobs[u.ji] : null;
    if (
      !bool(u.carryWarehouseTransfer) ||
      (u.carryWarehouseTransfer &&
        (!u.carry ||
          !u.carryTransfer ||
          u.kind !== 'carrier' ||
          u.phase !== 'd' ||
          (job && job.kind !== 'transfer')))
    )
      fail('Invalid warehouse-transfer cargo origin');
    if (u.carryProducer !== null) {
      if (
        !int(u.carryProducer, 1, d.nextId - 1) ||
        !u.carry ||
        u.carryTransfer ||
        u.kind !== 'carrier' ||
        u.phase !== 'd' ||
        (job && (job.kind !== 'deliver' || job.sourceId !== u.carryProducer))
      )
        fail('Invalid producer cargo origin');
      const source = buildings.get(u.carryProducer);
      if (source && (!source.done || specs[source.type].out !== u.carry))
        fail('Invalid producer cargo source');
    }
    if (u.kind === 'soldier') {
      if (
        !job ||
        job.kind !== 'soldier' ||
        u.phase !== 'd' ||
        u.carry ||
        u.carryTransfer ||
        u.dropIsSite ||
        !u.path ||
        u.dropB !== job.to
      )
        fail('Invalid soldier assignment');
    } else if (u.phase === 'idle') {
      if (job || u.carry || u.path || u.carryTransfer) fail('Invalid idle carrier');
    } else {
      if (!u.path || (job && job.kind === 'soldier')) fail('Invalid carrier assignment');
      if (u.phase === 'p') {
        if (!job || u.carry || u.carryTransfer) fail('Invalid pickup assignment');
      } else {
        if (!u.carry || (job && u.carry !== job.good)) fail('Invalid delivery cargo');
        if (job && u.carryTransfer !== ['fetch', 'transfer'].includes(job.kind))
          fail('Invalid cargo origin');
        if (
          u.dropIsSite &&
          (!job || !['fetch', 'transfer'].includes(job.kind) || u.dropB !== job.to)
        )
          fail('Invalid delivery destination');
      }
    }
    if (!num(u.walkDistance) || !num(u.faceDX, -1, 1) || !num(u.faceDY, -1, 1))
      fail('Invalid settler');
    if (!bool(u.dropIsSite)) fail('Invalid delivery destination');
    const unit = pick<SavedUnit>(u, [
      'id',
      'kind',
      'x',
      'y',
      'path',
      'pi',
      'phase',
      'ji',
      'carry',
      'dropB',
      'dropIsSite',
      'carryTransfer',
      'carryWarehouseTransfer',
      'carryProducer',
      'lx',
      'ly',
      'walkDistance',
      'faceDX',
      'faceDY',
    ]);
    checkedUnits.push(unit);
    if (unit.ji >= 0) ownerByJob.set(unit.ji, unit);
  }
  const reservations = new Map();
  for (let i = 0; i < checkedJobs.length; i++) {
    const j = checkedJobs[i];
    const owner = ownerByJob.get(i);
    if (['fetch', 'transfer'].includes(j.kind) && (!owner || !owner.carry)) {
      const key = j.sourceId + '/' + j.good;
      reservations.set(key, (reservations.get(key) || 0) + 1);
    }
  }
  for (const b of checkedBuildings) {
    for (const good of Object.keys(goods) as Good[]) {
      if (
        (b.reservedStock[good] || 0) !== (reservations.get(b.id + '/' + good) || 0) ||
        (b.reservedStock[good] || 0) > (b.stock[good] || 0)
      )
        fail('Invalid resource reservations');
    }
  }
  if (ids.size && d.nextId <= Math.max(...ids)) fail('Invalid next entity ID');
  if (checkedJobs.some((j, i) => j.status === 'assigned' && !jobOwners.has(i)))
    fail('Unowned active job');
  if (
    !object(d.st) ||
    !oneOf(d.st.speed, [1, 2, 4, 8]) ||
    !num(d.st.time) ||
    !int(d.st.gold) ||
    !bool(d.st.paused) ||
    !bool(d.st.won) ||
    !bool(d.st.auto) ||
    !int(d.st.spentGold) ||
    !int(d.st.goldDelivered) ||
    !int(d.st.roadsBuilt) ||
    !array(d.st.contracts) ||
    !d.st.contracts.every((x) => int(x, 0, 5)) ||
    !array(d.st.milestones) ||
    !d.st.milestones.every((x) => int(x, 0, 5)) ||
    !object(d.st.upgrades) ||
    !int(d.st.upgrades.haul, 0, 3) ||
    !int(d.st.upgrades.production, 0, 3)
  )
    fail('Invalid simulation state');
  if (!object(d.p)) fail('Invalid simulation pools');
  for (const k of ['serfPool', 'soldierPool'] as const)
    if (!int(d.p[k], 0, 1e5)) fail('Invalid population');
  for (const k of ['spawnT', 'serfT', 'solT'] as const)
    if (!num(d.p[k], -100, 1e6)) fail('Invalid timer');
  for (const k of ['assignT', 'autoT'] as const) if (!num(d.p[k], -100, 10)) fail('Invalid timer');
  if (!num(d.p.treeGrowthT, 0, 1)) fail('Invalid timer');
  if (!int(d.rng, -2147483648, 4294967295)) fail('Invalid RNG state');
  d.b = checkedBuildings;
  d.j = checkedJobs;
  d.u = checkedUnits;
  const state: SimulationState = {
    paused: d.st.paused,
    speed: d.st.speed,
    won: d.st.won,
    time: d.st.time,
    gold: d.st.gold,
    auto: d.st.auto,
    upgrades: { haul: d.st.upgrades.haul, production: d.st.upgrades.production },
    spentGold: d.st.spentGold,
    goldDelivered: d.st.goldDelivered,
    contracts: [...d.st.contracts],
    milestones: [...d.st.milestones],
    roadsBuilt: d.st.roadsBuilt,
  };
  d.st = state;
  const obs = d.observations;
  if (
    !object(obs) ||
    !num(obs.started, 0, state.time) ||
    !array(obs.recent) ||
    !obs.recent.length ||
    obs.recent.length > 301
  )
    fail('Invalid economic observations');
  const totals = (raw: unknown): EconomicTotals => {
    if (!object(raw)) fail('Invalid economic observation totals');
    const clean = emptyEconomicTotals();
    for (const flow of ECONOMIC_FLOWS) {
      if (!Object.hasOwn(raw, flow)) fail('Missing economic observation flow');
      clean[flow] = record(raw[flow], 1e9);
    }
    return clean;
  };
  const current = totals(obs.totals);
  const started = obs.started;
  let previous: EconomicSample | null = null;
  const recent = obs.recent.map((raw): EconomicSample => {
    if (
      !object(raw) ||
      !num(raw.time, Math.max(started, state.time - 600 - 1e-9), state.time) ||
      (previous && raw.time <= previous.time)
    )
      fail('Invalid economic observation coverage');
    const sample: EconomicSample = { time: raw.time, totals: totals(raw.totals) };
    for (const flow of ECONOMIC_FLOWS)
      if (!bounded(sample.totals[flow], current[flow], previous?.totals[flow]))
        fail('Invalid economic observation sequence');
    previous = sample;
    return sample;
  });
  const rawCargo = obs.cargo;
  if (
    !object(rawCargo) ||
    !object(rawCargo.totals) ||
    !num(rawCargo.started, 0, state.time) ||
    !array(rawCargo.recent) ||
    !rawCargo.recent.length ||
    rawCargo.recent.length > 301
  )
    fail('Invalid cargo arrival observations');
  const cargoTotals = record(rawCargo.totals, 1e9);
  const cargoStarted = rawCargo.started;
  let previousCargo: CargoSample | null = null;
  const cargoRecent = rawCargo.recent.map((raw): CargoSample => {
    if (
      !object(raw) ||
      !object(raw.totals) ||
      !num(raw.time, Math.max(cargoStarted, state.time - 600 - 1e-9), state.time) ||
      (previousCargo && raw.time <= previousCargo.time)
    )
      fail('Invalid cargo arrival coverage');
    const sample = { time: raw.time, totals: record(raw.totals, 1e9) };
    if (!bounded(sample.totals, cargoTotals, previousCargo?.totals))
      fail('Invalid cargo arrival sequence');
    previousCargo = sample;
    return sample;
  });
  const cargo = { started: rawCargo.started, totals: cargoTotals, recent: cargoRecent };
  const observations: EconomicObservations = {
    started: obs.started,
    totals: current,
    recent,
    cargo,
  };
  d.observations = observations;
  if (!object(d.identity) || !Object.hasOwn(d.identity, 'name')) fail('Invalid colony identity');
  const identity = { name: saveName(d.identity.name) };
  d.identity = identity;
  const attention = validateAttention(
    d.attention,
    state.time,
    width,
    height,
    specs,
    goods,
    checkedBuildings,
    d.nextId,
  );
  d.attention = attention;
  return {
    rng: d.rng,
    seed: d.seed,
    nextId: d.nextId,
    t: checkedTerrain,
    b: checkedBuildings,
    j: checkedJobs,
    u: checkedUnits,
    st: state,
    // Every pool and timer was checked above.
    p: d.p as SaveData['p'],
    identity,
    observations,
    attention,
  };
}
