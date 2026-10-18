import type { Graphics, Texture } from 'pixi.js';
import type { LayerName } from '../types.ts';

/** Premultiplied [r, g, b, alpha], each 0..1. */
export type PremultipliedTint = readonly [number, number, number, number];

export interface SceneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One frame's backing size and camera. Layers draw in world pixels;
 * device = (world - cam) * scale, where scale is devicePixelRatio × zoom. */
export interface SceneView {
  width: number;
  height: number;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  scale: number;
  camX: number;
  camY: number;
}

export interface SceneTextStyle {
  /** CSS font shorthand, e.g. `600 11px system-ui,sans-serif`. */
  font: string;
  fill: string;
  align?: 'left' | 'center' | 'right';
  baseline?: 'alphabetic' | 'middle';
  /** World units per text pixel: 1/zoom keeps labels screen-sized. */
  scale?: number;
}

/** Stable local artwork prepared by an explicit owner update. */
export interface SceneObject {
  /** The open Graphics run. Text, blits, shadows and clips start a new run after
   * them, so read this again after calling any of those. */
  readonly g: Graphics;
  /** Uploaded once: a prepared offscreen artwork canvas, or one frame of it. */
  texture(source: CanvasImageSource, frame?: SceneRect): Texture;
  /** Draw prepared artwork at the current local transform. */
  image(
    source: CanvasImageSource,
    x: number,
    y: number,
    width: number,
    height: number,
    alpha?: number,
    frame?: SceneRect,
  ): void;
}

/** One ordered layer of native Pixi primitives drawn in world pixels. */
export interface SceneLayer extends SceneObject {
  /** A stable contiguous batch with independently retained GPU instructions.
   * Use one per static span between moving objects, never one per sprite. */
  group(key: object, paint: (scene: SceneLayer) => void): void;
  /** Place a stable owner in this frame's depth order. Supply paint only to
   * create/update its geometry; omit it to reuse the prepared native view. */
  retain(owner: object, paint?: (scene: SceneObject) => void): void;
  /** Show a source rectangle of a large cached canvas (terrain, borders) through
   * a dedicated, bounded crop view. */
  blit(
    source: HTMLCanvasElement,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  /** Composite the two world-space shadow planes in one quad. */
  shadows(
    cast: HTMLCanvasElement,
    contacts: HTMLCanvasElement,
    castOpacity: number,
    contactOpacity: number,
  ): void;
  text(value: string, x: number, y: number, style: SceneTextStyle): void;
  /** Unscaled pixel width of `value` in `font`. */
  measureText(value: string, font: string): number;
  /** Mask following runs to a world rectangle; call without one to stop. */
  clip(rect?: SceneRect): void;
}

export interface RendererPresentation {
  available: boolean;
  /** Surface observer/cache failures through the same visible GPU failure boundary. */
  reportFailure?: (reason: string) => void;
  /** Refresh the GPU copy of a cached canvas. `rect` (canvas pixels) limits the
   * upload to the changed region; omitting it refreshes the whole canvas. */
  invalidate: (canvas: HTMLCanvasElement, rect?: SceneRect) => void;
  /** Release an owner after removal/world replacement, outside a layer paint. */
  release: (owner: object) => void;
  begin: (view: SceneView) => void;
  layer: (name: LayerName, paint: (scene: SceneLayer) => void) => void;
  end: () => void;
  /** Premultiplied screen-space veil the atmosphere pass applies before grading. */
  screenTint?: (tint: PremultipliedTint) => void;
}

// Pixi's translateTransform/scaleTransform/rotateTransform compose in parent
// space. These compose in the current local space, as nested drawing expects.
export function translate(g: Graphics, x: number, y: number): Graphics {
  return g.transform(1, 0, 0, 1, x, y);
}
export function scale(g: Graphics, x: number, y = x): Graphics {
  return g.transform(x, 0, 0, y, 0, 0);
}
export function rotate(g: Graphics, angle: number): Graphics {
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  return g.transform(cos, sin, -sin, cos, 0, 0);
}

/** Points around a circle, for dashed outlines. */
export function circlePoints(x: number, y: number, radius: number): number[] {
  const count = Math.max(24, Math.ceil(radius)),
    points = [];
  for (let i = 0; i <= count; i++) {
    const angle = (i / count) * Math.PI * 2;
    points.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  return points;
}

/** Add the dashes of a polyline ([x0, y0, x1, y1, …]) to the current path.
 * Pixi strokes have no dash pattern; `offset` shifts it like lineDashOffset. */
export function dashed(
  g: Graphics,
  points: readonly number[],
  on: number,
  off: number,
  offset = 0,
): Graphics {
  const period = on + off;
  if (period <= 0 || points.length < 4) return g;
  const phase = ((offset % period) + period) % period;
  let drawing = phase < on,
    remaining = drawing ? on - phase : period - phase;
  for (let i = 2; i < points.length; i += 2) {
    const x0 = points[i - 2],
      y0 = points[i - 1],
      dx = points[i] - x0,
      dy = points[i + 1] - y0,
      length = Math.hypot(dx, dy);
    let at = 0;
    while (at < length - 1e-6) {
      const end = Math.min(length, at + remaining);
      if (drawing) {
        g.moveTo(x0 + (dx * at) / length, y0 + (dy * at) / length);
        g.lineTo(x0 + (dx * end) / length, y0 + (dy * end) / length);
      }
      remaining -= end - at;
      at = end;
      if (remaining <= 1e-6) {
        drawing = !drawing;
        remaining = drawing ? on : off;
      }
    }
  }
  return g;
}
