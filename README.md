# The Settlers — browser tribute

A peaceful desktop economy and logistics game. Build production chains, connect them with roads, expand with outposts, and bank 200 gold. Carriers deliver supplies; contracts and upgrades provide additional choices.

## Run and play

Requires Node.js 22.18+ and a browser with WebGL.

```sh
npm ci
npm run build
npm run dev
```

Open `http://127.0.0.1:8765/`. Add `?seed=2024` for a reproducible map. All runtime code and artwork are served locally.

Click to inspect or build, right-drag or use arrow keys to pan, scroll to zoom, and press Space to pause. Colony Atlas starts collapsed; open it for Map and live Economy, Logistics, Colony, Attention and Activity windows. V opens or toggles Advisor/Journey guidance in Colony. Buildings opens a searchable five-column palette; hover or focus an entry for details. Five illustrated map modes and contextual Help sit at bottom center, and the lower-right minimap can be collapsed. Economy, Logistics, Attention and Activity connect current goods, deliveries, persistent constraints and recorded colony events; Inspect keeps map context and Locate returns to the relevant site. Inspect buildings to adjust priority, pause work or request warehouse reserves.

Welcome offers Continue, New Colony with an optional name/seed, and Load. Menu includes Home, which keeps the live colony for Continue, plus saves, settings and help. Saves provide named checkpoints, a separate autosave, and JSON file import/export; the toolbar save-health button opens recovery when browser storage fails. Settings include Reduced Motion and Economical rendering.

For the throwaway UI study, run `npm run prototype:ui` and open the printed local URL. Switch between three layouts with the bottom bar. See [prototype notes](src/dev/ui-prototype.md) for scope and sample-data limitations.

## Source and rendering

Edit TypeScript in `src/` and the interface in `index.html`, then rebuild. `src/app.ts` composes subsystem factories; `src/runtime.ts` exposes live bindings; `src/types.ts` defines shared contracts.

- `src/core/` and `src/simulation/` — world state, navigation, economy, saves and deterministic simulation.
- `src/gameplay/` — advisor policy, journey milestones, contracts and upgrades.
- `src/observations/` — durable attention/activity history and validated issue evidence; `src/simulation/observations.ts` owns economic accounting and flow coverage.
- `src/application/` — browser startup, frame scheduling and autosave.
- `src/rendering/` — artwork, scene ordering, native PixiJS WebGL rendering, golden-hour lighting and particles.
- `src/ui/` and `src/audio/` — controls, HUD, preferences, music and sound.
- `src/dev/` — scenarios included only in the development bundle.

The world uses native GPU sprites, graphics and text. Offscreen Canvas prepares cached artwork and terrain; Canvas also draws the minimap. WebGL is required for play. The painted pack and its crop manifest live in `assets/art/`; generation provenance is recorded in [prompts.md](assets/art/prompts.md). After changing a sheet or an authored region, run `npm run crop:art` to rewrite each region's trimmed `crop` in the manifest.

