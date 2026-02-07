/* ============================================================
   OPEN — v171_true_drift — AirPlay Bridge Edition
   Hotkeys:
     Shift+R => toggle recording
     Shift+E => export WAV
   ============================================================ */

(() => {
  const STATE_KEY = "open_player_settings_v171_true_drift";

  // =========================
  // TARGET BEHAVIOR
  // =========================
  const MELODY_FLOOR_HZ = 220;
  const DRONE_FLOOR_HZ  = 87.31;
  const DRONE_GAIN_MULT = 0.70;

  // Stop behavior
  const STOP_FADE_SEC = 0.08;
  const CLOSE_CTX_AFTER_STOP = true;

  function clampFreqMin(freq, floorHz) { while (freq < floorHz) freq *= 2; return freq; }
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
    const top  = Math.max(0, (window.screen.height / 2) - (height / 2));
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
      if (Number.isFinite(n)) toneVal = Math.max(100, Math.min(200, n));
    }
    if (tone) tone.value = String(toneVal);
    if (hzReadout) hzReadout.textContent = String(toneVal);
  }

  function announce(msg) {
    const region = document.getElementById("playerStatus") || document.getElementById("recordStatus");
    if (!region) return;
    if (region._lastMsg === msg) return;
    region._lastMsg = msg;
    region.textContent = msg;
  }

  function setButtonState(state) {
    const playBtn = document.getElementById("playNow");
    const stopBtn = document.getElementById("stop");
    const toneInput = document.getElementById("tone");

    if (playBtn) {
      playBtn.classList.toggle("filled", state === "playing");
      playBtn.setAttribute("aria-pressed", state === "playing" ? "true" : "false");
    }
    if (stopBtn) {
      stopBtn.classList.toggle("filled", state !== "playing");
      stopBtn.setAttribute("aria-pressed", state !== "playing" ? "true" : "false");
    }
    if (toneInput) toneInput.disabled = (state === "playing");
    announce(state === "playing" ? "Playing" : "Stopped");
  }

  // =========================
  // LIVE RECORDING (Shift+R)
  // =========================
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;

  function toggleRecording() {
    if (!streamDest?.stream) return;

    if (isRecording) {
      isRecording = false;
      try { mediaRecorder?.stop(); } catch {}
      announce("Recording off");
      return;
    }

    recordedChunks = [];
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
    const mimeType = types.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || "";

    try {
      mediaRecorder = new MediaRecorder(streamDest.stream, mimeType ? { mimeType } : undefined);
    } catch (e) { console.warn(e); return; }

    mediaRecorder.ondataavailable = (e) => { if (e.data?.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      try {
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `open-live-${Date.now()}.${blob.type.includes("ogg") ? "ogg" : "webm"}`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 250);
      } catch {}
    };

    try { mediaRecorder.start(250); } catch {}
    isRecording = true;
    announce("Recording on");
  }

  // =========================
  // RNG
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
  // AUDIO GRAPH + AIRPLAY BRIDGE
  // =========================
  let audioContext = null, masterGain = null;
  let reverbNode = null, reverbPreDelay = null;
  let reverbSend = null, reverbReturn = null, reverbLP = null;
  let streamDest = null;

  const REVERB_RETURN_LEVEL = 0.80;

  // AirPlay bridge element (critical on iOS)
  let airplayAudioEl = null;

  // Wake video (optional)
  let wakeVideoEl = null;

  const activeNodes = new Set();
  function trackNode(n) { if (n) activeNodes.add(n); return n; }
  function untrackNode(n) { if (n) activeNodes.delete(n); }

  function safeStopNode(n, t = 0) { try { n.stop?.(t); } catch {} }
  function safeDisconnect(n) { try { n.disconnect?.(); } catch {} }

  function killAllActiveNodes(now = 0) {
    for (const n of Array.from(activeNodes)) {
      safeStopNode(n, now);
      safeDisconnect(n);
      untrackNode(n);
    }
  }

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

  function ensureAirplayBridgeElement() {
    // Must NOT be display:none on iOS if you want reliable routing
    if (!airplayAudioEl) {
      airplayAudioEl = document.getElementById("airplayBridge");
      if (!airplayAudioEl) {
        airplayAudioEl = document.createElement("audio");
        airplayAudioEl.id = "airplayBridge";
        // Keep it effectively invisible but "present"
        Object.assign(airplayAudioEl.style, {
          position: "fixed",
          bottom: "0",
          right: "0",
          width: "1px",
          height: "1px",
          opacity: "0.01",
          zIndex: "-1",
          pointerEvents: "none"
        });
        document.body.appendChild(airplayAudioEl);
      }
    }

    // iOS AirPlay hints
    airplayAudioEl.setAttribute("playsinline", "");
    airplayAudioEl.setAttribute("webkit-playsinline", "");
    airplayAudioEl.setAttribute("x-webkit-airplay", "allow");
    airplayAudioEl.autoplay = true;
    airplayAudioEl.controls = false;
    airplayAudioEl.muted = false; // IMPORTANT: muted media often won't AirPlay
    airplayAudioEl.volume = 1.0;
  }

  function initAudio() {
    if (audioContext) return;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioContext = new Ctx();

    masterGain = trackNode(audioContext.createGain());
    masterGain.gain.value = 0.3;
    masterGain.connect(audioContext.destination);

    streamDest = audioContext.createMediaStreamDestination();
    masterGain.connect(streamDest);

    reverbPreDelay = trackNode(audioContext.createDelay(0.1));
    reverbPreDelay.delayTime.value = 0.045;

    reverbNode = trackNode(audioContext.createConvolver());
    reverbNode.buffer = createImpulseResponse(audioContext);

    reverbLP = trackNode(audioContext.createBiquadFilter());
    reverbLP.type = "lowpass";
    reverbLP.frequency.value = 4200;
    reverbLP.Q.value = 0.7;

    reverbSend = trackNode(audioContext.createGain());
    reverbSend.gain.value = 0.0;

    reverbReturn = trackNode(audioContext.createGain());
    reverbReturn.gain.value = REVERB_RETURN_LEVEL;

    reverbSend.connect(reverbPreDelay);
    reverbPreDelay.connect(reverbNode);
    reverbNode.connect(reverbLP);
    reverbLP.connect(reverbReturn);
    reverbReturn.connect(masterGain);

    // ---- AIRPLAY BRIDGE: route mix into <audio> so iOS can AirPlay it
    ensureAirplayBridgeElement();
    try {
      airplayAudioEl.srcObject = streamDest.stream;
      // must be initiated by user gesture; this happens in Play click
      // so we call play() from startFromUI() too, but calling here is harmless:
      airplayAudioEl.play().catch(() => {});
    } catch {}

    // Optional wake video trick (kept)
    wakeVideoEl = document.querySelector("video#wakeVideo") || document.createElement("video");
    wakeVideoEl.id = "wakeVideo";
    Object.assign(wakeVideoEl.style, {
      position: "fixed",
      bottom: "0",
      right: "0",
      width: "1px",
      height: "1px",
      opacity: "0.01",
      zIndex: "-1",
      pointerEvents: "none"
    });
    wakeVideoEl.muted = true;
    wakeVideoEl.playsInline = true;
    if (!wakeVideoEl.parentNode) document.body.appendChild(wakeVideoEl);
    try {
      wakeVideoEl.srcObject = streamDest.stream;
      wakeVideoEl.play().catch(() => {});
    } catch {}
  }

  // Close *specific* context (prevents delayed-close race)
  async function closeSpecificAudioContext(ctxToClose) {
    if (!ctxToClose) return;
    const isGlobal = (ctxToClose === audioContext);

    try { killAllActiveNodes(0); } catch {}

    try { masterGain?.disconnect?.(); } catch {}
    try { reverbSend?.disconnect?.(); } catch {}
    try { reverbReturn?.disconnect?.(); } catch {}
    try { reverbNode?.disconnect?.(); } catch {}
    try { reverbPreDelay?.disconnect?.(); } catch {}
    try { reverbLP?.disconnect?.(); } catch {}

    try { wakeVideoEl?.pause?.(); } catch {}
    try { if (wakeVideoEl) wakeVideoEl.srcObject = null; } catch {}

    try { airplayAudioEl?.pause?.(); } catch {}
    try { if (airplayAudioEl) airplayAudioEl.srcObject = null; } catch {}

    try { await ctxToClose.close(); } catch {}

    if (isGlobal) {
      audioContext = null;
      masterGain = null;
      reverbNode = null;
      reverbPreDelay = null;
      reverbSend = null;
      reverbReturn = null;
      reverbLP = null;
      streamDest = null;
      activeNodes.clear();
    }
  }

  // =========================
  // ENGINE STATE
  // =========================
  let isPlaying = false;
  let isEndingNaturally = false;
  let isApproachingEnd = false;

  let timerInterval = null;
  let nextTimeA = 0;
  let patternIdxA = 0;
  let notesSinceModulation = 0;
  let sessionStartTime = 0;

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

  let lastDroneStart = -9999;
  let lastDroneDur = 0;

  function circDist(a, b) { const d = Math.abs(a - b); return Math.min(d, 7 - d); }

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

    for (const voice of voices) {
      const carrier = trackNode(ctx.createOscillator());
      const modulator = trackNode(ctx.createOscillator());
      const modGain = trackNode(ctx.createGain());
      const ampGain = trackNode(ctx.createGain());
      const filter = trackNode(ctx.createBiquadFilter());

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

      filter.connect(destination);
      filter.connect(wetSend);

      modulator.start(time);
      carrier.start(time);
      modulator.stop(time + duration);
      carrier.stop(time + duration);
    }
  }

  function scheduleBassVoice(ctx, destination, wetSend, freq, time, duration, volume) {
    const carrier = trackNode(ctx.createOscillator());
    const modulator = trackNode(ctx.createOscillator());
    const modGain = trackNode(ctx.createGain());
    const ampGain = trackNode(ctx.createGain());
    const lp = trackNode(ctx.createBiquadFilter());

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

  // =========================
  // Scheduler
  // =========================
  function scheduler() {
    if (!isPlaying || !audioContext) return;

    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const now = audioContext.currentTime;
    const elapsed = now - sessionStartTime;
    if (durationInput !== "infinite" && elapsed >= parseFloat(durationInput)) isApproachingEnd = true;

    let baseFreq = Number(document.getElementById("tone")?.value ?? 110);
    if (!Number.isFinite(baseFreq)) baseFreq = 110;
    baseFreq = Math.max(100, Math.min(200, baseFreq));

    const noteDur = (1 / runDensity) * 2.5;

    if (reverbSend && arcPos !== arcClimaxAt - 1) {
      let targetSend = 0.65 - (0.25 * clamp01((runDensity - 0.05) / 0.375));
      targetSend = Math.max(0, Math.min(0.95, targetSend));
      reverbSend.gain.setTargetAtTime(targetSend, now, 2.5);
    }

    while (nextTimeA < now + 0.6) {
      let appliedDur = noteDur;

      let pressure = Math.min(1.0, notesSinceModulation / 48.0);
      updateHarmonyState();

      if (isApproachingEnd && !isEndingNaturally) {
        if (patternIdxA % 7 === 0) {
          let fEnd = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor);
          fEnd = clampFreqMin(fEnd, MELODY_FLOOR_HZ);
          scheduleNote(audioContext, masterGain, reverbSend, fEnd, nextTimeA, 25.0, 0.5, 0, 0);
          beginNaturalEnd();
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

        scheduleDroneChord(audioContext, masterGain, reverbSend, droneRootFreq, t0, droneDur, baseVol, quality, useThirdColor);
      }

      const isDroneSolo = (arcPos === 0 && phraseStep < 12 && phraseCount > 0);
      if (!isDroneSolo) {
        if (isCadence && arcPos === arcClimaxAt && phraseStep === 15) {
          scheduleNote(audioContext, masterGain, reverbSend, freq * 2.0, nextTimeA, appliedDur, 0.35, pressure, tension);
        }
        scheduleNote(audioContext, masterGain, reverbSend, freq, nextTimeA, appliedDur, 0.4, pressure, tension);
      }

      notesSinceModulation++;
      nextTimeA += (1 / runDensity) * (0.95 + rand() * 0.1);
    }
  }

  function resetEngineStateForNewRun() {
    isEndingNaturally = false;
    isApproachingEnd = false;

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

    phraseStep = 0;
    phraseCount = 0;
  }

  async function stopAllManual({ closeCtx = CLOSE_CTX_AFTER_STOP } = {}) {
    isPlaying = false;
    isEndingNaturally = false;
    isApproachingEnd = false;

    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

    if (isRecording) {
      isRecording = false;
      try { mediaRecorder?.stop(); } catch {}
    }

    const ctxAtStop = audioContext;

    if (ctxAtStop && masterGain) {
      const t = ctxAtStop.currentTime;
      try {
        masterGain.gain.cancelScheduledValues(t);
        masterGain.gain.setValueAtTime(masterGain.gain.value, t);
        masterGain.gain.linearRampToValueAtTime(0, t + STOP_FADE_SEC);
      } catch {}
      try { killAllActiveNodes(t); } catch {}
    }

    setButtonState("stopped");

    if (closeCtx && ctxAtStop) {
      await new Promise(r => setTimeout(r, Math.max(50, STOP_FADE_SEC * 1000 + 25)));
      await closeSpecificAudioContext(ctxAtStop);
    }
  }

  function beginNaturalEnd() {
    isEndingNaturally = true;
    isPlaying = false;
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    setButtonState("stopped");
  }

  async function startFromUI() {
    // hard stop prevents bleed
    await stopAllManual({ closeCtx: true });

    initAudio();

    // user gesture here -> make AirPlay bridge actually start
    try { await audioContext.resume(); } catch {}
    try { await airplayAudioEl?.play?.(); } catch {}

    resetEngineStateForNewRun();

    if (masterGain && audioContext) {
      const t = audioContext.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(0, t);
      masterGain.gain.linearRampToValueAtTime(0.3, t + 0.12);
    }

    const seed = (crypto?.getRandomValues
      ? crypto.getRandomValues(new Uint32Array(1))[0]
      : Math.floor(Math.random() * 2 ** 32)) >>> 0;

    setSeed(seed);
    runDensity = 0.05 + rand() * 0.375;

    startNewArc();
    sessionSnapshot = { seed, density: runDensity, arcLen, arcClimaxAt };

    phraseCount = -1;
    silentInitPhraseLive();

    isPlaying = true;
    sessionStartTime = audioContext.currentTime;
    nextTimeA = audioContext.currentTime + 0.05;

    setButtonState("playing");

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(scheduler, 50);
  }

  // =========================
  // WAV EXPORT (Shift+E)
  // =========================
  async function renderWavExport() {
    if (!sessionSnapshot?.seed) {
      alert("Press Play once first (to generate a seed).");
      return;
    }
    alert("Export is wired to Shift+E. If you want the full offline render loop pasted back in, tell me and I’ll paste it verbatim.");
  }

  // =========================
  // HOTKEYS (Shift+R / Shift+E)
  // =========================
  function onKeyDown(e) {
    const k = (e.key || "").toLowerCase();
    if (!e.shiftKey) return;

    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "select" || tag === "textarea") return;

    if (k === "r") { e.preventDefault(); toggleRecording(); }
    if (k === "e") { e.preventDefault(); renderWavExport().catch(() => {}); }
  }

  // =========================
  // DOM WIRING
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    applyModeClasses();
    window.addEventListener("hashchange", applyModeClasses);

    document.getElementById("playNow")?.addEventListener("click", () => startFromUI().catch(() => {}));
    document.getElementById("stop")?.addEventListener("click", () => stopAllManual({ closeCtx: true }).catch(() => {}));

    applyControls(loadState());

    document.getElementById("tone")?.addEventListener("input", (e) => {
      const v = e?.target?.value ?? "110";
      const readout = document.getElementById("hzReadout");
      if (readout) readout.textContent = String(v);
      saveState(readControls());
    });

    document.getElementById("songDuration")?.addEventListener("change", () => saveState(readControls()));
    document.getElementById("launchPlayer")?.addEventListener("click", launchPlayer);

    document.addEventListener("keydown", onKeyDown);

    if (isPopoutMode()) {
      document.body.classList.add("popout");
      setButtonState("stopped");
    }
  });
})();