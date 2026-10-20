# Open

> *Bell Music for Desktop Listening*

Bells are instruments of distance. Their sound travels far, and that distance is tinged with a special kind of melancholy—the kind that comes after a struggle. I have wanted a music which studies this journey within sound itself: the collision of waves harmonic and inharmonic, and the long decay that follows. Distance gives resonance.

What resonates? [*Open*](https://stereo-images.github.io/open/) answers that question in a multitude of ways. In each performance, every tone is a new physical event, ringing in a particular way and gesturing towards the next. Because Open lives in a browser, I carry that distance with me wherever I go.

*Open* renders low, slow bell tones anchored to familiar harmony. Yet the tones themselves are inharmonic—the music resolves from moment to moment, but never within the moment itself. 

The sounds do not ask for your full attention. Rather, they sit alongside whatever else is happening: the light in your room, the noise outside, or the work you are doing. 

*Open* is meant to run quietly in the background: no logins, no accounts. Only your last root tone and length are remembered locally. Its uniqueness lies in the unpredictability of a first encounter: you discover the music as it happens. Pressing Play draws a fresh seed; Replay returns to the performance you have just discovered. A performance can be revisited, shared, or saved without changing how the next new performance unfolds.



### Musical Structure & Harmony
In Short, Long, and Infinite modes, the engine follows the same rules to shape the changing harmony:

* **Circle of Fifths:** Harmonic centers shift gradually between related keys.
* **Contour Constraints:** A bounded random walk keeps the melody between A2 and G#4. Notes that exceed the range are octave-shifted downward.
* **Tension Mapping:** Cadence choices and resets at the start of an arc update a tension value. Phrase position and tension influence the next cadence; tension also shapes FM brightness, the use of fractured ratios, and whether a drone includes a third.

Short and Long seek a natural tonic ending after their target duration. Infinite continues developing the same musical structure until stopped.

### Technical Architecture

Official release: **v1.0** (1.0.0). Musical engine: **1**.

*Open* uses the standard Web Audio API with no runtime dependencies, using a custom procedural engine to synthesize the environment live.

* **Drone Voicing:** To prevent low-end mud, the engine analyzes tension and melody in real-time. It forces the drone to collapse into a neutral "Open Fifth" when the melody is complex, and only allows the warm "Third" interval to bloom when the harmony is stable.
* **Synthesis (FM Drift):** Notes are synthesized by frequency modulation oscillator pairs. To replicate the physical imperfections of cast metal, each note triggers a cluster of voices with highly dynamic FM ratios, drifting unpredictably between 1.5 and 4.0 in stable passages. Under higher harmonic tension, voices instead draw from a separate set of irrational ratios (√2, φ, and others) for a more fractured, inharmonic color. This introduces a wild, inharmonic metallic smear to the attack, while a gentle lowpass filter — tuned for a smooth rolloff rather than a resonant peak — quickly tames the high end so the note settles into a dark, woody tone.
* **Moving Resonators:** Three slowly moving bandpass filters add a quiet layer of changing overtones to the direct sound and reverb input. Their motion continues through notes and decays.
* **Stereo Drift:** Each bell strike and bass note starts centered and has a 65% chance of drifting gently to its own stereo position over the note’s duration. Panning uses a separate random stream and feeds both the direct sound and reverb.
* **Glacial Pacing:** The engine limits event density to preserve long spaces between strikes and allow the reverb tail to breathe. The scheduler will never exceed roughly 15 strikes per minute.
* **Physics:** The engine models physical decay by reducing the Modulation Index (brightness) faster than the Amplitude (volume). The sound starts complex and fades into a pure sine wave.
* **Delayed Entry:** The scheduler begins slightly before the first audible event, avoiding an abrupt “start button” feeling.
* **Acoustics:**
    * **Impulse Response:** A custom convolution reverb with a 10-second impulse response. Its noise envelope uses a decay-curve exponent of 2.8.
    * **Pre-Delay (15ms):** Reverb arrives close to the dry strike while preserving the 10ms bell attack.
    * **Filter (4200Hz):** The reverb return is low-passed to remove digital harshness while keeping the upper harmonics.

### Usage
A desktop browser is recommended for listening, with keyboard shortcuts for recording and WAV export.

Set the length and root tone before pressing Play.

1. **Length:** Select Short, Long, or Infinite. Short is a song-like form that begins seeking its natural ending after 1 minute and typically lasts about 1–3 minutes. Long is a more ambient form that begins seeking its natural ending at a point chosen between 10 and 30 minutes for each performance. These are ranges rather than fixed runtimes: resolving the phrase and allowing the sound to decay can carry a performance beyond them. Infinite continues until stopped.
2. **Root Tone:** Drag the dial up to raise the root frequency or down to lower it, using a mouse or touch. The range is 110–200 Hz. With the dial focused, use the arrow keys for 1 Hz adjustments. The readout below the dial shows the selected frequency.
3. **Play:** Create a new performance using the selected root tone and length.
4. **Replay:** Restart the current or most recent performance from the beginning with its saved root tone, length, and WAV sample rate. Replay restores the dial and length even if you changed them after stopping. It is disabled until a performance has started, then remains available during playback, after Stop, and after a natural ending.
5. **Stop:** Fade out playback. The most recent performance remains available to replay, share, or export.

During playback, including the final notes and reverb tail, Play stays highlighted, the length menu and dial are locked, and both controls and the frequency readout turn gray. Stop becomes highlighted and the controls become available again when the sound finishes, or when you press Stop. Changed settings apply to the next new performance started with Play.

Replay remembers only the most recent performance in the current page session. Reloading or closing the page clears it. Keep a replay link or the original WAV filename to return later through Revisit.

Your last length and root tone are remembered locally. On mobile, keep the player page active: switching apps or tabs, or locking the screen, stops playback. Press Replay to restart the last performance if the page session is still available, or Play to start a new one.

### Revisiting a Performance

Open **Revisit** below the playback buttons to load an earlier performance, share a replay link, or export a WAV.

1. **Load & play:** Paste an eight-character hexadecimal seed, an Open WAV filename (with or without `.wav`), or a replay link, then press Load & play. A seed or older filename uses the root tone and length currently selected above. New WAV filenames and replay links restore those settings automatically, including the root tone dial position. Opening a replay link prepares the controls and waits for you to press Load & play; it never starts audio automatically. Once loaded and playing, this becomes the performance returned to by the main Replay button. Play always draws a fresh seed, even when a replay link is open.
2. **Copy replay link:** After playing or replaying, copy a link to that performance. It includes the seed, root tone, length, musical engine version, and WAV sample rate. If clipboard access is unavailable, a selected link appears for manual copying. Copy and export always refer to the current or most recent performance, even if you change the controls after stopping.
3. **Export again:** Use Export WAV in Revisit, or **`Shift + E`**, to render the performance from its beginning. You can stop listening immediately and still export its complete planned ending. A saved replay link or new WAV filename lets you return after closing the page.

The generator is deterministic: matching seed, root tone, length, and engine version reproduce the planned notes, timing, FM voices, and stereo movement. The sample rate is retained for WAV rendering; live playback uses the device's audio rate. Browser or device differences can affect the rendered samples, and mastering or other processing applied outside Open is not part of replay. Repeating a seed deliberately revisits a performance; fresh random seeds are not a mathematical guarantee that a seed can never recur.

Older filenames contain a seed and timestamps but omit the root tone, length, and engine version. Replay cannot infer those missing settings from the filename or verify which engine made it. Links and new filenames with an unsupported engine version are rejected with an explanation, rather than silently replayed with changed musical rules. This release supports engine 1; it does not load archived engines or reconstruct a seed from an audio recording.

### Output & Saving
Save the audio for listening and keep its original filename or replay link to preserve the settings. Live recording remains a desktop keyboard feature; WAV export is also available in Revisit.

* **Live Recording:** Press **`Shift + R`** to capture the current mix in real time; press it again to save. The browser selects the recording format, saved as `.webm`, `.ogg`, or `.m4a`. Recording also finishes automatically after a natural ending and its remaining audio tail.
* **Export WAV:** Press **`Shift + E`** or choose **Export WAV** in Revisit to save the current or most recent performance from its beginning as a lossless, 16-bit PCM `.wav` file. The WAV uses the same planned notes, FM variations, stereo movement, resonators, reverb, and natural ending as live playback. You can export while listening or after Stop; stopping early does not shorten the planned performance. Repeated exports preserve it until the next Play, Replay, or page close. Each playback gets a run identifier consisting of the seed and a base-36 start timestamp. Each export gets its actual export timestamp. The filename also carries the complete replay settings: `open-run-<seed>-<start>-g<engine>-<tone>hz-<length>-<rate>sr-<export-timestamp>.wav`. Replaying creates a new run identifier while retaining the musical seed and settings.
* **Timing:** Export reproduces the intended performance, excluding browser stalls and manual Stop fades. A timed run includes its complete natural ending and reverb tail, so its WAV can be appreciably longer than the selected time. Infinite exports the same first 30 minutes of planned events plus their remaining decay, while live playback continues. To start a new performance, press Play again.
* **Rendering:** WAV rendering runs independently through `OfflineAudioContext`, with encoding in a worker. Revisit and the browser tab title show preparation, rendering, encoding, and completion or failure. Longer runs take time to render; pressing Shift + E again while busy does not queue another export. The shortcut also works while the length menu or root tone dial has focus, and is ignored while typing in the replay field. New runs use the sample rate captured from the live audio context (commonly 44.1 or 48 kHz); a complete replay link or filename restores its recorded WAV sample rate. Export does not interrupt playback. Small rendering differences across browsers or devices are possible; the performance is shared, rather than a recording of the device output.

**Long exports need memory.** Plan for Long exports of up to about 35 minutes, though this is not a hard duration limit. For 35 minutes of stereo audio alone, the uncompressed render buffer is about 741 MB at 44.1 kHz or 806 MB at 48 kHz; the WAV adds about 370 MB or 403 MB. Longer endings, decay, browser internals, and synthesis can add to these requirements. Leave plenty of available memory and close other demanding tabs or apps before a long export. Available system memory does not guarantee the browser can complete it; if an export fails or the tab closes, start a shorter run and try again. These are calculated data sizes, not measured peak RAM requirements.


---

### License

[MIT License](LICENSE). Copyright (c) 2026 Aaron Koppel.
