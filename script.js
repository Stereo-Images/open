(() => {
  const STATE_KEY = "open_player_settings_v22";

  function safeParse(raw) {
    try { return JSON.parse(raw); } catch { return null; }
  }

  function loadState() {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? safeParse(raw) : null;
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
    if (!state) return;
    const sd = document.getElementById("songDuration");
    const tone = document.getElementById("tone");
    const hzReadout = document.getElementById("hzReadout");
    if (sd && state.songDuration != null) sd.value = state.songDuration;
    if (tone && state.tone != null) {
      tone.value = state.tone;
      if (hzReadout) hzReadout.textContent = state.tone;
    }
  }

  // =========================
  // UI HELPERS (Black/White Toggle)
  // =========================
  function updateButtons(isPlaying) {
    const playBtn = document.getElementById("playNow");
    const stopBtn = document.getElementById("stop");

    if (playBtn && stopBtn) {
      if (isPlaying) {
        // PLAYING: Play is Black (Filled), Stop is White
        playBtn.classList.add("filled");
        stopBtn.classList.remove("filled");
      } else {
        // STOPPED: Play is White, Stop is Black (Filled)
        playBtn.classList.remove("filled");
        stopBtn.classList.add("filled");
      }
    }
  }

  function showPlayerUI() {
    document.body.classList.add("active-mode");
  }

  // =========================
  // AUDIO ENGINE (Soft Start Version)
  // =========================
  let audioContext = null;
  let masterGain = null;
  let reverbNode = null;
  let reverbGain = null;

  let activeNodes = [];
  let isPlaying = false;
  let nextNoteTime = 0;
  let sessionStartTime = 0;
  let rafId = null;
  let cleanupTimer = null;

  const scheduleAheadTime = 0.5;
  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
  };
  const MOOD_CHOICES = ["major", "minor", "pentatonic"];
  const DENSITY_MIN = 0.05;
  const DENSITY_MAX = 0.425;

  let runMood = "major";
  let runDensity = 0.2;

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function randFloat(min, max) {
    return min + Math.random() * (max - min);
  }
  function rerollHiddenParamsForThisPlay() {
    runMood = pick(MOOD_CHOICES);
    runDensity = randFloat(DENSITY_MIN, DENSITY_MAX);
  }

  function ensureAudio() {
    if (audioContext) return;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
    masterGain.gain.value = 1;

    reverbNode = audioContext.createConvolver();
    reverbGain = audioContext.createGain();
    reverbGain.gain.value = 1.5; 

    createReverb();
  }

  function createReverb() {
    const duration = 5.0; 
    const decay = 1.5;
    const rate = audioContext.sampleRate;
    const length = Math.floor(rate * duration); 
    const impulse = audioContext.createBuffer(2, length, rate);

    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    reverbNode.buffer = impulse;
    reverbNode.connect(reverbGain);
    reverbGain.connect(audioContext.destination);
  }

  function playFmBell(freq, duration, volume, startTime) {
    const numVoices = 2 + Math.floor(Math.random() * 2); 
    const voices = [];
    let totalAmp = 0;

    for (let i = 0; i < numVoices; i++) {
      const modRatio = 1.5 + Math.random() * 2.5;
      const modIndex = 1 + Math.random() * 4;
      const amp = Math.random();
      voices.push({ modRatio, modIndex, amp });
      totalAmp += amp;
    }

    voices.forEach((voice) => {
      const carrier = audioContext.createOscillator();
      const modulator = audioContext.createOscillator();
      const modGain = audioContext.createGain();
      const ampGain = audioContext.createGain();

      const detune = (Math.random() - 0.5) * 2.0; 
      carrier.frequency.value = freq + detune;
      modulator.frequency.value = freq * voice.modRatio;

      const maxDeviation = freq * voice.modIndex;
      const minDeviation = freq * 0.5;

      modGain.gain.setValueAtTime(maxDeviation, startTime);
      modGain.gain.exponentialRampToValueAtTime(minDeviation, startTime + duration);

      ampGain.gain.setValueAtTime(0.0001, startTime);
      ampGain.gain.exponentialRampToValueAtTime((voice.amp / totalAmp) * volume, startTime + 0.01);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(ampGain);
      ampGain.connect(reverbNode);
      ampGain.connect(masterGain); 

      modulator.start(startTime);
      carrier.start(startTime);
      modulator.stop(startTime + duration);
      carrier.stop(startTime + duration);

      activeNodes.push(carrier, modulator, modGain, ampGain);
    });

    if (activeNodes.length > 250) activeNodes.splice(0, 120);
  }

  function scheduler() {
    if (!isPlaying) return;

    let durationInput = document.getElementById("songDuration")?.value;
    if (!durationInput || durationInput.trim() === "") durationInput = "60";

    const currentTime = audioContext.currentTime;

    if (durationInput !== "infinite") {
      const elapsed = currentTime - sessionStartTime;
      const limit = parseFloat(durationInput);
      if (!isNaN(limit) && elapsed >= limit) {
        stopAll();
        return;
      }
    }

    while (nextNoteTime < currentTime + scheduleAheadTime) {
      const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");
      const scale = scales[runMood] || scales.major;
      const interval = scale[Math.floor(Math.random() * scale.length)];
      const freq = baseFreq * Math.pow(2, interval / 12);
      const density = runDensity;               
      const dur = (1 / density) * 2.5;

      playFmBell(freq, dur, 0.4, nextNoteTime);
      const drift = 0.95 + (Math.random() * 0.1);
      nextNoteTime += (1 / density) * drift;
    }
    rafId = requestAnimationFrame(scheduler);
  }

  async function startFromUI() {
    ensureAudio();
    if (audioContext.state === "suspended") await audioContext.resume();

    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }

    rerollHiddenParamsForThisPlay();
    
    // UI: Set Play to Filled
    updateButtons(true);

    // AUDIO: Soft Start (Fade In 0->1) to prevent pop
    masterGain.gain.cancelScheduledValues(audioContext.currentTime);
    masterGain.gain.setValueAtTime(0, audioContext.currentTime);
    masterGain.gain.linearRampToValueAtTime(1, audioContext.currentTime + 0.1);

    stopAll(true); // Internal reset only
    isPlaying = true;
    sessionStartTime = audioContext.currentTime;
    nextNoteTime = audioContext.currentTime + 0.1;

    scheduler();
  }

  function stopAll(isRestarting = false) {
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }

    if (!isRestarting) {
      isPlaying = false;
      // UI: Set Stop to Filled
      updateButtons(false);
    }

    const now = audioContext?.currentTime || 0;
    if (masterGain) {
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    }

    cleanupTimer = setTimeout(() => {
      activeNodes.forEach(n => { try { n.stop(); } catch(e) {} });
      activeNodes = [];
    }, 60);
  }

  document.addEventListener("DOMContentLoaded", () => {
    // 1. Load Settings
    const saved = loadState();
    applyControls(saved);
    
    // 2. Initial Button State (Stopped)
    updateButtons(false);

    // 3. Setup Controls
    const toneSlider = document.getElementById("tone");
    const hzReadout = document.getElementById("hzReadout");
    if (toneSlider && hzReadout) {
      hzReadout.textContent = toneSlider.value;
      toneSlider.addEventListener("input", () => {
        hzReadout.textContent = toneSlider.value;
        saveState(readControls());
      });
    }

    const sd = document.getElementById("songDuration");
    if (sd) {
      sd.addEventListener("input", () => saveState(readControls()));
    }

    // 4. Setup Play/Stop
    document.getElementById("playNow")?.addEventListener("click", async () => {
      saveState(readControls());
      await startFromUI();
    });
    document.getElementById("stop")?.addEventListener("click", () => stopAll(false));

    // 5. Mobile One-Page Launch
    document.getElementById("launchPlayer")?.addEventListener("click", () => {
      showPlayerUI();
    });
  });
})();
