# Interface redesign

Historical design record, confirmed on 2026-10-14: all recommendations in questions 1–28 and the consolidated brief were accepted and implemented through [the redesign specification](ui-redesign-spec.md). [ADR-0004](adr/0004-full-map-and-game-windows.md) subsequently revised the spatial presentation to a full map and game windows while preserving its measurements and session behavior. [SPEC.md](../SPEC.md) describes the current game.

## Agreed direction

- Help users understand the colony's condition, explain why activity has stopped, and identify useful actions through precise data presentation.
- Make the interface elegant, precise, and informative, with warmth and character drawn from the painted settlement: earthy colors, resource illustrations, and restrained ornamental details. Use the character of a carefully designed settlement atlas, with expressive framing, quiet information surfaces, and readable typography. This revises the earlier restriction to a less game-like presentation; numerical information, tables, and controls must remain crisp.
- Serve professionals who understand the premise and are primarily interested in the economic simulation.
- Prioritize large desktop screens, targeting comfortable density at 1440×900 and supporting 1280×720. Mobile and smaller screens have lower priority. Collapse navigation and optional summaries before squeezing the map; use grouping, alignment, and compact rows rather than tiny body text to gain density.
- Allow reorganization of navigation, layouts, and workflows across the entire interface, including missing screens and useful measurements or summaries. Preserve existing economy and progression rules; changes to those rules require a separate decision.
- Keep the map as the primary workspace, with persistent colony summaries and a docked inspector. Give Economy and Logistics dedicated analytical views with enough space for deeper analysis; avoid requiring players to manage overlapping floating panels.
- Expand underlying measurements where necessary, including colony production and consumption over time, delivery throughput, and resource breakdowns distinguishing stored, reserved, carried, and waiting at producers. Use trustworthy measurements with explicit units and observation periods; identify estimates and unavailable history. Retain ten simulation minutes of recent history and lifetime totals across saves.
- Make diagnosis a first-class workflow connecting condition, evidence, affected places, and available actions. Distinguish missing supply from delayed delivery, and keep evidence accessible alongside advisor recommendations.
- Make welcome a proper home for starting, continuing, and understanding the game. Give continuing the current colony prominence, provide a concise introduction for newcomers, and give clear access to saves, settings, help, and About. Apply the same design language to loading, errors, confirmations, and victory.
- Keep the gold objective, Journey, contracts, upgrades, and autoplay visible and discoverable. Let experienced players collapse guidance without losing access to it; guidance becomes quieter as familiarity grows.
- Explain resources, recipes, statuses, and settings where players encounter them, backed by a searchable game reference. About covers the game's identity, credits, and provenance and receives the same design attention as the rest of the interface.

The scope includes the persistent interface, building selection and placement, inspection, colony management, diagnostics, notifications, menus, dialogs, welcome, saves, settings, help, About, loading, errors, and victory.

See [ADR 0001](adr/0001-economy-analysis-interface.md) for the audience and revised presentation direction, [ADR 0002](adr/0002-map-led-play-and-analysis.md) for the workspace decision, and [ADR 0003](adr/0003-preserve-economic-observation-history.md) for history continuation. No prototype variant is selected wholesale.

## Accepted workspace and interaction decisions

