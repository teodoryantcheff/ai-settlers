import { createNativeObject, type NativeObject } from './native-object.ts';
import {
  CanvasTextMetrics,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
  WebGLRenderer,
} from 'pixi.js';
import type { TextStyleOptions } from 'pixi.js';
import type { LayerName } from '../types.ts';
import type { GameRuntime } from '../runtime.ts';
import type {
  RendererPresentation,
  SceneLayer,
  SceneRect,
  SceneTextStyle,
  SceneView,
} from './scene.ts';
import { createShadowQuad } from './pixi-shadows.ts';
import { createProductionAtmosphere } from './pixi-atmosphere.ts';
import { requireCanvas2D } from './canvas-context.ts';

/** One GPU texture of a cached canvas; huge canvases split into tiles on old GPUs. */
interface CanvasPart {
  texture: Texture;
  x: number;
  y: number;
  width: number;
  height: number;
  canvas?: HTMLCanvasElement;
  viewport?: Texture;
  sprite?: Sprite;
  shadow?: ReturnType<typeof createShadowQuad>;
}
interface CachedCanvas {
  width: number;
  height: number;
  parts: CanvasPart[];
}
interface LayerState {
  root: Container;
  groups: Map<object, LayerState>;
  runs: Graphics[];
  masks: (Graphics | undefined)[];
  texts: Text[];
  textKeys: string[];
  runCursor: number;
  textCursor: number;
  /** Child index for the next object placed this frame. */
  order: number;
  open: Graphics | null;
  batchObjects: boolean;
  clip: SceneRect | null;
}

/** Native GPU presentation of the production renderer's ordered scene layers.
 * World layers sit under the camera transform; backdrop and overlay use screen pixels.
 * A separate input surface retains the existing camera and interaction controls.
 * Artwork is uploaded once; cached terrain is refreshed only on invalidation.
 */
