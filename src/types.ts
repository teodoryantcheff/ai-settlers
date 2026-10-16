export type Good =
  | 'logs'
  | 'planks'
  | 'stone'
  | 'food'
  | 'grain'
  | 'flour'
  | 'bread'
  | 'pigs'
  | 'meat'
  | 'fish'
  | 'beer'
  | 'coal'
  | 'iron'
  | 'iron_bars'
  | 'gold'
  | 'tools'
  | 'weapons';
export type Inventory = Partial<Record<Good, number>>;
export type BuildingType =
  | 'hq'
  | 'warehouse'
  | 'lumberjack'
  | 'forester'
  | 'quarry'
  | 'fisherman'
  | 'farm'
  | 'mine_coal'
  | 'mine_iron'
  | 'mine_gold'
  | 'sawmill'
  | 'windmill'
  | 'bakery'
  | 'pigfarm'
  | 'butcher'
  | 'well'
  | 'brewery'
  | 'smelter'
  | 'workshop'
  | 'toolsmith'
  | 'armory'
  | 'guard';
/** Structured, transient placement failures; display copy is derived from the code. */
export type PlacementRefusal =
  | { code: 'out-of-bounds' | 'choose-map-tile' }
  | { code: 'water' | 'mountain' | 'territory' | 'shore-land' | 'no-water' | 'meadow' }
  | { code: 'deposit'; good: 'coal' | 'iron' | 'gold' }
  | { code: 'no-rocks' | 'blocked' | 'unreachable-stock' }
  | { code: 'spacing'; building: BuildingType }
  | { code: 'stock'; good: Good; required: number; available: number };
export interface BuildingSpec {
  name: string;
  cost?: Inventory;
  rad?: number;
  store?: boolean;
  prod?: 'gather' | 'plant' | 'rock' | 'fish' | 'farm' | 'mine' | 'craft' | 'none';
  out?: Good;
  in?: Inventory;
  time?: number;
  resKind?: 'coal' | 'iron' | 'gold';
  guard?: boolean;
  water?: boolean;
}
export interface ProductionMetrics {
  elapsed: number;
  active: number;
  blocked: number;
  inputBlocked: number;
  outputBlocked: number;
  produced: Inventory;
  consumed: Inventory;
  delivered: Inventory;
  /** Completed producer input arrivals, excluding construction and warehouse transfers. */
  inputDelivered?: Inventory;
  /** Producer cargo that actually reached storage, attributed to its delivery job. */
  outputDelivered?: Inventory;
  /** Lifetime elapsed time when the distinguishable delivery counters began. */
  deliveryStarted?: number;
  /** Persisted cumulative samples: at most 301, spanning at most 600 simulation seconds. */
  recent?: ProductionSample[];
}
export type ProductionRateWindow = 30 | 120 | 600 | 'lifetime';
export interface ProductionSample {
  elapsed: number;
  inputBlocked: number;
  produced: Inventory;
  consumed: Inventory;
  inputDelivered: Inventory;
  outputDelivered: Inventory;
}
export interface ProductionWindowMetrics extends ProductionSample {
  /** Delivery rates can have shorter coverage than legacy lifetime production totals. */
  deliveryElapsed: number;
  /** Recent snapshots are two simulation seconds apart; lifetime counters are exact. */
  sampleInterval: number;
}
/** The empty string means no blockage and preserves the existing save representation. */
export type ProductionBlockReason =
  '' | 'paused' | 'exhausted' | 'output' | 'demand' | 'reserve' | 'water' | 'inputs' | 'resources';
export interface Building {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  done: boolean;
  prog: number;
  needs: Inventory;
  got: Inventory;
  stock: Inventory;
  res: Inventory;
  timer: number;
  priority: 0 | 1 | 2;
  targets: Inventory;
  disabled: boolean;
  metrics: ProductionMetrics;
  blockedReason: ProductionBlockReason;
  man: boolean;
  exhausted: boolean;
  nofood: boolean;
  legacyIndustry?: boolean;
  norock: boolean;
  produced: number;
  /** Transient display cache; never serialized or accepted from imported saves. */
}
export interface BuildingStatus {
  lines: { t: string; w: boolean }[];
  bad: boolean;
}
export interface Job {
  kind: 'fetch' | 'deliver' | 'transfer' | 'soldier';
  good?: Good;
  to?: number;
  from?: number;
  s?: number;
  state: 'p' | 't';
}
export interface Unit {
  id: number;
  kind: 'carrier' | 'soldier';
  x: number;
  y: number;
  path: number[] | null;
  pi: number;
  phase: 'idle' | 'p' | 'd';
  job: Job | null;
  carry: Good | null;
  carryTransfer?: boolean;
  /** Distinguishes warehouse repositioning from fetched ingredients after job cancellation. */
  carryWarehouseTransfer?: boolean;
  /** Actual producer source retained after demolition cancels a delivery job. */
  carryProducer?: number | null;
  walkDistance?: number;
  faceDX?: number;
  faceDY?: number;
  dropB: number | null;
  dropIsSite: boolean;
  dead: boolean;
  lx: number;
  ly: number;
  moving?: boolean;
}
export interface SimulationState {
  paused: boolean;
  speed: 1 | 2 | 4 | 8;
  won: boolean;
  time: number;
  gold: number;
  auto: boolean;
  goldDelivered: number;
  spentGold: number;
  upgrades: { haul: number; production: number };
  contracts: number[];
  milestones: number[];
  roadsBuilt: number;
}
export interface PresentationPreferences {
  showFps: boolean;
  atlasExpanded: boolean;
  minimapVisible: boolean;
  reducedMotion: boolean;
  weather: boolean;
  clarity: boolean;
  quality: 1 | 0.75;
  overlay: 'none' | OverlayName;
}
/** Map tools the player can arm: placing one building type, drawing road, or razing. */
export type InteractionMode =
  { type: 'build'; bt: BuildingType } | { type: 'road' } | { type: 'demolish' };
