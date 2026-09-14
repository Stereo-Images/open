// Dependency-free lifecycle tests with a controllable audio clock and async recorder.
// These exercise scheduling/state, not browser DSP or device audio routing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness(source = fs.readFileSync(path.join(__dirname, '../player.js'), 'utf8')) {
  let wall = 0, nextTimer = 0;
  const timers = new Map(), contexts = [], recordings = [], downloads = [], blobs = [], workers = [];
  const elements = new Map();
  const listeners = [];
  const eventTarget = () => ({
    addEventListener(type, handler) { listeners.push({ target: this, type, handler }); },
    removeEventListener(type, handler) {
      const i = listeners.findIndex(l => l.target === this && l.type === type && l.handler === handler);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatch(type) { for (const l of [...listeners]) if (l.target === this && l.type === type) l.handler({ type }); }
  });
  const param = () => ({ value: 0, events: [], setValueAtTime(v, t) { this.events.push(["set", v, t]); }, linearRampToValueAtTime(v, t) { this.events.push(["ramp", v, t]); },
    exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  class Context {
    constructor() {
      this.currentTime = 0; this.sampleRate = 44100; this.state = 'running';
      this.nodes = []; this.destination = {}; contexts.push(this);
    }
    node(kind) {
      const n = { kind, gain: param(), frequency: param(), detune: param(), Q: param(),
        delayTime: param(), connections: [], disconnected: false,
        connect(to) { this.connections.push(to); }, disconnect() { this.disconnected = true; },
        start(t) { this.startTime = t; }, stop(t) { this.stopTime = t; } };
      this.nodes.push(n); return n;
    }
    createGain() { return this.node('gain'); }
    createStereoPanner() { const n = this.node('panner'); n.pan = param(); return n; }
    createOscillator() { return this.node('oscillator'); }
    createBiquadFilter() { return this.node('filter'); }
    createConvolver() { return this.node('convolver'); }
    createDelay() { return this.node('delay'); }
    createMediaStreamDestination() {
      const n = this.node('stream');
      const track = { stopped: false, stop() { this.stopped = true; } };
      n.stream = { getTracks: () => [track] }; return n;
    }
    createBuffer(channels, length, rate) {
      return { duration: length / rate, sampleRate: rate,
        getChannelData: () => new Float32Array(length) };
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  class OfflineContext extends Context {
    startRendering() {
      return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    }
  }
  class Recorder {
    static isTypeSupported() { return true; }
    constructor(stream, options) {
      this.stream = stream; this.mimeType = options?.mimeType || 'audio/mp4';
      this.state = 'inactive'; recordings.push(this);
    }
    start() { if (this.failStart || Recorder.failStart) throw Error('start'); this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
    finish(text) { this.ondataavailable({ data: new Blob([text], { type: this.mimeType }) }); this.onstop(); }
  }
  class Worker {
    constructor(url) {
      assert.equal(url, 'wav-worker.js');
      this.messages = []; this.terminated = false; workers.push(this);
      const self = {
        postMessage: data => queueMicrotask(() => {
          if (!this.terminated) this.onmessage({ data });
        }),
        close() {}
      };
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../wav-worker.js'), 'utf8'),
        { self, Blob, Float32Array, ArrayBuffer, DataView });
      this.workerScope = self;
    }
    postMessage(data, transfer = []) {
      this.messages.push({ type: data.type, offset: data.offset, frames: data.channels?.[0]?.length });
      const copy = structuredClone(data, { transfer });
      queueMicrotask(() => { if (!this.terminated) this.workerScope.onmessage({ data: copy }); });
    }
    terminate() { this.terminated = true; }
  }
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: id === 'tone' ? '110' : 'infinite',
      classList: { toggle() {} }, style: {}, setAttribute() {}, ...eventTarget(),
      play: () => Promise.resolve(), pause() {}, remove() {}, click() { downloads.push(this.download); } });
    return elements.get(id);
  }
  const addTimer = (fn, ms, repeat) => {
    const id = ++nextTimer; timers.set(id, { fn, due: wall + ms / 1000, repeat: repeat ? ms / 1000 : 0 }); return id;
  };
  const sandbox = { console, Blob, Float32Array, Uint32Array, ArrayBuffer, DataView,
    navigator: { userAgent: 'desktop', maxTouchPoints: 0 },
    crypto: { getRandomValues(a) { a[0] = 12345; return a; } },
    AudioContext: Context, OfflineAudioContext: OfflineContext, MediaRecorder: Recorder, Worker,
    localStorage: { getItem() { return null; }, setItem() {} },
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    document: { readyState: "loading", getElementById: element, createElement: () => element(Symbol()),
      ...eventTarget(), body: { appendChild() {}, removeChild() {} }, hidden: false },
    ...eventTarget(),
    setTimeout: (fn, ms) => addTimer(fn, ms, false), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => addTimer(fn, ms, true), clearInterval: id => timers.delete(id) };
  sandbox.window = sandbox;
  // Test-only access inside the IIFE, without exposing internals in production.
  const expose = `globalThis.api = { startFromUI, stopAllManual, toggleRecording,
    renderWavExport, bufferToWave, beginNaturalEnd, scheduleNote, scheduleDroneChord, handleVisibilityChange,
    state: () => ({ audioContext, bus, isPlaying, isEndingNaturally, isRecording,
      nodes: activeNodes.size, snapshot: sessionSnapshot }),
    setup: () => { ensureAudioContext(); buildMixBus(); },
    suspend: () => { audioContext.state = 'suspended'; },
    resumeWith: (fn) => { audioContext.resume = fn; }
  };`;
  vm.runInNewContext(source.replace(/\}\)\(\);\s*\/\/ --- END OF SCRIPT ---/, expose + '\n})();'), sandbox);
  function advance(seconds, audio = true) {
    const target = wall + seconds;
    while (wall < target - 1e-9) {
      const step = Math.min(0.05, target - wall); wall += step;
      if (audio) for (const ctx of contexts) if (ctx.state === 'running') ctx.currentTime += step;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= wall + 1e-9 && timers.has(id)) {
          if (timer.repeat) timer.due = wall + timer.repeat; else timers.delete(id);
          timer.fn();
        }
      }
    }
  }
  return { api: sandbox.api, sandbox, advance, contexts, recordings, downloads, blobs, elements, Recorder, workers, listeners, timers };
}

