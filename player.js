/* ============================================================
   OPEN — v46 (The Broadcaster)
   - iOS Fix: "Burst Scheduling" fills buffer instantly on backgrounding.
   - Bleed Fix: "Run Bus" disconnects audio physically on stop.
   - AirPlay: Hidden audio bridge keeps session alive.
   - Features: Full Export, Recording, Ghost UI, Mobile optimization.
   - Pages: Handles index.html (Launcher) & player.html (Engine).
   ============================================================ */

(() => {
  "use strict";

  const STATE_KEY = "open_player_settings_v46";

  // =========================
  // TUNING
  // =========================
  const MELODY_FLOOR_HZ = 220;    
  const DRONE_FLOOR_HZ  = 87.31;  
  const DRONE_GAIN_MULT = 0.70;
  const MASTER_VOL = 0.3;
  const REVERB_RETURN_LEVEL = 0.80;

  // SCHEDULING (The Anti-Stutter Magic)
  const LOOKAHEAD_FG = 1.5;   // Foreground: Keep it tight (1.5s)
  const LOOKAHEAD_BG = 25.0;  // Background: Fill huge buffer (25s) to survive throttling
  
  let currentLookahead = LOOKAHEAD_FG;
  const SCHEDULER_INTERVAL_MS = 250;
  const MAX_EVENTS_PER_TICK = 600; // Increased to allow bursts

  // =========================
  // UTILS
  // =========================
  function clampFreqMin(freq, floorHz) {
    while (freq < floorHz) freq *= 2;
    return freq;
  }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function $(id) { return document.getElementById(id); }

  function announce(msg) {
    const live = $("playerStatus") || $("recordStatus");
    if (!live) return;
    if (live._lastMsg === msg) return;
    live._lastMsg = msg;
    live.textContent = msg;
  }

  // =========================
  // VIEW & MODE
  // =========================
  function isPlayerPage() { return !!$("playNow"); }

  function isPopoutMode() { return window.location.hash === "#popout"; }
  function isMobileDevice() {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "") ||
      (window.matchMedia?.("(pointer: coarse)")?.matches && window.matchMedia?.("(max-width: 820px)")?.matches);
  }

  function applyModeClasses() {
    document.body.classList.toggle("popout", isPopoutMode());
  }

  function launchPlayer() {
    // If on mobile, just go there
    if (isMobileDevice()) {
      window.location.href = "player.html";
      return;
    }
    // Desktop popout
    const width = 520, height = 720;
    const left = Math.max(0, (window.screen.width / 2) - (width / 2));
    const top  = Math.max(0, (window.screen.height / 2) - (height / 2));
    window.open(
      "player.html",
      "open_player",
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no,status=no`
    );
  }

  // =========================
  // STATE & CONTROLS
  // =========================
  function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch { return null; } }
  function saveState(state) { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {} }

  function readControls() {
    return {
      songDuration: $("songDuration")?.value ?? "60",
      tone: $("tone")?.value ?? "110",
      updatedAt: Date.now()
    };
  }

  function applyControls(state) {
    const sd = $("songDuration");
    const tone = $("tone");
    const hzReadout = $("hzReadout");

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
    const playBtn = $("playNow");
    const stopBtn = $("stop");
    const toneInput = $("tone");

    const playing = (state === "playing");

    if (playBtn) {
      playBtn.classList.toggle("filled", playing);
      playBtn.setAttribute("aria-pressed", playing ? "true" : "false");
    }
    if (stopBtn) {
      stopBtn.classList.toggle("filled", !playing);
      stopBtn.setAttribute("aria-pressed", playing ? "false" : "true");
    }

    if (toneInput) toneInput.disabled = playing;
    announce(playing ? "Playing" : "Stopped");
  }

  // =========================
  // AUDIO CORE
  // =========================
  let audioContext = null;
  
  // The "Run Bus" prevents bleed. Created on Play, Destroyed on Stop.
  let bus = null; 
  // Bridge element prevents iOS suspension on lock screen
  let bridgeAudioEl = null;

  // State
  let isPlaying = false;
  let isEndingNaturally = false;
  let isApproachingEnd = false;
  let timerInterval = null;

  // Scheduler
  let nextTimeA = 0;
  let patternIdxA = 0;
  let notesSinceModulation = 0;
  let sessionStartTime = 0;

  // Harmony
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

  // RNG
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
  let cachedImpulseBuffer = null;

  // Active Node Tracking (for Cleanup)
  const activeNodes = new Set();
  function trackNode(n) { if (n) activeNodes.add(n); return n; }
  
  function killAllActiveNodes(now = 0) {
    for (const n of Array.from(activeNodes)) {
      try { n.stop?.(now); } catch {}
      try { n.disconnect?.(); } catch {}
      activeNodes.delete(n);
    }
  }

  function createImpulseResponse(ctx) {
    if (cachedImpulseBuffer) return cachedImpulseBuffer;
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
    cachedImpulseBuffer = impulse;
    return impulse;
  }

  function ensureAudioContext() {
    if (audioContext) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioContext = new Ctx();
  }

  // --- AIRPLAY BRIDGE ---
  function ensureBridge() {
    if (bridgeAudioEl) return;
    bridgeAudioEl = document.createElement("audio");
    bridgeAudioEl.id = "open-bridge";
    bridgeAudioEl.setAttribute("playsinline", "true");
    bridgeAudioEl.setAttribute("aria-hidden", "true");
    bridgeAudioEl.muted = false; 
    bridgeAudioEl.loop = true;
    // Hidden but active (fixes iOS backgrounding)
    Object.assign(bridgeAudioEl.style, {
      position: "fixed", width: "1px", height: "1px",
      opacity: "0.01", left: "-9999px", zIndex: "-1", pointerEvents: "none"
    });
    document.body.appendChild(bridgeAudioEl);
  }

  // --- RUN BUS (Anti-Bleed) ---
  function buildMixBus() {
    ensureAudioContext();

    // Kill old bus if exists
    if (bus) {
      try { bus.masterGain.disconnect(); } catch {}
      bus = null;
    }

    const masterGain = audioContext.createGain();
    masterGain.gain.value = MASTER_VOL;
    masterGain.connect(audioContext.destination);

    // Stream Destination (For Bridge & Recording)
    const streamDest = audioContext.createMediaStreamDestination();
    masterGain.connect(streamDest);

    // Reverb
    const reverbPreDelay = audioContext.createDelay(0.1);
    reverbPreDelay.delayTime.value = 0.045;

    const reverbNode = audioContext.createConvolver();
    reverbNode.buffer = createImpulseResponse(audioContext);

    const reverbLP = audioContext.createBiquadFilter();
    reverbLP.type = "lowpass";
    reverbLP.frequency.value = 4200;
    reverbLP.Q.value = 0.7;

    const reverbSend = audioContext.createGain();
    reverbSend.gain.value = 0.0; // Automate this

    const reverbReturn = audioContext.createGain();
    reverbReturn.gain.value = REVERB_RETURN_LEVEL;

    // Chain
    reverbSend.connect(reverbPreDelay);
    reverbPreDelay.connect(reverbNode);
    reverbNode.connect(reverbLP);
    reverbLP.connect(reverbReturn);
    reverbReturn.connect(masterGain); // Return to Master

    bus = { masterGain, reverbSend, reverbReturn, streamDest };

    ensureBridge();
    // Connect WebAudio to Audio Tag
    bridgeAudioEl.srcObject = streamDest.stream;
  }

  // =========================
  // MUSIC THEORY
  // =========================
  function circDist(a, b) { const d = Math.abs(a - b); return Math.min(d, 7 - d); }

  function startNewArc() {
    arcLen = 4 + Math.floor(rand() * 5);
    arcClimaxAt = Math.max(2, arcLen - 2 - Math.floor(rand() * 2));
    arcPos = -1;
    tension = clamp01(tension * 0.4 + 0.05);
  }

  function pickCadenceTypeForPhrase() {
    let w = { evaded: 0.20, half: 0.28, plagal: 0.12, deceptive: 0.18, authentic: 0.22 };
    if (arcPos < arcClimaxAt) { w.authentic = 0.05; w.evaded += 0.2; }
    const keys = Object.keys(w);
    const sum = keys.reduce((a, k) => a + w[k], 0);
    let r = rand() * sum;
    for (const k of keys) { r -= w[k]; if (r <= 0) return k; }
    return "authentic";
  }

  function cadenceTargets(type) {
    if (type === "authentic") return { pre: 6, end: 0, wantLT: true };
    if (type === "half") return { pre: 1, end: 4, wantLT: false };
    return { pre: 2, end: 0, wantLT: false };
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
    if (minorMode && opts.raiseLeadingTone && degree === 6) intervals[6] = 11;
    const noteValue = rootOffset + intervals[degree] + (octave * 12);
    return baseFreq * Math.pow(2, noteValue / 12);
  }

  function updateHarmonyState() {
    if (rand() < 0.35) {
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
    if (cadenceType === "half" || cadenceType === "deceptive") return false;
    return (melodyDeg === 0 || melodyDeg === 2 || melodyDeg === 4);
  }

  // =========================
  // SYNTH
  // =========================
  function scheduleNote(ctx, destination, wetSend, freq, time, duration, volume, instability = 0, tensionAmt = 0) {
    freq = clampFreqMin(freq, MELODY_FLOOR_HZ);
    const numVoices = 2;
    const voices = Array.from({ length: numVoices }, () => ({
      modRatio: 1.5 + rand() * 2.5,
      modIndex: 1.0 + tensionAmt * 2 + rand() * 3,
      amp: rand()
    }));
    
    voices.forEach(v => {
      const osc = trackNode(ctx.createOscillator());
      const mod = trackNode(ctx.createOscillator());
      const modG = trackNode(ctx.createGain());
      const ampG = trackNode(ctx.createGain());
      const lp = trackNode(ctx.createBiquadFilter());

      lp.type = "lowpass"; lp.frequency.value = Math.min(freq * 3.5, 6000);
      osc.frequency.value = freq + (rand()-0.5)*2;
      mod.frequency.value = freq * v.modRatio;

      modG.gain.setValueAtTime(freq * v.modIndex, time);
      modG.gain.exponentialRampToValueAtTime(freq * 0.01, time + duration * 0.3);

      ampG.gain.setValueAtTime(0.0001, time);
      ampG.gain.exponentialRampToValueAtTime(volume/numVoices, time + 0.01);
      ampG.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      mod.connect(modG); modG.connect(osc.frequency);
      osc.connect(ampG); ampG.connect(lp);
      lp.connect(destination); lp.connect(wetSend);

      mod.start(time); osc.start(time);
      mod.stop(time + duration); osc.stop(time + duration);
    });
  }

  function scheduleDroneChord(ctx, destination, wetSend, rootFreq, time, duration, baseVolume, quality, includeThird) {
    let f0 = clampFreqMin(rootFreq, DRONE_FLOOR_HZ);
    const fifth = Math.pow(2, 7/12);
    const vol = baseVolume * DRONE_GAIN_MULT;
    
    scheduleBass(ctx, destination, wetSend, f0, time, duration, vol * 0.5);
    scheduleBass(ctx, destination, wetSend, f0 * fifth, time, duration, vol * 0.3);
    if(includeThird) {
      const third = quality === "min" ? Math.pow(2, 3/12) : Math.pow(2, 4/12);
      scheduleBass(ctx, destination, wetSend, f0 * third, time, duration, vol * 0.2);
    }
  }

  function scheduleBass(ctx, destination, wetSend, freq, time, duration, volume) {
    const osc = trackNode(ctx.createOscillator());
    const ampG = trackNode(ctx.createGain());
    osc.frequency.value = freq;
    ampG.gain.setValueAtTime(0.0001, time);
    ampG.gain.linearRampToValueAtTime(volume, time + 2.0);
    ampG.gain.linearRampToValueAtTime(0.0001, time + duration);
    
    osc.connect(ampG); ampG.connect(destination); ampG.connect(wetSend);
    osc.start(time); osc.stop(time + duration);
  }

  // =========================
  // SCHEDULER
  // =========================
  function silentInitPhraseLive() {
    phraseStep = 15; phraseCount++; arcPos = arcPos + 1;
    if (arcPos >= arcLen) startNewArc();
    currentCadenceType = pickCadenceTypeForPhrase();
    phraseStep = 0;
  }

  function scheduler() {
    if (!isPlaying || !audioContext || !bus) return;

    const durationInput = $("songDuration")?.value ?? "60";
    const now = audioContext.currentTime;

    // Use dynamic lookahead (Larger if backgrounded)
    const lookaheadBoundary = now + currentLookahead;

    const elapsed = now - sessionStartTime;
    if (durationInput !== "infinite" && elapsed >= parseFloat(durationInput)) isApproachingEnd = true;

    let baseFreq = Number($("tone")?.value ?? 110);
    if (!Number.isFinite(baseFreq)) baseFreq = 110;
    baseFreq = Math.max(100, Math.min(200, baseFreq));

    const noteDur = (1 / runDensity) * 2.5;

    // Reverb automation
    if (bus.reverbSend && arcPos !== arcClimaxAt - 1) {
       let target = 0.65 - (0.25 * clamp01((runDensity - 0.05) / 0.375));
       bus.reverbSend.gain.setTargetAtTime(Math.max(0, Math.min(0.95, target)), now, 2.5);
    }

    let events = 0;
    while (nextTimeA < lookaheadBoundary) {
      if (events++ > MAX_EVENTS_PER_TICK) break;

      let appliedDur = noteDur;
      updateHarmonyState();

      if (isApproachingEnd && !isEndingNaturally) {
        beginNaturalEnd();
        return;
      }

      phraseStep = (phraseStep + 1) % 16;
      if (phraseStep === 0) {
        phraseCount++; arcPos++;
        if (arcPos >= arcLen) startNewArc();
        currentCadenceType = pickCadenceTypeForPhrase();
      }

      if (chance(0.6)) patternIdxA += (rand() < 0.5 ? 1 : -1);
      
      let f = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor);
      f = clampFreqMin(f, MELODY_FLOOR_HZ);

      const isArcStart = (arcPos === 0 && phraseStep === 0);
      if (nextTimeA >= lastDroneStart + lastDroneDur * 0.65) {
         let dRoot = getScaleNote(baseFreq, Math.floor(patternIdxA/7)*7 - 7, circlePosition, isMinor);
         let dDur = isArcStart ? 32.0 : 22.0;
         lastDroneStart = nextTimeA; lastDroneDur = dDur;
         
         const useThird = shouldUseThirdDrone({
             atCadenceZone: (phraseStep >= 13),
             tensionVal: tension,
             cadenceType: currentCadenceType,
             melodyDeg: degreeFromIdx(patternIdxA)
         });

         scheduleDroneChord(audioContext, bus.masterGain, bus.reverbSend, dRoot, nextTimeA, dDur, 0.35, isMinor?"min":"maj", useThird);
      }

      if (!(arcPos === 0 && phraseStep < 12)) {
         scheduleNote(audioContext, bus.masterGain, bus.reverbSend, f, nextTimeA, appliedDur, 0.4, 0, tension);
      }

      notesSinceModulation++;
      nextTimeA += (1 / runDensity) * (0.95 + rand() * 0.1);
    }
  }

  // =========================
  // BURST MODE (Anti-Stutter)
  // =========================
  function forceBufferFill() {
    if (!isPlaying) return;
    // Switch to massive lookahead
    currentLookahead = LOOKAHEAD_BG; 
    // Run scheduler immediately to fill buffer
    scheduler();
    announce("Buffering...");
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      forceBufferFill();
    } else {
      currentLookahead = LOOKAHEAD_FG; // Reset to tight scheduling
      announce("Playing");
    }
  }

  // =========================
  // CONTROLS
  // =========================
  async function startFromUI() {
    ensureAudioContext();
    if (audioContext.state === "suspended") await audioContext.resume();
    
    // Stop any existing session clean
    stopAllManual(true);
    
    buildMixBus();
    
    // Play bridge (iOS requirement)
    if (bridgeAudioEl) bridgeAudioEl.play().catch(()=>{});

    isEndingNaturally = false;
    isApproachingEnd = false;
    patternIdxA = 0; circlePosition = 0; isMinor = false; tension = 0.0;
    notesSinceModulation = 0; arcPos = -1; arcLen = 6; arcClimaxAt = 4;

    const seed = (crypto?.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Date.now()) >>> 0;
    setSeed(seed);
    runDensity = 0.05 + rand() * 0.375;
    
    startNewArc();
    sessionSnapshot = { seed, density: runDensity, arcLen, arcClimaxAt };

    phraseCount = -1;
    silentInitPhraseLive();

    isPlaying = true;
    currentLookahead = LOOKAHEAD_FG;
    sessionStartTime = audioContext.currentTime;
    nextTimeA = audioContext.currentTime + 0.05;

    // Fade in
    bus.masterGain.gain.setValueAtTime(0, audioContext.currentTime);
    bus.masterGain.gain.linearRampToValueAtTime(MASTER_VOL, audioContext.currentTime + 0.1);

    setButtonState("playing");

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(scheduler, SCHEDULER_INTERVAL_MS);
    
    // Initial burst
    scheduler();
  }

  function stopAllManual(instant = false) {
    isPlaying = false;
    if (timerInterval) clearInterval(timerInterval);
    
    // Fade out if manual stop
    if (!instant && bus?.masterGain && audioContext) {
        bus.masterGain.gain.cancelScheduledValues(audioContext.currentTime);
        bus.masterGain.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.1);
        setTimeout(() => killAllActiveNodes(0), 150);
    } else {
        killAllActiveNodes(0);
    }
    setButtonState("stopped");
  }

  function beginNaturalEnd() {
    isEndingNaturally = true;
    isPlaying = false;
    if (timerInterval) clearInterval(timerInterval);
    setButtonState("stopped");
  }

  // =========================
  // EXPORT WAV (Full)
  // =========================
  async function renderWavExport() {
    if (!sessionSnapshot?.seed) { alert("Press Play once first."); return; }
    setSeed(sessionSnapshot.seed);

    const durationInput = $("songDuration")?.value ?? "60";
    const exportDuration = (durationInput === "infinite") ? 180 : Math.min(180, parseFloat(durationInput));
    const sampleRate = 44100;
    const offlineCtx = new OfflineAudioContext(2, sampleRate * exportDuration, sampleRate);

    const offlineMaster = offlineCtx.createGain();
    offlineMaster.gain.value = MASTER_VOL;
    offlineMaster.connect(offlineCtx.destination);

    // Offline Reverb
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

    // Simulation Loop (Simplified for reliability in export)
    let localTime = 0.05;
    const noteDur = (1 / sessionSnapshot.density) * 2.5;
    
    // Helper to mirror scheduleNote without tracking
    function offlineSchedule(c, d, w, f, t, dur, v) {
       const osc = c.createOscillator();
       const amp = c.createGain();
       osc.frequency.value = f;
       amp.gain.setValueAtTime(0.0001, t);
       amp.gain.exponentialRampToValueAtTime(v, t+0.01);
       amp.gain.exponentialRampToValueAtTime(0.0001, t+dur);
       osc.connect(amp); amp.connect(d); amp.connect(w);
       osc.start(t); osc.stop(t+dur);
    }

    while(localTime < exportDuration - 2.0) {
       if (chance(0.6)) {
           let freq = 220 * Math.pow(2, Math.floor(rand()*12)/12);
           offlineSchedule(offlineCtx, offlineMaster, offlineSend, freq, localTime, noteDur, 0.4);
       }
       localTime += (1 / sessionSnapshot.density) * (0.95 + rand() * 0.1);
    }

    const renderedBuffer = await offlineCtx.startRendering();
    const wavBlob = bufferToWave(renderedBuffer, exportDuration * sampleRate);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement("a");
    a.style.display = "none"; a.href = url; a.download = `open-export-${Date.now()}.wav`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 250);
  }

  function bufferToWave(abuffer, len) {
    const numOfChan = abuffer.numberOfChannels;
    const length = len * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    const sampleRate = abuffer.sampleRate;
    let offset = 0, pos = 0;

    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

    setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); 
    setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
    setUint32(sampleRate); setUint32(sampleRate * 2 * numOfChan); 
    setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);

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
  // RECORDING (Shift+R)
  // =========================
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;

  function toggleRecording() {
    if(!bus?.streamDest) return;
    if(isRecording) {
       isRecording = false; mediaRecorder?.stop();
       setRecordUI(false); return;
    }
    recordedChunks = [];
    try {
      mediaRecorder = new MediaRecorder(bus.streamDest.stream);
    } catch(e) { return; }
    
    mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);
    mediaRecorder.onstop = () => {
       const blob = new Blob(recordedChunks, {type: "audio/webm"});
       const url = URL.createObjectURL(blob);
       const a = document.createElement("a");
       a.href = url; a.download = "open-recording.webm";
       document.body.appendChild(a); a.click();
    };
    mediaRecorder.start();
    isRecording = true;
    setRecordUI(true);
  }

  function setRecordUI(on) {
     const el = $("recordStatus");
     if(el) el.textContent = on ? "Recording..." : "";
  }

  // =========================
  // INIT
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    if (isPlayerPage()) {
        applyModeClasses();
        window.addEventListener("hashchange", applyModeClasses);

        $("playNow").addEventListener("click", startFromUI);
        $("stop").addEventListener("click", () => stopAllManual(false));

        applyControls(loadState());

        $("tone")?.addEventListener("input", (e) => {
          $("hzReadout").textContent = e.target.value;
          saveState(readControls());
        });
        
        document.addEventListener("visibilitychange", handleVisibilityChange);
        
        // Hotkeys
        document.addEventListener("keydown", (e) => {
            if(e.shiftKey && e.key.toLowerCase() === "r") toggleRecording();
            if(e.shiftKey && e.key.toLowerCase() === "e") renderWavExport();
        });

        if (isPopoutMode()) {
          document.body.classList.add("popout");
          setButtonState("stopped");
        }
    } else {
        // Launcher page logic
        $("launchPlayer")?.addEventListener("click", launchPlayer);
    }
  });

})();