- Use a compact top resource bar, slim navigation, a large map, and one right-hand inspector. Expand secondary details on demand.
- Use warm ivory information surfaces, deep forest-green navigation, muted brass accents, illustrated resource/building icons, serif display headings, and clean sans-serif body text with aligned numerals. Keep texture and ornament around framing and headings and quiet backgrounds behind dense data. Make hover, focus, selection, and disabled states unmistakable; use restrained animation.
- Show stored stock in the top bar. A resource drilldown distinguishes stored stock, its reserved subset, available stock after reservations, goods in transit, producer input stock, and output awaiting collection. Never add reserved stock to the physical goods total. Canonical meanings are recorded in [GLOSSARY.md](../GLOSSARY.md).
- Default rates to goods per simulation minute. Offer 30-second, 2-minute, 10-minute, and lifetime reporting where meaningful, showing actual observation coverage. Distinguish measured output from theoretical capacity and separate production, consumption, and deliveries. Simulation speed does not change the units.
- Navigate from colony overview to a resource or issue, then contributing buildings and locations. Economy leads with resource balances and production chains; Logistics leads with deliveries, carrier workload, and waiting goods. Selecting a contributor opens its details; an explicit Locate action moves the camera. Preserve filters and reporting windows when returning.
- Keep persistent problems in an attention list and significant events in an activity history. Separate actionable problems from normal waiting and intentional pauses. Coalesce repeated notifications, retain relevant evidence, and support navigation to affected buildings. Resolved issues leave the active list but remain in history.
- Keep simulation running during building, inspection, and Economy/Logistics browsing. Automatically pause for Welcome, save management, settings, full reference, and confirmation dialogs, restoring the previous running state on close. Small contextual explanations remain nonblocking. Always show the running/paused state.
- Provide named manual saves, a separate autosave, clear save metadata, and file export/import. Welcome offers Continue, New Colony, and Load. New Colony has an optional name and reproducible seed. Validate imports before replacing the colony; protect unsaved progress before starting or loading another colony.
- Keep the gold objective compactly visible. Group Journey, contracts, upgrades, and autoplay in a coherent colony-management area. Show actionable opportunities without keeping every explanation open. Journey can collapse after onboarding; autoplay has an obvious persistent state. Victory offers continuing the colony or returning home.
- Support keyboard use for every interface action, predictable focus movement, and explanations accessible without hover. Preserve existing shortcuts. Escape dismisses the nearest temporary layer; dialogs restore focus when closed. Pair status colors with text or symbols, respect Reduced Motion, and maintain readable contrast.

## Measurements and accounting

- Retain the most recent ten simulation minutes of chart history alongside lifetime totals. Persist both through save/load. Colony lifetime totals survive building demolition; a current-building list must not silently redefine lifetime colony production.
- Older saves begin explicitly labeled coverage for missing measurements. Do not invent historical zeros or derive lifetime delivery rates from a longer production interval. Paused and offline time add no simulated history.
- Report construction, contract and upgrade spending and refunds separately from production and consumption so changes in stock can be reconciled. Distinguish movement between storage, producers, and carriers from goods being created or consumed.
- Explain when an action can reclaim uncollected optional warehouse transfers. Available stock remains stored stock minus reservations; action-specific reclaiming must be visible rather than silently changing that definition.
- Show measured performance and nominal capacity separately. Explain applicable upgrades and relevant constraints such as finite resources, output buffers, local support, delivery, and satisfied demand. Nominal capacity is not a prediction of sustained output.
- Count input arrivals at completed producer inputs and delivered producer output on arrival at storage. Collection, assignment, warehouse transfers, and goods merely waiting are different events.

## Screen content and behavior

### Map, build catalog, and inspectors

- The map workspace combines the resource bar, slim navigation, camera controls/minimap, contextual tool feedback, compact objective and simulation state, attention access, and one right-hand inspector.
- The building catalog supports search and production-chain groups. Show costs, recipes, placement requirements, and a short purpose before selection.
- Placement distinguishes terrain validity, affordability, ownership, and required nearby resources. Explain failed requirements beside the preview; a green spatial check must not imply that every requirement is satisfied. Keep repeat placement efficient and show road costs and rejection reasons before committing.
- Building inspectors lead with status and its explanation, followed by relevant controls, stock, production progress, and measured performance. Adapt content to producers, storage, outposts, and construction rather than presenting empty generic sections.
- Preserve existing production pause, priority, warehouse-target, and demolition capabilities. Explain the current demolition consequences accurately: completed-building refunds are half the cost rounded down per good; unfinished-site refunds depend on delivered materials; local stock salvage is separate. Protected buildings and territory consequences need clear feedback. Retain deliberate confirmation before demolition.
- Selecting a contributor opens its details; Locate explicitly returns to the map and focuses its location. Preserve camera, selection, filters, and reporting windows when leaving and returning. Cancel pending placement when leaving the map so returning cannot accidentally place something.
- If a selected building disappears, explain what happened and offer its former location or related surviving buildings.

### Economy, Logistics, and colony management

