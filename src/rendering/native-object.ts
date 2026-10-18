import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { SceneObject, SceneRect } from './scene.ts';

/** Geometry owned by one stable scene identity. Updating this view never clears
 * another owner's geometry; the enclosing layer supplies camera and depth order. */
export function createNativeObject(
  texture: (source: CanvasImageSource, frame?: SceneRect) => Texture,
  built: () => void,
) {
  const root = new Container();
  const sprites: Sprite[] = [],
    graphics: Graphics[] = [];
  let imageCount = 0,
    images = 0,
    shapes = 0,
    order = 0,
    open: Graphics | null = null;
  function place(node: Container) {
    if (node.parent !== root) root.addChildAt(node, order);
    else if (root.children[order] !== node) root.setChildIndex(node, order);
    order++;
    node.visible = true;
  }
  const scene: SceneObject = {
    texture,
    get g() {
      if (open) return open;
      let shape = graphics[shapes++];
      if (!shape) {
        graphics[shapes - 1] = shape = new Graphics();
        shape.context.batchMode = 'batch';
      } else shape.clear();
      place(shape);
      built();
      return (open = shape);
    },
    image(source, x, y, width, height, alpha = 1, frame) {
      if (alpha <= 0 || width <= 0 || height <= 0) return;
      imageCount++;
      const prepared = texture(source, frame);
      // Once vector drawing starts, keep subsequent images in that context so
      // its save/restore, transforms and interleaving retain Graphics semantics.
      if (open) {
        open.setFillStyle({ alpha });
        open.texture(prepared, 0xffffff, x, y, width, height);
        return;
      }
      let sprite = sprites[images++];
      if (!sprite) sprites[images - 1] = sprite = new Sprite(prepared);
      else if (sprite.texture !== prepared) sprite.texture = prepared;
      sprite.position.set(x, y);
      sprite.width = width;
      sprite.height = height;
      sprite.alpha = alpha;
      place(sprite);
    },
  };
  return {
    root,
    sprites,
    graphics,
    get imageCount() {
      return imageCount;
    },
    get graphicsCount() {
      return shapes;
    },
    update(paint: (scene: SceneObject) => void) {
      imageCount = images = shapes = order = 0;
      open = null;
      paint(scene);
      for (let i = order; i < root.children.length; i++) root.children[i].visible = false;
    },
  };
}
export type NativeObject = ReturnType<typeof createNativeObject>;
