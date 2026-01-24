(() => {
  const STATE_KEY = "open_player_final_v48";

  // =========================
  // UTILITIES & UI
  // =========================
  function isPopoutMode() { return window.location.hash === "#popout"; }
  function isMobileDevice() {
    const ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod|Android/i.test(ua) || (window.matchMedia?.("(pointer: coarse)")?.matches && window.matchMedia?.("(max-width: 820px)")?.matches);
  }

  function loadState() { const raw = localStorage.getItem(STATE_KEY); return raw ? JSON.parse(raw) : null; }
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
    if (sd) sd.value = state?.songDuration || "60";
    let toneVal = state?.tone ? Math.max(30, Math.min(200, Number(state.tone))) : 110;
    if (tone) tone.value = String(toneVal);
    if (hzReadout) hzReadout.textContent = String(toneVal);
  }

  function setButtonState(state) {
    const playBtn = document.getElementById("playNow");
    const stopBtn = document.getElementById("stop");
    const toneInput = document.getElementById("tone");
    
    if (!playBtn || !stopBtn) return;
    
    playBtn.classList.toggle("filled", state === "playing");
    stopBtn.classList.toggle("filled", state !== "playing");
    
    if (toneInput) toneInput.disabled = (state === "playing");
  }

  // =========================
  // SHARED AUDIO LOGIC
  // =========================
  const scales = { major: [0, 2, 4, 5, 7, 9, 11] }; 
  let runMood = "major";

  function createReverbBuffer(ctx) {
    // 8.0s Decay: Preserves the "Cathedral" space
    const duration = 8.0, decay = 2.0, rate = ctx.sampleRate, length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return impulse;
  }

  // FIXED MOTIFS (The "Bells")
  // 4 vs 5 steps ensures complex phasing patterns
  const motifA = [0, 4, 0, 6]; 
  const motifB = [0, 2, 4, 6, 8]; 

  function getNextPatternNote(baseFreq, patternIndex, patternArray, minOct, maxOct, harmonicRootIndex) {
    const scale = scales[runMood];
    const len = scale.length;
    const noteOffset = patternArray[patternIndex % patternArray.length];
    
    // Calculate raw index based on Harmonic Root + Motif Offset
    // +3 shifts it to the middle register
    let rawIndex = harmonicRootIndex + noteOffset + 3; 

    const absoluteMin = minOct * len;
    const absoluteMax = (maxOct + 1) * len - 1;
    if (rawIndex < absoluteMin) rawIndex = absoluteMin;
    if (rawIndex > absoluteMax) rawIndex = absoluteMax;

    const octave = Math.floor(rawIndex / len);
    const noteDegree = ((rawIndex % len) + len) % len;
    const interval = scale[noteDegree];
    
    return { 
        freq: baseFreq * Math.pow(2, (interval / 12) + octave),
        newPatternIndex: patternIndex + 1
    };
  }

  // CORE GENERATOR: PURE SINE FM
  // No compression. No limiting. Pure math.
  function scheduleNote(ctx, destination, freq, time, duration, volume, reverbBuffer, complexity) {
    const numVoices = 2; 
    
    // 1. REVERB PATH (Parallel / Aux Send)
    const conv = ctx.createConvolver();
    conv.buffer = reverbBuffer;
    const revGain = ctx.createGain();
    revGain.gain.value = 1.3; // High wet mix for distance
    conv.connect(revGain);
    revGain.connect(destination); // Reverb goes to master

    const voices = Array.from({length: numVoices}, () => {
      // FM RATIOS
      // Complexity pushes the ratio from Integer (Harmonic) to Decimal (Inharmonic/Metallic)
      const baseRatio = 1.5 + (Math.random() * 0.5); 
      const alienRatio = 1.1 + (Math.random() * 3.0); 
      const ratio = baseRatio + ((alienRatio - baseRatio) * complexity);
      
      // FM INDEX
      // Determines brightness
      const modIdx = 50 + (Math.random() * 200);
      return { modRatio: ratio, modIndex: modIdx, amp: Math.random() };
    });

    voices.forEach(voice => {
      const carrier = ctx.createOscillator();
      const carrier2 = ctx.createOscillator(); 
      const modulator = ctx.createOscillator();
      
      const modGain = ctx.createGain();
      const ampGain = ctx.createGain();

      // STRICT SINE WAVE POLICY
      carrier.type = 'sine';   
      carrier2.type = 'sine';  
      modulator.type = 'sine'; 

      // Carrier Frequency with tiny random drift for analog feel
      carrier.frequency.value = freq + (Math.random() - 0.5) * 2;
      carrier2.frequency.value = freq;
      
      // Detuning the second carrier creates the "beating" effect of a physical bell
      carrier2.detune.value = 2 + (complexity * 8) + (Math.random() * 2); 

      // FM CONFIGURATION
      modulator.frequency.value = freq * voice.modRatio;
      modGain.gain.setValueAtTime(freq * voice.modIndex, time);
      modGain.gain.exponentialRampToValueAtTime(freq * 0.5, time + duration); // Timbre darkens over time

      // AMPLITUDE ENVELOPE
      // Linear attack (50ms) to simulate the mass of a heavy bell being struck
      ampGain.gain.setValueAtTime(0.0001, time);
      ampGain.gain.linearRampToValueAtTime(volume * 0.6, time + 0.05); // Lowered gain to prevent clipping
      ampGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      // ROUTING
      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      modGain.connect(carrier2.frequency); 
      
      carrier.connect(ampGain);
      carrier2.connect(ampGain);
      
      // OUTPUT SPLIT
      ampGain.connect(conv); // Wet
      ampGain.connect(destination); // Dry

      [carrier, carrier2, modulator].forEach(n => {
          n.start(time);
          n.stop(time + duration);
      });
    });
  }

  // =========================
  // LOGIC: HARMONY & PHYSICS
  // =========================
  function calculateProgress(elapsed, durationInput) {
    let totalDuration = parseFloat(durationInput);
    if (durationInput === "infinite") {
        totalDuration = 3600; 
        const doubleCycle = totalDuration * 2;
        const p = (elapsed % doubleCycle) / totalDuration; 
        return (p <= 1.0) ? p : (2.0 - p); // Ping-Pong
    } else {
        // Cap at 1.0, but allow engine to run past it for phase quantization
        return Math.min(1.0, elapsed / totalDuration);
    }
  }

  function getHarmonicRoot(progress, durationInput) {
    let totalSeconds = parseFloat(durationInput);
    if (durationInput === "infinite") totalSeconds = 3600;

    let sequence = [];
    
    if (totalSeconds <= 120) {
        // THE HAIKU (< 2 mins)
        // I -> V -> ii (Ambiguous Ending)
        sequence = [
            { t: 0.5, chord: 0 }, // I
            { t: 0.8, chord: 4 }, // V
            { t: 1.0, chord: 1 }  // ii
        ];
    } 
    else if (totalSeconds <= 600) {
        // THE SKETCH (2 - 10 mins)
        // I -> vi -> V -> ii
        sequence = [
            { t: 0.3, chord: 0 }, // I
            { t: 0.6, chord: 5 }, // vi
            { t: 0.85, chord: 4 }, // V
            { t: 1.0, chord: 1 }  // ii
        ];
    } 
    else {
        // THE NOVEL (10+ mins)
        // Full Jazz Progression: I -> iii -> vi -> V -> I -> ii
        sequence = [
            { t: 0.20, chord: 0 }, // I
            { t: 0.40, chord: 2 }, // iii
            { t: 0.60, chord: 5 }, // vi
            { t: 0.75, chord: 4 }, // V
            { t: 0.90, chord: 0 }, // I (False Resolution)
            { t: 1.00, chord: 1 }  // ii (Departure)
        ];
    }

    for (let i = 0; i < sequence.length; i++) {
        if (progress < sequence[i].t) return sequence[i].chord;
    }
    return sequence[sequence.length - 1].chord; 
  }

  function getArcState(progress, durationInput) {
    const rootIndex = getHarmonicRoot(progress, durationInput);
    let ratio, complexity, minOctA, maxOctA, minOctB, maxOctB;

    if (progress < 0.2) {
        // PHASE 1: LOCKED
        ratio = 1.0; complexity = 0.1; 
        minOctA = 0; maxOctA = 1; minOctB = 0; maxOctB = 1;
    } 
    else if (progress < 0.5) {
        // PHASE 2: DRIFT (5:4 ratio)
        const p = (progress - 0.2) / 0.3;
        ratio = 1.0 + (p * 0.25); complexity = 0.2; 
        minOctA = 0; maxOctA = 1; minOctB = 0; maxOctB = 2;
    } 
    else if (progress < 0.8) {
        // PHASE 3: CLASH (3:2 ratio / Polyrhythm)
        ratio = 1.5; complexity = 0.5; 
        minOctA = -1; maxOctA = 0; minOctB = 1; maxOctB = 2;
    } 
    else if (progress < 0.95) {
        // PHASE 4: RETURN (False Resolution)
        ratio = 1.0; complexity = 0.1; 
        minOctA = 0; maxOctA = 1; minOctB = 0; maxOctB = 1;
    }
    else {
        // PHASE 5: SUSPENSION (Ending on ii)
        ratio = 1.0; complexity = 0.2; 
        minOctA = 0; maxOctA = 1; minOctB = 0; maxOctB = 1;
    }

    return { ratio, complexity, minOctA, maxOctA, minOctB, maxOctB, rootIndex };
  }

  // =========================
  // REALTIME SCHEDULER
  // =========================
  let audioContext = null, masterGain = null, streamDest = null;
  let liveReverbBuffer = null;
  let isPlaying = false, isEndingNaturally = false, isApproachingEnd = false;
  let nextTimeA = 0, nextTimeB = 0;
  let patternIdxA = 0, patternIdxB = 0;
  let sessionStartTime = 0, timerInterval = null;

  function ensureAudio() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    streamDest = audioContext.createMediaStreamDestination();
    masterGain = audioContext.createGain();
    
    // Direct connection to output (No Limiters)
    masterGain.connect(streamDest);
    masterGain.connect(audioContext.destination);

    const silentBuffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
    const heartbeat = audioContext.createBufferSource();
    heartbeat.buffer = silentBuffer;
    heartbeat.loop = true;
    heartbeat.start();
    heartbeat.connect(audioContext.destination);

    liveReverbBuffer = createReverbBuffer(audioContext);

    let videoWakeLock = document.querySelector('video');
    if (!videoWakeLock) {
        videoWakeLock = document.createElement('video');
        Object.assign(videoWakeLock.style, { position: 'fixed', bottom: '0', right: '0', width: '1px', height: '1px', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' });
        videoWakeLock.setAttribute('playsinline', '');
        videoWakeLock.setAttribute('muted', '');
        document.body.appendChild(videoWakeLock);
    }
    videoWakeLock.srcObject = streamDest.stream;
    videoWakeLock.play().catch(() => {});

    setupKeyboardShortcuts();
  }

  function scheduler() {
    if (!isPlaying) return;
    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const now = audioContext.currentTime;
    const elapsed = now - sessionStartTime;
    
    // Check if we passed the user's selected time
    if (durationInput !== "infinite") {
        const targetDuration = parseFloat(durationInput);
        if (elapsed >= targetDuration) isApproachingEnd = true;
    }
    
    const progress = calculateProgress(elapsed, durationInput);
    const arc = getArcState(progress, durationInput); 
    const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");
    
    // Spaciousness: ~7 seconds between anchor strikes
    const densityA = 0.14; 

    // ANCHOR SCHEDULER (Phase Lock Control)
    while (nextTimeA < now + 0.5) {
        // PHASE QUANTIZED ENDING LOGIC:
        // If time is up, we wait until:
        // 1. The Anchor is at index 0 (The "One")
        // 2. The Satellite is mathematically aligned (ratio approx 1.0)
        if (isApproachingEnd && !isEndingNaturally) {
            const isStartOfPattern = (patternIdxA % motifA.length === 0);
            const isPhysicallyLocked = (Math.abs(arc.ratio - 1.0) < 0.01);

            if (isStartOfPattern && isPhysicallyLocked) {
                // Play final note (long tail) and quit
                const result = getNextPatternNote(baseFreq, patternIdxA, motifA, arc.minOctA, arc.maxOctA, arc.rootIndex);
                scheduleNote(audioContext, masterGain, result.freq, nextTimeA, 8.0, 0.4, liveReverbBuffer, arc.complexity); 
                beginNaturalEnd(); 
                return; 
            }
        }

        const result = getNextPatternNote(baseFreq, patternIdxA, motifA, arc.minOctA, arc.maxOctA, arc.rootIndex);
        patternIdxA = result.newPatternIndex;
        // 4.0s duration allows the Sine FM to bloom
        scheduleNote(audioContext, masterGain, result.freq, nextTimeA, 4.0, 0.4, liveReverbBuffer, arc.complexity);
        nextTimeA += (1 / densityA); 
    }

    // SATELLITE SCHEDULER (Variable Gravity)
    while (nextTimeB < now + 0.5 && !isEndingNaturally) {
        const result = getNextPatternNote(baseFreq, patternIdxB, motifB, arc.minOctB, arc.maxOctB, arc.rootIndex);
        patternIdxB = result.newPatternIndex;
        
        const densityB = densityA * arc.ratio; 
        scheduleNote(audioContext, masterGain, result.freq, nextTimeB, 4.0, 0.4, liveReverbBuffer, arc.complexity);
        nextTimeB += (1 / densityB); 
    }
  }

  // =========================
  // WAV EXPORT
  // =========================
  async function renderWavExport() {
    if (!isPlaying && !audioContext) { alert("Please start playback first."); return; }
    
    console.log("Rendering Studio Export...");
    const sampleRate = 44100;
    // Render 75 seconds to capture a full minute + tail
    const duration = 75; 
    const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
    const offlineMaster = offlineCtx.createGain();
    offlineMaster.connect(offlineCtx.destination);
    const offlineReverbBuffer = createReverbBuffer(offlineCtx);

    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const now = audioContext.currentTime;
    const elapsed = now - sessionStartTime;
    const currentProgress = calculateProgress(elapsed, durationInput);
    const arc = getArcState(currentProgress, durationInput);
    const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");
    const densityA = 0.14;

    // Snapshot Render: Captures the current "vibe" (Ratio + Key) for 60s
    let timeA = 0; let idxA = patternIdxA;
    while (timeA < 60) {
        const result = getNextPatternNote(baseFreq, idxA, motifA, arc.minOctA, arc.maxOctA, arc.rootIndex);
        idxA = result.newPatternIndex;
        scheduleNote(offlineCtx, offlineMaster, result.freq, timeA, 4.0, 0.4, offlineReverbBuffer, arc.complexity);
        timeA += (1 / densityA);
    }
    
    let timeB = 0; let idxB = patternIdxB;
    const densityB = densityA * arc.ratio;
    while (timeB < 60) {
        const result = getNextPatternNote(baseFreq, idxB, motifB, arc.minOctB, arc.maxOctB, arc.rootIndex);
        idxB = result.newPatternIndex;
        scheduleNote(offlineCtx, offlineMaster, result.freq, timeB, 4.0, 0.4, offlineReverbBuffer, arc.complexity);
        timeB += (1 / densityB);
    }

    const renderedBuffer = await offlineCtx.startRendering();
    const wavBlob = bufferToWave(renderedBuffer, duration * sampleRate);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `open-final-v48-${Math.floor(currentProgress*100)}percent-${Date.now()}.wav`;
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
    for(let i = 0; i < abuffer.numberOfChannels; i++) channels.push(abuffer.getChannelData(i));
    while(pos < length) {
      for(let i = 0; i < numOfChan; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset])); 
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; 
        view.setInt16(pos, sample, true); pos += 2;
      }
      offset++;
    }
    return new Blob([buffer], {type: "audio/wav"});
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'r') { renderWavExport(); }
    });
  }

  function killImmediate() {
    if (timerInterval) clearInterval(timerInterval);
    if (masterGain) { masterGain.gain.cancelScheduledValues(audioContext.currentTime); masterGain.gain.setValueAtTime(1, audioContext.currentTime); }
    isPlaying = false;
  }

  async function startFromUI() {
    ensureAudio();
    if (audioContext.state === "suspended") await audioContext.resume();
    nextTimeA = audioContext.currentTime; nextTimeB = audioContext.currentTime;
    patternIdxA = 0; patternIdxB = 0;
    isEndingNaturally = false; isApproachingEnd = false;
    killImmediate();
    isPlaying = true; setButtonState("playing");
    sessionStartTime = audioContext.currentTime;
    timerInterval = setInterval(scheduler, 100); 
  }

  function stopAllManual() {
    setButtonState("stopped");
    if (!audioContext) { isPlaying = false; return; }
    isPlaying = isEndingNaturally = false;
    if (timerInterval) clearInterval(timerInterval);
    masterGain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
    setTimeout(killImmediate, 120);
  }

  function beginNaturalEnd() {
    if (isEndingNaturally) return;
    isEndingNaturally = true; isPlaying = false;
    if (timerInterval) clearInterval(timerInterval);
    masterGain.gain.setValueAtTime(masterGain.gain.value, audioContext.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 6.0);
    setTimeout(() => { killImmediate(); setButtonState("stopped"); }, 6100);
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (isPopoutMode()) {
        document.body.classList.add("popout");
        applyControls(loadState());
        document.getElementById("tone").addEventListener("input", (e) => {
            document.getElementById("hzReadout").textContent = e.target.value;
            saveState(readControls());
        });
        document.getElementById("songDuration").addEventListener("change", () => saveState(readControls()));
        document.getElementById("playNow").onclick = startFromUI;
        document.getElementById("stop").onclick = stopAllManual;
        setButtonState("stopped");
    }
    document.getElementById("launchPlayer")?.addEventListener("click", () => {
      if (!isPopoutMode() && isMobileDevice()) {
        document.body.classList.add("mobile-player");
        applyControls(loadState());
        document.getElementById("tone").addEventListener("input", (e) => {
            document.getElementById("hzReadout").textContent = e.target.value;
            saveState(readControls());
        });
        document.getElementById("playNow").onclick = startFromUI;
        document.getElementById("stop").onclick = stopAllManual;
      } else {
        window.open(`${window.location.href.split("#")[0]}#popout`, "open_player", "width=500,height=680,resizable=yes");
      }
    });
  });
})();
