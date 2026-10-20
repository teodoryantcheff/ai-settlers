import type { GameRuntime } from '../runtime.ts';
import type { Tile } from '../types.ts';

/** One painted crag feature spanning every tile its artwork crosses. */
export interface LandscapeCragFeature {
  artFoot: number[];
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
    let h =
      Math.imul(x | 0, 374761393) ^
      Math.imul(y | 0, 668265263) ^
      Math.imul(game.seed | 0, 69069) ^
      (salt | 0);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function landscapeNoise(x: number, y: number, scale: number, salt: number): number {
    const xx = x / scale,
      yy = y / scale,
      ix = Math.floor(xx),
      iy = Math.floor(yy);
    let fx = xx - ix,
      fy = yy - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = landscapeHash(ix, iy, salt) / 4294967295,
      b = landscapeHash(ix + 1, iy, salt) / 4294967295,
      c = landscapeHash(ix, iy + 1, salt) / 4294967295,
      d = landscapeHash(ix + 1, iy + 1, salt) / 4294967295;
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function landscapeIs(x: number, y: number, type: number): boolean {
    return (
      game.inB(x, y) && game.isRevealed(game.idx(x, y)) && game.tiles[game.idx(x, y)].t === type
    );
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
    const a =
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
      paintLandscapeMaterial(g, x, y, game.SAND);
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
    const wx = x * game.TS,
      wy = y * game.TS,
      step = 72;
    // These soft washes span several tiles. A dirty tile reconstructs the same
    // neighboring patches, rather than stamping a gradient into each square.
    for (let by = Math.floor((wy - 90) / step); by <= Math.floor((wy + game.TS + 90) / step); by++)
      for (
        let bx = Math.floor((wx - 90) / step);
        bx <= Math.floor((wx + game.TS + 90) / step);
        bx++
      ) {
        const hash = landscapeHash(bx, by, sandy ? 128 : 126),
          cx = bx * step + 10 + (hash % 53) - wx,
          cy = by * step + 10 + ((hash >>> 8) % 53) - wy,
          radius = 34 + ((hash >>> 16) % 49);
        if (cx + radius < 0 || cy + radius < 0 || cx - radius > game.TS || cy - radius > game.TS)
          continue;
        const gradient = g.createRadialGradient(cx, cy, 0, cx, cy, radius),
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
    for (let gy = Math.floor(wy / 4) - 1; gy <= Math.floor((wy + game.TS) / 4); gy++)
      for (let gx = Math.floor(wx / 4) - 1; gx <= Math.floor((wx + game.TS) / 4); gx++) {
        const grain = landscapeHash(gx, gy, 130),
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
  function paintLandscapeWorkyard(g: CanvasRenderingContext2D, x: number, y: number): void {
    if (!game.buildingAt(x, y)) return;
    const dirt = g.createRadialGradient(12, 14, 2, 12, 14, 11);
    dirt.addColorStop(0, 'rgba(166,130,76,0.68)');
    dirt.addColorStop(0.55, 'rgba(184,153,92,0.38)');
    dirt.addColorStop(1, 'rgba(173,143,88,0)');
    g.fillStyle = dirt;
    g.fillRect(0, 0, game.TS, game.TS);
    for (let k = 0; k < 9; k++) {
      const h = landscapeHash(x, y, 380 + k),
        px = 2 + (h % 20),
        py = 12 + ((h >>> 8) % 11);
      g.fillStyle = k & 1 ? 'rgba(226,201,141,0.42)' : 'rgba(89,84,52,0.24)';
      g.beginPath();
      g.ellipse(px, py, 0.55 + ((h >>> 16) % 5) / 10, 0.4, -0.35, 0, 7);
      g.fill();
    }
  }
  // Broad crags are generated once per map, indexed into the tiles they cross. One
  // peak spans several tiles; painting a dirty tile reuses its exact world geometry.
  let landscapeCragMap: LandscapeCragMap | null = null;
  function prepareLandscapeCrags() {
    if (
      landscapeCragMap &&
      landscapeCragMap.tiles === game.tiles &&
      landscapeCragMap.seed === game.seed
    )
      return landscapeCragMap;
    const perTile: LandscapeCragFeature[][] = new Array(game.W * game.H),
      step = 4;
    for (let by = 0; by < game.H; by += step)
      for (let bx = 0; bx < game.W; bx += step) {
        let count = 0,
          sumX = 0,
          sumY = 0;
        for (let yy = by; yy < Math.min(game.H, by + step); yy++)
          for (let xx = bx; xx < Math.min(game.W, bx + step); xx++)
            if (landscapeIs(xx, yy, game.MTN)) {
              count++;
              sumX += xx;
              sumY += yy;
            }
        if (!count) continue;
        let anchorX = sumX / count,
          anchorY = sumY / count,
          nearest = Infinity;
        // Place the planted artwork base on a real mountain tile, including thin
        // ridges and isolated outcrops where a geometric centroid can be grass.
        for (let yy = by; yy < Math.min(game.H, by + step); yy++)
          for (let xx = bx; xx < Math.min(game.W, bx + step); xx++) {
            if (!landscapeIs(xx, yy, game.MTN)) continue;
            const distance = (xx - sumX / count) ** 2 + (yy - sumY / count) ** 2;
            if (distance < nearest) {
              nearest = distance;
              anchorX = xx;
              anchorY = yy;
            }
          }
        const artFoot = [(anchorX + 0.5) * game.TS, (anchorY + 0.85) * game.TS];
        const hash = landscapeHash(bx, by, 901),
          cx = (sumX / count + 0.5) * game.TS + (((hash >>> 8) % 13) - 6),
          cy = (sumY / count + 0.5) * game.TS + (((hash >>> 12) % 13) - 6),
          radius = 26 + Math.min(15, count * 1.4) + (hash % 12),
          height = 32 + Math.min(25, count * 2.2) + ((hash >>> 18) % 20),
          feature = {
            artFoot: artFoot,
            radius: radius,
            height: height,
            hash: hash,
            snow: false,
            density: count,
          };
        const minX = Math.max(
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
        for (let yy = minY; yy <= maxY; yy++)
          for (let xx = minX; xx <= maxX; xx++) {
            const i = game.idx(xx, yy);
            if (!perTile[i]) perTile[i] = [];
            perTile[i].push(feature);
          }
      }
    // Snow belongs to the highest dense massifs of this map, not an arbitrary
    // repeating variant. Sparse isolated outcrops never acquire a snowy summit.
    const unique = new Set<LandscapeCragFeature>();
    for (const group of perTile) if (group) for (const crag of group) unique.add(crag);
    const dense = Array.from(unique)
      .filter((f) => f.density >= 7)
      .sort((a, b) => b.height - a.height);
    for (let summit = 0; summit < Math.ceil(dense.length * 0.15); summit++)
      if (dense[summit].height >= 55) dense[summit].snow = true;
    // The same back-to-front order is used in every tile crossed by a feature.
    for (const features of perTile)
      if (features) features.sort((a, b) => a.artFoot[1] - b.artFoot[1]);
    landscapeCragMap = {
      tiles: game.tiles,
      seed: game.seed,
      perTile: perTile,
    };
    return landscapeCragMap;
  }
  function paintLandscapeCrags(g: CanvasRenderingContext2D, x: number, y: number): void {
    const crags = prepareLandscapeCrags();
    const list = crags.perTile[game.idx(x, y)] || [],
      wx = x * game.TS,
      wy = y * game.TS,
      painted = game.ART.paintedMountains;
    for (const f of list) {
      const variants = f.snow ? painted.snowy : painted.dry,
        image = f.density <= 3 ? painted.foothill : variants[f.hash % variants.length],
        width = f.radius * (f.density <= 3 ? 1.8 : 1.75 + f.height * 0.008),
        height = Math.min((width * image.height) / image.width, f.radius * 2.6),
        bottom = f.artFoot[1] + 4;
      // The transparent art projects north of its terrain anchor. Each crossed
      // dirty tile samples the same whole feature; no square contour clips it.
      g.drawImage(image, f.artFoot[0] - width * 0.52 - wx, bottom - height - wy, width, height);
    }
  }
  function paintMountain(g: CanvasRenderingContext2D, x: number, y: number, tl: Tile): void {
    paintLandscapeMaterial(g, x, y, game.GRASS);
    paintLandscapeCrags(g, x, y);
    if (tl.deposit && tl.deposit.amt > 0) paintOreSeams(g, tl.deposit, x, y);
  }
  function paintOreSeams(
    g: CanvasRenderingContext2D,
    deposit: NonNullable<Tile['deposit']>,
    x: number,
    y: number,
  ): void {
    const gold = deposit.kind === 'gold',
      iron = deposit.kind === 'iron',
      shade = gold ? '#78602d' : iron ? '#89523b' : '#293c34',
      light = gold ? '#e4bf59' : iron ? '#ce8d60' : '#586c5e',
      amount = Math.max(1, Math.ceil(2 * Math.min(1, deposit.amt / (deposit.amt0 || deposit.amt))));
    const angle = 0.15 + landscapeNoise((x + 0.5) * game.TS, (y + 0.5) * game.TS, 76, 714) * 2.3,
      cosine = Math.cos(angle),
      sine = Math.sin(angle);
    for (let j = 0; j < amount; j++) {
      const hash = landscapeHash(x, y, 719 + j),
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
      for (let p = 0; p < points.length; p++) {
        const px = xx + points[p][0] * cosine - points[p][1] * sine,
          py = yy + points[p][0] * sine + points[p][1] * cosine;
        if (!p) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.strokeStyle = shade;
      g.lineWidth = j ? 1.7 : 2.1;
      g.stroke();
      g.strokeStyle = light;
      g.lineWidth = j ? 0.65 : 0.9;
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
  function landscapeRoadMask(x: number, y: number): number {
    let mask = 0;
    const offsets = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    for (let i = 0; i < 4; i++) {
      const xx = x + offsets[i][0],
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
    const mask = landscapeRoadMask(x, y);
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
      let distance = Math.hypot(px - 12, py - 12);
      if (mask & 1 && py < 12) distance = Math.min(distance, Math.abs(px - 12));
      if (mask & 2 && px > 12) distance = Math.min(distance, Math.abs(py - 12));
      if (mask & 4 && py > 12) distance = Math.min(distance, Math.abs(px - 12));
      if (mask & 8 && px < 12) distance = Math.min(distance, Math.abs(py - 12));
      return distance;
    }
    // Tile-coordinate hashes give cached brush marks stable variation, independent
    // of simulation RNG. Small broken patches soften shoulders without changing joins.
    for (let k = 0; k < 42; k++) {
      const hh = landscapeHash(x, y, 550 + k),
        px = 1.5 + (hh % 210) / 10,
        py = 1.5 + ((hh >>> 8) % 210) / 10,
        distance = roadDistance(px, py);
      if (distance > 4.6) continue;
      const shoulder = distance > 2.8;
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
    for (let blade = 0; blade < 14; blade++) {
      const grassHash = landscapeHash(x, y, 585 + blade),
        gx = 1 + (grassHash % 22),
        gy = 1 + ((grassHash >>> 5) % 22);
      let distance = Math.hypot(gx - 12, gy - 12);
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
  ): void {
    if (type === game.GRASS) {
      const painted = game.ART.paintedTerrain;
      // Select a continuous world-space piece of the painted material. Its period
      // is a multiple of TS, so neighboring dirty tiles reconstruct exactly.
      const period = painted.worldSize,
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
      paintLandscapeCrags(g, x, y);
      return;
    }
    if (tl.t === game.MTN) {
      paintMountain(g, x, y, tl);
      return;
    }
    paintLandscapeMaterial(g, x, y, tl.t);
    paintLandscapeGround(g, x, y, tl.t === game.SAND);
    const other = tl.t === game.SAND ? game.GRASS : game.SAND,
      edges = landscapeSides(x, y, other),
      waters = landscapeSides(x, y, game.WATER);
    for (let side = 0; side < 4; side++) {
      if (edges[side]) landscapeShelf(g, side, tl.t === game.SAND ? '#778d55' : '#c8b584', 8, 0.5);
      if (waters[side]) {
        landscapeShelf(g, side, '#8b9270', 7, 0.32);
        landscapeShelf(g, side, '#676c50', 2.7, 0.25);
        if (h % 3 === 0) {
          g.strokeStyle = 'rgba(64,91,48,0.48)';
          g.lineWidth = 0.6;
          g.beginPath();
          for (let reed = 0; reed < 5; reed++) {
            const at = 4 + ((h + reed * 7) % 17);
            const rx = side === 1 ? game.TS - 2 : side === 3 ? 2 : at,
              ry = side === 0 ? 2 : side === 2 ? game.TS - 2 : at;
            g.moveTo(rx, ry + 1.3);
            g.lineTo(rx - 0.8, ry - 2.8 - (reed % 3));
            g.moveTo(rx, ry + 1);
            g.lineTo(rx + 1.4, ry - 1.6);
          }
          g.stroke();
        }
      }
    }
    paintLandscapeCrags(g, x, y);
    paintLandscapeWorkyard(g, x, y);
    if (tl.road) paintLandscapeRoad(g, x, y);
    if (tl.rock || tl.tree) {
      const cx = tl.tree ? 12 + (((h >>> 2) % 7) - 3) : 14,
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
  paintOreSeams: (
    g: CanvasRenderingContext2D,
    deposit: Tile['deposit'],
    x: number,
    y: number,
  ) => void;
  landscapeRoadMask: (x: number, y: number) => number;
  traceLandscapeRoad: (g: CanvasRenderingContext2D, mask: number) => void;
}
