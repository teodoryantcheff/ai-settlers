import type { AttentionSubsystem } from '../observations/attention.ts';
import {
  createSaveCatalog,
  MAX_SAVE_TEXT,
  saveMetadata,
  saveName,
  type CatalogEntry,
  type SaveCatalog,
} from './save-catalog.ts';
import type { ObservationSubsystem } from '../simulation/observations.ts';
import type { SimulationStateSubsystem } from '../simulation/state.ts';
import type { WorldSubsystem } from './world.ts';
import type { AutoplaySubsystem } from '../simulation/autoplay.ts';
import type { EventsSubsystem } from './events.ts';
import type { MapSubsystem } from '../simulation/map.ts';
import { validateSave } from './state.ts';
import type {
  Building,
  Job,
  PreparedSave,
  SaveData,
  SavedDeposit,
  SaveMetadata,
} from '../types.ts';

/**
 * Persistence owns the save wire format: snapshots, validation-driven hydration,
 * atomic world replacement and an injected storage slot. A committed load replaces world
 * and simulation state only; presentation and UI reset their own transient views
 * in response to the 'worldLoaded' event instead of being poked by a load.
 */
export function createPersistence(
  game: PersistenceDependencies,
  internals?: PersistenceInternals,
  storage?: StoragePort,
): PersistenceSubsystem {
  let colonyName = 'Unnamed colony';
  let baseline: string | null = null;
  let baselineId: string | null = null;
  let lastReportedError: unknown;
  // Catalogs written before the autosave got its own key may still hold one; the first
  // successful separate autosave drops it from the catalog.
  let catalogHoldsAutosave = false;
  // A damaged separate autosave is reported once, not on every listing that skips it.
  let autosaveDamaged = false;
  const catalog = createSaveCatalog(storage, (data) =>
    validateSave(data, game.W, game.H, game.BSPEC, game.GOODS),
  );
  let saveHealth: SaveHealth = { ok: true, savedAt: null, message: 'No checkpoint saved yet' };
  if (storage) {
    try {
      const entries = catalog.read().entries;
      catalogHoldsAutosave = holdsAutosave(entries);
      let autosave: CatalogEntry | null = null;
      try {
        autosave = catalog.readAutosave();
      } catch (error) {
        autosaveDamaged = true;
        saveHealth = {
          ok: false,
          savedAt: null,
          message:
            'Stored autosave unavailable: ' +
            (error instanceof Error ? error.message : String(error)),
        };
      }
      const existing = withAutosave(entries, autosave).sort(
        (a, b) => (b.savedAt || 0) - (a.savedAt || 0),
      )[0];
      if (existing && saveHealth.ok)
        saveHealth = {
          ok: true,
          savedAt: existing.savedAt,
          message: 'Previous checkpoint available: ' + existing.name,
        };
    } catch (error) {
      saveHealth = {
        ok: false,
        savedAt: null,
        message:
          'Stored checkpoints unavailable: ' +
          (error instanceof Error ? error.message : String(error)),
      };
    }
  }
  // Build a complete snapshot; validation and hydration happen before committing any load.
  function snapshotGame(): SaveData {
    const T = [],
      TR = [],
      RK = [],
      RD = [],
      RS: SavedDeposit[] = [];
    for (const tl of game.tiles) {
      T.push(tl.t);
      TR.push(tl.tree);
      RK.push(tl.rock ? tl.rock.amt : 0);
      RD.push(tl.road ? 1 : 0);
      RS.push(tl.deposit ? [tl.deposit.kind, tl.deposit.amt, tl.deposit.amt0 || 0] : null);
    }
    const B = game.buildings.map(function (b): Building {
      return {
        id: b.id,
        type: b.type,
        x: b.x,
        y: b.y,
        done: b.done,
        constructionProgress: b.constructionProgress,
        needs: b.needs,
        got: b.got,
        stock: b.stock,
        reservedStock: b.reservedStock,
        manned: b.manned,
        exhausted: b.exhausted,
        produced: b.produced,
        timer: b.timer,
        foodBlockedNoticeSent: !!b.foodBlockedNoticeSent,
        legacyIndustry: b.legacyIndustry,
        rocksExhaustedNoticeSent: !!b.rocksExhaustedNoticeSent,
        metrics: b.metrics,
        blockedReason: b.blockedReason,
        priority: b.priority || 0,
        targets: b.targets || {},
        disabled: !!b.disabled,
      };
    });
    const J = game.jobs.map((job): Job => {
      const status = job.status;
      if (job.kind === 'soldier') return { kind: job.kind, to: job.to, status };
      const cargo = { good: job.good, sourceId: job.sourceId, status };
      if (job.kind === 'deliver') return { kind: job.kind, ...cargo };
      return job.kind === 'fetch'
        ? { kind: 'fetch', to: job.to, ...cargo }
        : { kind: 'transfer', to: job.to, ...cargo };
    });
    const U = game.units
      .filter(function (u) {
        return !u.dead;
      })
      .map(function (u) {
        return {
          id: u.id,
          kind: u.kind,
          x: u.x,
          y: u.y,
          path: u.path,
          pi: u.pi,
          phase: u.phase,
          ji: u.job ? game.jobs.indexOf(u.job) : -1,
          carry: u.carry || null,
          dropB: u.dropB || null,
          dropIsSite: !!u.dropIsSite,
          carryTransfer: !!u.carryTransfer,
          carryWarehouseTransfer: !!u.carryWarehouseTransfer,
          carryProducer: u.carryProducer || null,
          lx: u.lx,
          ly: u.ly,
          walkDistance: u.walkDistance || 0,
          faceDX: u.faceDX || 0,
          faceDY: u.faceDY || 0,
        };
      });
    return {
      v: 2,
      economy: 2,
      identity: { name: colonyName },
      observations: structuredClone(game.observationData),
      attention: structuredClone(game.attentionData),
      seed: game.seed,
      rng: game.SR.getState(),
      nextId: game.nextId,
      t: [T, TR, RK, RD, RS],
      b: B,
      j: J,
      u: U,
      // Validation may rewrite invalid upgrade levels; never let that reach live state.
      st: { ...game.state, upgrades: { ...game.state.upgrades } },
      p: {
        serfPool: game.serfPool,
        soldierPool: game.soldierPool,
        spawnT: game.spawnT,
        serfT: game.serfT,
        solT: game.solT,
        assignT: game.assignT,
        autoT: game.autoT,
        treeGrowthT: game.treeGrowthT,
      },
    };
  }
  function reportFailure(error: unknown, operation: 'save' | 'load' = 'save') {
    lastReportedError = error;
    const message =
      (operation === 'save' ? 'Save failed: ' : 'Load failed: ') +
      (error instanceof Error ? error.message : String(error));
    saveHealth = { ...saveHealth, ok: false, message };
    game.emitGameEvent('saveHealthChanged', { ...saveHealth });
    game.emitGameEvent('storageResult', { operation, ok: false, message });
  }
  function reportSuccess(message: string, quiet: boolean, savedAt = Date.now()) {
    saveHealth = { ok: true, savedAt, message };
    game.emitGameEvent('saveHealthChanged', { ...saveHealth });
    if (!quiet) game.emitGameEvent('storageResult', { operation: 'save', ok: true, message });
  }
  function writeCatalog(next: SaveCatalog, message: string, quiet = false) {
    try {
      catalog.write(next);
    } catch (error) {
      reportFailure(error);
      throw error;
    }
    catalogHoldsAutosave = holdsAutosave(next.entries);
    reportSuccess(message, quiet);
  }
  function readCatalog(operation: 'save' | 'load' = 'save') {
    try {
      const next = catalog.read();
      catalogHoldsAutosave = holdsAutosave(next.entries);
      return next;
    } catch (error) {
      reportFailure(error, operation);
      throw error;
    }
  }
  /** Every stored save: the catalog plus the separate autosave, which supersedes a catalog one. */
  function readEntries(operation: 'save' | 'load' = 'save'): CatalogEntry[] {
    const entries = readCatalog(operation).entries;
    let autosave: CatalogEntry | null = null;
    try {
      autosave = catalog.readAutosave();
      autosaveDamaged = false;
    } catch (error) {
      // A damaged autosave is reported but must not hide the named checkpoints.
      if (!autosaveDamaged) reportFailure(error, operation);
      autosaveDamaged = true;
    }
    return withAutosave(entries, autosave);
  }
  function setColonyName(name: string) {
    colonyName = saveName(name);
  }
  function listSaves(): SaveMetadata[] {
    return readEntries('load')
      .map(saveMetadata)
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }
  function saveCheckpoint(name: string, overwriteId?: string): SaveMetadata {
    const next = readCatalog();
    const data = validateSave(snapshotGame(), game.W, game.H, game.BSPEC, game.GOODS, true);
    const id = overwriteId || 'save-' + next.nextId++;
    const old = next.entries.find((entry) => entry.id === id);
    if (overwriteId && (!old || old.kind !== 'manual'))
      throw new Error('Choose a manual checkpoint to overwrite');
    const entry = {
      id,
      name: saveName(name, 'Checkpoint'),
      kind: 'manual' as const,
      savedAt: Date.now(),
      data,
    };
    next.entries = next.entries.filter((candidate) => candidate.id !== id).concat(entry);
    writeCatalog(next, 'Checkpoint saved: ' + entry.name);
    baseline = JSON.stringify(data);
    baselineId = id;
    return saveMetadata(entry);
  }
  /** Validate and serialize once, then write only the autosave's own storage key. */
  function saveAutosave(): boolean {
    try {
      const data = validateSave(snapshotGame(), game.W, game.H, game.BSPEC, game.GOODS, true);
      const text = JSON.stringify(data);
      const savedAt = Date.now();
      try {
        catalog.writeAutosave(text, savedAt);
        autosaveDamaged = false;
      } catch (error) {
        reportFailure(error);
        throw error;
      }
      baseline = text;
      baselineId = 'autosave';
      // One-time migration, only after the new autosave is stored so nothing is lost.
      if (catalogHoldsAutosave) {
        const next = readCatalog();
        next.entries = next.entries.filter((candidate) => candidate.kind !== 'autosave');
        writeCatalog(next, 'Autosave saved', true);
      } else reportSuccess('Autosave saved', true, savedAt);
      return true;
    } catch (error) {
      if (lastReportedError !== error) reportFailure(error);
      return false;
    }
  }
  function saveGame(quiet = false): boolean {
    if (quiet) return saveAutosave();
    try {
      saveCheckpoint('Checkpoint at ' + game.state.time.toFixed(0) + ' seconds');
      return true;
    } catch (error) {
      if (lastReportedError !== error) reportFailure(error);
      return false;
    }
  }
  function renameCheckpoint(id: string, name: string) {
    const next = readCatalog();
    const entry = next.entries.find((candidate) => candidate.id === id);
    if (!entry || entry.kind === 'autosave') throw new Error('Choose a named checkpoint to rename');
    entry.name = saveName(name, 'Checkpoint');
    writeCatalog(next, 'Checkpoint renamed');
  }
  function deleteCheckpoint(id: string) {
    const next = readCatalog();
    const inCatalog = next.entries.some((candidate) => candidate.id === id);
    // Presence is enough: a damaged autosave must remain deletable.
    const separate = id === 'autosave' && catalog.hasAutosave();
    if (!inCatalog && !separate) throw new Error('Checkpoint no longer exists');
    if (inCatalog) {
      next.entries = next.entries.filter((candidate) => candidate.id !== id);
      writeCatalog(next, 'Checkpoint deleted', separate);
    }
    if (separate) {
      try {
        catalog.removeAutosave();
        autosaveDamaged = false;
      } catch (error) {
        reportFailure(error);
        throw error;
      }
      reportSuccess('Checkpoint deleted', false);
    }
    if (baselineId === id) {
      baseline = null;
      baselineId = null;
    }
  }
  function hasUnsavedProgress() {
    return baseline === null || baseline !== exportSave();
  }
  function prepareLoad(raw: string): PreparedSave {
    // Ten-minute histories contain five times the former number of samples.
    // Keep a finite file guard without stranding ordinary larger settlements.
    if (typeof raw !== 'string' || raw.length > MAX_SAVE_TEXT)
      throw new Error('Save code is too large');
    const d = validateSave(JSON.parse(raw), game.W, game.H, game.BSPEC, game.GOODS);
    if (d.economy !== undefined && d.economy !== 2) throw new Error('Unsupported economy version');
    // Legacy toolsmiths are the same basic wood-and-stone workshop: preserve
    // their stock, construction materials, timers and already assigned pickups.
    if (d.economy === undefined)
      for (const b of d.b) {
        if (b.type === 'toolsmith') b.type = 'workshop';
        if (b.type === 'armory') b.legacyIndustry = true;
      }
    d.economy = 2;
    const T = d.t[0],
      TR = d.t[1],
      RK = d.t[2],
      RD = d.t[3],
      RS = d.t[4];
    const newTiles = T.map(function (type, i) {
      return {
        t: type,
        tree: TR[i],
        rock: RK[i] > 0 ? { amt: RK[i] } : null,
        road: !!RD[i],
        deposit: RS[i] ? { kind: RS[i][0], amt: RS[i][1], amt0: RS[i][2] || RS[i][1] } : null,
        owned: false,
      };
    });
    const newJobs = d.j.map(function (j) {
      return Object.assign({}, j);
    });
    const newUnits = d.u.map(function (u) {
      return Object.assign({}, u, { job: u.ji >= 0 ? newJobs[u.ji] : null, dead: false });
    });
    const rng = game.mulberry32(d.seed + 0x5bd1e995);
    if (d.v === 2) rng.setState(d.rng);
    return { data: d, tiles: newTiles, buildings: d.b, jobs: newJobs, units: newUnits, rng: rng };
  }
  function commitLoad(prepared: PreparedSave) {
    const d = prepared.data;
    game.tiles = prepared.tiles;
    game.buildings = prepared.buildings;
    game.jobs = prepared.jobs;
    game.units = prepared.units;
    game.observationData = d.observations;
    game.attentionData = d.attention;
    colonyName = d.identity.name;
    game.nextId = d.nextId;
    game.seed = d.seed;
    game.SR = prepared.rng;
    Object.assign(game.state, d.st);
    game.serfPool = d.p.serfPool;
    game.soldierPool = d.p.soldierPool;
    game.spawnT = d.p.spawnT;
    game.serfT = d.p.serfT;
    game.solT = d.p.solT;
    game.assignT = d.p.assignT;
    game.autoT = d.p.autoT;
    game.treeGrowthT = d.p.treeGrowthT;
    game.recomputeTerritory();
    game.emitGameEvent('worldLoaded', { reason: 'load' });
  }
  function loadCheckpoint(id: string) {
    try {
      const entry = readEntries('load').find((candidate) => candidate.id === id);
      if (!entry) throw new Error('Checkpoint no longer exists');
      const prepared = prepareLoad(JSON.stringify(entry.data));
      commitLoad(prepared);
      baseline = exportSave();
      baselineId = id;
      game.emitGameEvent('storageResult', {
        operation: 'load',
        ok: true,
        message: 'Loaded ' + entry.name,
      });
    } catch (error) {
      reportFailure(error, 'load');
      throw error;
    }
  }
  function loadGame() {
    try {
      const latest = listSaves()[0];
      if (!latest) throw new Error('No saved colony found');
      loadCheckpoint(latest.id);
      return true;
    } catch (error) {
      if (lastReportedError !== error) reportFailure(error, 'load');
      return false;
    }
  }
  /** Serialize the live colony independently of browser-storage availability. */
  function exportSave(): string {
    return JSON.stringify(
      validateSave(snapshotGame(), game.W, game.H, game.BSPEC, game.GOODS, true),
    );
  }
  function exportCheckpoint(id: string): string {
    const entry = readEntries().find((candidate) => candidate.id === id);
    if (!entry) throw new Error('Checkpoint no longer exists');
    return JSON.stringify(entry.data);
  }
  function inspectSave(json: string): SaveMetadata {
    return saveMetadata({
      id: 'file',
      name: 'Imported checkpoint',
      kind: 'manual',
      savedAt: null,
      data: prepareLoad(json).data,
    });
  }
  /** Store a fresh imported checkpoint before adopting its fully prepared world. */
  function importSave(json: string) {
    const prepared = prepareLoad(json);
    const next = readCatalog();
    const id = 'save-' + next.nextId++;
    next.entries.push({
      id,
      name: 'Imported checkpoint',
      kind: 'manual',
      savedAt: Date.now(),
      data: prepared.data,
    });
    writeCatalog(next, 'Imported colony saved', true);
    commitLoad(prepared);
    baseline = exportSave();
    baselineId = id;
  }

  if (!saveHealth.ok) game.emitGameEvent('saveHealthChanged', { ...saveHealth });

  // Test-only view of closure internals; never merged into the runtime.
  if (internals) Object.assign(internals, { snapshotGame, prepareLoad, commitLoad });

  return {
    get saveHealth() {
      return saveHealth;
    },
    get colonyName() {
      return colonyName;
    },
    setColonyName,
    listSaves,
    saveCheckpoint,
    saveAutosave,
    renameCheckpoint,
    deleteCheckpoint,
    loadCheckpoint,
    hasUnsavedProgress,
    exportCheckpoint,
    inspectSave,
    saveGame,
    loadGame,
    exportSave,
    importSave,
  };
}

