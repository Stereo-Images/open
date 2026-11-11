# Open g29 — Filtered organ with slow spectral chorus

This directory contains the g29 engine and its sixteen-study batch, now published on `main`. See `README-BATCH.md` for those recordings, their player, analysis and replay checks. The engine sound described below is unchanged.

The standalone engine player is `deliverables/Open-Filtered-Spectral-Organ-g29.html`; the main site uses the same engine in the root `player.js`. New Long performances use g29. Short defaults to g21. Only Short and Long are available; saved Infinite preferences reset to Short, and Infinite replays are rejected. Earlier explicit Short and Long engine tags retain their previous planners and synthesis.

## Sound

The fuller g28 Principal ranks remain, including the restrained low-octave foundation. The exact per-voice g27 filter sweep is restored. This restores the earlier roughly 0.5–0.7 kHz contour rather than using g28's roughly 2.4–3.1 kHz contour. Resonance stays at Q 0.45. The new generator pairs the deterministic g28 voice planner with the g27 filter planner, preserving the g28 pipe phases, rank levels, detuning and gain without changing the melody stream.

Spectral chorus is implemented as three frequency-selective wet bands with independent slow delay modulation. It is not FFT resynthesis, pitch transposition or granular processing. The dry path remains single and unsplit. Only the wet paths receive the 180/500 Hz band filters, so the crossover filters do not color the direct organ tone. The two filters overlap smoothly; the wet sum is intentionally not a flat crossover reconstruction.

| Band | Wet gain per side | Delay L/R | Depth L/R | Rate L/R | Wet pan L/R |
| --- | --- | --- | --- | --- | --- |
| Below 180 Hz | 0.055 | 31 / 39 ms | +1.2 / −1.5 ms | 0.023 / 0.029 Hz | −0.35 / +0.35 |
| 180–500 Hz | 0.22 | 25 / 34 ms | +3.5 / −4.1 ms | 0.037 / 0.043 Hz | −1 / +1 |
| Above 500 Hz | 0.24 | 22 / 31 ms | +4.2 / −4.8 ms | 0.053 / 0.061 Hz | −1 / +1 |

These rates give approximately 16–43-second cycles. The low foundation has gentler, narrower modulation; body and upper partials have full-width wet voices. The wet paths include 10% feedback damped at 850 Hz. Dry gain remains 0.92. This replaces the old broadband chorus stage; two chorus stages are not stacked.

The same g27 stereo convolution room follows the spectral chorus: 12-second impulse, 25 ms predelay, dry 0.8, wet 1.1, +1.5 dB wet shelf at 1.6 kHz and decay exponent 0.9. The room is fed once, and the bell-room send is not duplicated.

## Scope and structure

All changes apply only to Long-study interlude organs. Melody notes, bell FM recipes, quiet legacy FM drones under melody, chord choices, inversions, timing, mirroring and ending behavior are identical to g28 for the same seed. The tempo cap stays 15 BPM.

The organ still enters during the fading final bell, 6–14 seconds after its strike. Direct organ and all chorus/feedback voices finish before the returning bell, leaving the existing two-second gap. Only convolution reverb continues under the return. All reflected interludes and reflected statements preserve matching recipes.

## Replay and audition

The original Short Study still uses its complete original replay name:

`open-run-0393ded7-mviswtcb-g3-200hz-short-44100sr-1792628825406.wav`

Its same-backend floating PCM regression digest is `a259348dc27fb39ca87c047d36e23d848bd35e18fce689971f799f91bd68dafa`. Explicit g27 and g28 recordings retain their original sound.

`manifest-g29.json` identifies the complete new 17:45 g29 rendering of 40dc1965. This tonal revision does not relabel or rerender the earlier sixteen-file batch. Older manifests, scores and workbooks remain historical records of their named engine versions.

The comparison WAV contains a 50-second g27 transition, two seconds of silence, then the same g29 transition. G29 starts at 0:52. Organ entrances are at 0:10 and 1:02; returning bells at 0:34 and 1:26. Original mix gains are retained, with only 20 ms fades at the excerpt boundaries.

## Validation

- `g29-score-validation.json` records 208 preserved-version Short/Long score comparisons and 57 g29 scores across 110, 121 and 200 Hz. It verifies exact g27 filter settings, exact g28 pipe recipes and gains, unchanged non-interlude voices, harmony, timing, endings, mirrored recipes, deterministic replay and unchanged Short behavior.
- `g29-effects-validation.json` verifies three wet bands, six separate slow LFOs, wider middle/upper bands, a steadier foundation, one chorus, one 12-second room, and cleanup including allocation failure.
- `g29-audio-validation.json` verifies preserved g3/g27/g28 PCM, unchanged melody accompaniment, deterministic g29 audio, a continuing room tail and zero direct audio after the returning-bell time for one-, two- and three-statement interludes.
- `g29-organ-comparison.json` records isolated g27/g28/g29 organ measurements. It checks that g29 is darker than g28 in both sampled passages, and records stereo width, correlation and true peak.
- `g29-full-render.json` and `g29-delivery-validation.json` check the complete WAV, exact frames, lack of clipped/nonfinite samples, true peak, player hash, unchanged opening audio and comparison boundaries.

Run these commands from `studies/g29`:

```sh
python3 build-g29.py
node verify-g29.cjs
node check-g29-effects.cjs
node check-g29-audio.cjs
node render-g29.cjs
python3 make-g29-preview.py --old-wav /path/to/original-g27-40dc1965.wav
```

The native renderer uses `node-web-audio-api` 2.2.0. Install it with `npm install --no-save --package-lock=false node-web-audio-api@2.2.0` from the repository root, or set `OPEN_AUDIO_RUNTIME` to the absolute `index.js` path of an existing installation. FFmpeg, NumPy and SciPy support audio measurements. The original g28 implementation and documentation remain under `source/`. This implementation is now included in the main release; the historical validation results below remain attached to their original engine versions.

Implementation reference: SSL's documented band-split chorus uses independent chorus processing for three frequency bands: https://livehelp.solidstatelogic.com/Help/FXModulation.html . MeldaProduction likewise documents per-band chorus: https://www.meldaproduction.com/MChorusMB . The Open cutoffs, rates and mixes above are custom choices for this quiet organ, not copied plugin presets.
