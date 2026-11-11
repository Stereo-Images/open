# Open playback and audio checks

`player.js` is the canonical player source. The main player and studies page load it directly with the shared stylesheet and WAV worker. No HTML extraction or player build step is needed. `tests/support/harness.cjs` provides the shared Web Audio test double.

## Regression checks

Run from the repository root:

```sh
npm ci --ignore-scripts
npm run check:player
npm test
npm run test:study
```

`check:player` checks that both listening pages use the same player, the sixteen approved studies have scores and replay settings, and the old current-study URLs preserve replay parameters through redirects.

The Node suite checks shared-link playback, saved-setting migration, natural endings, Stop/Play races, recording, export failure recovery, node cleanup, WAV headers and encoding, stereo drift, live/offline scheduling, immutable performance data and all sixteen saved Long scores. Intentional failure tests print simulated export errors; the final test summary determines success.

`test:study` checks mirrored melodies, contextual organ harmony, gains, timing, ending behavior and deterministic replay across all sixteen studies, plus organ chorus/room wiring and cleanup. Archived-score comparisons allow at most eight machine epsilons of relative roundoff across JavaScript runtimes; structure and integer choices remain exact. Same-runtime comparisons remain strict.

To compare every retained replay behavior against the release before consolidation, and the original pre-planner performance, run:

```sh
git show ec968f765c16837b29324fa6437cb012d39f1918:player.js > /tmp/open-release-baseline.js
git show 8a2d9c747ce1e31f48753169240c1393a422d028:player.js > /tmp/open-original-baseline.js
OPEN_BASELINE=/tmp/open-original-baseline.js npm test
OPEN_RELEASE_BASELINE=/tmp/open-release-baseline.js npm run test:study
git show da8aded3b9c871a8473d74fc4ed08ad1a00098fc:player.js > /tmp/open-fm-baseline.js
OPEN_FM_BASELINE=/tmp/open-fm-baseline.js node --test tests/fm.test.cjs
```

CI runs both baseline comparisons. The release comparison covers 216 saved-version Short/Long plans and four former Short defaults, explicitly pinned to their original recipe. Without the corresponding environment variables, only those optional historical comparisons are skipped. The selective FM tests also check that new Short and Long plans preserve every non-FM field, reproduce the approved reference recipe, and retain deterministic replay. See [the timbre rule](../docs/slow-beating-fm.md) for its scope and audition limits.

## Native browser checks

```sh
npx playwright install --with-deps chromium firefox webkit
npm run test:browser
```

The browser suite exercises the launcher, incoming shared-performance buttons, starting a new performance, old-URL redirects, study selection, canonical sharing links, WAV export from the nested studies page, keyboard/touch controls, recording, repeat exports and cleanup. No audio starts before a user gesture. CI runs Chromium/Firefox on Linux with a virtual audio output and WebKit on macOS.

Repeated native WAV comparisons allow at most two 16-bit PCM steps and RMS error below 0.01% of signal energy for DSP rounding. These checks do not assert identical samples across browsers or devices.

## Native audio and scripted export

Install `node-web-audio-api` 2.2.0 with `npm install --no-save --package-lock=false node-web-audio-api@2.2.0`, or set `OPEN_AUDIO_RUNTIME` to the absolute `index.js` path of an existing installation. Then run:

```sh
npm run test:audio
node tools/render-study.cjs bf187689
```

The renderer reads `player.js` and the approved study manifest directly. Pass any of the sixteen study seeds; the WAV and render report are written under the ignored `checks/` directory with the manifest's complete replay filename. Repeat the command for each desired study. The timestamp in the filename does not add randomness.

`test:audio` preserves the original `0393ded7` Short Study at 200 Hz and 44.1 kHz: 3,773,475 frames and floating-PCM SHA-256 `a259348dc27fb39ca87c047d36e23d848bd35e18fce689971f799f91bd68dafa` on the retained native backend, with and without selective FM refinement. It checks that the reference Long excerpt changes only after its first targeted strike, and checks repeated Long organ audio and the room tail. With `OPEN_RELEASE_BASELINE` set, it compares the organ samples with the pre-consolidation player.

## Saved performances and archive

Internal replay identifiers remain in links, filenames and score data so existing saved performances keep their original musical behavior. They are not listener-facing choices. Never reuse an identifier for different planning or synthesis. Removing duplicated source files does not change those replay recipes.

Short and Long are the only duration modes. Stored Infinite preferences reset to Short; Infinite replay requests are rejected. Internal unbounded generator calls assemble finite melodies and do not provide an Infinite playback mode.

The approved [manifest and scores](../studies/g29) remain in the main branch. Earlier players, analyses, workbooks and development scripts are preserved on the [archive branch](https://github.com/Stereo-Images/open/tree/archive/g29-development/studies/g29).

