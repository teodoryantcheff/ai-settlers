# Permanent exploration fog

Status: confirmed design, ready for implementation. Synthesized from the design interview confirmed on 2026-10-21. This local specification does not implement gameplay.

## Problem Statement

Players currently see the entire map and can plan around distant resources before reaching them. Expansion grows territory but offers little discovery. Players who want exploration need unknown terrain and resources to become known through deliberate colony growth, while players who prefer unrestricted planning should retain that experience.

A visual veil alone would be insufficient. Placement feedback, the minimap, resource overlays, advisor recommendations and autoplay could still expose hidden resources.

## Solution

Offer an “Exploration fog” choice when creating a colony, initially off by default and fixed for that colony. Completed buildings permanently reveal nearby land. Headquarters provides the starting view; expansion reveals further terrain and resources. Discovery crosses water and mountains independently of territory ownership.

A static, opaque, softly edged, muted veil conceals unexplored land on the world map and minimap. Discovery applies consistently throughout player information, placement feedback, advisor guidance and autoplay. The colony's own settlers remain visible and inspectable without revealing land through movement.

Guarantee a viable starting basic economy and preserve discoveries exactly through saves and loads.

## User Stories

1. As a player, I want to choose exploration fog when starting a colony, so that I can choose whether discovery is part of the game.
2. As a player, I want unrestricted play to remain the initial default, so that the existing planning experience remains readily available.
3. As a player, I want the exploration choice fixed for my colony, so that its discovery rules stay consistent.
4. As a player, I want headquarters to reveal my starting surroundings, so that I can make informed initial building decisions.
5. As a player, I want reachable trees initially revealed, so that I can establish timber production.
6. As a player, I want reachable quarry stone initially revealed, so that I can replenish construction supplies.
7. As a player, I want a usable food source initially revealed, so that I can establish a basic economy without blind expansion.
8. As a player, I want ore and gold to be discoverable through expansion, so that exploration reveals meaningful economic opportunities.
9. As a player, I want completed buildings to reveal their surroundings, so that colony growth advances discovery.
10. As a player, I want construction sites to wait until completion before revealing land, so that discovery follows completed investment.
11. As a player, I want discovery to cross water and mountains, so that I can find fishing grounds and mineral deposits.
12. As a player, I want discovery to cover a building's working reach and nearby expansion opportunities, so that its surroundings are understandable.
13. As a player, I want a manned outpost to reveal farther than an unmanned one, so that manning it expands discovery as well as territory.
14. As a player, I want discoveries to survive demolition, territory loss and removal of an outpost's soldier, so that exploration is permanent.
15. As a player, I want revealed land distinguished from owned land, so that visibility does not imply permission to build.
16. As a player, I want unexplored terrain and resources concealed on the world map, so that discovery remains meaningful.
17. As a player, I want the minimap to respect discovery, so that it does not expose the hidden map.
18. As a player, I want hover details and map overlays to respect discovery, so that they do not expose hidden resources.
19. As a player, I want placement previews to consider only discovered resources, so that probing with a building tool cannot detect hidden deposits or rocks.
20. As a player, I want resource-dependent construction to require known supporting resources, so that its validity agrees with the evidence shown to me.
21. As a player, I want completed producers to use resources discovered within their working area, so that completion can uncover additional usable supplies.
22. As a player, I want my settlers visible and inspectable over unexplored land, so that I can follow their jobs and movement.
23. As a player, I want settler movement to leave discovery unchanged, so that logistics does not replace deliberate exploration.
24. As a player, I want the advisor to recommend known resources or explain the need to explore, so that its guidance uses information available to me.
25. As a player, I want general building and recipe references available, so that exploration does not hide how the economy works.
26. As an autoplay observer, I want autoplay to use the same discovered information as the player, so that its strategy is understandable and reproducible.
27. As an autoplay observer, I want autoplay to explore when a required resource is unknown, so that it can progress beyond the starting area.
28. As a player, I want guidance to explain missing expansion supplies, so that I understand why exploration has stalled.
29. As an autoplay observer, I want the known economy to keep running while expansion is unaffordable, so that exploration can resume when supplies permit it.
30. As a player, I want checkpoints, autosaves and exported saves to retain every discovery and the exploration choice, so that continuation preserves my colony's history.
31. As a player, I want invalid discovery data rejected before loading changes my colony, so that failures cannot partially replace live state.
32. As a player, I want fog to respect camera controls, rendering quality and Reduced Motion, so that exploration fits the existing presentation settings.

