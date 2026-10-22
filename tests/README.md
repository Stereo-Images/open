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

The tests use a simulated audio clock, Web Audio nodes, and delayed recorder callbacks. They cover rapid playback changes, pending resume cancellation, mobile background stops, two-hour voice-reference bounds, natural tail cleanup, overlapping recording callbacks, export isolation, export failure recovery, and valid zero seeds. The original-source baseline checks live musical oscillator frequency, detuning, and start/stop times. Matching-export tests compare the current live and offline voice controls, envelopes, stereo trajectories, room impulse, resonator phase origin, and natural endings.

Additional regressions cover stalled scheduler callbacks, pauses in the audio clock, finite-session completion after stalls, WAV headers and original PCM quantization, stereo ordering, bounded transferable chunks, and worker failure recovery. No application dependencies are needed for these tests.

Replay checks cover seed and legacy-filename input, full filename/link round trips,
sample-rate restoration, validation without interrupting playback, URL loading
without autoplay, fresh seeds on Play, clipboard fallback, and pending-resume
cancellation. The main Replay button restarts the latest session independently
of edited controls or Revisit input, including after Stop or a natural ending.
Checks cover its initial disabled state, saved tone/dial/length/export-rate
restoration, Infinite continuation reset, cancellation, and native button wiring.
Reloading clears the latest session; Revisit's Load & play restores saved links
and filenames. Frozen engine-1 score hashes guard a Short fixture
(`d5f9fea7`, 110 Hz) and a Long fixture (`d1a0b62b`, 121 Hz).
These fixtures were generated with commit
`400bde65e914e3419f84d783f54a2dc2d3cf54e8`. Hashes normalize numbers to eight
decimal places to allow last-bit math differences across JavaScript engines.
They verify planned musical data;
native rendering is covered separately by the browser suite, including a page
reload and replay from a downloaded filename. That comparison uses the same
PCM tolerance as repeated exports (at most two 16-bit steps, RMS error below
0.01% of the signal). Future musical or
DSP changes must bump `ENGINE_VERSION`; never reuse an engine version for a
different performance. UI-only changes can retain it.

The sparse interface, musical probabilities, synthesis envelopes, and manual Stop fade are retained. Engine 1 preserves the original ending rules; engine 3 adds the qualified endings described below. Completed voices disconnect after a 100 ms filter-settling allowance. Natural completion releases the bus after the last scheduled voice, filter settling, full impulse response, pre-delay, and a 250 ms return-filter margin. Cleanup uses audio time so browser suspension does not truncate a pending tail. New sessions reset drone timing that belonged to earlier sessions.

If the scheduler resumes after an event's start time has passed, it schedules the next event 50 ms ahead of the current audio clock and keeps the current phrase state. It does not generate missed events. Normal scheduling and clock suspension retain their previous behavior. Export follows the same planned ending as live playback for the selected engine.

WAV encoding runs in a dedicated worker. At most 65,536 frames per channel are copied and transferred in each message; the next chunk is sent only after the worker acknowledges the previous one. The worker builds the final file from Blob parts, preserving the original 16-bit conversion without a full-size WAV ArrayBuffer on the main thread. The full OfflineAudioContext render buffer is still required (roughly 741–806 MB for 35 minutes of rendered audio at 44.1–48 kHz), so long exports remain memory intensive.

## Root Tone dial

The native range input remains the keyboard and screen-reader control, with a
64px outlined dial face inside an 88px touch target. A primary pointer drag moves
one hertz per two vertical CSS pixels (up raises, down lowers), bounded to
110–200 Hz. Pressing does not jump the value. Pointer capture keeps an adjustment
active outside the target; release, cancellation, lost capture, blur, playback,
and disposal end it. Only the enabled dial target disables touch scrolling.
The marker, frequency readout, accessible value text, and saved settings update
together. Existing playback locking and audio generation are unchanged.

Dependency-free tests cover mouse/touch/pen pointer events, bounds, secondary
pointers, persistence, cancellation, disabled playback, and disposal. Browser
regressions cover native keyboard focus/steps, mouse dragging, reload persistence,
and the narrow layout with its lower divider. Simulated pointer events and desktop
browser tests do not establish actual iPhone gesture behavior.

## Native browser checks

```sh
npm ci
npx playwright install --with-deps --only-shell chromium firefox webkit
npm run test:browser
```

The development-only Playwright dependency exercises a local HTTP server in Chromium, Firefox, and WebKit. Browser checks verify both pop-up launcher paths, slider keyboard focus, sound in a decoded MediaRecorder download, immediate Stop/Play, and a complete stereo WAV export through its natural ending with playback interaction during worker encoding. Recording filenames are checked against each browser's actual MIME type. Worker acknowledgements are deliberately delayed in the export check to make that interaction reproducible.

