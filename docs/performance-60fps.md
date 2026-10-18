# Reaching 60 fps at every zoom

Measured on 2026-10-16 on the reference laptop: Intel Core i7-8550U (4C/8T, 15 W), Intel UHD Graphics 620, 1920×1080, Chromium with ANGLE on the hardware GPU. The initial diagnosis and follow-up plan below are retained as the baseline; the implementation measurements record the shipped changes. The work is tracked in [#35](https://github.com/teodoryantcheff/ai-settlers/issues/35) and its sub-issues.

**Update, 2026-10-17.** The Canvas2D interception layer described below (`pixi-context.ts`) has been removed. Painters now draw straight into a few pooled PixiJS `Graphics` runs per layer, rebuilt each frame. On the same laptop with a 10-minute colony, CPU time per frame fell from 32/27/20 ms to 13/10/5.5 ms (zoom 0.55/1/2.2, running), every zoom reaches the 60 fps cap, and draw calls fell from about 44 to 15.

## Current native-renderer acceptance, 2026-10-18

Measured `main` at `1f8e057fba857c40d02846f60558bcadfa408f67` on the reference i7-8550U / UHD 620 laptop, using hardware WebGL (`ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL ES 3.2)`), Node.js 24.18.1 and Playwright 1.64.0. The runs use seed 2024, 1920×1080, quality 1, full motion, muted audio and pinned noon without rain. Each starts with the same 20-minute autoplay colony: 30 buildings, 16 units and 2,463 trees. Every zoom has one second of warmup and ten seconds of measurement. The 1× run measures all zooms sequentially; each 8× zoom runs in a fresh browser and colony. Simulation advances during measurement, so these are not frozen-colony comparisons.

```sh
npm ci
npm run bench:render -- --minutes 20 --modes running --speed 1 --ms 10000
for zoom in 0 1 2 3 4 5 6; do
  node scripts/bench-render.mjs --minutes 20 --modes running --speed 8 --zooms "$zoom" --ms 10000
done
```

The 8× commands reuse the build from the 1× command. Saved benchmark summaries are committed alongside these notes: [1× results](benchmarks/2026-10-18/main-1x.json) and [isolated 8× results](benchmarks/2026-10-18/main-8x.json). They identify the hardware GPU and report CPU p95, GPU median/p95 and per-frame draw/upload counts. Timings below are milliseconds; fps remains capped at 60.

| Zoom | 1× fps | CPU mean | CPU p95 | GPU median | GPU p95 |
| ---- | ------ | -------- | ------- | ---------- | ------- |
| 0.55 | 58.6   | 12.5     | 18.5    | 6.9        | 10.6    |
| 0.7  | 57.2   | 12.5     | 17.5    | 6.9        | 9.4     |
| 0.85 | 57.9   | 11.7     | 16.4    | 6.7        | 9.6     |
| 1.0  | 59.3   | 10.1     | 14.3    | 6.0        | 8.8     |
| 1.3  | 59.3   | 8.1      | 12.6    | 5.3        | 7.5     |
| 1.7  | 60.0   | 6.3      | 7.7     | 4.8        | 6.8     |
| 2.2  | 60.0   | 6.3      | 11.6    | 4.5        | 6.4     |

At 1×, GPU median still exceeds #40's 6 ms ceiling at zooms 0.55–0.85. #47's CPU p95 ceiling of 10 ms is missed at every zoom except 1.7, and its GPU p95 ceiling of 10 ms is missed at 0.55. Reaching the 60 fps cap in a shorter or smaller-colony run does not establish these tail-latency budgets.

An initial sequential 8× pass is excluded from acceptance: its last sample recorded zero simulation-step time and only 44.6 fps. The game can suspend simulation behind its victory modal, and the benchmark does not record modal or victory state. A sample without simulation work cannot establish the running 8× budget. The replacement measurements use a fresh 20-minute colony for each zoom; the closest-zoom repeat records simulation work again. The excluded pass remains locally under `output/bench/2026-10-18T08-35-55-874Z/` for diagnosis.

| Zoom | 8× fps | CPU mean | CPU p95 | GPU median | GPU p95 |
| ---- | ------ | -------- | ------- | ---------- | ------- |
| 0.55 | 59.2   | 14.1     | 18.1    | 6.9        | 10.5    |
| 0.7  | 55.9   | 15.1     | 21.4    | 7.0        | 10.2    |
| 0.85 | 55.5   | 14.6     | 19.9    | 6.8        | 10.0    |
| 1.0  | 57.2   | 12.8     | 18.8    | 6.1        | 9.8     |
| 1.3  | 59.7   | 9.9      | 14.6    | 5.4        | 8.8     |
| 1.7  | 59.2   | 9.4      | 14.6    | 5.0        | 7.6     |
| 2.2  | 59.9   | 6.6      | 11.4    | 4.4        | 6.4     |

At 8×, CPU p95 exceeds #47's 15 ms ceiling at zooms 0.55–1.0 (18.1–21.4 ms). The closer zooms meet that CPU ceiling in this session. These samples establish an open performance gap; they do not establish a regression against the earlier 10-minute-colony measurements or a same-session comparison with the pre-#54 renderer.

The frame-phase measurements attribute most of the CPU mean to drawing: 11.8 of 12.5 ms at zoom 0.55 and 9.5 of 10.1 ms at zoom 1.0. Simulation means are 0.2–0.3 ms per frame at 1×. This supports profiling the current drawing path next; it does not identify a particular painter or prove that the old retained-scene design is the required fix. The renderer rebuilds six or seven native Graphics runs per frame; it no longer uses the removed Canvas-capture adapter.

PR #52 is closed because its implementation plan predates the current native renderer. Its local `codex/pr52-integration` branch at `620c92459e1da39be6df2bec56d3dacd1a46b937` is preserved for reference. #40 and #47 remain open, and #42–#46 remain `needs-triage`: profile the native renderer, then rewrite only the tickets justified by the measured bottlenecks. These runs do not revalidate autosave or territory-change hitches, visual equivalence, or the full browser suite, so they cannot by themselves complete #47.

## Current drawing-path profile, 2026-10-18

Profiled the same runtime source (`1f8e057`; the checkout at `bdc3d92` adds documentation only) on the reference hardware, with the 20-minute seed-2024 colony, quality 1, 1920×1080 and pinned noon/no rain. Linked source maps map V8 samples back to the application and pinned PixiJS 8.22.0 source. The profiler samples at 200 μs; its timings include profiling overhead and do not replace the unprofiled acceptance tables above.

```sh
SETTLERS_SOURCEMAP=1 npm run build
node scripts/bench-render.mjs --minutes 20 --modes running --speed 1 --zooms 0,3 --profile 0,3 --ms 10000
```

The profiled CPU p95 is 19.8 ms at zoom 0.55 and 17.6 ms at 1.0. [Source-mapped profile summaries](benchmarks/2026-10-18/drawing-profile.json) retain the weighted sample totals, top self/inclusive functions, source locations, raw-profile paths and SHA-256 hashes. Raw DevTools profiles remain in `output/bench/2026-10-18T08-50-38-117Z/`. Each sample is weighted by its V8 `timeDelta`; the following categories partition only samples whose stack contains the application's `draw`. They exclude idle/program/GC samples without that stack. Individual painter attribution can be blurred by V8 inlining, so the omission probes below provide an independent check.

| Share of sampled drawing time          | Zoom 0.55 | Zoom 1.0 |
| -------------------------------------- | --------- | -------- |
| Pixi submission (`presentation.end`)   | 49.9%     | 54.5%    |
| Object list, sort and dispatch         | 19.0%     | 8.5%     |
| Trees and rocks, direct painter stacks | 18.0%     | 14.6%    |
| Buildings, direct painter stacks       | 3.9%      | 12.3%    |
| Settlers, direct painter stacks        | 0.7%      | 0.9%     |
| Other drawing                          | 8.6%      | 9.1%     |

Within Pixi submission, rebuilding render instructions and Graphics geometry is substantial: `_buildInstructions` accounts for 27.7% / 26.3% of sampled drawing time, and `buildContextBatches` for 21.4% / 23.4%. These inclusive shares overlap and must not be added. `addTextureToGeometryData`, fill-style preparation, batch breaking and allocation/collection appear prominently. Few draw calls do not imply little CPU geometry work: the current renderer still rebuilds its six or seven Graphics runs each frame.

Controlled probes used the real game and hardware renderer, with temporary changes applied only to the browser-routed development bundle. They omitted one category at a time, surrounded by baseline windows, using five-second samples after one second of warmup. Simulation advanced by five seconds in every running window; paused windows advanced none, and no window reached victory or had an open modal. [Probe results and protocol](benchmarks/2026-10-18/drawing-probes.json) retain all 28 initial windows plus three camera-verification windows, including noisy ones. The throwaway harness remains under `output/profile-current-renderer/`; no diagnostic branch is added to game source.

| Probe                                      | Adjacent baseline draw mean, zoom 0.55 | Probe draw mean, zoom 0.55 | Adjacent baseline draw mean, zoom 1.0 | Probe draw mean, zoom 1.0 |
| ------------------------------------------ | -------------------------------------- | -------------------------- | ------------------------------------- | ------------------------- |
| Omit trees and rocks                       | 11.0–11.4 ms                           | 4.9 ms                     | 11.2–13.0 ms                          | 7.5 ms                    |
| Omit buildings                             | 11.4–19.9 ms                           | 13.5 ms                    | 11.2–12.4 ms                          | 10.2 ms                   |
| Omit settlers                              | 14.5–19.9 ms                           | 13.3 ms                    | 12.4–13.2 ms                          | 11.1 ms                   |
| Omit GPU submission, keep painters         | 14.5–15.1 ms                           | 5.6 ms                     | 12.7–13.2 ms                          | 4.8 ms                    |
| Skip depth sorting                         | 15.1–15.8 ms                           | 15.4 ms                    | 12.7–13.0 ms                          | 10.7 ms                   |
| Verified paused camera pan ±12 world units | Camera clamped                         | Not a pan test             | 9.3–11.6 ms                           | 11.3 ms                   |

Omitting nature saves about 6.3 / 4.6 ms against the means of its adjacent controls and drops vertex uploads from about 525 to 156 KB/frame at far zoom and 380 to 208 KB/frame at default zoom. This is the clearest candidate for reuse of unchanged geometry. It is an upper-bound diagnostic: the probe removes artwork and its GPU fill, so those savings are not a promise that retaining the same visible trees and rocks will achieve the same result. Omitting submission likewise removes all GPU work and is not a playable alternative.

Baseline drift is substantial, especially around the far-zoom building/settler probes. Small timing differences should not be treated as isolated savings. Skipping sort also changes depth order and batching (including draw-call counts), so its default-zoom improvement cannot be assigned entirely to sorting. The far-zoom camera probe was clamped because the full map fits, so it is excluded as evidence of actual movement. A separate default-zoom repeat verifies camera x moving from 192 to 216 world units: drawing is 11.3 ms, within the 9.3–11.6 ms range of its adjacent controls, with unchanged sprite/build/draw-call/upload counts. Its CPU p95 is 18.4 ms versus 13.8–17.5 ms in the still controls, so these noisy samples do not establish a zero-cost camera. The repeat does not establish a separate camera penalty beyond the baseline variation, and current code already applies camera transforms to layer containers rather than each object. A single world container has no demonstrated benefit here.

The resulting ticket plan is:

- **#42:** provide stable ownership and reuse for native object geometry, preserving the current depth order, cached textures, layer boundaries and batching. This is the shared seam needed to avoid rebuilding nature's geometry every frame.
- **#44:** migrate trees and rocks through that seam first, updating only changed tiles, sway frames and presentation thresholds. Measure the unchanged-artwork result against the whole-game CPU/GPU budgets.
- **#43:** retire the single-world-transform proposal as superseded/unjustified by current profiles; camera and input behavior remain requirements of #42/#44.
- **#46:** re-profile remaining building cost after #44 before committing to a complete retained-building migration. The default-zoom profile makes buildings a more plausible next target than the current settler count.
- **#45:** defer a full settler migration; remeasure a representative 100-moving-settler fixture after #44 before promoting it to implementation. The current 16-unit profile does not establish that migration's payoff.

#45 and #46 are conditional follow-ups, not mandatory implementation gates for #47. Final acceptance remains governed by the actual CPU/GPU budgets and existing interaction/visual constraints, not by completing every part of the pre-#54 architecture.
## Original diagnosis, 2026-10-16 (before PR #54)

The frame was CPU-bound in rendering. The simulation, HUD and minimap together cost about 1 ms per frame at 1× speed. The old world renderer re-described every visible object each frame through intercepted Canvas2D calls, mapped them onto a positional pool of PixiJS objects, and made PixiJS re-batch the whole scene. That work grew with the number of visible objects (∝ 1/zoom²) and roughly doubled while the colony was running. Three cheap fixes halved the cost, but the proposed next step was a retained world scene. A prototype of that scene on this machine cost 2–5 ms per frame. The diagnosis and plan below record that earlier renderer; they are not a description of current main.

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
