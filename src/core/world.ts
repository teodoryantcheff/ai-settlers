import type { Random, Tile } from '../types.ts';

export function createWorld(search = '?seed=0'): WorldSubsystem {
  const W = 96,
    H = 96,
    TS = 24,
    GOAL = 200;
  const ST = 1.5; // Static terrain texture supersampling.
  // Development scenarios and the render benchmark freeze cosmetic weather and
  // lighting at noon, so repeated runs draw the same scene.
  const TESTMODE = /uitest|buildrules|saveload|devshot|renderbench/.test(search);
  const WATER = 0,
    SAND = 1,
    GRASS = 2,
    MTN = 3;
  const DX = [1, -1, 0, 0, 1, 1, -1, -1],
    DY = [0, 0, 1, -1, 1, -1, 1, -1];
  // Keep the generator callable while exposing its state for exact save continuation.
  function mulberry32(a: number): Random {
    function random() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    random.getState = function () {
      return a >>> 0;
    };
    random.setState = function (next: number) {
      a = next | 0;
    };
    return random;
  }
  const seedQ = search.match(/[?&]seed=(\d+)/);
  let seed = seedQ ? +seedQ[1] | 0 : 0; // ?seed=N -> reproducible map + sim
  let SR = mulberry32(seed + 0x5bd1e995); // seeded RNG for all sim-affecting rolls (AI, growth, timers)
  function valueNoise(sd: number, cells: number) {
    const rnd = mulberry32(sd),
      g = new Float32Array((cells + 1) * (cells + 1));
    let i;
    for (i = 0; i < g.length; i++) g[i] = rnd();
    return function (x: number, y: number) {
      const fx = x * cells,
        fy = y * cells,
        x0 = Math.floor(fx),
        y0 = Math.floor(fy),
        tx = fx - x0,
        ty = fy - y0,
        sx = tx * tx * (3 - 2 * tx),
        sy = ty * ty * (3 - 2 * ty),
        xm = Math.min(x0 + 1, cells),
        ym = Math.min(y0 + 1, cells),
        a = g[y0 * (cells + 1) + x0],
        b = g[y0 * (cells + 1) + xm],
        c = g[ym * (cells + 1) + x0],
        d = g[ym * (cells + 1) + xm];
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  }
  function fbm(sd: number) {
    const n1 = valueNoise(sd, 7),
      n2 = valueNoise(sd + 11, 17),
      n3 = valueNoise(sd + 37, 33);
    return function (x: number, y: number) {
      return n1(x, y) * 0.6 + n2(x, y) * 0.3 + n3(x, y) * 0.15;
    };
  }
  let tiles: Tile[] = new Array(W * H);
  function inB(x: number, y: number) {
    return x >= 0 && y >= 0 && x < W && y < H;
  }
  function idx(x: number, y: number) {
    return y * W + x;
  }
  function passI(i: number) {
    const t = tiles[i].t;
    return t !== WATER && t !== MTN;
  }

  // Live bindings preserve replacement of arrays and mutable subsystem state.
  return {
    get W() {
      return W;
    },
    get H() {
      return H;
    },
    get TS() {
      return TS;
    },
    get GOAL() {
      return GOAL;
    },
    get ST() {
      return ST;
    },
    get TESTMODE() {
      return TESTMODE;
    },
    get WATER() {
      return WATER;
    },
    get SAND() {
      return SAND;
    },
    get GRASS() {
      return GRASS;
    },
    get MTN() {
      return MTN;
    },
    get DX() {
      return DX;
    },
    get DY() {
      return DY;
    },
    mulberry32,
    get seed() {
      return seed;
    },
    set seed(value: typeof seed) {
      seed = value;
    },
    get SR() {
      return SR;
    },
    set SR(value: typeof SR) {
      SR = value;
    },
    fbm,
    get tiles() {
      return tiles;
    },
    set tiles(value: typeof tiles) {
      tiles = value;
    },
    inB,
    idx,
    passI,
  };
}

export interface WorldSubsystem {
  readonly W: number;
  readonly H: number;
  readonly TS: number;
  readonly GOAL: number;
  readonly ST: number;
  readonly TESTMODE: boolean;
  readonly WATER: number;
  readonly SAND: number;
  readonly GRASS: number;
  readonly MTN: number;
  readonly DX: number[];
  readonly DY: number[];
  mulberry32: (a: number) => Random;
  seed: number;
  SR: Random;
  fbm: (sd: number) => (x: number, y: number) => number;
  tiles: Tile[];
  inB: (x: number, y: number) => boolean;
  idx: (x: number, y: number) => number;
  passI: (i: number) => boolean;
}
