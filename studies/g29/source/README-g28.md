# Open g28 — Principal chorus interludes

The new player is `deliverables/Open-Principal-Plenum-g28.html`, on branch `principal-plenum-g28`. New Long performances use g28. The g27 composition is retained: the same seed gives the same melody, FM recipes, quiet accompaniment, chords, voicings, timing, mirror structure and ending. Only interlude organ synthesis and its filter bandwidth change. Short and Infinite defaults remain g21; all explicit old version tags retain their existing paths.

## Fuller pipe-organ registration

The target is a full but restrained Baroque-style Principal chorus, inspired by the user's reference to Bach's Little Fugue in G minor, BWV 578. It is a synthesized registration, not a sample or exact recreation of a particular performance or instrument.

- Principal 8′, Octave 4′ and Superoctave 2′ are separate periodic pipe ranks, each with its own voiced harmonic spectrum.
- A quiet three-rank mixture at frequency ratios 3, 6 and 8 adds brilliance. These are timbral components, not newly scheduled chord notes.
- Only the lowest chord voice gets a restrained 16′ octave doubling. It ends with that chord; no independent pedal line is introduced.
- Each rank has a stable seeded phase and at most 0.6 cents of static detuning. Paired interludes and reflected chord statements receive matching recipes.
- The low-pass sweep opens from roughly 2.4 kHz to 3.1 kHz and returns. The earlier roughly 0.5–0.7 kHz sweep removed much of the upper-rank contribution.
- Rank power is normalized, with a fixed 1.12 calibration factor relative to the inherited voice gain. There is no full-mix normalization or limiter.

## Exact chorus and reverb settings retained

The existing `ORGAN_CHORUS_PROFILE` is used unchanged: dry 0.92; wet 0.18 per side; delays 20/28 ms; modulation depths +3.0/−3.4 ms; rates 0.06/0.08 Hz; wet pans −1/+1; 10% feedback damped at 850 Hz. Feedback and wet taps release before each direct voice ends.

The g27 stereo convolution room is retained unchanged: 12-second impulse, 25 ms predelay, dry gain 0.8, wet gain 1.1, +1.5 dB wet shelf at 1.6 kHz, decay exponent 0.9. Filtering and chorus feed this room once. No additional bell-room send is added.

Organ entry remains 6–14 seconds after the preceding final strike, during its decay. Direct organ and chorus finish two seconds before the returning bell; only the room tail can continue underneath. Quiet drones under melodies remain the legacy FM synthesizer.

## Preserved replay

Use the original complete filename, including g3, in Revisit or the preserved Short Study button:

`open-run-0393ded7-mviswtcb-g3-200hz-short-44100sr-1792628825406.wav`

Its established same-backend floating PCM digest is `a259348dc27fb39ca87c047d36e23d848bd35e18fce689971f799f91bd68dafa`. The new g28 registration does not replace old g27 exports. A g28-tagged performance intentionally has a different organ sound.

## Audition and delivery

`manifest-g28.json` identifies the new complete 17:45 rendering of 40dc1965. The earlier `manifest.json`, scores, analysis and g27 deliverables remain historical g27 data; they have not been relabeled as g28 renders. The player can apply g28 to any of the previous sixteen seeds. No new seed search or sixteen-file rerender is part of this tonal revision.

The A/B WAV contains the same 50-second transition from g27 first, then two seconds of silence, then g28. Both use their actual mix gain; no loudness matching is applied to the excerpt. The organ enters at 0:10 and 1:02, with the returning bell at 0:34 and 1:26. Only 20 ms fades are applied at excerpt boundaries.

## Checks and reproducibility

- `g28-score-validation.json`: 296 retained-version score comparisons; 57 new Long scores across 110, 121 and 200 Hz; exact bell/background scores; unchanged harmony/timing; mirrored organ recipes; deterministic replay; unchanged Short/Infinite behavior.
- `g28-effects-validation.json`: independent ranks, full-width chorus, exact retained modulation settings, one 12-second convolution room and node cleanup.
- `g28-audio-validation.json`: sample-identical g3 and g27 checks, unchanged accompaniment audio, deterministic new organ, measurable reverb tail and zero direct organ audio after the returning-bell time for 1/2/3-statement interludes.
- `g28-full-render.json` and `g28-delivery-validation.json`: rendered waveform hash, clipping/finite samples, full-export timing, true peak and A/B boundaries.

```sh
python3 build-g28.py
node verify-g28.cjs
node check-g28-effects.cjs
node check-g28-audio.cjs
node render-g28.cjs
python3 make-g28-preview.py
```

The renderer uses `node-web-audio-api` 2.2.0. Set `OPEN_AUDIO_RUNTIME` to its absolute `index.js` path when the adjacent workspace runtime is unavailable. FFmpeg, NumPy and SciPy support waveform checks. Original g27 design and validation are documented in `source/README-g27.md`. No public deployment or main-branch change was made.

Registration references: American Guild of Organists, https://old.agohq.org/glossary-of-terms/ ; BYU OrganTutor, https://organ.byu.edu/organtutor/organ_registration/chorus_registration/introduction/page3.htm and https://organ.byu.edu/organtutor/organ_registration/stop_pitches/mixtures/page3.htm . The reference is a general Principal chorus: there is no single mandatory BWV 578 stop combination.
