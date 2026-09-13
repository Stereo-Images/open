# Engineering checks

Run the dependency-free regression suite with Node:

```sh
node --test tests/player.test.cjs
```

To additionally compare live and export oscillator schedules with the pre-hardening implementation:

```sh
git show 8a2d9c747ce1e31f48753169240c1393a422d028:player.js > /tmp/open-baseline.js
OPEN_BASELINE=/tmp/open-baseline.js node --test tests/player.test.cjs
```

The tests use a simulated audio clock, Web Audio nodes, and delayed recorder callbacks. They cover rapid playback changes, pending resume cancellation, mobile background stops, two-hour voice-reference bounds, natural tail cleanup, overlapping recording callbacks, export isolation, export failure recovery, and valid zero seeds. Baseline comparisons check oscillator frequency, detuning, and start/stop times separately for live playback and export; they do not require live and exported music to match each other.

Additional regressions cover stalled scheduler callbacks, pauses in the audio clock, finite-session completion after stalls, WAV headers and original PCM quantization, stereo ordering, bounded transferable chunks, and worker failure recovery. No application dependencies are needed for these tests.

The sparse interface, musical probabilities, synthesis envelopes, live ending rules, export ending rules, and manual Stop fade are retained. Completed voices disconnect after a 100 ms filter-settling allowance. Natural completion releases the bus after the last scheduled voice, filter settling, full impulse response, pre-delay, and a 250 ms return-filter margin. Cleanup uses audio time so browser suspension does not truncate a pending tail. New sessions reset drone timing that belonged to earlier sessions.

If the scheduler resumes after an event's start time has passed, it schedules the next event 50 ms ahead of the current audio clock and keeps the current phrase state. It does not generate missed events. Normal scheduling, clock suspension, and the live/export ending rules retain their previous behavior.

WAV encoding runs in a dedicated worker. At most 65,536 frames per channel are copied and transferred in each message; the next chunk is sent only after the worker acknowledges the previous one. The worker builds the final file from Blob parts, preserving the original 16-bit conversion without a full-size WAV ArrayBuffer on the main thread. The full OfflineAudioContext render buffer is still required (about 649 MB for the maximum stereo export), so long exports remain memory intensive.

## Native browser checks

```sh
npm ci
npx playwright install --with-deps --only-shell chromium firefox webkit
npm run test:browser
```

The development-only Playwright dependency exercises a local HTTP server in Chromium, Firefox, and WebKit. Browser checks verify both pop-up launcher paths, slider keyboard focus, sound in a decoded MediaRecorder download, immediate Stop/Play, and a complete 100-second stereo WAV export with playback interaction during worker encoding. Recording filenames are checked against each browser's actual MIME type. Worker acknowledgements are deliberately delayed in the export check to make that interaction reproducible.

GitHub Actions runs the regression suite with the original baseline and all three browser projects on pushes to `main` and `engineering-hardening`, and on pull requests. Chromium and Firefox run on Linux with a virtual audio output; WebKit runs on macOS so native recording codecs are available. Linux WebKit does not provide MediaRecorder in the tested build. Workflow permissions are read-only; it does not publish or deploy the site.

## Audio routing investigation

The master gain connects to both `AudioContext.destination` and a `MediaStreamAudioDestinationNode`. That stream feeds the unmuted media bridge as well as live recording. The routing check verifies the shared source, native media playback state, nonzero signal in the stream, and bridge teardown. Its analyser is connected only in the test and does not add another audible output.

This establishes two active output paths at the browser level. It does not measure their physical sum, relative device latency, or AirPlay behavior. The existing routing is retained pending device measurements; muting or removing a path could change perceived level, timbre, and mobile playback behavior. A physical comparison should capture direct-only, bridge-only, and combined output with the same stable test signal and unchanged device volume, then compare level and timing. Those modes are diagnostic experiments, not player controls.

These checks do not audition the music or validate actual browser memory peaks, AirPlay, or iOS hardware behavior. Playwright WebKit is not the Safari application or an iPhone. Device checks should cover audible reverb decay and mobile background/restore behavior before release.

## Disposal and failure recovery

The encoder watchdog resets on each worker reply. Thirty foreground timer checks without progress terminate the worker and allow another export; hidden-tab checks reset the counter. It does not limit total rendering or export duration. Tests cover backgrounding, a stalled worker, continuing progress, and retry without stopping live audio.

Recorder callbacks and buffered chunks are released on completion or failure to start. Empty recordings report no audio; recordings that fail but deliver data retain that partial download and report it as partial.

The instance disposer removes event listeners, stops live audio, clears recorder callbacks, terminates active encoders, and removes the hidden bridge. A native browser test reloads the script twice and checks that controls bind once. A pending offline render cannot be cancelled through this disposer: it may finish computing, but its result is discarded without encoding or downloading. Ordinary Stop and Play do not cancel an independent export.


## Long-export memory accounting

The export renders stereo audio at 44,100 Hz with 32-bit float samples, then encodes 16-bit PCM. Every selected duration includes 40 seconds for decay. Calculated payload sizes, in decimal MB:

| Selected duration | Render buffer | WAV file |
| --- | ---: | ---: |
| 1 minute | 35.28 MB | 17.64 MB |
| 5 minutes | 119.95 MB | 59.98 MB |
| 10 minutes | 225.79 MB | 112.90 MB |
| 30 minutes / Infinite | 649.15 MB | 324.58 MB |

Render bytes = `(durationSeconds + 40) * 44100 * 2 * 4`; WAV bytes = `(durationSeconds + 40) * 44100 * 2 * 2 + 44`.

The render buffer remains available during encoding while WAV Blob parts accumulate. One stereo input chunk contains up to 524,288 bytes and its encoded PCM contains up to 262,144 bytes. Chunking bounds these transfers, not the total export footprint. Offline synthesis nodes, reverb buffers, live playback, browser internals, and any temporary copies add overhead. Blob storage and memory reclamation are browser-dependent, so adding payload sizes is not a measured process-RAM peak or a guaranteed minimum-memory requirement. This review accounts for allocations in the code; it does not profile a full-length export on physical devices.

Long exports remain available with the existing duration cap and audio quality. The README advises users to leave memory headroom and retry a shorter duration if necessary; no warning dialog or new export restriction is imposed.

## Moving-resonator experiment

Branch `experiment/moving-resonators` adds three parallel bandpass filters from the existing reverb send into its pre-delay, before convolution. The original reverb send path and direct voices remain connected. Centers are 420, 1050, and 2400 Hz, with Q=3 and a shared gain of 0.18 after summation. Independent sine LFOs move detune by ±480, ±600, and ±420 cents at 0.037, 0.023, and 0.017 Hz. Motion continues across notes and decays; it resets on a new session.

This intentionally colors the reverberant sound and can raise the wet level. There is no processing after reverb and no new control. Live and export share the processor construction without consuming their musical random streams. Each live bus owns and stops its three LFOs; offline LFOs stop at render end and disconnect on success or failure. Natural cleanup adds 100 ms for the resonators to settle before the existing reverb tail allowance. Baseline tests compare musical voice parameters and schedules, excluding the added control oscillators; they do not assert identical output audio.

For local audition: `npm ci`, then `node tests/serve.cjs`, then open `http://127.0.0.1:4173/player.html`. The public GitHub Pages player remains on main.
