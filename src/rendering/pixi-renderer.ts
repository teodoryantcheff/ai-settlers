import {
  Container,
  Graphics,
  Matrix,
  Rectangle,
  Sprite,
  Text,
  Texture,
  WebGLRenderer,
} from 'pixi.js';
import type { TextStyleOptions } from 'pixi.js';
import type { LayerName } from '../types.ts';
import type { GameRuntime } from '../runtime.ts';
import type { RendererPresentation } from './renderer.ts';
import { createPixiContext, type CapturedTextStyle, type DrawingState } from './pixi-context.ts';
import { createShadowQuad } from './pixi-shadows.ts';
import { createProductionAtmosphere } from './pixi-atmosphere.ts';
import { CanvasContextError, requireCanvas2D } from './canvas-context.ts';

interface ImagePart {
  texture: Texture;
  x: number;
  y: number;
  width: number;
  height: number;
  canvas?: HTMLCanvasElement;
  frames: Map<string, Texture>;
  viewport?: Texture;
  slot?: CommandSlot;
}
interface ImageEntry {
  width: number;
  height: number;
  parts: ImagePart[];
}
interface CommandSlot {
  root: Container;
  frame: number;
  sprite?: Sprite;
  graphics?: Graphics;
  text?: Text;
  shadow?: ReturnType<typeof createShadowQuad>;
  mask?: Graphics;
  clipKey?: string;
  textKey?: string;
}

interface CommandLayer {
  root: Container;
  slots: CommandSlot[];
  cursor: number;
  order: number;
}

/** Native GPU presentation of the production renderer's ordered draw commands.
 * A separate input surface retains the existing camera and interaction controls.
 * Artwork is uploaded once; cached terrain is refreshed only on invalidation.
 */
