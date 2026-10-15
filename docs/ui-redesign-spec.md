# Whole-interface redesign for an informative settlement atlas

Design: confirmed on 2026-10-14, including all 28 interview recommendations and the consolidated brief.

Historical implementation contract: its accounting, durable observations and session workflows remain in force. [ADR-0004](adr/0004-full-map-and-game-windows.md) revises the spatial presentation; [SPEC.md](../SPEC.md) documents the current game and [whole-session acceptance](game-first-ui-acceptance.md) records the integrated revision.

Testing seams: confirmed by the user during specification synthesis.

Publication: this is a historical design baseline. Track new specifications, dependencies and implementation status in [GitHub Issues](https://github.com/teodoryantcheff/ai-settlers/issues), following [the tracker conventions](agents/issue-tracker.md).

## Problem Statement

The following problem statement records the production baseline at design confirmation on 2026-10-14. It is historical context; [SPEC.md](../SPEC.md) describes the implemented game, and [the acceptance record](game-first-ui-acceptance.md) preserves subsequent validation evidence.

Players can build and observe a working colony, but the interface distributes important information across compact panels, hover text, transient notices, and a long help dialog. It is difficult to understand the colony's overall condition, reconcile resource quantities, distinguish production shortages from delivery delays, or follow evidence to a useful intervention. Some wording is misleading: queued construction deliveries can be described as on the way before a carrier is assigned, and spatially valid placement previews do not communicate affordability consistently.

The surrounding experience is incomplete. Welcome provides a single start action, saves use one browser-local slot, autosave failures can be silent, and there are no production Economy/Logistics analysis views, searchable reference, dedicated About, or persistent activity history. The current development studies illustrate alternatives with sample measurements and in-memory controls rather than working production features.

The entire interface needs a cohesive visual identity that belongs with the painted settlement, supports dense economic information, and remains comfortable to use. This includes normal play and every menu, dialog, onboarding, save, help, loading, failure, and victory state.

## Solution

Create a warm, precise settlement-atlas interface for players who understand the premise and want to examine the economy in depth. Use earthy colors, illustrated resources and buildings, restrained brass detail, serif display headings, and readable sans-serif information with aligned numerals. Dense data sits on quiet warm-ivory surfaces, framed by deep forest-green navigation rather than heavy decorative texture.

Keep play map-led: a compact resource bar, slim navigation, a large map, one docked inspector, and expandable secondary details. Provide dedicated Economy and Logistics views, clear resource accounting, measured rates and history, an attention list for unresolved issues, and persistent activity. Connect colony condition to evidence, contributing buildings, map locations, and available actions.

Complete the whole session experience with Continue/New Colony/Load, named manual saves and separate autosave, file export/import, grouped settings, contextual explanations, searchable reference, About and provenance, visible recovery paths, and useful victory statistics. Support keyboard operation, predictable focus, Reduced Motion, both rendering qualities, and desktop layouts at 1440×900 and 1280×720. Preserve existing economy and progression rules and deterministic save continuation.

## User Stories

1. As a player, I want every screen to share an identity drawn from the painted settlement, so that the interface feels like part of the game.
2. As an economy-focused player, I want crisp numbers, readable labels, and aligned tables, so that I can compare information quickly.
3. As a player using a 1440×900 display, I want a spacious map with dense but comfortable summaries, so that I can observe the colony while managing it.
4. As a player using a 1280×720 display, I want navigation and optional summaries to adapt before the map is squeezed, so that all core workflows remain usable.
5. As a player, I want hover, focus, selection, and disabled states to be visually distinct, so that I know what I can do and what is selected.
6. As a player, I want illustrated resources and building previews beside clear names, so that I can recognize choices without relying on icons alone.
7. As a player, I want the map to remain my main workspace, so that settlement building and observation remain central to play.
8. As a player, I want a compact resource bar and persistent colony summaries, so that I can monitor the economy without opening several panels.
9. As a player, I want one docked inspector, so that selecting a building does not create overlapping windows to manage.
10. As an experienced player, I want secondary information and guidance to be expandable or collapsible, so that I can control information density.
11. As a player, I want clear navigation between the map, Economy, Logistics, colony management, attention, and activity, so that I can find the appropriate workspace.
12. As a player, I want the current simulation state and speed to remain obvious, so that I know whether the colony is advancing.
13. As a player, I want the resource bar to show stored stock consistently, so that its numbers have one stable meaning.
14. As a player, I want resource details to distinguish stored stock, reserved stock, and available stock, so that I know which goods are already promised.
15. As a player, I want reservations identified as part of stored stock, so that I do not double count physical goods.
16. As a player, I want goods in transit separated from queued or assigned deliveries, so that I know which goods have actually been collected.
17. As a player, I want producer input stock and output awaiting collection shown separately, so that I can understand material held outside storage.
18. As a player, I want construction, contract, and upgrade spending and refunds distinguished from production and consumption, so that I can reconcile stock changes.
19. As a player, I want transfers distinguished from creation and consumption of goods, so that moving goods does not falsely change economic throughput.
20. As a player, I want an explanation when an action can reclaim reservations for optional warehouse transfers, so that its affordability agrees with the displayed accounting.
21. As a player, I want rates expressed in goods per simulation minute, so that comparisons remain meaningful at every simulation speed.
22. As a player, I want 30-second, 2-minute, 10-minute, and lifetime reporting windows where meaningful, so that I can compare immediate performance with longer trends.
23. As a player, I want the actual observation interval shown for each measurement, so that short or missing coverage does not mislead me.
24. As a player, I want unavailable historical measurements labeled as unavailable, so that absence of evidence is not presented as zero activity.
25. As a player, I want measured production separated from nominal capacity, so that a theoretical maximum is not mistaken for a forecast.
26. As a player, I want capacity explanations to identify upgrades and limiting conditions, so that I can understand why realized output differs.
27. As a player, I want production, ingredient consumption, input arrivals, and output delivered to storage reported separately, so that I can locate the stage limiting a chain.
28. As a player, I want a pickup to remain distinct from a completed delivery, so that throughput reports reflect arrivals.
29. As a player, I want ten simulation minutes of recent history, so that I can see the effect of an intervention over time.
30. As a returning player, I want recent history and lifetime totals to survive save/load, so that continuing does not erase economic context.
31. As a player, I want colony lifetime production to retain work done by demolished buildings, so that removing a building does not rewrite the colony's history.
32. As a returning player, I want paused and offline time excluded from simulated measurements, so that history remains faithful to actual play.
33. As a player opening an older save, I want newly supported measurements to begin with explicit coverage, so that the game does not invent a past it did not record.
34. As a player, I want Economy to lead with resource balances and production chains, so that I can assess the colony's economic condition.
35. As a player, I want a resource drilldown to identify contributing producers and consumers, so that I can follow an aggregate result to its causes.
36. As a player, I want Logistics to lead with deliveries, carrier workload, and waiting goods, so that I can assess transport performance.
37. As a player, I want queued jobs, assigned carriers, collected cargo, and completed deliveries distinguished, so that transport status is accurate.
38. As a player, I want actual routes and supporting evidence where available, so that I can investigate delays without speculative explanations.
39. As a player, I want uncertain or unavailable transport evidence labeled clearly, so that I do not mistake an estimate for an observation.
40. As a player, I want selecting a report contributor to open its details without moving the camera, so that I can inspect evidence before changing spatial context.
41. As a player, I want an explicit Locate action, so that I can move from evidence to the affected place when I choose.
42. As a player, I want filters and reporting windows preserved when returning to analysis, so that investigating a building does not reset my work.
43. As a player, I want camera position and selection preserved when switching workspaces, so that I can resume map observation in context.
44. As a player, I want pending placement canceled when I leave the map, so that returning cannot accidentally build something.
45. As a player, I want an explanation when a selected building disappears, so that stale details do not masquerade as a live entity.
46. As a player, I want access to a demolished building's former location or related surviving buildings, so that historical evidence remains useful.
47. As a player, I want the building catalog searchable and grouped by production chain, so that I can find a building efficiently.
48. As a player, I want a building's purpose, cost, recipe, and placement requirements visible before selection, so that I can choose intelligently.
49. As a player, I want placement feedback to separate terrain validity, ownership, affordability, and nearby-resource requirements, so that I understand why a location succeeds or fails.
50. As a player, I want failed requirements explained beside the placement preview, so that I can correct the problem without trial and error.
51. As a player, I want repeat placement to remain efficient, so that better information does not make construction cumbersome.
52. As a player, I want road plans to show their cost and rejection reasons before committing, so that I understand the proposed route.
53. As a player, I want inspectors to lead with current status and its explanation, so that the most useful information is immediately visible.
54. As a player, I want relevant controls, stocks, production progress, and performance together, so that I can act on what I learn.
55. As a player, I want inspectors adapted to producers, storage, outposts, and construction, so that each presents useful information instead of empty generic sections.
56. As a player, I want existing production pause, priority, and warehouse stock-target controls retained, so that the redesign preserves my management capabilities.
57. As a player, I want demolition refunds and salvage explained precisely before confirmation, so that I understand the consequences.
58. As a player, I want protected structures and territory consequences explained, so that demolition rules are predictable.
59. As a player, I want deliberate confirmation before demolition, so that an accidental selection does not destroy a building.
60. As a player, I want persistent production problems collected in an attention list, so that important issues remain discoverable after notifications disappear.
61. As a player, I want diagnosis to connect condition, evidence, affected places, and available actions, so that I can make an informed intervention.
62. As a player, I want missing supply distinguished from delayed delivery, so that I address the actual problem.
63. As a player, I want urgent failures, persistent bottlenecks, and informational events differentiated, so that I can prioritize attention.
64. As a player, I want intentional pauses, satisfied demand, and ordinary brief waits excluded from alarms, so that attention remains useful.
65. As a player, I want repeated notifications coalesced and alerts tied to meaningful state changes, so that fast simulation speeds do not overwhelm me.
66. As a player, I want resolved issues removed from active attention but retained in history, so that I can see what changed.
67. As a returning player, I want the latest 200 significant events retained per colony across saves, so that I can recover session context.
68. As a player, I want relevant notifications and history entries to lead to affected places, so that feedback supports action.
69. As a player, I want unavailable actions explained with the conditions that would enable them, so that disabled controls are informative.
70. As a player, I want sound cues paired with visible feedback, so that I receive essential information when muted or audio is unavailable.
71. As a first-time player, I want welcome to explain production, logistics, and the 200-gold objective concisely, so that I understand what I am starting.
72. As a returning player, I want Continue emphasized when a colony exists, so that resuming is straightforward.
73. As a player, I want New Colony and Load clearly available from welcome, so that I can choose how to start a session.
74. As a player, I want an optional colony name and reproducible seed for a new colony, so that I can identify and revisit a world.
75. As a player, I want access to settings, help/reference, and About from welcome, so that these are available before play.
76. As a player, I want unsaved progress protected before starting or loading another colony, so that navigation does not silently discard my work.
77. As a player, I want named manual saves separate from autosave, so that I can preserve intentional checkpoints.
78. As a player, I want save metadata showing colony name, seed, save time, simulation age, gold, and building count, so that I can identify the correct checkpoint.
79. As a player, I want explicit rename, overwrite, delete, export, and import actions, so that save management is understandable.
80. As a player, I want destructive save replacements and deletions confirmed, so that mistakes do not erase progress.
81. As a returning player, I want existing saves preserved during migration, so that the redesign does not strand my colonies.
82. As a player, I want imports fully validated before replacing the colony, so that malformed data cannot damage live progress.
83. As a player, I want a failed save to preserve the previous valid save and visibly report failure, so that I know whether my progress is safe.
84. As a player, I want file export to work even when browser storage is full, so that I have a recovery path.
85. As a player, I want a compact gold objective persistently visible, so that the colony's goal remains legible during management.
86. As a player, I want Journey, contracts, upgrades, and autoplay grouped coherently, so that guidance and optional opportunities are easy to find.
87. As a player, I want progress, costs, rewards, and availability shown for opportunities, so that I can evaluate their trade-offs.
88. As an experienced player, I want Journey and explanatory guidance collapsible, so that the interface becomes quieter without hiding capabilities.
89. As a player, I want autoplay's state persistently obvious, so that I know when the colony is making decisions for me.
90. As a player reaching victory, I want elapsed simulation time, settlement statistics, and relevant economic achievements, so that the celebration explains what my colony accomplished.
91. As a player reaching victory, I want Continue Colony and Return Home, so that I can keep managing or finish the session safely.
92. As a player continuing beyond victory, I want ordinary analysis, notifications, and management to keep working, so that reaching the objective does not break the colony.
93. As a player, I want resources, recipes, statuses, and settings explained in context, so that I can understand them without leaving my task.
94. As a player, I want a searchable reference covering buildings, recipes, resources, transport, expansion, progression, controls, and diagnostic terms, so that detailed answers are easy to find.
95. As a player, I want contextual explanations linked to fuller reference articles, so that I can choose the depth of help I need.
96. As a player, I want explanations consistent with alternative ingredients, legacy recipes, and local well support, so that the reference describes the actual colony.
97. As a player, I want About to present the premise, tribute status, version, credits, artwork provenance, and relevant acknowledgments, so that I can understand the game and its origins.
98. As a player, I want settings grouped into gameplay/interface, visuals/accessibility, and audio, so that I can find preferences predictably.
99. As a player, I want settings changes to provide immediate feedback and clear persistence, so that I understand what has changed and what will be remembered.
100. As a player, I want simulation to continue during building, inspection, and Economy/Logistics browsing, so that these remain live management workflows.
101. As a player, I want blocking utility screens to pause simulation and restore the original running state when closed, so that reading or managing saves does not cost unnoticed simulation time.
102. As a player, I want nested dialogs to preserve the original pause state, so that closing an inner dialog cannot accidentally resume the colony.
103. As a keyboard user, I want every interface action reachable with predictable focus, so that I can use menus, reports, and management controls without a pointer.
104. As a keyboard user, I want Escape to dismiss the nearest temporary layer and dialogs to restore focus, so that I can navigate without losing my place.
105. As a player, I want explanations available without hovering and statuses conveyed by text or symbols as well as color, so that information does not depend on one input method or visual cue.
106. As a player sensitive to motion, I want restrained animation and Reduced Motion respected throughout, so that the richer interface stays comfortable.
107. As a player, I want readable contrast and usable controls at both supported rendering qualities, so that visual preferences do not impair management.
108. As a player, I want loading to report meaningful stages, so that I understand why the colony is not ready yet.
109. As a player encountering a graphics, artwork, import, or save failure, I want a specific explanation and applicable recovery action, so that I know what to do next.
110. As a player, I want the current colony preserved whenever recovery permits and gameplay paused when graphics are unavailable, so that presentation failures do not silently lose or advance progress.
111. As a player, I want empty reports, missing observations, unavailable actions, and deleted-entity states designed as carefully as normal screens, so that edge cases remain understandable.
112. As a player, I want the production interface to use actual colony measurements throughout, so that polished charts and reports remain trustworthy.

## Implementation Decisions

- Preserve the economy-analysis audience and the accepted map-led architecture. The earlier restriction to a less game-like presentation has been explicitly revised to the warm settlement-atlas treatment; analytical clarity remains mandatory.
- Build the production workspace around compact resource summaries, slim navigation, a large map, and one docked inspector. Economy and Logistics receive dedicated analysis space. Do not implement overlapping floating windows as the primary workflow or adopt a development variant wholesale.
- Apply a coherent presentation system across every normal, empty, unavailable, confirmation, loading, error, and victory state. Use warm ivory information surfaces, deep forest-green navigation, muted brass accents, serif display headings, sans-serif body text, aligned numerals, illustrated resources/buildings, and restrained framing ornament.
- Target comfortable density at 1440×900 and support 1280×720. Adapt by collapsing navigation and optional summaries before reducing map usability; do not achieve density through tiny body text.
- Keep source interface rendering in the existing DOM-based presentation, with production PixiJS v8 WebGL world rendering. Preserve camera/input coordinates, sprite anchors, scene ordering, texture reuse, terrain invalidation, and visible renderer-failure reporting. Cached artwork, measurement, terrain preparation, and the minimap may use Offscreen Canvas; Canvas world rendering and per-frame raster uploads remain prohibited.
- Reuse existing subsystem factories, live runtime bindings, and the domain-event flow. Likely changes span the HUD, interaction, progression presentation, application/session handling, persistence, measurement support, and entry-page presentation. Keep related session/navigation complexity behind a small coherent interface rather than distributing pause and focus rules across unrelated controls.
- Add the observation support needed for colony reports, durable totals, longer recent history, and activity. Observation and cosmetic behavior must not consume simulation RNG, advance the simulation, influence economic decisions, or change saved continuation. Exact module decomposition and storage structures are implementation choices constrained by this contract.
- Use canonical glossary meanings. Stored stock includes reserved stock; available stock subtracts reservations. Goods in transit have been collected and are physically carried. Producer input stock and output awaiting collection are outside storage. Never add reserved stock again when calculating physical goods.
- Preserve existing reservation behavior: optional uncollected warehouse transfers can be reclaimed for eligible actions, while committed construction/ingredient reservations remain protected. Explain reclaiming at the action that uses it rather than redefining available stock globally. Affordability must respect reachable storage and existing domain rules.
- Distinguish producer creation/consumption, input arrivals, and producer output delivered to storage. Count output delivery at arrival, not assignment or pickup; exclude initial storage and warehouse transfers from producer throughput. Present construction/contract/upgrade spending and refunds separately, and distinguish internal stock movements from creation and consumption.
- Default rates to goods per simulation minute and provide 30-second, 2-minute, 10-minute, and lifetime windows where meaningful. Show actual coverage and label estimates or unavailable data. Nominal capacity must be separate from observed output and explain relevant upgrades and limiting conditions.
- Retain ten simulation minutes of recent chart history and lifetime colony totals. Persist both through save/load and preserve colony totals after demolition. Older saves begin explicit new coverage for measurements they lack; different metrics may have different coverage. Paused, modal, hidden, and offline intervals must not fabricate simulation activity.
- Extend the validated save schema as necessary for observations, bounded history/activity, colony identity, and save metadata, while preserving accepted historical saves, RNG state, timers, jobs, reservations, routes, and live-binding replacement. Validate bounds and all imported data before adopting storage or live state; do not blindly merge imported objects into runtime objects.
- Provide named manual checkpoints and separate autosave, with colony name, seed, save time, simulation age, gold, and building count. Support rename, confirmed overwrite/deletion, file export/import, visible save health, legacy migration, and protection of unsaved progress.
- Preserve previous valid save data on failure. Export must serialize the current colony independently of a successful browser-storage write, so storage quota failure does not remove the recovery route. Never report success for a failed manual save or autosave.
- Navigate from overview to resource/issue, contributor, and location. Selecting a contributor opens details; Locate explicitly moves to the map. Preserve camera, selection, filters, and reporting windows across workspace changes, and cancel pending placement when leaving the map. Removed entities receive an explanatory state with former-location or related-entity navigation.
- Make the building catalog searchable, grouped by production chains, and informative before tool selection. Show purpose, costs, recipes, and placement requirements. Placement feedback distinguishes spatial validity, ownership, affordability, and required resources; report failures beside the preview. Keep repeated placement efficient and show road costs and rejection reasons before commitment.
- Adapt inspectors to producers, storage, outposts, and construction. Lead with status and evidence, then relevant actions, stock, progress, and performance. Preserve production pause, priority, and warehouse-target controls; keep live updates from destroying focused input controls or keyboard interaction.
- Preserve demolition mechanics and deliberate confirmation. Explain per-good rounded-down half-cost refunds for completed buildings, half delivered-material refunds for unfinished sites, separate local-stock salvage, protected structures, and territory consequences. Do not replace precise quantities with an unconditional promise of half the planned cost.
- Distinguish queued jobs, assigned carriers, collected cargo, and completed deliveries in Logistics. Use actual current routes and measurements where available; label missing evidence. The current engine does not record complete historical routes or measured ETAs, so do not manufacture them from interface fixtures or unvalidated assumptions.
- Connect diagnosis to evidence and actions; distinguish missing supply from delivery delays. Separate urgent failures, persistent bottlenecks, and information. Do not alarm for deliberate production pauses, satisfied demand/reserves, or ordinary brief waits. Coalesce repetitive notices and preserve existing restrained feedback behavior at high simulation speeds.
- Keep unresolved issues in attention and retain the latest 200 significant events per colony across saves. Resolved issues leave active attention but remain in history. Historical references remain understandable when the original entity has disappeared. Explanations identify why actions are unavailable and what would enable them.
- Welcome provides Continue, New Colony, Load, settings, reference/help, and About. Emphasize continuation when a colony exists; explain production/logistics and the 200-gold objective concisely. New Colony offers an optional name and reproducible seed without altering economy rules.
- Keep the gold objective compactly visible and group Journey, contracts, upgrades, and autoplay coherently. Make guidance collapsible while retaining discoverability; show progression, opportunity costs/rewards, availability, and persistent autoplay state. Victory presents simulation age, settlement statistics, and relevant economic achievements, with safe continuation or return home.
- Provide short contextual explanations linked to a searchable reference covering buildings, recipes, resources, transport, expansion, progression, controls, and diagnosis. Keep help consistent with actual alternative ingredients and legacy recipes. Water remains local well support rather than a transported inventory good.
- About presents the game's identity, premise, tribute status, version, credits, artwork provenance, and relevant acknowledgments. Preserve original artwork, reference material, manifests, and provenance together; avoid fabricating credits or technical claims.
- Group settings into gameplay/interface, visuals/accessibility, and audio. Provide immediate feedback and clear persistence while preserving existing audio controls, visual clarity, weather, Reduced Motion, and rendering qualities 1 and 0.75. Pair restrained audio cues with visible feedback.
- Keep building, inspection, and Economy/Logistics analysis live. Welcome, save management, settings, full reference, and confirmation dialogs suspend simulation, with nested temporary layers preserving the original running/paused state. Small contextual explanations remain nonblocking. Maintain a visible simulation-state indicator throughout.
- Preserve existing shortcuts, provide keyboard access to interface actions, accessible non-hover explanations, predictable dialog focus and restoration, and nearest-layer Escape behavior. Pair color statuses with text or symbols and retain readable contrast. Respect text-input/native-control keyboard behavior.
- Loading communicates meaningful stages. Graphics, artwork, import, and save failures receive specific explanations and applicable recovery actions. Preserve the colony whenever recovery allows and stop gameplay when graphics are unavailable; remain on the production WebGL renderer and retain its established artwork fallback behavior.
- Edit source and regenerate production/development bundles with the established build workflow. Keep development scenarios and illustrative prototypes excluded from the release bundle. Update the current-game specification when mechanics or architecture are actually implemented; the confirmed design describes intended behavior rather than claiming it already exists.

## Testing Decisions

- The user confirmed the existing seams: use the actual browser game as the primary acceptance seam, with focused deterministic accounting/persistence checks through the composed real-subsystem game helper and typed factory internals hooks. Do not introduce another test-only runtime surface or a parallel simulation graph.
- Good tests assert externally meaningful behavior: quantities reconcile, statuses match actual transport stages, a chosen report window has honest coverage, controls preserve state, saves continue deterministically, and failures leave prior valid data intact. Avoid tests that merely mirror implementation structure, assert arbitrary private state, or freeze incidental markup and decorative pixel choices.
- Exercise the workspace, HUD/interaction, building catalog/inspectors, Economy, Logistics, attention/activity, progression presentation, session navigation, saves, settings, help/reference, About, loading/recovery, and victory through the browser. Await asynchronous artwork/WebGL boot before interacting or taking screenshots.
- Use the existing Playwright production-game suite as prior art for native WebGL boot, resource visibility at desktop sizes, browser keyboard behavior, real settings persistence, transactional save import, and shared map/inspector/road/Journey/load interactions. Adapt old screen-specific assertions to accepted behavior while retaining their regression intent.
- Use existing composed-game production-rate tests as prior art for measured intervals, actual sample coverage, zero-coverage unavailable states, input/output-delivery attribution, and simulation-speed independence. Extend them to ten-minute history, nonproduction accounting, bounded observation storage, demolition-independent colony totals, and read-only observation behavior.
- Use the existing persistence/state suites as prior art for seeded RNG/timer/cargo continuation, autoplay continuation, malformed import rollback, legacy-save migration, inherited-field rejection, reservation protection/reclaiming, and history validation. Add save/catalog operations and injected storage-failure cases through the existing storage seam; verify file export works when writes fail.
- Use existing interaction and economic-feedback tests as prior art for shared tool transitions, map/inspector demolition confirmation, safe world replacement, persistent blockage/recovery behavior, deliberate-pause suppression, coalescing at high speeds, and silent fresh-load baselines. Extend those behaviors to workspace changes, removed contributors, attention, and activity retention without duplicate alerts.
- Verify first-colony play end to end: optional name/seed, objective, catalog purpose/recipe/cost, valid/invalid placement, material delivery, construction completion, and Journey action.
- Verify a supply shortage and its recovery: persistent attention with evidence, no false alarm for normal idle/demand/manual pause, separate measured input/output rates, supplier drilldown, explicit Locate, and return with filters/windows intact.
- Verify transport congestion with real queued, assigned, and carrying jobs; show actual route evidence and do not call queued work in transit or completed. Keep report quantities consistent with the real colony.
- Verify resource accounting through production, consumption, transfers, construction, spending, refunds, and salvage. Check reserved stock is not double counted and optional-transfer reclaiming is explained without releasing protected promises.
- Verify precise demolition explanations for completed/unfinished sites and protected buildings; preserve colony lifetime history and useful historical navigation after an entity disappears.
- Verify named save creation, metadata, rename, overwrite/delete confirmation, separate autosave, export/import, legacy migration, quota/write failures, and restoration of deterministic continuation, coverage, and the last 200 significant events. No failed operation may silently replace valid live or stored state.
- Verify nested utility screens opened from running and paused sessions, nearest-layer Escape, focus return, native input behavior, continued simulation in analysis views, placement cancellation when leaving the map, and preservation of camera/selection/report context.
- Verify victory statistics, continued analysis/feedback/management beyond victory, safe Return Home, and subsequent Continue of the same colony.
- Verify all screens' empty, unavailable, loading, and failure states as well as normal states. Check non-hover explanations, text/symbol status cues, visible feedback while muted, and keyboard paths.
- Perform visual inspection in the actual game at 1440×900 and 1280×720, with Reduced Motion and both supported rendering qualities. Confirm density, contrast, unobscured information, legible controls, and coherent style across welcome, play, reports, dialogs, reference, About, settings, and victory. Preserve world anchors, input coordinates, scene ordering, and cached rendering behavior.
- Follow the current validation policy in `AGENTS.md`: routine validation runs only `npm test`; broader browser validation requires an explicit user request. Use Node.js 22.18+ and preserve failure logs. When browser validation is requested, inspect browser failures and rebuild generated bundles/development pages from source. Documentation synthesis alone does not constitute implementation validation.

## Out of Scope

- Changing production recipes, costs, reserve policies, carrier assignment rules, pathfinding, territorial expansion, upgrades, contracts, the gold objective, or other economy/progression mechanics.
- Mobile-first design, a newly guaranteed viewport smaller than 1280×720, or a comprehensive touch-control redesign. Existing smaller-screen behavior should not be needlessly broken, but it is lower priority than the accepted desktop contract.
- Replacing the PixiJS WebGL world renderer, adding Canvas world rendering, per-frame raster uploads, or changing world geometry, anchors, footprints, or simulation RNG for presentation.
- Cloud accounts, cloud saves, multiplayer, server persistence, save synchronization, offline economy advancement, or a backend.
- Fabricating history for old saves, treating unknown coverage as zero, presenting nominal capacity as a forecast, or inventing delivery ETAs/route history without observation support.
- Adopting a throwaway prototype wholesale, shipping illustrative economic fixtures as real data, or including development scenarios in release code.
- Regenerating the painted world artwork or replacing the existing art pack as a prerequisite. Interface framing and resource/building presentation should use and respect existing artwork and provenance.
- Public deployment or publication of a new production release as part of specification synthesis.
- Decomposing this feature into implementation tickets or implementing the redesign during the to-spec task.

## Further Notes

- The confirmed [design brief](ui-redesign.md), [domain glossary](../GLOSSARY.md), and accepted [audience/presentation](adr/0001-economy-analysis-interface.md), [map-led workspace](adr/0002-map-led-play-and-analysis.md), and [observation-history](adr/0003-preserve-economic-observation-history.md) decisions are the primary context for this specification. All 28 interview recommendations and the final shared understanding were accepted; this task adds synthesis rather than reopening those choices.
- At design confirmation, production had a DOM HUD around a native PixiJS WebGL world, individual-building observations with roughly two-second samples over at most two minutes, one browser-local save slot plus autosave, and brief transient notifications. This historical baseline motivated the accepted stories; it is not a statement of remaining implementation scope.
- The design-time transport graph included live job states, carrier cargo, current paths, endpoints and movement information, but not complete historical route observations or measured ETAs. Placement spatial validation was separate from click-time affordability. These baseline facts constrain honest reporting; the accepted contract does not authorize changing domain behavior.
- Existing development studies show light map-led, dark operations, and table-led variants with illustrative measurements and in-memory controls. They can inform presentation work but do not settle implementation structures or satisfy production acceptance.
- An interrupted implementation-start turn inspected the code and installed dependencies before this specification was confirmed; it did not implement the redesigned runtime. Subsequent implementation and acceptance evidence are summarized in [the acceptance record](game-first-ui-acceptance.md).
- Read [the acceptance record](game-first-ui-acceptance.md) for subsequent validation and review status rather than inferring it from this historical design baseline. New work and its dependencies belong in GitHub Issues.
- Exact spacing, module decomposition, history sampling/storage structures, and save-index keys are implementation details governed by the acceptance contract. They are not additional unresolved product-design questions. The browser and composed-game test seams have been explicitly confirmed.
