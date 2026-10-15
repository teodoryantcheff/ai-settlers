# Preserve the full map and present analysis in game windows

The completed design and all individual decisions below were confirmed on 2026-10-15. The full-map controls, shared report windows, contextual help and utility presentation are implemented; [whole-session acceptance](../game-first-ui-acceptance.md) records validation and final integration evidence. Subsequent work is tracked in [GitHub Issues](https://github.com/teodoryantcheff/ai-settlers/issues). Preserve the redesign's accounting, durable observations, save safety, shared interaction policies and behavioral test seams while moving toward the earlier game's spatial presentation. The map fills the viewport behind the interface and retains its size and camera when panels open or close; temporary windows trade some deliberate occlusion for more unobstructed ordinary play, revising ADR-0002 and the presentation direction in ADR-0001 while retaining ADR-0003.

## Confirmed presentation and interaction decisions

- Colony Atlas starts collapsed, has an obvious toggle and remembers the player's preference between sessions. The right inspector appears when something is selected and can be dismissed.
- Economy, Logistics, Attention, Activity and Colony use movable windows over the live map. Only one main report window is open at a time, with the inspector available alongside it; switching preserves filters, reporting windows and scroll position. Analysis continues simulation.
- Preserve every current measurement and action. Less frequently needed details may move into hover/focus explanations or expandable sections; permanent screen space prioritizes ordinary play rather than making text smaller to fit everything.
- Draw visual character from the painted settlement: illustrated controls, warm materials, restrained decorative frames and compact game-window headings, with readable numbers and tables inside.
- Building details and contextual help appear on mouse hover or keyboard focus, allow the pointer to enter the popup for reading, disappear when the interaction ends and support Escape dismissal. Placement rejection explanations remain available while placing; generic guidance need not remain permanently visible.

## Confirmed controls and window behavior

- Use two compact top-bar rows: stored resources in one, essential controls and status in the other. Keep all stored-resource counts, the gold objective, pause/speed, autoplay state, carrier count and Menu visible. Population breakdowns use hover/focus explanations, FPS becomes optional, and save failure remains prominent. Roughly 60px total height is a target subject to readable sizing at 1280×720.
- Put five directly selectable map-mode controls at bottom center: Normal, Routes, Workload, Resource reach and Stalled buildings. Use illustrated buttons, short labels and a clear selected state, synchronized with changes initiated from Logistics.
- The lower-left Buildings button opens a compact five-column palette with large artwork, short names and compact search/chain filtering. Purpose, recipe, cost and placement requirements appear in hover/focus popups. Selecting a building closes the palette and enters the existing repeat-placement workflow.
- Replace the permanent instruction banner with hover/focus help attached to controls and a small Help control beside the map modes. Retain a compact active-tool label, Cancel action and placement feedback while constructing.
- Report windows are draggable and resizable and remember geometry for the current session. Initial placement accommodates the inspector; title bars remain reachable and windows are constrained after viewport resizing. The inspector stays anchored on the right and scrolls internally.
- Inspect retains the report and camera. Locate closes the report and brings the selected place into the unobscured map area; reopening restores report context. Opening a report cancels active placement.
- Saves, settings, full reference and confirmations share the game-window styling while preserving simulation suspension and nested focus behavior. Analysis remains live.
- Dismissing the inspector clears the current selection. Clicking a building selects it and reopens the inspector.

## Confirmed map visibility and guidance

- Expanded Atlas is a narrow navigation panel over the left map edge and stays open until explicitly collapsed. It never resizes the map. Choosing a report opens its window; choosing Map closes the report. Preserve the player's expanded/collapsed preference.
- The minimap remains at the lower right, initially visible, with a collapse control and remembered visibility preference. Preserve click-and-drag navigation and keep it accessible when report windows are open.
- Show the count of active Attention issues on the collapsed Atlas toggle. Ordinary notifications remain temporary, below the top bar and clear of the building palette and map-mode controls, retaining evidence links and their existing fade timing. Save failures remain prominent in the top bar; graphics failures retain their recovery screen.
- Move the separate map Advisor/Journey panel's detailed advice and progression into the Colony window. Keep the gold objective and autoplay state permanently visible. V toggles that guidance in the Colony window.

All eighteen interview recommendations and the consolidated design were accepted. The earlier [redesign specification](../ui-redesign-spec.md) remains the historical accounting, observation and session contract; this decision revises its spatial presentation while preserving those behaviors. [SPEC.md](../../SPEC.md) describes the current mechanics and ownership.