GitHub Actions runs the regression suite with the original baseline and all three browser projects on pushes to `main`, `engineering-hardening`, `engineering/matching-wav-performance`, and `experiment/moving-resonators`, and on pull requests. Chromium and Firefox run on Linux with a virtual audio output; WebKit runs on macOS so native recording codecs are available. Linux WebKit does not provide MediaRecorder in the tested build. Workflow permissions are read-only; it does not publish or deploy the site.

## Audio routing investigation

The master gain connects to both `AudioContext.destination` and a `MediaStreamAudioDestinationNode`. That stream feeds the unmuted media bridge as well as live recording. The routing check verifies the shared source, native media playback state, nonzero signal in the stream, and bridge teardown. Its analyser is connected only in the test and does not add another audible output.

This establishes two active output paths at the browser level. It does not measure their physical sum, relative device latency, or AirPlay behavior. The existing routing is retained pending device measurements; muting or removing a path could change perceived level, timbre, and mobile playback behavior. A physical comparison should capture direct-only, bridge-only, and combined output with the same stable test signal and unchanged device volume, then compare level and timing. Those modes are diagnostic experiments, not player controls.

These checks do not audition the music or validate actual browser memory peaks, AirPlay, or iOS hardware behavior. Playwright WebKit is not the Safari application or an iPhone. Device checks should cover audible reverb decay and mobile background/restore behavior before release.

## Disposal and failure recovery

The encoder watchdog resets on each worker reply. Thirty foreground timer checks without progress terminate the worker and allow another export; hidden-tab checks reset the counter. It does not limit total rendering or export duration. Tests cover backgrounding, a stalled worker, continuing progress, and retry without stopping live audio.

Recorder callbacks and buffered chunks are released on completion or failure to start. Empty recordings report no audio; recordings that fail but deliver data retain that partial download and report it as partial.

The instance disposer removes event listeners, stops live audio, clears recorder callbacks, terminates active encoders, and removes the hidden bridge. A native browser test reloads the script twice and checks that controls bind once. A pending offline render cannot be cancelled through this disposer: it may finish computing, but its result is discarded without encoding or downloading. Ordinary Stop and Play do not cancel an independent export.


## Long-export memory accounting

The export renders stereo audio at the session's native sample rate with 32-bit float samples, then encodes 16-bit PCM. The render length is derived from the longest planned voice plus per-voice settling (100 ms), resonator settling (100 ms), the full impulse response (10 seconds), pre-delay (15 ms), and return-filter margin (250 ms). Fixed durations also include the live engine's resolution beyond the selected duration. Infinite schedules only events before 30 minutes and includes their full decay.

For an actual rendered duration `T` seconds and sample rate `R`, render bytes = `ceil(T * R) * 2 * 4`; WAV bytes = `ceil(T * R) * 2 * 2 + 44`. For 35 minutes of rendered audio, this means 740.88 MB of sample data at 44.1 kHz or 806.40 MB at 48 kHz, plus a 370.44 MB or 403.20 MB WAV. The README uses about 35 minutes for Long-export memory planning, not as a hard duration cap; longer performances scale proportionally. These are decimal MB payload sizes, not measured RAM peaks.

The render buffer remains available during encoding while WAV Blob parts accumulate. One stereo input chunk contains up to 524,288 bytes and its encoded PCM contains up to 262,144 bytes. Chunking bounds these transfers, not the total export footprint. Offline synthesis nodes, reverb buffers, live playback, browser internals, and temporary copies add overhead. Long exports remain available with a README memory advisory.

## Shared performance and export

Play captures seed, tone, length, its deterministic ending threshold, and the native sample rate. Short has a 1-minute target; Long chooses a target from 10–30 minutes using a random stream separate from the musical and spatial streams. Engine 1 seeks its tonic after the target; engine 3 can also accept a qualified fifth or sixth around that target. A pure planner retains plain note data for the complete timed performance, or the first 30 minutes for Infinite. Musical choices use the existing live random draw order; stereo choices use a separate stream. Live and offline rendering use the same planned voice parameters and rendering functions. New Play replaces the retained performance; an in-flight export keeps its own reference. Stop and natural cleanup release live audio nodes while retaining the score for export. Disposal clears the score.

Infinite continues with an incremental generator after the retained 30-minute prefix. It does not append later events to the score, so retained history remains bounded. Export never advances that generator. Scheduler-stall offsets belong only to live playback and never mutate the score.

A 50 ms scheduling lead-in gives live nodes a common future origin, avoiding late starts for an opening drone. Export starts at that origin. A common session origin controls master fade, the reverb-send envelope, and resonator LFO phase. The room uses a fixed deterministic impulse seed and the same native sample rate for both renderers. The opening reverb target is scheduled once; repeatedly targeting the same level with the same time constant is unnecessary. Tonic-end eligibility uses the planned event time and the existing lookahead allowance, so it does not depend on callback jitter at the duration threshold. Qualified endings also use planned event times.

