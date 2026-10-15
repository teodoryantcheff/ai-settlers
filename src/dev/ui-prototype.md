# Throwaway interface study

Question: should the professional economy interface be a map-led workspace, an operations console, or an economy-led ledger?

Run `npm run prototype:ui`, then open `http://127.0.0.1:8878/tests/game.html?uiPrototype&variant=A`.

- `variant=A`: **Fieldwork** — light navigation rail, map, docked inspector, resource summaries.
- `variant=B`: **Observatory** — dark perimeter navigation, simultaneous stock list, map, inspector and operations log.
- `variant=C`: **The Ledger** — economic tables lead, with a smaller spatial context panel.

Use the floating bottom switcher or left/right arrow keys. The variant and current screen remain in the URL. Optional `screen=` values are `workspace`, `economy`, `logistics`, `welcome`, `reference`, and `about`. The State control reveals the current in-memory UI state.

All variants include resource drilldowns, reporting windows, filtering and sorting, supply tracing, welcome, reference, About, settings, build selection, sample saves and session setup. Exported data is explicitly marked as illustrative.

The colony is a paused development fixture rendered by the production PixiJS WebGL renderer in an embedded copy of the development page. All economic figures are separate illustrative data, not measurements of that map. Prototype session controls do not step the colony or change real saves. Settings and sample checkpoints live in memory. Placement, actual save import, a complete economic ledger and the proposed historical measurement layer are not implemented here.

Only `src/dev/main.ts` imports the study. It is absent from the release entry point and release bundle. `npm run build` generates the existing development page and bundle; do not edit them manually. The default local port can be changed with `PROTOTYPE_PORT`.

Status: awaiting design feedback. No variant has won, and the second interview round's recommendations are hypotheses being demonstrated, not accepted requirements. Once a direction is selected, record the verdict, preserve this primary-source prototype outside the production branch, and rewrite the validated design for production. This workspace currently has no initialized Git repository, so no throwaway branch has been captured yet.
