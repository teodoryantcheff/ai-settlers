# Full-map and game-window acceptance

ADR-0004's presentation revision is implemented. Subsequent work is tracked in [GitHub Issues](https://github.com/teodoryantcheff/ai-settlers/issues). [SPEC.md](../SPEC.md) describes the current mechanics and ownership; the earlier [redesign specification](ui-redesign-spec.md) preserves the historical accounting, observation and session contract.

Capture links under `output/` below refer to ignored, machine-local historical evidence. A fresh clone can reproduce validation with `npm ci` and `npm run check`; attach new evidence to the relevant GitHub issue or pull request.

Validation status: passed on 2026-10-15. Node.js 24.18.1 and a clean `npm ci --offline` installation are used. No deployment is part of acceptance.

## Coverage

The confirmed seams remain the composed real-game graph with typed factory internals and actual browser controls. No runtime test accessor or economic rule is added. Static visual fixtures submit explicit production WebGL frames after interaction; existing native-loop checks retain continuous rendering and simulation coverage.

| Integrated behavior | Evidence |
| --- | --- |
| Welcome → Journey → cancel/reselect through Buildings → actual construction deliveries, output and durable reports | `whole-session.spec.mjs`; invalid/repeat placement, roads and demolition retain their focused catalog cases |
| Atlas, selected inspector, palette/facts, modes, minimap and notifications; live report geometry/context; popup → report → Map Escape and nested utilities | `game-first-acceptance.spec.mjs`, plus focused Atlas/report/top-bar/catalog/Attention suites |
| Named/manual/autosaves, atomic invalid import, quota/export recovery, reused IDs, removed entities, deterministic continuation and honest observed history | save/session/inspector/observation/attention browser cases and composed Node suites |
| Earned victory after spending, continued management, Home/Continue, unavailable/context-lost WebGL and atomic artwork fallback | progression/reference/recovery/utility/browser renderer checks |
| Native PixiJS WebGL, unchanged-frame texture reuse, terrain invalidation and release isolation | Pixi renderer/browser/build/package checks |

The combined surface matrix crosses both supported sizes and qualities, exercising Reduced Motion on and off at each size:

| Viewport | Quality | Reduced Motion | Reviewed Map capture |
| --- | --- | --- | --- |
| 1440×900 | 1 | off | [Map](../output/game-first-ui/12/screenshots/combined-map-1440-q1.png) |
| 1440×900 | 0.75 | on | [Map](../output/game-first-ui/12/screenshots/combined-map-1440-q0.75.png) |
| 1280×720 | 1 | on | [Map](../output/game-first-ui/12/screenshots/combined-map-1280-q1.png) |
| 1280×720 | 0.75 | off | [Map](../output/game-first-ui/12/screenshots/combined-map-1280-q0.75.png) |

Presentation toggles, mode choice, window movement and native reading preserve the saved economic colony. Inspect preserves the camera; minimap navigation and Locate move it explicitly. Palette/report resize and nested utility focus retain the fixed root viewport. Compact bar information, report titles, inspector dismissal and navigation remain reachable under combined overlays and notices.

## Validation artifacts

The [consolidated evidence index](../output/game-first-ui/README.md) locates tickets 01–11 and their retained validation. Historical logs and ticket closures may retain temporary execution paths; use that index to find the preserved copies.

The final retained artifact root is [`output/game-first-ui/12/`](../output/game-first-ui/12/), copied from the validated temporary worktree. It contains the clean-install/build record, focused combined captures, original failed/interrupted setup artifacts and the complete full-check logs and browser artifacts. [`full-check/summary.json`](../output/game-first-ui/12/full-check/summary.json) records every final validation step; the browser log and images are retained alongside it.

Reviewed examples also include the [crowded report](../output/game-first-ui/12/screenshots/combined-report-1280-q1.png), [pointer-readable facts](../output/game-first-ui/12/screenshots/combined-map-popup-1280-q1.png) and [actual construction delivery](../output/game-first-ui/12/screenshots/first-material-arrival-1440-q1.png). Normal and failure-state captures also retain [earned victory](../output/game-first-ui/12/screenshots/victory-1280.png), [live graphics recovery](../output/game-first-ui/12/screenshots/graphics-recovery-1280.png), [atomic artwork fallback](../output/game-first-ui/12/screenshots/artwork-fallback-1280.png) and [unavailable WebGL](../output/game-first-ui/12/screenshots/webgl-unavailable-1280.png).

Final validation used `flock /tmp/game-first-ui-browser.lock env PLAYWRIGHT_PORT=18885 npm run check` with one browser worker. All 38 steps passed: formatting, type checking, 34 composed Node test files, the production build and all 98 actual-browser cases. The complete step durations total 25 minutes 24 seconds; the [browser log](../output/game-first-ui/12/full-check/38-browser.log) records 98 passes and no failures.

The first full run passed 97 of 98 browser cases. Its remaining top-bar fixture changed the tool after opening transient help, correctly dismissing that help before the pointer-reading assertion. Moving tool setup before the hover preserved every pointer, click, Escape and state-purity assertion; the focused case and complete rerun passed without a production change. The [original failed full run](../output/game-first-ui/12/full-check-initial-failure/) remains retained. Public deployment remains outside this work.

## Post-review gesture correction

The formal review identified one Spec P2 finding against the fully validated integration baseline `7cc7afb`: opening Colony with V during a held right drag left the HUD's drag active. Actual browser input reproduced camera x changing from 442 to 452 on the next pointer movement. Report navigation now asks the HUD to end existing map and minimap gestures alongside the existing held-key cancellation. The canceled drag's release preserves inspection and report context; fresh map/minimap gestures remain available, and ordinary right-click cancellation is classified on release so browser contextmenu timing cannot turn a new drag into a cancel click. No simulation or save rules changed.

The [review correction evidence](../output/game-first-ui/review-fixes/README.md) retains the original red, follow-through diagnostics, final green, screenshots and exact commands. After the correction, build/type checking, formatting, 18 composed input/workspace/interaction Node cases and 14 actual-browser report-window/map-control/full-map cases passed. The browser command used the same lock with `PLAYWRIGHT_PORT=18886` and one worker; the matrix includes both desktop sizes, qualities 1/0.75 and Reduced Motion. The new native workflow covers opening and switching reports, held keys, canceled and fresh map/minimap gestures, retained inspection, normal right-click cancellation and unchanged saved colony data. The full 38-step/98-browser check above was run on `7cc7afb`; it was not rerun on this localized correction.
