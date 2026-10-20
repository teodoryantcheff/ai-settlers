# Working in this repository

- Edit `src/`, `index.html` and `assets/art/`; regenerate bundles and `tests/game.html` with `npm run build`.
- Use the production PixiJS v8 WebGL renderer. Report graphics failures visibly. Offscreen Canvas for cached art/terrain, measurement and the minimap is allowed; Canvas world rendering and per-frame raster uploads are not.
- Preserve camera/input coordinates, scene ordering and sprite anchors. Reuse textures on unchanged frames and invalidate cached terrain when tiles change.
- Keep simulation deterministic. Cosmetic drawing must not consume simulation RNG or advance simulation state.
- Validate imports before replacing live state. Preserve save continuation and runtime live bindings when arrays change.
- Keep painted pack installation atomic, crop definitions in the manifest, and original generated images/reference/provenance together. Preserve building entrances, tree roots and gameplay footprints.
- Keep development scenarios in `src/dev/`, excluded from the release bundle. Supported rendering quality is 1 or 0.75; respect Reduced Motion.
- Tests compose the real subsystem graph through `tests/helpers/game.cjs` and reach closure internals via the typed `internals` hooks each factory accepts; keep new test-only access in those hooks and out of the runtime surface.
- Validate with `npm test`: its focused mode while iterating, plain before committing. README “Validate and capture” is the source for heavier validation: when the soak suite runs (simulation or balance changes, and before such a PR), when `npm run check`, browser tests or captures run (on request or known visual impact), where slow playthroughs belong, and how rendering profiles and Chromium launches work. Read it before running or adding any of these.
- For benchmarks, ask the user which GPU-specific rendering profile to use, and leave their profiles file as it is.
- Update `SPEC.md` when mechanics or architecture change. Keep README operational and concise; keep generation provenance in `assets/art/prompts.md`.

## Agent skills

### Issue tracker

Track work in [GitHub Issues](https://github.com/teodoryantcheff/ai-settlers/issues). Before creating, claiming or resolving work, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage labels. Read `docs/agents/triage-labels.md` when triaging or publishing issues.

### Domain docs

Single-context layout: root `GLOSSARY.md` and `docs/adr/`. Before exploring or changing a domain, read `docs/agents/domain.md`.
