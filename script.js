(() => {
  const STATE_KEY = "open_player_settings_v6";

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

  function saveState(state) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
  }

  // Only persist the controls you still expose.
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

  function openPopout() {
    const base = window.location.href.split("#")[0];
    const url = `${base}#popout`;

    const w = window.open(
      url,
      "open_popout_player",
      "width=480,height=620,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes"
    );

    try { w && w.focus && w.focus(); } catch {}
  }

  // =========================
  // Audio engine (popout only)
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

  // Mood options (NO "random" mode)
  const MOOD_CHOICES = ["major", "minor", "pentatonic"];

  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
  };

  // Reduced density range: lower half of old [0.05, 0.8] => [0.05, 0.425]
  const DENSITY_MIN = 0.05;
  const DENSITY_MAX = 0.425;

  // Chosen once per popout session
  let sessionMood = "major";
  let sessionDensity = 0.2;

  function randFloat(min, max) {
    return min + Math.random() * (max - min);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function initSessionGenerativeParams() {
    sessionMood = pick(MOOD_CHOICES);
    sessionDensity = randFloat(DENSITY_MIN, DENSITY_MAX);
    // If you ever want a tiny nudge slower on average, bias by squaring:
    // sessionDensity = DENSITY_MIN + (DENSITY_MAX - DENSITY_MIN) * Math.pow(Math.random(), 1.25);
  }

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
      const carrier