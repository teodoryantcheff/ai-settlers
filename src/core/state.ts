import { validateAttention } from '../observations/validate-attention.ts';
import { saveName } from './save-catalog.ts';
import {
  ECONOMIC_FLOWS,
  emptyEconomicTotals,
  freshEconomicObservations,
  freshCargoObservations,
} from '../simulation/observations.ts';
import { ingredientAlternatives } from '../gameplay/production-rules.ts';
import type {
  Building,
  EconomicTotals,
  EconomicSample,
  CargoSample,
  BuildingSpec,
  BuildingType,
  Good,
  Inventory,
  Job,
  ProductionMetrics,
  ProductionSample,
  SavedUnit,
  SaveData,
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

/** Validate and normalize a save before changing either the running world or storage. */
export function validateSave(
  input: unknown,
  width: number,
  height: number,
  specs: Record<BuildingType, BuildingSpec>,
  goods: Record<Good, { name: string; c: string }>,
): SaveData {
  const fail: (message: string) => never = (message) => {
    throw new Error(message);
  };
  // Imported JSON remains dynamically shaped until every schema field is validated.
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const num = (v: unknown, min = 0, max = 1e9) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const int = (v: unknown, min = 0, max = 1e9) => Number.isInteger(v) && num(v, min, max);
  const bool = (v: unknown) => typeof v === 'boolean';
  const record = (v: unknown = {}, max = 1e7): Inventory => {
    if (!object(v)) fail('Invalid resource table');
    const out: Inventory = {};
    for (const [key, value] of Object.entries(v)) {
      if (!Object.hasOwn(goods, key) || !int(value, 0, max)) fail('Invalid resource quantity');
      out[key as Good] = value as number;
    }
    return out;
  };
  const size = width * height;
  if (!object(input) || ![1, 2].includes(input.v as number)) fail('Unsupported save version');
  const d = structuredClone(input) as unknown as SaveData;
  if (d.economy !== undefined && d.economy !== 2) fail('Unsupported economy version');
  if (
    !int(d.seed, -2147483648, 2147483647) ||
    !int(d.nextId, 1) ||
    !Array.isArray(d.t) ||
    d.t.length !== 5
  )
    fail('Invalid world header');
  if (!d.t.every((a) => Array.isArray(a) && a.length === size)) fail('Wrong map dimensions');
  for (let i = 0; i < size; i++) {
    if (
      !int(d.t[0][i], 0, 3) ||
      !int(d.t[1][i], 0, 4) ||
      !int(d.t[2][i], 0, 1e6) ||
      ![0, 1].includes(d.t[3][i])
    )
      fail('Invalid terrain');
    const r = d.t[4][i];
    if (
      r !== null &&
      (!Array.isArray(r) ||
        ![2, 3].includes(r.length) ||
        !['gold', 'iron', 'coal'].includes(r[0]) ||
        !int(r[1], 0, 1e6) ||
        (r.length === 3 && !int(r[2], 0, 1e6)) ||
        d.t[0][i] !== 3)
    )
      fail('Invalid deposit');
  }
  if (
    !Array.isArray(d.b) ||
    d.b.length < 1 ||
    d.b.length > size ||
    !Array.isArray(d.j) ||
    d.j.length > 50000 ||
    !Array.isArray(d.u) ||
    d.u.length > 5000
  )
    fail('Invalid entity arrays');
  const ids = new Set<number>();
  const positions = new Set();
  for (const b of d.b) {
    if (
      !object(b) ||
      !int(b.id, 1) ||
      ids.has(b.id) ||
      !Object.hasOwn(specs, b.type) ||
      !int(b.x, 0, width - 1) ||
      !int(b.y, 0, height - 1) ||
      !bool(b.done) ||
      !num(b.prog, 0, 2) ||
      !num(b.timer, -100, 1e6)
    )
      fail('Invalid building');
    if (b.legacyIndustry !== undefined && (!bool(b.legacyIndustry) || b.type !== 'armory'))
      fail('Invalid legacy industry');
    const pos = b.y * width + b.x;
    if (positions.has(pos) || [0, 3].includes(d.t[0][pos])) fail('Invalid building site');
    positions.add(pos);
    ids.add(b.id);
    for (const key of ['needs', 'got', 'stock', 'res'] as const) b[key] = record(b[key]);
    b.targets = record(b.targets || {}, 500);
    b.priority = int(b.priority, 0, 2) ? b.priority : 0;
    b.disabled = !!b.disabled;
    b.produced = int(b.produced) ? b.produced : 0;
    b.man = !!b.man;
    b.exhausted = !!b.exhausted;
    b.nofood = !!b.nofood;
    b.norock = !!b.norock;
    const m: Record<string, unknown> = object(b.metrics) ? b.metrics : {};
    b.metrics = {} as ProductionMetrics;
    for (const key of ['elapsed', 'active', 'blocked', 'inputBlocked', 'outputBlocked'] as const)
      b.metrics[key] = num(m[key]) ? (m[key] as number) : 0;
    for (const key of ['produced', 'consumed', 'delivered'] as const)
      b.metrics[key] = record(m[key] || {});
    const deliveryKnown = m.deliveryStarted !== undefined;
    if (deliveryKnown && !num(m.deliveryStarted, 0, b.metrics.elapsed))
      fail('Invalid production delivery coverage');
    b.metrics.deliveryStarted = deliveryKnown ? (m.deliveryStarted as number) : b.metrics.elapsed;
    for (const key of ['inputDelivered', 'outputDelivered'] as const)
      b.metrics[key] = deliveryKnown ? record(m[key] || {}) : {};
    const flowKeys = ['produced', 'consumed', 'inputDelivered', 'outputDelivered'] as const;
    if (m.recent === undefined) {
      // Old saves have no recent baseline. Preserve lifetime totals and begin
      // recent/delivery observation here instead of pretending they cover the past.
      b.metrics.recent = [
        {
          elapsed: b.metrics.elapsed,
          inputBlocked: b.metrics.inputBlocked,
          ...Object.fromEntries(flowKeys.map((key) => [key, { ...b.metrics[key] }])),
        } as ProductionSample,
      ];
    } else {
      if (!Array.isArray(m.recent) || !m.recent.length || m.recent.length > 301)
        fail('Invalid production history');
      let previous: ProductionSample | null = null;
      b.metrics.recent = m.recent.map((sample: Record<string, unknown>) => {
        if (
          !object(sample) ||
          !num(sample.elapsed, Math.max(0, b.metrics.elapsed - 600 - 1e-9), b.metrics.elapsed) ||
          !num(sample.inputBlocked, 0, b.metrics.inputBlocked) ||
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
          for (const good of Object.keys(goods) as Good[]) {
            const amount = clean[key][good] || 0;
            if (
              amount > (b.metrics[key][good] || 0) ||
              (previous && amount < (previous[key][good] || 0))
            )
              fail('Invalid production history totals');
          }
        }
        previous = clean;
        return clean;
      });
    }
    b.blockedReason = typeof b.blockedReason === 'string' ? b.blockedReason.slice(0, 160) : '';
  }
  if (d.b.filter((b) => b.type === 'hq' && b.done).length !== 1) fail('Missing headquarters');
  const buildings = new Map<number, Building>(d.b.map((b) => [b.id, b]));
  for (const j of d.j) {
    if (
      !object(j) ||
      !['fetch', 'deliver', 'soldier', 'transfer'].includes(j.kind) ||
      !['p', 't'].includes(j.state)
    )
      fail('Invalid job');
    if (j.kind !== 'soldier' && !Object.hasOwn(goods, j.good)) fail('Invalid cargo');
    if (['fetch', 'soldier', 'transfer'].includes(j.kind) && !buildings.has(j.to))
      fail('Missing job destination');
    if (
      j.kind === 'fetch' &&
      (!buildings.has(j.s) || !buildings.get(j.s).done || !specs[buildings.get(j.s).type].store)
    )
      fail('Missing source store');
    if (['deliver', 'transfer'].includes(j.kind) && !buildings.has(j.from))
      fail('Missing job source');
    if (
      j.kind === 'transfer' &&
      (j.s !== j.from ||
        !buildings.get(j.from).done ||
        !buildings.get(j.to).done ||
        !specs[buildings.get(j.from).type].store ||
        !specs[buildings.get(j.to).type].store)
    )
      fail('Invalid transfer');
    if (j.kind === 'fetch') {
      const target = buildings.get(j.to);
      // Save acceptance deliberately unions current specifications with historical
      // exceptions below. It is broader than the live recipe of migrated industry.
      const needed = target.done ? specs[target.type].in : target.needs;
      const meal =
        target.done &&
        specs[target.type].prod === 'mine' &&
        ingredientAlternatives(specs[target.type], 'food').includes(j.good);
      const legacyTool =
        d.economy === undefined &&
        target.done &&
        target.type === 'toolsmith' &&
        ['planks', 'stone'].includes(j.good);
      const legacyArmory =
        target.done &&
        target.type === 'armory' &&
        (d.economy === undefined || target.legacyIndustry) &&
        j.good === 'iron';
      if ((!needed || !needed[j.good]) && !meal && !legacyTool && !legacyArmory)
        fail('Invalid fetch destination');
    }
    if (j.kind === 'deliver') {
      const source = buildings.get(j.from);
      const legacyMeal = j.good === 'food' && ['farm', 'fisherman'].includes(source.type);
      if (!source.done || (specs[source.type].out !== j.good && !legacyMeal))
        fail('Invalid delivery source');
    }
    if (j.kind === 'soldier') {
      const target = buildings.get(j.to);
      if (!target.done || !specs[target.type].guard || target.man)
        fail('Invalid soldier destination');
    }
  }
  const jobOwners = new Set();
  const ownerByJob = new Map();
  for (const u of d.u) {
    if (
      !object(u) ||
      !int(u.id, 1) ||
      ids.has(u.id) ||
      !['carrier', 'soldier'].includes(u.kind) ||
      !num(u.x, 0, width) ||
      !num(u.y, 0, height) ||
      !['idle', 'p', 'd'].includes(u.phase) ||
      !int(u.ji, -1, d.j.length - 1) ||
      !num(u.lx, -1, 1) ||
      !num(u.ly, -1, 1)
    )
      fail('Invalid settler');
    ids.add(u.id);
    if (u.carry !== null && u.carry !== undefined && !Object.hasOwn(goods, u.carry))
      fail('Invalid carried resource');
    if (
      u.path !== null &&
      (!Array.isArray(u.path) ||
        u.path.length > size * 2 ||
        !u.path.every((n) => int(n, 0, size - 1) && ![0, 3].includes(d.t[0][n])))
    )
      fail('Invalid route');
    if (!int(u.pi, 0, u.path ? u.path.length : size * 2)) fail('Invalid route progress');
    if (u.dropB && !buildings.has(u.dropB)) fail('Missing drop destination');
    if (u.ji >= 0) {
      if (jobOwners.has(u.ji) || d.j[u.ji].state !== 't') fail('Invalid job ownership');
      jobOwners.add(u.ji);
      ownerByJob.set(u.ji, u);
    }
    u.carryTransfer =
      d.v === 1
        ? !!(u.carry && u.ji >= 0 && ['fetch', 'transfer'].includes(d.j[u.ji].kind))
        : !!u.carryTransfer;
    const job = u.ji >= 0 ? d.j[u.ji] : null;
    if (u.carryWarehouseTransfer === undefined)
      u.carryWarehouseTransfer = !!(u.carry && job?.kind === 'transfer');
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
    if (u.carryProducer === undefined)
      u.carryProducer = u.carry && job?.kind === 'deliver' ? job.from : null;
    if (u.carryProducer !== null) {
      if (
        !int(u.carryProducer, 1, d.nextId - 1) ||
        !u.carry ||
        u.carryTransfer ||
        u.kind !== 'carrier' ||
        u.phase !== 'd' ||
        (job && (job.kind !== 'deliver' || job.from !== u.carryProducer))
      )
        fail('Invalid producer cargo origin');
      const source = buildings.get(u.carryProducer);
      const legacyMeal =
        u.carry === 'food' && source && ['farm', 'fisherman'].includes(source.type);
      if (source && (!source.done || (specs[source.type].out !== u.carry && !legacyMeal)))
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
    u.walkDistance = num(u.walkDistance) ? u.walkDistance : 0;
    u.faceDX = num(u.faceDX, -1, 1) ? u.faceDX : 1;
    u.faceDY = num(u.faceDY, -1, 1) ? u.faceDY : 0;
  }
  const reservations = new Map();
  for (let i = 0; i < d.j.length; i++) {
    const j = d.j[i];
    const owner = ownerByJob.get(i);
    if (['fetch', 'transfer'].includes(j.kind) && (!owner || !owner.carry)) {
      const key = j.s + '/' + j.good;
      reservations.set(key, (reservations.get(key) || 0) + 1);
    }
  }
  for (const b of d.b) {
    for (const good of Object.keys(goods) as Good[]) {
      if (
        (b.res[good] || 0) !== (reservations.get(b.id + '/' + good) || 0) ||
        (b.res[good] || 0) > (b.stock[good] || 0)
      )
        fail('Invalid resource reservations');
    }
  }
  if (ids.size && d.nextId <= Math.max(...ids)) fail('Invalid next entity ID');
  if (d.j.some((j, i) => j.state === 't' && !jobOwners.has(i))) fail('Unowned active job');
  if (
    !object(d.st) ||
    ![1, 2, 4, 8].includes(d.st.speed) ||
    !num(d.st.time) ||
    !int(d.st.gold) ||
    !bool(d.st.paused) ||
    !bool(d.st.won) ||
    !bool(d.st.auto)
  )
    fail('Invalid simulation state');
  if (!object(d.p)) fail('Invalid simulation pools');
  for (const k of ['serfPool', 'soldierPool'] as const)
    if (!int(d.p[k], 0, 1e5)) fail('Invalid population');
  for (const k of ['spawnT', 'serfT', 'solT'] as const)
    if (!num(d.p[k], -100, 1e6)) fail('Invalid timer');
  d.p.assignT = num(d.p.assignT, -100, 10) ? d.p.assignT : 0;
  d.p.autoT = num(d.p.autoT, -100, 10) ? d.p.autoT : 0;
  d.p.treeGrowthT = num(d.p.treeGrowthT, 0, 1) ? d.p.treeGrowthT : 0;
  if (d.v === 2 && !int(d.rng, -2147483648, 4294967295)) fail('Invalid RNG state');
  d.st.upgrades = object(d.st.upgrades) ? d.st.upgrades : ({} as SaveData['st']['upgrades']);
  for (const k of ['haul', 'production'] as const)
    if (!int(d.st.upgrades[k], 0, 3)) d.st.upgrades[k] = 0;
  d.st.spentGold = int(d.st.spentGold) ? d.st.spentGold : 0;
  d.st.goldDelivered = int(d.st.goldDelivered) ? d.st.goldDelivered : d.st.gold;
  d.st.contracts = Array.isArray(d.st.contracts) ? d.st.contracts.filter((x) => int(x, 0, 5)) : [];
  d.st.milestones = Array.isArray(d.st.milestones)
    ? d.st.milestones.filter((x) => int(x, 0, 5))
    : [];
  d.st.roadsBuilt = int(d.st.roadsBuilt) ? d.st.roadsBuilt : d.t[3].filter(Boolean).length;
  // Hydrate the schema, rather than assigning arbitrary imported object keys to entities.
  // Object.assign treats an imported own __proto__ key as a prototype setter.
  const pick = <R extends object>(value: object, keys: string[]): R =>
    Object.fromEntries(keys.map((key) => [key, (value as Record<string, unknown>)[key]])) as R;
  d.b = d.b.map((b) =>
    pick<Building>(b, [
      'id',
      'type',
      'x',
      'y',
      'done',
      'prog',
      'needs',
      'got',
      'stock',
      'res',
      'man',
      'exhausted',
      'produced',
      'timer',
      'nofood',
      'legacyIndustry',
      'norock',
      'metrics',
      'blockedReason',
      'priority',
      'targets',
      'disabled',
    ]),
  );
  d.j = d.j.map((j) => pick<Job>(j, ['kind', 'good', 'to', 's', 'from', 'state']));
  d.u = d.u.map((u) =>
    pick<SavedUnit>(u, [
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
    ]),
  );
  d.st = {
    paused: d.st.paused,
    speed: d.st.speed,
    won: d.st.won,
    time: d.st.time,
    gold: d.st.gold,
    auto: d.st.auto,
    upgrades: { haul: d.st.upgrades.haul, production: d.st.upgrades.production },
    spentGold: d.st.spentGold,
    goldDelivered: d.st.goldDelivered,
    contracts: d.st.contracts,
    milestones: d.st.milestones,
    roadsBuilt: d.st.roadsBuilt,
  };
  if (d.observations === undefined) d.observations = freshEconomicObservations(d.st.time);
  else {
    const obs = d.observations;
    if (
      !object(obs) ||
      !num(obs.started, 0, d.st.time) ||
      !Array.isArray(obs.recent) ||
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
    let previous: EconomicSample | null = null;
    const recent = obs.recent.map((raw): EconomicSample => {
      if (
        !object(raw) ||
        !num(raw.time, Math.max(obs.started, d.st.time - 600 - 1e-9), d.st.time) ||
        (previous && raw.time <= previous.time)
      )
        fail('Invalid economic observation coverage');
      const sample: EconomicSample = { time: raw.time, totals: totals(raw.totals) };
      for (const flow of ECONOMIC_FLOWS)
        for (const good of Object.keys(goods) as Good[]) {
          const amount = sample.totals[flow][good] || 0;
          if (
            amount > (current[flow][good] || 0) ||
            (previous && amount < (previous.totals[flow][good] || 0))
          )
            fail('Invalid economic observation sequence');
        }
      previous = sample;
      return sample;
    });
    let cargo = freshCargoObservations(d.st.time);
    if (obs.cargo !== undefined) {
      const rawCargo = obs.cargo;
      if (
        !object(rawCargo) ||
        !object(rawCargo.totals) ||
        !num(rawCargo.started, 0, d.st.time) ||
        !Array.isArray(rawCargo.recent) ||
        !rawCargo.recent.length ||
        rawCargo.recent.length > 301
      )
        fail('Invalid cargo arrival observations');
      const cargoTotals = record(rawCargo.totals, 1e9);
      let previousCargo: CargoSample | null = null;
      const cargoRecent = rawCargo.recent.map((raw): CargoSample => {
        if (
          !object(raw) ||
          !object(raw.totals) ||
          !num(raw.time, Math.max(rawCargo.started, d.st.time - 600 - 1e-9), d.st.time) ||
          (previousCargo && raw.time <= previousCargo.time)
        )
          fail('Invalid cargo arrival coverage');
        const sample = { time: raw.time, totals: record(raw.totals, 1e9) };
        for (const good of Object.keys(goods) as Good[])
          if (
            (sample.totals[good] || 0) > (cargoTotals[good] || 0) ||
            (previousCargo && (sample.totals[good] || 0) < (previousCargo.totals[good] || 0))
          )
            fail('Invalid cargo arrival sequence');
        previousCargo = sample;
        return sample;
      });
      cargo = { started: rawCargo.started, totals: cargoTotals, recent: cargoRecent };
    }
    d.observations = { started: obs.started, totals: current, recent, cargo };
  }
  if (d.identity !== undefined && (!object(d.identity) || !Object.hasOwn(d.identity, 'name')))
    fail('Invalid colony identity');
  d.identity = { name: d.identity === undefined ? 'Unnamed colony' : saveName(d.identity.name) };
  d.attention = validateAttention(
    d.attention,
    d.st.time,
    width,
    height,
    specs,
    goods,
    d.b,
    d.nextId,
  );
  return d as SaveData;
}
