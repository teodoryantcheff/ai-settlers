import type { ValidatedSave, SaveMetadata } from '../types.ts';
import type { StoragePort } from './persistence.ts';
import { saveText } from './save-codec.ts';

export const SAVE_CATALOG_KEY = 'settlers.saves.v1';
export const AUTOSAVE_KEY = 'settlers.autosave.v1';
export const MAX_SAVE_TEXT = 32_000_000;
const MAX_CATALOG_TEXT = 64_000_000;
const MAX_CHECKPOINTS = 50;
/** Largest valid Date value; save times beyond it are corrupt. */
const MAX_SAVED_AT = 8_640_000_000_000_000;
/** The autosave envelope adds its version and save time around the save text. */
const MAX_AUTOSAVE_TEXT = MAX_SAVE_TEXT + 100;
export interface CatalogEntry {
  id: string;
  name: string;
  kind: SaveMetadata['kind'];
  savedAt: number | null;
  data: ValidatedSave;
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

/**
 * One envelope is the atomic storage transaction for named checkpoints; the legacy slot is
 * never rewritten. The autosave lives under its own key so writing it never reads, parses or
 * rewrites the checkpoints. Catalogs written before that split may still hold an autosave entry.
 */
export function createSaveCatalog(
  storage: StoragePort | undefined,
  normalize: (data: unknown) => ValidatedSave,
) {
  function checkedSave(raw: unknown) {
    if (typeof raw !== 'string' || raw.length > MAX_SAVE_TEXT)
      throw new Error('Save code is too large');
    return normalize(JSON.parse(raw));
  }
  function validate(input: unknown): SaveCatalog {
    const object = (value: unknown): value is Record<string, unknown> =>
      !!value && typeof value === 'object' && !Array.isArray(value);
    if (!object(input)) throw new Error('Invalid save catalog');
    const value = input;
    if (
      value.v !== 1 ||
      typeof value.nextId !== 'number' ||
      !Number.isInteger(value.nextId) ||
      value.nextId < 1 ||
      value.nextId > 1e9 ||
      !Array.isArray(value.entries) ||
      value.entries.length > MAX_CHECKPOINTS
    )
      throw new Error('Invalid save catalog');
    const ids = new Set<string>();
    const importedEntries: unknown[] = value.entries;
    const nextId = value.nextId;
    const entries = importedEntries.map((entry): CatalogEntry => {
      if (
        !object(entry) ||
        typeof entry.id !== 'string' ||
        !/^(save-[1-9]\d{0,8}|autosave|legacy)$/.test(entry.id) ||
        ids.has(entry.id) ||
        (entry.kind !== 'manual' && entry.kind !== 'autosave' && entry.kind !== 'legacy') ||
        (entry.kind === 'autosave') !== (entry.id === 'autosave') ||
        (entry.kind === 'legacy') !== (entry.id === 'legacy') ||
        (entry.id.startsWith('save-') && +entry.id.slice(5) >= nextId) ||
        (entry.savedAt !== null &&
          (typeof entry.savedAt !== 'number' ||
            !Number.isSafeInteger(entry.savedAt) ||
            entry.savedAt < 0 ||
            entry.savedAt > MAX_SAVED_AT)) ||
        (entry.savedAt === null && entry.kind !== 'legacy')
      )
        throw new Error('Invalid save catalog entry');
      ids.add(entry.id);
      const text = JSON.stringify(entry.data);
      return {
        id: entry.id,
        name: saveName(entry.name, 'Checkpoint'),
        kind: entry.kind,
        savedAt: typeof entry.savedAt === 'number' ? entry.savedAt : null,
        data: checkedSave(text),
      };
    });
    return { v: 1, nextId: value.nextId, entries };
  }
  function read(): SaveCatalog {
    if (!storage) throw new Error('Browser storage is unavailable');
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
  /** The separately stored autosave, or null when none has been written under its own key. */
  function readAutosave(): CatalogEntry | null {
    if (!storage) throw new Error('Browser storage is unavailable');
    const raw = storage.getItem(AUTOSAVE_KEY);
    if (raw === null) return null;
    if (raw.length > MAX_AUTOSAVE_TEXT) throw new Error('Save code is too large');
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      !('v' in value) ||
      value.v !== 1 ||
      !('savedAt' in value) ||
      typeof value.savedAt !== 'number' ||
      !Number.isSafeInteger(value.savedAt) ||
      value.savedAt < 0 ||
      value.savedAt > MAX_SAVED_AT ||
      !('data' in value)
    )
      throw new Error('Invalid autosave');
    return {
      id: 'autosave',
      name: 'Autosave',
      kind: 'autosave',
      savedAt: value.savedAt,
      data: normalize(value.data),
    };
  }
  /** Store already validated and serialized save text without touching the catalog. */
  function writeAutosave(text: string, savedAt: number) {
    if (text.length > MAX_SAVE_TEXT) throw new Error('Save code is too large');
    if (!storage) throw new Error('Browser storage is unavailable');
    storage.setItem(AUTOSAVE_KEY, '{"v":1,"savedAt":' + savedAt + ',"data":' + text + '}');
  }
  function hasAutosave() {
    if (!storage) throw new Error('Browser storage is unavailable');
    return storage.getItem(AUTOSAVE_KEY) !== null;
  }
  function removeAutosave() {
    if (!storage) throw new Error('Browser storage is unavailable');
    storage.removeItem(AUTOSAVE_KEY);
  }
  function write(value: SaveCatalog) {
    const clean = validate(value);
    const raw = saveText(clean);
    if (raw.length > MAX_CATALOG_TEXT) throw new Error('Save catalog is too large');
    if (!storage) throw new Error('Browser storage is unavailable');
    storage.setItem(SAVE_CATALOG_KEY, raw);
  }
  return { read, write, readAutosave, writeAutosave, hasAutosave, removeAutosave };
}