export interface SaveHealth {
  ok: boolean;
  savedAt: number | null;
  message: string;
}

export interface PersistenceSubsystem {
  readonly saveHealth: SaveHealth;
  readonly colonyName: string;
  setColonyName: (name: string) => void;
  listSaves: () => SaveMetadata[];
  saveCheckpoint: (name: string, overwriteId?: string) => SaveMetadata;
  saveAutosave: () => boolean;
  renameCheckpoint: (id: string, name: string) => void;
  deleteCheckpoint: (id: string) => void;
  loadCheckpoint: (id: string) => void;
  hasUnsavedProgress: () => boolean;
  exportCheckpoint: (id: string) => string;
  inspectSave: (json: string) => SaveMetadata;
  saveGame: (quiet?: boolean) => boolean;
  loadGame: () => boolean;
  exportSave: () => string;
  importSave: (json: string) => void;
}

/** Test-only view of closure internals; never merged into the runtime. */
export interface PersistenceInternals {
  snapshotGame: () => SaveData;
  prepareLoad: (raw: string) => PreparedSave;
  commitLoad: (prepared: PreparedSave) => void;
}

export interface StoragePort {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function holdsAutosave(entries: CatalogEntry[]) {
  return entries.some((entry) => entry.kind === 'autosave');
}

/**
 * Combine the catalog with the separate autosave, keeping only the newer autosave: a tab still
 * running a bundle from before the split may have written a newer one into the catalog.
 */
function withAutosave(entries: CatalogEntry[], autosave: CatalogEntry | null): CatalogEntry[] {
  const older = entries.find((entry) => entry.kind === 'autosave');
  if (!autosave || (older && (older.savedAt || 0) > (autosave.savedAt || 0))) return entries;
  return entries.filter((entry) => entry !== older).concat(autosave);
}

export interface PersistenceDependencies
  extends
    Pick<AttentionSubsystem, 'attentionData'>,
    Pick<
      SimulationStateSubsystem,
      | 'BSPEC'
      | 'GOODS'
      | 'assignT'
      | 'buildings'
      | 'jobs'
      | 'nextId'
      | 'serfPool'
      | 'serfT'
      | 'solT'
      | 'soldierPool'
      | 'spawnT'
      | 'state'
      | 'treeGrowthT'
      | 'units'
    >,
    Pick<WorldSubsystem, 'H' | 'SR' | 'W' | 'mulberry32' | 'seed' | 'tiles'>,
    Pick<AutoplaySubsystem, 'autoT'>,
    Pick<ObservationSubsystem, 'observationData'>,
    Pick<EventsSubsystem, 'emitGameEvent'>,
    Pick<MapSubsystem, 'recomputeTerritory'> {}
