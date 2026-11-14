# Open

> *Bell Music for Desktop Listening*

Bells are instruments of distance. Their sound travels far, and that distance is tinged with a special kind of melancholy—the kind that comes after a struggle. I have wanted a music which studies this journey within sound itself: the collision of waves harmonic and inharmonic, and the long decay that follows. Distance gives resonance.

What resonates? [*Open*](https://stereo-images.github.io/open/) answers that question in a multitude of ways. In each performance, every tone is a new physical event, ringing in a particular way and gesturing towards the next. Because Open lives in a browser, I carry that distance with me wherever I go.

*Open* renders low, slow bell tones anchored to familiar harmony, with organ interludes in Long performances. Yet the bell tones themselves are inharmonic—the music resolves from moment to moment, but never within the moment itself.

The sounds do not ask for your full attention. Rather, they sit alongside whatever else is happening: the light in your room, the noise outside, or the work you are doing. 

*Open* is meant to run quietly in the background: no logins, no accounts. Only your last root tone and length are remembered locally. Its uniqueness lies in the unpredictability of a first encounter: you discover the music as it happens. Pressing Play draws a fresh seed; Replay returns to the performance you have just discovered. A performance can be revisited, shared, or saved without changing how the next new performance unfolds.

### Open EP

The planned *Open* EP pairs **Short Study** and **Long Study**, two selected recordings made with this instrument. Each captures one performance from the same musical possibilities available to every listener using Open.

*Release details and listening links will be added here.*

| Track | Listen | Seed | Replay |
| --- | --- | --- | --- |
| Short Study | To be added | To be confirmed | To be added |
| Long Study | To be added | To be confirmed | To be added |

The final track notes will identify the complete seed that generated each performance, together with its root tone, length, WAV sample rate, and complete replay link or original export filename. These details preserve the source performance before any mastering applied to the EP.

### Musical Structure & Harmony

Short keeps its evolving walk in one six-note major collection. Long automatically chooses between two melody constructions: a compact eleven-note theme and a twenty-eight-note walk. Each construction can generate many different melodies, held in the root's major collection with melodic tritone jumps corrected. The seed selects the melody independently of its performance settings, so the same melody can unfold at different tempos and with different bell colors. Nominal tempo is between 3 and 15 BPM, with at least four seconds between melody strikes.

The eleven-note form follows **theme → mirror → organ**. The twenty-eight-note form follows **theme → organ → mirror → organ**, giving the longer melody space before its return. In both forms, the mirror plays every strike in reverse order with the same corresponding FM recipe and reversed intervals between strikes. The eleven-note turning note repeats on the next seeded beat; the twenty-eight-note turning note returns after the organ. Each new forward theme establishes a fresh FM palette, which its mirror retains. The final mirror ends with its natural tail, without another organ interlude.

Organ interludes expand and contract around the middle of the piece; their contextual chords and inversions account for notes still ringing. Occasional widely spaced suspended chords favor sus2 over sus4; some remain unresolved, while others let one organ voice settle into a major or minor third. Suspensions occur only in the interludes. Decay-aware handoffs preserve the natural forward decay of every sound.

The interludes use fuller Principal organ ranks with a filter contour, wide slow three-band stereo chorus, restrained feedback and a twelve-second convolution room. Direct organ and chorus end two seconds before the returning bell; the room tail may continue. Quiet FM accompaniment under the melody retains its earlier sound. Long completes its final melody with normal decay; Short seeks a qualified ending around its target.

### Technical Architecture

*Open* synthesizes every performance live using the standard Web Audio API, with no runtime dependencies.

* **Drone Voicing:** Sparse root/fifth FM drones support the fixed pitch collection. Long adds contextual organ chords between melody passes, with consonant inversions, voice leading and checks against lingering notes.
* **Synthesis (FM Drift):** Notes are synthesized by frequency modulation oscillator pairs. To replicate the physical imperfections of cast metal, each note triggers a cluster of voices with highly dynamic FM ratios, drifting unpredictably between 1.5 and 4.0 in stable passages. Under higher harmonic tension, voices instead draw from a separate set of irrational ratios (√2, φ, and others) for a more fractured, inharmonic color. This introduces a wild, inharmonic metallic smear to the attack, while a gentle lowpass filter — tuned for a smooth rolloff rather than a resonant peak — quickly tames the high end so the note settles into a dark, woody tone.
* **Slower Bell Pulses:** Prominent, deeply modulated layers with rapid beating receive a selective FM adjustment for slower pulses. Their carrier pitches, amplitudes, timing and decay stay intact.
* **Moving Resonators:** Three slowly moving bandpass filters add a quiet layer of changing overtones to the direct sound and reverb input. Their motion continues through notes and decays.
* **Stereo Drift:** Each bell strike and bass note starts centered and has a 65% chance of drifting gently to its own stereo position over the note’s duration. Panning uses a separate random stream and feeds both the direct sound and reverb.
* **Glacial Pacing:** Event density is limited to preserve long spaces between strikes and allow the reverb tail to breathe. The scheduler will never exceed roughly 15 strikes per minute.
* **Physics:** Physical decay is modeled by reducing the Modulation Index (brightness) faster than the Amplitude (volume). The sound starts complex and fades into a pure sine wave.
* **Delayed Entry:** The scheduler begins slightly before the first audible event, avoiding an abrupt “start button” feeling.
* **Acoustics:**
    * **Impulse Response:** The bells retain their 10-second convolution response, with a decay-curve exponent of 2.8. Long organ interludes also use a dedicated 12-second room after the spectral chorus.
    * **Pre-Delay (15ms):** Reverb arrives close to the dry strike while preserving the 10ms bell attack.
    * **Filter (4200Hz):** The reverb return is low-passed to remove digital harshness while keeping the upper harmonics.

### Usage
A desktop browser is recommended for listening, with keyboard shortcuts for recording and WAV export.

Set the length and root tone before pressing Play. Choose Short or Long.

1. **Length:** Short is a song-like form with a 1-minute ending target and typically lasts about 1–3 minutes, allowing the phrase to resolve and decay. It can close on a qualified fifth or sixth near its target, with tonic fallback. New Long performances complete a mirrored form lasting 10–30 minutes, including the final melody pass and decay. Durations vary with each performance.
2. **Root Tone:** Drag the dial up to raise the root frequency or down to lower it, using a mouse or touch. The range is 110–200 Hz. With the dial focused, use the arrow keys for 1 Hz adjustments. The readout below the dial shows the selected frequency.
3. **Play:** Create a new performance using the selected root tone and length. When you open a shared link, the button reads **Play this performance** and starts that saved performance. **Start a new performance** creates something new instead.
4. **Replay:** Restart the current or most recent performance from the beginning with its saved root tone, length, and WAV sample rate. Replay restores the dial and length even if you changed them after stopping. It is disabled until a performance has started, then remains available during playback, after Stop, and after a natural ending.
5. **Stop:** Fade out playback. The most recent performance remains available to replay, share, or export.

During playback, including the final notes and reverb tail, Play stays highlighted, the length menu and dial are locked, and both controls and the frequency readout turn gray. Stop becomes highlighted and the controls become available again when the sound finishes, or when you press Stop. Changed settings apply to the next new performance started with Play.

Replay remembers only the most recent performance in the current page session. Reloading or closing the page clears it. Keep a replay link or the original WAV filename to return later through Revisit.

Your last length and root tone are remembered locally. On mobile, keep the player page active: switching apps or tabs, or locking the screen, stops playback. Press Replay to restart the last performance if the page session is still available, or Play to start a new one.

### Revisiting a Performance

Open **Revisit** below the playback buttons to load a saved performance, share a replay link, or export a WAV.

Every newly generated performance can also arise independently through another random Play at the same root tone and length. Its seed and settings preserve the choices needed to return to it. Chance rediscovery of a particular performance is extremely rare; sharing its complete replay link makes that return direct. New performances follow the same musical rules, without a catalog of favored recordings or a musical-quality score selecting the results.

1. **Load & play:** Paste a seed, an Open export filename (with or without `.wav`, including `.mp3` or `.flac` conversions), or a replay link, then press Load & play. A seed uses the root tone and length currently selected above. Complete export filenames and replay links restore the saved settings automatically, including the root tone dial position. Opening a replay link prepares the controls and presents **Play this performance**; it never starts audio automatically. Once loaded and playing, this becomes the performance returned to by the main Replay button. After playback starts, Play creates a new performance and Replay returns to the most recent one.
2. **Copy replay link:** After playing or replaying, copy a link to that performance. It includes the seed and all settings needed to revisit it. If clipboard access is unavailable, a selected link appears for manual copying. Copy and export always refer to the current or most recent performance, even if you change the controls after stopping.
3. **Export again:** Use Export WAV in Revisit, or **`Shift + E`**, to render the performance from its beginning. You can stop listening immediately and still export its complete planned ending. A saved replay link or new WAV filename lets you return after closing the page.

Short performances use 8-character seeds; Long performances use 17-character seeds. To replay a performance, enter its seed with the same root tone and length, or use its complete replay link or original export filename to restore all saved settings automatically. Saved seeds retain their original musical form.

The saved sample rate is retained for WAV rendering; live playback uses the device's audio rate. Browser or device differences can affect the rendered samples, and mastering or other processing applied outside Open is not part of replay. Save the audio itself to preserve a particular recording.

### Output & Saving
Save the audio for listening and keep its original filename or replay link to preserve the settings. Live recording remains a desktop keyboard feature; WAV export is also available in Revisit.

* **Live Recording:** Press **`Shift + R`** to capture the current mix in real time; press it again to save. The browser selects the recording format, saved as `.webm`, `.ogg`, or `.m4a`. Recording also finishes automatically after a natural ending and its remaining audio tail.
* **Export WAV:** Press **`Shift + E`** or choose **Export WAV** in Revisit to save the current or most recent performance from its beginning as a lossless, 16-bit PCM `.wav` file. The WAV uses the same planned notes, FM variations, stereo movement, resonators, reverb, and natural ending as live playback. You can export while listening or after Stop; stopping early does not shorten the planned performance. Repeated exports preserve it until the next Play, Replay, or page close. Keep the original filename: it stores the seed and complete replay settings.
* **Timing:** Export reproduces the intended performance and its complete natural ending and reverb tail, excluding browser stalls and manual Stop fades. To start a new performance, press Play again.
* **Rendering:** WAV rendering runs independently through `OfflineAudioContext`, with encoding in a worker. Revisit and the browser tab title show preparation, rendering, encoding, and completion or failure. Longer runs take time to render; pressing Shift + E again while busy does not queue another export. The shortcut also works while the length menu or root tone dial has focus, and is ignored while typing in the replay field. New runs use the sample rate captured from the live audio context (commonly 44.1 or 48 kHz); a complete replay link or filename restores its recorded WAV sample rate. Export does not interrupt playback. Small rendering differences across browsers or devices are possible; the performance is shared, rather than a recording of the device output.

**Long exports need memory.** For 30 minutes of stereo audio, the uncompressed render buffer is about 635 MB at 44.1 kHz or 691 MB at 48 kHz; the WAV adds about 318 MB or 346 MB. Browser internals and synthesis add to these requirements. Leave plenty of available memory and close other demanding tabs or apps before a long export. If an export fails or the tab closes, try a Short performance. These are calculated data sizes in decimal MB, not measured peak RAM requirements.


### Development and Checks

The main player and [Long Studies page](https://stereo-images.github.io/open/studies/) share `player.js`, `style.css` and `wav-worker.js`. Edit those files directly; no player-generation step is needed. Verify from the repository root:

```sh
npm ci --ignore-scripts
npm run check:player
npm test
npm run test:study
npm run test:browser
```

Native browser checks use Playwright Chromium, Firefox and WebKit; see the [development notes](tests/README.md) for installation, scripted WAV rendering and regression checks.

The [seed-generation notes](docs/ordinary-seeds.md) describe the complete Long seed format, ordinary generation, duration constraints and preservation of saved studies. The [theme and mirror notes](docs/theme-mirror-pairs.md) document the musical form.

---

### License

[MIT License](LICENSE). Copyright (c) 2026 Aaron Koppel.


