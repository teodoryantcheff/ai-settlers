import type { GameRuntime } from '../runtime.ts';
import type { ArtAtlas, BuildingType, Good, Sprite } from '../types.ts';

/** Optional sprite sizing and per-building variant options. */
interface BldOptions {
  w?: number;
  h?: number;
  ox?: number;
  oy?: number;
  v?: number;
  kind?: 'coal' | 'iron' | 'gold';
}
/** Shared shape of the per-building painter table. */
interface BldPainterEntry {
  f: (g: CanvasRenderingContext2D, h: number, o: BldOptions) => void;
  w: number;
  h: number;
  v?: number;
  kind?: 'coal' | 'iron' | 'gold';
}

export function createArt(game: GameRuntime): ArtSubsystem {
  // Cached source artwork, directional settlers and cargo share stable anchors.

  var SS = 3;
  var ART = {} as ArtAtlas;

  function Acan(w: number, h: number): HTMLCanvasElement {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    // Offscreen art is prepared once and sampled/uploaded later. CPU backing
    // avoids synchronizing thousands of tiny paint commands through the GPU.
    c.getContext('2d', { willReadFrequently: true });
    return c;
  }
  function prs(c: string): number[] {
    if (c.charAt(0) === '#')
      return [
        parseInt(c.substr(1, 2), 16),
        parseInt(c.substr(3, 2), 16),
        parseInt(c.substr(5, 2), 16),
      ];
    var m = c.match(/(\d+)[, ]+(\d+)[, ]+(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : [255, 255, 255];
  }
  function hx(c: string): number[] {
    return prs(c);
  }
  function sh(c: string, f: number): string {
    var r = hx(c);
    return (
      'rgb(' +
      Math.round(Math.min(255, r[0] * f)) +
      ',' +
      Math.round(Math.min(255, r[1] * f)) +
      ',' +
      Math.round(Math.min(255, r[2] * f)) +
      ')'
    );
  }
  function mix(a: string, b: string, t: number): string {
    var x = hx(a),
      y = hx(b);
    return (
      'rgb(' +
      Math.round(x[0] + (y[0] - x[0]) * t) +
      ',' +
      Math.round(x[1] + (y[1] - x[1]) * t) +
      ',' +
      Math.round(x[2] + (y[2] - x[2]) * t) +
      ')'
    );
  }
  function rgba(c: string, a: number): string {
    var r = hx(c);
    return 'rgba(' + r[0] + ',' + r[1] + ',' + r[2] + ',' + a + ')';
  }
  function rr(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function F(g: CanvasRenderingContext2D, c: string | CanvasGradient | CanvasPattern): void {
    g.fillStyle = c;
    g.fill();
  }

  var PAL = {
    out: '#33251a',
    woodD: '#6b4a26',
    beam: '#b07a40',
    beamD: '#7a5528',
    plasL: '#fff9eb',
    plas: '#f4e8cf',
    plasD: '#bdab88',
    stoneL: '#e4eaf0',
    stone: '#b8c0c8',
    stoneD: '#828a94',
    thatchL: '#ffeaa0',
    thatch: '#e4b860',
    thatchD: '#b08840',
    tileL: '#ff8c50',
    tile: '#e85a20',
    tileD: '#a83810',
    slateL: '#b7cbd9',
    slate: '#758c9e',
    slateD: '#45596b',
    door: '#6a4020',
    win: '#2c3e57',
    glow: '#ffdc8f',
    leaf2: '#4b7040',
    leaf3: '#739250',
    leaf4: '#a0b76c',
  };

  // ---------- terrain textures (48px = 2x tile, downscaled at blit) ----------
  // NOTE: no directional gradients inside terrain tiles — they produce a repeating
  // checkerboard across the tile grid. Flat base + world-space macro variation instead.
  function texGrass(v: number): HTMLCanvasElement {
    var c = Acan(48, 48),
      g = c.getContext('2d'),
      rnd = game.mulberry32(1234 + v * 77);
    // Every variant shares the edge/base hue. Wrapped microstrokes avoid tile seams;
    // large meadow patches are supplied by the world-space landscape painter.
    g.fillStyle = '#6b8750';
    g.fillRect(0, 0, 48, 48);
    for (var i = 0; i < 9; i++) {
      var x = 8 + rnd() * 32,
        y = 8 + rnd() * 32,
        r = 3 + rnd() * 7,
        patch = g.createRadialGradient(x, y, 0, x, y, r);
      var tone = rnd() < 0.5 ? '#3f6032' : '#c5c78d';
      patch.addColorStop(0, rgba(tone, 0.12));
      patch.addColorStop(1, rgba(tone, 0));
      g.fillStyle = patch;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Small, broken brush marks read as blades rather than high-contrast noise.
    g.lineCap = 'round';
    for (i = 0; i < 100; i++) {
      var xx = rnd() * 48,
        yy = rnd() * 48,
        len = 0.6 + rnd() * 2.6,
        bend = (rnd() - 0.5) * 2.4;
      g.strokeStyle = rgba(rnd() < 0.54 ? '#c4cc91' : '#36552c', 0.1 + rnd() * 0.12);
      g.lineWidth = 0.45 + rnd() * 0.4;
      for (var ox = -48; ox <= 48; ox += 48)
        for (var oy = -48; oy <= 48; oy += 48) {
          g.beginPath();
          g.moveTo(xx + ox, yy + oy);
          g.quadraticCurveTo(
            xx + bend * 0.2 + ox,
            yy - len * 0.7 + oy,
            xx + bend + ox,
            yy - len + oy,
          );
          g.stroke();
        }
    }
    // Sparse seed heads keep paths, workers and resource icons easy to find.
    for (i = 0; i < 3; i++) {
      var sx = 8 + rnd() * 32,
        sy = 8 + rnd() * 32;
      g.strokeStyle = rgba('#415d30', 0.35);
      g.lineWidth = 0.5;
      g.beginPath();
      g.moveTo(sx, sy + 1.5);
      g.lineTo(sx + 0.3, sy - 1);
      g.stroke();
      g.fillStyle = rgba(v === 1 ? '#f0df9f' : '#c5cb90', 0.46);
      g.beginPath();
      g.ellipse(sx + 0.3, sy - 0.6, 0.45, 0.8, 0.2, 0, 7);
      g.fill();
    }
    return c;
  }

  function texSand(v: number): HTMLCanvasElement {
    var c = Acan(48, 48),
      g = c.getContext('2d'),
      rnd = game.mulberry32(555 + v * 91);
    g.fillStyle = ['#d7c39b', '#d4c198', '#d5c29a'][v % 3];
    g.fillRect(0, 0, 48, 48);
    for (var i = 0; i < 10; i++) {
      g.fillStyle = rnd() < 0.5 ? rgba('#c8a870', 0.2) : rgba('#f8e8b8', 0.2);
      g.beginPath();
      g.ellipse(rnd() * 48, rnd() * 48, 4 + rnd() * 9, 2.5 + rnd() * 6, rnd() * 3, 0, 7);
      g.fill();
    }
    for (i = 0; i < 36; i++) {
      g.fillStyle = rnd() < 0.5 ? rgba('#b8a068', 0.22) : rgba('#f8ecc0', 0.22);
      g.fillRect(rnd() * 48, rnd() * 48, 1.8, 1.2);
    }
    for (i = 0; i < 3; i++) {
      var y = 8 + i * 14 + rnd() * 4;
      g.strokeStyle = rgba('#c0a870', 0.48);
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(12, y - 3, 30, y + 3, 48, y);
      g.stroke();
      g.strokeStyle = rgba('#faf0cc', 0.42);
      g.beginPath();
      g.moveTo(0, y + 2);
      g.bezierCurveTo(14, y - 1, 32, y + 5, 48, y + 2);
      g.stroke();
    }
    for (i = 0; i < 6; i++) {
      g.fillStyle = rgba('#b09860', 0.65);
      g.beginPath();
      g.arc(rnd() * 48, rnd() * 48, 1.4 + rnd() * 0.7, 0, 7);
      g.fill();
    }
    if (v === 1)
      for (i = 0; i < 2; i++) {
        // tiny shells
        var sx = 6 + rnd() * 36,
          sy = 6 + rnd() * 36;
        g.fillStyle = rgba('#f8f0e0', 0.9);
        g.beginPath();
        g.arc(sx, sy, 1.3, Math.PI, Math.PI * 2);
        g.fill();
        g.fillStyle = rgba('#d0a880', 0.8);
        g.fillRect(sx - 1.3, sy - 0.2, 2.6, 0.5);
      }
    return c;
  }
  function texWater(v: number): HTMLCanvasElement {
    var c = Acan(48, 48),
      g = c.getContext('2d'),
      rnd = game.mulberry32(404 + v * 23);
    g.fillStyle = v ? '#447b89' : '#477f8c';
    g.fillRect(0, 0, 48, 48);
    for (var i = 0; i < 5; i++) {
      g.fillStyle = rgba('#78a7b6', 0.15);
      g.beginPath();
      g.ellipse(rnd() * 48, rnd() * 48, 7 + rnd() * 9, 3 + rnd() * 6, 0, 0, 7);
      g.fill();
    }
    for (i = 0; i < 2; i++) {
      g.fillStyle = rgba('#214d64', 0.14);
      g.beginPath();
      g.ellipse(rnd() * 48, rnd() * 48, 6 + rnd() * 8, 3 + rnd() * 5, 0, 0, 7);
      g.fill();
    }
    for (i = 0; i < 3; i++) {
      g.strokeStyle = 'rgba(180,225,255,0.12)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, 8 + i * 14);
      g.bezierCurveTo(12, 4 + i * 14, 30, 12 + i * 14, 48, 8 + i * 14);
      g.stroke();
    }
    return c;
  }
  // 3 shimmer frames drawn over water per-frame
  function texShimmer(f: number): HTMLCanvasElement {
    var c = Acan(48, 48),
      g = c.getContext('2d');
    for (var i = 0; i < 4; i++) {
      var y = (4 + i * 12 + f * 4) % 48;
      g.strokeStyle = 'rgba(215,240,255,0.18)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(-2, y);
      g.bezierCurveTo(12, y - 3, 30, y + 3, 50, y - 1);
      g.stroke();
    }
    for (i = 0; i < 4; i++) {
      var sx = 6 + ((f * 17 + i * 19) % 36),
        sy = (8 + i * 11 + f * 9) % 46;
      g.fillStyle = 'rgba(240,250,255,0.38)';
      g.fillRect(sx, sy, 2.8, 1);
    }
    return c;
  }
  // Dirt-and-cobble road menu icon.
  // Crossroad icon for the building menu. World roads use the landscape painter.
  function texRoad(): HTMLCanvasElement {
    var c = Acan(48, 48),
      g = c.getContext('2d'),
      rnd = game.mulberry32(895);
    var cx = 24,
      cy = 24;
    function armPts(dir: string): number[][] {
      var pts = [];
      for (var k = 0; k <= 4; k++) {
        var t = k / 4,
          wob = (rnd() - 0.5) * 3;
        if (dir === 'n') pts.push([cx + wob, cy - cy * t - 2]);
        if (dir === 's') pts.push([cx + wob, cy + (48 - cy) * t]);
        if (dir === 'w') pts.push([cx - cx * t - 1, cy + wob]);
        if (dir === 'e') pts.push([cx + (48 - cx) * t, cy + wob]);
      }
      return pts;
    }
    g.fillStyle = rgba('#a88858', 0.96);
    g.beginPath();
    var p = armPts('n');
    g.moveTo(p[0][0], p[0][1]);
    for (var k2 = 1; k2 < p.length; k2++) g.lineTo(p[k2][0], p[k2][1]);
    g.lineTo(cx + 7, cy);
    var p2 = armPts('e');
    g.lineTo(p2[p2.length - 1][0] - 5, p2[p2.length - 1][1]);
    for (k2 = p2.length - 2; k2 >= 0; k2--) g.lineTo(p2[k2][0] + 5, p2[k2][1]);
    var p3 = armPts('s');
    g.lineTo(p3[p3.length - 1][0] + 6, p3[p3.length - 1][1] - 1);
    for (k2 = p3.length - 2; k2 >= 0; k2--) g.lineTo(p3[k2][0] + 6, p3[k2][1]);
    var p4 = armPts('w');
    g.lineTo(p4[p4.length - 1][0] + 1, p4[p4.length - 1][1] + 6);
    for (k2 = p4.length - 2; k2 >= 0; k2--) g.lineTo(p4[k2][0], p4[k2][1] + 6);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba('#785830', 0.65);
    g.lineWidth = 1.6;
    g.stroke();
    var arms = ['n', 'e', 's', 'w'];
    function cobble(x: number, y: number, r: number): void {
      g.fillStyle = rgba('#b09060', 0.95);
      g.beginPath();
      g.ellipse(x, y, r, r * 0.72, rnd() * 3, 0, 7);
      g.fill();
      g.fillStyle = rgba('#d8c090', 0.95);
      g.beginPath();
      g.ellipse(x - r * 0.16, y - r * 0.18, r * 0.62, r * 0.45, 0, 0, 7);
      g.fill();
      g.fillStyle = rgba('#f0e0b0', 0.85);
      g.beginPath();
      g.ellipse(x - r * 0.3, y - r * 0.34, r * 0.28, r * 0.18, 0, 0, 7);
      g.fill();
    }
    for (var i = 0; i < arms.length; i++) {
      var p5 = armPts(arms[i]);
      for (var k3 = 1; k3 < p5.length; k3++) {
        var mx = (p5[k3][0] + p5[k3 - 1][0]) / 2,
          my = (p5[k3][1] + p5[k3 - 1][1]) / 2;
        cobble(mx + (rnd() - 0.5) * 3, my + (rnd() - 0.5) * 3, 2 + rnd() * 1.8);
      }
    }
    cobble(cx, cy, 3.2);
    // grass encroaching on the edges
    g.fillStyle = rgba('#4c8830', 0.55);
    for (i = 0; i < 5; i++) g.fillRect(rnd() * 46, rnd() * 46, 1.5, 1);
    g.fillStyle = rgba('#4c3820', 0.32);
    for (i = 0; i < 5; i++) g.fillRect(4 + rnd() * 40, 4 + rnd() * 40, 1.5, 1);
    return c;
  }

  // ---------- trees ----------
  function texTree(st: number, v: number, f: number): HTMLCanvasElement {
    // The same seed in both sway frames keeps leaves attached to their branches.
    var c = Acan(36 * SS, 42 * SS),
      g = c.getContext('2d'),
      rnd = game.mulberry32(3719 + st * 137 + v * 997),
      mature = st === 4,
      scale = st === 1 ? 0.34 : st === 2 ? 0.49 : st === 3 ? 0.72 : 1,
      baseY = 39,
      sway = (f ? 0.5 : -0.5) * scale;
    g.scale(SS, SS);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    // Root flare and lit bark are visible under the canopy.
    var bark = g.createLinearGradient(15, 0, 21, 0);
    bark.addColorStop(0, '#c09a5a');
    bark.addColorStop(0.4, '#836039');
    bark.addColorStop(1, '#453723');
    g.strokeStyle = bark;
    g.lineWidth = 3.5 * scale + 0.5;
    g.beginPath();
    g.moveTo(18, baseY);
    g.quadraticCurveTo(17.3, baseY - 7 * scale, 18 + sway, baseY - 20 * scale);
    g.stroke();
    g.lineWidth = 1.2 * scale;
    g.beginPath();
    g.moveTo(14.8, baseY);
    g.lineTo(18, baseY - 2);
    g.lineTo(21.2, baseY);
    g.moveTo(18, baseY - 8 * scale);
    g.lineTo(12 + sway, baseY - 15 * scale);
    g.moveTo(18, baseY - 11 * scale);
    g.lineTo(24 + sway, baseY - 18 * scale);
    g.stroke();
    if (v === 2 && st > 1) {
      // Jagged boughs replace the old flat triangular tiers. Lower boughs retain
      // a dark gap so the species and growth stage read at normal zoom.
      var tiers = mature ? 5 : st === 3 ? 4 : 3;
      for (var tier = 0; tier < tiers; tier++) {
        var cy = baseY - 7 * scale - tier * 5.7 * scale,
          breadth = (12 - tier * 1.7) * scale,
          top = cy - 9 * scale;
        g.beginPath();
        g.moveTo(18 + sway, top);
        for (var edge = 0; edge < 7; edge++) {
          var t = (edge + 1) / 7;
          g.lineTo(18 + sway + breadth * t * (0.9 + rnd() * 0.14), top + t * 10 * scale);
          g.lineTo(18 + sway + breadth * t * 0.72, top + t * 9.2 * scale);
        }
        g.lineTo(18 + sway, cy + 1.5 * scale);
        for (edge = 7; edge >= 0; edge--) {
          var tt = edge / 7;
          g.lineTo(18 + sway - breadth * tt * (0.9 + rnd() * 0.14), top + tt * 10 * scale);
          g.lineTo(18 + sway - breadth * tt * 0.76, top + tt * 9 * scale);
        }
        g.closePath();
        var pine = g.createLinearGradient(18 - breadth, top, 18 + breadth, cy + 2);
        pine.addColorStop(0, '#8b9e49');
        pine.addColorStop(0.4, '#4e7239');
        pine.addColorStop(1, '#173c28');
        g.fillStyle = pine;
        g.fill();
        g.save();
        g.clip();
        for (var n = 0; n < 75; n++) {
          var px = 18 + sway + (rnd() - 0.5) * breadth * 2,
            py = top + rnd() * 10 * scale;
          g.strokeStyle = rgba(px < 18 ? '#bbbf67' : '#244c2b', 0.25 + rnd() * 0.4);
          g.lineWidth = 0.45 * scale;
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(px + (px < 18 ? -1 : 1) * (0.6 + rnd()) * scale, py + scale);
          g.stroke();
        }
        g.restore();
      }
    } else {
      var R = 10.1 * scale * (0.94 + v * 0.09),
        cx = 18 + sway,
        cy0 = baseY - 11 * scale - R * 0.65,
        clumps = [
          [0, 0.12, 1],
          [-0.7, 0.1, 0.66],
          [0.68, 0.2, 0.66],
          [-0.42, -0.47, 0.65],
          [0.32, -0.6, 0.65],
          [0.55, -0.16, 0.65],
          [-0.05, 0.55, 0.52],
          [-0.47, 0.42, 0.53],
        ];
      // Hundreds of little leaf masses provide a scalloped, organic silhouette.
      // Each mass has its own relief; no oversized circular highlight discs.
      for (var layer = 0; layer < 2; layer++) {
        for (var ci = 0; ci < clumps.length; ci++) {
          var b = clumps[ci],
            bx = cx + b[0] * R,
            by = cy0 + b[1] * R,
            br = R * b[2];
          var count = layer ? 28 : 13;
          for (var j = 0; j < count; j++) {
            var angle = rnd() * Math.PI * 2,
              radius = Math.sqrt(rnd()) * br,
              lx = bx + Math.cos(angle) * radius,
              ly = by + Math.sin(angle) * radius,
              size = (layer ? 0.75 + rnd() * 1.15 : 1.4 + rnd() * 1.7) * scale,
              sunlight = Math.max(
                0,
                Math.min(1, 0.55 - (lx - cx) / (R * 2) - (ly - cy0) / (R * 2)),
              );
            g.fillStyle = layer
              ? mix('#355430', '#b3ba65', sunlight * (0.7 + rnd() * 0.3))
              : mix('#1e3e29', '#668346', sunlight * 0.8);
            g.beginPath();
            g.ellipse(lx, ly + (layer ? 0 : scale), size * 1.3, size, -0.3, 0, 7);
            g.fill();
            if (layer && sunlight > 0.5 && j % 3 === 0) {
              g.fillStyle = rgba('#d4cc82', sunlight * 0.35);
              g.beginPath();
              g.ellipse(lx - size * 0.3, ly - size * 0.45, size * 0.65, size * 0.35, -0.3, 0, 7);
              g.fill();
            }
          }
        }
      }
      if (mature && v === 1) {
        for (var fruit = 0; fruit < 7; fruit++) {
          var ax = cx + (rnd() - 0.5) * R * 1.6,
            ay = cy0 + (rnd() - 0.35) * R;
          g.fillStyle = '#8e3f24';
          g.beginPath();
          g.arc(ax, ay, 0.72, 0, 7);
          g.fill();
          g.fillStyle = '#e8a34b';
          g.beginPath();
          g.arc(ax - 0.2, ay - 0.2, 0.35, 0, 7);
          g.fill();
        }
      }
    }
    // Low ground foliage grounds the trunk without changing the feet anchor.
    g.strokeStyle = rgba('#8b9852', 0.72);
    g.lineWidth = 0.55;
    for (var tuft = 0; tuft < 6; tuft++) {
      var gx = 14 + rnd() * 8;
      g.beginPath();
      g.moveTo(gx, 39.5);
      g.lineTo(gx + (rnd() - 0.5) * 2, 37.7 + rnd());
      g.stroke();
    }
    return c;
  }
  // boulders

  function texRock(v: number): HTMLCanvasElement {
    var c = Acan(32 * SS, 24 * SS),
      g = c.getContext('2d'),
      rnd = game.mulberry32(8191 + v * 313);
    g.scale(SS, SS);
    g.lineJoin = 'round';
    function boulder(x: number, y: number, r: number): void {
      g.fillStyle = 'rgba(35,37,23,0.24)';
      g.beginPath();
      g.ellipse(x + r * 0.25, y + r * 0.62, r * 1.15, r * 0.36, 0, 0, 7);
      g.fill();
      g.beginPath();
      g.moveTo(x - r, y + r * 0.2);
      g.lineTo(x - r * 0.72, y - r * 0.61);
      g.quadraticCurveTo(x - r * 0.25, y - r * 1.08, x + r * 0.38, y - r * 0.93);
      g.lineTo(x + r * 0.97, y - r * 0.17);
      g.quadraticCurveTo(x + r * 1.02, y + r * 0.52, x + r * 0.35, y + r * 0.64);
      g.lineTo(x - r * 0.61, y + r * 0.54);
      g.closePath();
      var stone = g.createLinearGradient(x - r, y - r, x + r, y + r * 0.5);
      stone.addColorStop(0, '#ede2c9');
      stone.addColorStop(0.45, '#b6b3a6');
      stone.addColorStop(1, '#666c60');
      g.fillStyle = stone;
      g.fill();
      g.strokeStyle = rgba('#454838', 0.45);
      g.lineWidth = 0.45;
      g.stroke();
      g.save();
      g.clip();
      // Angular planes remain recognizable, softened by mineral/weather texture.
      g.fillStyle = 'rgba(253,242,213,0.2)';
      g.beginPath();
      g.moveTo(x - r * 0.72, y - r * 0.61);
      g.lineTo(x + r * 0.38, y - r * 0.93);
      g.lineTo(x + r * 0.27, y - r * 0.24);
      g.lineTo(x - r * 0.48, y - r * 0.05);
      g.closePath();
      g.fill();
      for (var i = 0; i < r * 15; i++) {
        var px = x + (rnd() - 0.5) * r * 2,
          py = y + (rnd() - 0.35) * r * 1.5;
        g.fillStyle = rgba(rnd() < 0.5 ? '#fff4db' : '#5b6654', 0.08 + rnd() * 0.17);
        g.beginPath();
        g.ellipse(px, py, 0.15 + rnd() * 0.3, 0.13 + rnd() * 0.23, 0, 0, 7);
        g.fill();
      }
      // Moss and lichen gather at the cooler foot of each boulder.
      for (i = 0; i < 15; i++) {
        var mx = x + (rnd() - 0.5) * r * 1.9,
          my = y + r * (0.15 + rnd() * 0.55);
        g.fillStyle = rgba(i % 3 ? '#536845' : '#b4b77c', 0.38 + rnd() * 0.2);
        g.beginPath();
        g.ellipse(mx, my, 0.35 + rnd() * r * 0.18, 0.2 + rnd() * r * 0.1, -0.3, 0, 7);
        g.fill();
      }
      g.strokeStyle = 'rgba(65,67,55,0.4)';
      g.lineWidth = 0.3;
      g.beginPath();
      g.moveTo(x - r * 0.3, y - r * 0.7);
      g.lineTo(x - r * 0.1, y - r * 0.15);
      g.lineTo(x - r * 0.45, y + r * 0.2);
      g.stroke();
      g.strokeStyle = 'rgba(255,244,212,0.48)';
      g.beginPath();
      g.moveTo(x - r * 0.26, y - r * 0.69);
      g.lineTo(x - r * 0.06, y - r * 0.15);
      g.stroke();
      g.restore();
    }
    if (v === 0) {
      boulder(11, 15, 5.6);
      boulder(23, 18, 2.6);
    } else {
      boulder(10, 16, 4.8);
      boulder(20, 14, 4.2);
      boulder(27, 19, 2.2);
    }
    g.lineWidth = 0.45;
    for (var blade = 0; blade < 18; blade++) {
      var x = 5 + rnd() * 22,
        y = 20 + rnd() * 2;
      g.strokeStyle = rgba(blade % 2 ? '#a5b16a' : '#51683b', 0.75);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 1.8, y - 0.7 - rnd() * 1.5);
      g.stroke();
    }
    return c;
  }

  // ---------- buildings ----------

  function bldSprite(
    type: BuildingType | 'site',
    painter: (g: CanvasRenderingContext2D, h: number, o: BldOptions) => void,
    opts: BldOptions,
  ): Sprite {
    opts = opts || {};
    var w = opts.w || 34,
      h = opts.h || 44;
    var c = Acan(w * SS, h * SS),
      g = c.getContext('2d');
    g.scale(SS, SS);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    painter(g, h, opts);
    paintWorkYard(g, type, w, h);
    return {
      img: c,
      w: w,
      h: h,
      ox: opts.ox !== undefined ? opts.ox : -(w - 24) / 2,
      oy: opts.oy !== undefined ? opts.oy : -(h - 24),
    };
  }
  // shared bits -------------------------------------------------------------
  function bShadow(
    g: CanvasRenderingContext2D,
    fx: number,
    fy: number,
    fw: number,
    fh: number,
  ): void {
    // A feathered contact patch grounds the walls without a second hard oval.
    // Rasterized only when the artwork is built, then reused as a texture.
    var cx = fx + fw * 0.6,
      cy = fy + fh * 0.74;
    g.save();
    g.translate(cx, cy);
    g.scale(fw * 0.75, fh * 0.43);
    var shade = g.createRadialGradient(0, 0, 0.1, 0, 0, 1);
    shade.addColorStop(0, 'rgba(24,31,25,0.32)');
    shade.addColorStop(0.45, 'rgba(24,31,25,0.23)');
    shade.addColorStop(0.78, 'rgba(24,31,25,0.09)');
    shade.addColorStop(1, 'rgba(24,31,25,0)');
    g.fillStyle = shade;
    g.beginPath();
    g.arc(0, 0, 1, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  function foundation(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    var rnd = game.mulberry32(Math.round(x * 331 + y * 229 + w * 727));
    // An irregular compacted-earth apron and fitted stone footings replace a
    // perfectly rectangular slab. Entrance and cargo feet stay unobstructed.
    g.fillStyle = rgba('#867453', 0.32);
    g.beginPath();
    g.ellipse(x + w / 2, y + h / 2, w * 0.65, h * 0.45, 0, 0, 7);
    g.fill();
    var rowHeight = 2.3;
    for (var row = 0; row < 2; row++) {
      var yy = y + h - 4.6 + row * rowHeight,
        xx = x - (row % 2) * 1.4;
      while (xx < x + w) {
        var bw = Math.min(3.7 + rnd() * 2, x + w - xx),
          stone = g.createLinearGradient(xx, yy, xx + bw, yy + rowHeight);
        stone.addColorStop(0, '#e2d7bb');
        stone.addColorStop(0.45, '#b0ac9a');
        stone.addColorStop(1, '#777c6e');
        rr(g, Math.max(x, xx) + 0.1, yy + 0.1, Math.max(0.2, bw - 0.2), rowHeight - 0.15, 0.45);
        g.fillStyle = stone;
        g.fill();
        g.strokeStyle = 'rgba(67,63,44,0.35)';
        g.lineWidth = 0.35;
        g.stroke();
        g.strokeStyle = 'rgba(255,244,212,0.52)';
        g.beginPath();
        g.moveTo(Math.max(x, xx) + 0.4, yy + 0.45);
        g.lineTo(xx + bw - 0.3, yy + 0.45);
        g.stroke();
        xx += bw;
      }
    }
    for (var tuft = 0; tuft < 8; tuft++) {
      var tx = x + rnd() * w,
        ty = y + h - 0.3 + rnd() * 0.8;
      if (tx > x + w * 0.35 && tx < x + w * 0.65) continue;
      g.strokeStyle = rgba(tuft % 2 ? '#96a363' : '#527342', 0.7);
      g.lineWidth = 0.4;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(tx - 0.65, ty - 1.3);
      g.moveTo(tx, ty);
      g.lineTo(tx + 0.5, ty - 1.7);
      g.stroke();
    }
  }

  function wallTex(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    c1: string,
    c2: string,
    plank: boolean,
  ): void {
    var rnd = game.mulberry32(Math.round(x * 91 + y * 113 + w * 197 + h * 311) + 7719),
      stone = c1 === PAL.stoneL || c1 === PAL.stone,
      gr = g.createLinearGradient(x, y, x + w, y + h * 0.25);
    gr.addColorStop(0, c1);
    gr.addColorStop(0.65, mix(c1, c2, 0.55));
    gr.addColorStop(1, sh(c2, 0.88));
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    if (stone) {
      // Staggered, subtly irregular ashlar blocks with lit bevels and mortar.
      for (var row = 0; row < Math.ceil(h / 2.8); row++) {
        var yy = y + row * 2.8,
          xx = x - (row % 2) * 2.4;
        while (xx < x + w) {
          var bw = 3.5 + rnd() * 2.5,
            bh = 2.35 + rnd() * 0.35;
          g.fillStyle = rgba(rnd() < 0.5 ? '#fff3dc' : '#756e61', 0.12 + rnd() * 0.1);
          rr(g, xx + 0.18, yy + 0.25, bw - 0.35, bh - 0.25, 0.35);
          g.fill();
          g.strokeStyle = rgba('#514e44', 0.35);
          g.lineWidth = 0.4;
          g.beginPath();
          g.moveTo(xx, yy + bh);
          g.lineTo(xx + bw, yy + bh);
          g.lineTo(xx + bw, yy + 0.2);
          g.stroke();
          g.strokeStyle = rgba('#fff8e9', 0.45);
          g.beginPath();
          g.moveTo(xx + 0.3, yy + 0.55);
          g.lineTo(xx + bw - 0.5, yy + 0.55);
          g.stroke();
          xx += bw;
        }
      }
    } else if (plank && c1 !== PAL.plasL && c1 !== PAL.plas) {
      g.lineWidth = 0.4;
      for (var py = y + 2.8; py < y + h; py += 2.8) {
        g.strokeStyle = rgba(sh(c2, 0.72), 0.48);
        g.beginPath();
        g.moveTo(x, py);
        g.lineTo(x + w, py);
        g.stroke();
        g.strokeStyle = rgba('#f5d59a', 0.22);
        g.beginPath();
        g.moveTo(x + 0.4, py - 0.7);
        g.bezierCurveTo(x + w * 0.3, py - 1.2, x + w * 0.6, py - 0.2, x + w - 0.4, py - 0.8);
        g.stroke();
      }
    }
    // Fine mineral flecks and broken brush strokes give plaster a matte finish.
    for (var speck = 0; speck < w * h * 0.45; speck++) {
      var sx = x + rnd() * w,
        sy = y + rnd() * h;
      g.fillStyle = rgba(rnd() < 0.5 ? '#fff9db' : '#8c7758', 0.055 + rnd() * 0.1);
      g.fillRect(sx, sy, 0.22 + rnd() * 0.65, 0.18 + rnd() * 0.4);
    }
    // Dampness at the base, stronger occlusion below the eaves.
    var weather = g.createLinearGradient(0, y, 0, y + h);
    weather.addColorStop(0, 'rgba(56,39,23,0.15)');
    weather.addColorStop(0.25, 'rgba(56,39,23,0)');
    weather.addColorStop(0.8, 'rgba(56,39,23,0)');
    weather.addColorStop(1, 'rgba(68,71,39,0.19)');
    g.fillStyle = weather;
    g.fillRect(x, y, w, h);
    g.restore();
    g.strokeStyle = rgba(PAL.out, 0.6);
    g.lineWidth = 0.65;
    g.strokeRect(x, y, w, h);
  }

  function window2(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    lit: boolean,
  ): void {
    g.fillStyle = rgba(PAL.out, 0.5);
    g.fillRect(x - 0.6, y - 0.8, w + 1.2, 0.9); // lintel
    g.fillStyle = PAL.win;
    rr(g, x, y, w, h, 1);
    F(g, PAL.win);
    if (lit) {
      g.fillStyle = rgba(PAL.glow, 0.92);
      g.fillRect(x + 0.8, y + 0.8, w - 1.6, h - 1.6);
    }
    g.strokeStyle = rgba('#241a10', 0.6);
    g.lineWidth = 0.5;
    g.strokeRect(x, y, w, h);
    g.fillStyle = rgba('#241a10', 0.55);
    g.fillRect(x + w / 2 - 0.4, y, 0.8, h);
    g.fillRect(x, y + h / 2 - 0.4, w, 0.8);
    g.fillStyle = rgba('#f4f8ff', 0.35);
    g.fillRect(x + 0.8, y + 0.8, w * 0.32, 1);
    // shutters
    g.fillStyle = rgba('#8a5f34', 0.85);
    g.fillRect(x - 1.4, y + 0.4, 1.2, h - 0.8);
    g.fillRect(x + w + 0.2, y + 0.4, 1.2, h - 0.8);
  }
  function door2(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    g.fillStyle = PAL.door;
    g.beginPath();
    g.moveTo(x, y + h);
    g.lineTo(x, y + w * 0.35);
    g.arc(x + w / 2, y + w * 0.35, w / 2, Math.PI, 0);
    g.lineTo(x + w, y + h);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba(PAL.out, 0.7);
    g.lineWidth = 0.7;
    g.stroke();
    g.strokeStyle = rgba(sh(PAL.door, 1.35), 0.55);
    g.beginPath();
    g.moveTo(x + w * 0.3, y + w * 0.3);
    g.lineTo(x + w * 0.3, y + h);
    g.moveTo(x + w * 0.7, y + w * 0.3);
    g.lineTo(x + w * 0.7, y + h);
    g.stroke();
    g.strokeStyle = rgba(sh(PAL.door, 0.7), 0.8);
    g.beginPath();
    g.moveTo(x + w / 2, y + 2);
    g.lineTo(x + w / 2, y + h);
    g.stroke();
    g.fillStyle = '#c9a75c';
    g.beginPath();
    g.arc(x + w * 0.68, y + h * 0.5, 0.7, 0, 7);
    g.fill();
    // Narrow carved surround and iron straps add depth without closing the door.
    g.strokeStyle = rgba('#d5ad71', 0.68);
    g.lineWidth = 0.5;
    g.beginPath();
    g.moveTo(x - 0.6, y + h);
    g.lineTo(x - 0.6, y + w * 0.35);
    g.arc(x + w / 2, y + w * 0.35, w / 2 + 0.6, Math.PI, 0);
    g.lineTo(x + w + 0.6, y + h);
    g.stroke();
    g.fillStyle = '#4b4635';
    g.fillRect(x + 0.2, y + h * 0.36, w * 0.3, 0.45);
    g.fillRect(x + 0.2, y + h * 0.76, w * 0.3, 0.45);
    g.fillStyle = rgba('#d7c8a8', 0.9);
    g.fillRect(x - 0.5, y + h - 0.1, w + 1, 0.6);
  }
  function roof2(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    cMain: string,
    cL: string,
    cD: string,
    over?: number,
  ): void {
    over = over === undefined ? 2 : over;
    var cx = x + w / 2,
      half = w / 2 + over,
      rnd = game.mulberry32(Math.round(x * 211 + y * 377 + w * 97 + h * 313) + 2818),
      straw = cMain === PAL.thatch,
      slate = cMain === PAL.slate,
      tile = cMain === PAL.tile;
    // Subtle outward eave curve gives roofs weight; sizes and ridge stay fixed.
    g.beginPath();
    g.moveTo(cx, y);
    g.quadraticCurveTo(cx - half * 0.38, y + h * 0.58, x - over, y + h);
    g.quadraticCurveTo(cx, y + h + 1, x + w + over, y + h);
    g.quadraticCurveTo(cx + half * 0.38, y + h * 0.58, cx, y);
    g.closePath();
    var gradient = g.createLinearGradient(x - over, y, x + w + over, y + h * 0.7);
    gradient.addColorStop(0, cL);
    gradient.addColorStop(0.46, mix(cL, cMain, 0.3));
    gradient.addColorStop(0.52, cMain);
    gradient.addColorStop(1, cD);
    g.fillStyle = gradient;
    g.fill();
    g.strokeStyle = rgba('#4b3723', 0.65);
    g.lineWidth = 0.7;
    g.stroke();
    g.save();
    g.clip();
    if (straw) {
      // Individually combed strands, bundles and broken bright straw ends.
      for (var i = 0; i < 150; i++) {
        var sx = x - over + rnd() * (w + over * 2),
          sy = y + rnd() * h,
          len = 1.4 + rnd() * 4.5,
          dir = (sx - cx) / half;
        g.strokeStyle = rgba(i % 3 ? '#fff1b2' : '#815526', 0.2 + rnd() * 0.4);
        g.lineWidth = 0.25 + rnd() * 0.25;
        g.beginPath();
        g.moveTo(sx, sy);
        g.quadraticCurveTo(sx + dir * 0.6, sy + len * 0.6, sx + dir * 1.6, sy + len);
        g.stroke();
      }
      for (var bundle = 1; bundle < 4; bundle++) {
        g.strokeStyle = rgba('#8b5e29', 0.3);
        g.lineWidth = 0.45;
        g.beginPath();
        g.moveTo(cx - (half * bundle) / 4, y + (h * bundle) / 4);
        g.quadraticCurveTo(
          cx,
          y + (h * bundle) / 4 + 0.7,
          cx + (half * bundle) / 4,
          y + (h * bundle) / 4,
        );
        g.stroke();
      }
    } else {
      // Each terracotta/slate/shingle has a curved lip, shadow gap and bevel.
      var rows = Math.max(4, Math.round(h / 1.7)),
        rh = h / rows,
        tw = slate ? 2.5 : tile ? 2.1 : 2.9;
      for (var row = 0; row < rows; row++) {
        var yy = y + row * rh;
        for (var xx = x - over - tw + (row % 2) * tw * 0.5; xx < x + w + over; xx += tw) {
          var lit = xx < cx,
            base = lit ? mix(cL, cMain, 0.12 + rnd() * 0.3) : mix(cMain, cD, 0.28 + rnd() * 0.35);
          g.fillStyle = sh(base, 0.9 + rnd() * 0.18);
          g.beginPath();
          g.moveTo(xx + 0.12, yy);
          g.lineTo(xx + tw - 0.12, yy);
          g.lineTo(xx + tw - 0.2, yy + rh * 0.84);
          g.quadraticCurveTo(xx + tw * 0.5, yy + rh * 1.15, xx + 0.15, yy + rh * 0.88);
          g.closePath();
          g.fill();
          g.strokeStyle = rgba(sh(base, 0.5), 0.5);
          g.lineWidth = 0.28;
          g.stroke();
          g.strokeStyle = rgba(lit ? '#ffe5b1' : '#cad0b6', 0.35);
          g.beginPath();
          g.moveTo(xx + 0.45, yy + 0.3);
          g.lineTo(xx + 0.35, yy + rh * 0.75);
          g.quadraticCurveTo(xx + tw * 0.5, yy + rh * 0.97, xx + tw - 0.45, yy + rh * 0.78);
          g.stroke();
          if (!slate && !tile) {
            g.strokeStyle = rgba('#402d1b', 0.2);
            g.beginPath();
            g.moveTo(xx + tw * 0.45, yy + 0.25);
            g.lineTo(xx + tw * 0.6, yy + rh * 0.7);
            g.stroke();
          }
        }
      }
    }
    // Roof moss is sparse and shaded, preserving the roof's identifying color.
    for (var m = 0; m < (straw ? 0 : 8); m++) {
      g.fillStyle = rgba('#687545', 0.22);
      g.beginPath();
      g.ellipse(
        cx + rnd() * half,
        y + h * (0.6 + rnd() * 0.4),
        0.7 + rnd(),
        0.25 + rnd() * 0.4,
        0,
        0,
        7,
      );
      g.fill();
    }
    g.restore();
    // Rounded cap runs down the hip ridge, with a bright narrow NW rim.
    g.strokeStyle = sh(cD, 1.08);
    g.lineWidth = straw ? 1.4 : 1.15;
    g.beginPath();
    g.moveTo(cx, y + 0.3);
    g.lineTo(cx, y + h - 0.6);
    g.stroke();
    g.strokeStyle = rgba(cL, 0.8);
    g.lineWidth = 0.35;
    g.beginPath();
    g.moveTo(cx - 0.4, y + 0.3);
    g.lineTo(cx - 0.4, y + h - 0.6);
    g.stroke();
    g.fillStyle = 'rgba(40,28,16,0.38)';
    g.fillRect(x, y + h - 0.2, w, 1.15);
    g.strokeStyle = rgba(cL, 0.5);
    g.lineWidth = 0.4;
    g.beginPath();
    g.moveTo(x - over + 1, y + h - 0.25);
    g.lineTo(x + w + over - 1, y + h - 0.25);
    g.stroke();
  }

  function chimney(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    g.fillStyle = '#a09a90';
    g.fillRect(x, y, w, h);
    g.fillStyle = sh('#a09a90', 0.78);
    g.fillRect(x + w * 0.55, y, w * 0.45, h);
    g.strokeStyle = rgba(PAL.out, 0.3);
    g.lineWidth = 0.5;
    g.beginPath();
    g.moveTo(x, y + h * 0.45);
    g.lineTo(x + w, y + h * 0.45);
    g.stroke();
    g.fillStyle = '#c8c2b8';
    g.fillRect(x - 0.6, y - 1.6, w + 1.2, 2);
    g.fillStyle = '#5c4a3a';
    g.fillRect(x + w * 0.25, y - 2.6, w * 0.5, 1.2); // pot
    g.strokeStyle = rgba(PAL.out, 0.5);
    g.lineWidth = 0.6;
    g.strokeRect(x, y, w, h);
  }
  function bannerPole(g: CanvasRenderingContext2D, x: number, y: number, len: number): void {
    g.strokeStyle = '#6a4a28';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y + len);
    g.stroke();
    g.fillStyle = '#d8c07c';
    g.beginPath();
    g.arc(x, y - 1, 1.1, 0, 7);
    g.fill();
  }
  // painters -----------------------------------------------------------------
  function paintHQ(g: CanvasRenderingContext2D, h: number): void {
    var fx = 2,
      fy = h - 26,
      fw = 40,
      fh = 25;
    bShadow(g, fx, fy, fw, fh);
    foundation(g, fx + 2, fy + 18, fw - 4, 8);
    // stone ground floor with quoins
    wallTex(g, fx + 2, fy + 9, fw - 4, 10, PAL.stoneL, PAL.stoneD, false);
    g.fillStyle = PAL.stoneL;
    g.fillRect(fx + 2, fy + 9, 1.6, 10);
    g.fillRect(fx + fw - 3.6, fy + 9, 1.6, 10);
    // plaster upper hall, half-timbered
    wallTex(g, fx + 5, fy - 2, fw - 14, 11, PAL.plasL, PAL.plasD, true);
    g.fillStyle = PAL.beamD;
    g.fillRect(fx + 5, fy - 2, 2, 11);
    g.fillRect(fx + 23.8, fy - 2, 2, 11);
    g.fillRect(fx + 14.4, fy - 2, 1.6, 11);
    g.fillRect(fx + 5, fy + 3.6, fw - 14, 1.4);
    g.strokeStyle = rgba(PAL.beamD, 0.85);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(fx + 7, fy + 9);
    g.lineTo(fx + 13.4, fy - 2);
    g.moveTo(fx + 23.8, fy + 9);
    g.lineTo(fx + 17.4, fy - 2);
    g.stroke();
    g.fillStyle = PAL.beam;
    g.fillRect(fx + 5, fy - 2, 0.8, 11);
    g.fillRect(fx + 23.8, fy - 2, 0.8, 11);
    // upper windows
    window2(g, fx + 7.5, fy, 4.4, 5.2, true);
    window2(g, fx + 16.5, fy, 4.4, 5.2, true);
    // ground floor windows + grand door with steps and lantern
    window2(g, fx + 7, fy + 12.5, 3.8, 4.2, false);
    window2(g, fx + 29, fy + 12.5, 3.8, 4.2, false);
    g.fillStyle = PAL.door;
    g.beginPath();
    g.moveTo(fx + 17, fy + 19);
    g.lineTo(fx + 17, fy + 13.5);
    g.arc(fx + 20.5, fy + 13.5, 3.5, Math.PI, 0);
    g.lineTo(fx + 24, fy + 19);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba(PAL.out, 0.7);
    g.lineWidth = 0.7;
    g.stroke();
    g.strokeStyle = rgba(sh(PAL.door, 0.7), 0.85);
    g.beginPath();
    g.moveTo(fx + 20.5, fy + 10.4);
    g.lineTo(fx + 20.5, fy + 19);
    g.stroke();
    g.fillStyle = '#c9a75c';
    g.beginPath();
    g.arc(fx + 22.2, fy + 16, 0.7, 0, 7);
    g.fill();
    g.fillStyle = '#6a4a28';
    g.fillRect(fx + 24.6, fy + 9.4, 1, 1.6);
    g.fillStyle = rgba(PAL.glow, 0.95);
    g.fillRect(fx + 24.7, fy + 10.6, 0.8, 1);
    g.fillStyle = PAL.stoneL;
    g.fillRect(fx + 16, fy + 19, 9, 1.6);
    g.fillRect(fx + 15, fy + 20.4, 11, 1.6);
    // left stone tower with pointed red cap
    wallTex(g, fx - 2, fy - 8, 11, 28, PAL.stoneL, PAL.stoneD, false);
    g.strokeStyle = rgba(PAL.out, 0.5);
    g.lineWidth = 0.7;
    for (var yy = fy - 6; yy < fy + 20; yy += 3.4) {
      g.beginPath();
      g.moveTo(fx - 1, yy);
      g.lineTo(fx + 9, yy);
      g.stroke();
    }
    window2(g, fx + 2.2, fy + 4, 3.4, 4.4, true);
    window2(g, fx + 2.2, fy + 13, 3.4, 4.4, true);
    roof2(g, fx - 3.5, fy - 17, 14, 10, PAL.tile, PAL.tileL, PAL.tileD, 1);
    // main roof: hipped red tile
    roof2(g, fx + 3, fy - 13, fw - 10, 12, PAL.tile, PAL.tileL, PAL.tileD);
    g.fillStyle = sh(PAL.tileD, 1.3);
    g.beginPath();
    g.moveTo(fx + 3, fy - 13);
    g.lineTo(fx + 13.5, fy - 13);
    g.lineTo(fx + 8.5, fy - 19);
    g.lineTo(fx + 3, fy - 13);
    g.closePath();
    g.fill();
    chimney(g, fx + 25, fy - 21, 5, 9);
    chimney(g, fx + 12, fy - 20, 4.4, 8);
    // pennant
    bannerPole(g, fx + fw + 2.5, fy - 30, 15);
  }
  function paintWarehouse(g: CanvasRenderingContext2D, h: number): void {
    var fx = 3,
      fy = h - 22,
      fw = 30,
      fh = 21;
    bShadow(g, fx, fy, fw, fh);
    foundation(g, fx + 2, fy + 15, fw - 4, 7);
    wallTex(g, fx + 2, fy - 1, fw - 4, 17, PAL.plasL, PAL.plasD, true);
    g.fillStyle = PAL.beam;
    g.fillRect(fx + 2, fy - 1, 2.2, 17);
    g.fillRect(fx + fw - 4.2, fy - 1, 2.2, 17);
    g.fillRect(fx + 13.8, fy - 1, 2.2, 17);
    g.strokeStyle = rgba(PAL.beamD, 0.8);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(fx + 4.2, fy + 16);
    g.lineTo(fx + 13.8, fy - 1);
    g.stroke();
    // big double door with lintel + handles
    g.fillStyle = PAL.door;
    g.fillRect(fx + 6, fy + 8, 8.6, 9);
    g.strokeStyle = rgba(PAL.out, 0.6);
    g.lineWidth = 0.7;
    g.strokeRect(fx + 6, fy + 8, 8.6, 9);
    g.strokeStyle = rgba(sh(PAL.door, 0.72), 0.9);
    g.beginPath();
    g.moveTo(fx + 10.3, fy + 8);
    g.lineTo(fx + 10.3, fy + 17);
    g.stroke();
    g.fillStyle = '#c9a75c';
    g.beginPath();
    g.arc(fx + 8.4, fy + 12.5, 0.6, 0, 7);
    g.arc(fx + 12.2, fy + 12.5, 0.6, 0, 7);
    g.fill();
    g.fillStyle = rgba(PAL.beam, 0.9);
    g.fillRect(fx + 5.2, fy + 6.8, 10.2, 1.4);
    window2(g, fx + 17.5, fy + 3, 4, 4, false);
    window2(g, fx + 23, fy + 3, 4, 4, false);
    roof2(g, fx - 2, fy - 12, fw, 11, PAL.thatch, PAL.thatchL, PAL.thatchD);
    // thatch comb ridge
    g.strokeStyle = rgba(sh(PAL.thatchD, 0.8), 0.7);
    g.lineWidth = 0.7;
    for (var i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(fx - 1 + i * 5.4, fy - 12);
      g.lineTo(fx - 1 + i * 5.4 + 2.7, fy - 13.8);
      g.stroke();
    }
    // goods yard: crate + barrels + grain sacks
    g.fillStyle = '#a5774a';
    g.fillRect(fx + 23.5, fy + 13, 6, 6);
    g.strokeStyle = rgba(PAL.out, 0.6);
    g.lineWidth = 0.6;
    g.strokeRect(fx + 23.5, fy + 13, 6, 6);
    g.strokeStyle = rgba(sh('#a5774a', 0.7), 0.8);
    g.strokeRect(fx + 24.5, fy + 14, 4, 4);
    g.strokeStyle = rgba(sh('#a5774a', 1.3), 0.7);
    g.beginPath();
    g.moveTo(fx + 23.5, fy + 13);
    g.lineTo(fx + 29.5, fy + 19);
    g.stroke();
    function barrel(x: number, y: number): void {
      g.fillStyle = '#8a5f34';
      rr(g, x, y, 4.6, 5.4, 1.5);
      F(g, '#8a5f34');
      g.strokeStyle = '#5a3e22';
      g.lineWidth = 0.6;
      g.stroke();
      g.fillStyle = '#c9a75c';
      g.fillRect(x, y + 1.8, 4.6, 1);
      g.fillRect(x, y + 3.6, 4.6, 0.7);
    }
    barrel(fx + 1, fy + 14);
    barrel(fx + 6.5, fy + 15);
    g.fillStyle = '#d8c48e';
    g.beginPath();
    g.ellipse(fx + 19.5, fy + 18, 2.4, 1.9, 0, 0, 7);
    g.fill();
    g.beginPath();
    g.ellipse(fx + 22.6, fy + 18.4, 1.9, 1.5, 0, 0, 7);
    g.fill();
    g.strokeStyle = rgba('#a08a5c', 0.7);
    g.lineWidth = 0.5;
    g.beginPath();
    g.ellipse(fx + 19.5, fy + 18, 2.4, 1.9, 0, 0, 7);
    g.stroke();
    g.beginPath();
    g.ellipse(fx + 22.6, fy + 18.4, 1.9, 1.5, 0, 0, 7);
    g.stroke();
    bannerPole(g, fx + fw - 1, fy - 22, 10);
  }
  function paintLumberjack(g: CanvasRenderingContext2D, h: number, o: BldOptions): void {
    var fx = 3,
      fy = h - 21,
      fw = 26,
      fh = 20,
      v = o.v || 0;
    bShadow(g, fx, fy, fw, fh);
    foundation(g, fx + 1.5, fy + 14, fw - 3, 6.5);
    // log-cabin walls: stacked logs with chinking
    for (var i = 0; i < 5; i++) {
      var yy = fy + 13 - i * 3;
      var log = g.createLinearGradient(0, yy, 0, yy + 2.8);
      log.addColorStop(0, '#dfb77b');
      log.addColorStop(0.25, i % 2 ? '#b18a56' : '#c49a60');
      log.addColorStop(0.6, '#a77e49');
      log.addColorStop(1, '#634729');
      rr(g, fx + 1.5, yy, fw - 3, 2.8, 1.4);
      F(g, log);
      g.strokeStyle = rgba('#4a3018', 0.5);
      g.lineWidth = 0.5;
      g.stroke();
      g.strokeStyle = rgba('#d8b884', 0.35);
      g.beginPath();
      g.moveTo(fx + 3, yy + 1.4);
      g.bezierCurveTo(fx + 8, yy + 0.8, fx + 16, yy + 2, fx + fw - 3, yy + 1.4);
      g.stroke();
    }
    // log ends (circles) on right edge
    for (i = 0; i < 5; i++) {
      var yy2 = fy + 14 - i * 3;
      g.fillStyle = '#c9a06a';
      g.beginPath();
      g.arc(fx + fw - 2.4, yy2 + 1.4, 1.2, 0, 7);
      g.fill();
      g.fillStyle = '#8a6238';
      g.beginPath();
      g.arc(fx + fw - 2.4, yy2 + 1.4, 0.6, 0, 7);
      g.fill();
    }
    door2(g, fx + 9, fy + 6.5, 5.6, 7.8);
    window2(g, fx + 17, fy + 7.5, 4, 4, true);
    // wood-shingle roof (variant alt color)
    roof2(
      g,
      fx - 1.5,
      fy - 10,
      fw + 3,
      10,
      v ? '#a8763c' : PAL.woodD,
      v ? sh('#a8763c', 1.25) : sh(PAL.woodD, 1.5),
      sh(v ? '#a8763c' : PAL.woodD, 0.72),
    );
    // axe in stump + log pile
    g.fillStyle = '#7a5630';
    g.fillRect(fx + 27, fy + 11, 4.4, 3.4);
    g.fillStyle = '#8a6238';
    g.beginPath();
    g.arc(fx + 29.2, fy + 11, 1.9, 0, 7);
    g.fill();
    g.fillStyle = '#c9a06a';
    g.beginPath();
    g.arc(fx + 29.2, fy + 11, 1.1, 0, 7);
    g.fill();
    g.strokeStyle = '#98a2ac';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(fx + 29.2, fy + 11);
    g.lineTo(fx + 31, fy + 5);
    g.stroke();
    g.fillStyle = '#c9ccd2';
    g.fillRect(fx + 30.4, fy + 4, 2.4, 2.6);
    g.fillStyle = '#a5774a';
    for (i = 0; i < 3; i++) {
      rr(g, fx + 26, fy + 17 - i * 1.8, 7, 1.7, 0.8);
      F(g, '#a5774a');
    }
    g.fillStyle = '#c9a06a';
    g.beginPath();
    g.arc(fx + 31.8, fy + 15.6, 0.8, 0, 7);
    g.arc(fx + 31.8, fy + 13.9, 0.8, 0, 7);
    g.fill();
  }
  function paintForester(g: CanvasRenderingContext2D, h: number, o: BldOptions): void {
    var fx = 4,
      fy = h - 21,
      fw = 24,
      fh = 20,
      v = o.v || 0;
    bShadow(g, fx, fy, fw, fh);
    foundation(g, fx + 1.5, fy + 14, fw - 3, 6.5);
    wallTex(
      g,
      fx + 1.5,
      fy - 1,
      fw - 3,
      15,
      v ? mix(PAL.plas, '#d8e2c2', 0.5) : PAL.plasL,
      mix(PAL.plasD, '#b8c49a', 0.5),
      true,
    );
    g.fillStyle = PAL.beam;
    g.fillRect(fx + 1.5, fy - 1, 2, 15);
    g.fillRect(fx + fw - 3.5, fy - 1, 2, 15);
    g.fillStyle = rgba(PAL.beamD, 0.9);
    g.fillRect(fx + 1.5, fy + 6.6, fw - 3, 1.2);
    door2(g, fx + 10, fy + 6, 5.2, 8);
    window2(g, fx + 16.5, fy + 4, 4, 4, true);
    // window flower box
    g.fillStyle = '#7a4a22';
    g.fillRect(fx + 16.2, fy + 8, 4.6, 1.2);
    g.fillStyle = rgba(PAL.leaf3, 0.9);
    g.beginPath();
    g.arc(fx + 17.2, fy + 8, 0.8, 0, 7);
    g.arc(fx + 19.6, fy + 8, 0.8, 0, 7);
    g.fill();
    g.fillStyle = '#e06a6a';
    g.beginPath();
    g.arc(fx + 18.4, fy + 7.8, 0.5, 0, 7);
    g.fill();
    roof2(
      g,
      fx - 1,
      fy - 10,
      fw + 2,
      10,
      v ? PAL.slate : PAL.thatch,
      v ? PAL.slateL : PAL.thatchL,
      v ? PAL.slateD : PAL.thatchD,
    );
    // nursery: staked saplings in a bed
    g.strokeStyle = rgba('#8a6238', 0.8);
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(fx + 26.5, fy + 13);
    g.lineTo(fx + 32.5, fy + 13);
    g.stroke();
    g.fillStyle = rgba('#6b4a2a', 0.4);
    g.beginPath();
    g.ellipse(fx + 29.5, fy + 14.5, 3.4, 0.9, 0, 0, 7);
    g.fill();
    for (var i = 0; i < 3; i++) {
      var sx = fx + 27 + (i % 2) * 3.5,
        sy = fy + 9 + (i > 1 ? 5 : 0);
      g.strokeStyle = '#7a5630';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(sx, sy + 5);
      g.lineTo(sx, sy);
      g.stroke();
      g.fillStyle = i % 2 ? PAL.leaf2 : PAL.leaf3;
      g.beginPath();
      g.arc(sx, sy - 0.5, 2.1, 0, 7);
      g.fill();
      g.fillStyle = rgba(PAL.leaf4, 0.8);
      g.beginPath();
      g.arc(sx - 0.5, sy - 1.2, 1.2, 0, 7);
      g.fill();
    }
  }
  function paintSawmill(g: CanvasRenderingContext2D, h: number): void {
    var fx = 3,
      fy = h - 22,
      fw = 29,
      fh = 21;
    bShadow(g, fx, fy, fw, fh);
    foundation(g, fx + 1.5, fy + 15, fw - 3, 7);
    // open-sided shed
    wallTex(g, fx + 1.5, fy - 2, fw - 8, 16, PAL.plasL, PAL.plasD, false);
    g.fillStyle = PAL.beam;
    g.fillRect(fx + 1.5, fy - 2, 2.2, 16);
    g.fillRect(fx + fw - 8.7, fy - 2, 2.2, 16);
    g.fillStyle = rgba(PAL.beamD, 0.9);
    g.fillRect(fx + 3.7, fy + 5.6, fw - 10.9, 1.2);
    // open bay (dark) with rotating blade painted dynamically at (bx,by)
    g.fillStyle = '#241a10';
    g.fillRect(fx + 16, fy - 1, 8.6, 14);
    g.strokeStyle = rgba(PAL.out, 0.6);
    g.lineWidth = 0.8;
    g.strokeRect(fx + 16, fy - 1, 8.6, 14);
    door2(g, fx + 4.5, fy + 6.5, 5.4, 8);
    window2(g, fx + 11, fy + 2.5, 3.6, 3.6, true);
    roof2(g, fx - 1.5, fy - 11, fw - 4, 10, PAL.slate, PAL.slateL, PAL.slateD);
    // log on trestle + sawdust + offcut planks
    g.fillStyle = '#a5774a';
    g.fillRect(fx + 2, fy + 16.5, 14, 2.6);
    g.fillStyle = '#c9a06a';
    g.beginPath();
    g.arc(fx + 2, fy + 17.8, 1.3, 0, 7);
    g.fill();
    g.strokeStyle = '#6a4a28';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(fx + 5, fy + 19);
    g.lineTo(fx + 4.4, fy + 22);
    g.moveTo(fx + 12.5, fy + 19);
    g.lineTo(fx + 13.1, fy + 22);
    g.stroke();
    g.fillStyle = rgba('#d9c08c', 0.85);
    g.beginPath();
    g.ellipse(fx + 22, fy + 19, 4.4, 1.7, 0, 0, 7);
    g.fill();
    g.fillStyle = '#c8a468';
    g.fillRect(fx + 24, fy + 21.2, 7, 1.2);
    g.fillRect(fx + 24.6, fy + 20.2, 6, 1.1);
    // blade mount (visible part left of bay)
    g.fillStyle = '#6a7078';
    g.fillRect(fx + 15.2, fy + 2, 1.8, 10);
  }
  function paintQuarry(g: CanvasRenderingContext2D, h: number): void {
    var fx = 2,
      fy = h - 22,
      fw = 32,
      fh = 21;
    bShadow(g, fx, fy, fw, fh);
    // rocky pit mound
    g.fillStyle = '#8d887c';
    g.beginPath();
    g.moveTo(fx, fy + 20);
    g.lineTo(fx + 5, fy + 8);
    g.lineTo(fx + 14, fy + 3);
    g.lineTo(fx + 24, fy + 4);
    g.lineTo(fx + 32, fy + 10);
    g.lineTo(fx + 32, fy + 20);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba(PAL.out, 0.45);
    g.lineWidth = 0.8;
    g.stroke();
    g.fillStyle = rgba('#a8a296', 0.6);
    g.beginPath();
    g.moveTo(fx + 5, fy + 8);
    g.lineTo(fx + 14, fy + 3);
    g.lineTo(fx + 15, fy + 8);
    g.lineTo(fx + 7, fy + 11);
    g.closePath();
    g.fill();
    // cut stone blocks
    g.fillStyle = '#b5babf';
    g.fillRect(fx + 4, fy + 12, 7, 5);
    g.fillRect(fx + 13, fy + 14, 7, 5);
    g.fillRect(fx + 22, fy + 12, 7, 5);
    g.fillRect(fx + 8, fy + 8, 6, 4.5);
    g.fillRect(fx + 17, fy + 8.5, 6, 4.5);
    g.fillStyle = 'rgba(255,255,255,0.32)';
    g.fillRect(fx + 4, fy + 12, 7, 1);
    g.fillRect(fx + 13, fy + 14, 7, 1);
    g.fillRect(fx + 22, fy + 12, 7, 1);
    g.fillRect(fx + 8, fy + 8, 6, 1);
    g.fillRect(fx + 17, fy + 8.5, 6, 1);
    g.fillStyle = 'rgba(40,36,30,0.3)';
    g.fillRect(fx + 4, fy + 16, 7, 1);
    g.fillRect(fx + 13, fy + 18, 7, 1);
    g.fillRect(fx + 22, fy + 16, 7, 1);
    // crane A-frame + rope + pulley + hook block
    g.strokeStyle = '#6a4a28';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(fx + 8, fy + 21);
    g.lineTo(fx + 14, fy - 6);
    g.lineTo(fx + 20, fy + 21);
    g.stroke();
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(fx + 14, fy - 6);
    g.lineTo(fx + 14, fy + 2);
    g.stroke();
    g.fillStyle = '#98a2ac';
    g.fillRect(fx + 12.4, fy + 2, 3.2, 3);
    g.fillStyle = '#5c626a';
    g.beginPath();
    g.arc(fx + 14, fy - 6, 1.2, 0, 7);
    g.fill();
    // pick stuck in the ground
    g.strokeStyle = '#8a6238';
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(fx + 27, fy + 17);
    g.lineTo(fx + 29.4, fy + 11);
    g.stroke();
    g.strokeStyle = '#9aa2aa';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(fx + 27.6, fy + 11.6);
    g.quadraticCurveTo(fx + 29.4, fy + 10.2, fx + 31, fy + 11.8);
    g.stroke();
    // rubble + tracks
    for (var i = 0; i < 6; i++) {
      g.fillStyle = rgba('#8a857b', 0.9);
      g.beginPath();
      g.arc(fx + 3 + i * 5.2, fy + 20.6, 1.5, 0, 7);
      g.fill();
    }
  }
  function paintFisherman(g: CanvasRenderingContext2D, h: number, o: BldOptions): void {
    var fx = 3,
      fy = h - 20,
      fw = 25,
      fh = 19,
      v = o.v || 0;
    bShadow(g, fx, fy, fw, fh);
    // stilt hut
    wallTex(
      g,
      fx + 1.5,
      fy - 2,
      fw - 9,
      13,
      v ? mix(PAL.plas, '#c2d4de', 0.55) : PAL.plasL,
      mix(PAL.plasD, '#9aa8b4', 0.55),
      true,
    );
    g.fillStyle = PAL.beam;
    g.fillRect(fx + 1.5, fy - 2, 2, 13);
    g.fillRect(fx + 13.9, fy - 2, 2, 13);
    door2(g, fx + 4.5, fy + 3.5, 5, 6.5);
    window2(g, fx + 12, fy + 1, 3.4, 3.4, true);
    roof2(
      g,
      fx - 1,
      fy - 10,
      fw - 7,
      9,
      v ? PAL.woodD : PAL.thatch,
      v ? sh(PAL.woodD, 1.5) : PAL.thatchL,
      v ? sh(PAL.woodD, 0.72) : PAL.thatchD,
    );
    // stilts
    g.fillStyle = '#5a3e22';
    g.fillRect(fx + 3, fy + 11, 2, 8);
    g.fillRect(fx + 13, fy + 11, 2, 8);
    // dock
    g.fillStyle = '#96703f';
    for (var i = 0; i < 4; i++) {
      g.fillRect(fx + 16, fy + 4 + i * 4.6, 14, 2.8);
    }
    g.fillStyle = rgba(sh('#96703f', 0.66), 0.9);
    for (i = 0; i < 4; i++) {
      g.fillRect(fx + 16, fy + 4 + i * 4.6, 14, 0.9);
    }
    g.fillStyle = '#5a3e22';
    g.fillRect(fx + 27, fy + 6, 2, 13);
    g.fillRect(fx + 17, fy + 6, 2, 13);
    // rod + line (bobber drawn dynamically at the rod tip)
    g.strokeStyle = '#6a4a28';
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(fx + 18.5, fy + 1);
    g.lineTo(fx + 30, fy - 6);
    g.stroke();
    g.fillStyle = '#8a5f34';
    g.beginPath();
    g.arc(fx + 19.6, fy + 1.6, 1.1, 0, 7);
    g.fill(); // reel
    g.fillStyle = '#5a3e22';
    rr(g, fx + 3, fy + 12, 5, 5, 1);
    F(g, '#5a3e22');
    g.strokeStyle = rgba('#4a3018', 0.6);
    g.lineWidth = 0.5;
    g.stroke();
    // net on hoop
    g.strokeStyle = '#7a8288';
    g.lineWidth = 0.8;
    g.beginPath();
    g.arc(fx + 21, fy + 15, 3, 0, 7);
    g.stroke();
    g.strokeStyle = rgba('#7a8288', 0.5);
    g.beginPath();
    g.moveTo(fx + 18.5, fy + 15);
    g.lineTo(fx + 23.5, fy + 15);
    g.moveTo(fx + 21, fy + 12.4);
    g.lineTo(fx + 21, fy + 17.6);
    g.stroke();
    // lobster pot
    g.fillStyle = rgba('#6a5638', 0.9);
    rr(g, fx + 26, fy + 15, 5, 3.4, 1);
    F(g, rgba('#6a5638', 0.9));
    g.strokeStyle = rgba('#3c3020', 0.6);
    g.lineWidth = 0.5;
    for (i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(fx + 26.8 + i * 1.6, fy + 15);
      g.lineTo(fx + 26.8 + i * 1.6, fy + 18.4);
      g.stroke();
    }
  }
  function paintFarm(g: CanvasRenderingContext2D, h: number): void {
    var fx = 2,
      fy = h - 24,
      fw = 38,
      fh = 23;
    bShadow(g, fx + 6, fy, fw - 6, fh);
    // field: furrows with crop tufts
    g.fillStyle = '#b99b4e';
    g.fillRect(fx, fy + 9, fw, fh - 10);
    for (var i = 0; i < 6; i++) {
      var yy = fy + 10.5 + i * 2.2;
      g.fillStyle = rgba('#8a6f34', 0.55);
      g.fillRect(fx, yy, fw, 1);
      g.fillStyle = rgba('#e8cc7c', 0.8);
      g.fillRect(fx, yy - 1, fw, 0.9);
    }
    for (i = 0; i < 16; i++) {
      var cx2 = fx + 2 + ((i * 7.3) % (fw - 4)),
        cy2 = fy + 10.8 + ((i * 2.7) % 9);
      g.strokeStyle = i % 3 ? '#8fae4a' : '#e2c96e';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(cx2, cy2 + 2.6);
      g.lineTo(cx2, cy2);
      g.moveTo(cx2 - 0.9, cy2 + 2.2);
      g.lineTo(cx2 - 1.2, cy2 - 0.4);
      g.moveTo(cx2 + 0.9, cy2 + 2.2);
      g.lineTo(cx2 + 1.2, cy2 - 0.4);
      g.stroke();
    }
    // fence with gate posts
    g.strokeStyle = '#8a6238';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(fx - 1, fy + 8.5);
    g.lineTo(fx + fw + 1, fy + 8.5);
    g.stroke();
    for (i = 0; i < 7; i++) {
      g.beginPath();
      g.moveTo(fx + i * 6.4, fy + 7);
      g.lineTo(fx + i * 6.4, fy + 9.8);
      g.stroke();
    }
    g.fillStyle = '#6a4a28';
    g.fillRect(fx + 17, fy + 6.6, 1.6, 3.6);
    g.fillRect(fx + 21, fy + 6.6, 1.6, 3.6);
    // small barn (board walls, wood doors, hayloft)
    wallTex(g, fx + 2, fy - 4, 15, 12, '#b4552e', sh('#b4552e', 0.82), false);
    g.strokeStyle = rgba(sh('#b4552e', 0.7), 0.6);
    g.lineWidth = 0.5;
    for (var byy = fy - 2; byy < fy + 7; byy += 2.4) {
      g.beginPath();
      g.moveTo(fx + 2, byy);
      g.lineTo(fx + 17, byy);
      g.stroke();
    }
    g.fillStyle = '#a5774a';
    g.fillRect(fx + 6.5, fy + 1, 5.4, 6.5);
    g.strokeStyle = rgba(PAL.out, 0.6);
    g.lineWidth = 0.6;
    g.strokeRect(fx + 6.5, fy + 1, 5.4, 6.5);
    g.strokeStyle = rgba(sh('#a5774a', 0.7), 0.9);
    g.beginPath();
    g.moveTo(fx + 9.2, fy + 1);
    g.lineTo(fx + 9.2, fy + 7.5);
    g.stroke();
    g.fillStyle = '#c9a06a';
    g.beginPath();
    g.arc(fx + 7.6, fy + 4.4, 0.8, 0, 7);
    g.fill();
    roof2(g, fx + 0.5, fy - 12, 17, 8, PAL.thatch, PAL.thatchL, PAL.thatchD, 1.5);
    // haystack with texture strokes
    g.fillStyle = '#d8b86a';
    g.beginPath();
    g.moveTo(fx + 22, fy + 8);
    g.quadraticCurveTo(fx + 27, fy - 2, fx + 32, fy + 8);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba('#a3854a', 0.7);
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(fx + 24, fy + 7);
    g.quadraticCurveTo(fx + 27, fy - 0.5, fx + 30, fy + 7);
    g.stroke();
    for (i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(fx + 24 + i * 2, fy + 6.4 - i * 0.4);
      g.lineTo(fx + 23 + i * 2.4, fy + 4 - i * 0.5);
      g.stroke();
    }
    g.fillStyle = rgba('#8a6f34', 0.5);
    g.fillRect(fx + 21.5, fy + 8.5, 11, 1.2);
    // wheat sheaf
    g.fillStyle = '#e0c070';
    g.beginPath();
    g.ellipse(fx + 35.4, fy + 6.4, 1.7, 2.6, 0.2, 0, 7);
    g.fill();
    g.beginPath();
    g.ellipse(fx + 35.4, fy + 4.6, 1.2, 1.2, 0, 0, 7);
    g.fill();
    g.strokeStyle = rgba('#a3854a', 0.8);
    g.lineWidth = 0.5;
    g.beginPath();
    g.moveTo(fx + 34.6, fy + 8.6);
    g.lineTo(fx + 36.2, fy + 8.6);
    g.stroke();
  }
  function paintMine(g: CanvasRenderingContext2D, h: number, o: BldOptions): void {
    var kind: 'coal' | 'iron' | 'gold' = o.kind || 'gold';
    var oc = { coal: '#33383f', iron: '#d0763a', gold: '#ffd23f' }[kind];
    var fx = 3,
      fy = h - 22,
      fw = 28,
      fh = 21;
    bShadow(g, fx, fy, fw, fh);
    // rocky mound with strata
    g.fillStyle = '#8d8579';
    g.beginPath();
    g.moveTo(fx, fy + 20);
    g.quadraticCurveTo(fx + 2, fy + 6, fx + 14, fy + 3);
    g.quadraticCurveTo(fx + 26, fy + 6, fx + 28, fy + 20);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba(PAL.out, 0.45);
    g.lineWidth = 0.8;
    g.stroke();
    g.strokeStyle = rgba(sh('#8d8579', 0.7), 0.5);
    g.beginPath();
    g.moveTo(fx + 3, fy + 15);
    g.quadraticCurveTo(fx + 8, fy + 9, fx + 22, fy + 11);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.beginPath();
    g.moveTo(fx + 4, fy + 16);
    g.quadraticCurveTo(fx + 6, fy + 8, fx + 13, fy + 5.5);
    g.quadraticCurveTo(fx + 15, fy + 7, fx + 14, fy + 10);
    g.lineTo(fx + 8, fy + 16);
    g.closePath();
    g.fill();
    // timber entrance frame + dark tunnel
    g.fillStyle = '#1a120a';
    g.beginPath();
    g.moveTo(fx + 9, fy + 19);
    g.lineTo(fx + 9, fy + 10);
    g.arc(fx + 13, fy + 10, 4, Math.PI, 0);
    g.lineTo(fx + 17, fy + 19);
    g.closePath();
    g.fill();
    g.fillStyle = PAL.beam;
    g.fillRect(fx + 8, fy + 9.4, 10, 2);
    g.fillRect(fx + 8, fy + 8, 2, 11);
    g.fillRect(fx + 16, fy + 8, 2, 11);
    g.fillStyle = sh(PAL.beam, 0.75);
    g.fillRect(fx + 16.8, fy + 8, 1.2, 11);
    g.fillStyle = '#c9a75c';
    g.fillRect(fx + 8, fy + 7.4, 10, 1);
    // ore spill at entrance
    for (var i = 0; i < 6; i++) {
      var sx = fx + 4 + ((i * 2.7) % 7),
        sy = fy + 15 + ((i * 3.1) % 4);
      g.fillStyle = rgba(oc, 0.95);
      g.beginPath();
      g.arc(sx, sy, kind === 'coal' ? 1.5 : 1.3, 0, 7);
      g.fill();
    }
    g.fillStyle = rgba(oc, 0.45);
    g.beginPath();
    g.ellipse(fx + 7, fy + 17, 4.6, 2, 0, 0, 7);
    g.fill();
    g.fillStyle = rgba(oc, 0.6);
    g.beginPath();
    g.ellipse(fx + 20, fy + 17.5, 2.6, 1.4, 0, 0, 7);
    g.fill();
    // glint
    g.fillStyle = '#ffffff';
    g.fillRect(fx + 12, fy + 11, 1.4, 1.4);
    // rails
    g.strokeStyle = rgba('#514b44', 0.85);
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(fx + 11, fy + 19);
    g.lineTo(fx + 11, fy + 22);
    g.moveTo(fx + 15, fy + 19);
    g.lineTo(fx + 15, fy + 22);
    g.stroke();
    // ore cart
    g.fillStyle = '#5c554d';
    g.fillRect(fx + 21, fy + 18.5, 4.4, 2.6);
    g.fillStyle = rgba(oc, 0.95);
    g.fillRect(fx + 21.7, fy + 16.6, 3, 2.2);
    g.strokeStyle = rgba('#3c362e', 0.7);
    g.lineWidth = 0.5;
    g.strokeRect(fx + 21.7, fy + 16.6, 3, 2.2);
    // lantern
    g.fillStyle = '#ffdf6e';
    g.fillRect(fx + 20, fy + 12, 2.4, 3);
    g.fillStyle = '#6a4a28';
    g.fillRect(fx + 19.6, fy + 10.6, 3.2, 1.2);
    g.strokeStyle = '#6a4a28';
    g.lineWidth = 0.5;
    g.beginPath();
    g.moveTo(fx + 20, fy + 10.6);
    g.lineTo(fx + 20, fy + 8.6);
    g.stroke();
    // pick
    g.strokeStyle = '#8a6238';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(fx + 23, fy + 8);
    g.lineTo(fx + 25, fy + 4);
    g.stroke();
    g.strokeStyle = '#9aa2aa';
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(fx + 23.6, fy + 4.6);
    g.quadraticCurveTo(fx + 25, fy + 3.4, fx + 26.4, fy + 4.8);
    g.stroke();
    bannerPole(g, fx + 26, fy - 8, 9);
  }
  function paintToolsmith(g: CanvasRenderingContext2D, h: number): void {
    var fx = 3,
      fy = h - 22,
      fw = 28,
      fh = 21;
    bShadow(g, fx, fy, fw, fh);
    foundation(g, fx + 1.5, fy + 15, fw - 3, 7);
    wallTex(g, fx + 1.5, fy - 2, fw - 6, 17, PAL.plasL, PAL.plasD, true);
    g.fillStyle = PAL.beam;
    g.fillRect(fx + 1.5, fy - 2, 2.2, 17);
    g.fillRect(fx + 21.3, fy - 2, 2.2, 17);
    // open workshop bay with forge glow
    g.fillStyle = '#241a10';
    g.fillRect(fx + 15, fy + 1, 9.4, 13.6);
    g.strokeStyle = rgba(PAL.out, 0.6);
    g.lineWidth = 0.7;
    g.strokeRect(fx + 15, fy + 1, 9.4, 13.6);
    g.fillStyle = rgba('#ff9a3c', 0.25);
    g.beginPath();
    g.ellipse(fx + 19.8, fy + 11, 3.2, 1.6, 0, 0, 7);
    g.fill();
    g.fillStyle = rgba('#ffce6e', 0.5);
    g.beginPath();
    g.ellipse(fx + 19.8, fy + 11, 1.8, 1, 0, 0, 7);
    g.fill();
    // anvil + quench barrel + bellows
    g.fillStyle = '#565c66';
    g.fillRect(fx + 17, fy + 9, 5.4, 2.6);
    g.fillRect(fx + 18, fy + 11.6, 2, 2.4);
    g.fillRect(fx + 21.8, fy + 9.6, 1.4, 1.2);
    g.fillStyle = rgba('#c8ccd4', 0.8);
    g.fillRect(fx + 17.4, fy + 9.3, 4.6, 0.7);
    g.fillStyle = '#8a5f34';
    rr(g, fx + 24.2, fy + 8.5, 4, 4.8, 1.2);
    F(g, '#8a5f34');
    g.fillStyle = rgba('#4c88b8', 0.9);
    g.beginPath();
    g.ellipse(fx + 26.2, fy + 9.4, 1.4, 0.6, 0, 0, 7);
    g.fill();
    g.fillStyle = '#7a828c';
    g.fillRect(fx + 16, fy + 4.5, 6, 2);
    g.fillStyle = '#3a2c1c';
    g.fillRect(fx + 16.6, fy + 1.8, 4.6, 3);
    door2(g, fx + 4.5, fy + 6.5, 5.4, 8.6);
    window2(g, fx + 11.5, fy + 2.5, 3.4, 4, true);
    roof2(g, fx - 1.5, fy - 11, fw, 10, PAL.thatch, PAL.thatchL, PAL.thatchD);
    chimney(g, fx + 8, fy - 18, 4.6, 8);
    // tools on the wall
    g.strokeStyle = '#8a929c';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(fx + 2.8, fy + 4);
    g.lineTo(fx + 2.8, fy + 8);
    g.stroke();
    g.fillStyle = '#c8ccd2';
    g.fillRect(fx + 2.2, fy + 3, 1.4, 1.6);
  }
  function paintArmory(g: CanvasRenderingContext2D, h: number): void {
    var fx = 3,
      fy = h - 24,
      fw = 28,
      fh = 23;
    bShadow(g, fx, fy, fw, fh);
    foundation(g, fx + 1.5, fy + 17, fw - 3, 7);
    // stone tower
    wallTex(g, fx + 2, fy - 2, fw - 4, 19, PAL.stoneL, PAL.stoneD, false);
    g.strokeStyle = rgba(PAL.out, 0.45);
    g.lineWidth = 0.7;
    for (var yy = fy + 3; yy < fy + 17; yy += 3.6) {
      g.beginPath();
      g.moveTo(fx + 2, yy);
      g.lineTo(fx + fw - 2, yy);
      g.stroke();
    }
    for (var i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(fx + 4 + i * 5, fy - 2);
      g.lineTo(fx + 4 + i * 5 + (i % 2 ? 2 : -2), fy + 17);
      g.stroke();
    }
    door2(g, fx + 11.5, fy + 10.5, 5.6, 8.4);
    window2(g, fx + 5, fy + 2, 3.4, 4.4, true);
    window2(g, fx + 19.5, fy + 2, 3.4, 4.4, true);
    // arrow slits
    g.fillStyle = '#241a10';
    g.fillRect(fx + 3.4, fy + 8, 1.2, 4.4);
    g.fillRect(fx + 23.4, fy + 8, 1.2, 4.4);
    // crenellated parapet
    g.fillStyle = PAL.stoneL;
    for (i = 0; i < 5; i++) g.fillRect(fx + 2 + i * 5.2, fy - 5.4, 3.4, 3.6);
    g.fillStyle = PAL.stone;
    g.fillRect(fx + 2, fy - 2, fw - 4, 2);
    g.fillStyle = PAL.stoneD;
    g.fillRect(fx + 2, fy - 0.4, fw - 4, 0.8);
    roof2(g, fx + 6, fy - 15, 16, 8, PAL.slate, PAL.slateL, PAL.slateD, 1);
    // shield emblem
    g.fillStyle = '#31405a';
    g.beginPath();
    g.arc(fx + 14, fy - 10.6, 3.4, 0, 7);
    g.fill();
    g.fillStyle = '#d8dcea';
    g.fillRect(fx + 13.2, fy - 12, 1.6, 4.6);
    g.fillStyle = '#c9a75c';
    g.beginPath();
    g.arc(fx + 14, fy - 10.6, 0.9, 0, 7);
    g.fill();
    g.strokeStyle = rgba(PAL.out, 0.6);
    g.lineWidth = 0.6;
    g.beginPath();
    g.arc(fx + 14, fy - 10.6, 3.4, 0, 7);
    g.stroke();
    bannerPole(g, fx + 26.5, fy - 14, 11);
  }
  function paintGuard(g: CanvasRenderingContext2D, h: number): void {
    var fx = 5,
      fy = h - 22,
      fw = 24,
      fh = 21;
    bShadow(g, fx, fy, fw, fh);
    g.fillStyle = rgba('#8d8577', 0.55);
    g.beginPath();
    g.ellipse(fx + fw / 2, fy + fh - 3, fw * 0.6, 5, 0, 0, 7);
    g.fill();
    // tapered round tower
    g.fillStyle = PAL.stone;
    g.beginPath();
    g.moveTo(fx + 1.5, fy + 20);
    g.lineTo(fx + 4, fy - 12);
    g.lineTo(fx + fw - 4, fy - 12);
    g.lineTo(fx + fw - 1.5, fy + 20);
    g.closePath();
    g.fill();
    var gr = g.createLinearGradient(fx, 0, fx + fw, 0);
    gr.addColorStop(0, rgba(PAL.stoneL, 0.75));
    gr.addColorStop(0.45, 'rgba(255,255,255,0)');
    gr.addColorStop(1, rgba(PAL.stoneD, 0.8));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(fx + 1.5, fy + 20);
    g.lineTo(fx + 4, fy - 12);
    g.lineTo(fx + fw - 4, fy - 12);
    g.lineTo(fx + fw - 1.5, fy + 20);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba(PAL.out, 0.6);
    g.lineWidth = 0.8;
    g.stroke();
    // Clip detailed masonry to the tapered tower; vertical highlight preserves
    // its round volume rather than flattening it into a grid of mortar lines.
    g.save();
    g.beginPath();
    g.moveTo(fx + 1.5, fy + 20);
    g.lineTo(fx + 4, fy - 12);
    g.lineTo(fx + fw - 4, fy - 12);
    g.lineTo(fx + fw - 1.5, fy + 20);
    g.closePath();
    g.clip();
    wallTex(g, fx + 1.5, fy - 12, fw - 3, 32, PAL.stoneL, PAL.stoneD, false);
    var round = g.createLinearGradient(fx, 0, fx + fw, 0);
    round.addColorStop(0, 'rgba(254,242,209,0.3)');
    round.addColorStop(0.35, 'rgba(254,242,209,0.08)');
    round.addColorStop(0.6, 'rgba(46,55,39,0.08)');
    round.addColorStop(1, 'rgba(46,55,39,0.24)');
    g.fillStyle = round;
    g.fillRect(fx, fy - 12, fw, 32);
    g.restore();
    // arrow slit + door with steps
    g.fillStyle = '#241a10';
    g.fillRect(fx + fw / 2 - 0.9, fy - 4, 1.8, 5.4);
    g.fillStyle = PAL.door;
    g.beginPath();
    g.moveTo(fx + 8.6, fy + 20);
    g.lineTo(fx + 8.6, fy + 13);
    g.arc(fx + 11.5, fy + 13, 2.9, Math.PI, 0);
    g.lineTo(fx + 14.4, fy + 20);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba(PAL.out, 0.6);
    g.lineWidth = 0.6;
    g.stroke();
    g.fillStyle = PAL.stoneL;
    g.fillRect(fx + 8, fy + 20, 8.6, 1.4);
    // battlements
    g.fillStyle = PAL.stoneL;
    rr(g, fx + 2.2, fy - 15.4, fw - 4.4, 3.8, 1);
    F(g, PAL.stoneL);
    g.fillStyle = PAL.stone;
    for (var i = 0; i < 4; i++) g.fillRect(fx + 2.6 + i * 5.4, fy - 18.4, 3.4, 3.6);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(fx + 2.6, fy - 18.4, 3.4, 0.9);
    g.fillStyle = PAL.stoneD;
    g.fillRect(fx + 2.2, fy - 12.2, fw - 4.4, 1.2);
    // banner on the pole drawn dynamically at the anchor
    bannerPole(g, fx + 11, fy - 21, 10);
  }
  // Distinct cached fallback silhouettes keep each new workplace recognizable
  // while a painted pack is unavailable. These painters use no simulation RNG.
  function economyBarrel(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    g.fillStyle = '#a47a43';
    rr(g, x, y - h, w, h, 1.5);
    g.fill();
    g.strokeStyle = '#5e594b';
    g.lineWidth = 0.8;
    g.strokeRect(x, y - h + 2, w, h - 4);
    g.fillStyle = '#d9b878';
    g.beginPath();
    g.ellipse(x + w / 2, y - h, w / 2, 1, 0, 0, 7);
    g.fill();
  }
  function paintWindmill(g: CanvasRenderingContext2D, h: number): void {
    foundation(g, 10, h - 13, 23, 12);
    wallTex(g, 13, h - 34, 17, 29, PAL.plasL, PAL.plasD, false);
    roof2(g, 10, h - 44, 23, 11, PAL.tile, PAL.tileL, PAL.tileD);
    door2(g, 18, h - 14, 6, 9);
    g.strokeStyle = '#795633';
    g.lineWidth = 2;
    var cx = 21,
      cy = h - 30;
    for (var i = 0; i < 4; i++) {
      g.save();
      g.translate(cx, cy);
      g.rotate(Math.PI / 4 + (i * Math.PI) / 2);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(16, 0);
      g.stroke();
      g.fillStyle = '#d8bd83';
      g.fillRect(5, -3, 11, 3);
      g.strokeStyle = '#866a44';
      g.lineWidth = 0.6;
      g.strokeRect(5, -3, 11, 3);
      g.restore();
    }
    g.fillStyle = '#614326';
    g.beginPath();
    g.arc(cx, cy, 2, 0, 7);
    g.fill();
  }
  function paintWell(g: CanvasRenderingContext2D, h: number): void {
    foundation(g, 5, h - 12, 22, 11);
    g.fillStyle = PAL.stoneD;
    g.beginPath();
    g.ellipse(16, h - 9, 10, 5, 0, 0, 7);
    g.fill();
    g.fillStyle = PAL.stoneL;
    g.beginPath();
    g.ellipse(16, h - 13, 10, 5, 0, 0, 7);
    g.fill();
    g.fillStyle = '#343c39';
    g.beginPath();
    g.ellipse(16, h - 13, 7, 3, 0, 0, 7);
    g.fill();
    g.fillStyle = PAL.beam;
    g.fillRect(6, h - 29, 2, 18);
    g.fillRect(24, h - 29, 2, 18);
    roof2(g, 3, h - 35, 27, 9, PAL.tile, PAL.tileL, PAL.tileD);
    g.strokeStyle = '#a88956';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(16, h - 26);
    g.lineTo(16, h - 13);
    g.stroke();
    economyBarrel(g, 27, h - 5, 5, 7);
  }
  function paintEconomyShop(g: CanvasRenderingContext2D, h: number, kind: string): void {
    paintForester(g, h, { v: kind === 'brewery' ? 1 : 0 });
    if (kind === 'pigfarm') {
      g.strokeStyle = '#795431';
      g.lineWidth = 1.2;
      g.strokeRect(1, h - 12, 15, 8);
      for (var i = 0; i < 2; i++) {
        g.fillStyle = '#e4a5a1';
        g.beginPath();
        g.ellipse(5 + i * 7, h - 7, 3, 1.7, 0, 0, 7);
        g.fill();
        g.fillRect(3 + i * 7, h - 6, 0.7, 2);
        g.fillRect(6 + i * 7, h - 6, 0.7, 2);
      }
    } else if (kind === 'brewery') {
      economyBarrel(g, 2, h - 4, 7, 10);
      economyBarrel(g, 29, h - 5, 6, 8);
    } else if (kind === 'bakery') {
      g.fillStyle = PAL.stoneD;
      rr(g, 27, h - 15, 9, 11, 3);
      g.fill();
      g.fillStyle = '#f9b34d';
      rr(g, 29, h - 11, 5, 6, 2);
      g.fill();
      g.fillStyle = '#dbad66';
      rr(g, 1, h - 8, 9, 3, 1.4);
      g.fill();
    } else if (kind === 'butcher') {
      g.fillStyle = '#aa5346';
      g.fillRect(1, h - 13, 11, 3);
      g.fillStyle = '#f2dec0';
      for (var stripe = 0; stripe < 3; stripe++) g.fillRect(2 + stripe * 4, h - 13, 2, 3);
      g.fillStyle = '#9d5041';
      rr(g, 3, h - 9, 7, 3, 1);
      g.fill();
    } else {
      g.fillStyle = '#a97f4d';
      g.fillRect(1, h - 9, 11, 2);
      g.fillRect(2, h - 7, 1, 4);
      g.fillRect(10, h - 7, 1, 4);
      g.strokeStyle = '#d7c5a1';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(2, h - 10);
      g.lineTo(10, h - 13);
      g.stroke();
    }
  }
  var PAINTERS: Record<BuildingType, BldPainterEntry> = {
    hq: { f: paintHQ, w: 48, h: 56 },
    warehouse: { f: paintWarehouse, w: 38, h: 46 },
    lumberjack: { f: paintLumberjack, w: 36, h: 42, v: 1 },
    forester: { f: paintForester, w: 38, h: 42, v: 1 },
    sawmill: { f: paintSawmill, w: 36, h: 44 },
    quarry: { f: paintQuarry, w: 38, h: 44 },
    fisherman: { f: paintFisherman, w: 36, h: 40, v: 1 },
    farm: { f: paintFarm, w: 44, h: 46 },
    windmill: { f: paintWindmill, w: 44, h: 58 },
    bakery: { f: (g, h) => paintEconomyShop(g, h, 'bakery'), w: 38, h: 44 },
    pigfarm: { f: (g, h) => paintEconomyShop(g, h, 'pigfarm'), w: 38, h: 44 },
    butcher: { f: (g, h) => paintEconomyShop(g, h, 'butcher'), w: 38, h: 44 },
    well: { f: paintWell, w: 34, h: 40 },
    brewery: { f: (g, h) => paintEconomyShop(g, h, 'brewery'), w: 38, h: 44 },
    smelter: { f: paintToolsmith, w: 36, h: 44 },
    workshop: { f: (g, h) => paintEconomyShop(g, h, 'workshop'), w: 38, h: 44 },
    mine_coal: { f: paintMine, w: 34, h: 42, kind: 'coal' },
    mine_iron: { f: paintMine, w: 34, h: 42, kind: 'iron' },
    mine_gold: { f: paintMine, w: 34, h: 42, kind: 'gold' },
    toolsmith: { f: paintToolsmith, w: 36, h: 44 },
    armory: { f: paintArmory, w: 36, h: 46 },
    guard: { f: paintGuard, w: 34, h: 50 },
  };
  // construction scaffold
  function paintSite(g: CanvasRenderingContext2D, h: number): void {
    var fx = 5,
      fy = h - 23,
      fw = 24,
      fh = 22;
    g.fillStyle = rgba('#9b825a', 0.55);
    g.beginPath();
    g.ellipse(fx + fw / 2, fy + fh / 2, fw * 0.56, fh * 0.4, 0, 0, 7);
    g.fill();
    g.fillStyle = '#6a4a28';
    var ph = fy - 10;
    for (var i = 0; i < 4; i++) {
      var px = fx + (i % 2 ? fw - 2.4 : 0);
      g.fillRect(px, ph, 2.4, fh + 10 - ph);
      g.fillStyle = sh('#6a4a28', 0.78);
      g.fillRect(px + 1.8, ph, 0.6, fh + 10 - ph);
      g.fillStyle = '#6a4a28';
    }
    g.fillRect(fx, ph, fw, 2.2);
    g.fillRect(fx, fy - 1, fw, 2.2);
    g.fillRect(fx, fy + 9, fw, 2);
    g.strokeStyle = rgba('#6a4a28', 0.85);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(fx, ph);
    g.lineTo(fx + fw, fy - 1);
    g.moveTo(fx + fw, ph);
    g.lineTo(fx, fy - 1);
    g.stroke();
    g.beginPath();
    g.moveTo(fx, fy + 11);
    g.lineTo(fx + fw, fy + 20);
    g.moveTo(fx + fw, fy + 11);
    g.lineTo(fx, fy + 20);
    g.stroke();
    g.fillStyle = '#c8b088';
    g.fillRect(fx + 1, ph + 2.2, fw - 2, 4);
    g.fillStyle = rgba('#e0d2b0', 0.75);
    g.fillRect(fx + 1, ph + 2.2, fw - 2, 1);
    // sand heap + plank stack
    g.fillStyle = '#c2a878';
    g.beginPath();
    g.ellipse(fx + fw - 3, fy + 16, 3.4, 2.2, 0, 0, 7);
    g.fill();
    g.fillStyle = rgba('#a08858', 0.7);
    g.beginPath();
    g.ellipse(fx + fw - 3, fy + 17.4, 3.2, 1, 0, 0, 7);
    g.fill();
    g.fillStyle = '#a5774a';
    for (i = 0; i < 3; i++) g.fillRect(fx + 1.6, fy + 15.4 - i * 1.7, 8 - i * 1.4, 1.5);
  }
  // Work yards remain visible even while a producer is waiting for deliveries.
  function paintWorkYard(
    g: CanvasRenderingContext2D,
    type: BuildingType | 'site',
    w: number,
    h: number,
  ): void {
    var x = w - 8,
      y = h - 5;
    if (type === 'sawmill') {
      g.fillStyle = '#dfc18a';
      for (var i = 0; i < 4; i++) g.fillRect(x - 6 + i * 0.5, y - i * 1.4, 9 - i, 1.1);
    } else if (type === 'fisherman') {
      g.strokeStyle = '#cfb796';
      g.lineWidth = 0.55;
      for (var j = 0; j < 3; j++) {
        g.beginPath();
        g.moveTo(x - 3 + j * 2, y - 8);
        g.lineTo(x - 3 + j * 2, y - 3);
        g.stroke();
      }
      g.strokeStyle = '#727f7a';
      g.beginPath();
      g.moveTo(x - 4, y - 6);
      g.lineTo(x + 3, y - 6);
      g.moveTo(x - 4, y - 4);
      g.lineTo(x + 3, y - 4);
      g.stroke();
    } else if (type === 'toolsmith') {
      g.strokeStyle = '#d9e0db';
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(x - 4, y - 1);
      g.lineTo(x - 4, y - 6);
      g.moveTo(x - 6, y - 5);
      g.lineTo(x - 2, y - 5);
      g.stroke();
    } else if (type === 'armory') {
      g.strokeStyle = '#554536';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x - 4, y);
      g.lineTo(x - 4, y - 9);
      g.moveTo(x - 7, y - 5);
      g.lineTo(x, y - 5);
      g.stroke();
      g.strokeStyle = '#d6d9dc';
      g.lineWidth = 0.9;
      for (var k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(x - 7 + k * 3, y - 1);
        g.lineTo(x - 7 + k * 3, y - 9);
        g.stroke();
      }
    }
  }
  // Eight directions and eight gait frames share the same feet anchor.
  function texDirectionalUnit(
    kind: 'carrier' | 'soldier',
    dir: string,
    frame: number,
  ): HTMLCanvasElement {
    var c = Acan(15 * SS, 19 * SS),
      g = c.getContext('2d');
    g.scale(SS, SS);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    var soldier = kind === 'soldier',
      side = dir === 'e' || dir === 'w',
      diagonal = dir.length === 2,
      back = dir.indexOf('n') !== -1,
      cx = 7.5;
    var stride = frame < 0 ? 0 : Math.sin((frame * Math.PI) / 4) * 1.6;
    var lift = frame < 0 ? 0 : Math.cos((frame * Math.PI) / 4) * 0.65;
    if (dir.indexOf('w') !== -1) {
      g.translate(15, 0);
      g.scale(-1, 1);
    }
    g.strokeStyle = '#44372c';
    g.lineWidth = 2.0;
    g.beginPath();
    g.moveTo(cx - 1.5, 13);
    g.lineTo(cx - 1.6 - stride, 17.8 - Math.max(0, lift));
    g.moveTo(cx + 1.5, 13);
    g.lineTo(cx + 1.6 + stride, 17.8 - Math.max(0, -lift));
    g.stroke();
    g.fillStyle = soldier ? '#ad5144' : '#547ca7';
    rr(g, cx - (side ? 2.8 : 3.2), 6.8, side ? 5.6 : diagonal ? 6 : 6.4, 7.2, 1.8);
    g.fill();
    g.fillStyle = rgba('#292c30', 0.22);
    g.fillRect(cx + 1, 7.5, side ? 1.7 : 2.2, 5.3);
    g.strokeStyle = '#e4c49d';
    g.lineWidth = 1.5;
    var arm = side ? stride * 0.7 : stride * 0.3;
    g.beginPath();
    g.moveTo(cx - 2.8, 8.2);
    g.lineTo(cx - 3.4 - arm, 12);
    g.moveTo(cx + 2.8, 8.2);
    g.lineTo(cx + 3.3 + arm, 12);
    g.stroke();
    g.fillStyle = '#493e32';
    g.fillRect(cx - 3.1, 12.1, 6.2, 0.9);
    g.fillStyle = '#e8c898';
    g.beginPath();
    g.arc(cx + (side ? 0.7 : diagonal ? 0.45 : 0), 5.5, 2.5, 0, 7);
    g.fill();
    if (back) {
      g.fillStyle = '#765238';
      g.beginPath();
      g.arc(cx, 5, 2.5, Math.PI, Math.PI * 2);
      g.fill();
    }
    if (soldier) {
      g.fillStyle = '#c6d0d2';
      g.beginPath();
      g.arc(cx, 4.7, 2.8, Math.PI, 0);
      g.fill();
      g.fillRect(cx - 3, 4.5, 6, 1);
      g.fillStyle = '#bc5544';
      g.fillRect(cx - 0.4, 1.1, 0.8, 2.6);
      g.strokeStyle = '#80694b';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(12.2, 17);
      g.lineTo(12.2, 2.5);
      g.stroke();
      g.fillStyle = '#dce1df';
      g.beginPath();
      g.moveTo(11.3, 3);
      g.lineTo(12.2, 0.6);
      g.lineTo(13.1, 3);
      g.closePath();
      g.fill();
    } else {
      g.fillStyle = '#d5b776';
      g.beginPath();
      g.arc(cx, 3.9, 2.8, Math.PI, 0);
      g.fill();
      g.beginPath();
      g.ellipse(cx, 4.2, 4.1, 0.9, 0, 0, 7);
      g.fill();
      g.fillStyle = '#b19156';
      g.fillRect(cx - 2.8, 3.8, 5.6, 0.6);
      if (back) {
        g.fillStyle = '#98704c';
        rr(g, cx - 2.2, 8, 4.4, 3.8, 0.8);
        g.fill();
      }
    }
    if (!back || diagonal) {
      g.fillStyle = '#44372c';
      g.fillRect(cx + (side ? 2 : diagonal ? 1.7 : 0.5), 5.4, 0.55, 0.6);
    }
    return c;
  }
  // Cargo keeps each good recognizable both on a carrier and in a loading yard.
  function texCargo(good: Good): HTMLCanvasElement {
    var c = Acan(16 * SS, 12 * SS),
      g = c.getContext('2d');
    g.scale(SS, SS);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    if (good === 'logs') {
      for (var i = 0; i < 3; i++) {
        var y = 4 + i * 2.6,
          x = i === 1 ? 2.5 : 1;
        g.strokeStyle = '#593e26';
        g.lineWidth = 3.6;
        g.beginPath();
        g.moveTo(x + 2, y);
        g.lineTo(x + 10, y - 0.8);
        g.stroke();
        g.strokeStyle = '#a77945';
        g.lineWidth = 1.4;
        g.stroke();
        g.fillStyle = '#e2be7b';
        g.beginPath();
        g.ellipse(x + 1.4, y, 1.7, 1.65, 0, 0, 7);
        g.fill();
        g.strokeStyle = '#8f6236';
        g.lineWidth = 0.6;
        g.stroke();
      }
    } else if (good === 'planks') {
      for (var p = 0; p < 3; p++) {
        g.fillStyle = '#72512f';
        g.fillRect(1 + p * 0.6, 3 + p * 2.5, 13, 2.8);
        g.fillStyle = '#d0a66a';
        g.fillRect(1 + p * 0.6, 2.2 + p * 2.5, 13, 1.9);
        g.fillStyle = '#ecd096';
        g.fillRect(1 + p * 0.6, 2.2 + p * 2.5, 13, 0.5);
      }
      g.fillStyle = '#6d583e';
      g.fillRect(5, 2, 1, 8);
      g.fillRect(10, 2, 1, 8);
    } else if (good === 'food' || good === 'grain' || good === 'flour') {
      g.fillStyle = '#6c5239';
      g.beginPath();
      g.ellipse(8, 10, 5.8, 1.3, 0, 0, 7);
      g.fill();
      var sack = g.createLinearGradient(3, 0, 12, 0);
      sack.addColorStop(0, '#e8d0a0');
      sack.addColorStop(1, '#a18358');
      g.fillStyle = sack;
      g.beginPath();
      g.moveTo(6, 2);
      g.bezierCurveTo(3, 5, 1, 10, 6, 10.5);
      g.bezierCurveTo(14, 12, 14, 6, 10, 2);
      g.closePath();
      g.fill();
      g.strokeStyle = '#765d3c';
      g.lineWidth = 0.7;
      g.stroke();
      g.fillStyle = '#8d633d';
      g.fillRect(5.7, 2, 4.6, 1);
      g.strokeStyle = '#f2ddaa';
      g.beginPath();
      g.moveTo(5, 5);
      g.lineTo(4.2, 8);
      g.stroke();
    } else if (good === 'bread') {
      g.fillStyle = '#aa7337';
      rr(g, 2, 4, 12, 6, 3);
      g.fill();
      g.fillStyle = '#e7bd73';
      rr(g, 2, 3, 12, 5, 2.5);
      g.fill();
      g.strokeStyle = '#9c6730';
      g.lineWidth = 0.7;
      for (var cut = 0; cut < 3; cut++) {
        g.beginPath();
        g.moveTo(5 + cut * 3, 4);
        g.lineTo(4 + cut * 3, 7);
        g.stroke();
      }
    } else if (good === 'pigs') {
      g.fillStyle = '#dc9a97';
      g.beginPath();
      g.ellipse(8, 6, 5, 3, 0, 0, 7);
      g.fill();
      g.fillStyle = '#edb4ae';
      g.beginPath();
      g.ellipse(12, 6, 2.3, 2, 0, 0, 7);
      g.fill();
      g.fillRect(5, 8, 1, 3);
      g.fillRect(10, 8, 1, 3);
      g.fillStyle = '#503c35';
      g.fillRect(12, 5, 0.7, 0.7);
    } else if (good === 'meat') {
      g.fillStyle = '#9a514a';
      rr(g, 2, 3, 11, 7, 2.5);
      g.fill();
      g.fillStyle = '#cf8275';
      rr(g, 3, 3.5, 8, 4, 2);
      g.fill();
      g.strokeStyle = '#f0d8be';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(10, 7);
      g.lineTo(14, 3);
      g.stroke();
    } else if (good === 'fish') {
      g.fillStyle = '#a4bac2';
      g.beginPath();
      g.ellipse(7, 6, 5, 2.6, -0.2, 0, 7);
      g.fill();
      g.beginPath();
      g.moveTo(11, 6);
      g.lineTo(15, 3);
      g.lineTo(15, 8);
      g.closePath();
      g.fill();
      g.fillStyle = '#34474b';
      g.fillRect(3, 5, 0.8, 0.8);
    } else if (good === 'beer') {
      economyBarrel(g, 4, 11, 8, 9);
    } else if (good === 'iron_bars') {
      for (var bar = 0; bar < 3; bar++) {
        g.fillStyle = '#647880';
        g.fillRect(2 + bar, 4 + bar * 2, 10, 2.5);
        g.fillStyle = '#c4d1d0';
        g.fillRect(2 + bar, 3 + bar * 2, 10, 1.5);
      }
    } else if (good === 'tools' || good === 'weapons') {
      g.fillStyle = '#856039';
      rr(g, 2, 6.5, 12, 4, 0.6);
      g.fill();
      g.fillStyle = '#bf9660';
      g.fillRect(2, 6.4, 12, 1);
      g.strokeStyle = '#574332';
      g.lineWidth = 1.2;
      for (var k = 0; k < 2; k++) {
        g.beginPath();
        g.moveTo(4 + k * 6, 9);
        g.lineTo(7 + k * 3, 1.5);
        g.stroke();
      }
      g.strokeStyle = '#e3e9e7';
      g.lineWidth = good === 'weapons' ? 1.4 : 2.2;
      g.beginPath();
      if (good === 'weapons') {
        g.moveTo(7, 1);
        g.lineTo(5.6, 5.2);
        g.moveTo(10, 1);
        g.lineTo(9, 5.4);
        g.moveTo(4, 5.2);
        g.lineTo(7, 6);
        g.moveTo(8, 5.4);
        g.lineTo(11, 6.1);
      } else {
        g.moveTo(5, 2);
        g.lineTo(9, 2.8);
        g.moveTo(8, 2.2);
        g.lineTo(12, 3.2);
      }
      g.stroke();
    } else {
      var colors =
        good === 'stone'
          ? ['#e2e0ce', '#a09e90', '#696e68']
          : good === 'coal'
            ? ['#647174', '#303c41', '#1c2429']
            : good === 'iron'
              ? ['#e6a96c', '#ac7047', '#724c37']
              : ['#fff1a1', '#e0ac3e', '#966c23'];
      for (var r = 0; r < 3; r++) {
        var cx = 4 + r * 4.1,
          cy = 7.5 - (r % 2) * 3;
        g.fillStyle = colors[2];
        g.beginPath();
        g.moveTo(cx - 3, cy);
        g.lineTo(cx - 1, cy - 3);
        g.lineTo(cx + 2, cy - 3.4);
        g.lineTo(cx + 3, cy + 1);
        g.lineTo(cx, cy + 3);
        g.closePath();
        g.fill();
        g.fillStyle = colors[1];
        g.beginPath();
        g.moveTo(cx - 3, cy);
        g.lineTo(cx - 1, cy - 3);
        g.lineTo(cx + 2, cy - 3.4);
        g.lineTo(cx + 0.6, cy + 0.4);
        g.closePath();
        g.fill();
        g.strokeStyle = colors[0];
        g.lineWidth = 0.9;
        g.beginPath();
        g.moveTo(cx - 1, cy - 2.8);
        g.lineTo(cx + 1.4, cy - 3);
        g.stroke();
      }
    }
    return c;
  }
  // ---------- saw blade ----------
  function texBlade(): HTMLCanvasElement {
    var c = Acan(9 * SS, 9 * SS),
      g = c.getContext('2d');
    g.scale(SS, SS);
    g.fillStyle = '#c8ccd2';
    g.beginPath();
    g.arc(4.5, 4.5, 4.1, 0, 7);
    g.fill();
    g.strokeStyle = '#6a7078';
    g.lineWidth = 0.7;
    g.beginPath();
    g.arc(4.5, 4.5, 4.1, 0, 7);
    g.stroke();
    g.strokeStyle = '#9aa1a9';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(4.5, 0.6);
    g.lineTo(4.5, 8.4);
    g.moveTo(0.6, 4.5);
    g.lineTo(8.4, 4.5);
    g.stroke();
    g.fillStyle = '#565c66';
    g.beginPath();
    g.arc(4.5, 4.5, 1.1, 0, 7);
    g.fill();
    return c;
  }
  function buildAtlas(): void {
    ART.grass = [];
    ART.sand = [];
    ART.water = [];
    ART.shimmer = [];
    ART.tree = [];
    ART.rock = [];
    var v;
    for (v = 0; v < 4; v++) ART.grass.push(texGrass(v));
    for (v = 0; v < 3; v++) ART.sand.push(texSand(v));
    for (v = 0; v < 2; v++) ART.water.push(texWater(v));
    for (v = 0; v < 3; v++) ART.shimmer.push(texShimmer(v));
    ART.road = texRoad();
    for (var st = 1; st <= 4; st++) {
      var arr = [];
      for (v = 0; v < 3; v++) arr.push([texTree(st, v, 0), texTree(st, v, 1)]);
      ART.tree.push(arr);
    }
    for (v = 0; v < 2; v++) ART.rock.push(texRock(v));
    ART.bld = {};
    ART.bld2 = {};
    for (var t in PAINTERS) {
      var spec = PAINTERS[t as BuildingType];
      ART.bld[t as BuildingType] = bldSprite(t as BuildingType, spec.f, {
        w: spec.w,
        h: spec.h,
        kind: spec.kind,
        v: 0,
      });
      if (spec.v)
        ART.bld2[t as BuildingType] = bldSprite(t as BuildingType, spec.f, {
          w: spec.w,
          h: spec.h,
          kind: spec.kind,
          v: 1,
        });
    }
    ART.site = bldSprite('site', paintSite, { w: 34, h: 38 });
    ART.blade = texBlade();
    ART.unitDirections = {};
    ART.cargo = {};
    for (var good in game.GOODS) ART.cargo[good as Good] = texCargo(good as Good);
    for (var uk = 0; uk < 2; uk++) {
      var kind: 'carrier' | 'soldier' = uk ? 'soldier' : 'carrier',
        dirs: Record<string, { walk: HTMLCanvasElement[]; idle: HTMLCanvasElement }> = {};
      ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].forEach(function (dir) {
        var frames = [];
        for (var uf = 0; uf < 8; uf++) frames.push(texDirectionalUnit(kind, dir, uf));
        dirs[dir] = { walk: frames, idle: texDirectionalUnit(kind, dir, -1) };
      });
      ART.unitDirections[kind] = dirs;
    }
    // soft shadows
    var sc = Acan(64, 32),
      sg = sc.getContext('2d');
    sg.save();
    sg.scale(1, 0.5);
    var grd = sg.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(24,31,25,0.34)');
    grd.addColorStop(0.55, 'rgba(24,31,25,0.17)');
    grd.addColorStop(1, 'rgba(24,31,25,0)');
    sg.fillStyle = grd;
    sg.beginPath();
    sg.arc(32, 32, 30, 0, 7);
    sg.fill();
    sg.restore();
    ART.shadowSoft = sc;
    // cloud blob
    var cc = Acan(340, 220),
      cg = cc.getContext('2d');
    var cg2 = cg.createRadialGradient(170, 110, 10, 170, 110, 160);
    cg2.addColorStop(0, 'rgba(10,14,20,0.04)');
    cg2.addColorStop(0.55, 'rgba(10,14,20,0.025)');
    cg2.addColorStop(1, 'rgba(10,14,20,0)');
    cg.fillStyle = cg2;
    cg.beginPath();
    cg.ellipse(170, 110, 165, 105, 0, 0, 7);
    cg.fill();
    ART.cloud = cc;
    // stronger ground shadow for the terrain-level cloud pass (drawn SE of the sky blob)
    var csh = Acan(340, 220),
      csg = csh.getContext('2d');
    var cg3 = csg.createRadialGradient(170, 110, 10, 170, 110, 160);
    cg3.addColorStop(0, 'rgba(8,12,18,0.14)');
    cg3.addColorStop(0.55, 'rgba(8,12,18,0.065)');
    cg3.addColorStop(1, 'rgba(8,12,18,0)');
    csg.fillStyle = cg3;
    csg.beginPath();
    csg.ellipse(170, 110, 165, 105, 0, 0, 7);
    csg.fill();
    ART.cloudShadow = csh;
    // warm lantern glow for night windows (drawn above the night tint)
    var gl1 = Acan(64, 64),
      glg = gl1.getContext('2d');
    var gr2 = glg.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr2.addColorStop(0, 'rgba(255,196,110,0.85)');
    gr2.addColorStop(0.35, 'rgba(255,170,80,0.32)');
    gr2.addColorStop(1, 'rgba(255,150,60,0)');
    glg.fillStyle = gr2;
    glg.beginPath();
    glg.arc(32, 32, 31, 0, 7);
    glg.fill();
    ART.glow = gl1;
    // film grain for the DOM overlay
    var gc = Acan(96, 96),
      gg = gc.getContext('2d'),
      img = gg.createImageData(96, 96);
    for (var i = 0; i < img.data.length; i += 4) {
      var n2 = (Math.random() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n2;
      img.data[i + 3] = 6;
    }
    gg.putImageData(img, 0, 0);
    ART.grainURL = gc.toDataURL();
    // per-type dynamic anchors (tile-relative): flag poles, chimneys, sawmill blade, fisherman bobber
    ART.anchors = {
      hq: {
        flag: { x: 32.5, y: -32 },
        chim: [
          { x: 4.2, y: -25 },
          { x: 17.5, y: -24.6 },
        ],
      },
      warehouse: { flag: { x: 25, y: -20 } },
      guard: { flag: { x: 11, y: -19 } },
      toolsmith: { chim: [{ x: 7.3, y: -16 }] },
      sawmill: { blade: { x: 17.3, y: 8.5 } },
      fisherman: { bob: { x: 27, y: 2 } },
    };
  }
  buildAtlas();

  // Live bindings preserve replacement of arrays and mutable subsystem state.
  return {
    get SS() {
      return SS;
    },
    get ART() {
      return ART;
    },
    Acan,
    rgba,
    rr,
  };
}

export interface ArtSubsystem {
  readonly SS: number;
  readonly ART: ArtAtlas;
  Acan: (w: number, h: number) => HTMLCanvasElement;
  rgba: (c: string, a: number) => string;
  rr: (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => void;
}