[SPEC.md](SPEC.md) documents current mechanics and architecture. [AGENTS.md](AGENTS.md) provides contributor guidance. Track bugs, plans and implementation work in [GitHub Issues](https://github.com/teodoryantcheff/ai-settlers/issues), using the [tracker conventions](docs/agents/issue-tracker.md). The current map/window presentation follows [ADR-0004](docs/adr/0004-full-map-and-game-windows.md), with an [acceptance record](docs/game-first-ui-acceptance.md). The [earlier redesign specification](docs/ui-redesign-spec.md) preserves the historical accounting, observation and session contract.

Reference searches buildings, actual recipes, resources, transport and diagnostic terms; compact explanations stay live, while full reference and About use the shared utility layers. About links the bundled artwork provenance. If graphics stop, export the paused live colony before reviewing a reload; a reload can only restore a checkpoint or imported JSON. An incomplete painted pack keeps standard artwork playable.

## Validate and capture

```sh
npm test
```

Use `npm test` for routine validation. It runs oxlint, typechecking and the Node tests concurrently (one `node --test` run, a process per file, up to four at once), retaining per-step logs and a JSON summary under `output/validation/<run>/`. Every failing step prints its log tail; steps that depend on a failed one are skipped.

During iteration, select affected Node test files while keeping repository-wide lint, typechecking and the same logs:

```sh
npm test -- --file tests/validation.test.mjs
npm test -- --file tests/validation.test.mjs --file tests/typecheck.test.mjs
```

Pass exact paths to routine files in `tests/`; repeated selections run once in the suite's usual order. Missing files, globs, helper files, browser tests and soak tests are rejected before validation starts. Run plain `npm test` once at the end, before committing, to cover the full routine suite.

`npm test` excludes the economy soak suite in `tests/soak/`, whose full autoplay playthroughs take several minutes. Run `npm run test:soak` after changing simulation, economy, logistics, autoplay or progression balance; it retains logs the same way. `ECONOMY_SEED=<n>`, `ECONOMY_SEEDS=<a,b>`, `ECONOMY_PROFILE=invest` and `ECONOMY_SECONDS=<limit>` narrow or extend a run. CI runs it in a parallel job; `npm run check` and `npm run deploy` do not.

Lint rules live in `.oxlintrc.json`. `no-var` and `prefer-const` apply to source, scripts and tests without exemptions; use `const` for bindings that are never reassigned and `let` for mutable bindings.

Run the slower `npm run check`, browser tests or visual captures only when explicitly requested. The full check adds formatting, the build and browser tests, running alongside the Node tests; it takes about four minutes on a 4-core laptop and retains browser failure artifacts alongside its logs. Browser tests run in three workers on the machine's GPU through ANGLE (`playwright.config.mjs`); Chromium falls back to software WebGL where no GPU is available, which is much slower. Each worker boots one shared page (`tests/browser/helpers/test.mjs`); the development hook `resetForTest()` returns it to the booted colony and interface before every test, and a fingerprint check fails the test if it did not. Tests that need their own pre-boot setup (URL scenarios, real animation frames, audio or WebGL faults, reloads) take the `freshPage` fixture instead.

`npm run coverage` measures V8 coverage of `src/` separately for the Node tests and the browser tests (browser bundles are mapped back through source maps), and fails if any file leaves more lines or branches uncovered in either environment than `tests/coverage-baseline.json` records, beyond 0.5% of the file. Counting uncovered code lets redundant code be deleted without a false alarm while a deleted test still fails. HTML reports are written to `output/coverage/report/{node,browser}/`. After an intended coverage change, run `npm run coverage -- --update` and commit the baseline; `-- --report-only` re-reports the last run's raw data.

Tests and builds run TypeScript 7 checking through `npm run typecheck`, which invokes the TypeScript 7 compiler explicitly. Strict null checks are enabled in the main `tsconfig.json` for all source and compiler contracts. Browser tests require Playwright Chromium (`npx playwright install chromium` once). If port 8765 is occupied by another server, use `PLAYWRIGHT_PORT=8766 npm run test:browser`. Development scenarios are available at `tests/game.html?uitest&buildrules&seed=2024`, `?saveload&seed=123`, and `?devshot&seed=2024`.

`npm run bench:render` is opt-in and not part of `npm test`. It measures CPU and GPU frame time at every zoom on this machine's GPU (headless Chromium, real WebGL) and warns if Chromium falls back to software rendering. Add `-- --zooms 3 --profile 3` to narrow it and keep a CPU profile; `scripts/bench-render.mjs` lists every option. Results go to `output/bench/`; see [performance notes](docs/performance-60fps.md). After building, `node scripts/bench-territory.mjs` measures isolated territory-cache frames on hardware WebGL and saves raw samples plus a game screenshot to `output/bench-territory/`.

With the local server running, `npm run capture:production-art` exports images, diagnostics and a particle animation into `output/production-art/`. Capture additionally requires FFmpeg. Headless software-WebGL timings are diagnostics; profile target hardware for performance decisions.

## Deploy

The game is a static site: no backend, Pages Functions, or Cloudflare runtime bindings are required. Node.js 22.18+ and the lockfile-pinned Wrangler are build/deployment tools only.

```sh
npm ci
npx wrangler login                          # once per developer machine
npm run deploy                             # Node tests, build, package, publish production (main)
```

The Direct Upload project is `settlers-tribute`, served at https://settlers-tribute.pages.dev/. To recreate it in a new account, first run `npx wrangler pages project create settlers-tribute --production-branch main`. Wrangler 4.149.0 may delegate creation of new projects to Workers in agent environments; add `--force` to that one-time create command to explicitly retain Pages. Existing Pages projects do not need this flag for deployment. Ensure Wrangler targets the intended account; set `CLOUDFLARE_ACCOUNT_ID` when needed.

`npm run deploy` runs `npm test` (lint, typechecking and Node tests), then builds a fresh production package before publishing. Any failed or interrupted command prevents deployment. The full browser suite is an explicit check through `npm run check` or `npm run test:browser`; it is not part of deployment.

`npm run build:pages` creates a clean, deploy-only `dist/`: entry HTML, a real 404 page, Pages headers, and content-hashed releases containing the minified game and complete artwork/reference/provenance pack. Code and artwork share a release hash, preserving their relative paths and allowing one-year immutable caching; HTML revalidates. Cloudflare handles compression. Never deploy the repository root or manually add unversioned assets to the immutable release paths.

`npm run preview:pages` builds and serves this production package locally through Wrangler. In another terminal, run `npm run test:pages -- http://localhost:8788/` (or pass the deployed URL) to check production WebGL boot, artwork, cache/security headers, missing-file 404s, and save/load. Set `PAGES_SCREENSHOT` to save a screenshot. Run `npm test` and `npm run build:pages` before manually publishing a branch preview. A branch preview can be uploaded with `npx wrangler pages deploy dist --project-name settlers-tribute --branch staging` after building.

Soft-launch headers disable search indexing (`X-Robots-Tag: noindex`) and embedding, and add basic browser security protections. The site is still public, not access-controlled. Remove `noindex` from `scripts/pages-headers.txt` when ready for discovery. Saves and preferences stay in browser-local storage, separately for each origin; localhost/preview saves do not automatically transfer to production. Serve over HTTP(S); direct `file://` opening and offline caching are unsupported.

### GitHub workflow

Source lives in the public [teodoryantcheff/ai-settlers repository](https://github.com/teodoryantcheff/ai-settlers), with `main` as the default branch. Clone it with `gh repo clone teodoryantcheff/ai-settlers`, then follow Run and play above. Commit source, original art/provenance, shared agent skills and lockfiles. Generated bundles, `dist/`, dependencies, captures, scratch notes, caches and credentials are ignored; rebuild after cloning.

[CI](.github/workflows/ci.yml) runs on pull requests and pushes to `main`, on Node.js 22.18.0 (the supported minimum): `npm ci`, `npm run format:check` and `npm test`, with `npm run test:soak` in a parallel job. When a step fails, the run uploads the retained `output/validation/` logs as the `validation-logs` (or `soak-validation-logs`) artifact. CI never deploys and uses no secrets; publishing stays a manual `npm run deploy`. Never commit credentials, and do not run the production deploy script from pull requests.

Cloudflare's native Git integration is a different option: a Direct Upload project cannot switch to it. Create a new Git-integrated Pages project when adopting that workflow, with framework preset **None**, build command `npm run build:pages`, output directory `dist`, and Node.js 22.18+; production branch `main`. Plan the domain cutover before retiring the existing site. Changing origins also separates browser-local saves, so export/import saves when moving. See [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) and [Git CI with Wrangler](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).