## Implementation Decisions

- Maintain authoritative, deterministic discovery state separately from territory ownership. Discovery is permanent for the lifetime of a colony.
- Store the immutable exploration choice in colony state. Unrestricted colonies retain full map information and existing planning behavior.
- Initialize discovery from completed headquarters. Reveal additional land on building completion and when outpost manning increases reach. Construction sites and moving settlers do not reveal land.
- Reveal a circular area across all terrain types. The radius is the greater of claim reach and working reach, plus two tiles. Buildings with neither reach reveal four tiles. Determine working reach from actual working-area geometry so that diagonal or offset work areas are fully covered.
- Use an outpost's current unmanned or manned reach for additional discovery. Removing a soldier, demolishing a building or losing ownership never erases discoveries.
- Keep existing ownership, terrain, spacing, transport and harvesting rules except for discovery-aware placement. Seeing a site does not grant building permission.
- Guarantee reachable trees, quarry stone and a usable food source within the headquarters' starting revealed area for fog-enabled colonies. Check usable opportunities rather than merely counting resource tiles. Ore and gold may require exploration. Generation remains deterministic for the same seed and colony options.
- Apply a shared discovery policy to world objects, minimap content, hover details, overlays, resource highlights, placement feedback, advisor queries and autoplay planning. A drawn veil is insufficient by itself to protect hidden information.
- Resource-dependent previews and authoritative placement commands consider discovered resources only. Unknown sites must not expose hidden terrain or resource-specific rejection details. Preserve applicable placement-check ordering after the discovery guard.
- Once completed, a producer reveals its full working area and can use newly discovered resources there. Keep actual resource state distinct from knowledge-filtered planning evidence.
- Advisor guidance targets known resources and recommends exploration when required resources are unknown, without naming hidden locations.
- Autoplay uses known resources and explores the frontier when necessary. Replace global hidden-deposit targeting rather than merely hiding its presentation. Exploration uses existing construction costs and known information. While expansion is unaffordable, continue the known economy, explain shortages and retry when supplies permit. The exact deterministic frontier-scoring algorithm remains an implementation choice subject to playthrough validation.
- Persist the exact revealed area and exploration choice through every save path. Surviving buildings cannot reconstruct historical discoveries. Validate dimensions, allowed values and semantic consistency before replacing live state.
- Follow ADR-0006's current-structure save policy: no migrations, historical aliases or load-time defaults. Missing or invalid required discovery data fails validation. Preserve atomic replacement, runtime live bindings and exact seeded continuation.
- Domain logic owns discovery changes; presentation owns fog drawing. Completion, manning and world replacement refresh affected consumers without rendering advancing simulation or consuming simulation RNG.
- Use production PixiJS v8 WebGL rendering. Reuse cached GPU resources on unchanged frames and invalidate when discovery changes or cached content becomes stale. Offscreen preparation is allowed; Canvas world rendering and per-frame raster uploads are not.
- The veil conceals terrain, resources and their indicators while preserving visibility and inspection of the colony's own settlers. Soft edges must not expose unknown terrain. Preserve camera/input coordinates, scene ordering relationships and sprite anchors.
- Keep the veil static and compatible with full and economical rendering quality and Reduced Motion. Preserve visible graphics-failure reporting and recovery behavior.
- Extend colony startup, domain assembly, persistence, map interaction, presentation and guidance within their established ownership boundaries. Keep development scenarios excluded from release builds. Update the current mechanics and architecture specification when implementing the feature.

