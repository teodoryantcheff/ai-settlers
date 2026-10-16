import type { AttentionSubsystem } from '../observations/attention.ts';
import {
  createSaveCatalog,
  MAX_SAVE_TEXT,
  saveMetadata,
  saveName,
  type SaveCatalog,
} from './save-catalog.ts';
import type { ObservationSubsystem } from '../simulation/observations.ts';
import type { SimulationStateSubsystem } from '../simulation/state.ts';
import type { WorldSubsystem } from './world.ts';
import type { AutoplaySubsystem } from '../simulation/autoplay.ts';
import type { EventsSubsystem } from './events.ts';
import type { MapSubsystem } from '../simulation/map.ts';
import { validateSave } from './state.ts';
import type { Building, PreparedSave, SaveData, SavedDeposit, SaveMetadata } from '../types.ts';

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
  const catalog = createSaveCatalog(storage, (data) =>
    validateSave(data, game.W, game.H, game.BSPEC, game.GOODS),
  );
  let saveHealth: SaveHealth = { ok: true, savedAt: null, message: 'No checkpoint saved yet' };
  if (storage) {
    try {
      const existing = catalog
        .read()
        .entries.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
      if (existing)
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
      RS.push(tl.res ? [tl.res.kind, tl.res.amt, tl.res.amt0 || 0] : null);
    }
    const B = game.buildings.map(function (b): Building {
      return {
        id: b.id,
        type: b.type,
        x: b.x,
        y: b.y,
        done: b.done,
        prog: b.prog,
        needs: b.needs,
        got: b.got,
        stock: b.stock,
        res: b.res,
        man: b.man,
        exhausted: b.exhausted,
        produced: b.produced,
        timer: b.timer,
        nofood: !!b.nofood,
        legacyIndustry: b.legacyIndustry,
        norock: !!b.norock,
        metrics: b.metrics,
        blockedReason: b.blockedReason,
        priority: b.priority || 0,
        targets: b.targets || {},
        disabled: !!b.disabled,
      };
    });
    const J = game.jobs.map(function (j) {
      return {
        kind: j.kind,
        good: j.good || null,
        to: j.to || 0,
        s: j.s || 0,
        from: j.from || 0,
        state: j.state,
      };
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
      st: Object.assign({}, game.state),
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
  function writeCatalog(next: SaveCatalog, message: string, quiet = false) {
    try {
      catalog.write(next);
      saveHealth = { ok: true, savedAt: Date.now(), message };
      game.emitGameEvent('saveHealthChanged', { ...saveHealth });
      if (!quiet) game.emitGameEvent('storageResult', { operation: 'save', ok: true, message });
    } catch (error) {
      reportFailure(error);
      throw error;
    }
  }
  function readCatalog(operation: 'save' | 'load' = 'save') {
    try {
      return catalog.read();
    } catch (error) {
      reportFailure(error, operation);
      throw error;
    }
  }
  function setColonyName(name: string) {
    colonyName = saveName(name);
  }
  function listSaves(): SaveMetadata[] {
    return readCatalog('load')
      .entries.map(saveMetadata)
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }
  function saveCheckpoint(name: string, overwriteId?: string): SaveMetadata {
    const next = readCatalog();
    const data = validateSave(snapshotGame(), game.W, game.H, game.BSPEC, game.GOODS);
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
  function saveAutosave(): boolean {
    try {
      const next = readCatalog();
      const data = validateSave(snapshotGame(), game.W, game.H, game.BSPEC, game.GOODS);
      const entry = {
        id: 'autosave',
        name: 'Autosave',
        kind: 'autosave' as const,
        savedAt: Date.now(),
        data,
      };
      next.entries = next.entries
        .filter((candidate) => candidate.kind !== 'autosave')
        .concat(entry);
      writeCatalog(next, 'Autosave saved', true);
      baseline = JSON.stringify(data);
      baselineId = entry.id;
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
    if (!next.entries.some((candidate) => candidate.id === id))
      throw new Error('Checkpoint no longer exists');
    next.entries = next.entries.filter((candidate) => candidate.id !== id);
    writeCatalog(next, 'Checkpoint deleted');
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
        res: RS[i] ? { kind: RS[i][0], amt: RS[i][1], amt0: RS[i][2] || RS[i][1] } : null,
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
      const entry = readCatalog('load').entries.find((candidate) => candidate.id === id);
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
    return JSON.stringify(validateSave(snapshotGame(), game.W, game.H, game.BSPEC, game.GOODS));
  }
  function exportCheckpoint(id: string): string {
    const entry = readCatalog().entries.find((candidate) => candidate.id === id);
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
