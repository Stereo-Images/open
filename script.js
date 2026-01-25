(() => {
  // STABLE KEY: Persists user settings across future updates
  const STATE_KEY = "open_player_settings";

  // =========================
  // UTILITIES & UI
  // =========================
  function isPopoutMode() { return window.location.hash === "#popout"; }
  function isMobileDevice() {
    const ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod|Android/i.test(ua) || (window.matchMedia?.("(pointer: coarse)")?.matches && window.matchMedia?.("(max-width: 820px)")?.matches);
  }

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch { return null; }
  }
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
      if (Number.isFinite(n)) toneVal = Math.max(30, Math.min(200, n));
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
  // AUDIO GRAPH (GLOBAL ARCHITECTURE)
  // =========================
  let audioContext = null;
  let masterGain = null;   
  let reverbNode = null;   
  let reverbGain = null;   
  let streamDest = null;
  
  // Playback State
  let isPlaying = false;
  let isEndingNaturally = false;
  let isApproachingEnd = false;
  let timerInterval = null;
  
  let nextTimeA = 0;
  let patternIdxA = 0; 
  let notesSinceModulation = 0;
  let sessionStartTime = 0;

  // Composition State
  let circlePosition = 0; 
  let isMinor = false; 
  let runDensity = 0.2; 
  
  // v91 STATE
  let sessionMotif = []; 
  let motifPos = 0; 
  let phraseStep = 0; 
  let pendingLTResolution = false; 

  // --- HELPERS ---
  function createImpulseResponse(ctx) {
    const duration = 5.0;
    const decay = 1.5;
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return impulse;
  }

  function mapRange(value, inMin, inMax, outMin, outMax) {
      return outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin));
  }

  function circDist(a, b) {
    const d = Math.abs(a - b);
    return Math.min(d, 7 - d);
  }

  function initAudio() {
    if (audioContext) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioContext = new Ctx();
    
    // 1. MASTER BUS (Headroom: 0.3)
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.3; 
    masterGain.connect(audioContext.destination);

    // 2. STREAM DEST
    streamDest = audioContext.createMediaStreamDestination();
    masterGain.connect(streamDest);

    // 3. GLOBAL REVERB BUS
    reverbNode = audioContext.createConvolver();
    reverbNode.buffer = createImpulseResponse(audioContext);
    
    reverbGain = audioContext.createGain();
    reverbGain.gain.value = 1.0; 
    
    reverbNode.connect(reverbGain);
    reverbGain.connect(masterGain);

    // 4. WAKE LOCK
    const silent = audioContext.createBuffer(1, 1, audioContext.sampleRate);
    const heartbeat = audioContext.createBufferSource();
    heartbeat.buffer = silent;
    heartbeat.loop = true;
    heartbeat.start();
    heartbeat.connect(audioContext.destination);

    let videoWakeLock = document.querySelector('video');
    if (!videoWakeLock) {
      videoWakeLock = document.createElement('video');
      Object.assign(videoWakeLock.style, {
        position: 'fixed', bottom: '0', right: '0',
        width: '1px', height: '1px',
        opacity: '0.01', pointerEvents: 'none', zIndex: '-1'
      });
      videoWakeLock.setAttribute('playsinline', '');
      videoWakeLock.setAttribute('muted', '');
      document.body.appendChild(videoWakeLock);
    }
    videoWakeLock.srcObject = streamDest.stream;
    videoWakeLock.play().catch(() => {});

    setupKeyboardShortcuts();
  }

  // =========================
  // NOTE SCHEDULING
  // =========================
  function scheduleNote(ctx, destination, wetDestination, freq, time, duration, volume) {
    const numVoices = 2; 
    let totalAmp = 0;
    
    const voices = Array.from({length: numVoices}, () => {
      const v = { 
          modRatio: 1.5 + Math.random() * 2.5, 
          modIndex: 1 + Math.random() * 4, 
          amp: Math.random() 
      };
      totalAmp += v.amp;
      return v;
    });

    voices.forEach(voice => {
      const carrier = ctx.createOscillator();
      const modulator = ctx.createOscillator();
      const modGain = ctx.createGain();
      const ampGain = ctx.createGain();

      carrier.type = 'sine';
      modulator.type = 'sine';

      carrier.frequency.value = freq + (Math.random() - 0.5) * 2;
      modulator.frequency.value = freq * voice.modRatio;

      modGain.gain.setValueAtTime(freq * voice.modIndex, time);
      modGain.gain.exponentialRampToValueAtTime(freq * 0.5, time + duration);

      ampGain.gain.setValueAtTime(0.0001, time);
      ampGain.gain.exponentialRampToValueAtTime((voice.amp / totalAmp) * volume, time + 0.01);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      modulator.connect(modGain); 
      modGain.connect(carrier.frequency);
      
      // Routing
      carrier.connect(ampGain);
      ampGain.connect(destination); // Dry -> Master
      ampGain.connect(wetDestination); // Wet -> Reverb

      modulator.start(time); carrier.start(time);
      modulator.stop(time + duration); carrier.stop(time + duration);
    });
  }

  // =========================
  // HARMONIC & COMPOSITION ENGINE
  // =========================
  function getScaleNote(baseFreq, scaleIndex, circlePos, minorMode, opts = {}) {
    let pos = circlePos % 12;
    if (pos < 0) pos += 12;
    let semitones = (pos * 7) % 12;
    let rootOffset = semitones;
    if (minorMode) rootOffset = (semitones + 9) % 12; 

    const majorIntervals = [0, 2, 4, 5, 7, 9, 11];
    const minorIntervals = [0, 2, 3, 5, 7, 8, 10]; 

    const len = 7;
    const octave = Math.floor(scaleIndex / len);
    const degree = ((scaleIndex % len) + len) % len;
    
    let intervals = minorMode ? minorIntervals : majorIntervals;

    // Harmonic Minor Flag
    if (minorMode && opts.raiseLeadingTone && degree === 6) {
        intervals = minorIntervals.slice(); 
        intervals[6] = 11; 
    }

    const noteValue = rootOffset + intervals[degree] + (octave * 12);
    return baseFreq * Math.pow(2, noteValue / 12);
  }

  function updateHarmonyState(durationInput) {
      const r = Math.random();
      let totalSeconds = (durationInput === "infinite") ? 99999 : parseFloat(durationInput);
      if (totalSeconds <= 60) return; 

      if (totalSeconds <= 300) { 
          if (r < 0.2) isMinor = !isMinor;
          return;
      }
      if (totalSeconds <= 1800) { 
          if (r < 0.4) isMinor = !isMinor; 
          else circlePosition += (Math.random() < 0.7 ? 1 : -1);
          return;
      }
      if (durationInput === "infinite") {
          if (!isMinor) {
              if (r < 0.7) isMinor = true; else circlePosition += (Math.random() < 0.9 ? 1 : -1);
          } else {
              if (r < 0.3) isMinor = false; else circlePosition += (Math.random() < 0.9 ? 1 : -1);
          }
      }
  }

  function generateSessionMotif() {
      const m = [0];
      let walker = 0;
      for(let i=0; i<3; i++) {
          walker += (Math.random() < 0.5 ? 1 : -1) * (Math.random() < 0.4 ? 2 : 1);
          m.push(walker);
      }
      return m;
  }

  // =========================
  // SCHEDULER (LIVE)
  // =========================
  function scheduler() {
    if (!isPlaying) return;
    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const now = audioContext.currentTime;
    const elapsed = now - sessionStartTime;

    if (durationInput !== "infinite") {
      const targetDuration = parseFloat(durationInput);
      if (elapsed >= targetDuration) isApproachingEnd = true;
    }

    const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");
    let noteDur = (1 / runDensity) * 2.5;

    while (nextTimeA < now + 0.5) {
      
      let appliedDur = noteDur;
      let clearPendingAfterNote = false; 

      // --- ENDING LOGIC ---
      if (isApproachingEnd && !isEndingNaturally) {
        if (patternIdxA % 7 === 0) { 
           const freq = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor);
           scheduleNote(audioContext, masterGain, reverbNode, freq * 0.5, nextTimeA, 25.0, 0.5);
           beginNaturalEnd();
           return;
        }
      }

      if (!isApproachingEnd) {
          let modChance = (durationInput !== "infinite" && parseFloat(durationInput) > 300) ? 0.40 : 0.10;
          if (notesSinceModulation > 16 && Math.random() < modChance) {
              updateHarmonyState(durationInput);
              notesSinceModulation = 0;
          }
      }

      // --- PHRASE & CADENCE LOGIC ---
      // Increment logic guarantees first note is Step 0 (Downbeat)
      phraseStep = (phraseStep + 1) % 16;
      if (phraseStep === 0) pendingLTResolution = false;
      const isCadence = (phraseStep >= 13);

      // --- SLOWDOWN ---
      let slowProb = 0.0;
      if (phraseStep === 15) slowProb = 0.85;
      else if (phraseStep === 0) slowProb = 0.25; 
      else if (phraseStep === 14) slowProb = 0.35;
      else if (phraseStep === 13) slowProb = 0.20;

      if (Math.random() < slowProb) {
        appliedDur *= (1.20 + Math.random() * 0.20); 
      }

      // --- NOTE SELECTION ---
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
            if (d < bestD || (d === bestD && Math.random() < 0.5)) {
              best = t; bestD = d;
            }
          }

          const landProb = (phraseStep >= 15) ? 0.85 : 0.55;
          let targetDeg = best;
          
          if (Math.random() > landProb) {
            const dir = (Math.random() < 0.65) ? -1 : 1; 
            targetDeg = (targetDeg + dir + 7) % 7;
          }

          let delta = targetDeg - deg;
          if (delta > 3) delta -= 7;
          if (delta < -3) delta += 7;

          if (Math.abs(delta) === 3) delta = -3;
          else if (delta === 0 && phraseStep <= 14 && Math.random() < 0.25) delta = -1;

          patternIdxA = currentOctave + deg + delta;

          // 2. OVERRIDES
          const leadProb14 = 0.65;
          if (phraseStep === 14 && Math.random() < leadProb14) {
             const targetDegLT = 6;
             const curOct = Math.floor(patternIdxA / 7) * 7;
             const curDeg = ((patternIdxA - curOct) % 7 + 7) % 7;
             
             let deltaLT = targetDegLT - curDeg;
             if (deltaLT > 3) deltaLT -= 7;
             if (deltaLT < -3) deltaLT += 7;
             patternIdxA += deltaLT;
             
             pendingLTResolution = true; 
          }

          const landProb15 = 0.90;
          if (phraseStep === 15) {
             if (Math.random() < (pendingLTResolution ? 0.98 : landProb15)) {
                 const targetDegRoot = 0;
                 const curOct = Math.floor(patternIdxA / 7) * 7;
                 const curDeg = ((patternIdxA - curOct) % 7 + 7) % 7;
                 
                 let deltaR = targetDegRoot - curDeg;
                 if (deltaR > 3) deltaR -= 7;
                 if (deltaR < -3) deltaR += 7;
                 patternIdxA += deltaR;
             }
             clearPendingAfterNote = true; // Defer cleanup
          }

      } else {
          // --- NON-CADENCE ---
          const useMotif = Math.random() < 0.25; 
          if (useMotif && sessionMotif.length > 0) {
              const motifInterval = sessionMotif[motifPos];
              const currentOctave = Math.floor(patternIdxA / 7) * 7;
              patternIdxA = currentOctave + motifInterval;
              motifPos = (motifPos + 1) % sessionMotif.length;
          } else {
              const r = Math.random();
              let shift = 0;
              if (r < 0.4) shift = 1; else if (r < 0.8) shift = -1; else shift = (Math.random() < 0.5 ? 2 : -2);
              patternIdxA += shift;
          }
      }

      // Bounds Check
      if (patternIdxA > 10) patternIdxA = 10;
      if (patternIdxA < -8) patternIdxA = -8;

      // --- CALCULATE FREQUENCY ---
      const degNow = ((patternIdxA - Math.floor(patternIdxA / 7) * 7) % 7 + 7) % 7;
      const raiseLT = isCadence && degNow === 6 && (phraseStep === 13 || phraseStep === 14 || pendingLTResolution);

      let freq = getScaleNote(baseFreq, patternIdxA, circlePosition, isMinor, { raiseLeadingTone: raiseLT });
      
      // --- BASS TOLL ---
      const isRoot = (patternIdxA % 7 === 0);
      const atPhraseStart = (phraseStep === 0 || phraseStep === 1);
      const atCadenceHit  = (phraseStep === 15 || phraseStep === 0);

      let tollProb = 0.0;
      if (atPhraseStart) tollProb = 0.18;
      else if (atCadenceHit) tollProb = 0.14;
      else tollProb = 0.04;

      if (isRoot && Math.random() < tollProb) {
        freq = freq * 0.5;
        const dur = (atPhraseStart || atCadenceHit) ? 20.0 : 6.0;
        scheduleNote(audioContext, masterGain, reverbNode, freq, nextTimeA, dur, 0.4);
      } else {
        scheduleNote(audioContext, masterGain, reverbNode, freq, nextTimeA, appliedDur, 0.4);
      }
      
      notesSinceModulation++;
      // Defer Cleanup
      if (clearPendingAfterNote) pendingLTResolution = false;

      nextTimeA += (1 / runDensity) * (0.95 + Math.random() * 0.1);
    }
  }

  // =========================
  // CONTROL LOGIC
  // =========================
  function killImmediate() {
    if (timerInterval) clearInterval(timerInterval);
    isPlaying = false;
  }

  function stopAllManual() {
    setButtonState("stopped");
    if (!audioContext) { isPlaying = false; return; }

    isPlaying = false;
    isEndingNaturally = false;
    if (timerInterval) clearInterval(timerInterval);

    // No-Click Discharge
    const now = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setTargetAtTime(0, now, 0.05);

    setTimeout(killImmediate, 250);
  }

  function beginNaturalEnd() {
    if (isEndingNaturally) return;
    isEndingNaturally = true; isPlaying = false;
    if (timerInterval) clearInterval(timerInterval);
    
    const now = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 20.0);

    setTimeout(() => {
      killImmediate();
      setButtonState("stopped");
    }, 20100);
  }

  async function startFromUI() {
    initAudio();
    if (audioContext.state === "suspended") await audioContext.resume();

    // Reset Master Gain
    masterGain.gain.cancelScheduledValues(audioContext.currentTime);
    masterGain.gain.setValueAtTime(0, audioContext.currentTime);
    masterGain.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.1);

    nextTimeA = audioContext.currentTime;
    patternIdxA = 0; 
    circlePosition = 0; 
    isMinor = false; 
    notesSinceModulation = 0;
    
    // NEW SESSION STATE
    phraseStep = 15; // Initializes to 15, first loop tick wraps to 0 (Downbeat)
    motifPos = 0;
    pendingLTResolution = false; 
    isEndingNaturally = false; isApproachingEnd = false;
    
    // 1. ROLL DENSITY
    runDensity = 0.05 + Math.random() * 0.375;
    
    // 2. ADAPTIVE MIX (Capped at 1.1)
    const mixLevel = mapRange(runDensity, 0.05, 0.425, 1.1, 0.75);
    reverbGain.gain.setValueAtTime(mixLevel, audioContext.currentTime);

    // 3. GENERATE MOTIF
    sessionMotif = generateSessionMotif();

    console.log(`Session: Density ${runDensity.toFixed(3)} | Return ${mixLevel.toFixed(2)} | Motif: [${sessionMotif}]`);

    killImmediate();
    isPlaying = true;
    setButtonState("playing");
    sessionStartTime = audioContext.currentTime;

    timerInterval = setInterval(scheduler, 100);
  }

  // =========================
  // EXPORT (Mirrored Logic)
  // =========================
  async function renderWavExport() {
    if (!isPlaying && !audioContext) { alert("Please start playback first."); return; }

    console.log("Rendering Studio Export...");
    const sampleRate = 44100;
    const duration = 75;
    const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
    
    const offlineMaster = offlineCtx.createGain();
    offlineMaster.gain.value = 0.3; // Headroom
    offlineMaster.connect(offlineCtx.destination);
    
    const offlineReverb = offlineCtx.createConvolver();
    offlineReverb.buffer = createImpulseResponse(offlineCtx);
    
    const offlineRevGain = offlineCtx.createGain();
    const currentMix = reverbGain.gain.value;
    offlineRevGain.gain.value = currentMix;
    
    offlineReverb.connect(offlineRevGain);
    offlineRevGain.connect(offlineMaster);

    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");
    const noteDur = (1 / runDensity) * 2.5;

    let localCircle = circlePosition;
    let localMinor = isMinor;
    let localIdx = patternIdxA;
    let localTime = 0;
    let localModCount = 0;
    let localPhraseStep = 15; // Initializes to 15, first loop wraps to 0
    let localMotifPos = 0; 
    let localPendingLT = false; 

    const totalSeconds = (durationInput === "infinite") ? 99999 : parseFloat(durationInput);

    while (localTime < 60) {
       // Modulation
       let modChance = (durationInput !== "infinite" && totalSeconds > 300) ? 0.40 : 0.10;
       if (localModCount > 16 && Math.random() < modChance) {
          const r = Math.random();
          if (totalSeconds <= 300) { if (r < 0.2) localMinor = !localMinor; }
          else {
              if (r < 0.4) localMinor = !localMinor;
              else localCircle += (Math.random() < 0.7 ? 1 : -1);
          }
          localModCount = 0;
       }

       // --- PHRASE LOGIC ---
       localPhraseStep = (localPhraseStep + 1) % 16;
       if (localPhraseStep === 0) localPendingLT = false;
       const isCadence = (localPhraseStep >= 13);

       let appliedDur = noteDur;
       let clearPendingAfterNote = false;

       let slowProb = 0.0;
       if (localPhraseStep === 15) slowProb = 0.85;
       else if (localPhraseStep === 0) slowProb = 0.25;
       else if (localPhraseStep === 14) slowProb = 0.35;
       else if (localPhraseStep === 13) slowProb = 0.20;

       if (Math.random() < slowProb) {
         appliedDur *= (1.20 + Math.random() * 0.20);
       }

       // Note Selection
       if (isCadence) {
         // Gravity
         const targets = [0, 2, 4];
         const currentOctave = Math.floor(localIdx / 7) * 7;
         let deg = localIdx - currentOctave;
         deg = ((deg % 7) + 7) % 7;

         let best = targets[0];
         let bestD = circDist(deg, best);
         for (let i = 1; i < targets.length; i++) {
           const t = targets[i];
           const d = circDist(deg, t);
           if (d < bestD || (d === bestD && Math.random() < 0.5)) {
             best = t; bestD = d;
           }
         }

         const landProb = (localPhraseStep >= 15) ? 0.85 : 0.55;
         let targetDeg = best;

         if (Math.random() > landProb) {
           const dir = (Math.random() < 0.65) ? -1 : 1;
           targetDeg = (targetDeg + dir + 7) % 7;
         }

         let delta = targetDeg - deg;
         if (delta > 3) delta -= 7;
         if (delta < -3) delta += 7;

         if (Math.abs(delta) === 3) delta = -3;
         else if (delta === 0 && localPhraseStep <= 14 && Math.random() < 0.25) delta = -1;

         localIdx = currentOctave + deg + delta;

         // Overrides
         if (localPhraseStep === 14 && Math.random() < 0.65) {
             const targetDegLT = 6;
             const curOct = Math.floor(localIdx / 7) * 7;
             const curDeg = ((localIdx - curOct) % 7 + 7) % 7;
             let deltaLT = targetDegLT - curDeg;
             if (deltaLT > 3) deltaLT -= 7;
             if (deltaLT < -3) deltaLT += 7;
             localIdx += deltaLT;
             localPendingLT = true;
         }

         if (localPhraseStep === 15) {
             if (Math.random() < (localPendingLT ? 0.98 : 0.90)) {
                 const targetDegRoot = 0;
                 const curOct = Math.floor(localIdx / 7) * 7;
                 const curDeg = ((localIdx - curOct) % 7 + 7) % 7;
                 let deltaR = targetDegRoot - curDeg;
                 if (deltaR > 3) deltaR -= 7;
                 if (deltaR < -3) deltaR += 7;
                 localIdx += deltaR;
             }
             clearPendingAfterNote = true;
         }

       } else {
         const useMotif = Math.random() < 0.25;
         if (useMotif && sessionMotif.length > 0) {
           const motifInterval = sessionMotif[localMotifPos];
           const currentOctave = Math.floor(localIdx / 7) * 7;
           localIdx = currentOctave + motifInterval;
           localMotifPos = (localMotifPos + 1) % sessionMotif.length;
         } else {
           const r = Math.random();
           let shift = 0;
           if (r < 0.4) shift = 1;
           else if (r < 0.8) shift = -1;
           else shift = (Math.random() < 0.5 ? 2 : -2);
           localIdx += shift;
         }
       }

       if (localIdx > 10) localIdx = 10;
       if (localIdx < -8) localIdx = -8;

       // FREQ
       const degNow = ((localIdx - Math.floor(localIdx / 7) * 7) % 7 + 7) % 7;
       const raiseLT = isCadence && degNow === 6 && (localPhraseStep === 13 || localPhraseStep === 14 || localPendingLT);

       let freq = getScaleNote(baseFreq, localIdx, localCircle, localMinor, { raiseLeadingTone: raiseLT });

       // BASS TOLL
       const isRoot = (localIdx % 7 === 0);
       const atPhraseStart = (localPhraseStep === 0 || localPhraseStep === 1);
       const atCadenceHit  = (localPhraseStep === 15 || localPhraseStep === 0);

       let tollProb = 0.0;
       if (atPhraseStart) tollProb = 0.18;
       else if (atCadenceHit) tollProb = 0.14;
       else tollProb = 0.04;

       if (isRoot && Math.random() < tollProb) {
         freq = freq * 0.5;
         const dur = (atPhraseStart || atCadenceHit) ? 20.0 : 6.0;
         scheduleNote(offlineCtx, offlineMaster, offlineReverb, freq, localTime, dur, 0.4);
       } else {
         scheduleNote(offlineCtx, offlineMaster, offlineReverb, freq, localTime, appliedDur, 0.4);
       }
       
       localModCount++;
       if (clearPendingAfterNote) localPendingLT = false;

       localTime += (1 / runDensity) * (0.95 + Math.random() * 0.1);
    }

    const renderedBuffer = await offlineCtx.startRendering();
    const wavBlob = bufferToWave(renderedBuffer, duration * sampleRate);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `open-final-v91-${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 100);
  }

  function bufferToWave(abuffer, len) {
    const numOfChan = abuffer.numberOfChannels, length = len * numOfChan * 2 + 44, buffer = new ArrayBuffer(length), view = new DataView(buffer), channels = [], sampleRate = abuffer.sampleRate;
    let offset = 0, pos = 0;
    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }
    setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan); setUint32(sampleRate); setUint32(sampleRate * 2 * numOfChan); setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);
    for (let i = 0; i < abuffer.numberOfChannels; i++) channels.push(abuffer.getChannelData(i));
    while (pos < length) {
      for (let i = 0; i < numOfChan; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        view.setInt16(pos, sample, true); pos += 2;
      }
      offset++;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'r') { renderWavExport(); }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (isPopoutMode()) {
      document.body.classList.add("popout");
      applyControls(loadState());

      document.getElementById("tone")?.addEventListener("input", (e) => {
        document.getElementById("hzReadout").textContent = e.target.value;
        saveState(readControls());
      });

      document.getElementById("songDuration")?.addEventListener("change", () => saveState(readControls()));

      document.getElementById("playNow").onclick = startFromUI;
      document.getElementById("stop").onclick = stopAllManual;

      setButtonState("stopped");
    }

    document.getElementById("launchPlayer")?.addEventListener("click", () => {
      if (!isPopoutMode() && isMobileDevice()) {
        document.body.classList.add("mobile-player");
        applyControls(loadState());

        document.getElementById("tone")?.addEventListener("input", (e) => {
          document.getElementById("hzReadout").textContent = e.target.value;
          saveState(readControls());
        });

        document.getElementById("songDuration")?.addEventListener("change", () => saveState(readControls()));

        document.getElementById("playNow").onclick = startFromUI;
        document.getElementById("stop").onclick = stopAllManual;

        setButtonState("stopped");
      } else {
        window.open(
          `${window.location.href.split("#")[0]}#popout`,
          "open_player",
          "width=500,height=680,resizable=yes"
        );
      }
    });
  });
})();
