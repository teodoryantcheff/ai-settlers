# Roadmap

[SPEC.md](SPEC.md) describes the game as implemented. This file collects known, non-critical flaws and follow-ups that are not scheduled yet. Open a [GitHub issue](https://github.com/teodoryantcheff/ai-settlers/issues) before working on an item, then remove it here.

## Known issues

- **Build rewrites tracked source.** `scripts/build.mjs` writes the bundle hash into the tracked `index.html` (`game.min.js?v=…`), so every code change also dirties the authored page and commits carry hash-only diffs. It also prevents watching `index.html` for rebuilds, since each build rewrites it. Inject the query string only into generated output.
- **Unused compressed bundles.** `scripts/build.mjs` writes `game.min.js.gz` and `game.min.js.br` (Brotli quality 11), but neither the development server nor `scripts/package-pages.mjs` serves them.
- **Release build always emits development artefacts.** `npm run build`, and therefore `build:pages`, also bundles `src/dev/` and writes `tests/game.html`; a production build fails without a `tests/` directory.
- **Undeclared Python requirement.** `npm run dev` and the Playwright web server use `python3 -m http.server`, while the README lists only Node.js and a WebGL browser.
- **Minimal Content Security Policy.** `scripts/pages-headers.txt` sets only `base-uri`, `object-src` and `frame-ancestors`; without `default-src`/`script-src` it gives no script-injection protection. `index.html` has one external script, one `<style>` block and one inline `style` attribute, so a stricter policy looks feasible.
- **Inconsistent dependency classification.** `tone` is a runtime `dependency` while `pixi.js`, equally bundled into the release, is a `devDependency`.
- **Typecheck test depends on the host.** `tests/typecheck.test.mjs` passes on Linux with Node 22.18 (CI and the Docker environment) but fails on macOS with Node 24, where the compiler emits coloured, pretty diagnostics that the test's `file(line,col)` pattern does not match.
