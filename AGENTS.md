# Working in this repository

- Edit `src/`, `index.html` and `assets/art/`; regenerate bundles and `tests/game.html` with `npm run build`.
- Use the production PixiJS v8 WebGL renderer. Report graphics failures visibly. Offscreen Canvas for cached art/terrain, measurement and the minimap is allowed; Canvas world rendering and per-frame raster uploads are not.
- Preserve camera/input coordinates, scene ordering and sprite anchors. Reuse textures on unchanged frames and invalidate cached terrain when tiles change.
- Keep simulation deterministic. Cosmetic drawing must not consume simulation RNG or advance simulation state.
- Validate imports before replacing live state. Preserve save continuation and runtime live bindings when arrays change.
- Keep painted pack installation atomic, crop definitions in the manifest, and original generated images/reference/provenance together. Preserve building entrances, tree roots and gameplay footprints.
- Format code with prettier (`npm run format` and `npm run format:check`) before committing.
- Keep development scenarios in `src/dev/`, excluded from the release bundle. Supported rendering quality is 1 or 0.75; respect Reduced Motion.
- Tests compose the real subsystem graph through `tests/helpers/game.cjs` and reach closure internals via the typed `internals` hooks each factory accepts; keep new test-only access in those hooks and out of the runtime surface.
- Keep strict null checks enabled in the main TypeScript configuration; handle missing values explicitly.
- Use Node.js 22.18+ and `npm ci`. Use `npm test` for routine validation, selecting affected files during iteration through its focused mode (see README, “Validate and capture”), then running plain `npm test` before committing. Both modes lint, check types and retain failure logs. `npm test` excludes the economy soak suite in `tests/soak/` (full autoplay playthroughs, several minutes). Run `npm run test:soak` only when you change simulation, economy, logistics, carriers, roads, production, autoplay/advisor, contracts/upgrades or progression balance, or before opening a PR that touches those areas, never as per-edit validation; repeat one seed with `ECONOMY_SEED=<n>`. Keep slow end-to-end playthroughs in `tests/soak/` and out of the top-level `tests/` directory. Run `npm run check`, browser tests or visual captures (`npm run capture`) only when the user explicitly requests that broader validation OR when you are making a change with known visual impact. When browser validation is requested, await asynchronous boot and verify visual changes in the actual game.
- Update `SPEC.md` when mechanics or architecture change. Keep README operational and concise; keep generation provenance in `assets/art/prompts.md`.

## Agent skills

### Issue tracker

Track work in [GitHub Issues](https://github.com/teodoryantcheff/ai-settlers/issues). Before creating, claiming or resolving work, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage labels. Read `docs/agents/triage-labels.md` when triaging or publishing issues.

### Domain docs

Single-context layout: root `GLOSSARY.md` and `docs/adr/`. Before exploring or changing a domain, read `docs/agents/domain.md`.