test('rapid Stop → Play cannot tear down the new session', async () => {
  const h = harness(); await h.api.startFromUI();
  const old = h.api.state().bus;
  h.api.stopAllManual(false); h.advance(0.02);
  await h.api.startFromUI(); const current = h.api.state().bus;
  assert.notEqual(current, old); h.advance(0.3);
  assert.equal(h.api.state().bus, current);
  assert.equal(current.masterGain.disconnected, false);
  assert.equal(old.streamDest.stream.getTracks()[0].stopped, true);
});

test('a two-minute callback stall resumes one event ahead of the audio clock', async () => {
  const h = harness(); await h.api.startFromUI();
  const ctx = h.contexts[0]; const before = ctx.nodes.length;
  ctx.currentTime += 120; const resumedAt = ctx.currentTime; h.advance(0.1);
  const added = ctx.nodes.slice(before).filter(n => n.kind === 'oscillator');
  assert.ok(added.length > 0 && added.length <= 12);
  assert.ok(added.every(n => n.startTime >= resumedAt));
  const starts = added.map(n => n.startTime); const count = added.length;
  h.advance(1); assert.equal(ctx.nodes.slice(before).filter(n => n.kind === 'oscillator').length, count);
  assert.ok(Math.max(...starts) - resumedAt < 0.2);
});

test('a clock pause does not skip upcoming musical events', async () => {
  const a = harness(), b = harness(); await a.api.startFromUI(); await b.api.startFromUI();
  a.advance(120, false); a.advance(30); b.advance(30);
  assert.deepEqual(notes(a.contexts[0]), notes(b.contexts[0]));
});

