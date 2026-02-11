/* ============================================================
   OPEN — v70 (Dual Engine / Full Fidelity)
   - Architecture: Decoupled Live vs. Export engines (approx 1000+ lines logic).
   - Live Engine: Optimized for memory (trackNode garbage collection).
   - Export Engine: Optimized for fidelity (independent buffers/nodes).
   - Music: 30s Bells -> 15s Saw Swell -> Random.
   - Mobile: Surgical Hard Stop (v62) + Context Release.
   ============================================================ */

(() => {
  "use strict";

  // ========================================================
  // 1. GLOBAL SETUP & ANTI-DOUBLING
  // ========================================================
  if (window.__OPEN_PLAYER_KILL__) {
    console.log("Open Player: Stopping previous instance...");
    window.__OPEN_PLAYER_KILL__();
  }
  
  window.__OPEN_PLAYER_KILL__ = () => {
    stopAllManual(true);
    if (audioContext) try { audioContext.close(); } catch {}
  };

  const STATE_KEY = "open_player_settings_v70";

  // ========================================================
  // 2. TUNING & CONSTANTS
  // ========================================================
  const MELODY_FLOOR_HZ = 220;    // A3
  const DRONE_FLOOR_HZ  = 87.31;  // F2
  const DRONE_GAIN_MULT = 0.70;
  const MASTER_VOL = 0.32; 
  const REVERB_RETURN_LEVEL = 0.80;

  // Scheduler Tuning
  let LOOKAHEAD = 1.5;
  let SCHEDULER_INTERVAL_MS = 80;
  let MAX_EVENTS_PER_TICK = 900;
  
  // Mobile Flag for Hard Reset
  let closeCtxAfterStop = false;

  // Vertical Structure Definition
  const MOVEMENTS = {
    NORMAL:  { density: 0.25, type: "bell", duration: 35 },
    SPARSE:  { density: 0.08, type: "bell", duration: 30 },
    VOID:    { density: 0.00, type: "none", duration: 15 },
    CHORUS:  { density: 1.20, type: "swarm", duration: 16 } 
  };

  // ========================================================
  // 3. UTILITIES
  // ========================================================
  const $ = (id) => document.getElementById(id);
  
  function clampFreqMin(freq, floorHz) {
    while (freq < floorHz) freq *= 2;
    return freq;
  }
  
  function clamp01(x) { 
    return Math.max(0, Math.min(1, x)); 
  }
  
  function announce(msg) {
    const live = $("playerStatus") || $("recordStatus");
    if (live) live.textContent = msg;
  }
  
  function isTypingTarget(el) {
    return el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName.toUpperCase());
  }

  // ========================================================
  // 4. DEVICE DETECTION & INIT
  // ========================================================
  function isLauncherPage() { return !!$("launchPlayer"); }
  function isPlayerPage() { return !!$("playNow"); }
  
  function isMobileDevice() {
    const ua = navigator.userAgent || "";
    // Standard Mobile Check
    const basic = /iPhone|iPad|iPod|Android/i.test(ua);
    // iPad Pro "Desktop Mode" Check
    const ipadPro = (navigator.maxTouchPoints > 0) && /Macintosh/i.test(ua);
    return basic || ipadPro;
  }
  
  // Tune Scheduler for Mobile JS Throttling
  if (isMobileDevice()) {
    LOOKAHEAD = 3.0; 
    SCHEDULER_INTERVAL_MS = 120; 
    MAX_EVENTS_PER_TICK = 1400;
  }

  function launchPlayer() {
    if (isMobileDevice()) { 
      window.location.href = "player.html"; 
      return; 
    }
    const w = 520, h = 720;
    const l = (window.screen.width/2)-(w/2);
    const t = (window.screen.height/2)-(h/2);
    window.open("player.html", "open_player", `width=${w},height=${h},left=${l},top=${t}`);
  }

  // ========================================================
  // 5. STATE MANAGEMENT
  // ========================================================
  function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch { return null; } }
  function saveState(state) { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {} }
  
  function readControls() {
    return {
      songDuration: $("songDuration")?.value ?? "60",
      tone: $("tone")?.value ?? "110"
    };
  }

  function applyControls(state) {
    const sd = $("songDuration"), tone = $("tone"), hz = $("hzReadout");
    if (sd) {
      const val = String(state?.songDuration);
      const allowed = ["60","300","600","1800","infinite"];
      sd.value = allowed.includes(val) ? val : "60";
    }
    let tVal = 110;
    if (state?.tone) tVal = Math.max(100, Math.min(200, Number(state.tone)));
    if (tone) tone.value = tVal;
    if (hz) hz.textContent = tVal;
  }

  // ========================================================
  // 6. AUDIO CORE (SHARED)
  // ========================================================
  let audioContext = null;
  let bus = null;
  let bridgeAudioEl = null;
  let cachedImpulseBuffer = null;

  // RNG System
  let sessionSeed = 0;
  let rng = Math.random;
  
  function mulberry32(a) { 
    return function() { 
      var t=a+=0x6D2B79F5; 
      t=Math.imul(t^t>>>15,t|1); 
      t^=t+Math.imul(t^t>>>7,t|61); 
      return((t^t>>>14)>>>0)/4294967296; 
    }
  }
  
  function setSeed(s) { 
    sessionSeed=s; 
    rng=mulberry32(s); 
  }
  
  function rand() { return rng(); }
  function chance(p) { return rand() < p; }

  // Reverb Generation (Shared by Live and Export)
  function createImpulseResponse(ctx, seed) {
    // If context matches cache, reuse
    if (cachedImpulseBuffer?.sampleRate === ctx.sampleRate) return cachedImpulseBuffer;
    
    // On mobile live, use shorter tail to save CPU. On Export, always use full quality.
    const isExport = (ctx instanceof OfflineAudioContext);
    const dur = (isMobileDevice() && !isExport) ? 4.0 : 10.0;
    
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const r = mulberry32((seed ^ 0xC0FFEE) >>> 0);
    
    for (let c=0; c<2; c++) {
      const d = buf.getChannelData(c);
      for (let i=0; i<len; i++) {
        // Pink-ish noise decay
        d[i] = (r()*2-1) * Math.pow(1-i/len, 2.8);
      }
    }
    
    // Only cache if it's the live context
    if (!isExport) cachedImpulseBuffer = buf;
    return buf;
  }

  // ========================================================
  // 7. LIVE ENGINE (Real-time Playback)
  // ========================================================
  const activeNodes = new Set();
  const bellNodes = new Set(); 

  // Live Node Tracking
  function trackNode(ctx, n, type="general") {
    if (n && ctx === audioContext) {
        activeNodes.add(n);
        if (type === "bell") bellNodes.add(n);
    }
    return n;
  }
  
  function killAllActiveNodes() {
    for (const n of Array.from(activeNodes)) {
      try { n.stop?.(); n.disconnect?.(); } catch {}
      activeNodes.delete(n);
    }
    bellNodes.clear();
  }

  function fadeOutBells(time) {
    for (const n of Array.from(bellNodes)) {
        try {
            if (n.gain) {
                n.gain.cancelScheduledValues(time);
                n.gain.setTargetAtTime(0, time, 0.2); 
            }
            if (n.stop) n.stop(time + 0.5);
        } catch {}
        bellNodes.delete(n);
    }
  }

  function ensureAudioContext() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  function buildMixBus() {
    ensureAudioContext();
    teardownBusHard();
    
    const m = audioContext.createGain(); 
    m.gain.value = MASTER_VOL; 
    m.connect(audioContext.destination);
    
    const dest = audioContext.createMediaStreamDestination(); 
    m.connect(dest);
    
    const pre = audioContext.createDelay(0.1); 
    pre.delayTime.value = 0.045;
    
    const conv = audioContext.createConvolver(); 
    conv.buffer = createImpulseResponse(audioContext, sessionSeed);
    
    const lp = audioContext.createBiquadFilter(); 
    lp.type = "lowpass"; 
    lp.frequency.value = 4200;
    
    const send = audioContext.createGain(); 
    send.gain.value = 0.0;
    
    const ret = audioContext.createGain(); 
    ret.gain.value = REVERB_RETURN_LEVEL;

    send.connect(pre); 
    pre.connect(conv); 
    conv.connect(lp); 
    lp.connect(ret); 
    ret.connect(m);
    
    bus = { masterGain: m, reverbSend: send, streamDest: dest };
    
    if (!bridgeAudioEl) {
      bridgeAudioEl = document.createElement("audio");
      bridgeAudioEl.id="open-bridge"; 
      bridgeAudioEl.loop=true; 
      bridgeAudioEl.muted=false;
      document.body.appendChild(bridgeAudioEl);
    }
    bridgeAudioEl.srcObject = dest.stream;
  }

  function teardownBusHard() {
    if (!audioContext || !bus) return;
    try { bus.masterGain.gain.cancelScheduledValues(audioContext.currentTime); } catch {}
    
    killAllActiveNodes();
    
    try { bus.reverbReturn.disconnect(); } catch {}
    try { bus.masterGain.disconnect(); } catch {}
    
    if (bridgeAudioEl?.srcObject) {
      try { bridgeAudioEl.srcObject.getTracks().forEach(t => t.stop()); } catch {}
      bridgeAudioEl.srcObject = null;
    }
    bus = null;
  }

  // --- LIVE SYNTHESIS DEFINITIONS ---
  
  function scheduleSwarmLive(ctx, dest, wet, rootFreq, time, duration, vol) {
    const chordRatios = [1.0, 1.2599, 1.8877]; 
    for (let i = 0; i < 7; i++) {
        const grainOffset = time + (Math.random() * duration * 0.7);
        const grainDur = 0.5 + Math.random() * 2.0; 
        const ratio = chordRatios[Math.floor(rand() * chordRatios.length)];
        const freq = rootFreq * ratio * (0.99 + rand()*0.02); 
        
        const osc = trackNode(ctx, ctx.createOscillator(), "saw");
        const env = trackNode(ctx, ctx.createGain(), "saw");
        const pan = trackNode(ctx, ctx.createStereoPanner(), "saw");
        
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        pan.pan.value = (rand() * 2) - 1; 
        
        env.gain.setValueAtTime(0, grainOffset);
        env.gain.linearRampToValueAtTime(vol * 0.55, grainOffset + (grainDur * 0.3));
        env.gain.linearRampToValueAtTime(0, grainOffset + grainDur);
        
        osc.connect(env); env.connect(pan); pan.connect(dest); pan.connect(wet);
        osc.start(grainOffset); osc.stop(grainOffset + grainDur);
    }
  }

  function scheduleBellLive(ctx, dest, wet, freq, time, dur, vol, tension) {
    const ratio = (tension > 0.6) ? 1.618 : (1.5 + rand()*2);
    const modIdx = 1 + tension*2;
    
    const car = trackNode(ctx, ctx.createOscillator(), "bell");
    const mod = trackNode(ctx, ctx.createOscillator(), "bell");
    const modG = trackNode(ctx, ctx.createGain(), "bell");
    const ampG = trackNode(ctx, ctx.createGain(), "bell");
    const lp = trackNode(ctx, ctx.createBiquadFilter(), "bell");

    lp.frequency.value = Math.min(freq*4, 6000);
    car.frequency.value = freq;
    mod.frequency.value = freq * ratio;
    
    modG.gain.setValueAtTime(freq*modIdx, time);
    modG.gain.exponentialRampToValueAtTime(freq*0.01, time+dur*0.3);
    
    ampG.gain.setValueAtTime(0, time);
    ampG.gain.linearRampToValueAtTime(vol, time + 0.01);
    ampG.gain.exponentialRampToValueAtTime(0.001, time+dur);

    mod.connect(modG); modG.connect(car.frequency);
    car.connect(ampG); ampG.connect(lp);
    lp.connect(dest); lp.connect(wet);

    mod.start(time); car.start(time);
    mod.stop(time+dur); car.stop(time+dur);
  }

  function scheduleBassLive(ctx, dest, wet, freq, time, duration, volume) {
    const stopTime = time + duration;
    const osc = trackNode(ctx, ctx.createOscillator(), "drone");
    const mod = trackNode(ctx, ctx.createOscillator(), "drone");
    const modG = trackNode(ctx, ctx.createGain(), "drone");
    const ampG = trackNode(ctx, ctx.createGain(), "drone");
    const lp = trackNode(ctx, ctx.createBiquadFilter(), "drone");

    osc.type = "sine"; mod.type = "sine";
    osc.frequency.value = freq;
    mod.frequency.value = freq * 2.0;
    mod.detune.value = (rand() - 0.5) * 8;

    modG.gain.setValueAtTime(0, time);
    modG.gain.linearRampToValueAtTime(freq * 1.8, time + (duration * 0.5));
    modG.gain.linearRampToValueAtTime(0, stopTime);

    ampG.gain.setValueAtTime(0.0001, time);
    ampG.gain.exponentialRampToValueAtTime(volume, time + 2.0);
    ampG.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    lp.type = "lowpass";
    lp.frequency.setValueAtTime(600, time);
    lp.Q.value = 0.6;

    mod.connect(modG); modG.connect(osc.frequency);
    osc.connect(ampG); ampG.connect(lp);
    lp.connect(dest); lp.connect(wet);

    const nodes = [osc, mod, modG, ampG, lp];
    osc.onended = () => { nodes.forEach(n => { try{n.disconnect()}catch{} }); };
    
    mod.start(time); osc.start(time);
    mod.stop(stopTime); osc.stop(stopTime);
  }

  function scheduleDroneChordLive(ctx, dest, wet, rootFreq, time, duration, baseVol, quality, includeThird) {
     let f0 = clampFreqMin(rootFreq, DRONE_FLOOR_HZ);
     const thirdRatio = (quality === "min") ? Math.pow(2, 3/12) : Math.pow(2, 4/12);
     const fifthRatio = Math.pow(2, 7/12);
     const vol = baseVol * DRONE_GAIN_MULT;

     scheduleBassLive(ctx, dest, wet, f0, time, duration, vol * 0.50);
     scheduleBassLive(ctx, dest, wet, f0 * fifthRatio, time, duration, vol * 0.30);
     if (includeThird) {
       scheduleBassLive(ctx, dest, wet, f0 * thirdRatio, time, duration, vol * 0.20);
     }
  }

  // ========================================================
  // 8. LOGIC HELPERS (Shared)
  // ========================================================
  function getScaleNote(base, idx, circle, minor) {
    let pos = (circle % 12 + 12) % 12;
    let root = (pos*7)%12; if(minor) root=(root+9)%12;
    const intervals = minor ? [0,2,3,5,7,8,10] : [0,2,4,5,7,9,11];
    const oct = Math.floor(idx/7);
    const deg = ((idx%7)+7)%7;
    return base * Math.pow(2, (root + intervals[deg] + oct*12)/12);
  }

  // ========================================================
  // 9. LIVE SCHEDULER
  // ========================================================
  let isPlaying=false, isEnding=false, timerInterval=null;
  let nextTimeA=0, patternIdxA=0, sessionStart=0;
  let circlePos=0, isMinor=false, runDensity=0.2;
  let phraseStep=0, arcPos=-1, arcLen=6, arcClimax=4;
  let tension=0.0;
  let lastDroneStart = -9999;
  let lastDroneDur = 0;
  let currentMovement = "NORMAL";
  let movementTimeLeft = 0;
  let isFirstSection = true;
  let sessionSnapshot = null;

  function updateMovementLive(dt) {
    movementTimeLeft -= dt;
    if (movementTimeLeft <= 0) {
      const prevMovement = currentMovement;

      // FORCE CHORUS 2nd (Deterministic start)
      if (isFirstSection) {
         currentMovement = "CHORUS";
         isFirstSection = false;
      } 
      else if (currentMovement === "CHORUS") {
        currentMovement = "NORMAL";
        circlePos += (chance(0.5) ? 1 : -1);
        isMinor = chance(0.3); 
        announce(`Playing: Bells (New Key)`);
      } 
      else if (currentMovement === "VOID") {
        currentMovement = "NORMAL";
      } 
      else {
        const r = rand();
        if (r < 0.12) currentMovement = "VOID";
        else if (r < 0.35) currentMovement = "SPARSE";
        else if (r < 0.75) currentMovement = "NORMAL";
        else currentMovement = "CHORUS"; 
      }
      
      // KILL BELLS/DRONES ON CHORUS START
      if (currentMovement === "CHORUS" && prevMovement !== "CHORUS") {
          announce("Playing: Swell (Saw)");
          fadeOutBells(audioContext.currentTime); 
      } else if (currentMovement !== "NORMAL") {
          setButtonState("playing");
      }

      const baseDur = MOVEMENTS[currentMovement].duration;
      movementTimeLeft = baseDur * (0.8 + rand() * 0.4);
    }

    const targetDens = MOVEMENTS[currentMovement].density;
    runDensity = runDensity + (targetDens - runDensity) * 0.1;
  }

  function schedulerLive() {
    if (!isPlaying || !audioContext) return;
    const now = audioContext.currentTime;
    const limit = now + LOOKAHEAD;
    const songDur = $("songDuration")?.value ?? "60";
    
    if (songDur !== "infinite" && (now - sessionStart) > parseFloat(songDur)) {
       if (!isEnding) { 
         // Final long bell
         scheduleBellLive(audioContext, bus.masterGain, bus.reverbSend, 220, nextTimeA, 20, 0.4, 0.0);
         isEnding = true; isPlaying = false; 
         setButtonState("stopped");
       }
       return;
    }

    while (nextTimeA < limit) {
      updateMovementLive(2.5 / Math.max(0.1, runDensity)); 

      if (currentMovement === "VOID") {
        nextTimeA += 0.5;
        continue;
      }

      if (rand() < 0.3) {
         if (chance(0.2)) isMinor = !isMinor;
         else circlePos += (chance(0.5) ? 1 : -1);
      }
      phraseStep = (phraseStep+1)%16;
      if (phraseStep===0) {
        arcPos++;
        if (arcPos >= arcLen) { arcLen=4+Math.floor(rand()*5); arcPos=0; tension=0.1; }
      }

      // 4. NOTE GENERATION
      let targetIdx = patternIdxA;
      let noteType = MOVEMENTS[currentMovement].type;
      
      if (currentMovement === "CHORUS") {
         const octave = Math.floor(patternIdxA / 7);
         targetIdx = octave * 7 + 4; // Force Dominant
      }

      let freq = getScaleNote(110, targetIdx, circlePos, isMinor);
      freq = clampFreqMin(freq, MELODY_FLOOR_HZ);

      if (noteType === "swarm") {
         scheduleSwarmLive(audioContext, bus.masterGain, bus.reverbSend, freq, nextTimeA, 4.0, 0.4);
      } else {
         scheduleBellLive(audioContext, bus.masterGain, bus.reverbSend, freq, nextTimeA, 4.0, 0.4, tension);
      }
      
      // 5. DRONE GENERATION (Standard)
      // Only play standard drones if NOT in Chorus (Swarms take over there)
      const isArcStart = (arcPos === 0 && phraseStep === 0);
      const isClimax = (arcPos === arcClimax);
      const canStartDrone = (nextTimeA >= lastDroneStart + lastDroneDur * 0.65);
      const droneProb = (phraseStep===0) ? 0.18 : 0.04;

      if (canStartDrone && 
          (currentMovement === "NORMAL" || currentMovement === "SPARSE") && 
          (isArcStart || isClimax || chance(droneProb))) {
          
          let droneRootDegree = 0;
          if (!isArcStart && !isClimax) {
             if (phraseStep >= 13) droneRootDegree = chance(0.5) ? 5 : 0; 
          }

          const curRegister = Math.floor(patternIdxA / 7);
          const droneOct = Math.min(curRegister - 1, 0);
          const droneIdx = droneOct * 7 + droneRootDegree;
          let droneRootFreq = getScaleNote(110, droneIdx, circlePos, isMinor);
          
          const t0 = Math.max(nextTimeA - 0.05, audioContext.currentTime);
          let droneDur = isArcStart ? 32.0 : 22.0; 
          lastDroneStart = t0; lastDroneDur = droneDur;

          const baseVol = (isArcStart || isClimax) ? 0.40 : 0.28;
          const quality = isMinor ? "min" : "maj";
          
          scheduleDroneChordLive(audioContext, bus.masterGain, bus.reverbSend, droneRootFreq, t0, droneDur, baseVol, quality, true);
      }

      patternIdxA += (rand()<0.5 ? 1 : -1);
      nextTimeA += (1 / Math.max(0.1, runDensity)) * (0.9 + rand()*0.2);
    }
  }

  // ========================================================
  // 10. CONTROL FUNCTIONS
  // ========================================================
  async function start() {
    ensureAudioContext();
    if (audioContext.state === "suspended") await audioContext.resume();
    stopAllManual(true);
    buildMixBus();
    try { await bridgeAudioEl.play(); } catch {}

    isEnding = false; isPlaying = true;
    sessionStart = audioContext.currentTime;
    nextTimeA = sessionStart + 0.1;
    setSeed(Date.now());
    
    // START CONFIG: 30s Bells -> Chorus
    currentMovement = "NORMAL";
    movementTimeLeft = 30; 
    isFirstSection = true; 
    runDensity = 0.25;
    
    // Save snapshot for export
    sessionSnapshot = { seed: sessionSeed };

    bus.masterGain.gain.setValueAtTime(0, sessionStart);
    bus.masterGain.gain.linearRampToValueAtTime(MASTER_VOL, sessionStart+0.1);

    setButtonState("playing");
    timerInterval = setInterval(schedulerLive, SCHEDULER_INTERVAL_MS);
    schedulerLive();
  }

  function stopAllManual(instant=false, msg="Stopped") {
    isPlaying = false;
    if (timerInterval) clearInterval(timerInterval);
    
    if (typeof mediaRecorder !== 'undefined' && mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop(); } catch {}
      setRecordUI(false);
    }

    if (!instant && bus?.masterGain && audioContext) {
        const t = audioContext.currentTime;
        try {
            bus.masterGain.gain.cancelScheduledValues(t);
            bus.masterGain.gain.setValueAtTime(bus.masterGain.gain.value, t);
            bus.masterGain.gain.linearRampToValueAtTime(0, t + 0.10);
        } catch {}
        setTimeout(() => teardownBusHard(), 150);
    } else {
        teardownBusHard();
    }

    if (instant && closeCtxAfterStop && audioContext) {
        try { audioContext.close(); } catch {}
        audioContext = null; 
    }

    setButtonState("stopped");
    announce(msg);
  }

  function beginNaturalEnd() {
    isEndingNaturally = true;
    isPlaying = false; 
    if (timerInterval) clearInterval(timerInterval);
    setButtonState("stopped");
  }

  function setButtonState(state) {
    const p = $("playNow"), s = $("stop"), t = $("tone");
    if (p) { p.classList.toggle("filled", state==="playing"); p.setAttribute("aria-pressed", state==="playing"); }
    if (s) { s.classList.toggle("filled", state!=="playing"); }
    if (t) t.disabled = (state==="playing");
    
    let status = "Stopped";
    if (state === "playing") {
        status = (currentMovement === "CHORUS") ? "Playing: Swell (Saw)" : 
                 (currentMovement === "VOID")   ? "Playing: Silence" : "Playing: Bells & Drone";
    }
    announce(status);
  }

  // ========================================================
  // 11. EXPORT ENGINE (DECOUPLED)
  // ========================================================
  // This section replicates the Live Logic but uses independent definitions
  // to avoid sharing scope/nodes with the live AudioContext.
  
  // -- Offline Synths --
  function scheduleSwarmOffline(ctx, dest, wet, rootFreq, time, duration, vol) {
    const chordRatios = [1.0, 1.2599, 1.8877]; 
    for (let i = 0; i < 7; i++) {
        const grainOffset = time + (Math.random() * duration * 0.7);
        const grainDur = 0.5 + Math.random() * 2.0; 
        const ratio = chordRatios[Math.floor(rand() * chordRatios.length)];
        const freq = rootFreq * ratio * (0.99 + rand()*0.02); 
        
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const pan = ctx.createStereoPanner();
        
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        pan.pan.value = (rand() * 2) - 1; 
        
        env.gain.setValueAtTime(0, grainOffset);
        env.gain.linearRampToValueAtTime(vol * 0.55, grainOffset + (grainDur * 0.3));
        env.gain.linearRampToValueAtTime(0, grainOffset + grainDur);
        
        osc.connect(env); env.connect(pan); pan.connect(dest); pan.connect(wet);
        osc.start(grainOffset); osc.stop(grainOffset + grainDur);
    }
  }

  function scheduleBellOffline(ctx, dest, wet, freq, time, dur, vol, tension) {
    const ratio = (tension > 0.6) ? 1.618 : (1.5 + rand()*2);
    const modIdx = 1 + tension*2;
    
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modG = ctx.createGain();
    const ampG = ctx.createGain();
    const lp = ctx.createBiquadFilter();

    lp.frequency.value = Math.min(freq*4, 6000);
    car.frequency.value = freq;
    mod.frequency.value = freq * ratio;
    
    modG.gain.setValueAtTime(freq*modIdx, time);
    modG.gain.exponentialRampToValueAtTime(freq*0.01, time+dur*0.3);
    
    ampG.gain.setValueAtTime(0, time);
    ampG.gain.linearRampToValueAtTime(vol, time + 0.01);
    ampG.gain.exponentialRampToValueAtTime(0.001, time+dur);

    mod.connect(modG); modG.connect(car.frequency);
    car.connect(ampG); ampG.connect(lp);
    lp.connect(dest); lp.connect(wet);

    mod.start(time); car.start(time);
    mod.stop(time+dur); car.stop(time+dur);
  }

  function scheduleBassOffline(ctx, dest, wet, freq, time, duration, volume) {
    const stopTime = time + duration;
    const osc = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modG = ctx.createGain();
    const ampG = ctx.createGain();
    const lp = ctx.createBiquadFilter();

    osc.type = "sine"; mod.type = "sine";
    osc.frequency.value = freq;
    mod.frequency.value = freq * 2.0;
    mod.detune.value = (rand() - 0.5) * 8;

    modG.gain.setValueAtTime(0, time);
    modG.gain.linearRampToValueAtTime(freq * 1.8, time + (duration * 0.5));
    modG.gain.linearRampToValueAtTime(0, stopTime);

    ampG.gain.setValueAtTime(0.0001, time);
    ampG.gain.exponentialRampToValueAtTime(volume, time + 2.0);
    ampG.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    lp.type = "lowpass";
    lp.frequency.setValueAtTime(600, time);
    lp.Q.value = 0.6;

    mod.connect(modG); modG.connect(osc.frequency);
    osc.connect(ampG); ampG.connect(lp);
    lp.connect(dest); lp.connect(wet);
    
    mod.start(time); osc.start(time);
    mod.stop(stopTime); osc.stop(stopTime);
  }

  async function renderWavExport() {
    if (!sessionSnapshot?.seed) { alert("Press Play once first."); return; }
    setSeed(sessionSnapshot.seed);

    const durationInput = $("songDuration")?.value ?? "60";
    const exportDuration = (durationInput === "infinite") ? 180 : Math.min(180, parseFloat(durationInput));
    const sampleRate = 44100;
    const offlineCtx = new OfflineAudioContext(2, sampleRate * exportDuration, sampleRate);

    // Build Offline Bus
    const offlineMaster = offlineCtx.createGain();
    offlineMaster.gain.value = MASTER_VOL;
    offlineMaster.connect(offlineCtx.destination);

    const offlinePreDelay = offlineCtx.createDelay(0.1);
    offlinePreDelay.delayTime.value = 0.045;
    
    // Note: Passing 'sessionSnapshot.seed' ensures Impulse matches Live
    const offlineReverb = offlineCtx.createConvolver();
    offlineReverb.buffer = createImpulseResponse(offlineCtx, sessionSnapshot.seed); 
    
    const offlineReverbLP = offlineCtx.createBiquadFilter();
    offlineReverbLP.type = "lowpass"; offlineReverbLP.frequency.value = 4200; offlineReverbLP.Q.value = 0.7;
    
    const offlineSend = offlineCtx.createGain(); offlineSend.gain.value = 0.0;
    const offlineReturn = offlineCtx.createGain(); offlineReturn.gain.value = REVERB_RETURN_LEVEL;

    offlineSend.connect(offlinePreDelay); offlinePreDelay.connect(offlineReverb);
    offlineReverb.connect(offlineReverbLP); offlineReverbLP.connect(offlineReturn); offlineReturn.connect(offlineMaster);

    // -- Export Simulation State --
    let localPhraseStep = 0;
    let localArcLen = 6, localArcPos = -1, localArcClimax = 4;
    let localTension = 0.0;
    let localCirclePos = 0, localIsMinor = false;
    let localPatternIdx = 0, localTime = 0.05;
    let localRunDensity = 0.25;
    let localDroneStart = -9999, localDroneDur = 0;
    let localMovement = "NORMAL";
    let localMoveTime = 30; // 30s Start
    let localIsFirst = true;

    function localUpdateMovement(dt) {
        localMoveTime -= dt;
        if (localMoveTime <= 0) {
            if (localIsFirst) {
                localMovement = "CHORUS"; localIsFirst = false;
            } else if (localMovement === "CHORUS") {
                localMovement = "NORMAL";
                localCirclePos += (chance(0.5) ? 1 : -1);
                localIsMinor = chance(0.3);
            } else if (localMovement === "VOID") {
                localMovement = "NORMAL";
            } else {
                const r = rand();
                if (r < 0.12) localMovement = "VOID";
                else if (r < 0.35) localMovement = "SPARSE";
                else if (r < 0.75) localMovement = "NORMAL";
                else localMovement = "CHORUS";
            }
            const dur = MOVEMENTS[localMovement].duration;
            localMoveTime = dur * (0.8 + rand() * 0.4);
        }
        const target = MOVEMENTS[localMovement].density;
        localRunDensity = localRunDensity + (target - localRunDensity) * 0.1;
    }

    function localStartNewArc() {
        localArcLen = 4 + Math.floor(rand() * 5);
        localArcClimax = Math.max(2, localArcLen - 2 - Math.floor(rand() * 2));
        localArcPos = -1;
        localTension = clamp01(localTension * 0.4 + 0.05);
    }
    localStartNewArc();

    // Export Scheduler Loop
    while (localTime < exportDuration - 2.0) {
        localUpdateMovement(2.5 / Math.max(0.1, localRunDensity));

        if (localMovement === "VOID") {
            localTime += 0.5;
            continue;
        }

        if (rand() < 0.3) {
            if (chance(0.2)) localIsMinor = !localIsMinor;
            else localCirclePos += (chance(0.5) ? 1 : -1);
        }
        
        localPhraseStep = (localPhraseStep+1)%16;
        if (localPhraseStep===0) {
            localArcPos++;
            if (localArcPos >= localArcLen) localStartNewArc();
        }

        let targetIdx = localPatternIdx;
        if (localMovement === "CHORUS") {
            const oct = Math.floor(localPatternIdx / 7);
            targetIdx = oct * 7 + 4; 
        }

        let freq = getScaleNote(110, targetIdx, localCirclePos, localIsMinor);
        freq = clampFreqMin(freq, MELODY_FLOOR_HZ);
        let type = MOVEMENTS[localMovement].type;

        // Note
        if (type === "swarm") {
            scheduleSwarmOffline(offlineCtx, offlineMaster, offlineSend, freq, localTime, 4.0, 0.4);
        } else {
            scheduleBellOffline(offlineCtx, offlineMaster, offlineSend, freq, localTime, 4.0, 0.4, localTension);
        }

        // Drones
        const isStart = (localArcPos===0 && localPhraseStep===0);
        const isClimax = (localArcPos===localArcClimax);
        const canDrone = (localTime >= localDroneStart + localDroneDur * 0.65);
        const droneProb = (localPhraseStep===0) ? 0.18 : 0.04;
        
        if (canDrone && (localMovement === "NORMAL" || localMovement === "SPARSE") && (isStart || isClimax || chance(droneProb))) {
             let droneRootDegree = 0;
             if (!isStart && !isClimax) { if (localPhraseStep >= 13) droneRootDegree = chance(0.5) ? 5 : 0; }

             const droneOct = Math.min(Math.floor(localPatternIdx/7) - 1, 0);
             const droneIdx = droneOct * 7 + droneRootDegree;
             let dRoot = getScaleNote(110, droneIdx, localCirclePos, localIsMinor);
             dRoot = clampFreqMin(dRoot, DRONE_FLOOR_HZ);

             let dDur = isStart ? 32.0 : 22.0;
             localDroneStart = localTime; localDroneDur = dDur;
             
             const fifth = Math.pow(2, 7/12);
             const third = localIsMinor ? Math.pow(2, 3/12) : Math.pow(2, 4/12);
             const vol = (isStart || isClimax ? 0.40 : 0.28) * DRONE_GAIN_MULT;

             scheduleBassOffline(offlineCtx, offlineMaster, offlineSend, dRoot, localTime, dDur, vol*0.5);
             scheduleBassOffline(offlineCtx, offlineMaster, offlineSend, dRoot*fifth, localTime, dDur, vol*0.3);
             scheduleBassOffline(offlineCtx, offlineMaster, offlineSend, dRoot*third, localTime, dDur, vol*0.2);
        }

        localPatternIdx += (rand()<0.5 ? 1 : -1);
        localTime += (1 / Math.max(0.1, localRunDensity)) * (0.9 + rand()*0.2);
    }

    const renderedBuffer = await offlineCtx.startRendering();
    const wavBlob = bufferToWave(renderedBuffer, exportDuration * sampleRate);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = `open-final-v70-${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch {} URL.revokeObjectURL(url); }, 150);
    announce("WAV downloaded");
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
    setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164);
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

  // ========================================================
  // 12. DOM & LISTENERS
  // ========================================================
  document.addEventListener("DOMContentLoaded", () => {
    if (isLauncherPage()) {
      $("launchPlayer")?.addEventListener("click", launchPlayer);
      return;
    }
    if (!isPlayerPage()) return;

    $("playNow")?.addEventListener("click", start);
    $("stop")?.addEventListener("click", () => stopAllManual(false));

    applyControls(loadState());

    $("tone")?.addEventListener("input", (e) => {
      if ($("hzReadout")) $("hzReadout").textContent = e.target.value;
      saveState(readControls());
    });
    $("songDuration")?.addEventListener("change", () => saveState(readControls()));

    // Hotkeys
    document.addEventListener("keydown", (e) => {
      if (isTypingTarget(e.target)) return;
      const k = (e.key || "").toLowerCase();
      if(e.shiftKey && k === "r") toggleRecording();
      if(e.shiftKey && k === "e") renderWavExport();
    });

    // Patch 1: Robust Background Stop (Mobile Only)
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handleVisibilityChange, { capture: true });
    window.addEventListener("blur", handleVisibilityChange, { capture: true });
    if (document.addEventListener) document.addEventListener("freeze", handleVisibilityChange, { capture: true });

    // iOS Back-Forward Cache Restore
    window.addEventListener("pageshow", (e) => {
      if (isMobileDevice() && e.persisted) {
        closeCtxAfterStop = true;
        stopAllManual(true, "Reset (restore)");
        closeCtxAfterStop = false;
      }
    }, { capture: true });

    setButtonState("stopped");
    setRecordUI(false);
  });

  // BACKGROUND HANDLER (Mobile Only)
  function handleVisibilityChange(e) {
    if (!isMobileDevice()) return; // Desktop is safe

    const type = e?.type || "";
    const isBackgrounding =
      document.hidden ||
      type === "pagehide" ||
      type === "freeze" ||
      type === "blur";

    if (!isBackgrounding) return;

    if (isPlaying || isEndingNaturally || bus) {
      closeCtxAfterStop = true;
      stopAllManual(true, "Stopped (background)");
      closeCtxAfterStop = false;
    }
  }

  // --- RECORDING ---
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;

  function setRecordUI(on) {
    const el = $("recordStatus");
    if (el) {
      el.textContent = on ? "Recording: ON" : "Recording: off";
      el.classList.toggle("recording-on", on);
    }
  }

  function toggleRecording() {
    if (!bus?.streamDest?.stream) return;
    if (isRecording) {
      isRecording = false;
      try { mediaRecorder?.stop(); } catch {}
      setRecordUI(false);
      return;
    }
    recordedChunks = [];
    try {
      const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
      const mimeType = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
      mediaRecorder = new MediaRecorder(bus.streamDest.stream, mimeType ? { mimeType } : undefined);
    } catch (e) { return; }
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `open-live-${Date.now()}.${blob.type.includes("ogg") ? "ogg" : "webm"}`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { document.body.removeChild(a); } catch {} URL.revokeObjectURL(url); }, 150);
    };
    try { mediaRecorder.start(250); } catch {}
    isRecording = true;
    setRecordUI(true);
  }

})();