- Economy leads with resource balances and production chains, with measured production, consumption, deliveries, nonproduction spending/refunds, and relevant history. Resource drilldowns expose the agreed stock breakdown and contributing buildings.
- Logistics leads with deliveries, carrier workload, and waiting goods. Distinguish queued jobs, assigned carriers, collected cargo, and completed deliveries. Show actual routes and evidence where available; label uncertainty rather than inventing a cause or implying every queued delivery is on its way.
- Preserve navigation from colony overview to resource or issue, contributing buildings, and map location. Reports use real measurements rather than development-study fixtures.
- Group Journey, contracts, upgrades, and autoplay coherently. Show progress, costs, rewards, availability, and explanations for unavailable actions. Keep guidance collapsible and autoplay state persistently obvious.

### Attention and activity

- Distinguish urgent failures, persistent bottlenecks, and informational events. Alerts follow meaningful state changes; intentional pauses, satisfied demand, and ordinary brief waits are not alarms.
- Keep unresolved issues in the attention list, with evidence and navigation to affected places. Coalesce repeated notifications; resolved issues leave the active list but remain in activity history.
- Retain the latest 200 significant events per colony across saves. Activity referring to a demolished entity remains understandable and can offer its former location.
- Explain unavailable actions and what would make them available. Pair restrained sound cues with visible feedback; essential information never depends on sound alone.

### Welcome, new colony, and victory

- Welcome briefly explains production and logistics and the 200-gold objective. Emphasize Continue when a colony exists; provide New Colony, Load, settings, reference/help, and About.
- New Colony offers an optional colony name and reproducible seed while preserving current economy and progression rules. Protect unsaved progress before starting or loading another colony.
- Victory presents elapsed simulation time, settlement statistics, and relevant economic achievements, with Continue Colony and Return Home. Continuing dismisses the celebration and restores ordinary management; returning home must preserve the colony safely.

### Saves

- Provide named manual saves and a separate autosave. Show colony name, seed, save time, simulation age, gold, and building count, with explicit rename, overwrite, delete, export, and import actions.
- Preserve existing saves during migration. Confirm destructive replacement and deletion, validate imports before replacing live state, and keep the prior valid save if saving fails.
- Saving or storage failures must remain visible; never imply a successful save after failure. Offer file export as a recovery path, including when browser storage is full. Export must be possible without successfully writing a browser-local save first.

### Reference and About

- Provide a searchable reference covering buildings, recipes, resources, transport, expansion, progression, controls, and diagnostic terms. Link to it from the relevant interface and provide shorter contextual explanations without forcing a screen change.
- About covers the game's premise and identity, tribute status, version, credits, artwork provenance, and relevant acknowledgments in the same polished visual language.
- Keep explanations consistent with actual recipes and rules, including alternatives and legacy recipes. Water is local well support rather than a transported inventory good; explanations must preserve that distinction.

### Settings, dialogs, loading, and failures

- Group settings into gameplay/interface, visuals/accessibility, and audio, with immediate feedback and clear persistence. Preserve current audio controls, visual clarity, weather, Reduced Motion, and the supported rendering qualities of 1 and 0.75.
- Keep simulation running during map interaction and Economy/Logistics analysis. Blocking utility screens pause it, and nested dialogs preserve the original running/paused state on return. Expose that state consistently.
- Use predictable dialog focus movement, accessible explanations, nearest-layer Escape behavior, and focus restoration. Color and sound supplement text or symbols.
- Loading reports meaningful stages. Graphics, artwork, import, and save failures receive specific explanations and applicable recovery actions. Preserve the current colony whenever recovery permits; keep graphics failures visible and gameplay paused when rendering is unavailable.

## Acceptance scenarios

The redesign is complete only when the full experience works consistently, including empty states, failures, keyboard navigation, and save continuation. Verify these scenarios in the actual game:

