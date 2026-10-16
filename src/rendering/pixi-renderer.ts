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
import type { GameRuntime } from '../runtime.ts';
import type { RendererPresentation } from './renderer.ts';
import { createPixiContext, type CapturedTextStyle, type DrawingState } from './pixi-context.ts';
import { createProductionAtmosphere } from './pixi-atmosphere.ts';
import { CanvasContextError, requireCanvas2D } from './canvas-context.ts';

interface ImagePart {
  texture: Texture;
  x: number;
  y: number;
  width: number;
  height: number;
  canvas?: HTMLCanvasElement;
}
interface ImageEntry {
  width: number;
  height: number;
  parts: ImagePart[];
}
interface CommandSlot {
  root: Container;
  sprite?: Sprite;
  graphics?: Graphics;
  text?: Text;
  mask?: Graphics;
  clipKey?: string;
  textKey?: string;
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
      antialias: true,
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
  const images = new Map<CanvasImageSource, ImageEntry>();
  const frames = new Set<Texture>();
  const slots: CommandSlot[] = [];
  const ownedSlot = new WeakMap<Container, CommandSlot>();
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
  const scratchShadowM = new Matrix();
  const scratchShadowCamM = new Matrix();
  const scratchFrame = new Rectangle();
  const shadowState: DrawingState = {
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    alpha: 0,
    blendMode: 'source-over',
  };
  const fontCache = new Map<string, { fontSize: number; fontFamily: string; fontWeight: string }>();
  const statsObject: Record<string, unknown> = {};
  let scratchUploadCanvas: HTMLCanvasElement | null = null;
  let scratchUploadCtx: CanvasRenderingContext2D | null = null;

  function slot(kind: 'sprite' | 'graphics' | 'text') {
    let entry = slots[cursor];
    if (!entry) {
      entry = { root: new Container() };
      slots[cursor] = entry;
      scene.addChild(entry.root);
    }
    cursor++;
    entry.root.visible = true;
    entry.root.mask = null;
    if (entry.mask) entry.mask.visible = false;
    if (entry.sprite) entry.sprite.visible = kind === 'sprite';
    if (entry.graphics) entry.graphics.visible = kind === 'graphics';
    if (entry.text) entry.text.visible = kind === 'text';
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
          entry.parts.push({ texture, x, y, width: part.width, height: part.height, canvas: part });
          textureUploads++;
        }
    } else {
      const texture = Texture.from(source as any, true);
      texture.source.scaleMode = 'linear';
      entry.parts.push({ texture, x: 0, y: 0, width, height });
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
      const entry = slot('sprite');
      if (!entry.sprite) {
        entry.sprite = new Sprite(Texture.EMPTY);
        entry.root.addChild(entry.sprite);
        ownedSlot.set(entry.sprite, entry);
      }
      const item = entry.sprite;
      if (item.texture === Texture.EMPTY) {
        // The constructor copies the frame, so the scratch rect is safe here.
        scratchFrame.set(left - part.x, top - part.y, right - left, bottom - top);
        item.texture = new Texture({
          source: part.texture.source,
          frame: scratchFrame,
          dynamic: true,
        });
        frames.add(item.texture);
      } else {
        let changed = false;
        if (item.texture.source !== part.texture.source) {
          item.texture.source = part.texture.source;
          changed = true;
        }
        if (
          item.texture.frame.x !== left - part.x ||
          item.texture.frame.y !== top - part.y ||
          item.texture.frame.width !== right - left ||
          item.texture.frame.height !== bottom - top
        ) {
          Object.assign(item.texture.frame, {
            x: left - part.x,
            y: top - part.y,
            width: right - left,
            height: bottom - top,
          });
          spriteFrameUpdates++;
          changed = true;
        }
        if (changed) item.texture.update();
      }
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

  function shadows(ctx: CanvasRenderingContext2D) {
    if (!game) return;
    const night = game.nightAmt();
    const cool = night < 0.45 ? 0 : (night - 0.45) / 0.55;
    const alpha = game.renderPrefs().clarity
      ? 0.06
      : 0.17 * (1 - cool) * (1 - game.rainAmt() * 0.8);
    if (alpha < 0.02) return;
    const t = ctx.getTransform();
    const x0 = Math.max(0, Math.floor(game.cam.x / game.TS) - 3),
      x1 = Math.min(game.W - 1, Math.ceil((game.cam.x + game.vw / game.z) / game.TS) + 1),
      y0 = Math.max(0, Math.floor(game.cam.y / game.TS) - 3),
      y1 = Math.min(game.H - 1, Math.ceil((game.cam.y + game.vh / game.z) / game.TS) + 1);
    function project(
      source: CanvasImageSource,
      x: number,
      y: number,
      dx: number,
      dy: number,
      w: number,
      h: number,
    ) {
      const m = scratchShadowM.set(1, 0, -0.64, -0.38, x, y);
      m.prepend(scratchShadowCamM.set(t.a, t.b, t.c, t.d, t.e, t.f));
      const st = shadowState.transform;
      st.a = m.a;
      st.b = m.b;
      st.c = m.c;
      st.d = m.d;
      st.e = m.tx;
      st.f = m.ty;
      shadowState.alpha = alpha;
      image([source, dx, dy, w, h], shadowState, 0x243c33);
    }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const tile = game.tiles[game.idx(x, y)];
        if (!tile.tree) continue;
        const hash = game.tileHash(game.idx(x, y));
        const scale = 0.87 + ((hash >> 3) % 15) / 100;
        const width = 38 * scale,
          height = 46 * scale;
        project(
          game.ART.tree[tile.tree - 1][hash % 3][0],
          x * game.TS + 10.5 + ((hash >> 2) % 7) - 3,
          y * game.TS + 28.5 + ((hash >> 5) % 5) - 2,
          -width / 2,
          -height,
          width,
          height,
        );
      }
    for (const building of game.buildings) {
      if (
        !building.done ||
        building.x < x0 ||
        building.x > x1 ||
        building.y < y0 ||
        building.y > y1
      )
        continue;
      const art = game.bldImg(building);
      if (art)
        project(
          art.img,
          building.x * game.TS + 12,
          building.y * game.TS + 22,
          art.ox - 12,
          art.oy - 22,
          art.w,
          art.h,
        );
    }
  }
  function stats() {
    statsObject.backend = presentation.available ? 'PixiJS WebGL' : 'unavailable';
    statsObject.error = renderError;
    statsObject.nativeSprites = nativeSprites;
    statsObject.nativeGraphics = nativeGraphics;
    statsObject.nativeTexts = nativeTexts;
    statsObject.cachedTextures = images.size;
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
    reportFailure: loseGpu,
    invalidate(source, rect?: { x: number; y: number; width: number; height: number }) {
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
        if (name === 'ground-effects') shadows(ctx);
        commands.capture(ctx, paint);
      });
    },
    end() {
      if (!presentation.available || disposed) {
        stats();
        return;
      }
      for (let i = cursor; i < slots.length; i++) slots[i].root.visible = false;
      guardGraphics(() => {
        atmosphere.update(game, renderer.width, renderer.height);
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
