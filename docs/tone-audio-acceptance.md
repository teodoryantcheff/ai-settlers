# Tone audio acceptance

[ADR-0005](adr/0005-tone-audio-and-independent-economic-notices.md) is implemented in the shared Tone runtime and independent economic-notice observer. [SPEC.md](../SPEC.md#audio) describes the final ownership. Overall acceptance of [issue #6](https://github.com/teodoryantcheff/ai-settlers/issues/6) remains pending the user's listening check.

The initial listening review requested reducing the loudness and sharpness of dings and pings. Revised interface, world and score accents require another listening review. No automated check establishes audible parity.

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
- Original and migrated [cue recordings](../output/audio-acceptance/tone-cues.mp3), [remaining world cues](../output/audio-acceptance/tone-other-cues.webm), [three-theme extracts](../output/audio-acceptance/tone-themes.mp3) and [ambience recording](../output/audio-acceptance/tone-ambience.mp3). Original recordings are retained alongside the migrated versions for listening comparison.
- [Full-score quiet analysis](../output/audio-acceptance/score-quiet-analysis.json): all three quiet sections contain exact digital silence in both original and migrated scores. Decode the complete MediaRecorder stream before selecting sample windows; container timestamp seeks under CPU load can select the wrong musical section.
- Category validation directories and the final `acceptance-node-validation/` copy of `npm test` logs. Final focused browser attachments are retained in `acceptance-browser/`.

Final automated validation and revised listening evidence are recorded below as integration completes.