export async function createPixiRenderer(internals?: PixiRendererInternals) {
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
  // Large invalidated canvases (terrain, borders, shadow planes).
  const canvases = new Map<CanvasImageSource, CachedCanvas>();
  // Prepared offscreen artwork, uploaded once, plus its frame views.
  const artwork = new Map<CanvasImageSource, Texture>();
  const frames = new Map<CanvasImageSource, Map<string, Texture>>();
  const layers = new Map<LayerName, LayerState>();
  const owners = new Map<object, NativeObject>();
  let retainedUpdates = 0,
    frame = 0;
  const placedFrame = new WeakMap<Container, number>();
  const ownerRoots = new WeakSet<Container>();
  const textStyles = new Map<string, TextStyle>();
  const view: SceneView = {
    width: 1,
    height: 1,
    cssWidth: 1,
    cssHeight: 1,
    dpr: 1,
    scale: 1,
    camX: 0,
    camY: 0,
  };
  let nativeSprites = 0,
    nativeGraphics = 0,
    nativeTexts = 0,
    graphicsBuilds = 0,
    spriteFrameUpdates = 0,
    textureUpdates = 0,
    partialTextureUpdates = 0,
    textureUploads = 0,
    gpuDestroyed = false,
    disposed = false;
  let game: GameRuntime | undefined;
  let renderError = '';
  const scratchFrame = new Rectangle();
  const statsObject: Record<string, unknown> = {};
  let scratchUploadCanvas: HTMLCanvasElement | null = null;
  let scratchUploadCtx: CanvasRenderingContext2D | null = null;

  /** Place a node at this layer's draw-order cursor for the current frame. */
  function place(layer: LayerState, node: Container) {
    // Sort once after painting instead of repeatedly splicing thousands of
    // unchanged owners when a moving unit splits an immediate Graphics run.
    if (node.parent !== layer.root) layer.root.addChild(node);
    node.zIndex = layer.order++;
    placedFrame.set(node, frame);
    node.visible = true;
  }
  function openRun(layer: LayerState): Graphics {
    const index = layer.runCursor++;
    let run = layer.runs[index];
    if (!run) layer.runs[index] = run = new Graphics();
    else run.clear();
    if (layer.batchObjects) run.context.batchMode = 'batch';
    place(layer, run);
    if (layer.clip) {
      let mask = layer.masks[index];
      if (!mask) {
        mask = layer.masks[index] = new Graphics();
        layer.root.addChild(mask);
      }
      const { x, y, width, height } = layer.clip;
      mask.clear().rect(x, y, width, height).fill(0xffffff);
      mask.visible = true;
      run.mask = mask;
    } else {
      // A detached Pixi mask renders as an ordinary shape again.
      run.mask = null;
      const mask = layer.masks[index];
      if (mask) mask.visible = false;
    }
    nativeGraphics++;
    graphicsBuilds++;
    layer.open = run;
    return run;
  }
  function makeLayer(batchObjects: boolean, isRenderGroup = false): LayerState {
    return {
      root: new Container({ sortableChildren: true, isRenderGroup }),
      groups: new Map(),
      runs: [],
      masks: [],
      texts: [],
      textKeys: [],
      runCursor: 0,
      textCursor: 0,
      order: 0,
      open: null,
      clip: null,
      batchObjects,
    };
  }
  function resetLayer(layer: LayerState) {
    layer.runCursor = layer.textCursor = layer.order = 0;
    layer.open = null;
    layer.clip = null;
    for (const [key, group] of layer.groups) {
      if (!group.root.children.length) {
        group.root.destroy({ children: true });
        layer.groups.delete(key);
      } else resetLayer(group);
    }
  }
  function finishLayer(layer: LayerState) {
    for (const child of layer.root.children) {
      if (placedFrame.get(child) !== frame && !layer.masks.includes(child as Graphics))
        child.visible = false;
    }
    for (const [key, group] of layer.groups) {
      if (placedFrame.get(group.root) === frame) finishLayer(group);
      else {
        // Cull the batch, not its owners. Detached owned geometry can be placed
        // again without retaining old moving-object identities/render groups.
        discardGroup(group);
        layer.groups.delete(key);
      }
    }
  }
  function discardGroup(group: LayerState) {
    for (const child of group.groups.values()) discardGroup(child);
    for (const child of group.root.removeChildren())
      if (!ownerRoots.has(child)) child.destroy({ children: true });
    group.root.destroy({ children: true });
  }
  function closeRun(layer: LayerState) {
    layer.open = null;
  }
  function cachedCanvas(source: CanvasImageSource) {
    let entry = canvases.get(source);
    if (entry) return entry;
    const width = Number((source as HTMLCanvasElement).width);
    const height = Number((source as HTMLCanvasElement).height);
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
          entry.parts.push({ texture, x, y, width: part.width, height: part.height, canvas: part });
          textureUploads++;
        }
    } else {
      const texture = Texture.from(source as HTMLCanvasElement, true);
      texture.source.scaleMode = 'linear';
      entry.parts.push({ texture, x: 0, y: 0, width, height });
      textureUploads++;
    }
    canvases.set(source, entry);
    return entry;
  }
  function texture(source: CanvasImageSource, region?: SceneRect): Texture {
    let base = artwork.get(source);
    if (!base) {
      base = Texture.from(source as HTMLCanvasElement, true);
      base.source.scaleMode = 'linear';
      artwork.set(source, base);
      textureUploads++;
    }
    if (!region) return base;
    let views = frames.get(source);
    if (!views) frames.set(source, (views = new Map()));
    const key = `${region.x},${region.y},${region.width},${region.height}`;
    let framed = views.get(key);
    if (!framed) {
      scratchFrame.set(region.x, region.y, region.width, region.height);
      framed = new Texture({ source: base.source, frame: scratchFrame });
      views.set(key, framed);
    }
    return framed;
  }
  function layerScene(layer: LayerState): SceneLayer {
    return {
      get g() {
        return layer.open || openRun(layer);
      },
      texture,
      group(key, paint) {
        closeRun(layer);
        let group = layer.groups.get(key);
        if (!group) layer.groups.set(key, (group = makeLayer(true, true)));
        if (placedFrame.get(group.root) === frame)
          throw new Error('Native batch must be one contiguous span per frame');
        place(layer, group.root);
        paint(layerScene(group));
        closeRun(group);
      },
      retain(key, paint) {
        closeRun(layer);
        let owner = owners.get(key);
        if (!owner) {
          if (!paint) throw new Error('Native owner must be prepared before placement');
          owners.set(key, (owner = createNativeObject(texture, () => graphicsBuilds++)));
          ownerRoots.add(owner.root);
        }
        if (paint) {
          owner.update(paint);
          retainedUpdates++;
        }
        place(layer, owner.root);
        nativeSprites += owner.imageCount;
        nativeGraphics += owner.graphicsCount;
      },
      image(source, x, y, width, height, alpha = 1, region) {
        if (alpha <= 0 || width <= 0 || height <= 0) return;
        const run = layer.open || openRun(layer);
        run.setFillStyle({ alpha });
        run.texture(texture(source, region), 0xffffff, x, y, width, height);
        nativeSprites++;
      },
      blit(source, sx, sy, sw, sh, dx, dy, dw, dh) {
        const base = cachedCanvas(source);
        if (!base || sw <= 0 || sh <= 0) return;
        closeRun(layer);
        for (const part of base.parts) {
          const left = Math.max(sx, part.x),
            top = Math.max(sy, part.y);
          const right = Math.min(sx + sw, part.x + part.width),
            bottom = Math.min(sy + sh, part.y + part.height);
          if (right <= left || bottom <= top) continue;
          scratchFrame.set(left - part.x, top - part.y, right - left, bottom - top);
          // These canvases are blitted once per frame. Their bounded, dedicated
          // views retain one source while the camera changes the crop rectangle.
          if (!part.viewport) {
            part.viewport = new Texture({
              source: part.texture.source,
              frame: scratchFrame,
              dynamic: true,
            });
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
          if (!part.sprite) part.sprite = new Sprite(part.viewport);
          const sprite = part.sprite;
          sprite.x = dx + ((left - sx) / sw) * dw;
          sprite.y = dy + ((top - sy) / sh) * dh;
          sprite.scale.set(dw / sw, dh / sh);
          place(layer, sprite);
          nativeSprites++;
        }
      },
      shadows(cast, contacts, castOpacity, contactOpacity) {
        const casts = cachedCanvas(cast),
          roots = cachedCanvas(contacts);
        if (!casts || !roots) return;
        closeRun(layer);
        casts.parts.forEach((part, i) => {
          const root = roots.parts[i];
          if (!root) return;
          if (!part.shadow)
            part.shadow = createShadowQuad(part.texture, root.texture, part.width, part.height);
          part.shadow.mesh.position.set(part.x, part.y);
          part.shadow.update(castOpacity, contactOpacity);
          place(layer, part.shadow.mesh);
          nativeSprites++;
        });
      },
      text(value, x, y, style) {
        closeRun(layer);
        const index = layer.textCursor++;
        let item = layer.texts[index];
        if (!item) layer.texts[index] = item = new Text({ text: '', style: { fontSize: 12 } });
        const key = style.font + '|' + style.fill;
        if (layer.textKeys[index] !== key) {
          item.style = textStyle(style);
          layer.textKeys[index] = key;
        }
        if (item.text !== value) item.text = value;
        const resolution = Math.min(2, Math.max(1, view.dpr));
        if (item.resolution !== resolution) item.resolution = resolution;
        item.anchor.set(
          style.align === 'center' ? 0.5 : style.align === 'right' ? 1 : 0,
          style.baseline === 'middle' ? 0.5 : 0.8,
        );
        item.position.set(x, y);
        item.scale.set(style.scale ?? 1);
        place(layer, item);
        nativeTexts++;
      },
      measureText(value, font) {
        return CanvasTextMetrics.measureText(value, textStyle({ font, fill: '#fff' })).width;
      },
      clip(rect) {
        closeRun(layer);
        layer.clip = rect || null;
      },
    };
  }
  function textStyle(style: SceneTextStyle): TextStyle {
    const key = style.font + '|' + style.fill;
    let cached = textStyles.get(key);
    if (!cached) {
      const match = style.font.match(/(?:(\d{3}|bold|normal)\s+)?([\d.]+)px\s+(.+)/);
      const options: TextStyleOptions = {
        fontSize: match ? Number(match[2]) : 12,
        fontFamily: match?.[3] || 'sans-serif',
        fontWeight: (match?.[1] || 'normal') as TextStyleOptions['fontWeight'],
        fill: style.fill,
        padding: 2,
      };
      textStyles.set(key, (cached = new TextStyle(options)));
    }
    return cached;
  }
  function stats() {
    statsObject.backend = presentation.available ? 'PixiJS WebGL' : 'unavailable';
    statsObject.error = renderError;
    statsObject.nativeSprites = nativeSprites;
    statsObject.nativeGraphics = nativeGraphics;
    statsObject.nativeTexts = nativeTexts;
    statsObject.cachedTextures = artwork.size + canvases.size;
    statsObject.cachedFrames = [...frames.values()].reduce((n, views) => n + views.size, 0);
    statsObject.textureUploads = textureUploads;
    statsObject.textureUpdates = textureUpdates;
    statsObject.partialTextureUpdates = partialTextureUpdates;
    statsObject.spriteFrameUpdates = spriteFrameUpdates;
    statsObject.graphicsBuilds = graphicsBuilds;
    statsObject.retainedOwners = owners.size;
    statsObject.retainedUpdates = retainedUpdates;
    statsObject.commands = nativeSprites + nativeGraphics + nativeTexts;
    statsObject.resolution = view.dpr;
    statsObject.maxTextureSize = maxTextureSize;
    (window as unknown as Record<string, unknown>)['productionRendererStats'] = statsObject;
  }
  function loseGpu(reason: string) {
    if (!presentation.available) return;
    presentation.available = false;
    renderError = reason;
    canvas.style.display = 'none';
    // Presentation reports the failure; the HUD owns pausing the colony.
    game?.emitGameEvent('rendererFailed', { reason });
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
    atmosphere.destroy();
    for (const owner of owners.values()) owner.root.destroy({ children: true });
    owners.clear();
    stage.destroy({ children: true });
    for (const style of textStyles.values()) style.destroy();
    for (const views of frames.values()) for (const framed of views.values()) framed.destroy(false);
    for (const base of artwork.values()) base.destroy(true);
    for (const entry of canvases.values())
      for (const part of entry.parts) {
        part.shadow?.destroy();
        part.viewport?.destroy(false);
        part.texture.destroy(true);
      }
    frames.clear();
    artwork.clear();
    canvases.clear();
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
   * Pixi has no public sub-image upload, so this reaches its GL texture system.
   */
  function partialUpload(
    part: CanvasPart,
    source: CanvasImageSource,
    ix: number,
    iy: number,
    iw: number,
    ih: number,
  ) {
    const textureSource = part.texture.source;
    if (textureSource.resource !== source || textureSource.mipLevelCount > 1) return false;
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
    const textures = renderer.texture;
    // getGlSource initialises the GPU texture (performing the initial full
    // upload) on first use, so prior content is valid before texSubImage2D.
    const glTexture = textures.getGlSource(textureSource);
    const gl = renderer.gl;
    if (glTexture.target !== gl.TEXTURE_2D) return false;
    textures.bindSource(textureSource, 0);
    // Match onSourceUpdate's unpack state and keep Pixi's private cache truthful.
    // Bracket access to the private member stays type-checked across Pixi upgrades.
    const premultiply = textureSource.alphaMode === 'premultiply-alpha-on-upload';
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    textures['_premultiplyAlpha'] = premultiply;
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
  }
  const presentation: RendererPresentation = {
    available: true,
    reportFailure: loseGpu,
    screenTint(tint) {
      for (let i = 0; i < 4; i++) screenTint[i] = tint[i];
    },
    invalidate(source, rect) {
      guardGraphics(() => {
        const entry = canvases.get(source);
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
            }
            if (!partialUpload(part, part.canvas || source, ix, iy, iw, ih)) {
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
    release(key) {
      guardGraphics(() => {
        const owner = owners.get(key);
        if (owner) {
          owner.root.destroy({ children: true });
          owners.delete(key);
        }
      });
    },
    begin(next) {
      guardGraphics(() => {
        nativeSprites = nativeGraphics = nativeTexts = 0;
        frame++;
        Object.assign(view, next);
        if (view.width > maxRenderSize || view.height > maxRenderSize)
          loseGpu('Viewport exceeds GPU render-target limits');
        if (!presentation.available) return;
        if (renderer.width !== view.width || renderer.height !== view.height)
          renderer.resize(view.width, view.height);
        canvas.style.width = view.cssWidth + 'px';
        canvas.style.height = view.cssHeight + 'px';
        for (const layer of layers.values()) resetLayer(layer);
      });
    },
    layer(name, paint) {
      guardGraphics(() => {
        let layer = layers.get(name);
        if (!layer) {
          layer = makeLayer(name === 'objects');
          layers.set(name, layer);
          // Lantern glows, rain and captions sit above the veiled, graded scene.
          (name === 'above-atmosphere' || name === 'overlay' ? stage : scene).addChild(layer.root);
        }
        if (name === 'backdrop' || name === 'overlay') {
          layer.root.scale.set(view.dpr);
          layer.root.position.set(0, 0);
        } else {
          layer.root.scale.set(view.scale);
          layer.root.position.set(-view.camX * view.scale, -view.camY * view.scale);
        }
        paint(layerScene(layer));
        closeRun(layer);
      });
    },
    end() {
      const runtime = game;
      if (!presentation.available || disposed || !runtime) {
        stats();
        return;
      }
      guardGraphics(() => {
        // Objects not placed this frame stay pooled but hidden.
        for (const layer of layers.values()) finishLayer(layer);
        atmosphere.update(runtime, renderer.width, renderer.height, screenTint);
        renderer.render({ container: stage });
        atmosphere.afterRender();
      });
      stats();
    },
  };
  if (internals) Object.assign(internals, { presentation, owners, renderer });
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

/** Test-only closure access, supplied by development boot only. */
export interface PixiRendererInternals {
  presentation: RendererPresentation;
  owners: Map<object, NativeObject>;
  renderer: WebGLRenderer;
}