test('a finite session still reaches its natural ending after a long callback stall', async () => {
  const h = harness(); await h.api.startFromUI(); h.elements.get('songDuration').value = '60';
  h.contexts[0].currentTime += 120; h.advance(600);
  assert.equal(h.api.state().isPlaying, false); assert.equal(h.api.state().bus, null);
  assert.equal(h.api.state().nodes, 0);
});

test('Stop cancels a Play waiting for audio resume', async () => {
  const h = harness(); h.api.setup(); h.api.suspend();
  let resume; h.api.resumeWith(() => new Promise(r => { resume = r; }));
  const pending = h.api.startFromUI(); h.api.stopAllManual(true);
  h.contexts[0].state = 'running'; resume(); await pending;
  assert.equal(h.api.state().isPlaying, false); assert.equal(h.api.state().bus, null);
});

test('an older rejected resume cannot stop a newer successful Play', async () => {
  const h = harness(); h.api.setup(); h.api.suspend();
  let reject; h.api.resumeWith(() => new Promise((r, j) => { reject = j; }));
  const pending = h.api.startFromUI(); h.contexts[0].state = 'running';
  await h.api.startFromUI(); const current = h.api.state().bus;
  reject(Error('old resume')); await pending;
  assert.equal(h.api.state().bus, current); assert.equal(h.api.state().isPlaying, true);
});

test('two simulated hours keep voice references bounded and preserve the shared reverb', async () => {
  const h = harness(); await h.api.startFromUI(); const bus = h.api.state().bus;
  let peak = 0;
  for (let minute = 0; minute < 120; minute++) {
    h.advance(60); peak = Math.max(peak, h.api.state().nodes);
    assert.ok(h.api.state().nodes < 150);
  }
  assert.ok(peak > 0); assert.equal(bus.reverbNode.disconnected, false);
  assert.ok(h.contexts[0].nodes.filter(n => n.kind === 'oscillator' && n.disconnected).length > 1000);
  h.api.stopAllManual(true); assert.equal(h.api.state().nodes, 0);
});

test('natural cleanup waits for the longest voice, reverb, and audio clock; recording finishes', () => {
  const h = harness(); h.api.setup(); const { audioContext: ctx, bus } = h.api.state();
  h.api.scheduleNote(ctx, bus.masterGain, bus.reverbSend, 110, 0, 60, 0.4);
  h.api.scheduleDroneChord(ctx, bus.masterGain, bus.reverbSend, 110, 0, 32, 0.4, 'maj');
  h.api.toggleRecording(); h.api.beginNaturalEnd();
  h.advance(61); assert.equal(h.api.state().nodes, 0);
  assert.equal(h.api.state().bus, bus); assert.equal(h.recordings[0].state, 'recording');
  h.advance(120, false); assert.equal(h.api.state().bus, bus);
  h.advance(11); assert.equal(h.api.state().bus, null);
  assert.equal(h.recordings[0].state, 'inactive');
  assert.equal(bus.reverbNode.disconnected, true);
  assert.equal(bus.streamDest.stream.getTracks()[0].stopped, true);
});

test('natural-ending cleanup cannot kill a replacement session', async () => {
  const h = harness(); await h.api.startFromUI(); h.api.beginNaturalEnd();
  await h.api.startFromUI(); const current = h.api.state().bus;
  h.advance(100); assert.equal(h.api.state().bus, current);
});

test('recordings own their chunks and MIME type across delayed stop callbacks', async () => {
  const h = harness(); await h.api.startFromUI();
  h.api.toggleRecording(); const first = h.recordings[0]; first.mimeType = 'audio/mp4';
  h.api.toggleRecording(); h.api.toggleRecording(); const second = h.recordings[1];
  first.finish('first'); assert.equal(h.api.state().isRecording, true);
  h.api.toggleRecording(); second.finish('second');
  assert.equal(await h.blobs[0].text(), 'first'); assert.equal(await h.blobs[1].text(), 'second');
  assert.match(h.downloads[0], /\.m4a$/); assert.match(h.downloads[1], /\.webm$/);
});

