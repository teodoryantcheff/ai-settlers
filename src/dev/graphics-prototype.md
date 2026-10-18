# Throwaway graphics study — round two

Question: which integrated activity treatment and walking feel should receive
production art and implementation? The first round was rejected for clockwise
windmill rotation, detached activity overlays and poor walking.

Run `npm run prototype:graphics`, then open
<http://127.0.0.1:8879/tests/game.html?uitest&graphicsPrototype&round=2&variant=D>.

- D, Quiet craft: soft chimney breath, firebox light, tiny sawdust; restrained gait.
- E, Working machinery: thin saw in the painted bench, timed sawdust and furnace
  draught; more body movement in the walk.
- F, People at work: small painted workers tend the bench and firebox; carriers
  dwell at route ends and use shorter steps under load.

All three share counter-clockwise painted sails, four carriers on the same route,
cloud density and wind. Carrier feet move backwards during stance at the same
rate the root moves forwards, then lift for the return step. Boot soles remain
horizontal. Industry has a separate clock and freezes without jumping to its
initial pose. Activity anchors are measured in the original building images.

Arrow keys/buttons switch variants. Original-art comparison, pause, industry
on/off, Reduced Motion, normal zoom and carrier/industry close-ups support review.
The expandable state panel shows all comparison settings. The host UI is visible
for scale but inert. No economy simulation or save operations run.

[Round one](http://127.0.0.1:8879/tests/game.html?uitest&graphicsPrototype&round=1&variant=A)
remains available; its source is `graphics-prototype-round-one.ts` and commit
`1524ca5`. The task-runner command opens round two by default.

All additions are development-entry-only. Generated original images and crop
manifest live under `assets/art/prototype/`; provenance is in `assets/art/prompts.md`.
Characters still cover left/right side views only. Worker activity and carrier
routes are illustrative, not economic events.

Tracking: <https://github.com/teodoryantcheff/ai-settlers/issues/76>.
Capture branch: `codex/graphics-prototype`. Verdict pending user review. Do not merge
this branch as production code; rewrite the selected treatments after review.
