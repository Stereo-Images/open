# Open g24 — Principal Organ, Feedback and Chorus

Long-study interludes now use a Principal/Diapason model with a firm foundation, a fuller series of upper harmonics, a single slow stereo chorus and a small amount of filtered feedback. The rich organ registration, smooth envelopes and dedicated ambient room continue from g23. This is a synthesized interpretation of Principal tone; it is not a sample or a measured reconstruction of a particular acoustic pipe rank.

Open `deliverables/Open-Organ-Chorus-g24.html` in a browser. The four audition choices are `477805c9`, `0b086950`, `1ec1984c` and `08c1db04`, all at a 121 Hz root. Paste a full earlier filename into Revisit to select its original version. New Long performances use g24; new Short and Infinite performances keep g21. Explicit g24 Short and Infinite requests also follow the unchanged g21 path. Infinite has not been removed. The proposed symmetrical melody/whole-piece form is not implemented in this update.

## Sound and signal path

The original organ had stationary stereo stop placement, gentle note panning and reverb. It did not have chorus. The flanger and chorus elsewhere in the retained code belong only to the legacy g7/g8 pedal-bass engines.

The new signal path is **Principal registration → smooth amplitude envelope → gentle filter sweep → stereo chorus with filtered feedback → dedicated organ room**. There is one chorus stage per foreground organ voice. The bells and quiet background drones retain their previous synthesis and effects.

| Setting | Value |
|---|---|
| Principal harmonics, relative to fundamental | 1, 0.58–0.64, 0.36–0.40, 0.28–0.32, 0.10–0.13, 0.08–0.10, 0.045, 0.055 |
| Registration variation | Seeded once per chord statement, shared by its voices |
| Left chorus tap | 20 ms, ±3 ms, 0.06 Hz (16.67 s cycle) |
| Right chorus tap | 28 ms, ±3.4 ms, 0.08 Hz (12.5 s cycle), opposite modulation polarity |
| Chorus placement | Full left/right wet taps; existing dry stereo placement retained |
| Dry path gain | 0.92 |
| Wet gain per side | 0.18 before feedback compensation; 0.162 after compensation |
| Delay feedback | 10% per tap, damped at 850 Hz with Q 0.45 |
| Chorus/feedback release | Smoothly to zero over the final 0.5 s of each organ voice |
| Organ room | Existing four-second room, 25 ms pre-delay, dry 0.90 / wet 0.32 |
| Room wet EQ | Existing +1.5 dB shelf at 1600 Hz |

The wet gains are parallel-path amplitudes, not a conventional 18% dry/wet crossfade. The source oscillators stay at their planned pitches; the chorus introduces small pitch motion in the delayed signal. There is no added rotary speaker, percussive organ attack, distortion or independent tremolo. The feedback decays inside short chorus taps rather than making a sequence of long echoes. Both feedback and wet output reach zero at the planned voice endpoint; only the room tail remains in the five-second handoff before the following bell.

Principal voicing was informed by the qualitative harmonic descriptions in [PJM Organs’ Principal Stops](https://www.pjmorgans.com/resources-center/stops/principal-stops/) and [Colin Pykett’s analysis of Principal spectra](https://www.colinpykett.org.uk/principals1.htm). Those sources describe strong foundation tone, prominent even harmonics and a fuller harmonic series. The coefficients above are Open-specific design choices, not values copied from a measured instrument.

## Recordings and replay

- `deliverables/Open-g24-Principal-Organ-Audition.wav`: the isolated first organ interlude from `477805c9`, with the complete room tail (28 seconds). This is an audition excerpt, not a Short Study.
- `deliverables/open-run-477805c9-study-g24-121hz-long-44100sr-1794320235484.wav`: the full 14:50.564 Long study (displayed as 14:51), 121 Hz, approximately 14.67 BPM. It retains the same melody and placement as the g23 comparison. The earlier timestamp is deliberately retained for this direct engine-version comparison; g24 in the filename selects the new sound.

The WAVs are 44.1 kHz stereo 16-bit PCM using the existing export conversion, without normalization, limiting or lossy encoding. The manifest and score capture the complete settings. Each Long melody pass still repeats its exact pitches with changing FM recipes, and interlude counts remain 1,2,3,2,1,2… after successive passes. Harmony, voicing, tempo, endings and quiet background drones are unchanged.

## Validation and compatibility

The branch is `organ-chorus-feedback-g24`. The complete immutable g23 baseline is `source/Open-Rich-Organ-g23.html`. The new player retains the g23 organ code literally and dispatches g24 organ voices through a separate scheduler. It also retains every older engine.

`validation.json` contains 128 retained-version score comparisons and 63 g24 Long-score checks across roots 110, 121 and 200 Hz, covering 2,233 organ notes. It checks that every bell and background-drone recipe, chord, note time, envelope, interlude count, duration and ending remains unchanged. Short and Infinite tests include continuation. `scheduler-validation.json` checks actual event scheduling. `effects-validation.json` checks that there is one chorus stage with two taps, two bounded 10% feedback loops, the correct stereo placement and LFO rates, exact wet/feedback release endpoints, and cleanup on allocation failure.

`audio-validation.json` compares retained g3, g1 and g23 renders in isolated processes, checks one-, two- and three-statement g24 organ interludes, measures their levels against g23, verifies the reverb tail clears before the bell, and checks exact repeatability. `render-validation.json` records full-file PCM, sample peak and true-peak checks. These tests establish regression preservation against the previous player in the tested native renderer; they do not independently establish byte identity to an external historical WAV or across different browser implementations.

The original g3 replay remains:

`open-run-0393ded7-mviswtcb-g3-200hz-short-44100sr-1792628825406.wav`

The older unversioned `6fa6f7c1` name omitted tone and duration. Select 113 Hz and Short, or use its explicit settings filename:

`open-run-6fa6f7c1-mu1vx9gb-g1-113hz-short-44100sr-1789429181082.wav`

## Rebuild

Use Python 3 and Node.js. Native rendering requires `node-web-audio-api` 2.2.0; set `OPEN_AUDIO_RUNTIME` to the absolute path of its `index.js` if it is not at the supplied project fallback. The native adapter uses 30-second scheduling segments and releases completed nodes. FFmpeg measures true peaks.

```sh
python3 build.py
node verify.cjs
node scheduler-check.cjs
node effects-check.cjs
node audio-check.cjs
node render.cjs 477805c9
python3 validate-wavs.py
python3 package.py
```
