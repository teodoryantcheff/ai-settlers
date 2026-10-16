import { FillGradient, Graphics, Matrix } from 'pixi.js';
import type { Container } from 'pixi.js';

export interface DrawingTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}
export interface DrawingClip {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface DrawingState {
  transform: DrawingTransform;
  alpha: number;
  blendMode: GlobalCompositeOperation;
  clip?: DrawingClip;
}
export interface CapturedTextStyle {
  font: string;
  fillStyle: string;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  stroke?: { color: string; width: number };
}
export interface PixiContextSink {
  /** Return a reusable, visible Graphics inserted at the current draw-order cursor. */
  graphics(): Graphics;
  /** args is the complete Canvas drawImage argument list, including its image:
   * a source followed by 0, 4 or 8 numeric arguments (the overload soup). */
  image(args: readonly unknown[], state: DrawingState): void;
  text(value: string, x: number, y: number, style: CapturedTextStyle, state: DrawingState): void;
  clip?(node: Container, bounds?: DrawingClip): void;
}
type PathCommand = { name: string; args: number[]; transform: DrawingTransform };
type GradientInfo = {
  type: 'linear' | 'radial';
  args: number[];
  transform: DrawingTransform;
  stops: { offset: number; color: string }[];
};

function matrix(t: DrawingTransform) {
  return new Matrix(t.a, t.b, t.c, t.d, t.e, t.f);
}
// Scratch matrices for the per-command relative transforms in pathKey, replay
// and dashed. Every use completes synchronously before the next begins, so
// module-level reuse avoids allocations without risking cross-call aliasing.
const scratchInverse = new Matrix();
const scratchCommand = new Matrix();
const scratchRelative = new Matrix();

/**
 * Structural equality for geometry cache keys: nested arrays, small plain
 * style objects, and primitives. NaN simply mismatches and forces a rebuild.
 */
function keyEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!keyEquals(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const names = Object.keys(a);
    if (names.length !== Object.keys(b).length) return false;
    for (const name of names) {
      if (!Object.prototype.hasOwnProperty.call(b, name)) return false;
      if (!keyEquals((a as Record<string, unknown>)[name], (b as Record<string, unknown>)[name]))
        return false;
    }
    return true;
  }
  return false;
}
function blend(operation: GlobalCompositeOperation) {
  if (operation === 'lighter') return 'add';
  if (operation === 'multiply') return 'multiply';
  if (operation === 'screen') return 'screen';
  return 'normal';
}

/**
 * Record the existing imperative painters as ordered native GPU primitives.
 * Canvas is used for state/measurement only during capture: no frame pixels are
 * painted, read back, copied to a texture, or uploaded by this adapter.
 */
