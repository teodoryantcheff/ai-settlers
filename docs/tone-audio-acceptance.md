# Tone audio acceptance

[ADR-0005](adr/0005-tone-audio-and-independent-economic-notices.md) is implemented in the shared Tone runtime and independent economic-notice observer. [SPEC.md](../SPEC.md#audio) describes the final ownership. The user accepted the refined sound on 2026-10-15. The remaining technical gate for [issue #6](https://github.com/teodoryantcheff/ai-settlers/issues/6) is the final review correction and its validation.

The initial listening review requested reducing the loudness and sharpness of dings and pings. Interface click/hover/open accents now use 60% of their prior velocity; world and score bell accents have lower level, half the modulation depth and a gentler attack, retaining pitches and timing. The score drum also retains its original 95 Hz down-to-52 Hz contour using Tone’s frequency-multiplier parameter. On 2026-10-15 the user listened to the revised clips and confirmed: “Accept the revised sound.” This accepts the refined representative cues and Meadow extract below; automated checks alone do not establish audible parity.

## Behavioral coverage

The seams remain the composed real subsystem graph with typed factory internals and actual browser controls/native AudioContext. The browser fixture injects failures at native construction, Tone's internal context-node allocation, mixer allocation and native resume. It adds no production fault switches or runtime test accessor.

| Contract                                                                                                                                            | Evidence                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Notices before unlock, muted or failed audio; optional sound errors; quiet load reset and live arrays                                               | `economic-feedback`, `economic-notices` and shared audio Node tests        |
| One startup, skipped pending cues, cleanup/retry, stale automation, latest visibility/control state                                                 | Shared audio Node tests and `tests/browser/audio.spec.mjs`                 |
| Immediate cues, all world/economic mappings, independent panners, cooldowns, six work voices/70 ms spacing, victory ducking                         | World/shared audio Node tests and native cue recordings                    |
| Reused ambient sources, camera/water, rain/night/wildlife/thunder, channel routing and cleanup                                                      | Ambience Node tests and native environment transition capture              |
| Three themes, exact quiet bars, adaptive roles, callback timestamps, phrase recovery, session cursor and deterministic variation                    | Music Node tests and full native score recordings                          |
| Real failure notice and advancing simulation/frames, settings/preferences, pause/modal/speed, new/load, native suspend/resume and rapid transitions | `tests/browser/audio.spec.mjs`; one failure case retains the live RAF loop |

The headless browser test dispatches page lifecycle events at the DOM boundary to make rapid pagehide/pageshow ordering reproducible, then observes real native suspension and resumption. It checks one live context and stable continuous-source counts after recovery. Composed Node tests verify score scheduling/cursor and subscription policies through typed internals rather than exposing them in the shipped game.

## Reproduction and retained evidence

Use Node.js 22.18+ and `npm ci`. Routine validation is `npm test`; production and development bundles are regenerated with `npm run build`. The migration explicitly authorizes the focused actual-browser acceptance command:

```sh
PLAYWRIGHT_PORT=8771 node node_modules/@playwright/test/cli.js test tests/browser/audio.spec.mjs --workers=1
```

Run it after the build. The test awaits asynchronous boot, checks the production Pixi WebGL renderer, records native evidence as test attachments, and captures the failure notices/settings. One worker avoids software-WebGL contention. Other browser suites and `npm run check` remain broader checks requiring explicit authorization under `AGENTS.md`.

[Local evidence](../output/audio-acceptance/) is ignored, machine-local acceptance material rather than a release asset. It includes:

- [Native startup/retry matrix](../output/audio-acceptance/runtime-browser.json): successful startup plus constructor, context-node, partial mixer and resume failure; each failed context closes and retry produces one running context.
- [Environment transitions](../output/audio-acceptance/ambience-browser.json): day, water, rain, night, thunder and channel silence; continuous loop count remains stable and exported save/gameplay RNG remain unchanged.
- Initial original and migrated [cue recordings](../output/audio-acceptance/tone-cues.mp3), [remaining world cues](../output/audio-acceptance/tone-other-cues.webm), [three-theme extracts](../output/audio-acceptance/tone-themes.mp3) and [ambience recording](../output/audio-acceptance/tone-ambience.mp3). Original recordings are retained alongside these initial migrated versions. This initial mix prompted the user’s request to soften bright accents; it is not the acceptance candidate.
- Revised [representative cues](../output/audio-acceptance/tone-refined-cues.mp3) and [Meadow extract](../output/audio-acceptance/tone-refined-music.mp3) are the accepted listening clips. The extract includes score bell accents and the corrected drum contour; the original native streams and setup evidence are retained as `tone-refined-cues.webm` and `tone-refined-score.webm`/`.json`.
- [Full-score quiet analysis](../output/audio-acceptance/score-quiet-analysis.json): all three quiet sections contain exact digital silence in both original and migrated scores. Decode the complete MediaRecorder stream before selecting sample windows; container timestamp seeks under CPU load can select the wrong musical section.
- Category validation directories and the final `acceptance-node-validation/` copy of `npm test` logs. Final focused browser attachments are retained in `acceptance-browser/`.

## Integrated validation

Node.js 24.18.1 with a clean `npm ci` installation passed `npm run build` and all 43 `npm test` steps on the integrated refined mix before the final review correction. The [retained Node summary](../output/audio-acceptance/acceptance-node-validation/summary.json) includes type checking and the original 95-to-52 Hz percussion regression, alongside the complete policy, lifecycle, save and simulation coverage. The [red percussion regression](../output/audio-acceptance/acceptance-regression-red/04-audio-music.test.cjs.log) records the incorrect 45.21 Hz attack before correcting Tone’s multiplier parameter.

On 2026-10-15 the rebuilt combined graph passed all five focused browser cases in 89.1 seconds, with no page errors, skips or flaky cases. The [retained report](../output/audio-acceptance/acceptance-browser/report.json) and [run log](../output/audio-acceptance/acceptance-browser/run.log) cover the refined sound mix and corrected drum contour. The live-loop failure capture visibly shows the nonblocking notice alongside the running rendered game. Browser evidence observes one live context, finite source cleanup, exact sound-only save/RNG preservation and unchanged save continuation after a new colony and load.

The final code review additionally identified the need to observe an unexpected native context close immediately. Its correction and final validation are recorded with the review fix. The user’s listening acceptance applies to the refined clips linked above; the review correction preserves their audible output.