test('recording start failure does not leave a false recording state', async () => {
  const h = harness(); await h.api.startFromUI(); h.Recorder.failStart = true;
  h.api.toggleRecording(); assert.equal(h.api.state().isRecording, false);
});

test('mobile backgrounding cancels pending audio resume and closes the context', async () => {
  const h = harness(); h.api.setup(); h.api.suspend();
  h.sandbox.navigator.userAgent = 'iPhone';
  let resume; h.api.resumeWith(() => new Promise(r => { resume = r; }));
  const pending = h.api.startFromUI(); h.api.handleVisibilityChange({ type: 'pagehide' });
  resume(); await pending;
  assert.equal(h.api.state().audioContext, null);
  assert.equal(h.api.state().bus, null); assert.equal(h.api.state().isPlaying, false);
});

test('zero is a valid export seed', async () => {
  const h = harness(); h.sandbox.crypto.getRandomValues = a => { a[0] = 0; return a; };
  await h.api.startFromUI(); h.elements.get('songDuration').value = '60';
  const pending = h.api.renderWavExport(); assert.equal(h.contexts.length, 2);
  h.contexts[1].reject(Error('render')); await pending;
});

function notes(ctx) {
  // Exclude control oscillators feeding filter detune; compare the musical voices.
  const controls = new Set(ctx.nodes.filter(n => n.kind === 'oscillator' &&
    n.connections.some(g => g.connections?.some(target =>
      ctx.nodes.some(f => f.kind === 'filter' && f.detune === target)))));
  return ctx.nodes.filter(n => n.kind === 'oscillator' && !controls.has(n)).map(n => [n.frequency.value, n.detune.value, n.startTime, n.stopTime]);
}

test('export leaves live notes unchanged, rejects concurrent exports, and recovers from failure', async () => {
  const a = harness(), b = harness(); await a.api.startFromUI(); await b.api.startFromUI();
  a.elements.get('songDuration').value = '60';
  b.elements.get('songDuration').value = '60';
  const pending = a.api.renderWavExport(); await a.api.renderWavExport();
  assert.equal(a.contexts.length, 2);
  a.advance(30); b.advance(30); assert.deepEqual(notes(a.contexts[0]), notes(b.contexts[0]));
  a.contexts[1].reject(Error('render')); await pending;
  const retry = a.api.renderWavExport(); assert.equal(a.contexts.length, 3);
  a.contexts[2].reject(Error('render')); await retry;
});

test('live voice parameters and timing match the original source for ten minutes', async (t) => {
  const original = process.env.OPEN_BASELINE;
  if (!original) { t.skip('Set OPEN_BASELINE to an original player.js for comparison'); return; }
  const a = harness(), b = harness(fs.readFileSync(original, 'utf8'));
  await a.api.startFromUI(); await b.api.startFromUI(); a.advance(600); b.advance(600);
  // Ignore stopped/disconnected bookkeeping; oscillator parameters and times must match.
  assert.deepEqual(notes(a.contexts[0]), notes(b.contexts[0]));
});

test('export retains its independent original sequence and ending', async (t) => {
  const original = process.env.OPEN_BASELINE;
  if (!original) { t.skip('Set OPEN_BASELINE to an original player.js for comparison'); return; }
  const a = harness(), b = harness(fs.readFileSync(original, 'utf8'));
  await a.api.startFromUI(); await b.api.startFromUI();
  a.elements.get('songDuration').value = '600'; b.elements.get('songDuration').value = '600';
  const pendingA = a.api.renderWavExport(), pendingB = b.api.renderWavExport();
  const caughtB = pendingB.catch(() => {});
  assert.deepEqual(notes(a.contexts[1]), notes(b.contexts[1]));
  a.contexts[1].reject(Error('render')); b.contexts[1].reject(Error('render'));
  await pendingA; await caughtB;
});

