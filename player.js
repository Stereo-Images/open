/* ============================================================
   OPEN — v171_true_drift + B1 “Safety Bed” (AirPlay + no-stutter)
   - Foreground: full generative scheduler
   - Background / lock / app switch: stop scheduler + crossfade into a long,
     pre-scheduled “safety bed” (no timers needed => no stutter)
   - Return foreground: fade bed out + resume generative (if it was playing)
   - No UI Record/Export buttons required:
       Shift+R = toggle recording
       Shift+E = export WAV
   - Fixes “bleed” between sessions by isolating each run in a session bus
     gain node and hard-fading/disconnecting on Stop/Restart.
   ============================================================ */

(() => {
  "use strict";

  const STATE_KEY = "open_player_settings_v171_true_drift";

  // =========================
  // TARGET BEHAVIOR
  // =========================
  const MELODY_FLOOR_HZ = 220;    // A3
  const DRONE_FLOOR_HZ  = 87.31;  // F2
  const DRONE_GAIN_MULT = 0.70;

  // Background bed (no-timer sustain)
  const BG_BED_SECONDS = 600;     // 10 minutes
  const BG_FADE_IN = 0.20;
  const BG_FADE_OUT = 0.25;

  // Fade/stop behavior
  const STOP_FADE = 0.06;         // decisive stop
  const START_FADE_IN = 0.10;

  function clampFreqMin(freq, floorHz) {
    while (freq < floorHz) freq *= 2;
    return freq;
  }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  // =========================
  // VIEW & STATE
  // =========================
  function isPopoutMode() { return window.location.hash === "#popout"; }
  function isMobileDevice() {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "") ||
      (window.matchMedia?.("(pointer: coarse)")?.matches &&
       window.matchMedia?.("(max-width: 820px)")?.matches);
  }
  function applyModeClasses() {
    if (isPopoutMode()) document.body.classList.add("popout");
    else document.body.classList.remove("popout");
  }

  function launchPlayer() {
    if (isMobileDevice()) {
      document.body.classList.add("mobile-player");
      window.location.hash = "#popout";
      applyModeClasses();
      setButtonState("stopped");
      return;
    }
    const width = 500, height = 680;
    const left = Math.max(0, (window.screen.width / 2) - (width / 2));
    const top = Math.max(0, (window.screen.height / 2) - (height / 2));
    window.open(
      `${window.location.href.split("#")[0]}#popout`,
      "open_player",
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no,status=no`
    );
  }

  function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch { return null; } }
  function saveState(state) { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {} }

  function readControls() {
    return {
      songDuration: document.getElementById("songDuration")?.value ?? "60",
      tone: document.getElementById("tone")?.value ?? "110",
      updatedAt: Date.now()
    };
  }

  function applyControls(state) {
    const sd = document.getElementById("songDuration");
    const tone = document.getElementById("tone");
    const hzReadout = document.getElementById("hzReadout");
    if (sd) {
      const allowed = new Set(["60", "300", "600", "1800", "infinite"]);
      const v = state?.songDuration != null ? String(state.songDuration) : "60";
      sd.value = allowed.has(v) ? v : "60";
    }
    let toneVal = 110;
    if (state?.tone != null) {
      const n = Number(state.tone);
      if (Number.isFinite(n)) toneVal = clamp(n, 100, 200);
    }
    if (tone) tone.value = String(toneVal);
    if (hzReadout) hzReadout.textContent = String(toneVal);
  }

  function announceStatus(text) {
    const el = document.getElementById("playerStatus") || document.getElementById("recordStatus");
    if (el) el.textContent = text;
  }

  function setButtonState(state) {
    const playBtn = document.getElementById("playNow");
    const stopBtn = document.getElementById("stop");
    const toneInput = document.getElementById("tone");

    const isPlayingUI = (state === "playing");
    if (playBtn) {
      playBtn.classList.toggle("filled", isPlayingUI);
      playBtn.setAttribute("aria-pressed", String(isPlayingUI));
    }
    if (stopBtn) {
      stopBtn.classList.toggle("filled", !isPlayingUI);
      stopBtn.setAttribute("aria-pressed", String(!isPlayingUI));
    }
    if (toneInput) toneInput.disabled = isPlayingUI;

    announceStatus(isPlayingUI ? "Playing" : "Stopped");
  }

  // =========================
  // LIVE RECORDING (hotkey only)
  // =========================
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;

  function setRecordUI(on) {
    const el = document.getElementById("recordStatus");
    if (el) el.textContent = on ? "Recording: ON" : "Recording: off";
  }

  function toggleRecording() {
    // Requires streamDest to exist (initAudio) and an active user gesture earlier.
    if (!streamDest?.stream) return;

    if (isRecording) {
      isRecording = false;
      try { mediaRecorder?.stop(); } catch {}
      setRecordUI(false);
      return;
    }

    recordedChunks = [];
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
    const mimeType = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
    try {
      mediaRecorder = new MediaRecorder(streamDest.stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      console.warn(e);
      return;
    }

    mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      try {
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `open-live-${Date.now()}.${blob.type.includes("ogg") ? "ogg" : "webm"}`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
      } catch {}
    };

    mediaRecorder.start(250);
    isRecording = true;
    setRecordUI(true);
  }

  // =========================
  // DETERMINISTIC RNG
  // =========================
  let sessionSeed = 0;
  let rng = Math.random;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function setSeed(seed) { sessionSeed = (seed >>> 0); rng = mulberry32(sessionSeed); }
  function rngStream(tagInt) { return mulberry32((sessionSeed ^ tagInt) >>> 0); }
  function rand() { return rng(); }
  function chance(p) { return rand() < p; }

  let sessionSnapshot = null;

  // =========================
  // AUDIO GRAPH (AirPlay sticky)
  // =========================
  let audioContext = null;

  // “masterOut” feeds both destination + AirPlay stream destination
  let masterOut = null;

  // Reverb
  let reverbNode = null, reverbPreDelay = null, reverbSend = null, reverbReturn = null, reverbLP = null;
  const REVERB_RETURN_LEVEL = 0.80;

  // AirPlay plumbing
  let streamDest = null;
  let airplayEl = null;

  // Session isolation (prevents bleed between runs)
  let sessionBus = null;   // GainNode (per run)
  let sessionBusSend = null; // send gain to reverb (per run)
  let sessionId = 0;

  // Background bed nodes
  let bgBed = {
    active: false,
    gain: null,
    send: null,
    nodes: [],
    startedAt: 0
  };

  // Playback state
  let isPlaying = false;
  let wasPlayingBeforeBg = false;

  // Scheduling
  let timerInterval = null;
  let nextTimeA = 0;
  let sessionStartTime = 0;

  // Harmony engine state
  let patternIdxA = 0;
  let notesSinceModulation = 0;
  let circlePosition = 0;
  let isMinor = false;
  let runDensity = 0.2;

  let phraseStep = 0;
  let phraseCount = 0;
  let arcLen = 6;
  let arcPos = -1;
  let arcClimaxAt = 4;
  let tension = 0.0;
  let lastCadenceType = "none";
  let currentCadenceType = "none";

  // Drone cooldown
  let lastDroneStart = -9999;
  let lastDroneDur = 0;

  function createImpulseResponse(ctx) {
    const duration = 10.0, decay = 2.8, rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    const r = rngStream(0xC0FFEE);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (r() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  function initAudio() {
    if (audioContext) return;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioContext = new Ctx({ latencyHint: "playback" });

    // Master out
    masterOut = audioContext.createGain();
    masterOut.gain.value = 0.9; // overall output scaling
    masterOut.connect(audioContext.destination);

    // Stream destination for AirPlay <audio> element
    streamDest = audioContext.createMediaStreamDestination();
    masterOut.connect(streamDest);

    // Reverb chain (global return to masterOut)
    reverbPreDelay = audioContext.createDelay(0.1);
    reverbPreDelay.delayTime.value = 0.045;

    reverbNode = audioContext.createConvolver();
    reverbNode.buffer = createImpulseResponse(audioContext);

    reverbLP = audioContext.createBiquadFilter();
    reverbLP.type = "lowpass";
    reverbLP.frequency.value = 4200;
    reverbLP.Q.value = 0.7;

    reverbReturn = audioContext.createGain();
    reverbReturn.gain.value = REVERB_RETURN_LEVEL;

    // NOTE: We use per-source “send” gains (sessionBusSend / bgBed.send),
    // which connect into this shared reverb pipeline:
    // send -> preDelay -> convolver -> LP -> return -> masterOut
    reverbPreDelay.connect(reverbNode);
    reverbNode.connect(reverbLP);
    reverbLP.connect(reverbReturn);
    reverbReturn.connect(masterOut);

    // “Heartbeat” keeps the context active once started.
    // (Does not solve iOS timer-throttle by itself; B1 bed does.)
    const silent = audioContext.createBuffer(1, 1, audioContext.sampleRate);
    const heartbeat = audioContext.createBufferSource();
    heartbeat.buffer = silent;
    heartbeat.loop = true;
    heartbeat.start();
    heartbeat.connect(audioContext.destination);

    // AirPlay sticky element (must be started by user gesture => initAudio called on Play)
    airplayEl = document.getElementById("airplaySink");
    if (!airplayEl) {
      airplayEl = document.createElement("audio");
      airplayEl.id = "airplaySink";
      airplayEl.style.position = "fixed";
      airplayEl.style.left = "-9999px";
      airplayEl.style.top = "0";
      airplayEl.style.width = "1px";
      airplayEl.style.height = "1px";
      airplayEl.style.opacity = "0.01";
      airplayEl.playsInline = true;
      airplayEl.autoplay = true;
      airplayEl.controls = false;
      document.body.appendChild(airplayEl);
    }
    try {
      airplayEl.srcObject = streamDest.stream;
      airplayEl.muted = false;
      airplayEl.volume = 1;
      // play() can fail if not in a gesture; initAudio is called from Play click so OK.
      airplayEl.play().catch(() => {});
    } catch {}

    // Optional: “video wakelock hack” (kept minimal)
    let v = document.querySelector("video#wakeLockVid");
    if (!v) {
      v = document.createElement("video");
      v.id = "wakeLockVid";
      Object.assign(v.style, { position: "fixed", bottom: "0", right: "0", width: "1px", height: "1px", opacity: 0.01, zIndex: -1 });
      v.muted = true;
      v.playsInline = true;
      document.body.appendChild(v);
    }
    try {
      v.srcObject = streamDest.stream;
      v.play().catch(() => {});
    } catch {}
  }

  function ensureRunning() {
    initAudio();
    if (audioContext?.state === "suspended") audioContext.resume?.().catch(() => {});
  }

  // =========================
  // SESSION BUS (prevents bleed)
  // =========================
  function createNewSessionBus() {
    // Clean up any old bus immediately
    destroySessionBus(true);

    sessionId++;
    sessionBus = audioContext.createGain();
    sessionBus.gain.value = 1.0;
    sessionBus.connect(masterOut);

    // per-session reverb send
    sessionBusSend = audioContext.createGain();
    sessionBusSend.gain.value = 0.0;
    sessionBusSend.connect(reverbPreDelay);

    return sessionId;
  }

  function destroySessionBus(immediate = false) {
    if (!audioContext) return;

    const t = audioContext.currentTime;
    if (sessionBus) {
      try {
        sessionBus.gain.cancelScheduledValues(t);
        if (immediate) {
          sessionBus.gain.setValueAtTime(0, t);
        } else {
          sessionBus.gain.setValueAtTime(sessionBus.gain.value, t);
          sessionBus.gain.linearRampToValueAtTime(0, t + STOP_FADE);
        }
      } catch {}

      const busToDisconnect = sessionBus;
      // Disconnect slightly later to allow fade to apply
      setTimeout(() => { try { busToDisconnect.disconnect(); } catch {} }, immediate ? 0 : Math.ceil((STOP_FADE + 0.02) * 1000));
    }

    if (sessionBusSend) {
      const s = sessionBusSend;
      setTimeout(() => { try { s.disconnect(); } catch {} }, 0);
    }

    sessionBus = null;
    sessionBusSend = null;
  }

  // =========================
  // BACKGROUND “SAFETY BED” (B1)
  // =========================
  function stopBackgroundBed(immediate = false) {
    if (!audioContext || !bgBed.active) return;

    const t = audioContext.currentTime;
    try {
      bgBed.gain.gain.cancelScheduledValues(t);
      if (immediate) {
        bgBed.gain.gain.setValueAtTime(0, t);
      } else {
        bgBed.gain.gain.setValueAtTime(bgBed.gain.gain.value, t);
        bgBed.gain.gain.linearRampToValueAtTime(0, t + BG_FADE_OUT);
      }
    } catch {}

    // stop oscillators after fade
    const stopAt = t + (immediate ? 0 : (BG_FADE_OUT + 0.02));
    bgBed.nodes.forEach(n => { try { n.stop(stopAt); } catch {} });
    bgBed.nodes.forEach(n => { try { n.disconnect(); } catch {} });

    try { bgBed.send?.disconnect(); } catch {}
    try { bgBed.gain?.disconnect(); } catch {}

    bgBed.active = false;
    bgBed.gain = null;
    bgBed.send = null;
    bgBed.nodes = [];
    bgBed.startedAt = 0;
  }

  function startBackgroundBed() {
    if (!audioContext) return;
    stopBackgroundBed(true);

    const t = audioContext.currentTime;

    bgBed.gain = audioContext.createGain();
    bgBed.gain.gain.setValueAtTime(0, t);
    bgBed.gain.gain.linearRampToValueAtTime(1.0, t + BG_FADE_IN);
    bgBed.gain.connect(masterOut);

    bgBed.send = audioContext.createGain();
    bgBed.send.gain.setValueAtTime(0.35, t); // bed reverb amount
    bgBed.send.connect(reverbPreDelay);

    bgBed.nodes = [];
    bgBed.active = true;
    bgBed.startedAt = t;

    // Choose a “safe” chord: root + fifth (+ optional third if stable)
    let base = Number(document.getElementById("tone")?.value ?? 110);
    if (!Number.isFinite(base)) base = 110;
    base = clamp(base, 100, 200);

    // Keep bed in low register, but above DRONE_FLOOR_HZ
    const root = clampFreqMin(base / 2, DRONE_FLOOR_HZ);
    const fifth = root * Math.pow(2, 7 / 12);
    const third = root * (isMinor ? Math.pow(2, 3 / 12) : Math.pow(2, 4 / 12));

    const includeThird = (tension < 0.55) && (currentCadenceType !== "half") && (currentCadenceType !== "deceptive") && (currentCadenceType !== "evaded");

    // Create long drones (no timers needed)
    const dur = BG_BED_SECONDS;
    const endAt = t + dur;

    function longSine(freq, gainAmt, detuneCents = 0) {
      const o = audioContext.createOscillator();
      const g = audioContext.createGain();
      const lp = audioContext.createBiquadFilter();

      o.type = "sine";
      o.frequency.setValueAtTime(freq, t);
      o.detune.setValueAtTime(detuneCents, t);

      // smooth, slow envelope
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gainAmt, t + 2.0);
      g.gain.setValueAtTime(gainAmt, endAt - 3.0);
      g.gain.exponentialRampToValueAtTime(0.0001, endAt);

      lp.type = "lowpass";
      lp.frequency.setValueAtTime(650, t);
      lp.Q.value = 0.6;

      o.connect(g);
      g.connect(lp);
      lp.connect(bgBed.gain);
      lp.connect(bgBed.send);

      o.start(t);
      o.stop(endAt);

      bgBed.nodes.push(o, g, lp);
    }

    // Overall bed level
    const baseVol = 0.18 * DRONE_GAIN_MULT;

    longSine(root,  baseVol * 0.55, (rand() - 0.5) * 6);
    longSine(fifth, baseVol * 0.30, (rand() - 0.5) * 6);
    if (includeThird) longSine(third, baseVol * 0.20, (rand() - 0.5) * 6);

    announceStatus("Background mode (Safety Bed)");
  }

  function enterBackgroundMode() {
    // If not playing, just keep AirPlay latched without changing anything.
    wasPlayingBeforeBg = isPlaying;

    if (!isPlaying) return;

    // Stop scheduler + fade out session immediately, then start bed.
    stopSchedulerOnly();
    fadeOutCurrentSession(true); // decisive
    startBackgroundBed();
  }

  function exitBackgroundMode() {
    // Fade out bed; resume generative only if it had been playing.
    stopBackgroundBed(false);

    if (wasPlayingBeforeBg) {
      // Restart generative cleanly (new run) to avoid “half state”
      startFromUI(true /*fromBg*/);
    } else {
      announceStatus("Stopped");
    }
    wasPlayingBeforeBg = false;
  }

  // =========================
  // HARMONY LOGIC
  // =========================
  function circDist(a, b) {
    const d = Math.abs(a - b);
    return Math.min(d, 7 - d);
  }

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
      case "half": return { pre: 1, end: 4, wantLT: false };
      case "plagal": return { pre: 3, end: 0, wantLT: false };
      case "deceptive": return { pre: 6, end: 5, wantLT: true };
      case "evaded": return { pre: 6, end: 2, wantLT: true };
      default: return { pre: 2, end: 0, wantLT: false };
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
    if (minorMode && opts.raiseLeadingTone && degree === 6) {
      intervals = minorIntervals.slice();
      intervals[6] = 11;
    }
    const noteValue = rootOffset + intervals[degree] + (octave * 12);
    return baseFreq * Math.pow(2, noteValue / 12);
  }

  function updateHarmonyState(durationInput) {
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

  // =========================
  // SYNTH / SCHEDULING
  // =========================
  function scheduleNote(ctx, destination, wetSend, freq, time, duration, volume, instability = 0, tensionAmt = 0) {
    freq = clampFreqMin(freq, MELODY_FLOOR_HZ);

    const numVoices = 2 + Math.floor(rand() * 2);
    let totalAmp = 0;
    const isFractured = (tensionAmt > 0.75);
    const FRACTURE_RATIOS = [Math.SQRT2, 1.618, 2.414, 2.718, 3.1415];
    const ratioFuzz = isFractured ? 0.08 : 0.0;

    const voices = Array.from({ length: numVoices }, () => {
      let mRatio = isFractured
        ? FRACTURE_RATIOS[Math.floor(rand() * FRACTURE_RATIOS.length)]
        : (1.5 + rand() * 2.5);
      if (isFractured) mRatio += (rand() - 0.5) * ratioFuzz;
      const mIndex = 1.0 + (tensionAmt * 2.0) + (rand() * 3.0);
      const v = { modRatio: mRatio, modIndex: mIndex, amp: rand() };
      totalAmp += v.amp;
      return v;
    });

    voices.forEach(voice => {
      const carrier = ctx.createOscillator();
      const modulator = ctx.createOscillator();
      const modGain = ctx.createGain();
      const ampGain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = "lowpass";
      filter.frequency.value = Math.min(freq * 3.5, 6000);
      filter.Q.value = 0.6;

      const drift = (rand() - 0.5) * (2 + (instability * (isFractured ? 15 : 10)));
      carrier.frequency.value = freq + drift;
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

      // IMPORTANT: everything routes through sessionBus (prevents bleed)
      filter.connect(destination);
      filter.connect(wetSend);

      modulator.start(time);
      carrier.start(time);
      modulator.stop(time + duration);
      carrier.stop(time + duration);
    });
  }

  function scheduleBassVoice(ctx, destination, wetSend, freq, time, duration, volume) {
    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const modGain = ctx.createGain();
    const ampGain = ctx.createGain();
    const lp = ctx.createBiquadFilter();

    carrier.type = "sine";
    modulator.type = "sine";
    carrier.frequency.value = freq;
    modulator.frequency.value = freq * 2.0;
    modulator.detune.value = (rand() - 0.5) * 8;

    modGain.gain.setValueAtTime(0, time);
    modGain.gain.linearRampToValueAtTime(freq * 1.8, time + (duration * 0.5));
    modGain.gain.linearRampToValueAtTime(0, time + duration);

    ampGain.gain.setValueAtTime(0.0001, time);
    ampGain.gain.exponentialRampToValueAtTime(volume, time + 2.0);
    ampGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    lp.type = "lowpass";
    lp.frequency.setValueAtTime(600, time);
    lp.Q.value = 0.6;

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(ampGain);
    ampGain.connect(lp);

    lp.connect(destination);
    lp.connect(wetSend);

    modulator.start(time);
    carrier.start(time);
    modulator.stop(time + duration);
    carrier.stop(time + duration);
  }

  function scheduleDroneChord(ctx, destination, wetSend, rootFreq, time, duration, baseVolume, quality, includeThird = true) {
    let f0 = clampFreqMin(rootFreq, DRONE_FLOOR_HZ);

    const thirdRatio = (quality === "min") ? Math.pow(2, 3 / 12) : Math.pow(2, 4 / 12);
    const fifthRatio = Math.pow(2, 7 / 12);

    const vol = baseVolume * DRONE_GAIN_MULT;

    scheduleBassVoice(ctx, destination, wetSend, f0, time, duration, vol * 0.50);
    scheduleBassVoice(ctx, destination, wetSend, f0 * fifthRatio, time, duration, vol * 0.30);
    if (includeThird) scheduleBassVoice(ctx, destination, wetSend, f0 * thirdRatio, time, duration, vol * 0.20);
  }

  function silentInitPhraseLive() {
    phraseStep = 15;
    phraseCount++;
    arcPos = arcPos + 1;
    if (arcPos >= arcLen) startNewArc();
    currentCadenceType = pickCadenceTypeForPhrase();
    phraseStep = 0;
  }

  function stopSchedulerOnly() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function fadeOutCurrentSession(immediate = false) {
    if (!audioContext) return;

    // Stop scheduling
    stopSchedulerOnly();
    isPlaying = false;

    // Kill session bus (prevents lingering bleed)
    destroySessionBus(immediate);

    setButtonState("stopped");
  }

  function scheduler() {
    if (!isPlaying || !audioContext || !sessionBus || !sessionBusSend) return;

    // NOTE: foreground scheduler only. Background is handled by the Safety Bed.
    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const now = audioContext.currentTime;
    const elapsed = now - sessionStartTime;
    const approachingEnd = (durationInput !== "infinite" && elapsed >= parseFloat(durationInput || "60"));

    let baseFreq = Number(document.getElementById("tone")?.value ?? 110);
    if (!Number.isFinite(baseFreq)) baseFreq = 110;
    baseFreq = clamp(baseFreq, 100, 200);

    const noteDur = (1 / runDensity) * 2.5;

    // reverb send scaling by density
    if (sessionBusSend && arcPos !== arcClimaxAt - 1) {
      let targetSend = 0.65 - (0.25 * clamp01((runDensity - 0.05) / 0.375));
      targetSend = clamp(targetSend, 0, 0.95);
      sessionBusSend.gain.setTargetAtTime(targetSend, now, 2.5);
    }

    const LOOKAHEAD = 0.50; // foreground lookahead

    while (nextTimeA < now + LOOKAHEAD) {
      let appliedDur = noteDur;
      let pressure = Math.min(1.0, notesSinceModulation / 48.0);
      updateHarmonyState(durationInput);

      // End logic
      if (approachingEnd) {
        if (patternIdxA % 7 === 0) {
          let fEnd = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor);
          fEnd = clampFreqMin(fEnd, MELODY_FLOOR_HZ);
          scheduleNote(audioContext, sessionBus, sessionBusSend, fEnd, nextTimeA, 25.0, 0.5, 0, 0);
          // natural end == stop scheduling; bus will fade on stopAllManual if user hits stop
          fadeOutCurrentSession(false);
          return;
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

      // Melody movement
      if (isCadence) {
        const cadenceDegrees = [0, 1, 3, 4, 5];
        const currentOctave = Math.floor(patternIdxA / 7) * 7;
        let deg = patternIdxA - currentOctave;
        deg = ((deg % 7) + 7) % 7;

        let best = cadenceDegrees[0];
        let bestD = circDist(deg, best);
        for (let i = 1; i < cadenceDegrees.length; i++) {
          const t = cadenceDegrees[i];
          const d = circDist(deg, t);
          if (d < bestD || (d === bestD && chance(0.5))) { best = t; bestD = d; }
        }

        let targetDeg = best;
        if (!chance(0.6)) {
          const dir = chance(0.65) ? -1 : 1;
          targetDeg = (targetDeg + dir + 7) % 7;
        }

        let delta = targetDeg - deg;
        if (delta > 3) delta -= 7;
        if (delta < -3) delta += 7;
        patternIdxA = currentOctave + deg + delta;

        const ct = currentCadenceType;
        const cadencePlan = cadenceTargets(ct);

        if (phraseStep === 14 && chance(0.70)) {
          const curOct = Math.floor(patternIdxA / 7) * 7;
          const curDeg = ((patternIdxA - curOct) % 7 + 7) % 7;
          let deltaPre = cadencePlan.pre - curDeg;
          if (deltaPre > 3) deltaPre -= 7;
          if (deltaPre < -3) deltaPre += 7;
          patternIdxA += deltaPre;
        }

        if (phraseStep === 15) {
          const curOct = Math.floor(patternIdxA / 7) * 7;
          const curDeg = ((patternIdxA - curOct) % 7 + 7) % 7;
          let deltaEnd = cadencePlan.end - curDeg;
          if (deltaEnd > 3) deltaEnd -= 7;
          if (deltaEnd < -3) deltaEnd += 7;

          // softened snap
          if (chance(0.35)) patternIdxA += deltaEnd;
          else if (chance(0.25)) patternIdxA += (deltaEnd > 0 ? deltaEnd - 1 : deltaEnd + 1);

          if (ct === "authentic") tension = clamp01(tension - 0.22);
          else tension = clamp01(tension + 0.10);

          lastCadenceType = ct;
        }
      } else {
        patternIdxA += (rand() < 0.5 ? 1 : -1);
      }

      const cadencePlan = currentCadenceType ? cadenceTargets(currentCadenceType) : null;
      const wantLT = cadencePlan ? cadencePlan.wantLT : false;
      const degNow = degreeFromIdx(patternIdxA);
      const raiseLT = isMinor && isCadence && wantLT && (degNow === 6);

      let freq = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor, { raiseLeadingTone: raiseLT });
      freq = clampFreqMin(freq, MELODY_FLOOR_HZ);

      // Drone chord logic
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

        if (!useThirdColor && droneRootDegree !== 0 && chance(0.65)) droneRootDegree = 0;

        const curRegister = Math.floor(patternIdxA / 7);
        const droneOct = Math.min(curRegister - 1, 0);
        const droneIdx = droneOct * 7 + droneRootDegree;

        let droneRootFreq = getScaleNote(baseFreq, droneIdx, circlePosition, isMinor);
        droneRootFreq = clampFreqMin(droneRootFreq, DRONE_FLOOR_HZ);

        const t0 = Math.max(nextTimeA - 0.05, audioContext.currentTime);
        const droneDur = isArcStart ? 32.0 : 22.0;

        lastDroneStart = t0;
        lastDroneDur = droneDur;

        const baseVol = (isArcStart || isClimax) ? 0.40 : 0.28;
        const quality = isMinor ? "min" : "maj";

        scheduleDroneChord(audioContext, sessionBus, sessionBusSend, droneRootFreq, t0, droneDur, baseVol, quality, useThirdColor);
      }

      // Melody schedule
      const isDroneSolo = (arcPos === 0 && phraseStep < 12 && phraseCount > 0);
      if (!isDroneSolo) {
        if (isCadence && arcPos === arcClimaxAt && phraseStep === 15) {
          scheduleNote(audioContext, sessionBus, sessionBusSend, freq * 2.0, nextTimeA, appliedDur, 0.35, pressure, tension);
        }
        scheduleNote(audioContext, sessionBus, sessionBusSend, freq, nextTimeA, appliedDur, 0.4, pressure, tension);
      }

      notesSinceModulation++;
      nextTimeA += (1 / runDensity) * (0.95 + rand() * 0.1);
    }
  }

  // =========================
  // START / STOP (decisive, no bleed)
  // =========================
  function resetHarmonyState() {
    patternIdxA = 0;
    circlePosition = 0;
    isMinor = false;
    tension = 0.0;
    lastCadenceType = "none";
    currentCadenceType = "none";
    lastDroneStart = -9999;
    lastDroneDur = 0;
    notesSinceModulation = 0;
    arcPos = -1;
    arcLen = 6;
    arcClimaxAt = 4;
  }

  function startFromUI(fromBg = false) {
    ensureRunning();

    // If bed is active, fade it out immediately (foreground takes over)
    if (bgBed.active) stopBackgroundBed(true);

    // Always start a clean new run (prevents “carryover” audio)
    // This also keeps UI consistent if Play is pressed rapidly.
    fadeOutCurrentSession(true);

    // Create new session bus
    createNewSessionBus();

    // Fade in session bus gently
    const t = audioContext.currentTime;
    sessionBus.gain.cancelScheduledValues(t);
    sessionBus.gain.setValueAtTime(0, t);
    sessionBus.gain.linearRampToValueAtTime(1.0, t + START_FADE_IN);

    // New seeded run
    resetHarmonyState();

    const seed = (crypto?.getRandomValues
      ? crypto.getRandomValues(new Uint32Array(1))[0]
      : Math.floor(Math.random() * 2 ** 32)) >>> 0;
    setSeed(seed);
    runDensity = 0.05 + rand() * 0.375;

    startNewArc();
    sessionSnapshot = { seed, density: runDensity, arcLen, arcClimaxAt };

    // “Ghost phrase init” (state only)
    phraseCount = -1;
    silentInitPhraseLive();

    isPlaying = true;
    sessionStartTime = audioContext.currentTime;
    nextTimeA = audioContext.currentTime + 0.05;

    setButtonState("playing");

    stopSchedulerOnly();
    timerInterval = setInterval(scheduler, 50);

    if (fromBg) {
      announceStatus("Playing (resumed)");
    }
  }

  function stopAllManual() {
    // Also stops bed + recording state remains (user-controlled)
    wasPlayingBeforeBg = false;

    // Kill bed and current session immediately (decisive stop)
    stopBackgroundBed(true);
    fadeOutCurrentSession(true);
    stopSchedulerOnly();

    setButtonState("stopped");
  }

  // =========================
  // EXPORT (Shift+E)
  // =========================
  async function renderWavExport() {
    try {
      ensureRunning();
      if (!sessionSnapshot?.seed) { alert("Press Play once first."); return; }

      // Stop any bed; export mirrors the live snapshot
      if (bgBed.active) stopBackgroundBed(true);

      setSeed(sessionSnapshot.seed);

      const durationInput = document.getElementById("songDuration")?.value ?? "60";
      const exportDuration = (durationInput === "infinite") ? 180 : Math.min(180, parseFloat(durationInput));
      const sampleRate = 44100;

      const offlineCtx = new OfflineAudioContext(2, Math.floor(sampleRate * exportDuration), sampleRate);

      const offlineMaster = offlineCtx.createGain();
      offlineMaster.gain.value = 0.9;
      offlineMaster.connect(offlineCtx.destination);

      // Reverb (offline)
      const offlinePreDelay = offlineCtx.createDelay(0.1);
      offlinePreDelay.delayTime.value = 0.045;

      const offlineReverb = offlineCtx.createConvolver();
      offlineReverb.buffer = createImpulseResponse(offlineCtx);

      const offlineReverbLP = offlineCtx.createBiquadFilter();
      offlineReverbLP.type = "lowpass";
      offlineReverbLP.frequency.value = 4200;
      offlineReverbLP.Q.value = 0.7;

      const offlineSend = offlineCtx.createGain();
      offlineSend.gain.value = 0.0;
      const offlineReturn = offlineCtx.createGain();
      offlineReturn.gain.value = REVERB_RETURN_LEVEL;

      offlineSend.connect(offlinePreDelay);
      offlinePreDelay.connect(offlineReverb);
      offlineReverb.connect(offlineReverbLP);
      offlineReverbLP.connect(offlineReturn);
      offlineReturn.connect(offlineMaster);

      // Local copies of evolving state
      let localPhraseCount = 0;
      let localArcLen = sessionSnapshot.arcLen ?? 6;
      let localArcClimaxAt = sessionSnapshot.arcClimaxAt ?? 4;
      let localArcPos = -1;
      let localTension = 0.0;
      let localLastCadenceType = "none";
      let localCadenceType = "none";
      let localLastDroneStart = -9999;
      let localLastDroneDur = 0;
      let usedSnapshotArc = false;

      function localStartNewArc() {
        if (!usedSnapshotArc && sessionSnapshot.arcLen != null) {
          localArcLen = sessionSnapshot.arcLen;
          localArcClimaxAt = sessionSnapshot.arcClimaxAt;
          usedSnapshotArc = true;
        } else {
          localArcLen = 4 + Math.floor(rand() * 5);
          localArcClimaxAt = Math.max(2, localArcLen - 2 - Math.floor(rand() * 2));
        }
        localArcPos = -1;
        localTension = clamp01(localTension * 0.4 + 0.05);
      }
      localStartNewArc();

      const exportDensity = sessionSnapshot.density;

      let baseFreq = Number(document.getElementById("tone")?.value ?? 110);
      if (!Number.isFinite(baseFreq)) baseFreq = 110;
      baseFreq = clamp(baseFreq, 100, 200);

      const noteDur = (1 / exportDensity) * 2.5;
      let localCircle = 0;
      let localMinor = false;
      let localIdx = 0;
      let localTime = 0.05;
      let localModCount = 0;
      let localPhraseStep = 0;

      function localDegreeFromIdx(idx) {
        const base = Math.floor(idx / 7) * 7;
        return ((idx - base) % 7 + 7) % 7;
      }

      function localCadenceRepeatPenalty(type) {
        if (type !== localLastCadenceType) return 0.0;
        if (type === "authentic") return 0.30;
        return 0.18;
      }

      function localPickCadenceType() {
        const nearClimax = (localArcPos === localArcClimaxAt);
        const lateArc = (localArcPos >= localArcLen - 2);
        let w = { evaded: 0.20, half: 0.28, plagal: 0.12, deceptive: 0.18, authentic: 0.22 };

        if (localArcPos < localArcClimaxAt) { w.authentic = 0.05; w.evaded += 0.2; w.half += 0.1; }
        w.authentic += localTension * 0.25; w.deceptive += localTension * 0.10; w.evaded -= localTension * 0.18;

        if (nearClimax) { w.authentic += 0.25; w.deceptive += 0.10; w.evaded -= 0.20; }
        if (lateArc && localTension > 0.45) { w.authentic += 0.22; w.evaded -= 0.15; }
        if (localMinor) { w.deceptive += 0.05; w.plagal -= 0.02; }

        for (const k of Object.keys(w)) w[k] = Math.max(0.001, w[k] - localCadenceRepeatPenalty(k));
        const keys = Object.keys(w);
        const sum = keys.reduce((a, k) => a + w[k], 0);
        let r = rand() * sum;
        for (const k of keys) { r -= w[k]; if (r <= 0) return k; }
        return "authentic";
      }

      function localUpdateHarmony() {
        const r = rand();
        let pressure = Math.min(1.0, localModCount / 48.0);
        if (localArcPos === localArcClimaxAt) pressure *= 2.5;
        if (r < pressure * 0.35) {
          if (chance(0.2)) localMinor = !localMinor;
          else localCircle += (chance(0.5) ? 1 : -1);
          localModCount = 0;
        }
      }

      function silentInitPhraseExport() {
        localPhraseStep = 15;
        localPhraseCount++;
        localArcPos = localArcPos + 1;
        if (localArcPos >= localArcLen) localStartNewArc();
        localCadenceType = localPickCadenceType();
        localPhraseStep = 0;
      }

      localPhraseCount = -1;
      silentInitPhraseExport();

      while (localTime < exportDuration - 2.0) {
        localPhraseStep = (localPhraseStep + 1) % 16;
        if (localPhraseStep === 0) {
          localPhraseCount++;
          localArcPos++;
          if (localArcPos >= localArcLen) {
            localArcLen = 4 + Math.floor(rand() * 5);
            localArcClimaxAt = Math.max(2, localArcLen - 2 - Math.floor(rand() * 2));
            localArcPos = -1;
            localTension = clamp01(localTension * 0.4 + 0.05);
            localArcPos++;
          }
          localCadenceType = localPickCadenceType();
        }

        const isCadence = (localPhraseStep >= 13);
        let pressure = Math.min(1.0, localModCount / 48.0);
        localUpdateHarmony();

        const normDensity = clamp01((exportDensity - 0.05) / 0.375);
        let targetSend = 0.65 - (0.25 * normDensity);
        offlineSend.gain.setTargetAtTime(targetSend, localTime, 2.5);

        let appliedDur = noteDur;
        if (chance(localPhraseStep === 15 ? 0.85 : 0.2)) appliedDur *= 1.2;

        if (isCadence) {
          const cadenceDegrees = [0, 1, 3, 4, 5];
          const currentOctave = Math.floor(localIdx / 7) * 7;
          let deg = localIdx - currentOctave;
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
          if (delta > 3) delta -= 7;
          if (delta < -3) delta += 7;
          localIdx = currentOctave + deg + delta;

          const cadencePlan = cadenceTargets(localCadenceType);

          if (localPhraseStep === 14 && chance(0.70)) {
            const curOct = Math.floor(localIdx / 7) * 7;
            const curDeg = ((localIdx - curOct) % 7 + 7) % 7;
            let deltaPre = cadencePlan.pre - curDeg;
            if (deltaPre > 3) deltaPre -= 7;
            if (deltaPre < -3) deltaPre += 7;
            localIdx += deltaPre;
          }

          if (localPhraseStep === 15) {
            const curOct = Math.floor(localIdx / 7) * 7;
            const curDeg = ((localIdx - curOct) % 7 + 7) % 7;
            let deltaEnd = cadencePlan.end - curDeg;
            if (deltaEnd > 3) deltaEnd -= 7;
            if (deltaEnd < -3) deltaEnd += 7;

            if (chance(0.35)) localIdx += deltaEnd;
            else if (chance(0.25)) localIdx += (deltaEnd > 0 ? deltaEnd - 1 : deltaEnd + 1);

            if (localCadenceType === "authentic") localTension = clamp01(localTension - 0.22);
            else localTension = clamp01(localTension + 0.10);

            localLastCadenceType = localCadenceType;
          }
        } else {
          localIdx += (rand() < 0.5 ? 1 : -1);
        }

        const cadencePlan = cadenceTargets(localCadenceType);
        const wantLT = cadencePlan.wantLT;
        const degNow = localDegreeFromIdx(localIdx);
        const raiseLT = localMinor && isCadence && wantLT && (degNow === 6);

        let freq = getScaleNote(baseFreq, localIdx, localCircle, localMinor, { raiseLeadingTone: raiseLT });
        freq = clampFreqMin(freq, MELODY_FLOOR_HZ);

        const isArcStart = (localArcPos === 0 && localPhraseStep === 0);
        const isClimax = (localArcPos === localArcClimaxAt && localPhraseStep === 0);
        const atPhraseStart = (localPhraseStep === 0);

        let droneProb = atPhraseStart ? 0.18 : 0.04;
        const canStartDrone = (localTime >= localLastDroneStart + localLastDroneDur * 0.65);

        if (canStartDrone && (isArcStart || isClimax || chance(droneProb))) {
          let droneRootDegree = 0;
          if (!isArcStart && !isClimax) {
            if (localCadenceType === "half") droneRootDegree = 4;
            else if (localCadenceType === "deceptive") droneRootDegree = chance(0.6) ? 0 : 5;
            else if (localCadenceType === "plagal") droneRootDegree = chance(0.6) ? 3 : 0;
          }

          const melodyDegNow = localDegreeFromIdx(localIdx);
          const useThirdColor = shouldUseThirdDrone({
            atCadenceZone: (localPhraseStep >= 13),
            tensionVal: localTension,
            cadenceType: localCadenceType,
            melodyDeg: melodyDegNow
          });

          if (!useThirdColor && droneRootDegree !== 0 && chance(0.65)) droneRootDegree = 0;

          const curRegister = Math.floor(localIdx / 7);
          const droneOct = Math.min(curRegister - 1, 0);
          const droneIdx = droneOct * 7 + droneRootDegree;

          let droneRootFreq = getScaleNote(baseFreq, droneIdx, localCircle, localMinor);
          droneRootFreq = clampFreqMin(droneRootFreq, DRONE_FLOOR_HZ);

          const t0 = Math.max(localTime - 0.05, 0);
          const droneDur = isArcStart ? 32.0 : 22.0;

          localLastDroneStart = t0;
          localLastDroneDur = droneDur;

          const baseVol = (isArcStart || isClimax) ? 0.40 : 0.28;
          const quality = localMinor ? "min" : "maj";

          scheduleDroneChord(offlineCtx, offlineMaster, offlineSend, droneRootFreq, t0, droneDur, baseVol, quality, useThirdColor);
        }

        const isDroneSolo = (localArcPos === 0 && localPhraseStep < 12 && localPhraseCount > 0);
        if (!isDroneSolo) {
          if (isCadence && localArcPos === localArcClimaxAt && localPhraseStep === 15) {
            scheduleNote(offlineCtx, offlineMaster, offlineSend, freq * 2.0, localTime, appliedDur, 0.35, pressure, localTension);
          }
          scheduleNote(offlineCtx, offlineMaster, offlineSend, freq, localTime, appliedDur, 0.4, pressure, localTension);
        }

        localModCount++;
        localTime += (1 / exportDensity) * (0.95 + rand() * 0.1);
      }

      const renderedBuffer = await offlineCtx.startRendering();
      const wavBlob = bufferToWave(renderedBuffer, Math.floor(exportDuration * sampleRate));
      const url = URL.createObjectURL(wavBlob);

      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `open-final-v171-${Date.now()}.wav`;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 150);
    } catch (e) {
      console.warn(e);
      alert("Export failed on this device/browser.");
    }
  }

  function bufferToWave(abuffer, len) {
    const numOfChan = abuffer.numberOfChannels;
    const length = len * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);

    const channels = [];
    const sampleRate = abuffer.sampleRate;
    let offset = 0;
    let pos = 0;

    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

    setUint32(0x46464952);
    setUint32(length - 8);
    setUint32(0x45564157);
    setUint32(0x20746d66);
    setUint32(16);
    setUint16(1);
    setUint16(numOfChan);
    setUint32(sampleRate);
    setUint32(sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2);
    setUint16(16);
    setUint32(0x61746164);
    setUint32(length - pos - 4);

    for (let i = 0; i < numOfChan; i++) channels.push(abuffer.getChannelData(i));

    while (pos < length) {
      for (let i = 0; i < numOfChan; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        view.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }

    return new Blob([buffer], { type: "audio/wav" });
  }

  // =========================
  // HOTKEYS (Shift+R, Shift+E)
  // =========================
  function shouldIgnoreKey(e) {
    const el = e.target;
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    return tag === "input" || tag === "select" || tag === "textarea" || el.isContentEditable;
  }

  function onKeyDown(e) {
    if (shouldIgnoreKey(e)) return;

    // Shift+R = record toggle
    if (e.shiftKey && (e.key === "R" || e.key === "r")) {
      e.preventDefault();
      toggleRecording();
      return;
    }

    // Shift+E = export wav
    if (e.shiftKey && (e.key === "E" || e.key === "e")) {
      e.preventDefault();
      renderWavExport();
      return;
    }
  }

  // =========================
  // BACKGROUND EVENTS (B1)
  // =========================
  function onVisibilityChange() {
    if (document.hidden) {
      enterBackgroundMode();
    } else {
      exitBackgroundMode();
    }
  }

  // iOS can fire these too
  function onPageHide() { enterBackgroundMode(); }
  function onBlur() {
    // blur can happen from UI overlays; only enter bed if actually hidden
    if (document.hidden) enterBackgroundMode();
  }

  // =========================
  // DOM READY
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    applyModeClasses();
    window.addEventListener("hashchange", applyModeClasses);

    const playBtn = document.getElementById("playNow");
    const stopBtn = document.getElementById("stop");

    if (playBtn) playBtn.addEventListener("click", () => startFromUI(false));
    if (stopBtn) stopBtn.addEventListener("click", stopAllManual);

    // Persist controls
    applyControls(loadState());
    document.getElementById("tone")?.addEventListener("input", (e) => {
      const v = e.target?.value ?? "110";
      const out = document.getElementById("hzReadout");
      if (out) out.textContent = String(v);
      saveState(readControls());
    });
    document.getElementById("songDuration")?.addEventListener("change", () => saveState(readControls()));

    // Launch
    document.getElementById("launchPlayer")?.addEventListener("click", launchPlayer);

    // Popout default state
    if (isPopoutMode()) {
      document.body.classList.add("popout");
      setButtonState("stopped");
    }

    // Hotkeys
    document.addEventListener("keydown", onKeyDown);

    // Background/foreground
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("blur", onBlur);

    // Initial UI state
    setButtonState("stopped");
  });
})();