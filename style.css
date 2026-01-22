(() => {
  const STATE_KEY = "open_player_settings_v16";

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
    const allowedDurations = new Set(["60", "300", "600", "1800", "infinite"]);
    const savedDur = state && state.songDuration != null ? String(state.songDuration) : null;
    const durVal = (savedDur && allowedDurations.has(savedDur)) ? savedDur : "60";
    if (sd) sd.value = durVal;
    let toneVal = state?.tone ? Math.max(30, Math.min(200, Number(state.tone))) : 110;
    if (tone) tone.value = String(toneVal);
    if (hzReadout) hzReadout.textContent = String(toneVal);
  }

  function setButtonState(state) {
    const playBtn = document.getElementById("playNow");
    const stopBtn = document.getElementById("stop");
    if (!playBtn || !stopBtn) return;
    playBtn.classList.toggle("filled", state === "playing");
    stopBtn.classList.toggle("filled", state !== "playing");
  }

  // =========================
  // Audio engine
  // =========================
  let audioContext = null;
  let masterGain = null;
  let reverbNode = null;
  let reverbGain = null;
  let streamDest = null;
  let videoWakeLock = null;
  let heartbeat = null; // Silent oscillator to keep process alive

  let activeNodes = [];
  let isPlaying = false;
  let isEndingNaturally = false;
  let nextNoteTime = 0;
  let sessionStartTime = 0;
  let timerInterval = null; // Replaces rafId

  const scheduleAheadTime = 0.5;
  const NATURAL_END_FADE_SEC = 1.2;
  const NATURAL_END_HOLD_SEC = 0.35;
  const scales = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], pentatonic: [0, 2, 4, 7, 9] };
  let runMood = "major";
  let runDensity = 0.2;

  function ensureAudio() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // YOUTUBE STRATEGY: MediaStream + Pixel Anchor
    streamDest = audioContext.createMediaStreamDestination();
    masterGain = audioContext.createGain();
    masterGain.connect(streamDest);
    masterGain.connect(audioContext.destination);

    // THE HEARTBEAT: Silent looping buffer keeps the clock "Hot" 
    const silentBuffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
    heartbeat = audioContext.createBufferSource();
    heartbeat.buffer = silentBuffer;
    heartbeat.loop = true;
    heartbeat.start();
    heartbeat.connect(audioContext.destination);

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Open', artist: 'Stereo Images' });
      navigator.mediaSession.setActionHandler('play', startFromUI);
      navigator.mediaSession.setActionHandler('pause', stopAllManual);
    }

    if (!videoWakeLock) {
      videoWakeLock = document.createElement('video');
      Object.assign(videoWakeLock.style, { position: 'fixed', bottom: '0', right: '0', width: '1px', height: '1px', opacity: '0.01' });
      videoWakeLock.setAttribute('playsinline', '');
      videoWakeLock.setAttribute('muted', '');
      document.body.appendChild(videoWakeLock);
      videoWakeLock.srcObject = streamDest.stream;
      videoWakeLock.play().catch(() => {});
    }

    createReverb();
  }

  function createReverb() {
    const duration = 5.0, decay = 1.5, rate = audioContext.sampleRate, length = Math.floor(rate * duration);
    const impulse = audioContext.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    reverbNode = audioContext.createConvolver();
    reverbNode.buffer = impulse;
    reverbGain = audioContext.createGain();
    reverbGain.gain.value = 1.5;
    reverbNode.connect(reverbGain);
    reverbGain.connect(audioContext.destination);
  }

  function playFmBell(freq, duration, volume, startTime) {
    const numVoices = 2 + Math.floor(Math.random() * 2);
    let totalAmp = 0;
    const voices = Array.from({length: numVoices}, () => {
      const v = { modRatio: 1.5 + Math.random() * 2.5, modIndex: 1 + Math.random() * 4, amp: Math.random() };
      totalAmp += v.amp;
      return v;
    });

    voices.forEach(voice => {
      const carrier = audioContext.createOscillator(), modulator = audioContext.createOscillator();
      const modGain = audioContext.createGain(), ampGain = audioContext.createGain();
      carrier.frequency.value = freq + (Math.random() - 0.5) * 2;
      modulator.frequency.value = freq * voice.modRatio;
      modGain.gain.setValueAtTime(freq * voice.modIndex, startTime);
      modGain.gain.exponentialRampToValueAtTime(freq * 0.5, startTime + duration);
      ampGain.gain.setValueAtTime(0.0001, startTime);
      ampGain.gain.exponentialRampToValueAtTime((voice.amp / totalAmp) * volume, startTime + 0.01);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      modulator.connect(modGain); modGain.connect(carrier.frequency);
      carrier.connect(ampGain); ampGain.connect(reverbNode); ampGain.connect(masterGain);
      modulator.start(startTime); carrier.start(startTime);
      modulator.stop(startTime + duration); carrier.stop(startTime + duration);
      activeNodes.push(carrier, modulator, modGain, ampGain);
    });
    if (activeNodes.length > 200) activeNodes.splice(0, 100);
  }

  function scheduler() {
    if (!isPlaying) return;
    const durationInput = document.getElementById("songDuration")?.value ?? "60";
    if (durationInput !== "infinite" && (audioContext.currentTime - sessionStartTime) >= parseFloat(durationInput)) {
      beginNaturalEnd(); return;
    }
    while (nextNoteTime < audioContext.currentTime + scheduleAheadTime) {
      const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");
      const scale = scales[runMood] || scales.major;
      const freq = baseFreq * Math.pow(2, scale[Math.floor(Math.random() * scale.length)] / 12);
      const dur = (1 / runDensity) * 2.5;
      playFmBell(freq, dur, 0.4, nextNoteTime);
      nextNoteTime += (1 / runDensity) * (0.95 + Math.random() * 0.1);
    }
  }

  function killImmediate() {
    if (timerInterval) clearInterval(timerInterval);
    activeNodes.forEach(n => { try { n.stop(); } catch (e) {} });
    activeNodes = []; isPlaying = isEndingNaturally = false;
    if (masterGain) { masterGain.gain.cancelScheduledValues(audioContext.currentTime); masterGain.gain.setValueAtTime(1, audioContext.currentTime); }
  }

  async function startFromUI() {
    ensureAudio();
    if (audioContext.state === "suspended") await audioContext.resume();
    runMood = ["major", "minor", "pentatonic"][Math.floor(Math.random() * 3)];
    runDensity = 0.05 + Math.random() * 0.375;
    killImmediate();
    isPlaying = true; setButtonState("playing");
    sessionStartTime = nextNoteTime = audioContext.currentTime;
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
    masterGain.gain.setValueAtTime(masterGain.gain.value, audioContext.currentTime + NATURAL_END_HOLD_SEC);
    masterGain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + NATURAL_END_HOLD_SEC + NATURAL_END_FADE_SEC);
    setTimeout(() => { killImmediate(); setButtonState("stopped"); }, (NATURAL_END_HOLD_SEC + NATURAL_END_FADE_SEC + 0.1) * 1000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (isPopoutMode()) {
        document.body.classList.add("popout");
        const form = document.getElementById("songForm");
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
        const form = document.getElementById("songForm");
        applyControls(loadState());
        document.getElementById("tone").addEventListener("input", (e) => {
            document.getElementById("hzReadout").textContent = e.target.value;
            saveState(readControls());
        });
        document.getElementById("playNow").onclick = startFromUI;
        document.getElementById("stop").onclick = stopAllManual;
      } else {
        window.open(`${window.location.href.split("#")[0]}#popout`, "open_player", "width=480,height=620");
      }
    });
  });
})();