## Testing Decisions

- Use the existing real-subsystem graph composed through `tests/helpers/game.cjs` as the primary seam. Exercise startup, normal domain commands, stepping, placement queries and save import/export together. No new cross-cutting test harness is proposed.
- Use existing typed factory `internals` hooks only when normal entry points cannot exercise a required behavior. Keep test-only access out of the runtime surface.
- Test observable discovery, permission, evidence, guidance, persisted state and continuation. Avoid tests that reproduce radius loops, cache internals or frontier scoring.
- Follow existing work-area and placement-evidence tests for agreement between previews and actual construction or production. Hidden supporting resources must not make placement valid and must become usable after discovery.
- Cover starting discovery, circle boundaries, map edges, water, mountains, building reach categories, construction completion, overlapping reveal areas, outpost manning and permanence after demolition or soldier removal.
- Compare colonies differing only in hidden terrain or resources: player-facing information and planner choices must not change solely because hidden information changed. Cover minimap, hover, overlays, resource recommendations and placement rejection details.
- Verify that settlers remain visible and inspectable while moving through unexplored land without changing discovery.
- Follow existing save round-trip, seeded-continuation and invalid-import tests. Include discoveries with no surviving source building, both exploration settings, checkpoints, autosaves, malformed discovery data and unchanged live state after rejected imports.
- Check deterministic generation across multiple seeds and actual usability of starting trees, quarry stone and food within the revealed area. Verify unrestricted play retains its behavior.
- Put full autoplay discovery and balance playthroughs in the soak suite. Cover unknown required resources, frontier expansion, finite supplies, temporarily unaffordable expansion, saving mid-exploration and continued progress toward the gold objective. Investigate stranded colonies as failures requiring diagnosis.
- Use existing Playwright fixtures for the colony-start choice, camera and input behavior, settler inspection, minimap concealment and save/load presentation. Visually verify the real WebGL veil, soft edges, zoom, layering, quality settings and Reduced Motion.
- During implementation, run focused `npm test` selections and then the full routine suite. Run simulation/balance soak tests and browser/visual checks for the known simulation and rendering impact, following README's validation and rendering-profile contract. Ask for a GPU-specific profile before any benchmark and leave the profiles file unchanged.

## Out of Scope

- Temporary visibility, remembered snapshots or land becoming hidden again.
- Enemies, combat, stealth, line-of-sight obstruction or scouting units.
- Discovery from moving settlers or new carrier scouting jobs.
- Toggling exploration on an existing colony or enabling it by default initially.
- Changes to ownership, construction costs or core logistics and harvesting beyond discovery-aware placement.
- Animated fog, replacement rendering infrastructure or unrelated artwork changes.
- Save migrations, compatibility readers or automatic repair of invalid discovery data.
- Issue publication or gameplay implementation as part of this local specification task.

## Further Notes

Use the glossary terms **unexplored land** and **revealed land**. Neither means unowned or owned land.

This is a medium-sized feature spanning generation, simulation, persistence, presentation, interaction and automation. Drawing the veil is a limited part of the work; consistent information concealment and viable autoplay exploration are the main integration risks.

The complete design was confirmed by the user. The established subsystem harness and browser fixtures are the proposed testing seams; no additional seam is needed. Frontier scoring, storage encoding and GPU cache representation remain implementation choices within these requirements.

## Confirmed soft-edge refinement

Confirmed in the follow-up design interview on 2026-10-21:

- Replace the visible tile staircase with smooth, rounded contours and a broad blurred transition, about two world tiles wide. Its screen width follows zoom.
- Keep unknown terrain completely opaque. Feather into discovered land only; discovery and placement rules remain unchanged, including on partially veiled discovered land.
- Keep owned territory and building silhouettes completely clear, smoothly narrowing the fade where necessary.
- Give the minimap the same rounded silhouette with a narrower blur suited to its scale.
- Preserve the static muted veil, Reduced Motion behavior and cached WebGL rendering.