export type InteractionModeType = InteractionMode['type'];
/** Ordered scene layers produced by the renderer and consumed by the presentation. */
export type LayerName =
  'objects' | 'backdrop' | 'terrain' | 'ground-effects' | 'foreground-effects';
/** Diagnostic map overlays; 'none' (no overlay) is a preference value, not a layer. */
export type OverlayName = 'routes' | 'workload' | 'reach' | 'stalls';
export interface TilePoint {
  x: number;
  y: number;
}
/** Live placement feedback for the hovered tile while a build mode is armed. */
export interface PlacementGhost extends TilePoint {
  ok: boolean;
  reason: PlacementRefusal | null;
  in: boolean;
}
/** Transient HUD log entry; the text is already escaped for display. */
export interface GameMessage {
  t: string;
  at: number;
  context?: {
    workspace: 'attention' | 'activity';
    entity?: import('./observations/attention.ts').EntityReference;
  };
}
export interface Tile {
  t: number;
  tree: number;
  rock: { amt: number } | null;
  road: boolean;
  owned?: boolean;
  res: { kind: 'gold' | 'iron' | 'coal'; amt: number; amt0?: number } | null;
}
export interface Random {
  (): number;
  getState(): number;
  setState(next: number): void;
}

export interface Sprite {
  img: HTMLCanvasElement;
  w: number;
  h: number;
  ox: number;
  oy: number;
}
export interface ArtAtlas {
  grass: HTMLCanvasElement[];
  road: HTMLCanvasElement;
  tree: HTMLCanvasElement[][][];
  rock: HTMLCanvasElement[];
  paintedTerrain?: { image: HTMLCanvasElement | HTMLImageElement; worldSize: number };
  paintedMountains?: {
    dry: HTMLCanvasElement[];
    snowy: HTMLCanvasElement[];
    foothill: HTMLCanvasElement;
  };
  paintedStatus?: { state: 'loading' | 'loaded' | 'fallback'; message: string };
  bld: Partial<Record<BuildingType, Sprite>>;
  bld2: Partial<Record<BuildingType, Sprite>>;
  site: Sprite;
  blade: HTMLCanvasElement;
  unitDirections: Partial<
    Record<
      'carrier' | 'soldier',
      Record<string, { walk: HTMLCanvasElement[]; idle: HTMLCanvasElement }>
    >
  >;
  cargo: Partial<Record<Good, HTMLCanvasElement>>;
  shadowSoft: HTMLCanvasElement;
  cloud: HTMLCanvasElement;
  cloudShadow: HTMLCanvasElement;
  glow: HTMLCanvasElement;
  grainURL: string;
  anchors: Partial<
    Record<
      BuildingType,
      {
        flag?: { x: number; y: number };
        chim?: { x: number; y: number }[];
        blade?: { x: number; y: number };
        bob?: { x: number; y: number };
      }
    >
  >;
}
export interface GameEvents {
  simulationObserved: Record<string, never>;
  productionControlChanged: { building: Building };
  territoryChanged: Record<string, never>;
  buildingPlaced: { building: Building };
  buildingDemolished: { id: number; type: BuildingType; x: number; y: number };
  placementRejected: { type: BuildingType; x: number; y: number; reason: PlacementRefusal };
  demolitionRejected: { reason: 'headquarters' | 'last-store' };
  siteCleared: { x: number; y: number; tree: boolean };
  rocksExhausted: { building: Building };
  foodBlocked: { building: Building };
  depositExhausted: { building: Building };
  goldBanked: { building: Building };
  settlerSpawned: Record<string, never>;
  roadRejected: { reason: 'no-route' | 'blocked-start' };
  roadBuilt: { count: number };
  contractRejected: { reason: 'stock' };
  contractFulfilled: { index: number; name: string; x: number; y: number };
  upgradeRejected: { kind: 'haul' | 'production'; price: number };
  upgradePurchased: { kind: 'haul' | 'production'; level: number };
  milestoneReached: { index: number; title: string };
  storageResult: { operation: 'save' | 'load'; ok: boolean; message: string };
  /** Persistent storage health changes, including quiet autosave success/failure. */
  saveHealthChanged: { ok: boolean; savedAt: number | null; message: string };
  preferencesResult: { status: 'unchanged' | 'pending' | 'saved' | 'failed'; message: string };

