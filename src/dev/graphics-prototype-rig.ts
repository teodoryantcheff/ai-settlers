/** Throwaway painted cutout rig. Local feet are inverse-kinematic targets;
 * stance moves backwards exactly as far as the display root moves forwards. */
import { translate, rotate, scale, type SceneLayer } from '../rendering/scene.ts';

type Point = { x: number; y: number };
export type CarrierParts = Record<
  'torso' | 'upperArm' | 'forearm' | 'thigh' | 'shin' | 'boot' | 'crate',
  HTMLCanvasElement
>;

export function paintCarrier(
  s: SceneLayer,
  parts: CarrierParts,
  x: number,
  y: number,
  distance: number,
  facing: number,
  loaded: boolean,
  treatment: number,
  working = false,
  tool?: 'saw' | 'poker',
) {
  const g = s.g;
  g.save();
  translate(g, x, y);
  scale(g, facing, 1);
  const stride = treatment === 2 && loaded ? 9 : 12;
  const phase = (((distance / stride) % 1) + 1) % 1;
  const bob = working ? 0 : Math.cos(phase * Math.PI * 4) * (treatment === 0 ? 0.12 : 0.28);
  const hip: Point = { x: 0, y: (working ? -11 : -10.7) + bob };
  function segment(
    image: HTMLCanvasElement,
    from: Point,
    to: Point,
    width: number,
    left: number,
    alpha = 1,
  ) {
    g.save();
    translate(g, from.x, from.y);
    rotate(g, Math.atan2(to.y - from.y, to.x - from.x) - Math.PI / 2);
    s.image(image, left, -0.4, width, Math.hypot(to.x - from.x, to.y - from.y) + 1.1, alpha);
    g.restore();
  }
  function leg(offset: number, far: boolean) {
    const p = (phase + offset) % 1;
    const swing = Math.max(0, (p - 0.6) / 0.4);
    const foot: Point = working
      ? { x: far ? -2 : 2, y: -0.8 }
      : {
          x:
            p < 0.6
              ? stride * (0.3 - p)
              : stride * (-0.3 + 0.6 * (swing * swing * (3 - 2 * swing))),
          y: -0.8 - Math.sin(swing * Math.PI) * (loaded ? 1.1 : 1.8),
        };
    const dx = foot.x - hip.x,
      dy = foot.y - hip.y,
      d = Math.hypot(dx, dy);
    const length = 5.2;
    const bend = Math.sqrt(Math.max(0, length * length - (d * d) / 4));
    const knee = {
      x: (hip.x + foot.x) / 2 + (dy / d) * bend,
      y: (hip.y + foot.y) / 2 - (dx / d) * bend,
    };
    segment(parts.thigh, hip, knee, 2.8, -1.4, far ? 0.8 : 1);
    segment(parts.shin, knee, foot, 2.6, -1.3, far ? 0.8 : 1);
    s.image(parts.boot, foot.x - 1.5, foot.y - 0.7, 4.8, 1.9, far ? 0.8 : 1);
  }
  const shoulder = { x: -1.8, y: -16 + bob };
  function arm(far: boolean) {
    const swing = Math.sin(phase * Math.PI * 2) * (far ? -1 : 1);
    const elbow = loaded
      ? { x: 1.7, y: -12.4 + bob }
      : working
        ? { x: 2, y: -13 + bob }
        : { x: shoulder.x + swing * 1.1, y: -12.7 + bob };
    const hand = loaded
      ? { x: 4.3, y: -12 + bob }
      : working
        ? { x: 4 + Math.sin(distance) * 0.7, y: -16.5 + Math.cos(distance) * 0.15 }
        : { x: shoulder.x + swing * 2, y: -10 + bob };
    if (working && !far && tool) {
      const tip =
        tool === 'saw' ? { x: hand.x + 5, y: hand.y + 0.4 } : { x: hand.x + 5, y: hand.y - 4 };
      g.moveTo(hand.x, hand.y)
        .lineTo(tip.x, tip.y)
        .stroke({
          color: tool === 'saw' ? 0xb7b7a7 : 0x514c42,
          width: tool === 'saw' ? 0.7 : 0.45,
        });
      if (tool === 'saw')
        for (let k = 1; k < 5; k++)
          g.moveTo(hand.x + k, hand.y + 0.15)
            .lineTo(hand.x + k - 0.3, hand.y + 0.8)
            .stroke({ color: 0xa2a393, width: 0.3 });
      g.circle(hand.x, hand.y, 0.55).stroke({ color: 0x795132, width: 0.45 });
    }
    segment(parts.upperArm, shoulder, elbow, 2.6, -1.3, far ? 0.8 : 1);
    segment(parts.forearm, elbow, hand, 1.8, -0.65, far ? 0.8 : 1);
  }
  leg(0.5, true);
  arm(true);
  leg(0, false);
  g.save();
  translate(g, 0, bob);
  rotate(g, treatment === 2 && loaded ? 0.06 : 0);
  s.image(parts.torso, -4.4, -23, 8.2, 14.5);
  g.restore();
  if (loaded) s.image(parts.crate, 0.7, -14 + bob, 6.5, 5);
  arm(false);
  g.restore();
}
