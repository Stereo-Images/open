// Dependency-free lifecycle tests with a controllable audio clock and async recorder.
// These exercise scheduling/state, not browser DSP or device audio routing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness(source = fs.readFileSync(path.join(__dirname, '../../player.js'), 'utf8')) {
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
    dispatch(type, event = {}) {
      for (const l of [...listeners]) if (l.target === this && l.type === type)
        l.handler({ type, target: this, ...event });
    }
  });
  const param = () => ({ value: 0, events: [], setValueAtTime(v, t) { this.events.push(["set", v, t]); }, linearRampToValueAtTime(v, t) { this.events.push(["ramp", v, t]); },
    exponentialRampToValueAtTime(v, t) { this.events.push(["exp", v, t]); },
    setTargetAtTime(v, t, c) { this.events.push(["target", v, t, c]); },
    cancelScheduledValues(t) { this.events.push(["cancel", t]); } });
  class Context {
    constructor() {
      this.currentTime = 0; this.sampleRate = 44100; this.state = 'running';
      this.nodes = []; this.destination = {}; contexts.push(this);
    }
    node(kind) {
      const n = { kind, gain: param(), frequency: param(), detune: param(), Q: param(),
        delayTime: param(), connections: [], disconnected: false,
        connect(to) { this.connections.push(to); }, disconnect() { this.disconnected = true; },
        start(t) { this.startTime = t; }, stop(t) { this.stopTime = t; },
        setPeriodicWave(wave) { this.wave = wave; } };
      this.nodes.push(n); return n;
    }
    createGain() { return this.node('gain'); }
    createBufferSource() { const n = this.node('bufferSource'); n.playbackRate = param(); return n; }
    createStereoPanner() { const n = this.node('panner'); n.pan = param(); return n; }
    createOscillator() { return this.node('oscillator'); }
    createPeriodicWave(real, imag, options) { return { real, imag, options }; }
    createBiquadFilter() { return this.node('filter'); }
    createConvolver() { return this.node('convolver'); }
    createDelay() { return this.node('delay'); }
    createMediaStreamDestination() {
      const n = this.node('stream');
      const track = { stopped: false, stop() { this.stopped = true; } };
      n.stream = { getTracks: () => [track] }; return n;
    }
    createBuffer(channels, length, rate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { length, numberOfChannels: channels, duration: length / rate, sampleRate: rate,
        getChannelData: ch => data[ch],
        copyToChannel: (samples, ch, offset = 0) => data[ch].set(samples, offset) };
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  class OfflineContext extends Context {
    constructor(channels, length, sampleRate) {
      super(); this.length = length; this.sampleRate = sampleRate;
    }
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
      assert.equal(new URL(url, sandbox.location).href, 'https://stereo-images.github.io/open/wav-worker.js?v=1.0');
      this.messages = []; this.terminated = false; workers.push(this);
      const self = {
        postMessage: data => queueMicrotask(() => {
          if (!this.terminated) this.onmessage({ data });
        }),
        close() {}
      };
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../wav-worker.js'), 'utf8'),
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
    if (!elements.has(id)) elements.set(id, { value: id === 'tone' ? '110' : 'long',
      classList: {
        values: new Set(),
        toggle(name, on) { if (on) this.values.add(name); else this.values.delete(name); },
        contains(name) { return this.values.has(name); }
      }, style: { setProperty(name, value) { this[name] = value; } },
      attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
      capturedPointers: new Set(),
      setPointerCapture(id) { this.capturedPointers.add(id); },
      hasPointerCapture(id) { return this.capturedPointers.has(id); },
      releasePointerCapture(id) { this.capturedPointers.delete(id); this.dispatch('lostpointercapture', { pointerId: id }); },
      focus() { sandbox.document.activeElement = this; }, select() { this.selected = true; }, ...eventTarget(),
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
    URL: class extends URL {
      static createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }
      static revokeObjectURL() {}
    }, URLSearchParams,
    location: new URL('https://stereo-images.github.io/open/player.html'),
    document: { currentScript: {src: "https://stereo-images.github.io/open/player.js"}, readyState: "loading", getElementById: element, createElement: () => element(Symbol()),
      ...eventTarget(), body: { appendChild() {}, removeChild() {} }, hidden: false },
    ...eventTarget(),
    setTimeout: (fn, ms) => addTimer(fn, ms, false), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => addTimer(fn, ms, true), clearInterval: id => timers.delete(id) };
  sandbox.window = sandbox;
  // Test-only access inside the IIFE, without exposing internals in production.
  const expose = `globalThis.api = { startFromUI, stopAllManual, toggleRecording,
    renderWavExport, bufferToWave, beginNaturalEnd, scheduleNote, handleVisibilityChange,
    // Lazy wrappers also allow loading the original source, which predates planning.
    planDrone: (...args) => planDrone(...args), renderGroup: (...args) => renderGroup(...args),
    createPerformance: (...args) => createPerformance(...args),
    createPerformanceGenerator: (...args) => createPerformanceGenerator(...args),
    startNewPerformance: () => startPerformance(),
    qualifiedEnding: (...args) => qualifiedEnding(...args),
    replayFromUI: () => replayFromUI(), copyReplayLink: () => copyReplayLink(),
    replayLastPerformance: () => replayLastPerformance(),
    replayLink: (...args) => replayLink(...args), parseReplayInput: (...args) => parseReplayInput(...args),
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

module.exports = { harness };
