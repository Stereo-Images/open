# Open g26 — Mirrored Long Studies

Long studies retain the nested mirror: an eleven-note melody turns back through its first five notes after a central sixth note. The whole piece returns through its earlier FM palettes and Principal-organ interludes. The browser player is `deliverables/Open-Mirrored-Study-g26.html`.

The branch is `long-organ-room-g26`. New Long performances use g26. New Short and Infinite performances retain g21, including their existing melody and ending rules. Explicit older version tags retain their original planners and synthesis. Infinite remains available.

## New organ room

g26 gives interlude organs a dedicated 12-second stereo convolution impulse (previously four seconds), with wet gain 0.48 (previously 0.32), unchanged dry gain 0.9, 25 ms pre-delay and the retained +1.5 dB wet high shelf at 1.6 kHz. The room follows the filter and chorus. It does not feed the bell room a second time.

The quiet accompaniment under melody passes still uses the original FM drone synthesizer (`scheduleBassVoice`), with its original envelope, modulation, low-pass filter and bell-room send. Organ registration and organ-room processing apply only to interlude notes. Native isolated-background renders are sample-identical between g25 and g26.

The two section gaps increase symmetrically from five to thirteen seconds, allowing the twelve-second organ tail to finish before the returning bell. This preserves the full-piece time mirror. The complete form remains seed-selected within 10–30 minutes.

## Form

- Each melody follows event order **1–2–3–4–5–6–5–4–3–2–1**. These numbers identify events, not ascending scale degrees.
- Paired events share pitch/register, FM voices, modulation settings, level, duration and planned pan. The ten onset intervals also mirror, with a minimum of four seconds.
- Every melody pass repeats exactly the same pitches. The outward half introduces a new seeded FM palette for each pass; the return half recalls those palettes in reverse order. A six-pass example is **A–B–C–C–B–A**. The two central passes intentionally share the same palette.
- One organ interlude follows every complete pass except the last. Interludes form one expanding/contracting arch, with one to three statements each and a single three-statement center. Six passes use **1–2–3–2–1**. Ten use **1–1–2–2–3–2–2–1–1**. Longer studies stretch this single arch instead of restarting it.
- Paired interludes share their chord, voicing, Principal registration and mirrored statement recipes. The central three-statement interlude is itself symmetric. Each chord voice has a centered position and a symmetric smooth amplitude envelope.
- Quiet root/fifth background drones remain in selected melody passes, centered within those passes and matched in their return partners.
- The form contains an even number of at least six passes, selected by the seed to approach its duration target while keeping the completed export between 10 and 30 minutes. This batch ranges from six to sixteen passes.
- The final melody completes the return to its opening pitch and texture, then decays normally. There is no added tonic or organ postlude. The complete room tail is exported.

This is symmetry of the score and synthesis recipes. Oscillator phase, natural bell attacks/decays, chorus motion, resonator motion and reverberation continue forwards. The recording is not a reversed waveform.

## Principal organ and harmony

g26 retains g24's additive Principal/Diapason voice: a firm fundamental with a full but subdued harmonic series, slow wide chorus, 10% filtered feedback and a dedicated twelve-second convolution room. It has no rotary speaker, Hammond percussion or granular layer. The gentle filter sweep returns to its starting cutoff. The quieter interlude energy budget is preserved when envelopes or chord voice counts change. There is no normalization or limiter on the exported mix.

The melody retains the fixed six-note collection `[0,2,4,5,7,9]`; there is no circle-of-fifths modulation. Interlude choices remain I, ii, IV and vi triads or permitted open fifths, with constrained spacing and root/first-inversion triads. Chord selection checks **both occurrences of a reflected pair**, including the preceding/following melody and conservative lingering-note tails. It rejects nominal semitone, tritone and major-seventh overlap clashes. Small voice motion and common tones remain preferences, and octave motion is allowed. These are specific consonance/voicing constraints, not a claim that Western music has one universal set of forbidden chords.

Direct bell voices finish before a thirteen-second transition into an interlude. Direct organ voices and their chorus/feedback finish thirteen seconds before the next bell. Only the room tail occupies that handoff; it clears before the next strike in the native probes. Bell-to-bell resonance continues within each melody.

## Seed batches and WAV exports