export async function createPixiRenderer() {
  const canvas = document.createElement('canvas');
  canvas.id = 'pixi-view';
  canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  const renderer = new WebGLRenderer();
  try {
    await renderer.init({
      canvas,
      width: 1,
      height: 1,
      resolution: 1,
      // The scene renders into the atmosphere pass's texture, so multisampling
      // would only smooth its full-screen quad.
      antialias: false,
      backgroundAlpha: 0,
      preserveDrawingBuffer: new URLSearchParams(location.search).has('capture'),
      powerPreference: 'high-performance',
    });
  } catch (error) {
    renderer.destroy({ removeView: true, releaseGlobalResources: true });
    throw error;
  }
  const maxTextureSize = renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE) as number;
  const maxRenderSize = Math.min(
    maxTextureSize,
    renderer.gl.getParameter(renderer.gl.MAX_RENDERBUFFER_SIZE),
  );
  const stage = new Container();
  stage.eventMode = 'none';
  stage.interactiveChildren = false;
  const scene = new Container();
  stage.addChild(scene);
  const atmosphere = createProductionAtmosphere(scene);
  const screenTint: [number, number, number, number] = [0, 0, 0, 0];
  const images = new Map<CanvasImageSource, ImageEntry>();
  const frames = new Set<Texture>();
  const cachedCanvases = new WeakSet<CanvasImageSource>();
  const slots: CommandSlot[] = [];
  const ownedSlot = new WeakMap<Container, CommandSlot>();
  const layers = new Map<LayerName, CommandLayer>();
  let activeLayer: CommandLayer;
  let frame = 0;
  let cursor = 0,
    nativeSprites = 0,
    nativeGraphics = 0,
    nativeTexts = 0;
  let spriteFrameUpdates = 0,
    textureUpdates = 0,
    partialTextureUpdates = 0,
    textureUploads = 0,
    gpuDestroyed = false,
    disposed = false;
  let game: GameRuntime;
  let renderError = '';
  // Reused per-frame temporaries; none may escape into retained state.
  const scratchM = new Matrix();
  const scratchFrame = new Rectangle();
  const fontCache = new Map<string, { fontSize: number; fontFamily: string; fontWeight: string }>();
  const statsObject: Record<string, unknown> = {};
  let scratchUploadCanvas: HTMLCanvasElement | null = null;
  let scratchUploadCtx: CanvasRenderingContext2D | null = null;

  function slot(kind: 'sprite' | 'graphics' | 'text' | 'shadow', dedicated?: ImagePart) {
    const index = activeLayer.cursor;
    let entry = dedicated ? dedicated.slot : activeLayer.slots[index];
    if (!entry) {
      entry = { root: new Container(), frame };
      slots.push(entry);
      if (dedicated) dedicated.slot = entry;
      else activeLayer.slots[index] = entry;
      activeLayer.root.addChild(entry.root);
    }
    if (!dedicated) activeLayer.cursor++;
    if (activeLayer.root.children[activeLayer.order] !== entry.root)
      activeLayer.root.setChildIndex(entry.root, activeLayer.order);
    activeLayer.order++;
    entry.frame = frame;
    cursor++;
    entry.root.visible = true;
    entry.root.mask = null;
    if (entry.mask) entry.mask.visible = false;
    if (entry.sprite) entry.sprite.visible = kind === 'sprite';
    if (entry.graphics) entry.graphics.visible = kind === 'graphics';
    if (entry.text) entry.text.visible = kind === 'text';
    if (entry.shadow) entry.shadow.mesh.visible = kind === 'shadow';
    return entry;
  }
  function clip(node: Container, rect?: { x: number; y: number; width: number; height: number }) {
    const entry = ownedSlot.get(node);
    if (!entry || !rect) return;
    if (!entry.mask) {
      entry.mask = new Graphics();
      entry.root.addChild(entry.mask);
    }
    const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
    if (key !== entry.clipKey) {
      entry.mask.clear().rect(rect.x, rect.y, rect.width, rect.height).fill(0xffffff);
      entry.clipKey = key;
    }
    entry.mask.visible = true;
    entry.root.mask = entry.mask;
  }
  function graphics() {
    const entry = slot('graphics');
    if (!entry.graphics) {
      entry.graphics = new Graphics();
      entry.root.addChild(entry.graphics);
      ownedSlot.set(entry.graphics, entry);
    }
    entry.graphics.visible = true;
    nativeGraphics++;
    return entry.graphics;
  }
  function baseTexture(source: CanvasImageSource) {
    let entry = images.get(source);
    if (entry) return entry;
    const width = Number(
      (source as any).naturalWidth || (source as any).videoWidth || (source as any).width,
    );
    const height = Number(
      (source as any).naturalHeight || (source as any).videoHeight || (source as any).height,
    );
    if (!width || !height) return null;
    entry = { width, height, parts: [] };
    // Older GPUs can still display the terrain cache through smaller texture tiles.
    const tileSize = Math.min(maxTextureSize, 2048);
    if (width > maxTextureSize || height > maxTextureSize) {
      for (let y = 0; y < height; y += tileSize)
        for (let x = 0; x < width; x += tileSize) {
          const part = document.createElement('canvas');
          part.width = Math.min(tileSize, width - x);
          part.height = Math.min(tileSize, height - y);
          requireCanvas2D(part, loseGpu).drawImage(
            source,
            x,
            y,
            part.width,
            part.height,
            0,
            0,
            part.width,
            part.height,
          );
          const texture = Texture.from(part, true);
          texture.source.scaleMode = 'linear';
          entry.parts.push({
            texture,
            x,
            y,
            width: part.width,
            height: part.height,
            canvas: part,
            frames: new Map(),
          });
          textureUploads++;
        }
    } else {
      const texture = Texture.from(source as any, true);
      texture.source.scaleMode = 'linear';
      entry.parts.push({ texture, x: 0, y: 0, width, height, frames: new Map() });
      textureUploads++;
    }
    images.set(source, entry);
    return entry;
  }
  function image(args: readonly unknown[], state: DrawingState, tint = 0xffffff) {
    const [source, ...values] = args as [CanvasImageSource, ...number[]];
    const base = baseTexture(source);
    if (!base) return;
    let sx = 0,
      sy = 0,
      sw = base.width,
      sh = base.height;
    let dx: number, dy: number, dw: number, dh: number;
    if (values.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = values;
    else if (values.length === 4) [dx, dy, dw, dh] = values;
    else {
      [dx, dy] = values;
      dw = sw;
      dh = sh;
    }
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0 || state.alpha <= 0) return;
    const t = state.transform;
    for (const part of base.parts) {
      const left = Math.max(sx, part.x),
        top = Math.max(sy, part.y);
      const right = Math.min(sx + sw, part.x + part.width),
        bottom = Math.min(sy + sh, part.y + part.height);
      if (right <= left || bottom <= top) continue;
      const entry = slot('sprite', cachedCanvases.has(source) ? part : undefined);
      if (!entry.sprite) {
        entry.sprite = new Sprite(Texture.EMPTY);
        entry.root.addChild(entry.sprite);
        ownedSlot.set(entry.sprite, entry);
      }
      const item = entry.sprite;
      scratchFrame.set(left - part.x, top - part.y, right - left, bottom - top);
      let texture: Texture;
      if (cachedCanvases.has(source)) {
        // These canvases are blitted once per frame. Their bounded, dedicated
        // views retain one source while the camera changes the crop rectangle.
        if (!part.viewport) {
          part.viewport = new Texture({
            source: part.texture.source,
            frame: scratchFrame,
            dynamic: true,
          });
          frames.add(part.viewport);
        } else if (
          part.viewport.frame.x !== scratchFrame.x ||
          part.viewport.frame.y !== scratchFrame.y ||
          part.viewport.frame.width !== scratchFrame.width ||
          part.viewport.frame.height !== scratchFrame.height
        ) {
          part.viewport.frame.copyFrom(scratchFrame);
          part.viewport.update();
          spriteFrameUpdates++;
        }
        texture = part.viewport;
      } else {
        const key = `${scratchFrame.x},${scratchFrame.y},${scratchFrame.width},${scratchFrame.height}`;
        const existing = part.frames.get(key);
        if (existing) texture = existing;
        else {
          texture = new Texture({ source: part.texture.source, frame: scratchFrame });
          part.frames.set(key, texture);
          frames.add(texture);
        }
      }
      if (item.texture !== texture) item.texture = texture;
      const x = dx + ((left - sx) / sw) * dw,
        y = dy + ((top - sy) / sh) * dh;
      item.setFromMatrix(
        scratchM.set(
          (t.a * dw) / sw,
          (t.b * dw) / sw,
          (t.c * dh) / sh,
          (t.d * dh) / sh,
          t.a * x + t.c * y + t.e,
          t.b * x + t.d * y + t.f,
        ),
      );
      item.alpha = state.alpha;
      item.tint = tint;
      item.blendMode =
        state.blendMode === 'lighter'
          ? 'add'
          : state.blendMode === 'multiply'
            ? 'multiply'
            : state.blendMode === 'screen'
              ? 'screen'
              : 'normal';
      item.visible = true;
      clip(item, state.clip);
      nativeSprites++;
    }
  }
  function text(
    value: string,
    x: number,
    y: number,
    style: CapturedTextStyle,
    state: DrawingState,
  ) {
    const entry = slot('text');
    if (!entry.text) {
      entry.text = new Text({ text: '', style: { fontSize: 12 } });
      entry.root.addChild(entry.text);
      ownedSlot.set(entry.text, entry);
    }
    const item = entry.text;
    const font = style.font || '12px sans-serif';
    let parsed = fontCache.get(font);
    if (!parsed) {
      const match = font.match(/(?:(\d{3}|bold|normal)\s+)?([\d.]+)px\s+(.+)/);
      parsed = {
        fontSize: match ? Number(match[2]) : 12,
        fontFamily: match?.[3] || 'sans-serif',
        fontWeight: match?.[1] || 'normal',
      };
      fontCache.set(font, parsed);
    }
    const fill = typeof style.fillStyle === 'string' ? style.fillStyle : '#ffffff';
    const stroke = style.stroke as { color: string; width: number } | undefined;
    const key = `${parsed.fontSize}|${parsed.fontFamily}|${parsed.fontWeight}|${fill}|${stroke?.color ?? ''}|${stroke?.width ?? ''}`;
    if (key !== entry.textKey) {
      const textStyle: TextStyleOptions = {
        fontSize: parsed.fontSize,
        fontFamily: parsed.fontFamily,
        fontWeight: parsed.fontWeight as TextStyleOptions['fontWeight'],
        fill,
        padding: 2,
        stroke,
      };
      item.style = textStyle;
      entry.textKey = key;
    }
    item.text = value;
    const resolution = Math.min(2, Math.max(1, game ? canvas.width / Math.max(1, game.vw) : 1));
    if (item.resolution !== resolution) item.resolution = resolution;
    item.anchor.set(
      style.align === 'center' ? 0.5 : style.align === 'right' || style.align === 'end' ? 1 : 0,
      style.baseline === 'middle'
        ? 0.5
        : style.baseline === 'top' || style.baseline === 'hanging'
          ? 0
          : style.baseline === 'bottom'
            ? 1
            : 0.8,
    );
    const t = state.transform;
    item.setFromMatrix(
      scratchM.set(t.a, t.b, t.c, t.d, t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f),
    );
    item.alpha = state.alpha;
    item.visible = true;
    clip(item, state.clip);
    nativeTexts++;
  }
  const commands = createPixiContext({ graphics, image, text, clip });

  function stats() {
    statsObject.backend = presentation.available ? 'PixiJS WebGL' : 'unavailable';
    statsObject.error = renderError;
    statsObject.nativeSprites = nativeSprites;
    statsObject.nativeGraphics = nativeGraphics;
    statsObject.nativeTexts = nativeTexts;
    statsObject.cachedTextures = images.size;
    statsObject.cachedFrames = frames.size;
    statsObject.textureUploads = textureUploads;
    statsObject.textureUpdates = textureUpdates;
    statsObject.partialTextureUpdates = partialTextureUpdates;
    statsObject.spriteFrameUpdates = spriteFrameUpdates;
    statsObject.graphicsBuilds = commands.graphicsBuilds;
    statsObject.commands = cursor;
    statsObject.resolution = game ? canvas.width / Math.max(1, game.vw) : 1;
    statsObject.maxTextureSize = maxTextureSize;
    (window as unknown as Record<string, unknown>)['productionRendererStats'] = statsObject;
  }
  function loseGpu(reason: string) {
    if (!presentation.available) return;
    presentation.available = false;
    renderError = reason;
    canvas.style.display = 'none';
    // Presentation reports the failure; the HUD owns pausing the colony.
    if (game && typeof game.emitGameEvent === 'function')
      game.emitGameEvent('rendererFailed', { reason });
    document.documentElement.dataset.renderer = 'unavailable';
    if (!game?.showGraphicsRecovery) {
      const status = document.createElement('div');
      status.id = 'renderer-status';
      status.setAttribute('role', 'alert');
      status.textContent =
        'Graphics stopped: ' + reason + '. WebGL is required. Reload to resume play.';
      document.body.append(status);
    }
    stats();
    queueMicrotask(destroyGpu);
  }
  const onContextLost = (event: Event) => {
    event.preventDefault();
    loseGpu('WebGL context lost');
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  function destroyGpu() {
    if (gpuDestroyed) return;
    gpuDestroyed = true;
    canvas.removeEventListener('webglcontextlost', onContextLost);
    commands.destroy();
    atmosphere.destroy();
    stage.destroy({ children: true });
    for (const entry of slots) entry.shadow?.destroy();
    for (const frame of frames) frame.destroy(false);
    frames.clear();
    for (const entry of images.values()) for (const part of entry.parts) part.texture.destroy(true);
    images.clear();
    renderer.destroy({ removeView: true, releaseGlobalResources: true });
  }
  function guardGraphics(work: () => void) {
    if (disposed || !presentation.available) return;
    try {
      work();
    } catch (error) {
      loseGpu(error instanceof Error ? error.message : 'WebGL draw failed');
    }
  }
  /** Upload only a dirty sub-region of a cached texture straight to the GPU.
   * Returns false when the fast path is unavailable; the caller then falls back
   * to a full source update. (ix/iy are part-relative, which equals source
   * coordinates for both single sources and the canvases of tiled sources.)
   */
  function partialUpload(
    part: ImagePart,
    source: CanvasImageSource,
    ix: number,
    iy: number,
    iw: number,
    ih: number,
  ) {
    try {
      const textureSource = part.texture.source;
      if ((textureSource as any).resource !== source || textureSource.mipLevelCount > 1)
        return false;
      if (!scratchUploadCanvas || !scratchUploadCtx) {
        scratchUploadCanvas = document.createElement('canvas');
        scratchUploadCtx = requireCanvas2D(scratchUploadCanvas, loseGpu, {
          willReadFrequently: true,
        });
      }
      const scratch = scratchUploadCanvas;
      const g = scratchUploadCtx;
      const w = Math.max(1, Math.round(iw)),
        h = Math.max(1, Math.round(ih));
      if (scratch.width !== w) scratch.width = w;
      if (scratch.height !== h) scratch.height = h;
      g.clearRect(0, 0, w, h);
      g.drawImage(source, ix, iy, iw, ih, 0, 0, w, h);
      const sys = renderer.texture as any;
      if (!sys || typeof sys.getGlSource !== 'function') return false;
      // getGlSource initialises the GPU texture (performing the initial full
      // upload) on first use, so prior content is valid before texSubImage2D.
      const glTexture = sys.getGlSource(textureSource);
      const gl = renderer.gl;
      if (glTexture.target !== gl.TEXTURE_2D) return false;
      sys.bindSource(textureSource, 0);
      // Match onSourceUpdate's unpack state and keep Pixi's private cache truthful.
      const premult = textureSource.alphaMode === 'premultiply-alpha-on-upload';
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premult);
      try {
        sys._premultiplyAlpha = premult;
      } catch {}
      const resolution = textureSource.resolution;
      gl.texSubImage2D(
        glTexture.target,
        0,
        Math.round(ix * resolution),
        Math.round(iy * resolution),
        glTexture.format,
        glTexture.type,
        scratch,
      );
      partialTextureUpdates++;
      return true;
    } catch (error) {
      if (error instanceof CanvasContextError) throw error;
      return false;
    }
  }
  const presentation: RendererPresentation = {
    available: true,
    shadowLayer(cast, contacts, ctx, castOpacity, contactOpacity) {
      const casts = baseTexture(cast),
        roots = baseTexture(contacts);
      if (!casts || !roots) return;
      const t = ctx.getTransform();
      casts.parts.forEach((part, i) => {
        const root = roots.parts[i];
        if (!root) return;
        const entry = slot('shadow', part);
        if (!entry.shadow) {
          entry.shadow = createShadowQuad(part.texture, root.texture, part.width, part.height);
          entry.root.addChild(entry.shadow.mesh);
        }
        const mesh = entry.shadow.mesh;
        mesh.visible = true;
        mesh.setFromMatrix(
          scratchM.set(
            t.a,
            t.b,
            t.c,
            t.d,
            t.e + part.x * t.a + part.y * t.c,
            t.f + part.x * t.b + part.y * t.d,
          ),
        );
        entry.shadow.update(castOpacity, contactOpacity);
        nativeSprites++;
      });
    },
    reportFailure: loseGpu,
    screenTint(tint) {
      for (let i = 0; i < 4; i++) screenTint[i] = tint[i];
    },
    invalidate(source, rect?: { x: number; y: number; width: number; height: number }) {
      cachedCanvases.add(source);
      guardGraphics(() => {
        const entry = images.get(source);
        if (!entry) return;
        for (const part of entry.parts) {
          if (rect) {
            // Only the intersection of the dirty rect with this part's region.
            const left = Math.max(rect.x, part.x),
              top = Math.max(rect.y, part.y);
            const right = Math.min(rect.x + rect.width, part.x + part.width),
              bottom = Math.min(rect.y + rect.height, part.y + part.height);
            if (right <= left || bottom <= top) continue;
            const iw = right - left,
              ih = bottom - top,
              ix = left - part.x,
              iy = top - part.y;
            if (part.canvas) {
              // Tiled path (huge canvases on old GPUs): replace transparent
              // pixels too, then upload only this part's changed region.
              const g = requireCanvas2D(part.canvas, loseGpu);
              g.clearRect(ix, iy, iw, ih);
              g.drawImage(source, left, top, iw, ih, ix, iy, iw, ih);
              if (!partialUpload(part, part.canvas, ix, iy, iw, ih)) {
                part.texture.source.update();
                textureUpdates++;
              }
            } else if (!partialUpload(part, source, ix, iy, iw, ih)) {
              part.texture.source.update();
              textureUpdates++;
            }
            continue;
          }
          if (part.canvas) {
            const g = requireCanvas2D(part.canvas, loseGpu);
            g.clearRect(0, 0, part.width, part.height);
            g.drawImage(
              source,
              part.x,
              part.y,
              part.width,
              part.height,
              0,
              0,
              part.width,
              part.height,
            );
          }
          part.texture.source.update();
          textureUpdates++;
        }
      });
    },
    begin(ctx) {
      guardGraphics(() => {
        cursor = nativeSprites = nativeGraphics = nativeTexts = 0;
        frame++;
        for (const layer of layers.values()) layer.cursor = layer.order = 0;
        commands.beginFrame();
        if (ctx.canvas.width > maxRenderSize || ctx.canvas.height > maxRenderSize)
          loseGpu('Viewport exceeds GPU render-target limits');
        if (!presentation.available) return;
        if (renderer.width !== ctx.canvas.width || renderer.height !== ctx.canvas.height)
          renderer.resize(ctx.canvas.width, ctx.canvas.height);
        canvas.style.width = ctx.canvas.style.width;
        canvas.style.height = ctx.canvas.style.height;
      });
    },
    layer(name, ctx, paint) {
      guardGraphics(() => {
        let layer = layers.get(name);
        if (!layer) {
          layer = { root: new Container(), slots: [], cursor: 0, order: 0 };
          layers.set(name, layer);
          // Lantern glows, rain and captions sit above the veiled, graded scene.
          (name === 'above-atmosphere' ? stage : scene).addChild(layer.root);
        }
        activeLayer = layer;
        commands.capture(ctx, paint);
      });
    },
    end() {
      if (!presentation.available || disposed) {
        stats();
        return;
      }
      for (const entry of slots) if (entry.frame !== frame) entry.root.visible = false;
      guardGraphics(() => {
        atmosphere.update(game, renderer.width, renderer.height, screenTint);
        renderer.render({ container: stage });
        atmosphere.afterRender();
        commands.endFrame();
      });
      stats();
    },
  };
  return {
    presentation,
    canvas,
    attach(runtime: GameRuntime) {
      game = runtime;
      game.view.after(canvas);
      game.view.style.opacity = '0';
      stats();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      presentation.available = false;
      destroyGpu();
      canvas.remove();
    },
  };
}
