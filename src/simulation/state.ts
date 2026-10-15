import type {
  Building,
  Good,
  BuildingSpec,
  BuildingType,
  Job,
  SimulationState,
  Unit,
} from '../types.ts';

export function createSimulationState(): SimulationStateSubsystem {
  var GOODS = {
    logs: { name: 'Logs', c: '#a97b4f' },
    planks: { name: 'Planks', c: '#d8b06a' },
    stone: { name: 'Stone', c: '#aab2b8' },
    food: { name: 'Provisions', c: '#e8c76a' },
    fish: { name: 'Fish', c: '#85bec9' },
    grain: { name: 'Grain', c: '#dab663' },
    flour: { name: 'Flour', c: '#efe0ba' },
    bread: { name: 'Bread', c: '#cf954e' },
    pigs: { name: 'Pigs', c: '#dfa0a2' },
    meat: { name: 'Meat', c: '#bd6765' },
    beer: { name: 'Beer', c: '#dda337' },
    coal: { name: 'Coal', c: '#3c4046' },
    iron: { name: 'Iron ore', c: '#d08a4e' },
    iron_bars: { name: 'Iron bars', c: '#b8c1c9' },
    tools: { name: 'Tools', c: '#8fd6d0' },
    weapons: { name: 'Weapons', c: '#cfd4ff' },
    gold: { name: 'Gold', c: '#ffd23f' },
  };
  var BSPEC: Record<BuildingType, BuildingSpec> = {
    hq: { name: 'Headquarters', rad: 10, store: true },
    warehouse: { name: 'Warehouse', cost: { planks: 4, stone: 3 }, rad: 8, store: true },
    lumberjack: {
      name: 'Lumberjack',
      cost: { planks: 2, tools: 1 },
      rad: 6,
      prod: 'gather',
      out: 'logs',
    },
    forester: { name: 'Forester', cost: { planks: 2, tools: 1 }, rad: 6, prod: 'plant' },
    quarry: {
      name: 'Quarry',
      cost: { planks: 2, stone: 2, tools: 1 },
      rad: 5,
      prod: 'rock',
      out: 'stone',
    },
    fisherman: {
      name: 'Fisherman',
      cost: { planks: 2, tools: 1 },
      rad: 5,
      prod: 'fish',
      out: 'fish',
    },
    farm: {
      name: 'Grain Farm',
      cost: { planks: 3, stone: 2, tools: 1 },
      rad: 4,
      prod: 'farm',
      out: 'grain',
    },
    mine_coal: {
      name: 'Coal Mine',
      cost: { planks: 3, stone: 3, tools: 1 },
      rad: 2,
      prod: 'mine',
      out: 'coal',
      in: { food: 1 },
      time: 12,
      resKind: 'coal',
    },
    mine_iron: {
      name: 'Iron Mine',
      cost: { planks: 3, stone: 3, tools: 1 },
      rad: 2,
      prod: 'mine',
      out: 'iron',
      in: { food: 1 },
      time: 14,
      resKind: 'iron',
    },
    mine_gold: {
      name: 'Gold Mine',
      cost: { planks: 3, stone: 3, tools: 1 },
      rad: 2,
      prod: 'mine',
      out: 'gold',
      in: { food: 1 },
      time: 16,
      resKind: 'gold',
    },
    sawmill: {
      name: 'Sawmill',
      cost: { planks: 3, stone: 1, tools: 1 },
      prod: 'craft',
      in: { logs: 2 },
      out: 'planks',
      time: 8,
    },
    windmill: {
      name: 'Windmill',
      cost: { planks: 3, stone: 2, tools: 1 },
      prod: 'craft',
      in: { grain: 1 },
      out: 'flour',
      time: 10,
    },
    bakery: {
      name: 'Bakery',
      cost: { planks: 3, stone: 2, tools: 1 },
      prod: 'craft',
      in: { flour: 1 },
      out: 'bread',
      time: 12,
      water: true,
    },
    pigfarm: {
      name: 'Pig Farm',
      cost: { planks: 3, stone: 2, tools: 1 },
      prod: 'craft',
      in: { grain: 1 },
      out: 'pigs',
      time: 16,
    },
    butcher: {
      name: 'Butcher',
      cost: { planks: 3, stone: 2, tools: 1 },
      prod: 'craft',
      in: { pigs: 1 },
      out: 'meat',
      time: 12,
    },
    well: { name: 'Well', cost: { planks: 1, stone: 2 }, prod: 'none', rad: 6 },
    brewery: {
      name: 'Brewery',
      cost: { planks: 3, stone: 2, tools: 1 },
      prod: 'craft',
      in: { grain: 1 },
      out: 'beer',
      time: 18,
      water: true,
    },
    smelter: {
      name: 'Smelter',
      cost: { planks: 3, stone: 3, tools: 1 },
      prod: 'craft',
      in: { iron: 1, coal: 1 },
      out: 'iron_bars',
      time: 16,
    },
    workshop: {
      name: 'Basic Workshop',
      cost: { planks: 3, stone: 2 },
      prod: 'craft',
      in: { planks: 2, stone: 1 },
      out: 'tools',
      time: 30,
    },
    toolsmith: {
      name: 'Toolsmith',
      cost: { planks: 3, stone: 2, tools: 1 },
      prod: 'craft',
      in: { iron_bars: 1, planks: 1 },
      out: 'tools',
      time: 18,
    },
    armory: {
      name: 'Armory',
      cost: { planks: 3, stone: 2, tools: 1 },
      prod: 'craft',
      in: { iron_bars: 1, coal: 1 },
      out: 'weapons',
      time: 22,
    },
    guard: {
      name: 'Outpost',
      cost: { planks: 2, stone: 2, weapons: 1 },
      rad: 7,
      prod: 'none',
      guard: true,
    },
  };
  var state: SimulationState = {
    paused: true,
    speed: 1,
    won: false,
    time: 0,
    gold: 0,
    auto: false,
    upgrades: { haul: 0, production: 0 },
    spentGold: 0,
    goldDelivered: 0,
    contracts: [],
    milestones: [],
    roadsBuilt: 0,
  };
  var buildings: Building[] = [];
  var units: Unit[] = [];
  var jobs: Job[] = [];
  var nextId = 1;
  var serfPool = 14,
    soldierPool = 3,
    spawnT = 8,
    serfT = 15,
    solT = 40,
    assignT = 0,
    treeGrowthT = 0;
  // Live bindings preserve replacement of arrays and mutable subsystem state.
  return {
    get GOODS() {
      return GOODS;
    },
    get BSPEC() {
      return BSPEC;
    },
    get state() {
      return state;
    },
    get buildings() {
      return buildings;
    },
    set buildings(value: typeof buildings) {
      buildings = value;
    },
    get units() {
      return units;
    },
    set units(value: typeof units) {
      units = value;
    },
    get jobs() {
      return jobs;
    },
    set jobs(value: typeof jobs) {
      jobs = value;
    },
    get nextId() {
      return nextId;
    },
    set nextId(value: typeof nextId) {
      nextId = value;
    },
    get serfPool() {
      return serfPool;
    },
    set serfPool(value: typeof serfPool) {
      serfPool = value;
    },
    get soldierPool() {
      return soldierPool;
    },
    set soldierPool(value: typeof soldierPool) {
      soldierPool = value;
    },
    get spawnT() {
      return spawnT;
    },
    set spawnT(value: typeof spawnT) {
      spawnT = value;
    },
    get serfT() {
      return serfT;
    },
    set serfT(value: typeof serfT) {
      serfT = value;
    },
    get solT() {
      return solT;
    },
    set solT(value: typeof solT) {
      solT = value;
    },
    get assignT() {
      return assignT;
    },
    set assignT(value: typeof assignT) {
      assignT = value;
    },
    get treeGrowthT() {
      return treeGrowthT;
    },
    set treeGrowthT(value: typeof treeGrowthT) {
      treeGrowthT = value;
    },
  };
}

export interface SimulationStateSubsystem {
  readonly GOODS: Record<Good, { name: string; c: string }>;
  readonly BSPEC: Record<BuildingType, BuildingSpec>;
  readonly state: SimulationState;
  buildings: Building[];
  units: Unit[];
  jobs: Job[];
  nextId: number;
  serfPool: number;
  soldierPool: number;
  spawnT: number;
  serfT: number;
  solT: number;
  assignT: number;
  treeGrowthT: number;
}
