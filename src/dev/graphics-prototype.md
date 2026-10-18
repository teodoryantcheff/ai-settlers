# Throwaway graphics study

Question: which balance of character, industry and atmosphere deserves production
art and animation? Compare A (quiet storybook), B (busy workshop), and C (breezy
countryside) on the same in-memory colony, using the actual WebGL renderer.

Run `npm run prototype:graphics`, then open
<http://127.0.0.1:8879/tests/game.html?uitest&graphicsPrototype&variant=A>.
Arrow keys/buttons switch variants; controls compare original artwork, stop motion,
stop industry, respect Reduced Motion, and change zoom. The host UI is visible
for scale but deliberately inert. No economy simulation or save operations run.

All additions are development-entry-only. The generated original images and crop
manifest live under `assets/art/prototype/`; provenance is in `assets/art/prompts.md`.
Carrier direction is limited to left/right; loaded and unloaded poses use separate
frames. Building activity and carrier routes are illustrative, not economic events.
The three variants explore motion density and focal emphasis rather than UI layout.

Tracking: <https://github.com/teodoryantcheff/ai-settlers/issues/76>.
Capture branch: `codex/graphics-prototype`. Verdict pending user review. Do not merge
this branch as production code; rewrite the selected treatments after review.
