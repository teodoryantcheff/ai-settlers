/**
 * Lossless compact text form for saves.
 *
 * Ten-minute observation histories (`recent`: production, economic and cargo samples)
 * are most of a save's size. Each sample repeats every key name around a few cumulative
 * numbers, so a grown colony's save no longer fit more than a couple of checkpoints in
 * browser storage. In save text, a history whose samples share one object shape is stored
 * column by column instead: every numeric leaf becomes an array with one value per sample,
 * and `null` where that sample lacks the key. Unpacking rebuilds the same samples, numbers,
 * keys and key order, before validation sees them, so loading and continuation are unchanged.
 * Histories that do not fit that shape stay plain arrays.
 */

/** Marks a packed history in save text; plain histories are arrays. */
const PACKED = 'columns';
/** A history never holds more samples than the ten-minute window at two-second steps. */
const MAX_SAMPLES = 301;

type Column = (number | null)[];
interface ColumnTree {
  [key: string]: Column | ColumnTree;
}
export interface PackedHistory {
  [PACKED]: ColumnTree;
  count: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Pack samples column by column, or return null when they do not share one shape. */
export function packHistory(samples: readonly unknown[]): PackedHistory | null {
  if (!samples.length || samples.length > MAX_SAMPLES || !samples.every(isObject)) return null;
  const count = samples.length;
  // Keys are collected in first-seen order. Cumulative records only ever gain keys, so
  // that order reproduces each sample's own order.
  function pack(nodes: Record<string, unknown>[]): ColumnTree | null {
    const tree: ColumnTree = {};
    const keys: string[] = [];
    for (const node of nodes)
      for (const key of Object.keys(node)) if (!keys.includes(key)) keys.push(key);
    for (const key of keys) {
      const values = nodes.map((node) => (Object.hasOwn(node, key) ? node[key] : undefined));
      if (values.every((value) => value === undefined || typeof value === 'number')) {
        if (values.some((value) => typeof value === 'number' && !Number.isFinite(value)))
          return null;
        tree[key] = values.map((value) => (value === undefined ? null : (value as number)));
      } else if (values.every(isObject)) {
        const child = pack(values as Record<string, unknown>[]);
        if (!child) return null;
        tree[key] = child;
      } else return null;
    }
    return tree;
  }
  const columns = pack(samples as Record<string, unknown>[]);
  return columns ? { [PACKED]: columns, count } : null;
}

/** Rebuild samples from a packed history; plain arrays pass through for validation. */
export function unpackHistory(value: unknown, fail: (message: string) => never): unknown {
  if (!isObject(value) || !Object.hasOwn(value, PACKED)) return value;
  const declared = value.count;
  if (
    typeof declared !== 'number' ||
    !Number.isInteger(declared) ||
    declared < 1 ||
    declared > MAX_SAMPLES
  )
    fail('Invalid packed history');
  const count: number = declared;
  function unpack(tree: unknown, depth: number): Record<string, unknown>[] {
    if (!isObject(tree) || depth > 4) fail('Invalid packed history');
    const samples: Record<string, unknown>[] = Array.from({ length: count }, () => ({}));
    for (const [key, column] of Object.entries(tree)) {
      if (Array.isArray(column)) {
        if (column.length !== count) fail('Invalid packed history');
        column.forEach((entry, index) => {
          if (entry === null) return;
          if (typeof entry !== 'number' || !Number.isFinite(entry)) fail('Invalid packed history');
          samples[index][key] = entry;
        });
      } else {
        const children = unpack(column, depth + 1);
        children.forEach((child, index) => {
          samples[index][key] = child;
        });
      }
    }
    return samples;
  }
  return unpack(value[PACKED], 0);
}

/** Unpack every history location of a detached save object in place. */
export function unpackSaveHistories(save: unknown, fail: (message: string) => never) {
  if (!isObject(save)) return;
  if (Array.isArray(save.b))
    for (const building of save.b)
      if (isObject(building) && isObject(building.metrics) && building.metrics.recent !== undefined)
        building.metrics.recent = unpackHistory(building.metrics.recent, fail);
  const observations = save.observations;
  if (isObject(observations)) {
    if (observations.recent !== undefined)
      observations.recent = unpackHistory(observations.recent, fail);
    if (isObject(observations.cargo) && observations.cargo.recent !== undefined)
      observations.cargo.recent = unpackHistory(observations.cargo.recent, fail);
  }
}

/** A packed history where one fits, else the plain samples. */
function packed(recent: unknown): unknown {
  return Array.isArray(recent) ? (packHistory(recent) ?? recent) : recent;
}
/** Shallow copy of a save whose histories are packed; nothing else is copied or touched. */
function packedSave(save: unknown): unknown {
  if (!isObject(save)) return save;
  const copy: Record<string, unknown> = { ...save };
  if (Array.isArray(save.b))
    copy.b = save.b.map((building: unknown) =>
      isObject(building) && isObject(building.metrics) && Array.isArray(building.metrics.recent)
        ? { ...building, metrics: { ...building.metrics, recent: packed(building.metrics.recent) } }
        : building,
    );
  const observations = save.observations;
  if (isObject(observations)) {
    const cargo = observations.cargo;
    copy.observations = {
      ...observations,
      recent: packed(observations.recent),
      ...(isObject(cargo) ? { cargo: { ...cargo, recent: packed(cargo.recent) } } : {}),
    };
  }
  return copy;
}

/**
 * Serialize save data, or a checkpoint catalog holding saves, with packed histories.
 * The copy is shallow and stringified natively: a replacer function would push every
 * value of a large save through a slow path.
 */
export function saveText(value: unknown): string {
  if (isObject(value) && Array.isArray(value.entries))
    return JSON.stringify({
      ...value,
      entries: value.entries.map((entry: unknown) =>
        isObject(entry) ? { ...entry, data: packedSave(entry.data) } : entry,
      ),
    });
  return JSON.stringify(packedSave(value));
}