function audioBuffer(channels, sampleRate = 44100) {
  return { numberOfChannels: channels.length, length: channels[0].length, sampleRate,
    copyFromChannel(target, channel, offset) { target.set(channels[channel].subarray(offset, offset + target.length)); }
  };
}

test('worker export produces a valid WAV with original quantization and stereo ordering', async () => {
  const h = harness();
  const left = Float32Array.from([-1, -0.5, -0.25, 0, 0.25, 0.5, 1, 2]);
  const right = Float32Array.from([1, 0.5, 0.25, 0, -0.25, -0.5, -1, -2]);
  const blob = await h.api.bufferToWave(audioBuffer([left, right]));
  const wav = Buffer.from(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav'); assert.equal(wav.length, 44 + 8 * 4);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE'); assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 2); assert.equal(wav.readUInt32LE(24), 44100);
  assert.equal(wav.readUInt16LE(34), 16); assert.equal(wav.readUInt32LE(40), 32);
  const actual = Array.from({ length: 16 }, (_, i) => wav.readInt16LE(44 + i * 2));
  assert.deepEqual(actual, [-32768, 32767, -16383, 16383, -8191, 8191, 0, 0, 8191, -8191, 16383, -16383, 32767, -32768, 32767, -32768]);
  assert.equal(left.byteLength, 32); assert.equal(right.byteLength, 32);
  assert.equal(h.workers[0].terminated, true);
});

test('encoding transfers bounded chunks including the final partial chunk', async () => {
  const h = harness(); const frames = 65536 * 2 + 17;
  const channel = new Float32Array(frames); channel[frames - 1] = 1;
  const blob = await h.api.bufferToWave(audioBuffer([channel]));
  const chunks = h.workers[0].messages.filter(m => m.type === 'samples');
  assert.deepEqual(chunks.map(c => [c.offset, c.frames]), [[0, 65536], [65536, 65536], [131072, 17]]);
  assert.equal(blob.size, frames * 2 + 44);
  assert.equal(new DataView(await blob.slice(-2).arrayBuffer()).getInt16(0, true), 32767);
  assert.equal(channel.byteLength, frames * 4);
});

test('encoder failure terminates the worker and allows export to be retried', async () => {
  const h = harness(); await h.api.startFromUI(); h.elements.get('songDuration').value = '60';
  const pending = h.api.renderWavExport();
  h.contexts[1].resolve(audioBuffer([new Float32Array(0)])); await pending;
  assert.equal(h.workers[0].terminated, true);
  const retry = h.api.renderWavExport();
  h.contexts[2].resolve(audioBuffer([Float32Array.from([0, 0.5, 0])])); await retry;
  assert.equal(h.downloads.length, 1); assert.match(h.downloads[0], /\.wav$/);
});

test('worker startup, runtime, and message failures reject encoding', async () => {
  const h = harness(); const buffer = audioBuffer([new Float32Array(4)]);
  h.sandbox.Worker = class { constructor() { throw Error('blocked worker'); } };
  await assert.rejects(h.api.bufferToWave(buffer), /blocked worker/);
  for (const kind of ['error', 'messageerror']) {
    let terminated = false;
    h.sandbox.Worker = class {
      postMessage() { queueMicrotask(() => this['on' + kind]({ preventDefault() {} })); }
      terminate() { terminated = true; }
    };
    await assert.rejects(h.api.bufferToWave(buffer), /WAV encoder/);
    assert.equal(terminated, true);
  }
});

