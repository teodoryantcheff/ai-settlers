# Reaching 60 fps at every zoom

Measured on 2026-10-16 on the reference laptop: Intel Core i7-8550U (4C/8T, 15 W), Intel UHD Graphics 620, 1920×1080, Chromium with ANGLE on the hardware GPU. This is a diagnosis and plan, not an adoption decision; no runtime behavior changed. The work is tracked in [#35](https://github.com/teodoryantcheff/ai-settlers/issues/35) and its sub-issues.

**Verdict.** The frame is CPU-bound in rendering. The simulation, HUD and minimap together cost about 1 ms per frame at 1× speed. The world renderer re-describes every visible object each frame through intercepted Canvas2D calls, maps them onto a positional pool of PixiJS objects, and makes PixiJS re-batch the whole scene. That work grows with the number of visible objects (∝ 1/zoom²) and roughly doubles while the colony is running. Three cheap fixes halve the cost, but 60 fps at every zoom needs a retained world scene. A prototype of that scene on this machine costs 2–5 ms per frame.

## Method

`npm run bench:render` (`scripts/bench-render.mjs`) boots the development bundle in headless Chromium on the real GPU (`--use-angle=gl-egl`). It grows a 20-minute autoplay colony (seed 2024: 30 buildings, 16 units, 2,463 trees), centers on the headquarters and samples every zoom for 3 s with the simulation running at 1× and paused. Per frame it records main-thread time for the `requestAnimationFrame` callback (CPU), WebGL timer-query GPU time, `productionRendererStats` counts, draw calls, vertex upload and texture uploads. It pins quality 1 (or `--quality 0.75`), full motion and weather, and mutes audio, and it warns when Chromium falls back to software rendering. Results and optional CPU profiles go to `output/bench/`.

The laptop shares a 15 W budget between CPU and GPU and throttles under sustained load. Repeated runs vary by about ±20%, so compare variants within one session.

## Baseline

CPU = main-thread ms per frame (mean); GPU = timer-query ms (median / p95). Achieved fps is capped at 60.

| Zoom | Running: fps | CPU | GPU | Paused: fps | CPU | Sprites | Graphics | Graphics rebuilt / frame (running) | Vertex upload / frame |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.55 | 9.6 | 105 | 9.1 / 17.5 | 19 | 50 | 7,066 | 2,503 | 550 | 5.0 MB |
| 0.7 | 13 | 72 | 8.5 / 28.7 | 25 | 38 | 5,857 | 1,672 | 541 | 3.3 MB |
| 0.85 | 16 | 63 | 8.5 / 25.1 | 32 | 30 | 5,709 | 450 | 313 | 1.0 MB |
| **1.0** (default) | **18** | **55** | 8.9 / 29.8 | 40 | 24 | 4,452 | 462 | 329 | 0.9 MB |
| 1.3 | 27 | 36 | 7.7 / 22.2 | 51 | 19 | 2,745 | 351 | 293 | 0.7 MB |
| 1.7 | 35 | 28 | 7.7 / 20.2 | 59 | 15 | 1,905 | 302 | 205 | 0.4 MB |
| 2.2 | 45 | 22 | 7.1 / 15.1 | 60 | 10 | 1,215 | 347 | 203 | 0.4 MB |

`step` costs 0.3–0.9 ms per frame at 1× and 3–5 ms at 8×. `drawMini` costs ≤0.5 ms at 1× and 1–3 ms at 8×; `hudTick` costs ≤0.4 ms. PixiJS issues about 44 draw calls per frame, so GPU batching is not the problem.

## Where the time goes

1. **Every visible object is re-captured every frame** (`src/rendering/pixi-context.ts`). Each painter's `drawImage`, `fill` and `stroke` runs through interception. The interception snapshots state, takes the next positional slot, decomposes the full camera-including matrix into the sprite (`setFromMatrix`), sets alpha, tint, blend and clip, and calls the real Canvas `save`/`restore`. This costs about 4 µs per sprite command. In the paused profile at zoom 0.55, capture is 62% of the frame and `drawTree` alone is 31%.
2. **Texture-source swaps in pooled slots** (`image()` in `src/rendering/pixi-renderer.ts`). Each slot owns a dynamic `Texture` and reassigns `texture.source` when the slot's content changes. PixiJS's `Texture.set source` removes a `resize` listener from the old source. That source carries one listener per slot texture (thousands), and EventEmitter rebuilds the listener array on every removal. Slots shift whenever anything earlier in draw order appears, disappears or moves between y-rows, so this runs hundreds to over a thousand times per frame while the simulation runs: 21–29% of the frame.
3. **A full PixiJS re-batch every frame.** `GraphicsPipe.validateRenderable` requests an instruction rebuild whenever a batchable `Graphics` changes. Slot shifts also change the scene's structure. Any one change re-collects and re-packs the entire stage (`_buildInstructions`): 2.5–12.5 ms paused and 5–25 ms running. Even paused frames rebuild, because water glints, meadow motes and smoke change geometry every frame.
4. **Animated vector shapes are re-tessellated per frame.** Flag pennants (bezier paths driven by `sin(now)`), smoke, dust, sparks, motes and water glints put position or alpha into the path or colour. The geometry cache key therefore changes every frame, causing 200–580 `Graphics` rebuilds per frame (earcut, triangulation, upload). At zoom < 0.75 the rock "LOD" draws two ellipse fills per rock, which is about 2,300 Graphics and most of the 5 MB per-frame upload. It is far costlier than the sprite it replaces.
5. **Two-thirds of sprites are tree shadows.** Each tree adds a projected shadow sprite in `shadows()` and a root patch (`shadowSoft`) in `drawTree`, re-submitted every frame although trees are static.
6. **GPU: about 7–9 ms median, with p95 spikes to 15–30 ms.** The atmosphere filter renders the scene into an intermediate texture, then runs a 5-tap pass (≈1.5 ms). `antialias: true` multisamples only that final quad (≈0.5–1 ms, no visual benefit). About 5 ms comes from full-viewport layers: backdrop gradient, two world-sized drop-shadow rects, terrain, the border overlay (a viewport-sized sprite of a mostly transparent 2304² texture) and night, warm or rain tint rects. Disabling the filter alone is worse (14–19 ms), because the whole scene then renders into the multisampled backbuffer. The p95 spikes fall as CPU load falls, consistent with the shared power budget.
7. **Hitches.** Autosave every 5 minutes blocks for **210–290 ms**: `saveAutosave` re-reads and re-writes the whole save catalog, including every checkpoint, and stringifies the data twice. A territory change costs **+30–50 ms**, because `drawBorders` clears and re-strokes the 2304² border canvas and re-uploads all of it. Loading a world repaints the terrain cache in 1.6 s; that is a load cost, not a frame cost.

## Measured quick fixes

Experimental changes in the current adapter, measured cumulatively in one session (CPU ms per frame, simulation running; noisy, see Method):

| Change | Zoom 0.55 | Zoom 1.0 | Zoom 2.2 |
| --- | --- | --- | --- |
| Baseline (same session) | 149 | 83 | 29 |
| Shared sub-texture per (source, frame); camera-cropped terrain/border sprites draw their whole texture | 63 | 32 | 20 |
| + tree shadows and root patches omitted (approximates baking them into one cached layer) | 46 | 25 | 18 |
| + rocks drawn as sprites at far zoom | **29** | **26** | **19** |
| Same three, paused | 22 | 18 | 9 |

These three fixes take 2,500 Graphics down to about 200 and the vertex upload from 5 MB to 0.7 MB at zoom 0.55. They still leave about 25 ms at the default zoom while running. The rest is per-object capture (≈13 ms), the per-frame rebuild (≈5–8 ms) and re-tessellated particles (≈5 ms).

GPU timer medians (ms) for the GPU-side options:

| Configuration | Zoom 0.55 | Zoom 1.0 | Zoom 2.2 |
| --- | --- | --- | --- |
| Current (filter + MSAA) | 9.2 | 9.0 | 7.2 |
| `antialias: false` | 8.4 | 8.0 | 6.7 |
| `antialias: false`, filter off | 7.1 | 7.2 | 5.3 |
| Filter off, MSAA on | 14.1 | 19.1 | 16.6 |

## Target architecture: a retained world scene

A standalone PixiJS 8.22 prototype used the same art sheets, map size and object counts:

- one world container as a render group carrying the camera transform
- terrain and baked shadows as two sprites
- 3,153 persistent tree, rock and building sprites in 96 tile-row containers (`sortableChildren`), with off-screen rows hidden
- 100 or 400 units moving every frame, changing rows and re-sorting

| Zoom | CPU: camera panning only | CPU: 100 units moving | CPU: 400 units moving | GPU median (no filter or MSAA) |
| --- | --- | --- | --- | --- |
| 0.55 | 0.4 ms | 3.0 ms | 4.0 ms | 4.0 ms |
| 1.0 | 0.3 ms | 2.5 ms | 3.6 ms | 4.8 ms |
| 2.2 | 0.2 ms | 1.5 ms | 2.2 ms | 3.6 ms |

Making each row its own render group did not help, so one world render group is enough. The prototype omits flags, smoke, particles, overlays and the atmosphere filter. Those are bounded in count and add roughly 1–3 ms if drawn as sprites.

## Plan

Acceptance on the reference laptop, at every zoom with the simulation running at 1×: 60 fps, CPU p95 ≤ 10 ms and GPU p95 ≤ 10 ms. At 8× speed, allow the simulation's extra 3–5 ms.

### Phase 1: quick wins in the current adapter (days)

Each item lands independently and is measurable with `npm run bench:render`.

1. **Shared sub-textures.** In `image()`, look up one cached `Texture` per (source, frame) and assign it to the slot sprite, instead of mutating a per-slot dynamic texture's `source` and `frame`. Give the camera-cropped terrain and border blits dedicated sprites. Measured: −45–60% while running.
2. **Bake ground shadows.** Paint tree and building projected shadows and tree root patches into a cached world-space shadow canvas, invalidated on `tileChanged` and building completion. Present it as one sprite whose alpha follows night and rain. Verify that tree roots and footprints still read correctly. Measured: up to −25% at far zoom.
3. **Sprite rocks at far zoom.** Replace the two-ellipse rock LOD with a sprite or a pre-rendered pebble texture. Measured: −35% at zoom 0.55.
4. **Stable geometry for animated shapes.** Draw smoke, dust, sparks, motes and water glints in local coordinates (`translate`/`scale`), with opacity in `globalAlpha` rather than in the `rgba()` style. The existing geometry key then stays constant and only the transform and alpha change. Render flag pennants from a few pre-rendered frames. This removes the per-frame re-tessellation (≈5 ms at close zoom) and most rebuild triggers.
5. **`antialias: false`** in `createPixiRenderer`, since only the filtered full-screen quad is multisampled (−0.5–1 ms GPU).
6. **Autosave without a hitch.** Store the autosave under its own key instead of rewriting the full catalog, serialize once, and keep validation before replacement. Done in #38. Validation also skips its defensive copy for fresh snapshots and bounds cumulative samples by the goods they record instead of every good. Measured in Chromium on the reference laptop, with ten named checkpoints (a 3-minute colony, 3.3 MB catalog): autosave **414 ms → 7–9 ms** median, with single samples of 11–16 ms. Snapshot, validation and serialization of a 20-minute colony take about 25 ms in Node, and older colonies rarely leave room for ten checkpoints within the browser's ~5 MB storage quota. Garbage-collection pauses can still push one autosave past a frame.
7. **Incremental borders.** Repaint and upload only the changed tiles' border rectangles (as `drawTile` already does for terrain), or draw borders as retained line geometry.

Expected result: about 18–25 ms per frame while running at default zoom, which is still short of the target.

### Phase 2: retained world scene (1–2 weeks)

1. Put the world in a camera render group. Pan and zoom then change one transform instead of decomposing a matrix into every sprite.
2. Present terrain, borders and baked shadows as persistent sprites, never re-specified per frame.
3. Key entity views by identity, not by draw order:
   - trees and rocks by tile index, built on `worldLoaded` and updated on `tileChanged`
   - buildings by id: body, construction stage, stock and flag frames as children
   - units by id: shadow, body frame, cargo

   Per frame, update only what moves or animates: unit position and frame, sway frames on their timers, and flag frames.
4. Keep the existing y-order key with one container per tile row (`sortableChildren`), hiding rows outside the camera. Static objects are inserted once; units move between rows.
5. Pack the ~190 generated art canvases into one or two atlases at load. Draw particles and weather as sprites, or as a `ParticleContainer` on that atlas. #35 leaves atlases and `ParticleContainer` out of scope unless the benchmark shows draw calls or effects as the bound once the retained scene lands.
6. Keep the Canvas-capture adapter only for low-volume interactive overlays (selection, ghost, placement and road previews, logistics routes, captions), where its cost is bounded.

Migrate behind the existing `presentation.layer` seam in this order: trees and rocks (≈70% of commands), then units, buildings and effects. Preserve scene ordering, anchors and the camera/input mapping, and reach new state in tests through the renderer's `internals` hooks. Expected result: CPU 2–5 ms per frame at every zoom.

### Phase 3: GPU budget (after Phase 2, measured)

1. Fold the night, warm, rain and lightning tints into the atmosphere filter's uniforms instead of drawing full-viewport rects.
2. Draw the backdrop and the world drop shadow only where the map does not cover the viewport.
3. Replace the viewport-sized border overlay with retained line geometry.
4. Compute bloom at half resolution, or keep it only at quality 1.
5. Re-measure GPU p95 once CPU load is lower.

Also worth doing: repaint the minimap incrementally per changed tile instead of in full on every change (1–3 ms per frame at 8×).
