(() => {
  // =========================
  // Shared state for settings sync
  // =========================
  const STATE_KEY = "open_shared_settings_v3";

  function isPopoutMode() {
    return window.location.hash === "#popout";
  }

  function safeParse(raw) {
    try { return JSON.parse(raw); } catch { return null; }
  }

  function loadState() {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? safeParse(raw) : null;
  }

  function readUIState() {
    return {
      songDuration: document.getElementById("songDuration")?.value ?? "infinite",
      tone: document.getElementById("tone")?.value ?? "110",
      mood: document.getElementById("mood")?.value ?? "major",
      density: document.getElementById("density")?.value ?? "0.2",
      updatedAt: Date.now()
    };
  }

  function applyUIState(state) {
    if (!state) return;

    const sd = document.getElementById("songDuration");
    const tone = document.getElementById("tone");
    const mood = document.getElementById("mood");
    const density = document.getElementById("density");
    const hzReadout = document.getElementById("hzReadout");

    if (sd && state.songDuration != null) sd.value = state.songDuration;

    if (tone && state.tone != null) {
      tone.value = state.tone;
      if (hzReadout) hzReadout.textContent = state.tone;
    }

    if (mood && state.mood != null) mood.value = state.mood;

    if (density && state.density != null) density.value = state.density;
  }

  function saveState() {
    const next = { ...readUIState(), updatedAt: Date.now() };
    try { localStorage.setItem(STATE_KEY, JSON.stringify(next)); } catch {}
    return next;
  }

  function openPopout() {
    // Save settings ONLY. No autoplay.
    saveState();

    const url = `${window.location.pathname}#popout`;
    const w = window.open(
      url,
      "open_popout_player",
      "width=480,height=620,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes"
    );

    try { w && w.focus && w.focus(); } catch {}
  }

  // =========================
  // Audio engine (runs in whichever window hits Play)
  // =========================
  let audioContext = null;
  let masterGain = null;
  let limiter = null;
  let reverbNode = null;
  let reverbGain = null;

  let activeNodes = [];
  let isPlaying = false;
  let nextNoteTime = 0;
  let sessionStartTime = 0;
  let rafId = null;

  const scheduleAheadTime = 0.5;

  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    random: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  function ensureAudio() {
    if (audioContext) return;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    limiter = audioContext.createDynamicsCompressor();
    limiter.threshold.setValueAtTime(-1.0, audioContext.currentTime);
    limiter.knee.setValueAtTime(0, audioContext.currentTime);
    limiter.ratio.setValueAtTime(20, audioContext.currentTime);
    limiter.connect(audioContext.destination);

    masterGain = audioContext.createGain();
    masterGain.connect(limiter);
    masterGain.gain.value = 1;

    reverbNode = audioContext.createConvolver();
    reverbGain = audioContext.createGain();
    reverbGain.gain.value = 1.2;

    createReverb();
  }

  function createReverb() {
    if (!audioContext) return;

    const duration = 5.0;
    const rate = audioContext.sampleRate;
    const length = rate * duration;

    const impulse = audioContext.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 1.5);
      }
    }

    reverbNode.buffer = impulse;
    reverbNode.connect(reverbGain);
    reverbGain.connect(limiter);
  }

  function playFmBell(freq, duration, volume, startTime) {
    const numVoices = 2 + Math.floor(Math.random() * 2);
    const voices = [];
    let totalAmp = 0;

    for (let i = 0; i < numVoices; i++) {
      const amp = Math.random();
      voices.push({
        modRatio: 1.5 + Math.random() * 2.5,
        modIndex: 1 + Math.random() * 4,
        amp
      });
      totalAmp += amp;
    }

    voices.forEach((voice) => {
      const carrier = audioContext.createOscillator();
      const modulator = audioContext.createOscillator();
      const modGain = audioContext.createGain();
      const ampGain = audioContext.createGain();

      carrier.frequency.value = freq;
      modulator.frequency.value = freq * voice.modRatio;

      modGain.gain.setValueAtTime(freq * voice.modIndex, startTime);
      modGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

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

      activeNodes.push(carrier, modulator, ampGain);
    });

    if (activeNodes.length > 250) activeNodes.splice(0, 120);
  }

  function scheduler() {
    if (!isPlaying) return;

    const durationInput = document.getElementById("songDuration").value;
    const currentTime = audioContext.currentTime;

    if (durationInput !== "infinite") {
      const elapsed = currentTime - sessionStartTime;
      if (elapsed >= parseFloat(durationInput)) {
        stopAll();
        return;
      }
    }

    while (nextNoteTime < currentTime + scheduleAheadTime) {
      const baseFreq = parseFloat(document.getElementById("tone").value);
      const mood = document.getElementById("mood").value;
      const density = parseFloat(document.getElementById("density").value);
      const scale = scales[mood] || scales.major;

      const interval = scale[Math.floor(Math.random() * scale.length)];
      const freq = baseFreq * Math.pow(2, interval / 12);

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

    // Ensure master gain is up (in case it was faded)
    masterGain.gain.setValueAtTime(1, audioContext.currentTime);

    stopAll(); // stop current session in this SAME window only
    isPlaying = true;

    sessionStartTime = audioContext.currentTime;
    nextNoteTime = audioContext.currentTime;

    scheduler();
  }

  function stopAll() {
    if (!audioContext || !isPlaying) return;

    isPlaying = false;
    if (rafId) cancelAnimationFrame(rafId);

    const now = audioContext.currentTime;

    // small fade to prevent click
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    setTimeout(() => {
      activeNodes.forEach(n => { try { n.stop(); } catch {} });
      activeNodes = [];
      masterGain.gain.setValueAtTime(1, audioContext.currentTime);
    }, 60);
  }

  // =========================
  // UI wiring + cross-window setting sync
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    if (isPopoutMode()) document.body.classList.add("popout");

    // Load saved settings
    const saved = loadState();
    applyUIState(saved);

    // Keep Hz readout in sync
    const toneSlider = document.getElementById("tone");
    const hzReadout = document.getElementById("hzReadout");
    if (toneSlider && hzReadout) {
      hzReadout.textContent = toneSlider.value;
      toneSlider.addEventListener("input", () => {
        hzReadout.textContent = toneSlider.value;
        saveState();
      });
    }

    // Persist changes
    ["songDuration", "mood", "density"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", saveState);
      el.addEventListener("change", saveState);
    });

    // Buttons
    document.getElementById("playNow")?.addEventListener("click", async () => {
      await startFromUI(); // PLAY really plays (in this window)
    });

    document.getElementById("stop")?.addEventListener("click", () => {
      stopAll();
    });

    document.getElementById("popOut")?.addEventListener("click", () => {
      openPopout(); // Open Player just opens the popout
    });

    // Cross-window: apply settings when the other window changes them
    window.addEventListener("storage", (e) => {
      if (e.key !== STATE_KEY) return;
      const st = loadState();
      applyUIState(st);
    });
  });
})();