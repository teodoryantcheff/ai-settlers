# Reaching 60 fps at every zoom

Measured on 2026-10-16 on the reference laptop: Intel Core i7-8550U (4C/8T, 15 W), Intel UHD Graphics 620, 1920×1080, Chromium with ANGLE on the hardware GPU. The initial diagnosis and follow-up plan below are retained as the baseline; the implementation measurements record the shipped changes. The work is tracked in [#35](https://github.com/teodoryantcheff/ai-settlers/issues/35) and its sub-issues.

**Update, 2026-10-17.** The Canvas2D interception layer described below (`pixi-context.ts`) has been removed. Painters now draw straight into a few pooled PixiJS `Graphics` runs per layer, rebuilt each frame. On the same laptop with a 10-minute colony, CPU time per frame fell from 32/27/20 ms to 13/10/5.5 ms (zoom 0.55/1/2.2, running), every zoom reaches the 60 fps cap, and draw calls fell from about 44 to 15.

## Native nature retention, 2026-10-18 (#42 / #44)

Implemented on the single `codex/native-nature-integration` branch, starting from fresh `main` at `c0ebf91` (including the normalized building PNGs). Final runtime measurements use reviewed commit `8ce4aa6`; [provenance](benchmarks/2026-10-18/native-nature/provenance.json) records source/bundle hashes and validation. Earlier measurements are retained as [pre-review 1×](benchmarks/2026-10-18/native-nature/retained-pre-review-1x.json) and [pre-review 8×](benchmarks/2026-10-18/native-nature/retained-pre-review-8x.json), rather than selecting the fastest run. The production WebGL renderer retains a view per tree/rock tile. Images and local vector geometry update explicitly, while unchanged views reuse shared textures. Contiguous static spans between immediate building/settler drawings share native GPU batches; moving objects change only the spans they cross. Cached static depth rows merge with the full dynamic depth keys and preserve stable ties. Culling drops obsolete batch ordering identities while retaining owned artwork; removal, world replacement and teardown release owned views, including detached ones. Buildings, settlers and overlays remain immediate.

The first per-owner prototype kept draw calls low but still rebuilt/uploaded the combined scene batch and incurred repeated child-array splices. It did not demonstrate a CPU gain. The adopted path sorts placement once and isolates static batch instructions. Batch isolation increases draw calls. The final controls below show CPU savings but worse far-zoom GPU tails and fps, so the implementation remains experimental and is not recommended for a PR yet.

### Hardware measurements

Reference i7-8550U / Intel UHD 620, hardware ANGLE WebGL, 1920×1080, seed 2024, quality 1, full motion, pinned noon/no rain, 20-minute starting colony (30 buildings, 16 units, 2,463 trees). Each window has one second warmup and ten seconds measurement. No tests or captures run concurrently with the timed windows used below. Simulation continues during measurement, so sequential 1× zooms see a slightly older colony. The starting scene and protocol match the baseline. CPU and GPU are separate measurements, not additive frame budgets.

Reproduce the ordinary timings after `npm ci` and `npm run build`:

```sh
node scripts/bench-render.mjs --minutes 20 --modes running --speed 1 --ms 10000
for zoom in 0 1 2 3 4 5 6; do
  node scripts/bench-render.mjs --minutes 20 --modes running --speed 8 --zooms "$zoom" --ms 10000
done
```

The final measurement wrapper also records simulation start/end time, pause state and modal state and rejects invalid running windows; it remains locally at `output/native-nature/measure.mjs`. Each 8× window starts from a fresh browser/colony and advances about 80 simulated seconds with no modal or pause. Saved [1× baseline](benchmarks/2026-10-18/native-nature/baseline-1x.json), [retained 1×](benchmarks/2026-10-18/native-nature/retained-1x.json), [8× baseline](benchmarks/2026-10-18/native-nature/baseline-8x.json) and [retained 8×](benchmarks/2026-10-18/native-nature/retained-8x.json) retain the GPU identity, phase means, tails, draw calls and upload counts. The baseline 8× zoom-1.3 window that overlapped a focused test was excluded and replaced by a clean repeat.

All times below are milliseconds; the paired CPU columns show mean / p95.

| Zoom | Main 1× fps | Main CPU | Retained 1× fps | Retained CPU | Retained GPU median / p95 |
|---|---:|---:|---:|---:|---:|
| 0.55 | 59 | 12.1 / 17.5 | 56.5 | 9.9 / 12.8 | 7.2 / 9.9 |
| 0.7 | 59.6 | 11 / 15.3 | 58 | 9.2 / 12.7 | 6.8 / 9.4 |
| 0.85 | 58.6 | 11.8 / 15.7 | 54.5 | 11 / 17.9 | 6.6 / 10 |
| 1 | 59.3 | 9.9 / 13.6 | 59.3 | 9.1 / 12.8 | 5.8 / 8.2 |
| 1.3 | 59.8 | 7.7 / 11.4 | 60 | 7.5 / 10.4 | 5 / 6.8 |
| 1.7 | 59.6 | 6.9 / 13.6 | 58.9 | 7.2 / 11 | 4.5 / 6.4 |
| 2.2 | 60 | 6 / 11.5 | 60 | 5.8 / 7.3 | 4.1 / 5.5 |

| Zoom | Main 8× CPU p95 | Retained 8× fps | Retained CPU mean / p95 | Retained GPU median / p95 |
|---|---:|---:|---:|---:|
| 0.55 | 19.2 | 51.2 | 13.3 / 20.6 | 7.5 / 11.2 |
| 0.7 | 20.5 | 53.7 | 12.6 / 18.4 | 7 / 11.1 |
| 0.85 | 20.6 | 56 | 12.3 / 16.6 | 6.8 / 10 |
| 1 | 20.2 | 56.5 | 12.1 / 17.9 | 6 / 9.9 |
| 1.3 | 12.8 | 58.9 | 10.2 / 14.2 | 5.4 / 8.5 |
| 1.7 | 14.9 | 59.8 | 8.4 / 11.2 | 4.8 / 7.5 |
| 2.2 | 13.8 | 60 | 7.3 / 10.3 | 4.6 / 7.2 |

**The all-zoom target is not met.** Final 1× fps ranges from 54.5 to 60, and CPU p95 exceeds 10 ms at six zooms (all except 2.2), peaking at 17.9 ms. Reported GPU p95 is 5.5–10.0 ms, but GPU medians at zooms 0.55–0.85 still exceed #40's 6 ms criterion. At 8×, CPU p95 exceeds 15 ms at zooms 0.55–1.0 and peaks at 20.6 ms; GPU p95 reaches 11.2 ms at 0.55. The final 1.3/8× sample meets the CPU ceiling, as did its adjacent control repeat below. These results establish useful far/default drawing savings, not uniform gains at every zoom, stable 60 fps or closure of #35/#40/#47. Autosave and territory-change hitches were not remeasured by this work.

### Adjacent A/B/A controls

Main's unchanged built assets were preserved outside the checkout; all implementation stays on one integration branch. A/B/A used fresh 20-minute colonies, zooms 0.55 and 1.0, ten-second running 1× windows, and no concurrent validation. [Saved controls](benchmarks/2026-10-18/native-nature/controls.json) include all counts and original artifact paths.

| Zoom | Main A1 draw / CPU p95 | Retained B draw / CPU p95 | Main A2 draw / CPU p95 | Main → retained draw calls | Main → retained vertex KB/frame |
|---|---:|---:|---:|---:|---:|
| 0.55 | 12.0 / 17.7 | 11.1 / 17.0 | 14.2 / 22.4 | 15.7 → 46.4 | 520 → 399 |
| 1.0 | 9.3 / 13.6 | 8.4 / 12.5 | 9.8 / 14.2 | 17.9 → 46.0 | 375 → 293 |

| Zoom | Main A1 fps / GPU p95 | Retained B fps / GPU p95 | Main A2 fps / GPU p95 |
|---|---:|---:|---:|
| 0.55 | 58.9 / 10.3 | **50.5 / 11.3** | 53.1 / 10.2 |
| 1.0 | 59.9 / 8.0 | 59.0 / 8.5 | 59.7 / 8.2 |

These are matched controls on the final `8ce4aa6` runtime. Drawing falls about 15% / 12% against the averages of adjacent controls and is below both controls at both zooms. The far-zoom reduction against their average is about 2.0 ms, smaller than the 2.2 ms spread between controls, so #44's stronger requirement for a reproducible gain beyond control variation remains unproven. However, **neither zoom shows an fps improvement**, and far-zoom GPU p95 worsens despite lower CPU drawing time. The nearly threefold draw-call increase is not justified as a route to stable 60 fps by these whole-frame results. The CPU reduction alone is not enough to recommend shipping this branch. Earlier [pre-review controls](benchmarks/2026-10-18/native-nature/controls-pre-review.json) are preserved; they measured drawing gains of about 22% / 16%, illustrating the laptop's substantial drift rather than overriding the final result.

The final full 1× run records CPU mean falling from 12.1 to 9.9 ms at far zoom, but the adjacent comparison is the better estimate of the gain under this laptop's shared power budget. Nature artwork remains present; full sprite/upload counts are retained in the raw controls. Graphics-build counts rise because immediate work is split into smaller runs; unchanged paused nature emits no image commands or geometry updates. Its independent batches also survive camera transforms without uploading all static sprite vertices, verified by a real GPU buffer-update fixture. Geometry reuse is functional, while performance acceptance remains open.

A targeted [8× zoom-1.3 A/B/A repeat](benchmarks/2026-10-18/native-nature/controls-8x-1.3.json) checked that isolated worse tail rather than treating it as a regression. CPU p95 was 11.8 / **11.0** / 12.8 ms (main / retained / main), with drawing 7.4 / **7.0** / 7.6 ms and 60 fps in all three windows. The earlier worse 16.8 ms sample remains in the pre-review results; the final full pass measured 14.2 ms. The controlled repeat met the 15 ms ceiling and does not establish a near-zoom regression.

### Visual and regression evidence

36 before/after actual-game captures cover zooms 0.55, 1.0 and 2.2; day/night; Normal, Visual clarity and Reduced Motion; and both quality 1/0.75. They use the same grown colony, fixed cosmetic clock and cosmetic RNG, and hardware WebGL. [Comparison summaries and hashes](benchmarks/2026-10-18/native-nature/visual-comparison.json) record a maximum channel difference of 6/255 and a worst per-image mean difference below 0.00047/255. The differences are sparse raster rounding; the inspected contact sheet shows no ordering, footprint or anchor shifts. Raw PNGs and the contact sheet remain in `output/native-nature/`.

Real-subsystem tests cover static/dynamic depth keys and stable ties, growth, planting/felling, sway, pause, Reduced Motion, clarity, source replacement, far-zoom thresholds and world replacement. Hardware-browser fixtures verify retained Graphics batches, bounded buffer updates across camera changes, culling/reuse, nested batch cleanup and visible graphics failure recovery. Existing hardware tests cover partial terrain/border uploads, tiled textures, shadows and bounded art caches across all zooms. `npm test`, `npm run format:check` and all 24 affected hardware-browser tests pass. The final `8ce4aa6` functional review reports Standards: 0 documented breaches and 0 remaining smell findings; functional Spec: 0 findings. The shared-selector maintenance concern was fixed and revalidated; the final full routine suite passes again. Performance acceptance has two open criteria: #42's increased draw calls are not justified by the whole-frame fps/GPU results, and #44's far-zoom drawing gain beyond control variation remains unproven. Neither ticket is closed and no PR is opened.

### Remaining drawing cost

A post-change five-second V8 profile from `463a900` (before the final shared-selector refactor) at zooms 0.55/1.0 attributes 37.3% / 47.6% of sampled drawing time to submission (`presentation.end`). Native instruction rebuilding remains 18.4% / 26.7%, and Graphics batch preparation 11.6% / 16.3%; these inclusive shares overlap. Direct building painter stacks account for 6.5% / 16.6%. [Far profile](benchmarks/2026-10-18/native-nature/profile-0.json) and [default profile](benchmarks/2026-10-18/native-nature/profile-3.json) preserve weighted totals and raw-profile hashes. These samples are not source-map attributed, can be blurred by inlining, and include profiler overhead; they do not replace unprofiled frame budgets. Remaining immediate geometry and building drawing warrant controlled probes before choosing #46 or another migration. #45 is still conditional; this 16-unit colony does not establish a large-population settler cost.

## Original diagnosis (before the native drawing path)

**Verdict.** The frame is CPU-bound in rendering. The simulation, HUD and minimap together cost about 1 ms per frame at 1× speed. The world renderer re-describes every visible object each frame through intercepted Canvas2D calls, maps them onto a positional pool of PixiJS objects, and makes PixiJS re-batch the whole scene. That work grows with the number of visible objects (∝ 1/zoom²) and roughly doubles while the colony is running. Three cheap fixes halve the cost, but 60 fps at every zoom needs a retained world scene. A prototype of that scene on this machine costs 2–5 ms per frame.

## Method

`npm run bench:render` (`scripts/bench-render.mjs`) boots the development bundle in headless Chromium on the real GPU (`--use-angle=gl-egl`). It grows a 20-minute autoplay colony (seed 2024: 30 buildings, 16 units, 2,463 trees), centers on the headquarters and samples every zoom for 3 s with the simulation running at 1× and paused. Per frame it records main-thread time for the `requestAnimationFrame` callback (CPU), WebGL timer-query GPU time, `productionRendererStats` counts, draw calls, vertex upload and texture uploads. It pins quality 1 (or `--quality 0.75`) and full motion, and mutes audio. The `renderbench` URL flag freezes the cosmetic clock at noon with no rain, and the script refuses to measure unless that state is in effect. Unpinned runs differed by up to about 15% at the same zoom, because rain, night veils and dusk particles roughly doubled the vector shapes rebuilt per frame. It warns when Chromium falls back to software rendering. Results and optional CPU profiles go to `output/bench/`.

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

Items 1–4 are implemented in #37; see the same-session measurements below.

Each item lands independently and is measurable with `npm run bench:render`.

1. **Shared sub-textures.** In `image()`, look up one cached `Texture` per (source, frame) and assign it to the slot sprite, instead of mutating a per-slot dynamic texture's `source` and `frame`. Give the camera-cropped terrain and border blits dedicated sprites. Measured: −45–60% while running.
2. **Bake ground shadows.** Paint tree and building projected shadows and tree root patches into a cached world-space shadow canvas, invalidated on `tileChanged` and building completion. Present it as one sprite whose alpha follows night and rain. Verify that tree roots and footprints still read correctly. Measured: up to −25% at far zoom.
3. **Sprite rocks at far zoom.** Replace the two-ellipse rock LOD with a sprite or a pre-rendered pebble texture. Measured: −35% at zoom 0.55.
4. **Stable geometry for animated shapes.** Draw smoke, dust, sparks, motes and water glints in local coordinates (`translate`/`scale`), with opacity in `globalAlpha` rather than in the `rgba()` style. The existing geometry key then stays constant and only the transform and alpha change. Render flag pennants from a few pre-rendered frames. This removes the per-frame re-tessellation (≈5 ms at close zoom) and most rebuild triggers.
5. **`antialias: false`** in `createPixiRenderer`, since only the filtered full-screen quad is multisampled (−0.5–1 ms GPU).
6. **Autosave without a hitch.** Store the autosave under its own key instead of rewriting the full catalog, serialize once, and keep validation before replacement. Done in #38. Validation also skips its defensive copy for fresh snapshots and bounds cumulative samples by the goods they record instead of every good. Measured in Chromium on the reference laptop, with ten named checkpoints (a 3-minute colony, 3.3 MB catalog): autosave **414 ms → 7–9 ms** median, with single samples of 11–16 ms. For a 20-minute colony with two checkpoints, autosave fell from **700–729 ms to 34 ms** median (same-session A/B on an idle laptop). Such a colony's save was 1.5 M characters: its per-building production histories alone took 1.0 M. Only two checkpoints and the autosave fit in the browser's ~5 MB quota, and the third checkpoint failed. Saves now store sample histories column by column (lossless; see SPEC.md). That brings the save to 516 k characters, so about nine checkpoints fit. The remaining ~37 ms is snapshot, validation and serialization, while the storage write takes 0.6 ms. Reaching 16 ms for a grown colony needs incremental or idle-time validation, which is left as a follow-up. Garbage-collection pauses can still push one autosave past a frame.
7. **Incremental borders.** Implemented in #39: repaint fixed 8×8-tile chunks, merge neighbouring dirty chunks for upload, and keep distant changes separate. Minimap changes repaint only queued cells. See the recorded cache measurements below.

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

The incremental minimap from #39 replaces the former full repaint on each change (previously 1–3 ms per frame at 8×).


## Incremental border and minimap measurements (#39)

Recorded 2026-10-16 on the reference i7-8550U / UHD 620 with hardware WebGL (`ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL ES 3.2)`), 1920×1080, quality 1, seed 2024, and a 20-minute colony (30 buildings, 16 units). Software rendering is rejected by the territory benchmark.

```sh
npm run build
node scripts/bench-territory.mjs
node scripts/bench-render.mjs --minutes 20 --zooms 3 --modes running --speed 8 --ms 15000 --port 8796
```

The territory benchmark freezes cosmetic time and pauses simulation, warms 30 frames, then samples 80 pairs on native browser animation frames at zoom index 3. Each pair compares an ordinary frame with the first frame after switching between the real territory projections with and without the outpost at (57,48): 33 changed ownership cells. Buildings and their artwork remain unchanged, isolating the cache work. Snapshotting the projection and emitting its event happen before the timed changed frame. The callback includes the world draw, minimap and HUD. Full cache rebuilds remain a world-load cost.

| Whole frame | Mean | Median | p95 |
|---|---:|---:|---:|
| Ordinary | 29.215 ms | 26.5 ms | 47.3 ms |
| After territory change | 32.995 ms | 30.1 ms | 45.2 ms |

Mean additional cost is **3.780 ms**, below the 5 ms budget. This is a measured average, not a hard bound for every frame: the paired differences have p95 15.4 ms and maximum 30.7 ms on this shared laptop. Raw samples and the actual-game screenshot are in `output/bench-territory/2026-10-16T18-23-17-323Z/`. Manual back-to-back draws misattribute queued GPU work to the following draw; the retained benchmark uses native compositor frame boundaries.

At 8× speed the ordinary render benchmark records **0.2 ms per frame for the minimap**, below the 0.5 ms budget, over a 15-second window (10.4 fps; total CPU 92.7 ms/frame). The remaining world-rendering work still dominates. Raw results are in `output/bench/2026-10-16T18-17-19-283Z/results.json`.

Pixel tests compare incremental caches with full rebuilds on both ordinary and forced-tiled textures. They cover holes/restoration, map edges, disjoint changes, batched notifications, chunk boundaries, felled trees, roads, deposits and ownership; territory changes also compare actual GPU readback bytes. A single interior tile uploads one 192² chunk instead of the 2304² border image. Neighbouring chunks share an upload; separate regions do not cause a map-sized upload. CPU-backed staging and replacement of transparent pixels apply to both ordinary and tiled textures. Unchanged frames and unchanged projections reuse their caches.


## Captured scene without per-frame churn (#37)

Measured in one session on 2026-10-16, on the same i7-8550U / UHD 620 hardware WebGL configuration, 1920×1080, quality 1, seed 2024, 20-minute autoplay colony, 1× running speed. Both builds use the existing benchmark with five-second windows and one-second warmup per zoom/mode:

```sh
npm ci
npm run build
node scripts/bench-render.mjs --minutes 20 --zooms 0,3 --modes running,paused --ms 5000 --port 8817
```

The baseline is PR #49 at `9c533597a3a88cce8bc2c3088a03b00a167ef978`. Raw JSON is retained under `output/bench/2026-10-16T19-10-49-800Z/` (before) and `output/bench/2026-10-16T19-19-15-695Z/` (after).

| Zoom / state | CPU before | CPU after | Reduction | Vector shapes after | Vertex upload after |
|---|---:|---:|---:|---:|---:|
| 0.55 running | 108.9 ms | 27.8 ms | 74.5% | 223 | 636 KB/frame |
| 0.55 paused | 52.3 ms | 24.7 ms | 52.8% | 230 | 615 KB/frame |
| 1.0 running | 59.0 ms | 25.0 ms | 57.6% | 430 | 526 KB/frame |
| 1.0 paused | 28.2 ms | 22.6 ms | 19.9% | 422 | 544 KB/frame |

At far zoom the baseline used 2,483 vector shapes and 5,122 KB/frame. Paused geometry builds fall to **zero** at both zooms; running builds fall from 524.5 to 33.1 per frame at 0.55 and from 322.3 to 111.3 at 1.0. Remaining builds include actual changing worker poses and progress, and positional command changes within a layer. GPU medians remain about 8 ms. The capture adapter remains CPU-bound and does not yet achieve 60 fps; that is the retained-scene follow-up's scope.

Art textures are shared by source/crop. Camera crops use dedicated per-source-tile sprites, and panning every zoom across the map twice creates no more textures on the second sweep. Ordered layer pools prevent a terrain crop or distant effect from shifting every other layer's slots. Solid paint opacity stays in display state. Animated details use local geometry; distant rocks and flag frames are cached artwork.

The shadow layer uses one quad with two cached planes rather than fading contacts together with sunlight. This preserves root-contact opacity through night/rain and retains the existing clarity multiplier. Only affected 8×8-tile chunks repaint/upload for tree-stage and completed-building changes; loads rebuild everything. No simulation RNG or time is consumed. Full and incremental shadow frames are compared using actual WebGL pixels, including a forced 2048-pixel texture limit.

Controlled captures use hardware WebGL, 1440×900, seed 2024, installed painted assets, paused simulation and a fixed cosmetic clock. The matrix covers zooms 0.55, 1.0 and 2.2 in day, midnight, rain, Visual clarity, Reduced Motion and quality 0.75. The screenshot harness verifies the actual night/rain values (midnight approximately 1; rain approximately 0.97), because `devshot` alone pins daylight. Captures and their scripts are retained in `output/issue37/`. Cached resampling and discretized flag poses are raster changes rather than pixel-identical screenshots; geometry, entrances, tree roots and camera positions are checked visually.


Final review found and corrected a split-clock regression: shared presentation time remains wall time for lightning expiry, new feedback effects, the minimap throttle and diagnostics. Only decorative painter inputs freeze while paused. Real-subsystem regressions cover a paused thunderstorm, feedback created during pause and minimap viewport movement.

## Fewer full-screen GPU passes (#40)

The WebGL context no longer multisamples. The night, dusk, rain and lightning veils are one premultiplied uniform applied in the atmosphere pass before grading and bloom sampling, instead of up to four full-viewport rectangles. Lantern glows, rain streaks and the logistics caption, formerly drawn above those rectangles, render in an `above-atmosphere` layer outside the filtered scene. The backdrop gradient fills only viewport bands outside the map, and the two drop shadows only their strips beyond the map's south and east edges. Reduced quality already skipped bloom and ran the pass at 0.75 resolution.

Same-session A/B/A on the reference laptop: `node scripts/bench-render.mjs --modes running --ms 5000`, 1920×1080, quality 1, seed 2024, 20-minute colony, pinned noon without rain (so these numbers exclude the veil savings). GPU timer median / p95 in ms:

| Zoom | Before (1st) | After | Before (2nd) |
| --- | --- | --- | --- |
| 0.55 | 7.5 / 15.5 | **7.0 / 13.6** | 7.7 / 14.3 |
| 0.7 | 7.6 / 17.0 | **6.8 / 12.7** | 7.9 / 17.3 |
| 0.85 | 7.9 / 18.1 | **6.8 / 15.6** | 7.9 / 17.5 |
| 1.0 | 7.2 / 12.9 | **6.3 / 13.1** | 7.4 / 13.3 |
| 1.3 | 6.6 / 12.4 | **5.9 / 9.9** | 7.1 / 13.0 |
| 1.7 | 7.1 / 10.4 | **5.7 / 10.1** | 7.0 / 9.4 |
| 2.2 | 6.8 / 9.3 | **5.4 / 9.2** | 6.8 / 9.0 |

The median falls by 0.7–1.4 ms at every zoom. It meets 6 ms from zoom 1.3 inward, but zooms 0.55–1.0 remain at 6.3–7.0 ms. The earlier experiment with no filter and no MSAA measured 7.1–7.2 ms at far zoom, so the remaining cost is scene fill rate (3,574 sprites at 0.55) and the viewport-sized border overlay, not full-screen passes. Raw output: `output/issue40/bench-*.txt`.

Deterministic captures (`output/issue40/capture.mjs`, 1600×900, hardware WebGL) step `requestAnimationFrame` on a fake clock, pin `Math.random` after boot and verify night and rain amounts for dawn, day, dusk, night, rain, lightning, night rain with lightning, Visual clarity (day; night rain with lightning), quality 0.75 (day, dusk), Reduced Motion lightning, far zoom and a map corner. Two baseline runs give the noise floor; cloud shadows and tree sway still vary with decorative time. Compared with the baseline:

- Reduced Motion with full rain, which has no cloud or sway noise, differs by at most 2/255 over the whole frame: the in-shader rain veil matches the former rectangle to rounding, and the flash stays suppressed.
- A lightning frame brightens the rain frame by a mean of 53.6/255 before and 54.1/255 after.
- Backdrop bands, sun shafts on them and the map's drop-shadow strip are pixel-identical at far zoom.
- Night, dusk, dawn, rain and quality 0.75 differences are within the baseline noise floor (cloud shadows, tree sway), apart from glows and rain streaks, which no longer receive the ≤6.5% vignette and residual grading; at quality 0.75 they also render at full rather than 0.75 resolution.
- Visual clarity disables the atmosphere pass, so it was the only view drawn into the multisampled backbuffer. Its building-tag outlines now render without MSAA, like every vector edge in the filtered views.
