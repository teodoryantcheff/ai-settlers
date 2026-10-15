import type { SaveData, SaveMetadata } from '../types.ts';
import type { StoragePort } from './persistence.ts';

export const SAVE_CATALOG_KEY = 'settlers.saves.v1';
export const MAX_SAVE_TEXT = 32_000_000;
const MAX_CATALOG_TEXT = 64_000_000;
const MAX_CHECKPOINTS = 50;
export interface CatalogEntry {
  id: string;
  name: string;
  kind: SaveMetadata['kind'];
  savedAt: number | null;
  data: SaveData;
}
export interface SaveCatalog {
  v: 1;
  nextId: number;
  entries: CatalogEntry[];
}
export function saveName(value: unknown, fallback = 'Unnamed colony'): string {
  if (typeof value !== 'string' || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value))
    throw new Error('Names must contain at most 80 readable characters');
  return value.trim() || fallback;
}
export function saveMetadata(entry: CatalogEntry): SaveMetadata {
  return {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    colonyName: entry.data.identity.name,
    seed: entry.data.seed,
    savedAt: entry.savedAt,
    simulationAge: entry.data.st.time,
    gold: entry.data.st.gold,
    buildingCount: entry.data.b.length,
  };
}

/** One envelope is the atomic storage transaction; the legacy slot is never rewritten. */
export function createSaveCatalog(storage: StoragePort, normalize: (data: unknown) => SaveData) {
  function checkedSave(raw: string) {
    if (typeof raw !== 'string' || raw.length > MAX_SAVE_TEXT)
      throw new Error('Save code is too large');
    return normalize(JSON.parse(raw));
  }
  function validate(input: unknown): SaveCatalog {
    if (!input || typeof input !== 'object') throw new Error('Invalid save catalog');
    const value = input as SaveCatalog;
    if (
      value.v !== 1 ||
      !Number.isInteger(value.nextId) ||
      value.nextId < 1 ||
      value.nextId > 1e9 ||
      !Array.isArray(value.entries) ||
      value.entries.length > MAX_CHECKPOINTS
    )
      throw new Error('Invalid save catalog');
    const ids = new Set<string>();
    const entries = value.entries.map((entry): CatalogEntry => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.id !== 'string' ||
        !/^(save-[1-9]\d{0,8}|autosave|legacy)$/.test(entry.id) ||
        ids.has(entry.id) ||
        !['manual', 'autosave', 'legacy'].includes(entry.kind) ||
        (entry.kind === 'autosave') !== (entry.id === 'autosave') ||
        (entry.kind === 'legacy') !== (entry.id === 'legacy') ||
        (entry.id.startsWith('save-') && +entry.id.slice(5) >= value.nextId) ||
        (entry.savedAt !== null &&
          (!Number.isSafeInteger(entry.savedAt) ||
            entry.savedAt < 0 ||
            entry.savedAt > 8640000000000000)) ||
        (entry.savedAt === null && entry.kind !== 'legacy')
      )
        throw new Error('Invalid save catalog entry');
      ids.add(entry.id);
      const text = JSON.stringify(entry.data);
      return {
        id: entry.id,
        name: saveName(entry.name, 'Checkpoint'),
        kind: entry.kind,
        savedAt: entry.savedAt,
        data: checkedSave(text),
      };
    });
    return { v: 1, nextId: value.nextId, entries };
  }
  function read(): SaveCatalog {
    const raw = storage.getItem(SAVE_CATALOG_KEY);
    if (raw !== null) {
      if (raw.length > MAX_CATALOG_TEXT) throw new Error('Save catalog is too large');
      return validate(JSON.parse(raw));
    }
    const legacy = storage.getItem('settlers.save');
    return {
      v: 1,
      nextId: 1,
      entries: legacy
        ? [
            {
              id: 'legacy',
              name: 'Legacy checkpoint',
              kind: 'legacy',
              savedAt: null,
              data: checkedSave(legacy),
            },
          ]
        : [],
    };
  }
  function write(value: SaveCatalog) {
    const clean = validate(value);
    const raw = JSON.stringify(clean);
    if (raw.length > MAX_CATALOG_TEXT) throw new Error('Save catalog is too large');
    storage.setItem(SAVE_CATALOG_KEY, raw);
  }
  return { read, write };
}