Regressions check multiple seeds and durations, full voice modulation/envelopes and panning, room samples and LFO start times, zero seeds, repeat exports after Stop/control changes, exporting during replacement Play, stalls, and bounded Infinite history. Native browser tests compare repeat WAV headers and PCM samples and inspect tail silence. Native DSP summation can round differently: the repeat comparison permits at most two 16-bit PCM steps and requires RMS difference below 0.01% of the signal; it does not require identical file bytes. These establish shared scheduling and repeatable rendering in the tested browser; they do not claim a byte-identical recording of physical device output.


## Moving resonators

The main player now includes three parallel bandpass filters from the existing reverb send into its pre-delay, before convolution. The filtered blend also feeds the master directly, exposing its changing overtones without another trip through reverb. The original reverb send path and direct voices remain connected. Centers are 420, 1050, and 2400 Hz, with Q=3 and a shared gain of 0.18 after summation. Independent sine LFOs move detune by ±480, ±600, and ±420 cents at 0.037, 0.023, and 0.017 Hz. Motion continues across notes and decays; it resets on a new session.

This intentionally colors both the direct and reverberant sound and can raise the overall level. The direct resonated layer follows the existing reverb-send envelope because both outputs share the same bank input; there is no second bank or feedback loop. There is no processing after reverb and no new control. Live and export share the processor construction without consuming their musical random streams. Each live bus owns and stops its three LFOs; offline LFOs stop at render end and disconnect on success or failure. Natural cleanup adds 100 ms for the resonators to settle before the existing reverb tail allowance. Baseline tests compare musical voice parameters and schedules, excluding the added control oscillators; they do not assert identical output audio.

### Note-triggered stereo drift

Each bell strike and bass note starts centered and has a 65% chance of moving toward an independently selected position within ±0.22 pan over its own sounding duration. Otherwise it remains centered. One panner is shared by all FM partials belonging to a bell, so overlapping notes can move independently without splitting a single bell into separate trajectories. The panned output feeds both the direct master and the reverb send, before the resonators and convolution. There is no shared drift timer and no additional delay.

A separate seed-derived random stream controls panning without consuming musical randomness. Live panners and center-level compensation gains are released with their notes, using the existing 100 ms filter-settling allowance, while the shared reverb keeps its tail. Offline panners are disconnected when rendering settles. Equal-power center attenuation is compensated for mono voices; spatial movement may still slightly affect mono downmix level. Regression tests check independent note timing, chance holds, partial grouping, pre-reverb routing, bounded cleanup, and offline disposal. Native browser tests render a note to verify center level and movement through its decay.


### Audio setup failure recovery

Fault-injection tests cover failed convolver allocation and interruption midway
through resonator construction. Failed live starts disconnect their partial graph,
stop stream tracks and started oscillators, and permit another Play. Failed offline
resonator setup stops partial oscillators, preserves live playback, and permits
another export. These checks exercise resource ownership, not actual out-of-memory
recovery: a browser process terminated by the OS cannot run JavaScript cleanup.


## Qualified endings (engine 3)

Engine 1 retains its exact score and export behavior, including the frozen Short
and Long fixtures. Engine 3 adds conditional fifth and major-sixth endings to
finite performances. Engine 2 is reserved for the separate tempo experiment;
the app's release line stays v1.0. Bare seeds and fresh Play use engine 3;
versioned links/filenames preserve their engine, and unversioned legacy filenames
assume engine 1 with a warning about missing settings.

A candidate can be the strike straddling the duration target, at most one nominal
interval or six seconds early (whichever is shorter), or a later strike before
the original tonic fallback. It must return to a pitch among the previous four
bell strikes, arrive by at most two semitones, and retain the same harmonic center
for the last four strikes. Tension must be at most 0.25 for fifths or 0.15 for
sixths, and candidates at an arc climax are rejected. A sixth is major-mode only
and must finish a nontrivial, stepwise excursion to that pitch. History resets
across drone-only passages. New drone attacks are excluded; nominal semitone,
major-seventh and tritone clashes with drone voices (including the full room
tail) are rejected. These are explicit musical heuristics, not a psychoacoustic
model of every FM partial or a promise of a pleasing ending.

The gate consumes no random draws, adds no notes, and changes no voice or timing
before the chosen ending. Both renderers consume that same completed score.
Tests cover the recovered eleven-note sixth-ending contour across nine seeds,
rejection cases, 400 dispersed seeds at three tones across Short and Long,
unchanged Infinite continuation, and live/export controls and tail completion.
Native WAV round trips cover both engines, including reload and restoration
from a full filename. Engine-3 files select the qualified-ending behavior;
engine-1 files preserve the original tonic endings.
