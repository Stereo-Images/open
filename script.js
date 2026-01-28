(() => {
  const STATE_KEY = "open_player_settings_v141";

  // =========================
  // VIEW & STATE
  // =========================
  function isPopoutMode() { return window.location.hash === "#popout"; }
  function isMobileDevice() {
    const ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod|Android/i.test(ua) ||
      (window.matchMedia?.("(pointer: coarse)")?.matches && window.matchMedia?.("(max-width: 820px)")?.matches);
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

    const width = 500;
    const height = 680;
    const left = Math.max(0, (window.screen.width / 2) - (width / 2));
    const top = Math.max(0, (window.screen.height / 2) - (height / 2));

    window.open(
      `${window.location.href.split("#")[0]}#popout`,
      "open_player",
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no,status=no`
    );
  }

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch { return null; }
  }
  function saveState(state) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
  }

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
      // UPDATED: Logic matches HTML range (100-200)
      if (Number.isFinite(n)) toneVal = Math.max(100, Math.min(200, n));
    }

    if (tone) tone.value = String(toneVal);
    if (hzReadout) hzReadout.textContent = String(toneVal);
  }

  function setButtonState(state) {
    const playBtn = document.getElementById("playNow");
    const stopBtn = document.getElementById("stop");
    const toneInput = document.getElementById("tone");

    if (playBtn) playBtn.classList.toggle("filled", state !== "playing");
    if (stopBtn) stopBtn.classList.toggle("filled", state === "playing");

    if (toneInput) toneInput.disabled = (state === "playing");
  }

  // =========================
  // LIVE RECORDING
  // =========================
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;

  function pickRecordingMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg"
    ];
    for (const t of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
    }
    return "";
  }

  function startRecording() {
    if (!streamDest?.stream) return;
    if (!window.MediaRecorder) { alert("Recording not supported."); return; }
    if (isRecording) return;

    recordedChunks = [];
    const mimeType = pickRecordingMimeType();

    try {
      mediaRecorder = new MediaRecorder(streamDest.stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      console.warn("Recorder init failed:", e);
      return;
    }

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      const url = URL.createObjectURL(blob);
      const ext = blob.type.includes("ogg") ? "ogg" : "webm";

      const a = document.createElement("a");
      a.href = url;
      a.download = `open-live-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    };

    mediaRecorder.start(250);
    isRecording = true;
    updateRecordStatusUI();
  }

  function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    isRecording = false;
    try { mediaRecorder.stop(); } catch {}
    updateRecordStatusUI();
  }

  function toggleRecording() {
    if (isRecording) stopRecording();
    else startRecording();
  }

  function updateRecordStatusUI() {
    const el = document.getElementById("recordStatus");
    if (!el) return;
    if (isRecording) {
      el.textContent = "Recording: ON";
      el.classList.add("recording-on");
    } else {
      el.textContent = "Recording: off";
      el.classList.remove("recording-on");
    }
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
  // AUDIO GRAPH & STATE
  // =========================
  let audioContext = null;
  let masterGain = null;
  let reverbNode = null, reverbPreDelay = null;
  let reverbSend = null, reverbReturn = null, reverbLP = null;
  let streamDest = null;

  const REVERB_RETURN_LEVEL = 0.80;

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

  let sessionMotif = [];
  let motifPos = 0;
  let phraseStep = 0;
  let pendingLTResolution = false;

  let arcLen = 6;
  let arcPos = 0;
  let arcClimaxAt = 4;
  let tension = 0.0;
  let lastCadenceType = "none";
  let currentCadenceType = "none";

  function createImpulseResponse(ctx) {
    const duration = 10.0, decay = 2.8, rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    const r = rngStream(0xC0FFEE);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const n = (r() * 2 - 1);
        data[i] = n * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  function circDist(a, b) {
    const d = Math.abs(a - b);
    return Math.min(d, 7 - d);
  }
  function clamp01(x){ return Math.max(0, Math.min(1, x)); }

  function startNewArc() {
    arcLen = 4 + Math.floor(rand() * 5);
    arcClimaxAt = Math.max(2, arcLen - 2 - Math.floor(rand() * 2));
    arcPos = 0;
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
    w.authentic += tension * 0.25; w.deceptive += tension * 0.10; w.evaded -= tension * 0.18; w.half -= tension * 0.08;

    if (nearClimax) { w.authentic += 0.25; w.deceptive += 0.10; w.evaded -= 0.20; w.half -= 0.10; }
    if (lateArc && tension > 0.45) { w.authentic += 0.22; w.evaded -= 0.15; w.half -= 0.05; }
    if (isMinor) { w.deceptive += 0.05; w.plagal -= 0.02; }

    for (const k of Object.keys(w)) w[k] = Math.max(0.001, w[k] - cadenceRepeatPenalty(k));
    const keys = Object.keys(w);
    const sum = keys.reduce((a,k)=>a+w[k],0);
    let r = rand() * sum;
    for (const k of keys) { r -= w[k]; if (r <= 0) return k; }
    return "authentic";
  }

  function cadenceTargets(type) {
    switch(type){
      case "authentic":  return { pre: 6, end: 0, wantLT: true  };
      case "half":       return { pre: 1, end: 4, wantLT: false };
      case "plagal":     return { pre: 3, end: 0, wantLT: false };
      case "deceptive":  return { pre: 6, end: 5, wantLT: true  };
      case "evaded":     return { pre: 6, end: 2, wantLT: true  };
      default:           return { pre: 2, end: 0, wantLT: false };
    }
  }

  function initAudio() {
    if (audioContext) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioContext = new Ctx();

    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(audioContext.destination);

    streamDest = audioContext.createMediaStreamDestination();
    masterGain.connect(streamDest);

    reverbPreDelay = audioContext.createDelay(0.1);
    reverbPreDelay.delayTime.value = 0.045;
    reverbNode = audioContext.createConvolver();
    reverbNode.buffer = createImpulseResponse(audioContext);
    reverbLP = audioContext.createBiquadFilter();
    reverbLP.type = "lowpass";
    reverbLP.frequency.value = 4200;
    reverbLP.Q.value = 0.7;
    reverbSend = audioContext.createGain();
    reverbSend.gain.value = 0.0;
    reverbReturn = audioContext.createGain();
    reverbReturn.gain.value = REVERB_RETURN_LEVEL;

    reverbSend.connect(reverbPreDelay);
    reverbPreDelay.connect(reverbNode);
    reverbNode.connect(reverbLP);
    reverbLP.connect(reverbReturn);
    reverbReturn.connect(masterGain);

    const silent = audioContext.createBuffer(1, 1, audioContext.sampleRate);
    const heartbeat = audioContext.createBufferSource();
    heartbeat.buffer = silent;
    heartbeat.loop = true;
    heartbeat.start();
    heartbeat.connect(audioContext.destination);

    let videoWakeLock = document.querySelector("video");
    if (!videoWakeLock) {
      videoWakeLock = document.createElement("video");
      Object.assign(videoWakeLock.style, {
        position: "fixed", bottom: "0", right: "0", width: "1px", height: "1px",
        opacity: "0.01", pointerEvents: "none", zIndex: "-1"
      });
      videoWakeLock.setAttribute("playsinline", "");
      videoWakeLock.setAttribute("muted", "");
      document.body.appendChild(videoWakeLock);
    }
    videoWakeLock.srcObject = streamDest.stream;
    videoWakeLock.play().catch(() => {});
  }

  function scheduleNote(ctx, destination, wetSend, freq, time, duration, volume, instability = 0, tensionAmt = 0) {
    const numVoices = 2 + Math.floor(rand() * 2);
    let totalAmp = 0;
    const isFractured = (tensionAmt > 0.75);
    const FRACTURE_RATIOS = [Math.SQRT2, 1.618, 2.414, 2.718, 3.1415];
    const ratioFuzz = isFractured ? 0.08 : 0.0;

    const voices = Array.from({length: numVoices}, () => {
      let mRatio;
      if (isFractured) {
        mRatio = FRACTURE_RATIOS[Math.floor(rand() * FRACTURE_RATIOS.length)];
        mRatio += (rand() - 0.5) * ratioFuzz;
      } else {
        mRatio = 1.5 + rand() * 2.5;
      }
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

      carrier.type = "sine";
      modulator.type = "sine";

      const driftMult = isFractured ? 18 : 12;
      const drift = (rand() - 0.5) * (2 + (instability * driftMult));

      carrier.frequency.value = freq + drift;
      modulator.frequency.value = freq * voice.modRatio;

      modGain.gain.setValueAtTime(freq * voice.modIndex, time);
      modGain.gain.exponentialRampToValueAtTime(freq * 0.01, time + (duration * 0.7));

      ampGain.gain.setValueAtTime(0.0001, time);
      const atk = isFractured ? 0.005 : 0.01;
      ampGain.gain.exponentialRampToValueAtTime((voice.amp / totalAmp) * volume, time + atk);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(ampGain);
      ampGain.connect(destination);
      ampGain.connect(wetSend);

      modulator.start(time);
      carrier.start(time);
      modulator.stop(time + duration);
      carrier.stop(time + duration);
    });
  }

  // --- UPDATED BASS PEDAL (Polished FM) ---
  function scheduleBassPedal(ctx, destination, wetSend, freq, time, duration, volume) {
    const isDrone = (duration > 20.0);

    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const modGain = ctx.createGain();
    const ampGain = ctx.createGain();
    const lp = ctx.createBiquadFilter();

    carrier.type = "sine";
    modulator.type = "sine";

    if (isDrone) {
      // DRONE: Fixed Octave (2.0) + Micro-detune
      carrier.frequency.value = freq;
      modulator.frequency.value = freq * 2.0;
      modulator.detune.value = (rand() - 0.5) * 6; // +/- 6 cents
    } else {
      // PEDAL: Gritty
      carrier.frequency.value = freq + (rand() - 0.5) * 0.6;
      modulator.frequency.value = freq * (1.25 + rand() * 0.25);
    }

    if (isDrone) {
      // FM BLOOM: Reduced intensity
      modGain.gain.setValueAtTime(0, time);
      modGain.gain.linearRampToValueAtTime(freq * 0.6, time + (duration * 0.5));
      modGain.gain.linearRampToValueAtTime(0, time + duration);
    } else {
      // PLUCK
      modGain.gain.setValueAtTime(freq * (0.35 + rand() * 0.25), time);
      modGain.gain.exponentialRampToValueAtTime(freq * 0.12, time + Math.max(0.5, duration));
    }

    ampGain.gain.setValueAtTime(0.0001, time);
    if (isDrone) {
      ampGain.gain.exponentialRampToValueAtTime(volume, time + 4.0);
    } else {
      ampGain.gain.exponentialRampToValueAtTime(volume, time + 0.15);
    }
    ampGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    lp.type = "lowpass";
    if (isDrone) {
      lp.frequency.setValueAtTime(350, time);
      lp.Q.value = 0.5;
    } else {
      lp.frequency.setValueAtTime(220 + rand() * 80, time);
      lp.Q.setValueAtTime(0.7, time);
    }

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

  function getScaleNote(baseFreq, scaleIndex, circlePos, minorMode, opts = {}) {
    let pos = circlePos % 12; if (pos < 0) pos += 12;
    const semitones = (pos * 7) % 12;
    let rootOffset = semitones;
    if (minorMode) rootOffset = (semitones + 9) % 12;

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

  function generateSessionMotif() {
    const m = [0];
    let walker = 0;
    for (let i = 0; i < 3; i++) {
      walker += (rand() < 0.5 ? 1 : -1) * (rand() < 0.4 ? 2 : 1);
      m.push(walker);
    }
    return m;
  }

  function updateHarmonyState(durationInput) {
    const r = rand();
    let pressure = Math.min(1.0, notesSinceModulation / 48.0);
    if (arcPos === arcClimaxAt) pressure *= 2.5;
    if (arcPos <= 1) pressure *= 0.2;
    if (tension > 0.6) pressure *= 1.5;
    pressure = Math.min(1.0, pressure);

    const modChance = pressure * 0.35;
    if (r < modChance) {
      if (arcPos === arcClimaxAt && chance(0.6)) {
        if (!isMinor) isMinor = true;
        else circlePosition += (chance(0.5) ? 1 : -1);
      } else if (isApproachingEnd) {
        if (circlePosition > 0) circlePosition--;
        else if (circlePosition < 0) circlePosition++;
        else if (isMinor && chance(0.6)) isMinor = false;
      } else {
        const isJourneyMode = (durationInput === "infinite");
        const dist = Math.abs(circlePosition);
        if (!isJourneyMode && dist > 3 && chance(0.8)) {
          circlePosition += (circlePosition > 0 ? -1 : 1);
        } else {
          if (chance(0.3)) isMinor = !isMinor;
          else circlePosition += (chance(0.5) ? 1 : -1);
        }
      }
      notesSinceModulation = 0;
    }
  }

  function scheduler() {
    if (!isPlaying) return;

    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const now = audioContext.currentTime;
    const elapsed = now - sessionStartTime;

    if (durationInput !== "infinite") {
      const targetDuration = parseFloat(durationInput);
      if (elapsed >= targetDuration) isApproachingEnd = true;
    }

    // --- FREQUENCY CLAMP (MATCHES HTML 100-200) ---
    let baseFreq = Number(document.getElementById("tone")?.value ?? 110);
    if (!Number.isFinite(baseFreq)) baseFreq = 110;
    baseFreq = Math.max(100, Math.min(200, baseFreq));
    // ----------------------------------------------

    const noteDur = (1 / runDensity) * 2.5;

    if (reverbSend && arcPos !== arcClimaxAt - 1) {
      let tickPressure = Math.min(1.0, notesSinceModulation / 48.0);
      if (arcPos === arcClimaxAt) tickPressure *= 2.5;
      if (arcPos <= 1) tickPressure *= 0.2;
      if (tension > 0.6) tickPressure *= 1.5;
      tickPressure = Math.min(1.0, tickPressure);

      const normDensity = clamp01((runDensity - 0.05) / 0.375);
      const normTension = clamp01(tension);
      const normPressure = clamp01(tickPressure);

      let targetSend = 0.65 - (0.25 * normDensity) + (normTension * 0.55) - (0.10 * normPressure);
      targetSend = Math.max(0, Math.min(0.95, targetSend));
      reverbSend.gain.setTargetAtTime(targetSend, now, 2.5);
    }

    while (nextTimeA < now + 0.5) {
      let appliedDur = noteDur;
      let clearPendingAfterNote = false;

      let pressure = Math.min(1.0, notesSinceModulation / 48.0);
      if (arcPos === arcClimaxAt) pressure *= 2.5;
      if (arcPos <= 1) pressure *= 0.2;
      if (tension > 0.6) pressure *= 1.5;
      pressure = Math.min(1.0, pressure);

      updateHarmonyState(durationInput);

      if (isApproachingEnd && !isEndingNaturally) {
        if (patternIdxA % 7 === 0) {
          const freq = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor);
          scheduleNote(audioContext, masterGain, reverbSend, freq * 0.5, nextTimeA, 25.0, 0.5, 0, 0);
          beginNaturalEnd();
          return;
        }
      }

      phraseStep = (phraseStep + 1) % 16;
      if (phraseStep === 0) {
        pendingLTResolution = false;
        arcPos = (arcPos + 1);
        if (arcPos >= arcLen) startNewArc();
        currentCadenceType = pickCadenceTypeForPhrase();
      }

      const isCadence = (phraseStep >= 13);

      if (reverbSend && arcPos === arcClimaxAt - 1) {
        if (phraseStep === 13) {
          reverbSend.gain.cancelScheduledValues(nextTimeA);
          reverbSend.gain.setValueAtTime(reverbSend.gain.value, nextTimeA);
          reverbSend.gain.setTargetAtTime(0.0, nextTimeA, 0.02);
        } else if (phraseStep === 14) {
          const normDensity = clamp01((runDensity - 0.05) / 0.375);
          const normTension = clamp01(tension);
          const normPressure = clamp01(pressure);
          let base = 0.65 - (0.25 * normDensity) + (normTension * 0.55) - (0.10 * normPressure);
          base = Math.max(0, Math.min(0.95, base));
          reverbSend.gain.setTargetAtTime(base, nextTimeA, 1.5);
        }
      }

      let slowProb = 0.0;
      if (phraseStep === 15) slowProb = 0.85;
      else if (phraseStep === 0) slowProb = 0.25;
      else if (phraseStep === 14) slowProb = 0.35;
      else if (phraseStep === 13) slowProb = 0.20;
      if (chance(slowProb)) appliedDur *= (1.20 + rand() * 0.20);

      // --- MELODY LOGIC (With Drone Solo Check) ---
      if (isCadence) {
        const targets = [0, 2, 4];
        const currentOctave = Math.floor(patternIdxA / 7) * 7;
        let deg = patternIdxA - currentOctave;
        deg = ((deg % 7) + 7) % 7;

        let best = targets[0];
        let bestD = circDist(deg, best);
        for (let i = 1; i < targets.length; i++) {
          const t = targets[i];
          const d = circDist(deg, t);
          if (d < bestD || (d === bestD && chance(0.5))) { best = t; bestD = d; }
        }

        const landProb = (phraseStep >= 15) ? 0.85 : 0.55;
        let targetDeg = best;
        if (!chance(landProb)) {
          const dir = chance(0.65) ? -1 : 1;
          targetDeg = (targetDeg + dir + 7) % 7;
        }

        let delta = targetDeg - deg;
        if (delta > 3) delta -= 7;
        if (delta < -3) delta += 7;
        if (Math.abs(delta) === 3) delta = chance(0.5) ? 3 : -3;
        else if (delta === 0 && phraseStep <= 14 && chance(0.18)) delta = chance(0.5) ? 1 : -1;

        patternIdxA = currentOctave + deg + delta;

        const ct = currentCadenceType;
        const targ = cadenceTargets(ct);

        if (phraseStep === 14) {
          const forcePreProb = (ct === "evaded") ? 0.35 : (ct === "half") ? 0.45 : (ct === "plagal") ? 0.50 : 0.65;
          if (chance(forcePreProb)) {
            const curOct = Math.floor(patternIdxA / 7) * 7;
            const curDeg = ((patternIdxA - curOct) % 7 + 7) % 7;
            let deltaPre = targ.pre - curDeg;
            if (deltaPre > 3) deltaPre -= 7;
            if (deltaPre < -3) deltaPre += 7;
            patternIdxA += deltaPre;
            pendingLTResolution = !!targ.wantLT;
          }
        }

        if (phraseStep === 15) {
          const baseProb = (ct === "evaded") ? (0.35 + tension * 0.20) : (ct === "half") ? 0.78 : (ct === "plagal") ? 0.74 : (ct === "deceptive") ? 0.86 : 0.90;
          const finalProb = pendingLTResolution ? Math.min(0.98, baseProb + 0.06) : baseProb;
          if (chance(finalProb)) {
            const curOct = Math.floor(patternIdxA / 7) * 7;
            const curDeg = ((patternIdxA - curOct) % 7 + 7) % 7;
            let deltaEnd = targ.end - curDeg;
            if (deltaEnd > 3) deltaEnd -= 7;
            if (deltaEnd < -3) deltaEnd += 7;
            patternIdxA += deltaEnd;
          }
          if (ct === "evaded") tension = clamp01(tension + 0.18);
          else if (ct === "half") tension = clamp01(tension + 0.08);
          else if (ct === "deceptive") tension = clamp01(tension + 0.06);
          else if (ct === "plagal") tension = clamp01(tension - 0.10);
          else if (ct === "authentic") tension = clamp01(tension - 0.22);
          lastCadenceType = ct;
          clearPendingAfterNote = true;
        }
      } else {
        const useMotif = chance(0.25);
        if (useMotif && sessionMotif.length > 0) {
          const motifInterval = sessionMotif[motifPos];
          const currentOctave = Math.floor(patternIdxA / 7) * 7;
          patternIdxA = currentOctave + motifInterval;
          motifPos = (motifPos + 1) % sessionMotif.length;
        } else {
          const r = rand();
          let shift = 0;
          if (r < 0.50) shift = 1;
          else if (r < 0.82) shift = -1;
          else shift = chance(0.65) ? 2 : -2;
          patternIdxA += shift;
        }
      }

      if (!isCadence) {
        const anchor = 1;
        const reg = Math.floor(patternIdxA / 7);
        if (reg < anchor && chance(0.22)) patternIdxA += 1;
        else if (reg > anchor && chance(0.22)) patternIdxA -= 1;
      }

      if (patternIdxA > 10) patternIdxA = 10;
      if (patternIdxA < -4) patternIdxA = -4;

      const degNow = ((patternIdxA - Math.floor(patternIdxA / 7) * 7) % 7 + 7) % 7;
      const wantLT = cadenceTargets(currentCadenceType).wantLT;
      const raiseLT = isCadence && wantLT && degNow === 6 && (phraseStep === 13 || phraseStep === 14 || pendingLTResolution);

      let freq = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor, { raiseLeadingTone: raiseLT });

      // --- SIGNPOST & DRONE LOGIC ---
      const isArcStart = (arcPos === 0 && phraseStep === 0);
      const isClimax = (arcPos === arcClimaxAt && phraseStep === 0);
      const isDroneSolo = (arcPos === 0 && phraseStep < 12); // Mute bells at start of Arc

      const atPhraseStart = (phraseStep === 0 || phraseStep === 1);
      const atCadenceZone = (phraseStep >= 13);
      let pedalProb = 0.0;
      if (atPhraseStart) pedalProb = 0.16;
      else if (atCadenceZone) pedalProb = 0.10 + (tension * 0.05);
      else pedalProb = 0.03;

      const curRegister = Math.floor(patternIdxA / 7);
      if (curRegister >= 2) pedalProb *= 0.35;

      if (isArcStart || isClimax || chance(pedalProb)) {
        const planType = currentCadenceType || "authentic";
        let pedalDegree = 0;
        
        if (isArcStart || isClimax) {
          pedalDegree = 0; // Force root
        } else {
          if (planType === "half") pedalDegree = 4;
          else if (planType === "deceptive") pedalDegree = chance(0.6) ? 0 : 5;
        }

        const pedalOct = Math.min(curRegister - 1, 0);
        const pedalIdx = pedalOct * 7 + pedalDegree;
        let pedalFreq = getScaleNote(baseFreq, pedalIdx, circlePosition, isMinor);
        
        if (isArcStart) {
           while (pedalFreq > 65) pedalFreq *= 0.5; // Deep sub
        } else {
           while (pedalFreq < 50) pedalFreq *= 2;
           while (pedalFreq > 110) pedalFreq *= 0.5;
        }
        
        const t0 = Math.max(nextTimeA - 0.05, audioContext.currentTime);
        let pedalDur = atPhraseStart ? 16.0 : (atCadenceZone ? 12.0 : 7.0);
        
        if (isArcStart) pedalDur = 32.0; 
        if (isClimax) pedalDur = 24.0;

        const vol = (isArcStart || isClimax) ? 0.25 : 0.18;

        scheduleBassPedal(audioContext, masterGain, reverbSend, pedalFreq, t0, pedalDur, vol);
      }

      // --- SCHEDULE MELODY (unless in Solo Mode) ---
      if (!isDroneSolo) {
          if (isCadence && arcPos === arcClimaxAt && phraseStep === 15) {
            scheduleNote(audioContext, masterGain, reverbSend, freq * 2.0, nextTimeA, appliedDur, 0.35, pressure, tension);
          }
          scheduleNote(audioContext, masterGain, reverbSend, freq, nextTimeA, appliedDur, 0.4, pressure, tension);
      }

      notesSinceModulation++;
      if (clearPendingAfterNote) pendingLTResolution = false;
      nextTimeA += (1 / runDensity) * (0.95 + rand() * 0.1);
    }
  }

  function startFromUI() {
    initAudio();
    if (audioContext.state === "suspended") audioContext.resume?.();

    if (masterGain && audioContext) {
      const t = audioContext.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(0.3, t);
    }

    const seed = (crypto?.getRandomValues
      ? crypto.getRandomValues(new Uint32Array(1))[0]
      : Math.floor(Math.random() * 2 ** 32)) >>> 0;

    setSeed(seed);
    runDensity = 0.05 + rand() * 0.375;
    sessionMotif = generateSessionMotif();
    sessionSnapshot = { seed, density: runDensity, motif: [...sessionMotif] };

    resetMusicalStateForPlay();

    isPlaying = true;
    sessionStartTime = audioContext.currentTime;
    nextTimeA = audioContext.currentTime + 0.05;
    setButtonState("playing");

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(scheduler, 50);
  }

  function stopAllManual() {
    isPlaying = false;
    isEndingNaturally = false;
    isApproachingEnd = false;
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (masterGain && audioContext) {
      const t = audioContext.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setTargetAtTime(0.0001, t, 0.02);
    }
    if (isRecording) stopRecording();
    setButtonState("stopped");
  }

  function beginNaturalEnd() {
    isEndingNaturally = true;
    isPlaying = false;
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (isRecording) stopRecording();
    setButtonState("stopped");
  }

  async function renderWavExport() {
    if (!audioContext) { alert("Press Play once first."); return; }
    if (!sessionSnapshot?.seed) { alert("Press Play once first."); return; }

    setSeed(sessionSnapshot.seed);
    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const exportDuration = (durationInput === "infinite") ? 180 : Math.min(180, parseFloat(durationInput));

    const sampleRate = 44100;
    const offlineCtx = new OfflineAudioContext(2, Math.floor(sampleRate * exportDuration), sampleRate);

    const offlineMaster = offlineCtx.createGain();
    offlineMaster.gain.value = 0.3;
    offlineMaster.connect(offlineCtx.destination);

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

    const exportDensity = sessionSnapshot.density;
    const localMotif = [...sessionSnapshot.motif];

    // --- FREQUENCY CLAMP FOR EXPORT (MATCHES HTML 100-200) ---
    let baseFreq = Number(document.getElementById("tone")?.value ?? 110);
    if (!Number.isFinite(baseFreq)) baseFreq = 110;
    baseFreq = Math.max(100, Math.min(200, baseFreq));
    // ---------------------------------------------------------

    const noteDur = (1 / exportDensity) * 2.5;

    let localCircle = 0;
    let localMinor = false;
    let localIdx = 0;
    let localTime = 0;
    let localModCount = 0;
    let localArcLen = 6;
    let localArcPos = 0;
    let localArcClimaxAt = 4;
    let localTension = 0.0;
    let localPhraseStep = 15;
    let localLastCadence = "none";
    let localCadenceType = "none";
    let localMotifPos = 0;
    let localPendingLT = false;

    function localStartNewArc(){
      localArcLen = 4 + Math.floor(rand() * 5);
      localArcClimaxAt = Math.max(2, localArcLen - 2 - Math.floor(rand() * 2));
      localArcPos = 0;
      localTension = Math.max(0, Math.min(1, localTension * 0.4 + 0.05));
    }
    localStartNewArc();

    function localCadenceRepeatPenalty(type){
      if (type !== localLastCadence) return 0.0;
      if (type === "authentic") return 0.30;
      return 0.18;
    }

    function localPickCadenceType(){
      const nearClimax = (localArcPos === localArcClimaxAt);
      const lateArc = (localArcPos >= localArcLen - 2);
      let w = { evaded:0.20, half:0.28, plagal:0.12, deceptive:0.18, authentic:0.22 };

      if (localArcPos < localArcClimaxAt) { w.authentic = 0.05; w.evaded += 0.2; w.half += 0.1; }
      w.authentic += localTension * 0.25; w.deceptive += localTension * 0.10; w.evaded -= localTension * 0.18; w.half -= localTension * 0.08;
      if (nearClimax) { w.authentic += 0.25; w.deceptive += 0.10; w.evaded -= 0.20; w.half -= 0.10; }
      if (lateArc && localTension > 0.45) { w.authentic += 0.22; w.evaded -= 0.15; w.half -= 0.05; }
      if (localMinor) { w.deceptive += 0.05; w.plagal -= 0.02; }

      for (const k of Object.keys(w)) w[k] = Math.max(0.001, w[k] - localCadenceRepeatPenalty(k));
      const keys = Object.keys(w);
      const sum = keys.reduce((a,k)=>a+w[k],0);
      let r = rand() * sum;
      for (const k of keys) { r -= w[k]; if (r <= 0) return k; }
      return "authentic";
    }

    function localCadenceTargets(type) {
      switch(type){
        case "authentic":  return { pre: 6, end: 0, wantLT: true  };
        case "half":       return { pre: 1, end: 4, wantLT: false };
        case "plagal":     return { pre: 3, end: 0, wantLT: false };
        case "deceptive":  return { pre: 6, end: 5, wantLT: true  };
        case "evaded":     return { pre: 6, end: 2, wantLT: true  };
        default:           return { pre: 2, end: 0, wantLT: false };
      }
    }

    function localUpdateHarmonyState() {
      const r0 = rand();
      let pressure = Math.min(1.0, localModCount / 48.0);
      if (localArcPos === localArcClimaxAt) pressure *= 2.5;
      if (localArcPos <= 1) pressure *= 0.2;
      if (localTension > 0.6) pressure *= 1.5;
      pressure = Math.min(1.0, pressure);
      const modChance = pressure * 0.35;
      if (r0 < modChance) {
        if (localArcPos === localArcClimaxAt && chance(0.6)) {
          if (!localMinor) localMinor = true;
          else localCircle += (chance(0.5) ? 1 : -1);
        } else {
          const isJourneyMode = (durationInput === "infinite");
          const dist = Math.abs(localCircle);
          if (!isJourneyMode && dist > 3 && chance(0.8)) {
            localCircle += (localCircle > 0 ? -1 : 1);
          } else {
            if (chance(0.3)) localMinor = !localMinor;
            else localCircle += (chance(0.5) ? 1 : -1);
          }
        }
        localModCount = 0;
      }
    }

    function getScaleNoteLocal(base, idx, circlePos, minorMode, opts = {}) {
      let pos = circlePos % 12; if (pos < 0) pos += 12;
      const semitones = (pos * 7) % 12;
      let rootOffset = semitones;
      if (minorMode) rootOffset = (semitones + 9) % 12;
      const majorIntervals = [0, 2, 4, 5, 7, 9, 11];
      const minorIntervals = [0, 2, 3, 5, 7, 8, 10];
      const len = 7;
      const octave = Math.floor(idx / len);
      const degree = ((idx % len) + len) % len;
      let intervals = minorMode ? minorIntervals : majorIntervals;
      if (minorMode && opts.raiseLeadingTone && degree === 6) {
        intervals = minorIntervals.slice();
        intervals[6] = 11;
      }
      const noteValue = rootOffset + intervals[degree] + (octave * 12);
      return base * Math.pow(2, noteValue / 12);
    }
    function clampIdx(i){ return Math.max(-4, Math.min(10, i)); }

    while (localTime < exportDuration) {
      let appliedDur = noteDur;
      let clearPendingAfter = false;

      localPhraseStep = (localPhraseStep + 1) % 16;
      if (localPhraseStep === 0) {
        localPendingLT = false;
        localArcPos = (localArcPos + 1);
        if (localArcPos >= localArcLen) localStartNewArc();
        localCadenceType = localPickCadenceType();
      }

      const isCadence = (localPhraseStep >= 13);
      localUpdateHarmonyState();
      let pressure = Math.min(1.0, localModCount / 48.0);
      if (localArcPos === localArcClimaxAt) pressure *= 2.5;
      if (localArcPos <= 1) pressure *= 0.2;
      if (localTension > 0.6) pressure *= 1.5;
      pressure = Math.min(1.0, pressure);

      if (offlineSend) {
        const normDensity = clamp01((exportDensity - 0.05) / 0.375);
        const normTension = clamp01(localTension);
        const normPressure = clamp01(pressure);
        let targetSend = 0.65 - (0.25 * normDensity) + (normTension * 0.55) - (0.10 * normPressure);
        targetSend = Math.max(0, Math.min(0.95, targetSend));
        offlineSend.gain.setTargetAtTime(targetSend, localTime, 2.5);
      }

      if (isCadence) {
        const targets = [0, 2, 4];
        const currentOctave = Math.floor(localIdx / 7) * 7;
        let deg = localIdx - currentOctave;
        deg = ((deg % 7) + 7) % 7;
        let best = targets[0];
        let bestD = circDist(deg, best);
        for (let i = 1; i < targets.length; i++) {
          const t = targets[i];
          const d = circDist(deg, t);
          if (d < bestD || (d === bestD && chance(0.5))) { best = t; bestD = d; }
        }
        const landProb = (localPhraseStep >= 15) ? 0.85 : 0.55;
        let targetDeg = best;
        if (!chance(landProb)) {
          const dir = chance(0.65) ? -1 : 1;
          targetDeg = (targetDeg + dir + 7) % 7;
        }
        let delta = targetDeg - deg;
        if (delta > 3) delta -= 7;
        if (delta < -3) delta += 7;
        if (Math.abs(delta) === 3) delta = chance(0.5) ? 3 : -3;
        else if (delta === 0 && localPhraseStep <= 14 && chance(0.18)) delta = chance(0.5) ? 1 : -1;
        localIdx = currentOctave + deg + delta;

        const ct = localCadenceType;
        const targ = localCadenceTargets(ct);

        if (localPhraseStep === 14) {
          const forcePreProb = (ct === "evaded") ? 0.35 : (ct === "half") ? 0.45 : (ct === "plagal") ? 0.50 : 0.65;
          if (chance(forcePreProb)) {
            const curOct = Math.floor(localIdx / 7) * 7;
            const curDeg = ((localIdx - curOct) % 7 + 7) % 7;
            let deltaPre = targ.pre - curDeg;
            if (deltaPre > 3) deltaPre -= 7;
            if (deltaPre < -3) deltaPre += 7;
            localIdx += deltaPre;
            localPendingLT = !!targ.wantLT;
          }
        }

        if (localPhraseStep === 15) {
          const baseProb = (ct === "evaded") ? (0.35 + localTension * 0.20) : (ct === "half") ? 0.78 : (ct === "plagal") ? 0.74 : (ct === "deceptive") ? 0.86 : 0.90;
          const finalProb = localPendingLT ? Math.min(0.98, baseProb + 0.06) : baseProb;
          if (chance(finalProb)) {
            const curOct = Math.floor(localIdx / 7) * 7;
            const curDeg = ((localIdx - curOct) % 7 + 7) % 7;
            let deltaEnd = targ.end - curDeg;
            if (deltaEnd > 3) deltaEnd -= 7;
            if (deltaEnd < -3) deltaEnd += 7;
            localIdx += deltaEnd;
          }
          if (ct === "evaded") localTension = clamp01(localTension + 0.18);
          else if (ct === "half") localTension = clamp01(localTension + 0.08);
          else if (ct === "deceptive") localTension = clamp01(localTension + 0.06);
          else if (ct === "plagal") localTension = clamp01(localTension - 0.10);
          else if (ct === "authentic") localTension = clamp01(localTension - 0.22);
          localLastCadence = ct;
          clearPendingAfter = true;
        }
      } else {
        const useMotif = chance(0.25);
        if (useMotif && localMotif.length > 0) {
          const motifInterval = localMotif[localMotifPos];
          const currentOctave = Math.floor(localIdx / 7) * 7;
          localIdx = currentOctave + motifInterval;
          localMotifPos = (localMotifPos + 1) % localMotif.length;
        } else {
          const r = rand();
          let shift = 0;
          if (r < 0.50) shift = 1;
          else if (r < 0.82) shift = -1;
          else shift = chance(0.65) ? 2 : -2;
          localIdx += shift;
        }
      }

      if (!isCadence) {
        const anchor = 1;
        const reg = Math.floor(localIdx / 7);
        if (reg < anchor && chance(0.22)) localIdx += 1;
        else if (reg > anchor && chance(0.22)) localIdx -= 1;
      }
      localIdx = clampIdx(localIdx);

      const degNow = ((localIdx - Math.floor(localIdx / 7) * 7) % 7 + 7) % 7;
      const wantLT = localCadenceTargets(localCadenceType).wantLT;
      const raiseLT = isCadence && wantLT && degNow === 6 && (localPhraseStep === 13 || localPhraseStep === 14 || localPendingLT);

      const freq = getScaleNoteLocal(baseFreq, localIdx, localCircle, localMinor, { raiseLeadingTone: raiseLT });

      // --- DRONE EXPORT ---
      const isArcStart = (localArcPos === 0 && localPhraseStep === 0);
      const isClimax = (localArcPos === localArcClimaxAt && localPhraseStep === 0);
      const isDroneSolo = (localArcPos === 0 && localPhraseStep < 12); 

      const atPhraseStart = (localPhraseStep === 0 || localPhraseStep === 1);
      const atCadenceZone = (localPhraseStep >= 13);
      let pedalProb = 0.0;
      if (atPhraseStart) pedalProb = 0.16;
      else if (atCadenceZone) pedalProb = 0.10 + (localTension * 0.05);
      else pedalProb = 0.03;
      const curRegister = Math.floor(localIdx / 7);
      if (curRegister >= 2) pedalProb *= 0.35;

      if (isArcStart || isClimax || chance(pedalProb)) {
        const planType = localCadenceType || "authentic";
        let pedalDegree = 0;
        if (isArcStart || isClimax) {
          pedalDegree = 0;
        } else {
          if (planType === "half") pedalDegree = 4;
          else if (planType === "deceptive") pedalDegree = chance(0.6) ? 0 : 5;
        }
        const pedalOct = Math.min(curRegister - 1, 0);
        const pedalIdx = pedalOct * 7 + pedalDegree;
        let pedalFreq = getScaleNote(baseFreq, pedalIdx, localCircle, localMinor);
        
        if (isArcStart) { while (pedalFreq > 65) pedalFreq *= 0.5; }
        else { while (pedalFreq < 50) pedalFreq *= 2; while (pedalFreq > 110) pedalFreq *= 0.5; }
        
        const t0 = Math.max(localTime - 0.05, 0);
        let pedalDur = atPhraseStart ? 16.0 : (atCadenceZone ? 12.0 : 7.0);
        if (isArcStart) pedalDur = 32.0; 
        if (isClimax) pedalDur = 24.0;
        const vol = (isArcStart || isClimax) ? 0.25 : 0.18;
        
        scheduleBassPedal(offlineCtx, offlineMaster, offlineSend, pedalFreq, t0, pedalDur, vol);
      }

      // --- MELODY EXPORT ---
      if (!isDroneSolo) {
          if (isCadence && localArcPos === localArcClimaxAt && localPhraseStep === 15) {
            scheduleNote(offlineCtx, offlineMaster, offlineSend, freq * 2.0, localTime, appliedDur, 0.35, pressure, localTension);
          }
          scheduleNote(offlineCtx, offlineMaster, offlineSend, freq, localTime, appliedDur, 0.4, pressure, localTension);
      }

      localModCount++;
      if (clearPendingAfter) localPendingLT = false;
      localTime += (1 / exportDensity) * (0.95 + rand() * 0.1);
    }

    const rendered = await offlineCtx.startRendering();
    const wavBlob = bufferToWavBlob(rendered);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `open-export-${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function bufferToWavBlob(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const bufferSize = 44 + dataSize;
    const ab = new ArrayBuffer(bufferSize);
    const view = new DataView(ab);

    function writeString(offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    let offset = 0;
    writeString(offset, "RIFF"); offset += 4;
    view.setUint32(offset, 36 + dataSize, true); offset += 4;
    writeString(offset, "WAVE"); offset += 4;
    writeString(offset, "fmt "); offset += 4;
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2;
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, byteRate, true); offset += 4;
    view.setUint16(offset, blockAlign, true); offset += 2;
    view.setUint16(offset, 16, true); offset += 2;
    writeString(offset, "data"); offset += 4;
    view.setUint32(offset, dataSize, true); offset += 4;

    const channels = [];
    for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));
    let idx = 0;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let s = channels[ch][i];
        s = Math.max(-1, Math.min(1, s));
        view.setInt16(offset + idx, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        idx += 2;
      }
    }
    return new Blob([ab], { type: "audio/wav" });
  }

  function bindUI() {
    applyModeClasses();
    const saved = loadState();
    if (saved) applyControls(saved);

    const tone = document.getElementById("tone");
    const sd = document.getElementById("songDuration");
    const hzReadout = document.getElementById("hzReadout");

    if (tone) {
      tone.addEventListener("input", () => {
        if (hzReadout) hzReadout.textContent = String(tone.value);
        saveState(readControls());
      });
      tone.addEventListener("change", () => saveState(readControls()));
    }
    if (sd) sd.addEventListener("change", () => saveState(readControls()));

    document.getElementById("launchPlayer")?.addEventListener("click", launchPlayer);
    document.getElementById("playNow")?.addEventListener("click", startFromUI);
    document.getElementById("stop")?.addEventListener("click", stopAllManual);
    document.getElementById("exportWav")?.addEventListener("click", renderWavExport);

    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const tag = (e.target && (e.target.tagName || "")).toLowerCase();
      const typing = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
      if (typing) return;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        initAudio();
        if (audioContext?.state === "suspended") audioContext.resume?.();
        toggleRecording();
      }
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (isPlaying) stopAllManual();
        else startFromUI();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindUI);
  } else {
    bindUI();
  }
})();