test('empty and failed recordings release callbacks and report the actual outcome', async () => {
  const h = harness(); await h.api.startFromUI();
  h.api.toggleRecording(); const empty = h.recordings[0];
  empty.state = 'inactive'; empty.onstop();
  assert.equal(h.api.state().isRecording, false);
  assert.equal(empty.onstop, null); assert.equal(empty.ondataavailable, null);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.elements.get('playerStatus').textContent, 'Recording contained no audio');
  h.api.toggleRecording(); const failed = h.recordings[1];
  failed.onerror(); failed.finish('partial');
  assert.equal(h.elements.get('playerStatus').textContent, 'Recording failed; partial audio saved');
  assert.equal(failed.onerror, null); assert.equal(failed.onstop, null);
  assert.equal(await h.blobs[0].text(), 'partial');
  h.Recorder.failStart = true; h.api.toggleRecording();
  assert.equal(h.recordings[2].onstop, null);
});

test('a stalled encoder times out, leaves playback running, and allows export retry', async () => {
  const h = harness(); await h.api.startFromUI(); h.elements.get('songDuration').value = '60';
  const NativeWorker = h.sandbox.Worker;
  let worker;
  h.sandbox.Worker = class {
    constructor() { worker = this; }
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  const pending = h.api.renderWavExport();
  h.contexts[1].resolve(audioBuffer([new Float32Array(4)]));
  await new Promise(resolve => setImmediate(resolve));
  h.elements.get('songDuration').value = 'infinite';
  h.sandbox.document.hidden = true; h.advance(120);
  assert.equal(worker.terminated, undefined);
  h.sandbox.document.hidden = false; h.advance(31); await pending;
  assert.equal(worker.terminated, true); assert.equal(worker.onmessage, null);
  assert.equal(h.api.state().isPlaying, true);
  h.sandbox.Worker = NativeWorker;
  h.elements.get('songDuration').value = '60';
  const retry = h.api.renderWavExport();
  h.contexts[2].resolve(audioBuffer([new Float32Array(4)])); await retry;
  assert.equal(h.downloads.length, 1);
});

test('encoder progress renews the watchdog instead of limiting total export time', async () => {
  const h = harness(); let worker;
  h.sandbox.Worker = class {
    constructor() { worker = this; }
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  const pending = h.api.bufferToWave(audioBuffer([new Float32Array(65537)]));
  h.advance(20); worker.onmessage({ data: { type: 'ready' } });
  h.advance(20); worker.onmessage({ data: { type: 'ready' } });
  h.advance(20); worker.onmessage({ data: { type: 'done', blob: new Blob(['wav']) } });
  await pending; assert.equal(worker.terminated, true); assert.equal(h.timers.size, 0);
});

test('disposal removes listeners and prevents late render downloads and stale Play', async () => {
  const h = harness(); h.sandbox.document.dispatch('DOMContentLoaded');
  assert.ok(h.listeners.length > 5);
  await h.api.startFromUI(); h.elements.get('songDuration').value = '60';
  h.api.toggleRecording(); const recorder = h.recordings[0];
  const pending = h.api.renderWavExport();
  h.sandbox.__OPEN_PLAYER_KILL__(); h.sandbox.__OPEN_PLAYER_KILL__();
  assert.equal(h.listeners.length, 0); assert.equal(recorder.onstop, null);
  assert.equal(h.api.state().audioContext, null); assert.equal(h.api.state().nodes, 0);
  h.contexts[1].resolve(audioBuffer([new Float32Array(4)])); await pending;
  await h.api.startFromUI();
  assert.equal(h.workers.length, 0); assert.equal(h.downloads.length, 0);
  assert.equal(h.contexts.length, 2); assert.equal(h.timers.size, 0);
});

test('disposal cancels active encoding and rejects its pending promise', async () => {
  const h = harness(); let worker;
  h.sandbox.Worker = class {
    constructor() { worker = this; }
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  const pending = h.api.bufferToWave(audioBuffer([new Float32Array(4)]));
  const rejected = assert.rejects(pending, /disposed/);
  h.sandbox.__OPEN_PLAYER_KILL__(); await rejected;
  assert.equal(worker.terminated, true); assert.equal(h.timers.size, 0);
});


test('one moving bank feeds direct sound and pre-reverb, and releases on replacement', async () => {
  const h = harness(); await h.api.startFromUI();
  const ctx = h.contexts[0], first = h.api.state().bus;
  const bands = first.reverbSend.connections.filter(n => n.type === 'bandpass');
  assert.equal(bands.length, 3);
  assert.ok(first.reverbSend.connections.includes(first.reverbPreDelay));
  for (const band of bands) {
    assert.equal(band.Q.value, 3);
    const blend = band.connections[0];
    assert.equal(blend.gain.value, 0.18);
    assert.deepEqual(blend.connections, [first.reverbPreDelay, first.masterGain]);
    assert.ok(!blend.connections.includes(first.reverbSend));
    const modulation = ctx.nodes.find(n => n.connections.includes(band.detune));
    const lfo = ctx.nodes.find(n => n.connections.includes(modulation));
    assert.ok(lfo.frequency.value > 0 && lfo.frequency.value < 0.04);
  }
  const oldNodes = ctx.nodes.slice();
  h.advance(120);
  assert.equal(ctx.nodes.filter(n => n.type === 'bandpass').length, 3);
  h.api.stopAllManual(false); await h.api.startFromUI(); h.advance(0.3);
  assert.ok(bands.every(n => n.disconnected));
  const lfos = oldNodes.filter(n => n.kind === 'oscillator' && n.frequency.value < 1);
  assert.equal(lfos.length, 3);
  assert.ok(lfos.every(n => n.disconnected && Number.isFinite(n.stopTime)));
  assert.equal(h.api.state().bus.masterGain.disconnected, false);
});


test('each bell owns one chance-driven trajectory shared by its partials and both outputs', () => {
  const h = harness(); h.api.setup();
  const {audioContext: ctx, bus} = h.api.state();
  for (let i=0;i<12;i++) h.api.scheduleNote(ctx, bus.masterGain, bus.reverbSend, 220, i*2, 30, 0.4);
  const pans = ctx.nodes.filter(n => n.kind === 'panner');
  assert.equal(pans.length, 12);
  pans.forEach((pan,i) => {
    assert.deepEqual(pan.pan.events[0], ['set', 0, i*2]);
    const ramp = pan.pan.events[1];
    if (ramp) { assert.equal(ramp[2], i*2+30); assert.ok(Math.abs(ramp[1])<=0.22); }
    const level = pan.connections[0];
    assert.equal(level.gain.value, Math.SQRT2);
    assert.deepEqual(level.connections, [bus.masterGain, bus.reverbSend]);
    assert.ok(ctx.nodes.filter(n => n.kind === 'filter' && n.connections.includes(pan)).length >= 2);
  });
  assert.ok(pans.some(p => p.pan.events.length === 1));
  assert.ok(pans.some(p => p.pan.events.length === 2));
  assert.ok(new Set(pans.map(p => p.pan.events[1]?.[1])).size > 2);
  h.advance(31);
  assert.equal(pans[0].disconnected, true);
  assert.equal(pans[1].disconnected, false);
  assert.equal(bus.reverbNode.disconnected, false);
  h.api.stopAllManual(true);
  assert.ok(pans.every(p => p.disconnected)); assert.equal(h.timers.size, 0);
});

test('offline note panners follow note starts and release after render failure', async () => {
  const h = harness(); await h.api.startFromUI(); h.elements.get('songDuration').value = '60';
  const pending = h.api.renderWavExport(); const ctx = h.contexts[1];
  const pans = ctx.nodes.filter(n => n.kind === 'panner');
  assert.ok(pans.length > 2);
  for (const pan of pans) {
    const start = pan.pan.events[0][2];
    assert.ok(ctx.nodes.some(n => n.kind === 'oscillator' && n.startTime === start));
    assert.equal(pan.pan.events[0][1], 0);
    if (pan.pan.events[1]) assert.ok(pan.pan.events[1][2] > start);
  }
  h.contexts[1].reject(Error('render')); await pending;
  assert.ok(pans.every(n => n.disconnected));
  assert.equal(h.api.state().isPlaying, true);
});