1. **First colony:** start with an optional name and seed, understand the objective, find a building through the catalog, inspect its recipe and cost, place it, follow construction, and use Journey guidance.
2. **Stalled production:** identify a persistent input problem, inspect measured coverage and supplier evidence, distinguish it from deliberate pause or satisfied demand, locate affected buildings, and observe resolution without repeated alarms.
3. **Delivery congestion:** distinguish queued, assigned, and carrying deliveries; inspect workload and actual routes; navigate to contributors and return without losing report context.
4. **Construction and demolition:** explain placement rejection, affordability, reclaimable reservations, material delivery, road costs, protected structures, precise refund quantities, and safe demolition confirmation.
5. **Economic accounting:** reconcile stored/reserved/available quantities and producer/carried goods; explain stock changes from production, consumption, transfers, construction, contracts, upgrades, and refunds without double counting.
6. **History and saves:** retain recent coverage, lifetime totals, activity, and deterministic continuation through save/load; retain colony totals after demolition; label missing older-save history; preserve previous valid data on import/save failure and offer export recovery.
7. **Navigation and pause:** preserve camera, selection, filters, and windows across analysis; cancel pending placement when leaving the map; safely handle disappearing entities; restore the original pause state through nested utility screens.
8. **Victory and return:** inspect the objective and final statistics, continue normal management, return home safely, and continue the same colony later.
9. **Whole-interface consistency:** exercise welcome, catalog, inspectors, Economy, Logistics, colony management, attention/activity, saves, settings, contextual help, reference, About, loading, errors, confirmations, and victory, including empty and unavailable states.
10. **Presentation and access:** check 1440×900 and 1280×720, keyboard paths and focus restoration, readable contrast, non-color status cues, Reduced Motion, mute, and both supported rendering qualities. Preserve camera/input coordinates, sprite anchors, scene ordering, and deterministic simulation.

Follow the validation policy in `AGENTS.md`: routine validation runs only `npm test`; broader browser validation requires an explicit user request. Await asynchronous browser boot when that validation is requested. Production UI uses actual measurements; development scenarios remain isolated from the release bundle. Update SPEC.md when the agreed architecture is implemented so it continues to describe the current game.

## Current evidence

- Building inspectors already expose production, consumption, input arrivals, output delivered to storage, and input-blocked time. Recent windows use simulation time and report actual observation coverage.
- Stored goods, reservations, producer inputs, and output waiting for delivery are distinct quantities. The interface must not collapse these distinctions into misleading totals.
- The welcome screen currently offers a single start action. About has no dedicated surface.
- Existing compact panels, tooltips, and transient messages distribute information across several locations.
- Production currently has no dedicated Economy or Logistics analysis view, searchable reference, About, or named-save browser. Examples of these in the development study are illustrative rather than implemented game features.
- Welcome, Help, and Victory suspend simulation. Settings, Save Data, and Colony currently use floating panels over a running simulation. The accepted redesign changes utility-screen pause behavior as described above.
- Existing notifications disappear after their readable and fade intervals; there is no persistent activity history.
- Existing recent producer history spans at most two simulation minutes, so ten-minute charts and colony totals surviving demolition require additional measurement support.
- Current placement validates spatial requirements separately from affordability, and some inspector wording calls queued deliveries "on the way." The redesign must make both distinctions explicit.
- Autosave failures are currently quiet, and export attempts a browser-local save before returning data. The agreed failure/export behavior requires changing those paths.

These are observations of the current implementation, not decisions about the replacement. See [SPEC.md](../SPEC.md) for current mechanics and [GLOSSARY.md](../GLOSSARY.md) for established production terminology.

## Design tree closure

The audience, visual identity, density, workspace, accounting, reporting, diagnosis, building workflows, navigation, sessions, saves, goals, reference/About, settings, recovery, accessibility, and acceptance branches have been covered. No further product-direction questions remain. Exact spacing, component construction, sampling/storage structures, and other implementation details must satisfy this brief and the repository constraints; they are not additional undecided product directions. The user confirmed the consolidated shared understanding on 2026-10-14 and subsequently confirmed the existing browser and composed-game test seams during specification synthesis.

## Prototype for review

The user previously requested a throwaway prototype. [Three interface variants](../src/dev/ui-prototype.md) demonstrate a light map-led workspace, a dark operations console, and a table-led economic ledger on the existing development page. The prototype uses illustrative measurements and in-memory controls, with a paused colony rendered by the production WebGL renderer. The accepted design uses a map-led workspace with the warmer visual direction and requirements above; no prototype variant is selected wholesale, and prototype behavior is not a substitute for production acceptance.
