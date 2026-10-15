import type { GameRuntime } from '../runtime.ts';
import type { ArtAtlas, Tile } from '../types.ts';

/** Per-tile mountain outline: perimeter exposure flags and eight shared points. */
export interface MountainContour {
  exposed: boolean[];
  points: number[][];
}
/** One generated crag feature spanning every tile its artwork crosses. */
export interface LandscapeCragFeature {
  peak: number[];
  artFoot: number[];
  left: number[];
  foot: number[];
  right: number[];
  shoulder: number[];
  ridge: number[];
  radius: number;
  height: number;
  hash: number;
  snow: boolean;
  density: number;
}
/** Map-wide crag geometry, regenerated when the tiles or seed change. */
export interface LandscapeCragMap {
  tiles: Tile[];
  seed: number;
  painted: ArtAtlas['paintedMountains'] | null;
  perTile: LandscapeCragFeature[][];
}

export function createLandscape(
  game: GameRuntime,
  internals?: LandscapeInternals,
): LandscapeSubsystem {
  // ==================== CACHED LANDSCAPE PAINTING ====================
  // Cosmetic hashes never consume the simulation RNG. Geometry and marks use world
  // coordinates so adjoining tiles share contours, strata, shoreline and road joins.
  function landscapeHash(x: number, y: number, salt: number): number {
    var h =
      Math.imul(x | 0, 374761393) ^
      Math.imul(y | 0, 668265263) ^
      Math.imul(game.seed | 0, 69069) ^
      (salt | 0);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function landscapeNoise(x: number, y: number, scale: number, salt: number): number {
    var xx = x / scale,
      yy = y / scale,
      ix = Math.floor(xx),
      iy = Math.floor(yy),
      fx = xx - ix,
      fy = yy - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    var a = landscapeHash(ix, iy, salt) / 4294967295,
      b = landscapeHash(ix + 1, iy, salt) / 4294967295,
      c = landscapeHash(ix, iy + 1, salt) / 4294967295,
      d = landscapeHash(ix + 1, iy + 1, salt) / 4294967295;
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function landscapeIs(x: number, y: number, type: number): boolean {
    return game.inB(x, y) && game.tiles[game.idx(x, y)].t === type;
  }
  function landscapeSides(x: number, y: number, type: number): boolean[] {
    return [
      landscapeIs(x, y - 1, type),
      landscapeIs(x + 1, y, type),
      landscapeIs(x, y + 1, type),
      landscapeIs(x - 1, y, type),
    ];
  }
  function landscapeShelf(
    g: CanvasRenderingContext2D,
    side: number,
    color: string,
    width: number,
    alpha: number,
  ): void {
    var a =
        side === 0
          ? [0, 0, 0, width]
          : side === 1
            ? [game.TS, 0, game.TS - width, 0]
            : side === 2
              ? [0, game.TS, 0, game.TS - width]
              : [0, 0, width, 0],
      gr = g.createLinearGradient(a[0], a[1], a[2], a[3]);
    gr.addColorStop(0, game.rgba(color, alpha));
    gr.addColorStop(1, game.rgba(color, 0));
    g.fillStyle = gr;
    if (side === 0) g.fillRect(0, 0, game.TS, width);
    else if (side === 1) g.fillRect(game.TS - width, 0, width, game.TS);
    else if (side === 2) g.fillRect(0, game.TS - width, game.TS, width);
    else g.fillRect(0, 0, width, game.TS);
  }
  function paintLandscapeWater(g: CanvasRenderingContext2D, x: number, y: number, h: number): void {
    const size = game.TS,
      wx = x * size,
      wy = y * size;
    const neighbours = landscapeSides(x, y, game.WATER);
    // Round only the painted corners, inside the logical water footprint.
    // The bank underpaint matches the adjoining sand material.
    const corners = [
      !neighbours[3] && !neighbours[0],
      !neighbours[0] && !neighbours[1],
      !neighbours[1] && !neighbours[2],
      !neighbours[2] && !neighbours[3],
    ];
    if (corners.some(Boolean)) {
      paintLandscapeMaterial(g, x, y, game.SAND, h);
      paintLandscapeGround(g, x, y, true);
    }
    g.save();
    const r = 9;
    g.beginPath();
    g.moveTo(corners[0] ? r : 0, 0);
    g.lineTo(corners[1] ? size - r : size, 0);
    if (corners[1]) g.quadraticCurveTo(size, 0, size, r);
    g.lineTo(size, corners[2] ? size - r : size);
    if (corners[2]) g.quadraticCurveTo(size, size, size - r, size);
    g.lineTo(corners[3] ? r : 0, size);
    if (corners[3]) g.quadraticCurveTo(0, size, 0, size - r);
    g.lineTo(0, corners[0] ? r : 0);
    if (corners[0]) g.quadraticCurveTo(0, 0, r, 0);
    g.closePath();
    g.clip();
    g.fillStyle = '#426f70';
    g.fillRect(0, 0, size, size);
    // Broad translucent pigment pools use world coordinates, never tile variants.
    // Adjacent cached tiles reconstruct exactly the same washes and brush marks.
    for (let by = Math.floor((wy - 100) / 64); by <= Math.floor((wy + size + 100) / 64); by++) {
      for (let bx = Math.floor((wx - 100) / 64); bx <= Math.floor((wx + size + 100) / 64); bx++) {
        const hash = landscapeHash(bx, by, 173);
        const cx = bx * 64 + (hash % 43) - wx,
          cy = by * 64 + ((hash >>> 8) % 43) - wy;
        const radius = 48 + ((hash >>> 16) % 48);
        if (cx + radius < 0 || cy + radius < 0 || cx - radius > size || cy - radius > size)
          continue;
        const wash = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
        const color = hash & 1 ? '130,161,134' : '30,71,82';
        wash.addColorStop(0, 'rgba(' + color + ',0.45)');
        wash.addColorStop(0.55, 'rgba(' + color + ',0.20)');
        wash.addColorStop(1, 'rgba(' + color + ',0)');
        g.fillStyle = wash;
        g.fillRect(0, 0, size, size);
      }
    }
    // Fine, uneven horizontal pigment strokes soften the otherwise flat surface.
    g.lineCap = 'round';
    for (let gy = Math.floor(wy / 5) - 1; gy <= Math.floor((wy + size) / 5); gy++) {
      for (let gx = Math.floor(wx / 13) - 2; gx <= Math.floor((wx + size) / 13); gx++) {
        const hash = landscapeHash(gx, gy, 174);
        const px = gx * 13 + (hash % 10) - wx,
          py = gy * 5 + ((hash >>> 8) % 5) - wy;
        const length = 5 + ((hash >>> 16) % 16);
        g.strokeStyle = hash & 1 ? 'rgba(174,192,153,0.14)' : 'rgba(27,66,72,0.12)';
        g.lineWidth = 0.8 + (hash % 4) * 0.35;
        g.beginPath();
        g.moveTo(px, py);
        g.quadraticCurveTo(px + length * 0.45, py - 0.6, px + length, py + 0.15);
        g.stroke();
      }
    }
    // Distance to all nearby land rectangles includes diagonal banks. Sampling
    // the same continuous field on both sides of a tile avoids square shelf seams.
    const banks: { left: number; top: number; right: number; bottom: number }[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && !landscapeIs(x + dx, y + dy, game.WATER))
          banks.push({
            left: dx * size,
            top: dy * size,
            right: (dx + 1) * size,
            bottom: (dy + 1) * size,
          });
      }
    const sample = 1 / game.ST;
    if (banks.length)
      for (let iy = 0; iy < size * game.ST; iy++)
        for (let ix = 0; ix < size * game.ST; ix++) {
          const px = ix * sample,
            py = iy * sample;
          let distance = 18;
          for (const bank of banks) {
            const dx = Math.max(bank.left - px - sample / 2, 0, px + sample / 2 - bank.right);
            const dy = Math.max(bank.top - py - sample / 2, 0, py + sample / 2 - bank.bottom);
            distance = Math.min(distance, Math.hypot(dx, dy));
          }
          if (distance >= 17) continue;
          const alpha = Math.pow(1 - distance / 17, 1.4) * 0.68;
          g.fillStyle = 'rgba(168,177,138,' + alpha.toFixed(3) + ')';
          g.fillRect(px, py, sample, sample);
          if (distance < 7) {
            g.fillStyle = 'rgba(192,181,139,' + ((1 - distance / 7) * 0.48).toFixed(3) + ')';
            g.fillRect(px, py, sample, sample);
          }
        }
    for (let side = 0; side < 4; side++) {
      if (neighbours[side]) continue;
      // A damp, irregular earth lip replaces the former white pool border.
      g.save();
      if (side === 1) {
        g.translate(size, 0);
        g.rotate(Math.PI / 2);
      } else if (side === 2) {
        g.translate(size, size);
        g.rotate(Math.PI);
      } else if (side === 3) {
        g.translate(0, size);
        g.rotate(-Math.PI / 2);
      }
      const start = side === 0 || side === 2 ? wx : wy;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(size, 0);
      for (let p = size; p >= 0; p -= 2) {
        const world = start + (side === 2 || side === 3 ? size - p : p);
        const depth = 1.2 + landscapeNoise(world, side === 0 || side === 2 ? wy : wx, 8, 176) * 2.4;
        g.lineTo(p, depth);
      }
      g.closePath();
      g.fillStyle = 'rgba(157,148,105,0.65)';
      g.fill();
      g.restore();
    }
    // Sparse broken reflections, with the same world-space placement across seams.
    for (let gy = Math.floor(wy / 19) - 1; gy <= Math.floor((wy + size) / 19); gy++) {
      for (let gx = Math.floor(wx / 37) - 1; gx <= Math.floor((wx + size) / 37); gx++) {
        const hash = landscapeHash(gx, gy, 177);
        if (hash % 3 === 0) continue;
        const px = gx * 37 + (hash % 24) - wx,
          py = gy * 19 + ((hash >>> 8) % 14) - wy;
        const length = 6 + ((hash >>> 16) % 13);
        g.beginPath();
        g.moveTo(px, py);
        g.quadraticCurveTo(px + length / 2, py - 0.7, px + length, py);
        g.strokeStyle = 'rgba(211,218,175,0.22)';
        g.lineWidth = 0.6;
        g.stroke();
      }
    }
    if (neighbours.some((n) => !n) && h % 7 === 0) {
      for (let leaf = 0; leaf < 3; leaf++) {
        const lx = 8 + leaf * 3.3,
          ly = 12 + (leaf % 2) * 2;
        g.fillStyle = 'rgba(25,61,51,0.28)';
        g.beginPath();
        g.ellipse(lx + 0.4, ly + 0.8, 2.1, 1.1, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = leaf % 2 ? '#8d9f5e' : '#718b55';
        g.beginPath();
        g.moveTo(lx, ly);
        g.ellipse(lx, ly, 1.8, 1, -0.15, 0.3, Math.PI * 2 - 0.25);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(191,197,119,0.6)';
        g.lineWidth = 0.35;
        g.beginPath();
        g.moveTo(lx - 1.2, ly);
        g.lineTo(lx + 0.8, ly - 0.35);
        g.stroke();
      }
    }
    g.restore();
  }
  function paintLandscapeGround(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    sandy: boolean,
  ): void {
    var wx = x * game.TS,
      wy = y * game.TS,
      step = 72;
    // These soft washes span several tiles. A dirty tile reconstructs the same
    // neighboring patches, rather than stamping a gradient into each square.
    for (var by = Math.floor((wy - 90) / step); by <= Math.floor((wy + game.TS + 90) / step); by++)
      for (
        var bx = Math.floor((wx - 90) / step);
        bx <= Math.floor((wx + game.TS + 90) / step);
        bx++
      ) {
        var hash = landscapeHash(bx, by, sandy ? 128 : 126),
          cx = bx * step + 10 + (hash % 53) - wx,
          cy = by * step + 10 + ((hash >>> 8) % 53) - wy,
          radius = 34 + ((hash >>> 16) % 49);
        if (cx + radius < 0 || cy + radius < 0 || cx - radius > game.TS || cy - radius > game.TS)
          continue;
        var gradient = g.createRadialGradient(cx, cy, 0, cx, cy, radius),
          color = sandy
            ? hash & 1
              ? '220,197,143'
              : '144,132,86'
            : hash & 1
              ? '183,186,87'
              : '36,85,34';
        gradient.addColorStop(0, 'rgba(' + color + (sandy ? ',0.24)' : ',0.34)'));
        gradient.addColorStop(0.5, 'rgba(' + color + (sandy ? ',0.13)' : ',0.19)'));
        gradient.addColorStop(1, 'rgba(' + color + ',0)');
        g.fillStyle = gradient;
        g.fillRect(0, 0, game.TS, game.TS);
      }
    // Tiny angled pigment marks break up the old repeating tile texture. Positions
    // come from a world grid, including overlapping marks on either side of a seam.
    for (var gy = Math.floor(wy / 4) - 1; gy <= Math.floor((wy + game.TS) / 4); gy++)
      for (var gx = Math.floor(wx / 4) - 1; gx <= Math.floor((wx + game.TS) / 4); gx++) {
        var grain = landscapeHash(gx, gy, 130),
          px = gx * 4 + (grain % 37) / 10 - wx,
          py = gy * 4 + ((grain >>> 8) % 37) / 10 - wy;
        g.strokeStyle = sandy
          ? grain & 1
            ? 'rgba(245,222,163,0.21)'
            : 'rgba(114,105,68,0.11)'
          : grain & 1
            ? 'rgba(212,202,115,0.16)'
            : 'rgba(36,79,37,0.12)';
        g.lineWidth = 0.55;
        g.beginPath();
        g.moveTo(px - 0.8, py + 0.45);
        g.lineTo(px + 1.2, py - 0.4);
        g.stroke();
      }
  }
  function paintLandscapeMeadow(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    tl: Tile,
    h: number,
  ): void {
    var wx = x * game.TS,
      wy = y * game.TS;
    // Leave the road bed and workyards clear. Forest floors still receive smaller,
    // shaded grass tufts; stones retain their separate readable sprite silhouette.
    if (tl.road || game.buildingAt(x, y) || tl.rock) return;
    for (var gy = Math.floor(wy / 5) - 1; gy <= Math.floor((wy + game.TS) / 5); gy++)
      for (var gx = Math.floor(wx / 5) - 1; gx <= Math.floor((wx + game.TS) / 5); gx++) {
        var n = landscapeHash(gx, gy, 201),
          ax = gx * 5 + (n % 47) / 10,
          ay = gy * 5 + ((n >>> 8) % 47) / 10,
          px = ax - wx,
          py = ay - wy,
          lush = landscapeNoise(ax, ay, 84, 101),
          patch = landscapeNoise(ax, ay, 31, 323),
          ownerX = Math.floor(ax / game.TS),
          ownerY = Math.floor(ay / game.TS),
          underTree = game.inB(ownerX, ownerY) && game.tiles[game.idx(ownerX, ownerY)].tree,
          height = (1.1 + ((n >>> 16) % 18) / 10) * (underTree ? 0.7 : 1),
          lean = ((n >>> 22) % 17) / 10 - 0.8;
        if (n % 10 > 2 + lush * 8) continue;
        g.strokeStyle = lush > 0.55 ? 'rgba(37,79,32,0.24)' : 'rgba(90,107,42,0.21)';
        g.lineWidth = 0.65;
        g.beginPath();
        g.moveTo(px - 1.2, py + 0.4);
        g.quadraticCurveTo(px - 0.6, py - height * 0.5, px - 1.5 + lean, py - height);
        g.moveTo(px, py + 0.5);
        g.quadraticCurveTo(px + 0.2, py - height * 0.65, px + 0.5 + lean, py - height * 1.15);
        g.moveTo(px + 0.6, py + 0.4);
        g.quadraticCurveTo(px + 1.2, py - height * 0.35, px + 1.8 + lean, py - height * 0.8);
        g.stroke();
        g.strokeStyle = n & 1 ? 'rgba(190,192,103,0.36)' : 'rgba(154,174,88,0.35)';
        g.lineWidth = 0.48;
        g.beginPath();
        g.moveTo(px - 0.7, py);
        g.quadraticCurveTo(px - 0.3, py - height * 0.5, px - 0.4 + lean, py - height * 0.85);
        g.stroke();
        if (underTree || patch < 0.59 || lush < 0.45 || n % 7 > 1) continue;
        // Independently hashed offsets and counts scatter blossoms into loose
        // clusters. Nothing reuses the former rectangular four-dot stamp.
        var flower = (n >>> 10) % 9,
          colors = [
            'rgba(219,207,140,0.76)',
            'rgba(226,218,184,0.75)',
            'rgba(157,180,194,0.72)',
            'rgba(219,192,103,0.78)',
            'rgba(196,150,147,0.70)',
            'rgba(189,202,128,0.72)',
            'rgba(221,213,167,0.74)',
          ],
          count = 1 + ((n >>> 18) % 4);
        for (var blossom = 0; blossom < count; blossom++) {
          var bloomHash = landscapeHash(gx, gy, 347 + blossom),
            fx = px + (bloomHash % 51) / 10 - 2.5,
            fy = py - height + ((bloomHash >>> 8) % 31) / 10 - 1.5,
            size = 0.38 + ((bloomHash >>> 16) % 6) / 10,
            angle = ((bloomHash >>> 22) % 18) / 10 - 0.9;
          g.strokeStyle = 'rgba(53,87,34,0.37)';
          g.lineWidth = 0.38;
          g.beginPath();
          g.moveTo(fx + 0.25, fy + 1.2);
          g.lineTo(fx, fy + 0.2);
          g.stroke();
          if (flower > 6) {
            // Clover leaves soften the transition from the flower patch to grass.
            g.fillStyle = bloomHash & 1 ? 'rgba(116,153,68,0.57)' : 'rgba(76,120,46,0.48)';
            g.beginPath();
            g.ellipse(fx, fy, size * 1.3, size * 0.65, angle, 0, 7);
            g.ellipse(fx + size * 0.7, fy + size * 0.5, size, size * 0.6, angle - 0.6, 0, 7);
            g.fill();
            continue;
          }
          g.fillStyle = 'rgba(43,70,29,0.16)';
          g.beginPath();
          g.ellipse(fx + 0.35, fy + 0.55, size * 1.2, size * 0.55, angle, 0, 7);
          g.fill();
          g.fillStyle = colors[flower];
          g.beginPath();
          g.ellipse(fx, fy, size, size * 0.62, angle, 0, 7);
          if (flower < 2 && size > 0.65)
            g.ellipse(fx - size * 0.12, fy - size * 0.16, size * 0.5, size * 0.75, angle, 0, 7);
          g.fill();
          if (flower < 2) {
            g.fillStyle = 'rgba(188,156,62,0.78)';
            g.beginPath();
            g.ellipse(fx, fy, 0.17, 0.15, 0, 0, 7);
            g.fill();
          }
        }
      }
    // Small moss hummocks have uneven leaves and a cool grounding shadow. Sparse
    // placement prevents the meadow from becoming another repeated symbol grid.
    var lush = landscapeNoise(wx + 12, wy + 12, 84, 101);
    if (!tl.tree && lush > 0.6 && h % 9 === 0) {
      var sx = 5 + (h % 11),
        sy = 5 + ((h >>> 3) % 12);
      g.fillStyle = 'rgba(35,65,28,0.18)';
      g.beginPath();
      g.ellipse(sx + 1, sy + 1.2, 3.7, 1.7, -0.15, 0, 7);
      g.fill();
      for (var leaf = 0; leaf < 5; leaf++) {
        var lh = landscapeHash(x, y, 344 + leaf);
        g.fillStyle = leaf & 1 ? '#93a85e' : '#6c914b';
        g.beginPath();
        g.ellipse(sx + (lh % 35) / 10 - 1.7, sy - ((lh >>> 5) % 18) / 10, 1.2, 0.65, -0.3, 0, 7);
        g.fill();
      }
    }
  }
  function paintLandscapeWorkyard(g: CanvasRenderingContext2D, x: number, y: number): void {
    if (!game.buildingAt(x, y)) return;
    var dirt = g.createRadialGradient(12, 14, 2, 12, 14, 11);
    dirt.addColorStop(0, 'rgba(166,130,76,0.68)');
    dirt.addColorStop(0.55, 'rgba(184,153,92,0.38)');
    dirt.addColorStop(1, 'rgba(173,143,88,0)');
    g.fillStyle = dirt;
    g.fillRect(0, 0, game.TS, game.TS);
    for (var k = 0; k < 9; k++) {
      var h = landscapeHash(x, y, 380 + k),
        px = 2 + (h % 20),
        py = 12 + ((h >>> 8) % 11);
      g.fillStyle = k & 1 ? 'rgba(226,201,141,0.42)' : 'rgba(89,84,52,0.24)';
      g.beginPath();
      g.ellipse(px, py, 0.55 + ((h >>> 16) % 5) / 10, 0.4, -0.35, 0, 7);
      g.fill();
    }
  }
  function mountainContour(x: number, y: number): MountainContour {
    var same = landscapeSides(x, y, game.MTN),
      n = !same[0],
      e = !same[1],
      s = !same[2],
      w = !same[3],
      wx = x * game.TS,
      wy = y * game.TS;
    function rim(ax: number, ay: number): number {
      return 2.4 + landscapeNoise(ax, ay, 15, 411) * 2.7;
    }
    // The shared vertex uses the same world-space sample on either side of a seam.
    // South/east escarpments occupy the perimeter only; adjoining mountain interiors
    // have neither a cliff nor a per-tile light/dark panel.
    var nw = rim(wx, wy),
      ne = rim(wx + game.TS, wy),
      se = rim(wx + game.TS, wy + game.TS),
      sw = rim(wx, wy + game.TS),
      midN = rim(wx + 12, wy),
      midE = rim(wx + game.TS, wy + 12),
      midS = rim(wx + 12, wy + game.TS),
      midW = rim(wx, wy + 12);
    return {
      exposed: [n, e, s, w],
      points: [
        [w ? nw : 0, n ? nw : 0],
        [12, n ? midN : 0],
        [e ? game.TS - ne : game.TS, n ? ne : 0],
        [e ? game.TS - midE : game.TS, 12],
        [e ? game.TS - se : game.TS, s ? game.TS - se - 2 : game.TS],
        [12, s ? game.TS - midS - 2 : game.TS],
        [w ? sw : 0, s ? game.TS - sw - 2 : game.TS],
        [w ? midW : 0, 12],
      ],
    };
  }
  function traceMountain(
    g: CanvasRenderingContext2D,
    contour: MountainContour,
    shift?: number,
  ): void {
    var points = contour.points,
      dy = shift || 0,
      dx = dy * 0.55;
    g.beginPath();
    g.moveTo(points[0][0] + dx, points[0][1] + dy);
    for (var k = 1; k < points.length; k += 2) {
      var end = points[(k + 1) % points.length];
      g.quadraticCurveTo(points[k][0] + dx, points[k][1] + dy, end[0] + dx, end[1] + dy);
    }
    g.closePath();
  }
  // Broad crags are generated once per map, indexed into the tiles they cross. One
  // peak spans several tiles; painting a dirty tile reuses its exact world geometry.
  // The cache keys on tiles identity, seed, and painted mountain art: an async pack
  // install flips crag sort order without touching tiles or seed.
  var landscapeCragMap: LandscapeCragMap | null = null;
  function prepareLandscapeCrags() {
    if (
      landscapeCragMap &&
      landscapeCragMap.tiles === game.tiles &&
      landscapeCragMap.seed === game.seed &&
      landscapeCragMap.painted === (game.ART.paintedMountains || null)
    )
      return;
    var perTile: LandscapeCragFeature[][] = new Array(game.W * game.H),
      step = 4;
    for (var by = 0; by < game.H; by += step)
      for (var bx = 0; bx < game.W; bx += step) {
        var count = 0,
          sumX = 0,
          sumY = 0;
        for (var yy = by; yy < Math.min(game.H, by + step); yy++)
          for (var xx = bx; xx < Math.min(game.W, bx + step); xx++)
            if (landscapeIs(xx, yy, game.MTN)) {
              count++;
              sumX += xx;
              sumY += yy;
            }
        if (!count) continue;
        var anchorX = sumX / count,
          anchorY = sumY / count,
          nearest = Infinity;
        // Place the planted artwork base on a real mountain tile, including thin
        // ridges and isolated outcrops where a geometric centroid can be grass.
        for (yy = by; yy < Math.min(game.H, by + step); yy++)
          for (xx = bx; xx < Math.min(game.W, bx + step); xx++) {
            if (!landscapeIs(xx, yy, game.MTN)) continue;
            var distance = (xx - sumX / count) ** 2 + (yy - sumY / count) ** 2;
            if (distance < nearest) {
              nearest = distance;
              anchorX = xx;
              anchorY = yy;
            }
          }
        var artFoot = [(anchorX + 0.5) * game.TS, (anchorY + 0.85) * game.TS];
        var hash = landscapeHash(bx, by, 901),
          cx = (sumX / count + 0.5) * game.TS + (((hash >>> 8) % 13) - 6),
          cy = (sumY / count + 0.5) * game.TS + (((hash >>> 12) % 13) - 6),
          radius = 26 + Math.min(15, count * 1.4) + (hash % 12),
          height = 32 + Math.min(25, count * 2.2) + ((hash >>> 18) % 20),
          peak = [cx - radius * (0.08 + ((hash >>> 24) % 14) / 100), cy - height * 0.72],
          left = [cx - radius, cy + height * 0.18],
          foot = [cx + radius * 0.12, cy + height * 0.37],
          right = [cx + radius * 0.98, cy + height * 0.2],
          shoulder = [cx - radius * 0.58, cy - height * 0.26],
          ridge = [cx + radius * 0.19, cy - height * 0.37],
          feature = {
            peak: peak,
            artFoot: artFoot,
            left: left,
            foot: foot,
            right: right,
            shoulder: shoulder,
            ridge: ridge,
            radius: radius,
            height: height,
            hash: hash,
            snow: false,
            density: count,
          };
        var minX = Math.max(
            0,
            Math.floor((Math.min(cx - radius * 1.35, artFoot[0] - radius * 1.3) - 1) / game.TS),
          ),
          maxX = Math.min(
            game.W - 1,
            Math.floor(Math.max(cx + radius * 1.35 + 6, artFoot[0] + radius * 1.3) / game.TS),
          ),
          minY = Math.max(
            0,
            Math.floor((Math.min(cy - height, artFoot[1] - radius * 2.6) - 1) / game.TS),
          ),
          maxY = Math.min(
            game.H - 1,
            Math.floor(
              Math.max(cy + Math.max(height * 0.6, height * 0.37 + 17.5), artFoot[1] + 11) /
                game.TS,
            ),
          );
        for (yy = minY; yy <= maxY; yy++)
          for (xx = minX; xx <= maxX; xx++) {
            var i = game.idx(xx, yy);
            if (!perTile[i]) perTile[i] = [];
            perTile[i].push(feature);
          }
      }
    // Snow belongs to the highest dense massifs of this map, not an arbitrary
    // repeating variant. Sparse isolated outcrops never acquire a snowy summit.
    var unique = new Set<LandscapeCragFeature>();
    for (var group of perTile) if (group) for (var crag of group) unique.add(crag);
    var dense = Array.from(unique)
      .filter((f) => f.density >= 7)
      .sort((a, b) => b.height - a.height);
    for (var summit = 0; summit < Math.ceil(dense.length * 0.15); summit++)
      if (dense[summit].height >= 55) dense[summit].snow = true;
    // The same back-to-front order is used in every tile crossed by a feature.
    for (var features of perTile)
      if (features)
        features.sort((a, b) =>
          game.ART.paintedMountains ? a.artFoot[1] - b.artFoot[1] : a.foot[1] - b.foot[1],
        );
    landscapeCragMap = {
      tiles: game.tiles,
      seed: game.seed,
      painted: game.ART.paintedMountains || null,
      perTile: perTile,
    };
  }
  function traceWorldFacet(
    g: CanvasRenderingContext2D,
    points: number[][],
    wx: number,
    wy: number,
  ): void {
    g.beginPath();
    g.moveTo(points[0][0] - wx, points[0][1] - wy);
    for (var p = 1; p < points.length; p++) g.lineTo(points[p][0] - wx, points[p][1] - wy);
    g.closePath();
  }
  function paintLandscapeCrags(g: CanvasRenderingContext2D, x: number, y: number): void {
    prepareLandscapeCrags();
    var list = landscapeCragMap.perTile[game.idx(x, y)] || [],
      wx = x * game.TS,
      wy = y * game.TS;
    function facet(points: number[][], color: string | CanvasGradient | CanvasPattern): void {
      traceWorldFacet(g, points, wx, wy);
      g.fillStyle = color;
      g.fill();
    }
    function between(a: number[], b: number[], t: number): number[] {
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    for (var f of list) {
      var painted = game.ART.paintedMountains;
      if (painted) {
        var variants = f.snow && painted.snowy.length ? painted.snowy : painted.dry,
          image =
            f.density <= 3 && painted.foothill
              ? painted.foothill
              : variants[f.hash % variants.length],
          width = f.radius * (f.density <= 3 ? 1.8 : 1.75 + f.height * 0.008),
          height = Math.min((width * image.height) / image.width, f.radius * 2.6),
          bottom = f.artFoot[1] + 4;
        // The transparent art projects north of its terrain anchor. Each crossed
        // dirty tile samples the same whole feature; no square contour clips it.
        g.drawImage(image, f.artFoot[0] - width * 0.52 - wx, bottom - height - wy, width, height);
        continue;
      }
      var peak = f.peak,
        foot = f.foot,
        left = f.left,
        right = f.right,
        r = f.radius,
        ht = f.height,
        shoulder = f.shoulder,
        ridge = f.ridge,
        spur = [peak[0] - r * 0.28, peak[1] + ht * 0.17],
        notch = [peak[0] - r * 0.16, peak[1] + ht * 0.25],
        eastSpur = [ridge[0] + r * 0.27, ridge[1] - ht * 0.09],
        eastNotch = [ridge[0] + r * 0.15, ridge[1] + ht * 0.08],
        outline = [left, shoulder, spur, notch, peak, ridge, eastNotch, eastSpur, right, foot];
      // Broad stepped limestone aprons give the granite mass a planted base. The
      // flat grassy tops and pale vertical risers share the peak's world footprint.
      for (var terrace = 2; terrace >= 0; terrace--) {
        var spread = 1 + terrace * 0.08,
          drop = 4 + terrace * 4,
          apron = [
            [left[0] - r * (spread - 1), left[1] + drop],
            [left[0] + r * 0.22, left[1] - ht * 0.12 + drop],
            [right[0] - r * 0.12, right[1] - ht * 0.09 + drop],
            [right[0] + r * (spread - 1), right[1] + drop],
            [foot[0] + r * 0.38, foot[1] + drop],
            [foot[0] - r * 0.48, foot[1] + drop + 1],
          ];
        facet(
          apron.map((p) => [p[0], p[1] + 3.5]),
          '#716d59',
        );
        facet(
          apron.map((p) => [p[0], p[1] + 1.5]),
          '#c6b99a',
        );
        facet(apron, terrace & 1 ? '#899a5d' : '#9ca86b');
        traceWorldFacet(g, apron.slice(3), wx, wy);
        g.strokeStyle = 'rgba(229,220,170,0.65)';
        g.lineWidth = 0.8;
        g.stroke();
      }
      // A southeast cast shadow separates high stone from its grassy benches.
      facet(
        outline.map((p) => [p[0] + 5, p[1] + 6]),
        'rgba(39,53,45,0.28)',
      );
      var base = g.createLinearGradient(peak[0] - wx, peak[1] - wy, foot[0] - wx, foot[1] - wy);
      base.addColorStop(0, '#b7b6a1');
      base.addColorStop(0.45, '#979c91');
      base.addColorStop(1, '#788779');
      facet(outline, base);
      g.save();
      traceWorldFacet(g, outline, wx, wy);
      g.clip();
      // Tall, narrow planes descend from unequal spires; cool occluded faces sit
      // alongside warm northwest light rather than a repeated diamond texture.
      var shade = g.createLinearGradient(peak[0] - wx, peak[1] - wy, right[0] - wx, right[1] - wy);
      shade.addColorStop(0, '#969d91');
      shade.addColorStop(0.5, '#6b7976');
      shade.addColorStop(1, '#4e6465');
      facet([peak, ridge, eastNotch, eastSpur, right, foot], shade);
      facet([peak, [peak[0] + r * 0.12, peak[1] + ht * 0.4], foot], '#4e6265');
      var sun = g.createLinearGradient(peak[0] - wx, peak[1] - wy, foot[0] - wx, foot[1] - wy);
      sun.addColorStop(0, '#d2c7a7');
      sun.addColorStop(0.55, '#b4b29b');
      sun.addColorStop(1, '#8d9a84');
      facet([left, shoulder, spur, notch, peak, foot], sun);
      facet([shoulder, spur, [spur[0] + r * 0.06, spur[1] + ht * 0.34], left], '#d0c4a2');
      facet([notch, peak, [peak[0] - r * 0.06, peak[1] + ht * 0.57], foot], '#c6c0a5');
      facet([eastNotch, eastSpur, [right[0] - r * 0.15, right[1] - ht * 0.13], right], '#88938a');
      facet([ridge, [ridge[0] + r * 0.06, ridge[1] + ht * 0.3], foot], '#75827a');
      // Broken granite joints follow the vertical relief, with occasional angled
      // ledges. All samples are feature-local hashes, never simulation random draws.
      for (var crack = 0; crack < 9; crack++) {
        var q = landscapeHash(f.hash, crack, 912),
          t = 0.12 + (q % 65) / 100,
          start = between(left, peak, t),
          end = between(left, foot, t + 0.1),
          bend = between(start, end, 0.48);
        bend[0] += ((q >>> 8) % 7) - 3;
        g.beginPath();
        g.moveTo(start[0] - wx, start[1] - wy);
        g.lineTo(bend[0] - wx, bend[1] - wy);
        g.lineTo(end[0] - wx, end[1] - wy);
        g.strokeStyle = 'rgba(66,77,70,0.38)';
        g.lineWidth = 1.1;
        g.stroke();
        g.strokeStyle = 'rgba(231,215,173,0.35)';
        g.lineWidth = 0.4;
        g.stroke();
      }
      for (var ledge = 0; ledge < 4; ledge++) {
        var t2 = 0.46 + ledge * 0.12,
          a = between(peak, left, t2),
          b = between(peak, foot, t2 + 0.06);
        facet([a, [a[0] + 4, a[1] - 1.5], b, [b[0] - 2, b[1] + 1.5]], 'rgba(221,210,175,0.30)');
      }
      // Small translucent angular brush marks soften the large stone planes.
      // They are cached with the terrain, with no new raster work on live frames.
      for (var fleck = 0; fleck < 24; fleck++) {
        var fh = landscapeHash(f.hash, fleck, 919),
          fx = left[0] + ((fh % 1000) / 1000) * r * 2,
          fy = peak[1] + (((fh >>> 12) % 1000) / 1000) * ht * 1.1,
          size = 1.5 + ((fh >>> 24) % 40) / 10;
        facet(
          [
            [fx, fy],
            [fx + size * 0.4, fy - size],
            [fx + size, fy + size * 0.3],
            [fx + size * 0.4, fy + size],
          ],
          fleck & 1 ? 'rgba(235,218,177,0.12)' : 'rgba(39,65,64,0.10)',
        );
      }
      if (f.snow) {
        // Only the tallest dense summits carry small broken caps; low terraces
        // remain green and mineral seams are painted afterwards for legibility.
        facet(
          [
            peak,
            between(peak, ridge, 0.37),
            [peak[0] + r * 0.04, peak[1] + ht * 0.21],
            [peak[0] - r * 0.04, peak[1] + ht * 0.13],
            between(peak, notch, 0.5),
          ],
          '#e6e7d9',
        );
        facet(
          [peak, between(peak, ridge, 0.37), [peak[0] + r * 0.04, peak[1] + ht * 0.21]],
          '#bfcfd0',
        );
      }
      g.restore();
      g.beginPath();
      g.moveTo(shoulder[0] - wx, shoulder[1] - wy);
      for (var p of [spur, notch, peak]) g.lineTo(p[0] - wx, p[1] - wy);
      g.strokeStyle = 'rgba(243,226,184,0.7)';
      g.lineWidth = 0.85;
      g.stroke();
    }
  }
  function paintMountain(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    tl: Tile,
    h: number,
  ): void {
    if (game.ART.paintedMountains) {
      paintLandscapeMaterial(g, x, y, game.GRASS, h);
      paintLandscapeCrags(g, x, y);
      if (tl.res && tl.res.amt > 0) paintOreSeams(g, tl.res, x, y);
      return;
    }
    var wx = x * game.TS,
      wy = y * game.TS,
      c = mountainContour(x, y);
    // Mossy ground below the irregular rock edge avoids a geometric slab outline.
    g.drawImage(game.ART.grass[h % 4], 0, 0, game.TS, game.TS);
    g.fillStyle = 'rgba(108,112,86,0.35)';
    g.fillRect(0, 0, game.TS, game.TS);
    traceMountain(g, c, 3.8);
    g.fillStyle = '#626455';
    g.fill();
    traceMountain(g, c, 1.6);
    g.fillStyle = '#818573';
    g.fill();
    traceMountain(g, c);
    var base = g.createLinearGradient(-wx, -wy, game.W * game.TS - wx, game.H * game.TS - wy);
    base.addColorStop(0, '#afaf86');
    base.addColorStop(0.55, '#97a175');
    base.addColorStop(1, '#84976a');
    g.fillStyle = base;
    g.fill();
    g.save();
    g.clip();
    // Strata are long continuous world lines, never tile-sized cracks or frames.
    for (var band = Math.floor(wy / 10) - 1; band <= Math.floor((wy + game.TS) / 10) + 1; band++) {
      g.beginPath();
      for (var p = 0; p <= game.TS; p += 4) {
        var yy = band * 10 + Math.sin((wx + p) / 31 + band * 0.47) * 3.8 - wy;
        if (p === 0) g.moveTo(p, yy);
        else g.lineTo(p, yy);
      }
      g.strokeStyle = 'rgba(81,93,78,0.14)';
      g.lineWidth = 1.1;
      g.stroke();
      g.strokeStyle = 'rgba(225,224,189,0.20)';
      g.lineWidth = 0.45;
      g.stroke();
    }
    for (var chip = 0; chip < 4; chip++) {
      var hh = landscapeHash(x, y, 440 + chip),
        cx = 2 + (hh % 21),
        cy = 2 + ((hh >>> 6) % 21);
      g.strokeStyle = 'rgba(88,100,83,0.22)';
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(cx - 1, cy);
      g.lineTo(cx + 1.4, cy - 0.5);
      g.lineTo(cx + 2.2, cy + 0.5);
      g.stroke();
    }
    paintLandscapeCrags(g, x, y);
    if (tl.res && tl.res.amt > 0) paintOreSeams(g, tl.res, x, y);
    g.restore();
    paintMountainScree(g, c, h);
    // Edge lighting is restricted to actual exposed northern/western ridges.
    g.strokeStyle = 'rgba(227,226,193,0.55)';
    g.lineWidth = 0.9;
    g.beginPath();
    if (c.exposed[0]) {
      g.moveTo(c.points[0][0], c.points[0][1]);
      g.lineTo(c.points[1][0], c.points[1][1]);
      g.lineTo(c.points[2][0], c.points[2][1]);
    }
    if (c.exposed[3]) {
      g.moveTo(c.points[0][0], c.points[0][1]);
      g.lineTo(c.points[7][0], c.points[7][1]);
      g.lineTo(c.points[6][0], c.points[6][1]);
    }
    g.stroke();
  }
  function paintOreSeams(
    g: CanvasRenderingContext2D,
    res: Tile['res'],
    x: number,
    y: number,
  ): void {
    var gold = res.kind === 'gold',
      iron = res.kind === 'iron',
      shade = gold ? '#78602d' : iron ? '#89523b' : '#293c34',
      light = gold ? '#e4bf59' : iron ? '#ce8d60' : '#586c5e',
      amount = Math.max(1, Math.ceil(2 * Math.min(1, res.amt / (res.amt0 || res.amt))));
    var angle = 0.15 + landscapeNoise((x + 0.5) * game.TS, (y + 0.5) * game.TS, 76, 714) * 2.3,
      cosine = Math.cos(angle),
      sine = Math.sin(angle);
    for (var j = 0; j < amount; j++) {
      var hash = landscapeHash(x, y, 719 + j),
        xx = 7 + (hash % 11),
        yy = 7 + ((hash >>> 5) % 10),
        length = (j ? 5.4 : 9.5) + ((hash >>> 9) % 4),
        points = [
          [-length / 2, -0.3],
          [-length * 0.18, 0.65],
          [length * 0.09, -0.45],
          [length / 2, 0.35],
        ];
      g.beginPath();
      for (var p = 0; p < points.length; p++) {
        var px = xx + points[p][0] * cosine - points[p][1] * sine,
          py = yy + points[p][0] * sine + points[p][1] * cosine;
        if (!p) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.strokeStyle = shade;
      g.lineWidth = game.ART.paintedMountains ? (j ? 1.7 : 2.1) : j ? 2.9 : 3.8;
      g.stroke();
      g.strokeStyle = light;
      g.lineWidth = game.ART.paintedMountains ? (j ? 0.65 : 0.9) : j ? 1.1 : 1.8;
      g.stroke();
      // A short fork and an irregular mineral glint follow the fracture orientation.
      g.beginPath();
      g.moveTo(xx, yy);
      g.lineTo(xx + 2 * cosine - 2.2 * sine, yy + 2 * sine + 2.2 * cosine);
      g.strokeStyle = light;
      g.lineWidth = 0.8;
      g.stroke();
      g.fillStyle = gold ? '#f2d88b' : iron ? '#e1ac81' : '#25372f';
      g.beginPath();
      g.ellipse(xx + 0.8 * cosine, yy + 0.8 * sine, gold ? 1.5 : 1.3, 0.65, angle, 0, 7);
      g.fill();
    }
  }
  function paintMountainScree(
    g: CanvasRenderingContext2D,
    contour: MountainContour,
    h: number,
  ): void {
    for (var side = 0; side < 4; side++) {
      if (!contour.exposed[side]) continue;
      for (var j = 0; j < 2; j++) {
        var along = 3 + ((h + j * 11 + side * 5) % 18),
          px = side === 1 ? game.TS - 1.4 : side === 3 ? 1.4 : along,
          py = side === 0 ? 1.5 : side === 2 ? game.TS - 1.8 : along;
        g.fillStyle = 'rgba(55,73,53,0.28)';
        g.beginPath();
        g.ellipse(px + 0.7, py + 0.9, 2.2, 1, -0.2, 0, 7);
        g.fill();
        g.beginPath();
        g.moveTo(px - 1.7, py + 0.4);
        g.lineTo(px - 0.4, py - 1.1);
        g.lineTo(px + 1.5, py - 0.3);
        g.lineTo(px + 1.3, py + 0.8);
        g.closePath();
        g.fillStyle = j ? '#8e9e82' : '#a8b090';
        g.fill();
        g.strokeStyle = 'rgba(205,208,170,0.42)';
        g.lineWidth = 0.5;
        g.stroke();
      }
    }
  }
  function landscapeRoadMask(x: number, y: number): number {
    var mask = 0,
      offsets = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ];
    for (var i = 0; i < 4; i++) {
      var xx = x + offsets[i][0],
        yy = y + offsets[i][1];
      if (game.inB(xx, yy) && (game.tiles[game.idx(xx, yy)].road || game.buildingAt(xx, yy)))
        mask |= 1 << i;
    }
    return mask;
  }
  function traceLandscapeRoad(g: CanvasRenderingContext2D, mask: number): void {
    g.beginPath();
    if (mask & 1) {
      g.moveTo(12, 12);
      g.lineTo(12, -1);
    }
    if (mask & 2) {
      g.moveTo(12, 12);
      g.lineTo(25, 12);
    }
    if (mask & 4) {
      g.moveTo(12, 12);
      g.lineTo(12, 25);
    }
    if (mask & 8) {
      g.moveTo(12, 12);
      g.lineTo(-1, 12);
    }
    if (!mask) {
      g.moveTo(11.9, 12);
      g.lineTo(12.1, 12);
    }
  }
  function paintLandscapeRoad(g: CanvasRenderingContext2D, x: number, y: number): void {
    var mask = landscapeRoadMask(x, y);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    traceLandscapeRoad(g, mask);
    // A soft earth wash blends the lane into the meadow; no curbs or centre stripe.
    g.strokeStyle = 'rgba(142,119,77,0.24)';
    g.lineWidth = 10;
    g.stroke();
    g.strokeStyle = 'rgba(166,141,96,0.78)';
    g.lineWidth = 7;
    g.stroke();
    function roadDistance(px: number, py: number) {
      var distance = Math.hypot(px - 12, py - 12);
      if (mask & 1 && py < 12) distance = Math.min(distance, Math.abs(px - 12));
      if (mask & 2 && px > 12) distance = Math.min(distance, Math.abs(py - 12));
      if (mask & 4 && py > 12) distance = Math.min(distance, Math.abs(px - 12));
      if (mask & 8 && px < 12) distance = Math.min(distance, Math.abs(py - 12));
      return distance;
    }
    // Tile-coordinate hashes give cached brush marks stable variation, independent
    // of simulation RNG. Small broken patches soften shoulders without changing joins.
    for (var k = 0; k < 42; k++) {
      var hh = landscapeHash(x, y, 550 + k),
        px = 1.5 + (hh % 210) / 10,
        py = 1.5 + ((hh >>> 8) % 210) / 10,
        distance = roadDistance(px, py);
      if (distance > 4.6) continue;
      var shoulder = distance > 2.8;
      g.fillStyle = shoulder
        ? 'rgba(153,132,86,0.43)'
        : k % 3
          ? 'rgba(207,179,125,0.24)'
          : 'rgba(105,85,57,0.19)';
      g.beginPath();
      g.ellipse(
        px,
        py,
        shoulder ? 1.25 : 0.6 + (hh % 9) / 10,
        0.35 + ((hh >>> 4) % 6) / 10,
        (hh % 11) / 4,
        0,
        7,
      );
      g.fill();
      // A few embedded pebbles, rather than paving or regularly spaced cobbles.
      if (!shoulder && k % 9 === 0) {
        g.fillStyle = 'rgba(214,200,164,0.48)';
        g.fillRect(px, py, 0.8, 0.5);
      }
    }
    for (var blade = 0; blade < 14; blade++) {
      var grassHash = landscapeHash(x, y, 585 + blade),
        gx = 1 + (grassHash % 22),
        gy = 1 + ((grassHash >>> 5) % 22),
        distance = Math.hypot(gx - 12, gy - 12);
      if (mask & 1 && gy < 12) distance = Math.min(distance, Math.abs(gx - 12));
      if (mask & 2 && gx > 12) distance = Math.min(distance, Math.abs(gy - 12));
      if (mask & 4 && gy > 12) distance = Math.min(distance, Math.abs(gx - 12));
      if (mask & 8 && gx < 12) distance = Math.min(distance, Math.abs(gy - 12));
      if (distance < 3.4 || distance > 5.6) continue;
      g.strokeStyle = 'rgba(92,112,54,0.48)';
      g.lineWidth = 0.65;
      g.beginPath();
      g.moveTo(gx, gy + 0.7);
      g.lineTo(gx - 0.6, gy - 0.8);
      g.lineTo(gx + 0.3, gy);
      g.stroke();
    }
  }
  function paintLandscapeMaterial(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    type: number,
    h: number,
  ): void {
    var painted = game.ART.paintedTerrain;
    if (type === game.GRASS && painted) {
      // Select a continuous world-space piece of the painted material. Its period
      // is a multiple of TS, so neighboring dirty tiles reconstruct exactly.
      var period = painted.worldSize,
        sx = (((x * game.TS) % period) / period) * painted.image.width,
        sy = (((y * game.TS) % period) / period) * painted.image.height;
      g.drawImage(
        painted.image,
        sx,
        sy,
        (game.TS / period) * painted.image.width,
        (game.TS / period) * painted.image.height,
        0,
        0,
        game.TS,
        game.TS,
      );
    } else if (type === game.SAND) {
      // Beach pigment is varied by the continuous ground washes, not brick-like
      // per-tile stamps. This also matches the rounded water-corner underpaint.
      g.fillStyle = '#bcb08a';
      g.fillRect(0, 0, game.TS, game.TS);
    } else {
      g.drawImage(game.ART.grass[h % 4], 0, 0, game.TS, game.TS);
    }
  }
  function paintLandscapeTile(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    tl: Tile,
    h: number,
  ): void {
    if (tl.t === game.WATER) {
      paintLandscapeWater(g, x, y, h);
      if (game.ART.paintedMountains) paintLandscapeCrags(g, x, y);
      return;
    }
    if (tl.t === game.MTN) {
      paintMountain(g, x, y, tl, h);
      return;
    }
    var painted = game.ART.paintedTerrain;
    paintLandscapeMaterial(g, x, y, tl.t, h);
    paintLandscapeGround(g, x, y, tl.t === game.SAND);
    var other = tl.t === game.SAND ? game.GRASS : game.SAND,
      edges = landscapeSides(x, y, other),
      waters = landscapeSides(x, y, game.WATER),
      mountains = landscapeSides(x, y, game.MTN);
    for (var side = 0; side < 4; side++) {
      if (edges[side]) landscapeShelf(g, side, tl.t === game.SAND ? '#778d55' : '#c8b584', 8, 0.5);
      if (waters[side]) {
        landscapeShelf(g, side, '#8b9270', 7, 0.32);
        landscapeShelf(g, side, '#676c50', 2.7, 0.25);
        if (h % 3 === 0) {
          g.strokeStyle = 'rgba(64,91,48,0.48)';
          g.lineWidth = 0.6;
          g.beginPath();
          for (var reed = 0; reed < 5; reed++) {
            var at = 4 + ((h + reed * 7) % 17);
            var rx = side === 1 ? game.TS - 2 : side === 3 ? 2 : at,
              ry = side === 0 ? 2 : side === 2 ? game.TS - 2 : at;
            g.moveTo(rx, ry + 1.3);
            g.lineTo(rx - 0.8, ry - 2.8 - (reed % 3));
            g.moveTo(rx, ry + 1);
            g.lineTo(rx + 1.4, ry - 1.6);
          }
          g.stroke();
        }
      }
      if (mountains[side] && !game.ART.paintedMountains) {
        landscapeShelf(g, side, '#919780', 7, 0.37);
        if (side === 0 || side === 3) landscapeShelf(g, side, '#424e35', 9, 0.23);
        g.fillStyle = 'rgba(135,141,113,0.65)';
        for (var stone = 0; stone < 3; stone++) {
          var at2 = 3 + ((h + stone * 7) % 19),
            dep = 2 + ((h + stone * 3) % 4);
          g.beginPath();
          g.ellipse(
            side === 1 ? game.TS - dep : side === 3 ? dep : at2,
            side === 0 ? dep : side === 2 ? game.TS - dep : at2,
            1.2,
            0.75,
            -0.3,
            0,
            7,
          );
          g.fill();
        }
      }
    }
    if (tl.t === game.GRASS && !painted) paintLandscapeMeadow(g, x, y, tl, h);
    if (game.ART.paintedMountains) paintLandscapeCrags(g, x, y);
    paintLandscapeWorkyard(g, x, y);
    if (tl.road) paintLandscapeRoad(g, x, y);
    if (tl.rock || tl.tree) {
      var cx = tl.tree ? 12 + (((h >>> 2) % 7) - 3) : 14,
        cy = tl.tree ? 18.5 + (((h >>> 5) % 5) - 2) : 19;
      g.fillStyle = 'rgba(35,45,25,0.16)';
      g.beginPath();
      g.ellipse(cx + 1, cy + 0.5, tl.tree ? 10 : 8, 3.2, -0.05, 0, 7);
      g.fill();
    }
  }

  // Test-only view of closure internals; never merged into the runtime.
  if (internals)
    Object.assign(internals, {
      mountainContour,
      paintOreSeams,
      landscapeRoadMask,
      traceLandscapeRoad,
    });

  // Live bindings preserve replacement of arrays and mutable subsystem state.
  return {
    landscapeHash,
    get landscapeCragMap() {
      return landscapeCragMap;
    },
    set landscapeCragMap(value: typeof landscapeCragMap) {
      landscapeCragMap = value;
    },
    prepareLandscapeCrags,
    paintLandscapeTile,
  };
}

export interface LandscapeSubsystem {
  landscapeHash: (x: number, y: number, salt: number) => number;
  landscapeCragMap: LandscapeCragMap | null;
  prepareLandscapeCrags: () => void;
  paintLandscapeTile: (
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    tl: Tile,
    h: number,
  ) => void;
}

/** Test-only view of closure internals; never merged into the runtime. */
export interface LandscapeInternals {
  mountainContour: (x: number, y: number) => MountainContour;
  paintOreSeams: (g: CanvasRenderingContext2D, res: Tile['res'], x: number, y: number) => void;
  landscapeRoadMask: (x: number, y: number) => number;
  traceLandscapeRoad: (g: CanvasRenderingContext2D, mask: number) => void;
}
