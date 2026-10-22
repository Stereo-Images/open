// --- START OF SCRIPT ---
/* ============================================================
   OPEN — v1
   - Lifecycle: bounded voice tracking, tail-aware completion, and cancellable
     teardown; retains the existing mobile background stop policy.
   - Music Updates Applied: 110Hz Floor/415.30Hz Ceiling, 
     0.20 runDensity cap, and Anti-Doubling FM math.
   - Export: live and offline rendering share a planned performance, including
     the live ending and the complete decay of its longest voice.
   ============================================================ */

(() => {
  "use strict";

  // --- ANTI-DOUBLING KILL SWITCH ---
  if (window.__OPEN_PLAYER_KILL__) {
    console.log("Open Player: Stopping previous instance...");
    window.__OPEN_PLAYER_KILL__();
  }

  let disposed = false;
  const removeListeners = [];
  const pendingRecordings = new Map();
  const cancelEncoders = new Set();
  const pendingDownloads = new Set();
  const idleTitle = document.title;
  let exportTitleTimer = null;
  let cancelToneDrag = () => {};
  function listen(target, type, handler, options) {
    if (!target || disposed) return;
    target.addEventListener(type, handler, options);
    removeListeners.push(() => target.removeEventListener(type, handler, options));
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    removeListeners.splice(0).forEach(remove => remove());
    stopAllManual(true);
    for (const cleanup of pendingRecordings.values()) cleanup();
    for (const cancel of [...cancelEncoders]) cancel();
    for (const cleanup of [...pendingDownloads]) cleanup();
    clearTimeout(exportTitleTimer);
    document.title = idleTitle;
    if (audioContext) {
      try { audioContext.close().catch(() => {}); } catch {}
      audioContext = null;
    }
    cachedImpulseBuffer = null;
    sessionSnapshot = null;
    bridgeAudioEl?.remove();
    bridgeAudioEl = null;
  }
  window.__OPEN_PLAYER_KILL__ = dispose;

  const STATE_KEY = "open_player_settings"; // schema-stable key: don't tie this to the script version
  // Bump when musical planning or synthesis changes. UI-only releases keep this
  // version; unknown versions must never silently play with a different engine.
  // Engine 2 is reserved for the separate tempo experiment. Musical engine
  // identifiers are independent of the public v1.0 release number.
  const ENGINE_VERSION = "3";
  const SUPPORTED_ENGINES = new Set(["1", ENGINE_VERSION]);

  function seedHex(seed) { return seed.toString(16).padStart(8, "0"); }

  function validateReplay(record) {
    if (!SUPPORTED_ENGINES.has(record.engine))
      throw new Error(`This performance needs engine ${record.engine || "(unspecified)"}; this player supports engines 1 and ${ENGINE_VERSION}.`);
    if (!/^[0-9a-f]{8}$/i.test(record.seed || ""))
      throw new Error("Enter an eight-character hexadecimal seed.");
    const tone = Number(record.tone), sampleRate = Number(record.sampleRate);
    if (!Number.isInteger(tone) || tone < 110 || tone > 200)
      throw new Error("The replay root tone must be a whole number from 110 to 200 Hz.");
    if (!["short", "long", "infinite"].includes(record.duration))
      throw new Error("The replay length must be short, long, or infinite.");
    if (record.sampleRate != null && (!Number.isInteger(sampleRate) || sampleRate < 3000 || sampleRate > 384000))
      throw new Error("The replay sample rate is invalid.");
    return { seed: parseInt(record.seed, 16), tone, duration: record.duration,
      engine: record.engine, sampleRate: record.sampleRate == null ? null : sampleRate };
  }

  function parseReplayQuery(params) {
    const keys = ["seed", "tone", "length", "engine", "rate"];
    if (keys.some(key => params.getAll(key).length !== 1))
      throw new Error("The replay link needs one seed, root tone, length, engine version, and sample rate.");
    return validateReplay({ seed: params.get("seed"), tone: params.get("tone"),
      duration: params.get("length"), engine: params.get("engine"), sampleRate: params.get("rate") });
  }

  function parseReplayInput(value) {
    const input = value.trim();
    if (/^https?:\/\//i.test(input)) {
      let url;
      try { url = new URL(input); } catch { throw new Error("The replay link is invalid."); }
      return parseReplayQuery(url.searchParams);
    }
    // A new export is its own compact replay record. Accept names with or
    // without .wav and browser download suffixes; keep seed/settings strict.
    const file = input.match(/^open-run-([0-9a-f]{8})-[0-9a-z]+-g([0-9]+)-([0-9]+)hz-(short|long|infinite)-([0-9]+)sr-[0-9]+(?: ?\([0-9]+\))?(?:\.wav)?$/i);
    if (file) return validateReplay({ seed: file[1], engine: file[2], tone: file[3],
      duration: file[4].toLowerCase(), sampleRate: file[5] });
    const legacy = input.match(/^open-run-([0-9a-f]{8})-[0-9a-z]+-[0-9]+(?: ?\([0-9]+\))?(?:\.wav)?$/i);
    const seed = legacy ? legacy[1] : input;
    if (!/^[0-9a-f]{8}$/i.test(seed))
      throw new Error("Paste an eight-character seed, an Open WAV filename, or a replay link.");
    // Older open-run names use engine 1 by convention. Bare seeds explore the
    // current engine; complete filenames and links always retain their version.
    return { ...validateReplay({ seed, engine: legacy ? "1" : ENGINE_VERSION,
      tone: $("tone")?.value ?? "110", duration: $("songDuration")?.value ?? "short" }),
      partial: true, legacy: !!legacy };
  }

  function replayLink(snapshot) {
    const url = new URL("player.html", window.location.href);
    url.search = new URLSearchParams({ seed: seedHex(snapshot.seed), tone: String(snapshot.tone),
      length: snapshot.duration, engine: snapshot.engine, rate: String(snapshot.sampleRate) }).toString();
    return url.href;
  }

  function exportFilename(snapshot, timestamp) {
    return `open-run-${snapshot.runId}-g${snapshot.engine}-${snapshot.tone}hz-${snapshot.duration}-${snapshot.sampleRate}sr-${timestamp}.wav`;
  }

  function replayStatus(message) {
    if (disposed) return;
    const status = $("replayStatus");
    if (status) status.textContent = message;
    announce(message);
  }

  function updateReplayControls() {
    if ($("replayLast")) $("replayLast").disabled = !sessionSnapshot;
    if ($("copyReplay")) $("copyReplay").disabled = !sessionSnapshot;
    if ($("exportWav")) $("exportWav").disabled = !sessionSnapshot || isExporting;
  }

  async function replayFromUI() {
    try {
      const record = parseReplayInput($("replayInput")?.value || "");
      await startPerformance(record);
    } catch (error) { replayStatus(error.message); }
  }

  async function replayLastPerformance() {
    if (disposed || !sessionSnapshot) return;
    const { seed, tone, duration, sampleRate, engine } = sessionSnapshot;
    // Start from the saved settings, rebuilding even an advanced Infinite run
    // from its seed. Edited controls and the Revisit field belong to other runs.
    return startPerformance({ seed, tone, duration, sampleRate, engine });
  }

  async function copyReplayLink() {
    if (disposed || !sessionSnapshot) return;
    const snapshot = sessionSnapshot, link = replayLink(snapshot);
    try {
      await navigator.clipboard.writeText(link);
      if (!disposed && snapshot === sessionSnapshot) {
        $("replayLinkFallback").hidden = true;
        replayStatus("Replay link copied.");
      }
    } catch {
      if (disposed || snapshot !== sessionSnapshot) return;
      const fallback = $("replayLink");
      $("replayLinkFallback").hidden = false;
      fallback.value = link;
      fallback.focus();
      fallback.select();
      replayStatus("Copy the selected replay link.");
    }
  }

  function loadReplayLink() {
    const params = new URLSearchParams(window.location.search);
    if (!["seed", "tone", "length", "engine", "rate"].some(key => params.has(key))) return;
    $("revisit").open = true;
    $("replayInput").value = window.location.href;
    try {
      const record = parseReplayQuery(params);
      applyControls({ tone: record.tone, songDuration: record.duration });
      replayStatus(`Seed ${seedHex(record.seed)} ready. Press Load & play to listen, or Play for a new performance.`);
    } catch (error) { replayStatus(error.message); }
  }

  // =========================
  // TUNING
  // =========================
  const MELODY_FLOOR_HZ   = 110.00; // A2 
  const MELODY_CEILING_HZ = 415.30; // G#4 
  const DRONE_FLOOR_HZ    = 87.31;  // F2
  const DRONE_GAIN_MULT   = 0.70;
  const MASTER_VOL        = 0.30;
  const REVERB_RETURN_LEVEL = 0.80;

  // Scheduler
  const LOOKAHEAD = 1.5;
  const SCHEDULER_INTERVAL_MS = 80;
  const MAX_EVENTS_PER_TICK = 900;

  // Global flag for mobile hard reset
  let closeCtxAfterStop = false;

  // =========================
  // UTILS
  // =========================
  const $ = (id) => document.getElementById(id);

  function clampFreqMin(freq, floorHz) {
    while (freq < floorHz) freq *= 2;
    return freq;
  }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  function announce(msg) {
    if (disposed) return;
    const live = $("playerStatus");
    if (!live) return;
    if (live._lastMsg === msg) return;
    live._lastMsg = msg;
    live.textContent = msg;
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || "").toUpperCase();
    return (tag === "INPUT" && el.type !== "range") || tag === "TEXTAREA" || el.isContentEditable === true;
  }

  // =========================
  // DEVICE DETECTION
  // =========================
  function isPlayerPage() { return !!$("playNow"); }

  function isMobileDevice() {
    const ua = navigator.userAgent || "";
    const isBasicMobile = /iPhone|iPad|iPod|Android/i.test(ua);
    const isIPadOS = (navigator.maxTouchPoints > 0) && /Macintosh/i.test(ua);
    return isBasicMobile || isIPadOS;
  }

  // =========================
  // STATE & CONTROLS
  // =========================
  function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch { return null; } }
  function saveState(state) { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {} }

  function readControls() {
    return {
      songDuration: $("songDuration")?.value ?? "short",
      tone: $("tone")?.value ?? "110",
      updatedAt: Date.now()
    };
  }

  function applyControls(state) {
    const sd = $("songDuration");
    const tone = $("tone");

    if (sd) {
      const saved = state?.songDuration != null ? String(state.songDuration) : "short";
      const migrated = ({ "60": "short", "300": "short", "600": "long", "1800": "long" })[saved];
      const v = migrated || saved;
      sd.value = new Set(["short", "long", "infinite"]).has(v) ? v : "short";
    }

    let toneVal = 110;
    if (state?.tone != null) {
      const n = Number(state.tone);
      if (Number.isFinite(n)) toneVal = Math.max(110, Math.min(200, n));
    }
    if (tone) tone.value = String(toneVal);
    syncToneControl();
  }

  function syncToneControl() {
    const tone = $("tone");
    if (!tone) return;
    const value = Number(tone.value);
    if ($("hzReadout")) $("hzReadout").textContent = tone.value;
    tone.setAttribute("aria-valuetext", `${tone.value} hertz`);
    const angle = -135 + ((value - 110) / 90) * 270;
    $("toneDial")?.style.setProperty("--tone-angle", `${angle}deg`);
  }

  function toneChanged() {
    syncToneControl();
    saveState(readControls());
  }

  function initializeToneDial() {
    const tone = $("tone");
    if (!tone || !$("toneDial")) return;
    let drag = null;
    const finish = (event) => {
      if (!drag || (event?.pointerId != null && event.pointerId !== drag.id)) return;
      const id = drag.id;
      drag = null;
      if (tone.hasPointerCapture(id)) tone.releasePointerCapture(id);
    };
    cancelToneDrag = finish;
    removeListeners.push(finish);
    listen(tone, "pointerdown", (event) => {
      if (tone.disabled || drag || event.isPrimary === false || event.button !== 0) return;
      // Suppress the native horizontal range jump; keep its keyboard/AT behavior.
      event.preventDefault();
      tone.focus({ preventScroll: true });
      tone.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, y: event.clientY, value: Number(tone.value) };
    });
    listen(tone, "pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (tone.disabled) { finish(event); return; }
      event.preventDefault();
      // Two vertical CSS pixels per hertz, clamped to the existing tone range.
      const value = Math.max(110, Math.min(200, Math.round(drag.value + (drag.y - event.clientY) / 2)));
      if (String(value) === tone.value) return;
      tone.value = String(value);
      toneChanged();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture", "blur"])
      listen(tone, type, finish);
    listen(tone, "click", (event) => event.preventDefault());
  }

  function setButtonState(state) {
    const playBtn = $("playNow");
    const stopBtn = $("stop");
    const toneInput = $("tone");
    const durationInput = $("songDuration");
    const playing = (state === "playing");

    if (playBtn) {
      playBtn.classList.toggle("filled", playing);
      playBtn.setAttribute("aria-pressed", playing ? "true" : "false");
    }
    if (stopBtn) {
      stopBtn.classList.toggle("filled", !playing);
      stopBtn.setAttribute("aria-pressed", playing ? "false" : "true");
    }
    if (playing) cancelToneDrag();
    if (toneInput) toneInput.disabled = playing;
    if (durationInput) durationInput.disabled = playing;

    announce(playing ? "Playing" : "Stopped");
  }

  // =========================
  // AUDIO CORE
  // =========================
  let audioContext = null;
  let bus = null;
  let bridgeAudioEl = null;
  let teardownTimer = null;
  let cleanupInterval = null;
  let startRequest = 0;
  const activeVoices = new Set();
  // Allow the per-voice lowpass to settle before disconnecting its output.
  const VOICE_SETTLE_SECONDS = 0.1;

  function registerVoice(ctx, nodes, endTime) {
    if (ctx !== audioContext || !bus) return;
    activeVoices.add({ nodes, releaseAt: endTime + VOICE_SETTLE_SECONDS });
    bus.lastVoiceEnd = Math.max(bus.lastVoiceEnd, endTime + VOICE_SETTLE_SECONDS);
  }

  function cleanupFinishedVoices() {
    if (!audioContext || !bus) return;
    const now = audioContext.currentTime;
    for (const voice of activeVoices) {
      if (now < voice.releaseAt) continue;
      for (const node of voice.nodes) {
        try { node.disconnect(); } catch {}
        activeNodes.delete(node);
      }
      activeVoices.delete(voice);
    }
    // Use the audio clock: a suspended context must not lose its pending tail.
    if (isEndingNaturally && now >= bus.lastVoiceEnd + bus.tailSeconds) {
      stopAllManual(true);
    }
  }

  // Active node tracking
  const activeNodes = new Set();

  function trackNode(ctx, n) {
    if (n && ctx === audioContext) activeNodes.add(n);
    return n;
  }

  function killAllActiveNodes(now = 0) {
    for (const n of Array.from(activeNodes)) {
      try { n.stop?.(now); } catch {}
      try { n.disconnect?.(); } catch {}
      activeNodes.delete(n);
    }
    activeVoices.clear();
  }

  let cachedImpulseBuffer = null;

  function ensureAudioContext() {
    if (audioContext && audioContext.state !== "closed") return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioContext = new Ctx();
  }

  function ensureBridge() {
    if (bridgeAudioEl) return;
    bridgeAudioEl = document.createElement("audio");
    bridgeAudioEl.id = "open-airplay-bridge";
    bridgeAudioEl.setAttribute("playsinline", "true");
    bridgeAudioEl.setAttribute("aria-hidden", "true");
    bridgeAudioEl.loop = true;
    bridgeAudioEl.muted = false; // Keep the audio bridge active.
    Object.assign(bridgeAudioEl.style, {
      position: "fixed", width: "1px", height: "1px", opacity: "0.01",
      left: "-9999px", zIndex: "-1", pointerEvents: "none"
    });
    document.body.appendChild(bridgeAudioEl);
  }

  function createImpulseResponse(ctx, seed = 0, cache = true) {
    if (cache && cachedImpulseBuffer && cachedImpulseBuffer.sampleRate === ctx.sampleRate) return cachedImpulseBuffer;

    const duration = 10.0; // same tail length on mobile and desktop, per artist preference

    const decay = 2.8, rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    const r = mulberry32((seed ^ 0xC0FFEE) >>> 0);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (r() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    if (cache) cachedImpulseBuffer = impulse;
    return impulse;
  }

  // Parallel coloration, upstream of the existing reverb.
  // Slow independent LFOs move the filter centers throughout each note.
  function createMovingResonators(ctx, input, output, endTime, directOutput, startTime = ctx.currentTime) {
    const nodes = [], lfos = [];
    const own = node => { nodes.push(node); return node; };
    const dispose = () => {
      for (const lfo of lfos) { try { lfo.stop(ctx.currentTime); } catch {} }
      for (const node of nodes) { try { node.disconnect(); } catch {} }
    };
    try {
      const blend = own(ctx.createGain());
      blend.gain.value = 0.18; // Per band; bandpass peaks remain unity at their centers.
      blend.connect(output);
      // Expose the same moving overtones directly, without adding a second bank
      // or changing the original pre-reverb route. Both follow the existing send.
      if (directOutput) blend.connect(directOutput);
      const start = startTime;
      for (const [frequency, speed, depth] of [
        [420, 0.037, 480], [1050, 0.023, 600], [2400, 0.017, 420]
      ]) {
        const filter = own(ctx.createBiquadFilter());
        filter.type = "bandpass";
        filter.frequency.value = frequency;
        filter.Q.value = 3;
        const lfo = own(ctx.createOscillator());
        lfos.push(lfo);
        lfo.type = "sine";
        lfo.frequency.value = speed;
        const modulation = own(ctx.createGain());
        modulation.gain.value = depth; // Cents, so movement is proportional to pitch.
        lfo.connect(modulation);
        modulation.connect(filter.detune);
        input.connect(filter);
        filter.connect(blend);
        lfo.start(start);
        if (Number.isFinite(endTime)) lfo.stop(endTime);
      }
      return {
        // At the lowest center (~318 Hz), Q=3 rings out well within this allowance.
        tailSeconds: 0.1,
        dispose
      };
    } catch (error) {
      dispose();
      throw error;
    }
  }

  const spatialStates = new WeakMap();
  function initializeNoteDrift(ctx, seed) {
    spatialStates.set(ctx, { random: mulberry32((seed ^ 0x57E2E0) >>> 0), nodes: [] });
  }

  // One trajectory per note, shared by its FM partials and both output paths.
  function createNoteDrift(ctx, destination, wetSend, time, duration, plannedPan) {
    const state = spatialStates.get(ctx);
    const random = state.random;
    const pan = trackNode(ctx, ctx.createStereoPanner());
    const level = trackNode(ctx, ctx.createGain());
    level.gain.value = Math.SQRT2; // Preserve the mono voice's centered level.
    pan.pan.setValueAtTime(0, time);
    const target = plannedPan === undefined ? choosePan(random) : plannedPan;
    if (target !== null) pan.pan.linearRampToValueAtTime(target, time + duration);
    pan.connect(level);
    level.connect(destination);
    level.connect(wetSend);
    registerVoice(ctx, [pan, level], time + duration);
    if (ctx !== audioContext) state.nodes.push(pan, level);
    return pan;
  }

  function disposeNoteDrift(ctx) {
    const state = spatialStates.get(ctx);
    if (state) for (const node of state.nodes) node.disconnect();
    spatialStates.delete(ctx);
  }

  function teardownBusHard() {
    clearTimeout(teardownTimer);
    teardownTimer = null;
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    if (!audioContext || !bus) return;
    try { bus.masterGain.gain.cancelScheduledValues(audioContext.currentTime); } catch {}
    try { bus.masterGain.gain.setValueAtTime(0, audioContext.currentTime); } catch {}

    killAllActiveNodes(audioContext.currentTime);
    bus.resonators?.dispose();
    disposeNoteDrift(audioContext);

    try { bus.reverbReturn.disconnect(); } catch {}
    try { bus.reverbSend.disconnect(); } catch {}
    try { bus.reverbPreDelay.disconnect(); } catch {}
    try { bus.reverbNode.disconnect(); } catch {}
    try { bus.reverbLP.disconnect(); } catch {}
    try { bus.masterGain.disconnect(); } catch {}
    try { bus.streamDest.disconnect(); } catch {}
    bus.streamDest.stream.getTracks().forEach(track => track.stop());

    // Release the bridge stream to prevent lingering iOS audio hardware activity.
    if (bridgeAudioEl?.srcObject) {
      try { bridgeAudioEl.pause(); } catch {}
      try { bridgeAudioEl.srcObject.getTracks().forEach(t => t.stop()); } catch {}
      try { bridgeAudioEl.srcObject = null; } catch {}
    }

    bus = null;
  }

  function buildMixBus(seed = sessionSeed) {
    ensureAudioContext();
    teardownBusHard();

    // Own each allocation immediately: setup can fail before `bus` exists.
    const nodes = [];
    const own = node => { nodes.push(node); return node; };
    let resonators;
    try {
      const masterGain = own(audioContext.createGain());
      masterGain.gain.value = MASTER_VOL;
      masterGain.connect(audioContext.destination);

      const streamDest = own(audioContext.createMediaStreamDestination());
      masterGain.connect(streamDest);

      const reverbPreDelay = own(audioContext.createDelay(0.1));
      reverbPreDelay.delayTime.value = 0.015;

      const reverbNode = own(audioContext.createConvolver());
      reverbNode.buffer = createImpulseResponse(audioContext);

      const reverbLP = own(audioContext.createBiquadFilter());
      reverbLP.type = "lowpass";
      reverbLP.frequency.value = 4200;
      reverbLP.Q.value = 0.7;

      const reverbSend = own(audioContext.createGain());
      reverbSend.gain.value = 0.0;

      const reverbReturn = own(audioContext.createGain());
      reverbReturn.gain.value = REVERB_RETURN_LEVEL;

      // Schedule the whole performance ahead of the current render quantum.
      const origin = audioContext.currentTime + 0.05;
      initializeNoteDrift(audioContext, seed);
      reverbSend.connect(reverbPreDelay);
      resonators = createMovingResonators(audioContext, reverbSend, reverbPreDelay, undefined, masterGain, origin);
      reverbPreDelay.connect(reverbNode);
      reverbNode.connect(reverbLP);
      reverbLP.connect(reverbReturn);
      reverbReturn.connect(masterGain);

      bus = {
        origin, masterGain, reverbSend, reverbReturn, streamDest,
        reverbPreDelay, reverbNode, reverbLP, resonators,
        lastVoiceEnd: audioContext.currentTime,
        tailSeconds: reverbNode.buffer.duration + reverbPreDelay.delayTime.value + 0.25 + resonators.tailSeconds
      };
      cleanupInterval = setInterval(cleanupFinishedVoices, 250);

      ensureBridge();
      bridgeAudioEl.srcObject = streamDest.stream;
    } catch (error) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
      resonators?.dispose();
      disposeNoteDrift(audioContext);
      for (const node of nodes) {
        try { node.disconnect(); } catch {}
        if (node.stream) for (const track of node.stream.getTracks()) track.stop();
      }
      bus = null;
      throw error;
    }
  }

  // =========================
  // LIVE RECORDING
  // =========================
  let mediaRecorder = null;
  let isRecording = false;

  function stopRecording() {
    const recorder = mediaRecorder;
    mediaRecorder = null;
    isRecording = false;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch {
        pendingRecordings.get(recorder)?.();
        announce("Recording could not be saved");
      }
    }
  }

  function setRecordUI(on) {
    // Recording is a keyboard-only feature (Shift+R), documented in README.md.
    // Feedback stays on the same invisible aria-live channel as everything else
    // rather than adding any visible UI.
    announce(on ? "Recording started" : "Recording saved");
  }

  function toggleRecording() {
    if (disposed || !bus?.streamDest?.stream) return;

    if (isRecording) {
      stopRecording();
      return;
    }

    // Each recording owns its asynchronous callbacks, chunks, and MIME type.
    const recordedChunks = [];
    let recorder;
    try {
      const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
      const mimeType = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
      recorder = new MediaRecorder(bus.streamDest.stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      announce("Recording unavailable in this browser");
      return;
    }

    let failed = false;
    const cleanup = () => {
      recordedChunks.length = 0;
      recorder.ondataavailable = recorder.onerror = recorder.onstop = null;
      pendingRecordings.delete(recorder);
    };
    pendingRecordings.set(recorder, cleanup);
    recorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    recorder.onerror = () => {
      failed = true;
      if (mediaRecorder === recorder) {
        stopRecording();
        announce("Recording failed");
      }
    };
    recorder.onstop = () => {
      if (mediaRecorder === recorder) {
        mediaRecorder = null;
        isRecording = false;
      }
      if (disposed || !recordedChunks.length) {
        cleanup();
        if (!disposed && !isRecording) announce(failed ? "Recording failed" : "Recording contained no audio");
        return;
      }
      const blob = new Blob(recordedChunks, { type: recorder.mimeType || recordedChunks[0].type || "audio/webm" });
      cleanup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const extension = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
      a.download = `open-live-${Date.now()}.${extension}`;
      document.body.appendChild(a);
      a.click();
      if (!isRecording) {
        if (failed) announce("Recording failed; partial audio saved");
        else setRecordUI(false);
      }
      setTimeout(() => { try { document.body.removeChild(a); } catch {} URL.revokeObjectURL(url); }, 100);
    };

    try { recorder.start(250); } catch {
      cleanup();
      announce("Recording could not start");
      return;
    }
    mediaRecorder = recorder;
    isRecording = true;
    setRecordUI(true);
  }

  // =========================
  // RNG
  // =========================
  let sessionSeed = 0;
  let rng = Math.random;
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function setSeed(seed) { sessionSeed = (seed >>> 0); rng = mulberry32(sessionSeed); }
  function rand() { return rng(); }
  function chance(p) { return rand() < p; }

  // =========================
  // MUSICAL STRUCTURE
  // =========================
  function circDist(a, b) { const d = Math.abs(a - b); return Math.min(d, 7 - d); }

  let isPlaying = false;
  let isEndingNaturally = false;
  let timerInterval = null;

  let sessionStartTime = 0;
  let sessionSnapshot = null;
  let liveCursor = 0;
  let liveNextGroup = null;
  let liveTimeShift = 0;

  // Conservative compositional eligibility, evaluated on already planned notes.
  // This consumes no random numbers and does not alter the approach to an ending.
  function qualifiedEnding(history, degree, isMinor, atClimax, droneNotes, time) {
    if (history.length < 4 || atClimax || (degree !== 4 && degree !== 5)) return null;
    if (degree === 5 && isMinor) return null;
    const current = history.at(-1), previous = history.at(-2);
    const tensionLimit = degree === 5 ? 0.15 : 0.25;
    if (!history.slice(-4).every(n => n.key === current.key && n.tension <= tensionLimit)) return null;
    const interval = (a, b) => 12 * Math.log2(a / b);
    const step = Math.abs(interval(current.freq, previous.freq));
    if (step > 2.01) return null;
    const earlier = history.slice(0, -1);
    const returnAt = earlier.findIndex(n => n.key === current.key && Math.abs(interval(n.freq, current.freq)) < 0.01);
    if (returnAt < 0) return null;
    if (degree === 5) {
      // A sixth must complete a small excursion back to a known pitch, rather
      // than simply repeat or end a new upward run. No particular melody is prescribed.
      const gesture = history.slice(returnAt);
      if (gesture.length < 3 || step < 0.01 || !gesture.every((n, i) =>
        n.key === current.key && n.tension <= tensionLimit &&
        (i === 0 || Math.abs(interval(n.freq, gesture[i - 1].freq)) <= 2.01))) return null;
    }
    // Include drone release and room decay. Avoid a fresh drone attack and
    // semitone, major-seventh, or tritone clashes with its nominal pitches.
    // FM partials remain inharmonic; this is a harmonic safeguard, not an audition.
    for (const drone of droneNotes) {
      if (time < drone.time + 2) return null;
      const pitchClass = ((Math.round(interval(current.freq, drone.freq)) % 12) + 12) % 12;
      if ([1, 6, 11].includes(pitchClass)) return null;
    }
    return degree === 5 ? "sixth" : "fifth";
  }

  // The live musical rules have one owner. Planning draws all musical and
  // spatial choices before rendering; neither renderer consumes these streams.
  function createPerformanceGenerator(seed, baseFreq, duration, engine = ENGINE_VERSION) {
    const rand = mulberry32(seed);
    const chance = p => rand() < p;
    const spatialRandom = mulberry32((seed ^ 0x57E2E0) >>> 0);
    let nextTimeA = 0.05, patternIdxA = 0, notesSinceModulation = 0;
    let circlePosition = 0, isMinor = false;
    const runDensity = 0.05 + rand() * 0.20;
    const noteDur = (1 / runDensity) * 2.5;
    let phraseStep = 0, phraseCount = 0, arcLen = 6, arcPos = -1, arcClimaxAt = 4;
    let tension = 0, lastCadenceType = "none", currentCadenceType = "none";
    let lastDroneStart = -9999, lastDroneDur = 0, finished = false;
    const allowOpenEnding = engine === ENGINE_VERSION && duration !== Infinity;
    const endingHistory = [];
    let endingDrones = [];
    function startNewArc() {
      arcLen = 4 + Math.floor(rand() * 5);
      arcClimaxAt = Math.max(2, arcLen - 2 - Math.floor(rand() * 2));
      arcPos = -1;
      tension = clamp01(tension * 0.4 + 0.05);
    }

    function cadenceRepeatPenalty(type) {
      if (type !== lastCadenceType) return 0.0;
      if (type === "authentic") return 0.30;
      return 0.18;
    }

    function pickCadenceTypeForPhrase() {
      const nearClimax = (arcPos === arcClimaxAt);
      const lateArc = (arcPos >= arcLen - 2);
      let w = { evaded: 0.20, half: 0.28, plagal: 0.12, deceptive: 0.18, authentic: 0.22 };

      if (arcPos < arcClimaxAt) { w.authentic = 0.05; w.evaded += 0.2; w.half += 0.1; }
      w.authentic += tension * 0.25; w.deceptive += tension * 0.10; w.evaded -= tension * 0.18;

      if (nearClimax) { w.authentic += 0.25; w.deceptive += 0.10; w.evaded -= 0.20; }
      if (lateArc && tension > 0.45) { w.authentic += 0.22; w.evaded -= 0.15; }
      if (isMinor) { w.deceptive += 0.05; w.plagal -= 0.02; }

      for (const k of Object.keys(w)) w[k] = Math.max(0.001, w[k] - cadenceRepeatPenalty(k));

      const keys = Object.keys(w);
      const sum = keys.reduce((a, k) => a + w[k], 0);
      let r = rand() * sum;
      for (const k of keys) { r -= w[k]; if (r <= 0) return k; }
      return "authentic";
    }

    function cadenceTargets(type) {
      switch (type) {
        case "authentic": return { pre: 6, end: 0, wantLT: true };
        case "half":      return { pre: 1, end: 4, wantLT: false };
        case "plagal":    return { pre: 3, end: 0, wantLT: false };
        case "deceptive": return { pre: 6, end: 5, wantLT: true };
        case "evaded":    return { pre: 6, end: 2, wantLT: true };
        default:          return { pre: 2, end: 0, wantLT: false };
      }
    }

    function getScaleNote(baseFreq, scaleIndex, circlePos, minorMode, opts = {}) {
      let pos = circlePos % 12; if (pos < 0) pos += 12;
      let semitones = (pos * 7) % 12;
      let rootOffset = semitones; if (minorMode) rootOffset = (semitones + 9) % 12;
      const majorIntervals = [0, 2, 4, 5, 7, 9, 11];
      const minorIntervals = [0, 2, 3, 5, 7, 8, 10];
      const len = 7;
      const octave = Math.floor(scaleIndex / len);
      const degree = ((scaleIndex % len) + len) % len;
      let intervals = minorMode ? minorIntervals : majorIntervals;
      if (minorMode && opts.raiseLeadingTone && degree === 6) { intervals = minorIntervals.slice(); intervals[6] = 11; }
      const noteValue = rootOffset + intervals[degree] + (octave * 12);
      return baseFreq * Math.pow(2, noteValue / 12);
    }

    function updateHarmonyState() {
      const r = rand();
      let pressure = Math.min(1.0, notesSinceModulation / 48.0);
      if (arcPos === arcClimaxAt) pressure *= 2.5;
      pressure = Math.min(1.0, pressure);
      if (r < pressure * 0.35) {
         if (chance(0.2)) isMinor = !isMinor;
         else circlePosition += (chance(0.5) ? 1 : -1);
         notesSinceModulation = 0;
      }
    }

    function degreeFromIdx(idx) {
      const base = Math.floor(idx / 7) * 7;
      return ((idx - base) % 7 + 7) % 7;
    }

    function shouldUseThirdDrone({ atCadenceZone, tensionVal, cadenceType, melodyDeg }) {
      if (atCadenceZone) return false;
      if (tensionVal >= 0.55) return false;
      if (cadenceType === "half" || cadenceType === "deceptive" || cadenceType === "evaded") return false;
      return (melodyDeg === 0 || melodyDeg === 2 || melodyDeg === 4);
    }


    startNewArc();
    const initialArcLen = arcLen, initialClimax = arcClimaxAt;
    arcPos++;
    currentCadenceType = pickCadenceTypeForPhrase();

    return {
      density: runDensity, arcLen: initialArcLen, arcClimaxAt: initialClimax,
      get nextTime() { return nextTimeA; },
      next() {
        if (finished) return null;
        const group = { time: nextTimeA, notes: [], ending: false };
        let appliedDur = noteDur;
        let pressure = Math.min(1.0, notesSinceModulation / 48.0);
        updateHarmonyState();

        if (duration !== Infinity && nextTimeA >= duration + LOOKAHEAD) {
          if (patternIdxA % 7 === 0) {
            let fEnd = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor);
            while (fEnd > MELODY_CEILING_HZ && patternIdxA > -14) {
                patternIdxA -= 7;
                fEnd = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor);
            }
            fEnd = clampFreqMin(fEnd, MELODY_FLOOR_HZ);
            group.notes.push(planBell(fEnd, nextTimeA, 25.0, 0.5, 0, 0, rand, spatialRandom));
            finished = true;
            group.ending = true;
            if (allowOpenEnding) group.endingKind = "tonic";
            return group;
          }
        }

        phraseStep = (phraseStep + 1) % 16;
        if (phraseStep === 0) {
          phraseCount++;
          arcPos = (arcPos + 1);
          if (arcPos >= arcLen) startNewArc();
          currentCadenceType = pickCadenceTypeForPhrase();
        }

        const isCadence = (phraseStep >= 13);
        if (chance(phraseStep === 15 ? 0.85 : 0.2)) appliedDur *= 1.2;

        if (isCadence) {
            const cadenceDegrees = [0, 1, 3, 4, 5];
            const currentOctave = Math.floor(patternIdxA / 7) * 7;
            let deg = patternIdxA - currentOctave;
            deg = ((deg % 7) + 7) % 7;
            let best = cadenceDegrees[0];
            let bestD = circDist(deg, best);
            for (let i = 1; i < cadenceDegrees.length; i++) {
              const t = cadenceDegrees[i]; const d = circDist(deg, t);
              if (d < bestD || (d === bestD && chance(0.5))) { best = t; bestD = d; }
            }
            let targetDeg = best;
            if (!chance(0.6)) {
              const dir = chance(0.65) ? -1 : 1;
              targetDeg = (targetDeg + dir + 7) % 7;
            }
            let delta = targetDeg - deg;
            if (delta > 3) delta -= 7; if (delta < -3) delta += 7;
            patternIdxA = currentOctave + deg + delta;

            const ct = currentCadenceType;
            const cadencePlan = cadenceTargets(ct);

            if (phraseStep === 14 && chance(0.70)) {
               const curOct = Math.floor(patternIdxA / 7) * 7;
               const curDeg = ((patternIdxA - curOct) % 7 + 7) % 7;
               let deltaPre = cadencePlan.pre - curDeg;
               if (deltaPre > 3) deltaPre -= 7; if (deltaPre < -3) deltaPre += 7;
               patternIdxA += deltaPre;
            }

            if (phraseStep === 15) {
               const curOct = Math.floor(patternIdxA / 7) * 7;
               const curDeg = ((patternIdxA - curOct) % 7 + 7) % 7;
               let deltaEnd = cadencePlan.end - curDeg;
               if (deltaEnd > 3) deltaEnd -= 7; if (deltaEnd < -3) deltaEnd += 7;

               if (chance(0.35)) {
                  patternIdxA += deltaEnd;
               } else if (chance(0.25)) {
                  patternIdxA += (deltaEnd > 0 ? deltaEnd - 1 : deltaEnd + 1);
               }

               if(ct === "authentic") tension = clamp01(tension - 0.22);
               else tension = clamp01(tension + 0.10);
               lastCadenceType = ct;
            }
        } else {
            let currentEvalFreq = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor);
            let upChance = 0.5;
            if (currentEvalFreq >= MELODY_CEILING_HZ * 0.8) {
                upChance = 0.15;
            } else if (currentEvalFreq <= MELODY_FLOOR_HZ * 1.2) {
                upChance = 0.85;
            }
            patternIdxA += (rand() < upChance ? 1 : -1);
        }

        const cadencePlan = currentCadenceType ? cadenceTargets(currentCadenceType) : null;
        const wantLT = cadencePlan ? cadencePlan.wantLT : false;
        const degNow = degreeFromIdx(patternIdxA);
        const raiseLT = isMinor && isCadence && wantLT && (degNow === 6);

        let freq = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor, { raiseLeadingTone: raiseLT });

        while (freq > MELODY_CEILING_HZ && patternIdxA > -14) {
            patternIdxA -= 7;
            freq = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor, { raiseLeadingTone: raiseLT });
        }
        freq = clampFreqMin(freq, MELODY_FLOOR_HZ);

        const isArcStart = (arcPos === 0 && phraseStep === 0);
        const isClimax = (arcPos === arcClimaxAt && phraseStep === 0);
        const atPhraseStart = (phraseStep === 0);

        let droneProb = 0.04;
        if (atPhraseStart) droneProb = 0.18;

        const canStartDrone = (nextTimeA >= lastDroneStart + lastDroneDur * 0.65);

        if (canStartDrone && (isArcStart || isClimax || chance(droneProb))) {
           const ct = currentCadenceType || "authentic";
           let droneRootDegree = 0;
           if (!isArcStart && !isClimax) {
             if (ct === "half") droneRootDegree = 4;
             else if (ct === "deceptive") droneRootDegree = chance(0.6) ? 0 : 5;
             else if (ct === "plagal") droneRootDegree = chance(0.6) ? 3 : 0;
             else droneRootDegree = 0;
           }

           const melodyDegNow = degreeFromIdx(patternIdxA);
           const useThirdColor = shouldUseThirdDrone({
             atCadenceZone: (phraseStep >= 13),
             tensionVal: tension,
             cadenceType: ct,
             melodyDeg: melodyDegNow
           });

           const curRegister = Math.floor(patternIdxA / 7);
           const droneOct = Math.min(curRegister - 1, 0);
           const droneIdx = droneOct * 7 + droneRootDegree;

           let droneRootFreq = getScaleNote(baseFreq, droneIdx, circlePosition, isMinor);
           droneRootFreq = clampFreqMin(droneRootFreq, DRONE_FLOOR_HZ);

           const t0 = Math.max(nextTimeA - 0.05, 0);
           let droneDur = isArcStart ? 32.0 : 22.0;

           lastDroneStart = t0;
           lastDroneDur = droneDur;

           const baseVol = (isArcStart || isClimax) ? 0.40 : 0.28;
           const quality = isMinor ? "min" : "maj";

           group.notes.push(...planDrone(droneRootFreq, t0, droneDur, baseVol, quality, useThirdColor, rand, spatialRandom));
        }

        const isDroneSolo = (arcPos === 0 && phraseStep < 12 && phraseCount > 0);
        if (!isDroneSolo) {
          group.notes.push(planBell(freq, nextTimeA, appliedDur, 0.4, pressure, tension, rand, spatialRandom));
        }

        notesSinceModulation++;
        nextTimeA += (1 / runDensity) * (0.95 + rand() * 0.1);
        if (allowOpenEnding) {
          endingDrones = endingDrones.filter(n => group.time < n.time + n.duration + 10.465);
          endingDrones.push(...group.notes.filter(n => n.kind === "bass"));
          if (!isDroneSolo) {
            endingHistory.push({ freq, key: `${((circlePosition % 12) + 12) % 12}:${isMinor}`,
              tension });
            if (endingHistory.length > 5) endingHistory.shift();
            // Consider the strike straddling the target, at most six seconds
            // early, and later strikes until the existing tonic fallback wins.
            const earliest = duration - Math.min(6, 1 / runDensity);
            if (group.time >= earliest && nextTimeA >= duration) {
              const kind = qualifiedEnding(endingHistory, degNow, isMinor,
                arcPos === arcClimaxAt, endingDrones, group.time);
              if (kind) {
                finished = true;
                group.ending = true;
                group.endingKind = kind;
              }
            }
          } else {
            // Do not join a remembered contour across a drone-only passage.
            endingHistory.length = 0;
          }
        }
        return group;
      }
    };
  }

  function resolveDuration(seed, durationInput) {
    if (durationInput === "short") return 60;
    if (durationInput === "long") {
      // Keep duration selection independent of the musical and spatial streams.
      const durationRandom = mulberry32((seed ^ 0x4C454E47) >>> 0);
      return 600 + Math.floor(durationRandom() * 1201);
    }
    if (durationInput === "infinite") return Infinity;
    throw new Error("Invalid duration");
  }

  function createPerformance(seed, tone, durationInput, engine = ENGINE_VERSION) {
    if (!SUPPORTED_ENGINES.has(engine)) throw new Error("Unsupported musical engine");
    const duration = resolveDuration(seed, durationInput);
    const generator = createPerformanceGenerator(seed, tone, duration, engine);
    const groups = [];
    let lastVoiceEnd = 0;
    while (duration !== Infinity || generator.nextTime < 1800) {
      const group = generator.next();
      if (!group) break;
      for (const note of group.notes) {
        lastVoiceEnd = Math.max(lastVoiceEnd, note.time + note.duration);
        if (note.voices) {
          note.voices.forEach(Object.freeze);
          Object.freeze(note.voices);
        }
        Object.freeze(note);
      }
      Object.freeze(group.notes);
      groups.push(Object.freeze(group));
      if (groups.length > 10000) throw new Error("Performance exceeded planning limit");
    }
    return Object.freeze({
      seed, tone, duration: durationInput, targetDuration: duration, density: generator.density,
      arcLen: generator.arcLen, arcClimaxAt: generator.arcClimaxAt,
      groups: Object.freeze(groups),
      // Include per-voice settling, resonator settling, the full IR and pre-delay.
      exportDuration: Math.max(duration === Infinity ? 1800 : duration, lastVoiceEnd)
        + VOICE_SETTLE_SECONDS + 0.1 + 10 + 0.015 + 0.25,
      continuation: duration === Infinity ? generator : null
    });
  }

  // Only plain note data is retained. Audio nodes are created near playback time.
  function choosePan(random) { return random() < 0.65 ? (random() * 2 - 1) * 0.22 : null; }

  function planBell(freq, time, duration, volume, instability, tensionAmt, rand, spatialRandom) {
    freq = clampFreqMin(freq, MELODY_FLOOR_HZ);

    const numVoices = 2 + Math.floor(rand() * 2);
    let totalAmp = 0;
    const isFractured = (tensionAmt > 0.75);
    const FRACTURE_RATIOS = [Math.SQRT2, 1.618, 2.414, 2.718, 3.1415];
    const ratioFuzz = isFractured ? 0.08 : 0.0;

    const baseRatio = isFractured
      ? FRACTURE_RATIOS[Math.floor(rand() * FRACTURE_RATIOS.length)]
      : (1.5 + rand() * 2.5);

    const voices = Array.from({ length: numVoices }, () => {
      let mRatio = baseRatio;
      if (isFractured) mRatio += (rand() - 0.5) * ratioFuzz;
      const mIndex = 1.0 + (tensionAmt * 2.0) + (rand() * 3.0);
      const v = { modRatio: mRatio, modIndex: mIndex, amp: rand() };
      totalAmp += v.amp;
      return v;
    });


    for (const voice of voices) {
      voice.frequency = freq + (rand() - 0.5) * (2 + instability * (isFractured ? 15 : 10));
    }
    return { kind: "bell", freq, time, duration, volume, voices, totalAmp, pan: choosePan(spatialRandom) };
  }

  function planDrone(rootFreq, time, duration, baseVolume, quality, includeThird, random, spatialRandom) {
    const f0 = clampFreqMin(rootFreq, DRONE_FLOOR_HZ);
    const pitches = [[f0, 0.50], [f0 * Math.pow(2, 7 / 12), 0.30]];
    if (includeThird) pitches.push([f0 * Math.pow(2, (quality === "min" ? 3 : 4) / 12), 0.20]);
    return pitches.map(([freq, level]) => ({
      kind: "bass", freq, time, duration, volume: baseVolume * DRONE_GAIN_MULT * level,
      detune: (random() - 0.5) * 8, pan: choosePan(spatialRandom)
    }));
  }

  // =========================
  // SYNTH
  // =========================
  function scheduleNote(ctx, destination, wetSend, freq, time, duration, volume, instability = 0, tensionAmt = 0, planned = null) {
    const note = planned || planBell(freq, time, duration, volume, instability, tensionAmt, rand, spatialStates.get(ctx).random);
    freq = note.freq;
    const { voices, totalAmp } = note;

    const spatialInput = createNoteDrift(ctx, destination, wetSend, time, duration, note.pan);
    voices.forEach(voice => {
      const carrier = trackNode(ctx, ctx.createOscillator());
      const modulator = trackNode(ctx, ctx.createOscillator());
      const modGain = trackNode(ctx, ctx.createGain());
      const ampGain = trackNode(ctx, ctx.createGain());
      const filter = trackNode(ctx, ctx.createBiquadFilter());

      filter.type = "lowpass";
      filter.frequency.value = Math.min(freq * 3.5, 6000);
      filter.Q.value = 0.6;

      carrier.frequency.value = voice.frequency;
      modulator.frequency.value = freq * voice.modRatio;

      modGain.gain.setValueAtTime(freq * voice.modIndex, time);
      modGain.gain.exponentialRampToValueAtTime(freq * 0.01, time + (duration * 0.3));

      ampGain.gain.setValueAtTime(0.0001, time);
      ampGain.gain.exponentialRampToValueAtTime((voice.amp / totalAmp) * volume, time + 0.01);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(ampGain);
      ampGain.connect(filter);
      filter.connect(spatialInput);

      modulator.start(time); carrier.start(time);
      modulator.stop(time + duration); carrier.stop(time + duration);
      registerVoice(ctx, [carrier, modulator, modGain, ampGain, filter], time + duration);
    });
  }

  function scheduleBassVoice(ctx, destination, wetSend, freq, time, duration, volume, random = rand, planned = null) {
    const carrier = trackNode(ctx, ctx.createOscillator());
    const modulator = trackNode(ctx, ctx.createOscillator());
    const modGain = trackNode(ctx, ctx.createGain());
    const ampGain = trackNode(ctx, ctx.createGain());
    const lp = trackNode(ctx, ctx.createBiquadFilter());

    carrier.type = "sine";
    modulator.type = "sine";
    carrier.frequency.value = freq;
    modulator.frequency.value = freq * 2.0; 
    modulator.detune.value = planned ? planned.detune : (random() - 0.5) * 8;

    modGain.gain.setValueAtTime(0, time);
    modGain.gain.linearRampToValueAtTime(freq * 1.8, time + (duration * 0.5)); 
    modGain.gain.linearRampToValueAtTime(0, time + duration);

    ampGain.gain.setValueAtTime(0.0001, time);
    ampGain.gain.exponentialRampToValueAtTime(volume, time + 2.0); 
    ampGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    lp.type = "lowpass";
    lp.frequency.setValueAtTime(600, time);
    lp.Q.value = 0.6;

    modulator.connect(modGain); modGain.connect(carrier.frequency);
    carrier.connect(ampGain); ampGain.connect(lp);
    lp.connect(createNoteDrift(ctx, destination, wetSend, time, duration, planned?.pan));

    modulator.start(time); carrier.start(time);
    modulator.stop(time + duration); carrier.stop(time + duration);
    registerVoice(ctx, [carrier, modulator, modGain, ampGain, lp], time + duration);
  }

  // =========================
  // SCHEDULER
  // =========================
  function renderGroup(ctx, master, wetSend, group, origin) {
    for (const note of group.notes) {
      const time = origin + note.time;
      if (note.kind === "bell") {
        scheduleNote(ctx, master, wetSend, note.freq, time, note.duration, note.volume, 0, 0, note);
      } else {
        scheduleBassVoice(ctx, master, wetSend, note.freq, time, note.duration, note.volume, rand, note);
      }
    }
  }

  function nextLiveGroup() {
    if (liveCursor < sessionSnapshot.groups.length) return sessionSnapshot.groups[liveCursor++];
    return sessionSnapshot.continuation?.next() || null;
  }

  function scheduler() {
    if (!isPlaying || !audioContext || !bus) return;
    const now = audioContext.currentTime;
    const boundary = now + LOOKAHEAD;
    let events = 0;
    while (liveNextGroup && events++ < MAX_EVENTS_PER_TICK) {
      // Keep the next phrase event after a stall, with no overdue-node backlog.
      // This shift belongs only to live playback, never to the stored score.
      const earliest = Math.min(liveNextGroup.time, ...liveNextGroup.notes.map(n => n.time));
      const start = sessionStartTime + liveTimeShift + earliest;
      if (start < now) liveTimeShift += now + 0.05 - start;
      if (sessionStartTime + liveTimeShift + liveNextGroup.time >= boundary) break;
      renderGroup(audioContext, bus.masterGain, bus.reverbSend, liveNextGroup, sessionStartTime + liveTimeShift);
      if (liveNextGroup.ending) { liveNextGroup = null; beginNaturalEnd(); return; }
      liveNextGroup = nextLiveGroup();
    }
  }

  function handleVisibilityChange(e) {
    if (!isMobileDevice()) return;

    const type = e?.type || "";
    const isBackgrounding =
      document.hidden ||
      type === "pagehide" ||
      type === "freeze" ||
      type === "blur";

    if (!isBackgrounding) return;

    if (isPlaying || isEndingNaturally || bus || audioContext) {
      closeCtxAfterStop = true;
      stopAllManual(true, "Stopped (background)");
      closeCtxAfterStop = false;
    }
  }

  // =========================
  // CONTROLS
  // =========================
  async function startFromUI() {
    return startPerformance();
  }

  async function startPerformance(replay = null) {
    if (disposed) return;
    let request = ++startRequest;
    try {
      ensureAudioContext();
      const ctx = audioContext;
      if (ctx.state === "suspended") await ctx.resume();
      if (request !== startRequest || audioContext !== ctx) return;
      if (ctx.state !== "running") throw new Error("Audio context is not running");

      stopAllManual(true);
      request = startRequest;

      isEndingNaturally = false;
      const seed = replay ? replay.seed : (crypto?.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Date.now()) >>> 0;
      let tone = replay ? replay.tone : Number($("tone")?.value ?? 110);
      if (!Number.isFinite(tone)) tone = 110;
      tone = Math.round(Math.max(110, Math.min(200, tone)));
      const duration = replay ? replay.duration : $("songDuration")?.value ?? "short";
      const engine = replay?.engine ?? ENGINE_VERSION;
      const performance = createPerformance(seed, tone, duration, engine);
      buildMixBus(seed);
      setSeed(seed);
      // Created once per run; exports keep this ID even after Stop or a new Play.
      const runId = `${seedHex(seed)}-${Date.now().toString(36)}`;
      sessionSnapshot = Object.freeze({ ...performance, sampleRate: replay?.sampleRate ?? ctx.sampleRate,
        runId, engine });
      if (replay) {
        applyControls({ tone, songDuration: duration });
        saveState(readControls());
      }
      if ($("replayLinkFallback")) $("replayLinkFallback").hidden = true;
      updateReplayControls();
      liveCursor = 0;
      liveTimeShift = 0;
      liveNextGroup = nextLiveGroup();
      isPlaying = true;
      sessionStartTime = bus.origin;
      automateMix(bus.masterGain, bus.reverbSend, sessionStartTime, performance.density);
      if (bridgeAudioEl) bridgeAudioEl.play().catch(()=>{});

      setButtonState("playing");
      replayStatus(replay?.partial
        ? `Playing seed ${seedHex(seed)} with the selected root tone and length (engine ${engine}). ${replay.legacy ? "An older filename assumes engine 1 but cannot verify the original settings or engine." : "A seed alone does not include the original settings; keep a replay link or full filename to preserve this version."}`
        : `${replay ? "Replaying" : "Playing"} seed ${seedHex(seed)}. You can copy its replay link or export it below.`);

      if (timerInterval) clearInterval(timerInterval);
      timerInterval = setInterval(scheduler, SCHEDULER_INTERVAL_MS);
      scheduler();
    } catch (error) {
      if (request === startRequest) {
        stopAllManual(true);
        replayStatus("Playback could not start. Try again.");
      }
    }
  }

  function stopAllManual(instant = false, statusMsg = "Stopped") {
    startRequest++;
    clearTimeout(teardownTimer);
    teardownTimer = null;
    isPlaying = false; 
    isEndingNaturally = false;
    liveNextGroup = null;
    if (timerInterval) clearInterval(timerInterval);

    stopRecording();

    if (!instant && bus?.masterGain && audioContext) {
        const t = audioContext.currentTime;
        try {
            bus.masterGain.gain.cancelScheduledValues(t);
            bus.masterGain.gain.setValueAtTime(bus.masterGain.gain.value, t);
            bus.masterGain.gain.linearRampToValueAtTime(0, t + 0.10);
        } catch {}
        const stoppedBus = bus;
        teardownTimer = setTimeout(() => {
          if (bus === stoppedBus) teardownBusHard();
        }, 150);
    } else {
        teardownBusHard();
    }

    if (instant && closeCtxAfterStop && audioContext) {
        try { audioContext.close(); } catch {}
        audioContext = null; 
    }

    setButtonState("stopped");
    announce(statusMsg);
    if (!isExporting && sessionSnapshot && $("replayStatus"))
      $("replayStatus").textContent = `${statusMsg}. Seed ${seedHex(sessionSnapshot.seed)} remains available to share or export.`;
  }

  function beginNaturalEnd() {
    isEndingNaturally = true;
    isPlaying = false; 
    if (timerInterval) clearInterval(timerInterval);
    // The final notes and reverb are still audible. Keep the playing UI and
    // controls locked until cleanupFinishedVoices completes the audio tail.
  }

  // =========================
  // EXPORT WAV (The current performance)
  // =========================
  let isExporting = false;
  function exportStatus(message, finished = false) {
    if (disposed) return;
    replayStatus(message);
    clearTimeout(exportTitleTimer);
    document.title = `${message} — ${idleTitle}`;
    if (finished) exportTitleTimer = setTimeout(() => {
      document.title = idleTitle;
      exportTitleTimer = null;
    }, 10000);
  }

  async function renderWavExport() {
    if (disposed) return;
    if (!sessionSnapshot) { exportStatus("Press Play once before exporting", true); return; }
    if (isExporting) { announce("WAV export already in progress"); return; }
    isExporting = true;
    updateReplayControls();
    exportStatus("Preparing WAV");
    try {
      await renderWavSession({ ...sessionSnapshot });
    } catch (error) {
      exportStatus("WAV export failed. Retry or start a shorter run", true);
      console.error("WAV export failed", error);
    } finally {
      isExporting = false;
      if (!disposed) updateReplayControls();
    }
  }

  function automateMix(master, send, origin, density) {
    master.gain.setValueAtTime(0, origin);
    master.gain.linearRampToValueAtTime(MASTER_VOL, origin + 0.1);
    const targetSend = 0.65 - 0.25 * clamp01((density - 0.05) / 0.20);
    send.gain.setTargetAtTime(targetSend, origin, 2.5);
  }

  async function renderWavSession(sessionSnapshot) {
    const sampleRate = sessionSnapshot.sampleRate;
    const exportDuration = sessionSnapshot.exportDuration;
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * exportDuration), sampleRate);
    const offlineMaster = offlineCtx.createGain();
    offlineMaster.gain.value = MASTER_VOL;
    offlineMaster.connect(offlineCtx.destination);

    const offlinePreDelay = offlineCtx.createDelay(0.1);
    offlinePreDelay.delayTime.value = 0.015;
    const offlineReverb = offlineCtx.createConvolver();
    // The same deterministic room at the session's native sample rate.
    offlineReverb.buffer = createImpulseResponse(offlineCtx, 0, false);
    const offlineReverbLP = offlineCtx.createBiquadFilter();
    offlineReverbLP.type = "lowpass";
    offlineReverbLP.frequency.value = 4200;
    offlineReverbLP.Q.value = 0.7;
    const offlineSend = offlineCtx.createGain();
    offlineSend.gain.value = 0;
    const offlineReturn = offlineCtx.createGain();
    offlineReturn.gain.value = REVERB_RETURN_LEVEL;

    let renderedBuffer, offlineResonators;
    try {
      initializeNoteDrift(offlineCtx, sessionSnapshot.seed);
      offlineSend.connect(offlinePreDelay);
      offlineResonators = createMovingResonators(offlineCtx, offlineSend, offlinePreDelay, exportDuration, offlineMaster, 0);
      offlinePreDelay.connect(offlineReverb);
      offlineReverb.connect(offlineReverbLP);
      offlineReverbLP.connect(offlineReturn);
      offlineReturn.connect(offlineMaster);
      automateMix(offlineMaster, offlineSend, 0, sessionSnapshot.density);
      for (const group of sessionSnapshot.groups) renderGroup(offlineCtx, offlineMaster, offlineSend, group, 0);
      exportStatus("Rendering WAV");
      renderedBuffer = await offlineCtx.startRendering();
    } finally {
      offlineResonators?.dispose();
      disposeNoteDrift(offlineCtx);
    }
    if (disposed) return;
    exportStatus("Encoding WAV");
    const wavBlob = await bufferToWave(renderedBuffer);
    if (disposed) return;
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = exportFilename(sessionSnapshot, Date.now());
    let cleanupTimer;
    const cleanup = () => {
      clearTimeout(cleanupTimer);
      pendingDownloads.delete(cleanup);
      try { document.body.removeChild(a); } catch {}
      URL.revokeObjectURL(url);
    };
    pendingDownloads.add(cleanup);
    try {
      document.body.appendChild(a);
      a.click();
    } catch (error) { cleanup(); throw error; }
    // Give browsers time to acquire large downloads before releasing the Blob.
    cleanupTimer = setTimeout(cleanup, 60000);
    exportStatus("WAV downloaded", true);
  }

  function bufferToWave(abuffer) {
    return new Promise((resolve, reject) => {
      if (disposed) { reject(new Error("Player disposed")); return; }
      // Keep this cache tag aligned with the player.html asset tags.
      const worker = new Worker("wav-worker.js?v=1.0");
      let offset = 0;
      let finished = false;
      let idleTicks = 0;
      // Count foreground checks, not elapsed wall time: a frozen/background tab
      // must not turn a healthy encoder into a timeout when it resumes.
      const watchdog = setInterval(() => {
        if (document.hidden) { idleTicks = 0; return; }
        if (++idleTicks >= 30) finish(new Error("WAV encoder stopped responding"));
      }, 1000);
      const cancel = () => finish(new Error("Player disposed"));
      cancelEncoders.add(cancel);
      function finish(error, blob) {
        if (finished) return;
        finished = true;
        clearInterval(watchdog);
        cancelEncoders.delete(cancel);
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        worker.terminate();
        if (error) reject(error);
        else resolve(blob);
      }
      worker.onerror = (event) => {
        event.preventDefault();
        finish(new Error("WAV encoder failed"));
      };
      worker.onmessageerror = () => finish(new Error("WAV encoder message failed"));
      worker.onmessage = ({ data }) => {
        if (finished) return;
        idleTicks = 0;
        if (data.type === "error") { finish(new Error(data.message)); return; }
        if (data.type === "done") { finish(null, data.blob); return; }
        if (data.type !== "ready") { finish(new Error("Invalid WAV encoder response")); return; }
        try {
          // Copy and transfer one small chunk at a time. AudioBuffer-owned
          // storage stays intact; the UI never scans the entire recording.
          const count = Math.min(65536, abuffer.length - offset);
          if (count <= 0) throw new Error("Unexpected WAV encoder request");
          const channels = Array.from({ length: abuffer.numberOfChannels }, (_, ch) => {
            const samples = new Float32Array(count);
            abuffer.copyFromChannel(samples, ch, offset);
            return samples;
          });
          worker.postMessage({ type: "samples", offset, channels }, channels.map(ch => ch.buffer));
          offset += count;
        } catch (error) { finish(error); }
      };
      try {
        worker.postMessage({ type: "start", length: abuffer.length,
          sampleRate: abuffer.sampleRate, channels: abuffer.numberOfChannels });
      } catch (error) { finish(error); }
    });
  }

  // =========================
  // INIT & LISTENERS
  // =========================
  function initialize() {
    // player.js only ever runs on player.html (see the <script src="player.js">
    // tag there). Launcher routing/mobile-detection lives in index.html's own
    // inline script.
    if (!isPlayerPage()) return;

    listen($("playNow"), "click", startFromUI);
    listen($("replayLast"), "click", replayLastPerformance);
    listen($("stop"), "click", () => stopAllManual(false));
    listen($("replayRun"), "click", replayFromUI);
    listen($("copyReplay"), "click", copyReplayLink);
    listen($("exportWav"), "click", renderWavExport);
    listen($("replayInput"), "keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing || event.repeat) return;
      event.preventDefault();
      replayFromUI();
    });

    applyControls(loadState());
    initializeToneDial();

    listen($("tone"), "input", toneChanged);
    listen($("songDuration"), "change", () => saveState(readControls()));

    // Keep the desktop shortcuts alongside the optional Revisit controls.
    // Live recording remains keyboard-only.
    listen(document, "keydown", (e) => {
      if (e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const k = (e.key || "").toLowerCase();
      if (!e.shiftKey || (k !== "r" && k !== "e")) return;
      e.preventDefault();
      if (k === "r") toggleRecording();
      else renderWavExport();
    });

    listen(document, "visibilitychange", handleVisibilityChange);
    listen(window, "pagehide", handleVisibilityChange, { capture: true });
    listen(window, "blur", handleVisibilityChange, { capture: true });
    if (document.addEventListener) listen(document, "freeze", handleVisibilityChange, { capture: true });

    listen(window, "pageshow", (e) => {
      if (isMobileDevice() && e.persisted) {
        closeCtxAfterStop = true;
        stopAllManual(true, "Reset (restore)");
        closeCtxAfterStop = false;
      }
    }, { capture: true });

    setButtonState("stopped");
    updateReplayControls();
    loadReplayLink();
  }
  if (document.readyState === "loading") listen(document, "DOMContentLoaded", initialize, { once: true });
  else initialize();

})();
// --- END OF SCRIPT ---

