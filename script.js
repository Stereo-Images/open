(() => {
  const STATE_KEY = "open_player_settings_v155_ghost_nogap";

  // =========================
  // AESTHETIC TUNING
  // =========================
  const MELODY_FLOOR_HZ = 220;   // A3 (Keeps bells clear)
  const DRONE_FLOOR_HZ  = 80;    // E2 (Keeps drone heavy)
  
  // DRONE VOLUME: 50% of melody (Background layer)
  const DRONE_GAIN_MULT = 0.50;  

  function floorToHz(freq, floorHz) {
    while (freq < floorHz) freq *= 2;
    return freq;
  }

  // =========================
  // VIEW & STATE
  // =========================
  function isPopoutMode() { return window.location.hash === "#popout"; }

  function isMobileDevice() {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "") ||
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
    const width = 500, height = 680;
    const left = Math.max(0, (window.screen.width / 2) - (width / 2));
    const top = Math.max(0, (window.screen.height / 2) - (height / 2));
    window.open(`${window.location.href.split("#")[0]}#popout`, "open_player", `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no,status=no`);
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

  function setButtonState(state) {
    const playBtn = document.getElementById("playNow");
    const stopBtn = document.getElementById("stop");
    const toneInput = document.getElementById("tone");
    if (playBtn) playBtn.classList.toggle("filled", state === "playing");
    if (stopBtn) stopBtn.classList.toggle("filled", state !== "playing");
    if (toneInput) toneInput.disabled = (state === "playing");
  }

  // =========================
  // LIVE RECORDING
  // =========================
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;

  function toggleRecording() {
    if (isRecording) {
      isRecording = false;
      try { mediaRecorder.stop(); } catch {}
      setRecordUI(false);
    } else {
      if (!streamDest?.stream) return;
      recordedChunks = [];
      const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
      const mimeType = types.find(t => MediaRecorder.isTypeSupported(t)) || "";
      try {
        mediaRecorder = new MediaRecorder(streamDest.stream, mimeType ? { mimeType } : undefined);
      } catch (e) { console.warn(e); return; }
      
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `open-live-${Date.now()}.${blob.type.includes("ogg")?"ogg":"webm"}`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
      };
      mediaRecorder.start(250);
      isRecording = true;
      setRecordUI(true);
    }
  }

  function setRecordUI(on) {
    const el = document.getElementById("recordStatus");
    if (el) {
      el.textContent = on ? "Recording: ON" : "Recording: off";
      el.classList.toggle("recording-on", on);
    }
  }

  // =========================
  // DETERMINISTIC RNG
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
  function rngStream(tagInt) { return mulberry32((sessionSeed ^ tagInt) >>> 0); }
  function rand() { return rng(); }
  function chance(p) { return rand() < p; }

  let sessionSnapshot = null;

  // =========================
  // AUDIO GRAPH
  // =========================
  let audioContext = null, masterGain = null;
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
  let phraseCount = 0;
  let arcLen = 6;
  let arcPos = -1;
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
        data[i] = (r() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  function circDist(a, b) { const d = Math.abs(a - b); return Math.min(d, 7 - d); }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  function startNewArc() {
    arcLen = 4 + Math.floor(rand() * 5);
    arcClimaxAt = Math.max(2, arcLen - 2 - Math.floor(rand() * 2));
    arcPos = -1;
    tension = clamp01(tension * 0.4 + 0.05);
  }

  function pickCadenceTypeForPhrase() {
    const nearClimax = (arcPos === arcClimaxAt);
    const lateArc = (arcPos >= arcLen - 2);
    let w = { evaded: 0.20, half: 0.28, plagal: 0.12, deceptive: 0.18, authentic: 0.22 };
    
    if (arcPos < arcClimaxAt) { w.authentic = 0.05; w.evaded += 0.2; w.half += 0.1; }
    w.authentic += tension * 0.25; w.deceptive += tension * 0.10;
    
    if (nearClimax) { w.authentic += 0.25; w.deceptive += 0.10; }
    if (lateArc && tension > 0.45) { w.authentic += 0.22; }
    
    if (lastCadenceType === "authentic") w.authentic = Math.max(0, w.authentic - 0.3);

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
    
    // Wake Lock
    let v = document.querySelector("video");
    if(!v) {
        v = document.createElement("video");
        Object.assign(v.style, {position:'fixed', bottom:0, right:0, width:'1px', height:'1px', opacity:0.01, zIndex:-1});
        v.muted = true; v.playsInline = true;
        document.body.appendChild(v);
    }
    v.srcObject = streamDest.stream;
    v.play().catch(()=>{});

    document.addEventListener('keydown', (e) => { 
      if (e.key.toLowerCase() === 'r') toggleRecording(); 
    });
  }

  // --- MELODY ---
  function scheduleNote(ctx, destination, wetSend, freq, time, duration, volume, instability = 0, tensionAmt = 0) {
    freq = floorToHz(freq, MELODY_FLOOR_HZ);

    const numVoices = 2 + Math.floor(rand() * 2);
    let totalAmp = 0;
    const isFractured = (tensionAmt > 0.75);
    const FRACTURE_RATIOS = [Math.SQRT2, 1.618, 2.414, 2.718, 3.1415];
    const ratioFuzz = isFractured ? 0.08 : 0.0;

    const voices = Array.from({ length: numVoices }, () => {
      let mRatio = isFractured ? FRACTURE_RATIOS[Math.floor(rand() * FRACTURE_RATIOS.length)] : (1.5 + rand() * 2.5);
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
      filter.connect(destination);
      filter.connect(wetSend);

      modulator.start(time); carrier.start(time);
      modulator.stop(time + duration); carrier.stop(time + duration);
    });
  }

  // --- SMART DRONE CHORD (GHOST EDITION) ---
  function scheduleDroneChord(ctx, destination, wetSend, rootFreq, time, duration, baseVolume, quality) {
     rootFreq = floorToHz(rootFreq, DRONE_FLOOR_HZ);

     const thirdRatio = (quality === "min") ? Math.pow(2, 3/12) : Math.pow(2, 4/12); 
     
     // GLOBAL DRONE GAIN APPLIED HERE
     const vol = baseVolume * DRONE_GAIN_MULT;

     // Voicing: Root, Fifth, Third
     scheduleBassVoice(ctx, destination, wetSend, rootFreq, time, duration, vol * 0.5);
     scheduleBassVoice(ctx, destination, wetSend, rootFreq * 1.5, time, duration, vol * 0.3);
     scheduleBassVoice(ctx, destination, wetSend, rootFreq * thirdRatio, time, duration, vol * 0.3);
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

    // GHOST DRONE SETTINGS:
    // 1. FM Index 0.5 (Smooth, Glassy)
    modGain.gain.setValueAtTime(0, time);
    modGain.gain.linearRampToValueAtTime(freq * 0.5, time + (duration * 0.5)); 
    modGain.gain.linearRampToValueAtTime(0, time + duration);

    // 2. Slow Attack (4s)
    ampGain.gain.setValueAtTime(0.0001, time);
    ampGain.gain.exponentialRampToValueAtTime(volume, time + 4.0); 
    ampGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    // 3. Dark Filter (320Hz)
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(320, time);
    lp.Q.value = 0.6;

    modulator.connect(modGain); modGain.connect(carrier.frequency);
    carrier.connect(ampGain); ampGain.connect(lp);
    lp.connect(destination); lp.connect(wetSend);

    modulator.start(time); carrier.start(time);
    modulator.stop(time + duration); carrier.stop(time + duration);
  }

  // --- SINGLE BASS PEDAL (Legacy/Fallback) ---
  function scheduleBassPedal(ctx, destination, wetSend, freq, time, duration, volume) {
      let fSafe = floorToHz(freq, DRONE_FLOOR_HZ);
      scheduleBassVoice(ctx, destination, wetSend, fSafe, time, duration, volume * DRONE_GAIN_MULT);
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

  function scheduler() {
    if (!isPlaying) return;
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

    while (nextTimeA < now + 0.5) {
      let appliedDur = noteDur;
      let clearPendingAfterNote = false;

      let pressure = Math.min(1.0, notesSinceModulation / 48.0);
      updateHarmonyState(durationInput);

      if (isApproachingEnd && !isEndingNaturally) {
        if (patternIdxA % 7 === 0) {
          let fEnd = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor);
          fEnd = floorToHz(fEnd, MELODY_FLOOR_HZ);
          scheduleNote(audioContext, masterGain, reverbSend, fEnd, nextTimeA, 25.0, 0.5, 0, 0);
          beginNaturalEnd();
          return;
        }
      }

      phraseStep = (phraseStep + 1) % 16;
      if (phraseStep === 0) {
        pendingLTResolution = false;
        phraseCount++;
        arcPos = (arcPos + 1);
        if (arcPos >= arcLen) startNewArc();
        currentCadenceType = pickCadenceTypeForPhrase();
      }

      const isCadence = (phraseStep >= 13);
      if (chance(phraseStep === 15 ? 0.85 : 0.2)) appliedDur *= 1.2;

      if (isCadence) {
          patternIdxA = Math.floor(patternIdxA/7)*7; 
      } else {
          patternIdxA += (rand() < 0.5 ? 1 : -1);
      }
      
      let freq = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor);
      freq = floorToHz(freq, MELODY_FLOOR_HZ);

      // --- DRONE TRIGGER LOGIC (FIXED GAP) ---
      const isArcStart = (arcPos === 0 && phraseStep === 0);
      const isClimax = (arcPos === arcClimaxAt && phraseStep === 0);
      const isDroneSolo = (arcPos === 0 && phraseStep < 12 && phraseCount > 0);

      const atPhraseStart = (phraseStep === 0 || phraseStep === 1);
      const atCadenceZone = (phraseStep >= 13);

      let pedalProb = 0.0;
      if (atPhraseStart) pedalProb = 0.18;
      else if (atCadenceZone) pedalProb = 0.12 + (tension * 0.05);
      else pedalProb = 0.04;

      const curRegister = Math.floor(patternIdxA / 7);
      if (curRegister >= 2) pedalProb *= 0.35;

      if (isArcStart || isClimax || chance(pedalProb)) {
        const planType = currentCadenceType || "authentic";
        const degNow = degreeFromIdx(patternIdxA);
        let droneRootDegree = 0;

        if (!isArcStart && !isClimax) {
          if (planType === "half") droneRootDegree = 4;
          else if (planType === "deceptive") droneRootDegree = chance(0.6) ? 0 : 5;
          else if (planType === "plagal") droneRootDegree = chance(0.6) ? 3 : 0;
          else droneRootDegree = 0;
        }

        const useThirdColor = shouldUseThirdDrone({
          atCadenceZone,
          tensionVal: tension,
          cadenceType: planType,
          melodyDeg: degNow
        });

        if (!useThirdColor && droneRootDegree !== 0 && chance(0.65)) droneRootDegree = 0;

        const droneOct = Math.min(curRegister - 1, 0);
        const droneIdx = droneOct * 7 + droneRootDegree;
        let droneRootFreq = getScaleNote(baseFreq, droneIdx, circlePosition, isMinor);
        droneRootFreq = floorToHz(droneRootFreq, DRONE_FLOOR_HZ);

        const t0 = Math.max(nextTimeA - 0.05, audioContext.currentTime);
        
        // --- GAP FIX: EXTENDED DURATIONS ---
        // Was 18s/34s -> Now 24s/45s to bridge phrases.
        let droneDur = atPhraseStart ? 24.0 : (atCadenceZone ? 18.0 : 12.0);
        if (isArcStart) droneDur = 45.0;
        if (isClimax) droneDur = 35.0;

        const baseVol = (isArcStart || isClimax) ? 0.40 : 0.28;
        const quality = isMinor ? "min" : "maj";

        scheduleDroneChord(audioContext, masterGain, reverbSend, droneRootFreq, t0, droneDur, baseVol, quality);
      }

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
      masterGain.gain.cancelScheduledValues(0);
      masterGain.gain.setValueAtTime(0, t);
      masterGain.gain.linearRampToValueAtTime(0.3, t + 0.1);
    }

    const seed = (crypto?.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 2 ** 32)) >>> 0;
    setSeed(seed);
    runDensity = 0.05 + rand() * 0.375;
    sessionMotif = generateSessionMotif();
    sessionSnapshot = { seed, density: runDensity, motif: [...sessionMotif] };
    motifPos = 0;

    startNewArc();

    isPlaying = true;
    sessionStartTime = audioContext.currentTime;
    nextTimeA = audioContext.currentTime + 0.05;
    phraseStep = 0;
    phraseCount = 0;
    notesSinceModulation = 0;
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
      masterGain.gain.setValueAtTime(masterGain.gain.value, t);
      masterGain.gain.linearRampToValueAtTime(0, t + 0.05);
    }
    setButtonState("stopped");
  }

  function beginNaturalEnd() {
    isEndingNaturally = true;
    isPlaying = false;
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    setButtonState("stopped");
  }

  // =========================
  // EXPORT (MATCHES LIVE RULES)
  // =========================
  async function renderWavExport() {
    if (!isPlaying && !audioContext) { alert("Please start playback first."); return; }
    if (!sessionSnapshot?.seed) { alert("Press Play once first."); return; }
    setSeed(sessionSnapshot.seed);

    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const exportDuration = (durationInput === "infinite") ? 180 : Math.min(180, parseFloat(durationInput));
    const sampleRate = 44100;

    const offlineCtx = new OfflineAudioContext(2, sampleRate * exportDuration, sampleRate);
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

    let localPhraseCount = 0, localArcLen = 6, localArcPos = -1, localArcClimaxAt = 4, localTension = 0.0;
    let localLastCadence = "none", localCadenceType = "none";

    function localStartNewArc(){
      localArcLen = 4 + Math.floor(rand() * 5);
      localArcClimaxAt = Math.max(2, localArcLen - 2 - Math.floor(rand() * 2));
      localArcPos = -1;
      localTension = Math.max(0, Math.min(1, localTension * 0.4 + 0.05));
    }
    localStartNewArc();

    const exportDensity = sessionSnapshot.density;
    let baseFreq = Number(document.getElementById("tone")?.value ?? 110);
    if (!Number.isFinite(baseFreq)) baseFreq = 110;
    baseFreq = Math.max(100, Math.min(200, baseFreq));

    const noteDur = (1 / exportDensity) * 2.5;
    let localCircle = 0, localMinor = false, localIdx = 0;
    let localTime = 0, localModCount = 0, localPhraseStep = 15;
    let localMotifPos = 0, localPendingLT = false;

    function localPickCadenceType(){
      const nearClimax = (localArcPos === localArcClimaxAt);
      const lateArc = (localArcPos >= localArcLen - 2);
      let w = { evaded: 0.20, half: 0.28, plagal: 0.12, deceptive: 0.18, authentic: 0.22 };
      if (localArcPos < localArcClimaxAt) { w.authentic = 0.05; w.evaded += 0.2; w.half += 0.1; }
      w.authentic += localTension * 0.25; w.deceptive += localTension * 0.10;
      if (nearClimax) { w.authentic+=0.25; w.deceptive+=0.10; }
      if (lateArc && localTension > 0.45) { w.authentic+=0.22; }
      const keys = Object.keys(w); const sum = keys.reduce((a,k)=>a+w[k],0); let r = rand()*sum;
      for (const k of keys){ r -= w[k]; if (r<=0) return k; }
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

    function localDegreeFromIdx(idx) {
        const base = Math.floor(idx / 7) * 7;
        return ((idx - base) % 7 + 7) % 7;
    }

    while (localTime < exportDuration - 2.0) {
      localPhraseStep = (localPhraseStep + 1) % 16;
      if (localPhraseStep === 0) {
        localPendingLT = false; localPhraseCount++; localArcPos++;
        if (localArcPos >= localArcLen) localStartNewArc();
        localCadenceType = localPickCadenceType();
      }
      const isCadence = (localPhraseStep >= 13);
      let pressure = Math.min(1.0, localModCount / 48.0);
      localUpdateHarmony();

      const normDensity = clamp01((exportDensity - 0.05) / 0.375);
      let targetSend = 0.65 - (0.25 * normDensity); 
      offlineSend.gain.setValueAtTime(targetSend, localTime);

      let appliedDur = noteDur;
      if (chance(localPhraseStep === 15 ? 0.85 : 0.2)) appliedDur *= 1.2;

      if (isCadence) localIdx = Math.floor(localIdx/7)*7; 
      else localIdx += (rand() < 0.5 ? 1 : -1);

      let freq = getScaleNote(baseFreq, localIdx, localCircle, localMinor);
      freq = floorToHz(freq, MELODY_FLOOR_HZ);

      const isArcStart = (localArcPos === 0 && localPhraseStep === 0);
      const isClimax = (localArcPos === localArcClimaxAt && localPhraseStep === 0);
      
      const atPhraseStart = (localPhraseStep === 0 || localPhraseStep === 1);
      const atCadenceZone = (localPhraseStep >= 13);
      let droneProb = 0.0;
      if (atPhraseStart) droneProb = 0.18;
      else if (atCadenceZone) droneProb = 0.12 + (localTension * 0.05);
      else droneProb = 0.04;

      if (isArcStart || isClimax || chance(droneProb)) {
         let pedalDegree = 0;
         const degNow = localDegreeFromIdx(localIdx);
         const useThirdColor = shouldUseThirdDrone({
            atCadenceZone, tensionVal: localTension, cadenceType: localCadenceType, melodyDeg: degNow
         });
         if(useThirdColor && chance(0.55)) pedalDegree = 2;

         const droneOct = -1; 
         const droneIdx = droneOct * 7 + pedalDegree;
         let pedalFreq = getScaleNote(baseFreq, droneIdx, localCircle, localMinor);
         pedalFreq = floorToHz(pedalFreq, DRONE_FLOOR_HZ);

         const t0 = Math.max(localTime - 0.05, 0);
         // EXPORT GAP FIX:
         let droneDur = atPhraseStart ? 24.0 : (atCadenceZone ? 18.0 : 12.0);
         if (isArcStart) droneDur = 45.0;
         if (isClimax) droneDur = 35.0;

         const baseVol = (isArcStart || isClimax) ? 0.40 : 0.28;
         const quality = localMinor ? "min" : "maj";
         scheduleDroneChord(offlineCtx, offlineMaster, offlineSend, pedalFreq, t0, droneDur, baseVol, quality);
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
    const wavBlob = bufferToWave(renderedBuffer, exportDuration * sampleRate);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a'); a.style.display = 'none'; a.href = url; a.download = `open-final-v155-${Date.now()}.wav`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 100);
  }

  function bufferToWave(abuffer, len) {
    const numOfChan = abuffer.numberOfChannels; const length = len * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length); const view = new DataView(buffer);
    const channels = []; const sampleRate = abuffer.sampleRate; let offset = 0, pos = 0;
    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }
    setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
    setUint32(sampleRate); setUint32(sampleRate * 2 * numOfChan); setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);
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

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => { 
      if (e.key.toLowerCase() === 'r') toggleRecording(); 
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const playBtn = document.getElementById("playNow");
    const stopBtn = document.getElementById("stop");

    if (playBtn) playBtn.addEventListener("click", startFromUI);
    if (stopBtn) stopBtn.addEventListener("click", stopAllManual);

    applyControls(loadState());

    document.getElementById("tone")?.addEventListener("input", (e) => {
        document.getElementById("hzReadout").textContent = e.target.value;
        saveState(readControls());
    });
    document.getElementById("songDuration")?.addEventListener("change", () => saveState(readControls()));
    const recBtn = document.getElementById("record");
    if (recBtn) recBtn.onclick = toggleRecording;

    const exportBtn = document.getElementById("export");
    if (exportBtn) exportBtn.onclick = renderWavExport;

    if (isPopoutMode()) {
      document.body.classList.add("popout");
      setButtonState("stopped");
    }

    document.getElementById("launchPlayer")?.addEventListener("click", () => {
      if (!isPopoutMode() && isMobileDevice()) {
        document.body.classList.add("mobile-player");
        setButtonState("stopped");
      } else {
        window.open(`${window.location.href.split("#")[0]}#popout`, "open_player", "width=500,height=680,resizable=yes");
      }
    });
  });
})();
