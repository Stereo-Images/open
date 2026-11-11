# Open g29 — Sixteen new Long studies

This batch uses the approved g29 engine without any synthesis, gain, timing or compositional changes. The complete batch is published under `studies/g29` on `main`. Its player is `deliverables/Open-g29-Sixteen-New-Studies.html`; only its sixteen study-selector options differ from the previous g29 player.

## The two batches

`manifest.json` contains eight new reference studies and eight new random studies, with exact replay/export filenames, durations and score parameters. All exports are stereo 16-bit PCM WAV at 44.1 kHz and a 121 Hz root.

The eight reference seeds were found by drawing unused random seeds until their entire original eleven-note source motif matched `0b086950`: `[2,4,2,4,5,7,5,7,9,7,9]` semitones above the root. The current Long engine mirrors the first half into `[2,4,2,4,5,7,5,4,2,4,2]`. This selection needs no hidden motif override; each ordinary seed reproduces its performance. The eight random studies are further unconditioned draws. Random seeds may share melodic shapes while producing different performances.

All studies retain exact repetition of melody notes, mirrored note recipes and timing within each pass, new FM palettes on the outward half and their reverse-order return. The central pair intentionally shares a palette. Organ interludes occur after each complete pass except the final one. Their chord-statement counts expand to one central three-statement interlude and then contract. The final melody completes with its normal decay. The absolute timeline is not a strict palindrome because handoffs depend on the preceding bell's decay.

Interludes use the g27 filter contour on the fuller Principal ranks, slow three-band stereo chorus, restrained feedback and the long convolution room. Quiet accompaniment during melody retains the earlier FM drone synth. Organ gains are unchanged. Tempo remains seed-selected within 3–15 nominal BPM, with a four-second minimum within-melody onset interval.

## Original Short Study

Use **Play preserved Short Study**, or paste this entire replay filename into Revisit:

`open-run-0393ded7-mviswtcb-g3-200hz-short-44100sr-1792628825406.wav`

The batch player renders this g3 replay with the preserved floating-PCM SHA-256 digest `a259348dc27fb39ca87c047d36e23d848bd35e18fce689971f799f91bd68dafa`, 3,773,475 frames at 44.1 kHz. This is an exact same-backend regression check, not a guarantee of identical PCM across browser audio implementations. A bare seed or a g29 tag does not request the original g3 synthesis. The retained g29 engine also preserves earlier explicit Short/Long engine tags and the existing Short default. Infinite mode has been removed from both current players; old Infinite settings reset to Short and Infinite replays are rejected.

## Reproduce this batch

Open the self-contained player, select a study, then use Revisit → Export WAV. A supplied full filename can also be pasted into Revisit. The timestamp identifies an export but does not add randomness to its audio.

For scripted reproduction, use the existing `manifest.json` rather than rerunning the seed selector. The selector intentionally generates a different fresh batch.

Run these commands from `studies/g29`:

```sh
python3 build-batch.py
node check-batch-player.cjs
node verify-batch.cjs
node check-batch-g3.cjs
node check-batch-handoffs.cjs
mkdir -p logs
python3 render-batch.py
python3 validate-wavs.py
python3 analysis/analyze.py
```

The native renderer uses `node-web-audio-api` 2.2.0. From the repository root, install it with `npm install --no-save --package-lock=false node-web-audio-api@2.2.0`, or set `OPEN_AUDIO_RUNTIME` to the absolute `index.js` path of an existing installation. Analysis uses FFmpeg, NumPy and SciPy. Rendering and validation are resumable from per-seed result files. All seed filenames are fixed in the manifest before rendering.

## Analysis and verification

The workbook retains the established early-bell spectral centroid, recorded roughness, controlled FM roughness, modulation index and high-frequency energy protocol. It includes every bell strike, composition and pace, organ statements, replay names and methodology. Organ measurements describe the recorded organ passages, including lingering tails; they are not controlled FM measurements.

`batch-selection-validation.json` records motif selection and seed uniqueness. `batch-player-validation.json` checks every replay filename against its saved score. `batch-mirror-validation.json` checks all sixteen scores and 216 preserved-version Short/Long comparisons. `batch-g3-validation.json` records the exact original Short Study PCM check. `batch-handoff-validation.json` checks all organ-to-bell gaps and isolated direct-output probes for one-, two- and three-statement interludes. `render-validation.json` records complete WAV dimensions, distinct audio hashes, finite samples, sample peaks and true peaks.

Aesthetic recommendations are informed speculation from scores and measured audio, not listening-test ratings. Roughness scores are relative; small differences and modulation index alone do not establish perceptual harshness or compositional quality.

The original g29 sound and implementation notes remain in `README.md`. This batch and its preserved replay support are now included in the main release. The production player is generated from this approved engine.

`python3 package-batch.py` packages the source and existing validation records. Original transfer bundles are optional in a Git checkout. To rebuild the analysis workbook, install `@oai/artifact-tool` and run `node analysis/build-workbook.mjs /absolute/path/to/studies/g29`; the JSON analysis is available without that dependency. Earlier version-specific scripts and reports remain historical references; use the g29 and batch commands above for this release.

Unversioned entry points (`build.py`, `verify.cjs`, `player-check.cjs`, `audio-check.cjs`, `effects-check.cjs`, `room-check.cjs`, `handoff-check.cjs`, `package.py`) now run the corresponding g29 workflows. Original development scripts are retained under `source/historical-scripts` as reference text; run the current entry points for this release.
