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

  // Only save the controls that still exist
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

    if (!w) {
      alert("Pop-up blocked. Please allow pop-ups for this site, then try again.");
      return;
    }

    try { w && w.focus && w.focus(); } catch {}
  }

  // =========================
  // Audio engine (popout only)
  // =========================
  let audioContext = null;
  let masterGain = null;

  let reverbNode = null;
  let reverbGain = null;

  // NEW (lightweight): gentle lowpass to tame “pure sine” edges
  let dryFilter = null;

  let activeNodes = [];
  let isPlaying = false;
  let nextNoteTime = 0;
  let sessionStartTime = 0;
  let rafId = null;

  // Keep your timing feel (your earlier “good” script used 0.2)
  const scheduleAheadTime = 0.2;

  // Mood + density are now hidden session params (re-rolled each Play)
  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
  };
  const MOOD_CHOICES = ["major", "minor", "pentatonic"];

  // Lower half of old [0.05, 0.8] => [0.05, 0.425]
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

  // Fresh every Play
  function rerollHiddenParams() {
    runMood = pick(MOOD_CHOICES);
    runDensity = randFloat(DENSITY_MIN, DENSITY_MAX);
  }

  function ensureAudio() {
    if (audioContext) return;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
    masterGain.gain.value = 1;

    // Reverb (same approach, but lower wet)
    reverbNode = audioContext.createConvolver();
    reverbGain = audioContext.createGain();

    // ↓↓↓ less reverb than your current 1.2
    reverbGain.gain.value = 0.65;

    createReverb();

    // Gentle dry lowpass (cheap, reduces “needle” sine)
    dryFilter = audioContext.createBiquadFilter();
    dryFilter.type = "lowpass";
    dryFilter.frequency.value = 4500; // mild rolloff
    dryFilter.Q.value = 0.7;

    dryFilter.connect(masterGain);
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
    reverbGain.connect(audioContext.destination);
  }

  function playFmBell(freq, duration, volume, startTime) {
    const numVoices = 2 + Math.floor(Math.random() * 2);
    const voices = [];
    let totalAmp = 0;

    for (let i = 0; i < numVoices; i++) {
      const amp = Math.random();

      // Small change: slightly higher minimum modIndex to avoid “too pure” tones
      // (kept close to your original range)
      voices.push({
        modRatio: 1.5 + Math.random() * 2.5,
        modIndex: 1.6 + Math.random() * 3.6, // was 1 + Math.random()*4
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

      // Keep your envelope behavior
      modGain.gain.setValueAtTime(freq * voice.modIndex, startTime);
      modGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      ampGain.gain.setValueAtTime(0.0001, startTime);
      ampGain.gain.exponentialRampToValueAtTime((voice.amp / totalAmp) * volume, startTime + 0.01);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(ampGain);

      // Wet + dry (but dry goes through gentle lowpass now)
      ampGain.connect(reverbNode);
      ampGain.connect(dryFilter);

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

    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    const currentTime = audioContext.currentTime;

    if (durationInput !== "infinite") {
      const elapsed = currentTime - sessionStartTime;
      if (elapsed >= parseFloat(durationInput)) {
        stopAll();
        return;
      }
    }

    const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");
    const scale = scales[runMood] || scales.major;
    const density = runDensity;

    while (nextNoteTime < currentTime + scheduleAheadTime) {
      const interval = scale[Math.floor(Math.random() * scale.length)];
      const freq = baseFreq * Math.pow(2, interval / 12);

      // keep your pacing formula
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

    // Fresh mood + density each Play (your requirement)
    rerollHiddenParams();

    // prevent click on stop/start
    masterGain.gain.setValueAtTime(1, audioContext.currentTime);

    stopAll();
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
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    setTimeout(() => {
      activeNodes.forEach(n => { try { n.stop(); } catch {} });
      activeNodes = [];
      masterGain.gain.setValueAtTime(1, audioContext.currentTime);
    }, 60);
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (isPopoutMode()) document.body.classList.add("popout");

    document.getElementById("launchPlayer")?.addEventListener("click", openPopout);

    if (isPopoutMode()) {
      const saved = loadState();
      applyControls(saved);

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
        sd.addEventListener("change", () => saveState(readControls()));
      }

      document.getElementById("playNow")?.addEventListener("click", async () => {
        saveState(readControls());
        await startFromUI();
      });

      document.getElementById("stop")?.addEventListener("click", stopAll);
    }
  });
})();