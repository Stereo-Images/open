(() => {
  const STATE_KEY = "open_player_v78_composer";

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
      const v = state?.songDuration ? String(state.songDuration) : "60";
      sd.value = allowed.has(v) ? v : "60";
    }

    let toneVal = 110;
    if (state?.tone) {
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
  // GLOBAL AUDIO GRAPH
  // =========================
  let ctx = null;
  let masterGain = null;
  let reverbNode = null;
  let reverbGain = null; // The "Return" track
  let isPlaying = false;
  let schedulerTimer = null;
  
  // Session State
  let sessionStartTime = 0;
  let nextEventTime = 0;
  let sessionDensity = 0.2; // Notes per second (approx)
  
  // COMPOSITIONAL STATE
  let currentKey = { circlePos: 0, isMinor: false };
  let phraseStep = 0; // 0-15 (16 step phrases)
  let phraseLength = 16;
  let scaleIndex = 0; // Current walker position
  let sessionMotif = []; // Array of relative intervals (e.g. [0, 2, 4])

  function initAudio() {
    if (ctx) return;
    const CtxClass = window.AudioContext || window.webkitAudioContext;
    ctx = new CtxClass();
    
    // MASTER BUS (Headroom: 0.3)
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.3; 
    masterGain.connect(ctx.destination);

    // REVERB BUS (Global Instance)
    reverbNode = ctx.createConvolver();
    reverbNode.buffer = createImpulseResponse(ctx);
    
    reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.7; // Return level (Wet Mix)
    
    reverbNode.connect(reverbGain);
    reverbGain.connect(masterGain);

    // Wake Lock
    const silent = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = silent;
    source.loop = true;
    source.start();
    source.connect(ctx.destination);
  }

  function createImpulseResponse(context) {
    // 6.0s Tail, slightly darker decay
    const duration = 6.0;
    const decay = 2.0;
    const len = context.sampleRate * duration;
    const buffer = context.createBuffer(2, len, context.sampleRate);
    
    for (let c = 0; c < 2; c++) {
      const channel = buffer.getChannelData(c);
      for (let i = 0; i < len; i++) {
        // Standard white noise with exponential decay
        channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buffer;
  }

  // =========================
  // COMPOSITION ENGINE
  // =========================
  function generateSessionMotif() {
    // Create a 3-5 note "Seed" that we will recall later
    const len = 3 + Math.floor(Math.random() * 3);
    const motif = [0]; // Always start on root relative
    let walker = 0;
    for (let i=1; i<len; i++) {
        // Simple steps: +/- 1 or 2 scale degrees
        walker += (Math.random() < 0.5 ? 1 : -1) * (Math.random() < 0.3 ? 2 : 1);
        motif.push(walker);
    }
    return motif;
  }

  function getScaleFreq(baseFreq, index, keyState) {
    // 1. Determine Root from Circle of Fifths
    let pos = keyState.circlePos % 12;
    if (pos < 0) pos += 12;
    let semitones = (pos * 7) % 12; 
    
    // 2. Adjust for Minor
    let rootOffset = keyState.isMinor ? (semitones + 9) % 12 : semitones;

    // 3. Select Scale Intervals
    const intervals = keyState.isMinor 
        ? [0, 2, 3, 5, 7, 8, 10] // Natural Minor
        : [0, 2, 4, 5, 7, 9, 11]; // Major

    // 4. Calculate Note
    const len = intervals.length;
    const octave = Math.floor(index / len);
    const degree = ((index % len) + len) % len;
    
    const midiValue = rootOffset + intervals[degree] + (octave * 12);
    
    // 5. Convert to Hz (Equal Temperament)
    return baseFreq * Math.pow(2, midiValue / 12);
  }

  function updateGlobalHarmony(elapsed, totalDuration) {
      if (totalDuration <= 60) return; // Static for short runs

      const r = Math.random();
      
      // 5 Minutes: Pivot Mode (Relative Minor/Major)
      if (totalDuration <= 300) {
          if (r < 0.05) { 
              currentKey.isMinor = !currentKey.isMinor; 
              console.log("Harmony: Pivot");
          }
          return;
      }

      // 30m / Infinite: The Traveler
      // Move around Circle of Fifths
      if (r < 0.02) {
          // 20% chance to flip mode, 80% chance to move circle
          if (Math.random() < 0.2) currentKey.isMinor = !currentKey.isMinor;
          else currentKey.circlePos += (Math.random() < 0.6 ? 1 : -1);
          console.log(`Harmony: Move to ${currentKey.circlePos} ${currentKey.isMinor ? 'm' : ''}`);
      }
  }

  // =========================
  // SCHEDULER
  // =========================
  function scheduleNoteEvent(time) {
    // 1. DYNAMICS & PHRASING
    // Where are we in the phrase?
    phraseStep++;
    if (phraseStep >= phraseLength) phraseStep = 0;

    const isStartOfPhrase = (phraseStep === 0);
    const isEndOfPhrase = (phraseStep > 12);
    
    // Velocity: Loudest at start, quietest in middle
    let velocity = 0.3 + Math.random() * 0.4; 
    if (isStartOfPhrase) velocity = 0.8;
    if (isEndOfPhrase) velocity = 0.2; // Fade out

    // 2. NOTE SELECTION
    const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");
    let targetIndex = scaleIndex;
    let isMotif = false;

    // A. MOTIF INJECTION (20% chance, but mostly in middle of phrase)
    if (!isStartOfPhrase && !isEndOfPhrase && Math.random() < 0.2) {
        // Pick a note from our seed motif
        const motifNote = sessionMotif[Math.floor(Math.random() * sessionMotif.length)];
        // Transpose it to where we are roughly
        targetIndex = scaleIndex + motifNote;
        isMotif = true;
    } 
    // B. CADENCE LOGIC (End of phrase)
    else if (isEndOfPhrase) {
        // Gravitate towards Root (0) or Fifth (4)
        const target = (Math.random() < 0.7) ? 0 : 4;
        // Move scaleIndex closer to that target relative to current octave
        const currentMod = scaleIndex % 7;
        const diff = target - currentMod;
        targetIndex = scaleIndex + diff;
    }
    // C. RANDOM WALK (Standard)
    else {
        const step = (Math.random() < 0.5 ? 1 : -1) * (Math.random() < 0.3 ? 2 : 1);
        targetIndex = scaleIndex + step;
    }
    
    // Bounds Check
    if (targetIndex > 14) targetIndex -= 7;
    if (targetIndex < -14) targetIndex += 7;
    scaleIndex = targetIndex;

    const freq = getScaleFreq(baseFreq, scaleIndex, currentKey);
    const dur = isEndOfPhrase ? 4.0 : (1.5 + Math.random()); // Longer notes at cadence

    // 3. SYNTHESIS (2-Voice FM)
    const voiceCount = 2;
    // Attack: Fast for start of phrase, Slow/Swell for end
    const attack = isStartOfPhrase ? 0.02 : (0.5 + Math.random()); 

    for (let i = 0; i < voiceCount; i++) {
        const osc = ctx.createOscillator();
        const mod = ctx.createOscillator();
        const modGain = ctx.createGain();
        
        // MIXING: DRY vs WET
        // Each note has its own path to Master (Dry) and Reverb (Wet)
        const dryNode = ctx.createGain();
        const sendNode = ctx.createGain();

        // FM Setup
        const ratio = (i === 0) ? 1.0 : (1.0 + Math.random() * 0.02); // Detune 2nd voice slightly
        const modIdx = 2 + Math.random() * 3;

        osc.frequency.value = freq * ratio;
        mod.frequency.value = freq * ratio * (1 + Math.floor(Math.random() * 3)); // Integer ratios

        modGain.gain.value = freq * modIdx;
        
        mod.connect(modGain);
        modGain.connect(osc.frequency);
        osc.connect(dryNode);
        osc.connect(sendNode);

        // ENVELOPES
        const now = time;
        
        // Amplitude Envelope
        dryNode.gain.setValueAtTime(0, now);
        dryNode.gain.linearRampToValueAtTime(velocity * (0.8 / voiceCount), now + attack);
        dryNode.gain.exponentialRampToValueAtTime(0.001, now + dur);

        // Send Envelope (More reverb on quiet/end notes)
        const sendAmt = isEndOfPhrase ? 0.8 : 0.4;
        sendNode.gain.setValueAtTime(0, now);
        sendNode.gain.linearRampToValueAtTime(sendAmt * (1.0 / voiceCount), now + attack);
        sendNode.gain.exponentialRampToValueAtTime(0.001, now + dur);

        // ROUTING
        dryNode.connect(masterGain);
        sendNode.connect(reverbNode); // Connect to Global Reverb

        // START/STOP
        osc.start(now);
        mod.start(now);
        osc.stop(now + dur + 1);
        mod.stop(now + dur + 1);
        
        // Garbage collect nodes after stop
        setTimeout(() => {
            osc.disconnect(); mod.disconnect(); 
            dryNode.disconnect(); sendNode.disconnect();
        }, (dur + 1.5) * 1000);
    }
  }

  function runScheduler() {
    const lookahead = 0.1;
    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const totalDuration = (durationInput === "infinite") ? 99999 : parseFloat(durationInput);

    if (!isPlaying) return;

    // Check End of Song
    if (durationInput !== "infinite" && (ctx.currentTime - sessionStartTime) > totalDuration) {
        stopPlayback();
        return;
    }

    // Schedule Events
    while (nextEventTime < ctx.currentTime + lookahead) {
        scheduleNoteEvent(nextEventTime);
        
        // Update Harmony for next time
        updateGlobalHarmony(ctx.currentTime - sessionStartTime, totalDuration);

        // Next time logic (Stochastic)
        // Fast in middle of phrase, Slow at end
        let stepTime = (1 / sessionDensity); 
        if (phraseStep > 12) stepTime *= 1.5; // Slow down cadence
        
        nextEventTime += stepTime * (0.8 + Math.random() * 0.4);
    }
    
    schedulerTimer = requestAnimationFrame(runScheduler);
  }

  // =========================
  // CONTROL LOGIC
  // =========================
  function startPlayback() {
    initAudio();
    if (ctx.state === "suspended") ctx.resume();

    // Reset State
    sessionStartTime = ctx.currentTime;
    nextEventTime = ctx.currentTime + 0.1;
    phraseStep = 0;
    scaleIndex = 0;
    currentKey = { circlePos: 0, isMinor: false };
    
    // 1. Session Variables (Density & Motif)
    sessionDensity = 0.15 + Math.random() * 0.25; // 0.15 to 0.4 notes/sec
    sessionMotif = generateSessionMotif();
    console.log("Session Motif:", sessionMotif);

    // 2. Master Fade In (Smooth)
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setValueAtTime(0, ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 2.0);

    isPlaying = true;
    setButtonState("playing");
    runScheduler();
  }

  function stopPlayback() {
    if (!isPlaying || !ctx) return;
    isPlaying = false;
    cancelAnimationFrame(schedulerTimer);
    setButtonState("stopped");

    // THE ANTI-CLICK STOP
    // 1. Cancel any future automation
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    
    // 2. Set Target to 0 (Analog Discharge Curve)
    // This is mathematically strictly continuous (no jumps)
    masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);

    // 3. Suspend context after fade is likely complete (1s)
    // We do NOT disconnect the graph, we just pause the time.
    setTimeout(() => {
        // Optional: ctx.suspend(); 
        // We keep it running usually for Reverb tail, but since we zeroed Master, it's silent.
    }, 1000);
  }

  // =========================
  // INIT
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    if (isPopoutMode()) {
        document.body.classList.add("popout");
        applyControls(loadState());
        
        document.getElementById("tone")?.addEventListener("input", (e) => {
            const ro = document.getElementById("hzReadout");
            if (ro) ro.textContent = e.target.value;
            saveState(readControls());
        });

        document.getElementById("songDuration")?.addEventListener("change", () => saveState(readControls()));
        
        document.getElementById("playNow").onclick = startPlayback;
        document.getElementById("stop").onclick = stopPlayback;
        
        setButtonState("stopped");
    }

    const launchBtn = document.getElementById("launchPlayer");
    if (launchBtn) {
        launchBtn.addEventListener("click", () => {
            if (!isPopoutMode() && isMobileDevice()) {
                document.body.classList.add("mobile-player");
                applyControls(loadState());
                // Attach listeners similarly for mobile mode...
                document.getElementById("playNow").onclick = startPlayback;
                document.getElementById("stop").onclick = stopPlayback;
            } else {
                window.open(`${window.location.href.split("#")[0]}#popout`, "open_player", "width=500,height=680,resizable=yes");
            }
        });
    }
  });
})();
