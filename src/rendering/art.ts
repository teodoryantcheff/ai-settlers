import { requireCanvas2D } from './canvas-context.ts';
import type { GameRuntime } from '../runtime.ts';
import type { ArtAtlas, Good } from '../types.ts';

export function createArt(game: GameRuntime): ArtSubsystem {
  // Generated settlers, cargo and effect textures share stable anchors. Buildings,
  // trees, rocks and terrain come from the installed painted art pack.

  const SS = 3;
  const ART = {} as ArtAtlas;

  function Acan(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    // Offscreen art is prepared once and sampled/uploaded later. CPU backing
    // avoids synchronizing thousands of tiny paint commands through the GPU.
    requireCanvas2D(c, game.reportGraphicsFailure, { willReadFrequently: true });
    return c;
  }
  function prs(c: string): number[] {
    if (c.charAt(0) === '#')
      return [
        parseInt(c.substr(1, 2), 16),
        parseInt(c.substr(3, 2), 16),
        parseInt(c.substr(5, 2), 16),
      ];
    const m = c.match(/(\d+)[, ]+(\d+)[, ]+(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : [255, 255, 255];
  }
  function rgba(c: string, a: number): string {
    const r = prs(c);
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

  // Dirt-and-cobble road menu icon.
  // Crossroad icon for the building menu. World roads use the landscape painter.
  function texRoad(): HTMLCanvasElement {
    const c = Acan(48, 48),
      g = requireCanvas2D(c, game.reportGraphicsFailure),
      rnd = game.mulberry32(895);
    const cx = 24,
      cy = 24;
    function armPts(dir: string): number[][] {
      const pts = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4,
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
    const p = armPts('n');
    g.moveTo(p[0][0], p[0][1]);
    for (let k2 = 1; k2 < p.length; k2++) g.lineTo(p[k2][0], p[k2][1]);
    g.lineTo(cx + 7, cy);
    const p2 = armPts('e');
    g.lineTo(p2[p2.length - 1][0] - 5, p2[p2.length - 1][1]);
    for (let k2 = p2.length - 2; k2 >= 0; k2--) g.lineTo(p2[k2][0] + 5, p2[k2][1]);
    const p3 = armPts('s');
    g.lineTo(p3[p3.length - 1][0] + 6, p3[p3.length - 1][1] - 1);
    for (let k2 = p3.length - 2; k2 >= 0; k2--) g.lineTo(p3[k2][0] + 6, p3[k2][1]);
    const p4 = armPts('w');
    g.lineTo(p4[p4.length - 1][0] + 1, p4[p4.length - 1][1] + 6);
    for (let k2 = p4.length - 2; k2 >= 0; k2--) g.lineTo(p4[k2][0], p4[k2][1] + 6);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba('#785830', 0.65);
    g.lineWidth = 1.6;
    g.stroke();
    const arms = ['n', 'e', 's', 'w'];
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
    for (let i = 0; i < arms.length; i++) {
      const p5 = armPts(arms[i]);
      for (let k3 = 1; k3 < p5.length; k3++) {
        const mx = (p5[k3][0] + p5[k3 - 1][0]) / 2,
          my = (p5[k3][1] + p5[k3 - 1][1]) / 2;
        cobble(mx + (rnd() - 0.5) * 3, my + (rnd() - 0.5) * 3, 2 + rnd() * 1.8);
      }
    }
    cobble(cx, cy, 3.2);
    // grass encroaching on the edges
    g.fillStyle = rgba('#4c8830', 0.55);
    for (let i = 0; i < 5; i++) g.fillRect(rnd() * 46, rnd() * 46, 1.5, 1);
    g.fillStyle = rgba('#4c3820', 0.32);
    for (let i = 0; i < 5; i++) g.fillRect(4 + rnd() * 40, 4 + rnd() * 40, 1.5, 1);
    return c;
  }
  // Eight directions and eight gait frames share the same feet anchor.
  function texDirectionalUnit(
    kind: 'carrier' | 'soldier',
    dir: string,
    frame: number,
  ): HTMLCanvasElement {
    const c = Acan(15 * SS, 19 * SS),
      g = requireCanvas2D(c, game.reportGraphicsFailure);
    g.scale(SS, SS);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const soldier = kind === 'soldier',
      side = dir === 'e' || dir === 'w',
      diagonal = dir.length === 2,
      back = dir.indexOf('n') !== -1,
      cx = 7.5;
    const stride = frame < 0 ? 0 : Math.sin((frame * Math.PI) / 4) * 1.6;
    const lift = frame < 0 ? 0 : Math.cos((frame * Math.PI) / 4) * 0.65;
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
    const arm = side ? stride * 0.7 : stride * 0.3;
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
  function texCargo(good: Good): HTMLCanvasElement {
    const c = Acan(16 * SS, 12 * SS),
      g = requireCanvas2D(c, game.reportGraphicsFailure);
    g.scale(SS, SS);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    if (good === 'logs') {
      for (let i = 0; i < 3; i++) {
        const y = 4 + i * 2.6,
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
      for (let p = 0; p < 3; p++) {
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
      const sack = g.createLinearGradient(3, 0, 12, 0);
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
      for (let cut = 0; cut < 3; cut++) {
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
      for (let bar = 0; bar < 3; bar++) {
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
      for (let k = 0; k < 2; k++) {
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
      const colors =
        good === 'stone'
          ? ['#e2e0ce', '#a09e90', '#696e68']
          : good === 'coal'
            ? ['#647174', '#303c41', '#1c2429']
            : good === 'iron'
              ? ['#e6a96c', '#ac7047', '#724c37']
              : ['#fff1a1', '#e0ac3e', '#966c23'];
      for (let r = 0; r < 3; r++) {
        const cx = 4 + r * 4.1,
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
    const c = Acan(9 * SS, 9 * SS),
      g = requireCanvas2D(c, game.reportGraphicsFailure);
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
    ART.road = texRoad();
    ART.blade = texBlade();
    ART.unitDirections = {};
    ART.cargo = {};
    for (const good in game.GOODS) ART.cargo[good as Good] = texCargo(good as Good);
    for (let uk = 0; uk < 2; uk++) {
      const kind: 'carrier' | 'soldier' = uk ? 'soldier' : 'carrier',
        dirs: Record<string, { walk: HTMLCanvasElement[]; idle: HTMLCanvasElement }> = {};
      ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].forEach(function (dir) {
        const frames = [];
        for (let uf = 0; uf < 8; uf++) frames.push(texDirectionalUnit(kind, dir, uf));
        dirs[dir] = { walk: frames, idle: texDirectionalUnit(kind, dir, -1) };
      });
      ART.unitDirections[kind] = dirs;
    }
    // soft shadows
    const sc = Acan(64, 32),
      sg = requireCanvas2D(sc, game.reportGraphicsFailure);
    sg.save();
    sg.scale(1, 0.5);
    const grd = sg.createRadialGradient(32, 32, 2, 32, 32, 30);
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
    const cc = Acan(340, 220),
      cg = requireCanvas2D(cc, game.reportGraphicsFailure);
    const cg2 = cg.createRadialGradient(170, 110, 10, 170, 110, 160);
    cg2.addColorStop(0, 'rgba(10,14,20,0.04)');
    cg2.addColorStop(0.55, 'rgba(10,14,20,0.025)');
    cg2.addColorStop(1, 'rgba(10,14,20,0)');
    cg.fillStyle = cg2;
    cg.beginPath();
    cg.ellipse(170, 110, 165, 105, 0, 0, 7);
    cg.fill();
    ART.cloud = cc;
    // stronger ground shadow for the terrain-level cloud pass (drawn SE of the sky blob)
    const csh = Acan(340, 220),
      csg = requireCanvas2D(csh, game.reportGraphicsFailure);
    const cg3 = csg.createRadialGradient(170, 110, 10, 170, 110, 160);
    cg3.addColorStop(0, 'rgba(8,12,18,0.14)');
    cg3.addColorStop(0.55, 'rgba(8,12,18,0.065)');
    cg3.addColorStop(1, 'rgba(8,12,18,0)');
    csg.fillStyle = cg3;
    csg.beginPath();
    csg.ellipse(170, 110, 165, 105, 0, 0, 7);
    csg.fill();
    ART.cloudShadow = csh;
    // warm lantern glow for night windows (drawn above the night tint)
    const gl1 = Acan(64, 64),
      glg = requireCanvas2D(gl1, game.reportGraphicsFailure);
    const gr2 = glg.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr2.addColorStop(0, 'rgba(255,196,110,0.85)');
    gr2.addColorStop(0.35, 'rgba(255,170,80,0.32)');
    gr2.addColorStop(1, 'rgba(255,150,60,0)');
    glg.fillStyle = gr2;
    glg.beginPath();
    glg.arc(32, 32, 31, 0, 7);
    glg.fill();
    ART.glow = gl1;
    // film grain for the DOM overlay
    const gc = Acan(96, 96),
      gg = requireCanvas2D(gc, game.reportGraphicsFailure),
      img = gg.createImageData(96, 96);
    for (let i = 0; i < img.data.length; i += 4) {
      const n2 = (Math.random() * 255) | 0;
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
  };
}

export interface ArtSubsystem {
  readonly SS: number;
  readonly ART: ArtAtlas;
  Acan: (w: number, h: number) => HTMLCanvasElement;
  rgba: (c: string, a: number) => string;
}