export function createPixiContext(sink: PixiContextSink) {
  const gradients = new WeakMap<CanvasGradient, GradientInfo>();
  const ramps = new Map<string, { fill: FillGradient; lastFrame: number }>();
  const geometryKeys = new WeakMap<Graphics, unknown[]>();
  let graphicsBuilds = 0;
  let frame = 0;
  let path: PathCommand[] = [];
  let clip: DrawingClip | undefined;
  const clipStack: (DrawingClip | undefined)[] = [];
  // Self-tracked Canvas transform, kept truthful by the transform intercepts
  // below so snapshots no longer allocate a DOMMatrix via ctx.getTransform().
  const current: DrawingTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const transformStack: DrawingTransform[] = [];
  // Growable pool of snapshot objects, reset at each capture() start. Pooling
  // is safe because every consumer (pathKey rounding, replay, dashed, clip
  // bounds, sink image/text) reads the values within the same capture.
  const transformPool: DrawingTransform[] = [];
  let transformPoolSize = 0;

  function copyTransform(target: DrawingTransform, source: DrawingTransform) {
    target.a = source.a;
    target.b = source.b;
    target.c = source.c;
    target.d = source.d;
    target.e = source.e;
    target.f = source.f;
    return target;
  }
  function snapshot(): DrawingTransform {
    let item = transformPool[transformPoolSize];
    if (!item) {
      item = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      transformPool[transformPoolSize] = item;
    }
    transformPoolSize++;
    return copyTransform(item, current);
  }

  function state(ctx: CanvasRenderingContext2D): DrawingState {
    return {
      transform: snapshot(),
      alpha: ctx.globalAlpha,
      blendMode: ctx.globalCompositeOperation,
      clip,
    };
  }
  function paintStyle(style: string | CanvasGradient | CanvasPattern, transform: DrawingTransform) {
    if (typeof style === 'string') return style;
    const info = gradients.get(style as CanvasGradient);
    if (!info) return '#ffffff';
    // Express the ramp in the same local coordinates as the native Graphics.
    const relative = matrix(transform).invert().append(matrix(info.transform));
    const args = info.args;
    const point = (x: number, y: number) => relative.apply({ x, y });
    const a = point(args[0], args[1]);
    const b = info.type === 'linear' ? point(args[2], args[3]) : point(args[3], args[4]);
    const scale = Math.sqrt(Math.abs(relative.a * relative.d - relative.b * relative.c));
    const coordinates =
      info.type === 'linear'
        ? [a.x, a.y, b.x, b.y]
        : [a.x, a.y, args[2] * scale, b.x, b.y, args[5] * scale];
    const key = JSON.stringify([
      info.type,
      coordinates.map((v) => Math.round(v * 100) / 100),
      info.stops,
    ]);
    let cached = ramps.get(key);
    if (!cached) {
      const options = {
        textureSpace: 'global' as const,
        textureSize: info.type === 'radial' ? 64 : 32,
        colorStops: info.stops.length ? info.stops : [{ offset: 0, color: '#ffffff' }],
      };
      const fill =
        info.type === 'linear'
          ? new FillGradient({ type: 'linear', start: a, end: b, ...options })
          : new FillGradient({
              type: 'radial',
              center: a,
              innerRadius: Math.max(0, coordinates[2]),
              outerCenter: b,
              outerRadius: Math.max(0.001, coordinates[5]),
              ...options,
            });
      cached = { fill, lastFrame: frame };
      ramps.set(key, cached);
    }
    cached.lastFrame = frame;
    return cached.fill;
  }
  function graphic(ctx: CanvasRenderingContext2D) {
    const item = sink.graphics();
    const current = state(ctx);
    item.setFromMatrix(matrix(current.transform));
    item.alpha = current.alpha;
    item.blendMode = blend(current.blendMode);
    sink.clip?.(item, current.clip);
    return { item, current };
  }
  function material(style: string | FillGradient, item: Graphics) {
    // Opacity is display state. Fading an otherwise unchanged solid paint must
    // never change its geometry/material cache key.
    if (typeof style !== 'string') return style;
    const rgba = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(
      style,
    );
    if (!rgba) return style;
    item.alpha *= Number(rgba[4]);
    return `rgb(${rgba[1]},${rgba[2]},${rgba[3]})`;
  }
  function geometry(item: Graphics, key: unknown[], draw: () => void) {
    if (keyEquals(geometryKeys.get(item), key)) return;
    item.clear();
    draw();
    geometryKeys.set(item, key);
    graphicsBuilds++;
  }
  function pathKey(commands: PathCommand[], transform: DrawingTransform) {
    scratchInverse
      .set(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f)
      .invert();
    return commands.map((command) => {
      const t = command.transform;
      scratchCommand.set(t.a, t.b, t.c, t.d, t.e, t.f);
      const relative = scratchRelative.copyFrom(scratchInverse).append(scratchCommand);
      return [
        command.name,
        command.args,
        // Camera movement only updates the scene transform; it must not rebuild
        // geometry because of floating-point noise in the relative transform.
        [relative.a, relative.b, relative.c, relative.d, relative.tx, relative.ty].map(
          (v) => Math.round(v * 1e8) / 1e8,
        ),
      ];
    });
  }
  function styleKey(style: string | FillGradient) {
    return typeof style === 'string' ? style : style.uid;
  }
  function replay(item: Graphics, commands: PathCommand[], transform: DrawingTransform) {
    scratchInverse
      .set(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f)
      .invert();
    for (const command of commands) {
      const t = command.transform;
      scratchCommand.set(t.a, t.b, t.c, t.d, t.e, t.f);
      const relative = scratchRelative.copyFrom(scratchInverse).append(scratchCommand);
      item.context.setTransform(
        relative.a,
        relative.b,
        relative.c,
        relative.d,
        relative.tx,
        relative.ty,
      );
      const a = command.args;
      switch (command.name) {
        case 'moveTo':
          item.moveTo(a[0], a[1]);
          break;
        case 'lineTo':
          item.lineTo(a[0], a[1]);
          break;
        case 'quadraticCurveTo':
          item.quadraticCurveTo(a[0], a[1], a[2], a[3]);
          break;
        case 'bezierCurveTo':
          item.bezierCurveTo(a[0], a[1], a[2], a[3], a[4], a[5]);
          break;
        case 'arc':
          if (a[2] > 0) item.arc(a[0], a[1], a[2], a[3], a[4], !!a[5]);
          break;
        case 'arcTo':
          item.arcTo(a[0], a[1], a[2], a[3], a[4]);
          break;
        case 'rect':
          item.rect(a[0], a[1], a[2], a[3]);
          break;
        case 'roundRect':
          item.roundRect(a[0], a[1], a[2], a[3], a[4]);
          break;
        case 'ellipse': {
          // Canvas allows rotation and partial ellipses; Pixi's ellipse primitive
          // is axis aligned, so retain these shapes as a native tessellated path.
          let sweep = a[6] - a[5];
          const full = Math.abs(sweep) >= Math.PI * 2;
          if (full) sweep = (a[7] ? -1 : 1) * Math.PI * 2;
          else if (a[7] && sweep > 0) sweep -= Math.PI * 2;
          else if (!a[7] && sweep < 0) sweep += Math.PI * 2;
          const steps = Math.max(12, Math.ceil(Math.abs(sweep) * 8));
          for (let i = 0; i <= steps; i++) {
            const theta = a[5] + (sweep * i) / steps;
            const x =
              a[0] +
              Math.cos(theta) * a[2] * Math.cos(a[4]) -
              Math.sin(theta) * a[3] * Math.sin(a[4]);
            const y =
              a[1] +
              Math.cos(theta) * a[2] * Math.sin(a[4]) +
              Math.sin(theta) * a[3] * Math.cos(a[4]);
            if (i === 0) item.moveTo(x, y);
            else item.lineTo(x, y);
          }
          if (full) item.closePath();
          break;
        }
        case 'closePath':
          item.closePath();
          break;
      }
    }
    item.context.resetTransform();
  }
  function dashed(
    commands: PathCommand[],
    transform: DrawingTransform,
    dash: number[],
    offset: number,
  ) {
    commands = commands.flatMap((command) => {
      if (command.name !== 'arc') return [command];
      const a = command.args;
      let sweep = a[4] - a[3];
      if (Math.abs(sweep) >= Math.PI * 2) sweep = (a[5] ? -1 : 1) * Math.PI * 2;
      else if (a[5] && sweep > 0) sweep -= Math.PI * 2;
      else if (!a[5] && sweep < 0) sweep += Math.PI * 2;
      const count = Math.max(12, Math.ceil((Math.abs(sweep) * a[2]) / 2));
      return Array.from({ length: count + 1 }, (_, i) => ({
        name: i ? 'lineTo' : 'moveTo',
        args: [
          a[0] + Math.cos(a[3] + (sweep * i) / count) * a[2],
          a[1] + Math.sin(a[3] + (sweep * i) / count) * a[2],
        ],
        transform: command.transform,
      }));
    });
    if (commands.some((p) => !['moveTo', 'lineTo', 'closePath'].includes(p.name))) return commands;
    scratchInverse
      .set(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f)
      .invert();
    const result: PathCommand[] = [];
    const pattern = dash.length % 2 ? [...dash, ...dash] : dash;
    const total = pattern.reduce((a, b) => a + b, 0);
    if (total <= 0) return commands;
    let from: { x: number; y: number } | undefined;
    let first: { x: number; y: number } | undefined;
    let phase = ((offset % total) + total) % total;
    let index = 0;
    while (phase >= pattern[index] && index < pattern.length - 1) phase -= pattern[index++];
    let remaining = pattern[index] - phase;
    const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    for (const command of commands) {
      const t = command.transform;
      scratchCommand.set(t.a, t.b, t.c, t.d, t.e, t.f);
      const relative = scratchRelative.copyFrom(scratchInverse).append(scratchCommand);
      const to =
        command.name === 'closePath'
          ? first
          : relative.apply({ x: command.args[0], y: command.args[1] });
      if (!to) continue;
      if (command.name === 'moveTo' || !from) {
        from = to;
        first = to;
        continue;
      }
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      for (let distance = 0; distance < length - 0.0001;) {
        const end = Math.min(length, distance + remaining);
        if (index % 2 === 0) {
          const a = { x: from.x + (dx * distance) / length, y: from.y + (dy * distance) / length };
          const b = { x: from.x + (dx * end) / length, y: from.y + (dy * end) / length };
          result.push({ name: 'moveTo', args: [a.x, a.y], transform: identity });
          result.push({ name: 'lineTo', args: [b.x, b.y], transform: identity });
        }
        remaining -= end - distance;
        distance = end;
        if (remaining <= 0.0001) {
          index = (index + 1) % pattern.length;
          remaining = Math.max(0.001, pattern[index]);
        }
      }
      from = to;
    }
    // The generated coordinates are already relative to the Graphics node.
    return result.map((p) => ({ ...p, transform }));
  }

  function capture(ctx: CanvasRenderingContext2D, paint: () => void) {
    const originals = new Map<string, { own: boolean; value: unknown }>();
    path = [];
    clip = undefined;
    clipStack.length = 0;
    // One real DOMMatrix read per capture seeds the self-tracked transform.
    copyTransform(current, ctx.getTransform());
    transformStack.length = 0;
    transformPoolSize = 0;
    // Documented exception: intercepting Canvas2D methods with heterogeneous
    // signatures at the capture boundary (erased here; narrowed per call site).
    function intercept(name: string, method: (...args: any[]) => any) {
      originals.set(name, {
        own: Object.prototype.hasOwnProperty.call(ctx, name),
        value: (ctx as unknown as Record<string, unknown>)[name],
      });
      (ctx as unknown as Record<string, unknown>)[name] = method;
    }
    const originalSave = ctx.save;
    const originalRestore = ctx.restore;
    intercept('save', () => {
      clipStack.push(clip);
      transformStack.push(snapshot());
      originalSave.call(ctx);
    });
    intercept('restore', () => {
      clip = clipStack.pop();
      const stacked = transformStack.pop();
      if (stacked) copyTransform(current, stacked);
      originalRestore.call(ctx);
    });
    // Mirror every Canvas transform mutation into `current` (Canvas post-
    // multiplies) while forwarding to the original, so native state — and any
    // painter calling ctx.getTransform() itself — stays truthful. Like the
    // native methods, non-finite arguments leave the transform untouched.
    const originalTranslate = ctx.translate;
    intercept('translate', (x, y) => {
      originalTranslate.call(ctx, x, y);
      x = Number(x);
      y = Number(y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        current.e += current.a * x + current.c * y;
        current.f += current.b * x + current.d * y;
      }
    });
    const originalScale = ctx.scale;
    intercept('scale', (x, y) => {
      originalScale.call(ctx, x, y);
      x = Number(x);
      y = y === undefined ? x : Number(y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        current.a *= x;
        current.b *= x;
        current.c *= y;
        current.d *= y;
      }
    });
    const originalRotate = ctx.rotate;
    intercept('rotate', (r) => {
      originalRotate.call(ctx, r);
      r = Number(r);
      if (Number.isFinite(r)) {
        const cos = Math.cos(r);
        const sin = Math.sin(r);
        const { a, b, c, d } = current;
        current.a = a * cos + c * sin;
        current.b = b * cos + d * sin;
        current.c = c * cos - a * sin;
        current.d = d * cos - b * sin;
      }
    });
    const originalTransform = ctx.transform;
    intercept('transform', (a2, b2, c2, d2, e2, f2) => {
      originalTransform.call(ctx, a2, b2, c2, d2, e2, f2);
      const values = [a2, b2, c2, d2, e2, f2].map(Number);
      if (values.every(Number.isFinite)) {
        const [m2, n2, o2, p2, q2, r2] = values;
        const { a, b, c, d, e, f } = current;
        current.a = a * m2 + c * n2;
        current.b = b * m2 + d * n2;
        current.c = a * o2 + c * p2;
        current.d = b * o2 + d * p2;
        current.e = a * q2 + c * r2 + e;
        current.f = b * q2 + d * r2 + f;
      }
    });
    const originalSetTransform = ctx.setTransform;
    intercept('setTransform', (...args) => {
      originalSetTransform.apply(ctx, args);
      const first = args[0];
      let values: number[];
      if (args.length === 0) values = [1, 0, 0, 1, 0, 0];
      else if (typeof first === 'object' && first !== null)
        // DOMMatrix / DOMMatrix2DInit overload; absent members default to identity.
        values = [
          first.a ?? 1,
          first.b ?? 0,
          first.c ?? 0,
          first.d ?? 1,
          first.e ?? 0,
          first.f ?? 0,
        ].map(Number);
      else values = args.map(Number);
      if (values.every(Number.isFinite))
        [current.a, current.b, current.c, current.d, current.e, current.f] = values;
    });
    const originalResetTransform = ctx.resetTransform;
    intercept('resetTransform', () => {
      originalResetTransform.call(ctx);
      current.a = 1;
      current.b = 0;
      current.c = 0;
      current.d = 1;
      current.e = 0;
      current.f = 0;
    });
    intercept('beginPath', () => {
      path = [];
    });
    for (const name of [
      'moveTo',
      'lineTo',
      'quadraticCurveTo',
      'bezierCurveTo',
      'arc',
      'arcTo',
      'rect',
      'roundRect',
      'ellipse',
      'closePath',
    ]) {
      intercept(name, (...args) => {
        path.push({ name, args: args.map(Number), transform: snapshot() });
      });
    }
    intercept('fill', () => {
      if (!path.length || ctx.globalAlpha <= 0) return;
      const { item, current } = graphic(ctx);
      const style = material(paintStyle(ctx.fillStyle, current.transform), item);
      geometry(item, ['fill', pathKey(path, current.transform), styleKey(style)], () => {
        replay(item, path, current.transform);
        item.fill(style);
      });
    });
    intercept('stroke', () => {
      if (!path.length || ctx.globalAlpha <= 0 || ctx.lineWidth <= 0) return;
      const dash = ctx.getLineDash();
      if (ctx.shadowBlur > 0 && ctx.shadowColor !== 'rgba(0, 0, 0, 0)') {
        // Two soft, transparent native strokes retain the selection glow without
        // rasterizing or attaching a costly blur filter to every primitive.
        for (const spread of [1, 0.5]) {
          const { item: glow, current: glowState } = graphic(ctx);
          const scale = Math.max(
            0.01,
            Math.sqrt(
              Math.abs(
                glowState.transform.a * glowState.transform.d -
                  glowState.transform.b * glowState.transform.c,
              ),
            ),
          );
          glow.alpha *= spread === 1 ? 0.08 : 0.16;
          const style = {
            color: ctx.shadowColor,
            width: ctx.lineWidth + (ctx.shadowBlur * spread) / scale,
            cap: ctx.lineCap,
            join: ctx.lineJoin,
          };
          geometry(glow, ['glow', pathKey(path, glowState.transform), style], () => {
            replay(glow, path, glowState.transform);
            glow.stroke(style);
          });
        }
      }
      const { item, current } = graphic(ctx);
      const strokes = dash.length
        ? dashed(path, current.transform, dash, ctx.lineDashOffset)
        : path;
      const style = material(paintStyle(ctx.strokeStyle, current.transform), item);
      const options = {
        ...(typeof style === 'string' ? { color: style } : { fill: style }),
        width: ctx.lineWidth,
        cap: ctx.lineCap,
        join: ctx.lineJoin,
        miterLimit: ctx.miterLimit,
      };
      geometry(
        item,
        [
          'stroke',
          pathKey(strokes, current.transform),
          styleKey(style),
          ctx.lineWidth,
          ctx.lineCap,
          ctx.lineJoin,
          ctx.miterLimit,
        ],
        () => {
          replay(item, strokes, current.transform);
          item.stroke(options);
        },
      );
    });
    intercept('fillRect', (x, y, width, height) => {
      if (!width || !height || ctx.globalAlpha <= 0) return;
      const { item, current } = graphic(ctx);
      const style = material(paintStyle(ctx.fillStyle, current.transform), item);
      geometry(item, ['fillRect', x, y, width, height, styleKey(style)], () => {
        item.rect(x, y, width, height).fill(style);
      });
    });
    intercept('strokeRect', (x, y, width, height) => {
      const { item, current } = graphic(ctx);
      const style = material(paintStyle(ctx.strokeStyle, current.transform), item);
      geometry(item, ['strokeRect', x, y, width, height, styleKey(style), ctx.lineWidth], () => {
        item.rect(x, y, width, height).stroke({
          ...(typeof style === 'string' ? { color: style } : { fill: style }),
          width: ctx.lineWidth,
        });
      });
    });
    intercept('clearRect', () => {});
    intercept('drawImage', (...args) => {
      if (ctx.globalAlpha > 0) sink.image(args, state(ctx));
    });
    for (const name of ['fillText', 'strokeText']) {
      intercept(name, (value, x, y) => {
        sink.text(
          String(value),
          x,
          y,
          {
            font: ctx.font,
            fillStyle: typeof ctx.fillStyle === 'string' ? ctx.fillStyle : '#ffffff',
            align: ctx.textAlign,
            baseline: ctx.textBaseline,
            ...(name === 'strokeText'
              ? {
                  stroke: {
                    color: typeof ctx.strokeStyle === 'string' ? ctx.strokeStyle : '#000000',
                    width: ctx.lineWidth,
                  },
                }
              : {}),
          },
          state(ctx),
        );
      });
    }
    intercept('clip', () => {
      // All dynamic production clips are world rectangles. Store their physical
      // intersection for an optional native mask supplied by the scene presenter.
      const rectangles = path.filter((command) => command.name === 'rect');
      if (!rectangles.length) return;
      const bounds = rectangles.map((command) => {
        const m = matrix(command.transform);
        const [x, y, w, h] = command.args;
        const points = [
          m.apply({ x, y }),
          m.apply({ x: x + w, y }),
          m.apply({ x, y: y + h }),
          m.apply({ x: x + w, y: y + h }),
        ];
        const left = Math.min(...points.map((p) => p.x));
        const top = Math.min(...points.map((p) => p.y));
        return {
          x: left,
          y: top,
          width: Math.max(...points.map((p) => p.x)) - left,
          height: Math.max(...points.map((p) => p.y)) - top,
        };
      });
      for (const boundsItem of bounds) {
        if (!clip) clip = boundsItem;
        else {
          const x = Math.max(clip.x, boundsItem.x);
          const y = Math.max(clip.y, boundsItem.y);
          clip = {
            x,
            y,
            width: Math.max(0, Math.min(clip.x + clip.width, boundsItem.x + boundsItem.width) - x),
            height: Math.max(
              0,
              Math.min(clip.y + clip.height, boundsItem.y + boundsItem.height) - y,
            ),
          };
        }
      }
    });
    for (const type of ['linear', 'radial'] as const) {
      const name = type === 'linear' ? 'createLinearGradient' : 'createRadialGradient';
      const original = ctx[name];
      intercept(name, (...args) => {
        const gradient: CanvasGradient = original.apply(ctx, args);
        // GradientInfo persists in `gradients` across frames, so its transform
        // must be an owning copy rather than a pooled per-capture snapshot.
        const info: GradientInfo = { type, args, transform: { ...current }, stops: [] };
        gradients.set(gradient, info);
        const add = gradient.addColorStop.bind(gradient);
        gradient.addColorStop = (offset, color) => {
          add(offset, color);
          info.stops.push({ offset, color });
        };
        return gradient;
      });
    }
    try {
      paint();
    } finally {
      for (const [name, original] of originals) {
        if (original.own) (ctx as unknown as Record<string, unknown>)[name] = original.value;
        else delete (ctx as unknown as Record<string, unknown>)[name];
      }
      path = [];
      clip = undefined;
      clipStack.length = 0;
    }
  }
  return {
    capture,
    get graphicsBuilds() {
      return graphicsBuilds;
    },
    beginFrame() {
      frame++;
    },
    endFrame() {
      // Keep common material ramps alive; prune transient highlights after two
      // seconds at 60fps, only after rendering so active GPU resources are safe.
      for (const [key, entry] of ramps) {
        if (frame - entry.lastFrame > 120) {
          entry.fill.destroy();
          ramps.delete(key);
        }
      }
    },
    destroy() {
      for (const entry of ramps.values()) entry.fill.destroy();
      ramps.clear();
    },
  };
}
