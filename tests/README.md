# Open playback and audio checks

The current player offers Short (g21) and Long (g29). The tests preserve explicit historical Short/Long engine replays, including the original `0393ded7` g3 Short Study. Infinite mode is unavailable: stored Infinite preferences reset to Short, and Infinite filenames, links and direct planning requests are rejected.

## Build and regression checks

Run from the repository root:

```sh
npm ci --ignore-scripts
npm run build:player
npm run check:player
npm test
npm run test:study
```

`build:player` extracts the engine from `studies/g29/deliverables/Open-g29-Sixteen-New-Studies.html` and loads the unchanged external WAV encoder. To rebuild both standalone players first, run `python3 studies/g29/build.py`. That build also removes Infinite mode, so rebuilding cannot restore it. `check:player` checks the published engine against the standalone source.

The Node suite checks playback and replay controls, saved-setting migration, natural endings, Stop/Play races, recording, export failure recovery, node cleanup, WAV headers and encoding, stereo drift, live/offline scheduling, immutable performance data and all sixteen saved g29 scores. The Web Audio test double supports periodic organ waves and convolution buffers. Intentional failure tests print simulated export errors; the final test summary determines success.

To compare against the original pre-planner implementation, load its source before running the suite:

```sh
git show 8a2d9c747ce1e31f48753169240c1393a422d028:player.js > /tmp/open-baseline.js
OPEN_BASELINE=/tmp/open-baseline.js npm test
```

The comparison explicitly requests engine 1 and Long duration. It compares the first ten minutes of the original musical and spatial control data. Without `OPEN_BASELINE`, only that optional historical comparison is skipped.

`test:study` verifies 208 historical Short/Long scores, 57 g29 parameter fixtures, organ chorus/room wiring, 216 additional preserved-version comparisons and all sixteen saved Long-study scores. The study checks also exercise mirrored melodies, contextual organ chords, gains, timing, ending behavior and deterministic replay. Archived-score comparisons allow at most eight machine epsilons of relative floating-point roundoff between JavaScript versions; structure and integer choices remain exact. Same-runtime determinism checks remain strict.

## Native browser checks

```sh
npx playwright install --with-deps chromium firefox webkit
npm run test:browser
```

The browser suite checks the launcher, Short/Long engine selection, archived Infinite-setting migration and replay rejection, study navigation, replay links and downloaded filenames, keyboard/touch controls, recording, worker exports, repeat WAVs, stereo drift and cleanup. Audio uses native Web Audio APIs. Linux live-recording checks require an audio output; the GitHub Actions workflow configures a PulseAudio null sink. CI runs Chromium/Firefox on Linux and WebKit on macOS.

Repeated native WAV comparisons allow at most two 16-bit PCM steps and RMS error below 0.01% of signal energy to accommodate floating-point DSP rounding. These tests do not assert identical samples across different browsers or devices.

## Native study audio checks

From the repository root, install `node-web-audio-api` 2.2.0 with `npm install --no-save --package-lock=false node-web-audio-api@2.2.0`, or set `OPEN_AUDIO_RUNTIME` to the absolute `index.js` path of an existing installation. Then run:

```sh
cd studies/g29
node check-batch-g3.cjs
node check-g29-audio.cjs
node scheduler-check.cjs
node check-batch-handoffs.cjs
```

The preserved `0393ded7` g3 replay at 200 Hz and 44.1 kHz must match floating-PCM SHA-256 `a259348dc27fb39ca87c047d36e23d848bd35e18fce689971f799f91bd68dafa` on the retained native backend. Other checks preserve g27/g28 audio, verify deterministic g29 rendering, organ tails and cleanup, and ensure direct organ/chorus voices end before returning bells.

For full batch rendering, analysis and packaging, see [the batch instructions](../studies/g29/README-BATCH.md). Existing versioned reports describe the source and backend that produced them; a player hash can change when controls change even when the rendered audio is identical.

## Replay compatibility

Musical or DSP changes need a new engine identifier; never reuse an identifier for a different Short/Long performance. `ENGINE_VERSION` remains 3 for the preserved legacy planner, while `defaultEngine` selects g21 Short or g29 Long. Removing a duration option does not change the retained performances. Internal unbounded generator calls construct finite melodies and are not an Infinite playback mode.

Scores retain complete planned notes, timing, FM recipes and spatial choices. Live and offline rendering use those same plans. The sample rate belongs to the export settings; live playback uses the device audio rate. Manual Stop and browser scheduling stalls do not alter a saved export. Cleanup follows audio time through the last voice and room tail, including suspension and replacement sessions.