  goodsProduced: { building: Building; good: Good; amount: number };
  goodsDelivered: { building: Building; good: Good; amount: number; transfer: boolean };
  buildingCompleted: { building: Building };
  firstGold: { building: Building };
  outpostManned: { building: Building };
  victory: { time: number; gold: number };
  /** A tile's cached static terrain is stale; presentation repaints and re-uploads it. */
  tileChanged: { index: number };
  /** The GPU presenter failed; the HUD pauses the colony while the page offers reload. */
  rendererFailed: { reason: string };
  /** A committed replacement changed the live world; UI and presentation reset transient views. */
  worldLoaded: { reason?: 'new' | 'load' };
}

export type SavedDeposit = ['gold' | 'iron' | 'coal', number, number?] | null;
export type SavedUnit = Omit<Unit, 'job' | 'dead' | 'moving'> & { ji: number };
export interface SaveData {
  v: 1 | 2;
  economy?: 2;
  identity?: ColonyIdentity;
  observations?: EconomicObservations;
  attention?: import('./observations/attention.ts').AttentionData;
  seed: number;
  rng?: number;
  nextId: number;
  t: [number[], number[], number[], number[], SavedDeposit[]];
  b: Building[];
  j: Job[];
  u: SavedUnit[];
  st: SimulationState;
  p: {
    serfPool: number;
    soldierPool: number;
    spawnT: number;
    serfT: number;
    solT: number;
    assignT: number;
    autoT: number;
    treeGrowthT: number;
  };
}
export interface PreparedSave {
  data: SaveData;
  tiles: Tile[];
  buildings: Building[];
  jobs: Job[];
  units: Unit[];
  rng: Random;
}

/** Durable, observational flows. Internal movements never count as creation. */
export type EconomicFlow =
  | 'produced'
  | 'consumed'
  | 'inputArrived'
  | 'outputStored'
  | 'constructionSpent'
  | 'contractSpent'
  | 'upgradeSpent'
  | 'contractReward'
  | 'refund'
  | 'salvage'
  | 'transferred';
export type EconomicTotals = Record<EconomicFlow, Inventory>;
export interface EconomicSample {
  time: number;
  totals: EconomicTotals;
}
export interface CargoSample {
  time: number;
  totals: Inventory;
}
export interface CargoObservations {
  started: number;
  totals: Inventory;
  recent: CargoSample[];
}
export interface CargoWindow {
  from: number;
  to: number;
  elapsed: number;
  available: boolean;
  totals: Inventory;
  rates: Inventory;
}
export interface EconomicObservations {
  /** All carrier goods actually delivered; coverage is independent of earlier economic flows. */
  cargo: CargoObservations;
  /** Each new metric begins here on historical saves; no past activity is inferred. */
  started: number;
  totals: EconomicTotals;
  recent: EconomicSample[];
}
export interface EconomicWindow {
  window: ProductionRateWindow;
  from: number;
  to: number;
  elapsed: number;
  available: boolean;
  sampleInterval: number;
  totals: EconomicTotals;
  /** Goods per simulation minute; empty when coverage is unavailable. */
  rates: EconomicTotals;
}
export interface ResourceAccounting {
  good: Good;
  stored: number;
  reserved: number;
  available: number;
  inTransit: number;
  producerInputs: number;
  awaitingCollection: number;
  otherLocal: number;
  constructionMaterials: number;
  physicalGoods: number;
  /** Optional promises eligible actions can reclaim; already included in reserved. */
  reclaimable: number;
  contributors: Array<{
    id: number;
    type: BuildingType;
    x: number;
    y: number;
    stored: number;
    reserved: number;
    input: number;
    output: number;
    other: number;
    construction: number;
  }>;
}

export interface ColonyIdentity {
  name: string;
}
export interface SaveMetadata {
  id: string;
  name: string;
  kind: 'manual' | 'autosave' | 'legacy';
  colonyName: string;
  seed: number;
  savedAt: number | null;
  simulationAge: number;
  gold: number;
  buildingCount: number;
}