`manifest.json` separates eight `reference` studies from eight `random` studies. All use 121 Hz, Long duration and 44.1 kHz stereo 16-bit PCM WAV. Complete export/replay filenames and durations are recorded there and on the analysis workbook's Replays tab.

The reference seeds were drawn until their original eleven-note source theme matched `0b086950` exactly. Applying g26's mirror changes that source theme from `[2,4,2,4,5,7,5,7,9,7,9]` to `[2,4,2,4,5,7,5,4,2,4,2]`. No hidden motif override is required: the delivered filenames alone reproduce them.

The random batch comprises eight unconditioned fresh seed draws, without motif, tempo or timbre filtering. Different seeds can generate the same melodic shape by chance; the unrestricted batch was not filtered by motif, register or sound. All sixteen rendered recordings have different audio hashes.

## Preserved Short Study

Use the full original filename in Revisit, or choose **Play preserved Short Study**:

`open-run-0393ded7-mviswtcb-g3-200hz-short-44100sr-1792628825406.wav`

The `g3`, `200hz`, `short` and `44100sr` fields select the original behavior. A bare `0393ded7` seed under a new default engine, or a filename relabeled g26, is a different performance.

The native g3 regression render is 85.56632370385142 seconds. Its floating-audio digest is `a259348dc27fb39ca87c047d36e23d848bd35e18fce689971f799f91bd68dafa`, identical to the retained g25 player and the established regression digest. This verifies sample identity in the same rendering backend, not byte identity across different browsers or a file altered by mastering.

The older `6fa6f7c1` replay is also retained. Its original unversioned name omitted the settings, so use 113 Hz and Short or the explicit filename:

`open-run-6fa6f7c1-mu1vx9gb-g1-113hz-short-44100sr-1789429181082.wav`

## Validation and analysis

`mirror-validation.json` covers 272 retained-version score comparisons, unchanged Short/Infinite behavior and continuation, and 141 g26 Long scores across 110, 121 and 200 Hz. It checks full event/recipe symmetry, exact repeated pitches, distinct outward palettes, one complete chord-count arch, paired harmony, handoffs and complete endings. `scheduler-validation.json` checks scheduled events at the fast end of the tempo range. `effects-validation.json` checks the chorus/feedback graph and cleanup. `room-validation.json` checks the isolated new room, preserved old room, send levels and lifecycle cleanup.

`audio-validation.json` records native sample-identity comparisons for retained g3, g1, g24 and g25 paths, g26 reproducibility, and isolated one-, two- and three-statement handoffs. `render-validation.json` contains all sixteen file hashes, duration/frame checks, clipping/finite-sample checks and FFmpeg true peaks.

The analysis retains the earlier 16 kHz, three early-note windows, spectral-peak roughness and controlled-FM protocol. Calibration reproduces the saved 128-note `0b086950` g3 model metrics within 2.4e-12 absolute error. Recorded measurements include overlapping notes, background drones and reverb; controlled FM fixes the carrier reference at 200 Hz and decay at 20 seconds. The two roughness columns are relative scales, not interchangeable loudness or perceptual ratings. Organ interlude windows now measure Principal synthesis rather than granular processing.

The workbook includes all-recordings metrics, composition and pacing, exact replay filenames, every bell strike, every organ statement and definitions. Aesthetic recommendations are informed speculation from measured audio and scores, not listening-test results.

## Rebuild

Use Python 3 and Node.js. The native renderer uses `node-web-audio-api` 2.2.0. Set `OPEN_AUDIO_RUNTIME` to that package's absolute `index.js` path when the workspace fallback is unavailable. FFmpeg supplies resampling and true-peak measurement. Python analysis requires NumPy and SciPy. Workbook authoring uses `@oai/artifact-tool` in the supplied primary runtime.

```sh
python3 build.py
node verify-mirror.cjs
node scheduler-check.cjs
node effects-check.cjs
node room-check.cjs
node check-native.cjs
python3 render-batch.py
python3 validate-wavs.py
python3 analysis/calibrate.py
python3 analysis/analyze.py
```

The committed manifest fixes this batch. `select-seeds.cjs` intentionally creates a new random batch if invoked; it is not required to replay or render these sixteen studies. The source package includes the full immutable g25 player, g26 additions, scores and validation evidence. No changes were deployed to the public site or main branch.
