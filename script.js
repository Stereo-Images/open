(() => {
  const STATE_KEY = "open_player_settings_v25";

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
    if (!playBtn || !stopBtn) return;
    playBtn.classList.toggle("filled", state === "playing");
    stopBtn.classList.toggle("filled", state !== "playing");
  }

  // =========================
  // SHARED AUDIO LOGIC
  // =========================
  const scales = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], pentatonic: [0, 2, 4, 7, 9] };
  let runMood = "major", runDensity = 0.2;

  // Reverb Impulse Generator (Shared)
  function createReverbBuffer(ctx) {
    const duration = 5.0, decay = 1.5, rate = ctx.sampleRate, length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return impulse;
  }

  // NOTE GENERATOR (Shared Logic)
  // We need to pass the current state (lastIndex) so the Offline render follows the same logic
  function getNextNote(baseFreq, currentLastIndex) {
    const scale = scales[runMood] || scales.major;
    const len = scale.length;
    
    const r = Math.random();
    let shift = 0;

    if (r < 0.50) shift = (Math.random() < 0.5 ? -1 : 1);
    else if (r < 0.75) shift = (Math.random() < 0.5 ? -2 : 2);
    else {
        const jumpSize = 3 + Math.floor(Math.random() * 4); 
        shift = (Math.random() < 0.5 ? -jumpSize : jumpSize);
    }

    // Simple random drift for the static function
    if (Math.random() < 0.4) shift += (Math.random() < 0.5 ? 1 : -1); 

    let newIndex = currentLastIndex + shift;

    if (newIndex < 0) newIndex = 1;
    if (newIndex >= len * 2) newIndex = (len * 2) - 2;
    
    const octave = Math.floor(newIndex / len);
    const noteDegree = newIndex % len;
    const interval = scale[noteDegree];
    
    return { 
        freq: baseFreq * Math.pow(2, (interval / 12) + octave),
        newIndex: newIndex
    };
  }

  // SOUND GENERATOR (Context Agnostic)
  // Accepts 'ctx' so it can write to Realtime OR Offline context
  function scheduleNote(ctx, destination, freq, time, duration, volume, reverbBuffer) {
    const numVoices = 2 + Math.floor(Math.random() * 2);
    let totalAmp = 0;
    
    // Create Reverb Node specific to this context
    const conv = ctx.createConvolver();
    conv.buffer = reverbBuffer;
    const revGain = ctx.createGain();
    revGain.gain.value = 1.5;
    conv.connect(revGain);
    revGain.connect(destination);

    const voices = Array.from({length: numVoices}, () => {
      const v = { modRatio: 1.5 + Math.random() * 2.5, modIndex: 1 + Math.random() * 4, amp: Math.random() };
      totalAmp += v.amp;
      return v;
    });

    voices.forEach(voice => {
      const carrier = ctx.createOscillator();
      const modulator = ctx.createOscillator();
      const modGain = ctx.createGain();
      const ampGain = ctx.createGain();

      carrier.frequency.value = freq + (Math.random() - 0.5) * 2;
      modulator.frequency.value = freq * voice.modRatio;

      modGain.gain.setValueAtTime(freq * voice.modIndex, time);
      modGain.gain.exponentialRampToValueAtTime(freq * 0.5, time + duration);

      ampGain.gain.setValueAtTime(0.0001, time);
      ampGain.gain.exponentialRampToValueAtTime((voice.amp / totalAmp) * volume, time + 0.01);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      
      carrier.connect(ampGain);
      ampGain.connect(conv); // Send to reverb
      ampGain.connect(destination); // Send to master

      modulator.start(time);
      carrier.start(time);
      modulator.stop(time + duration);
      carrier.stop(time + duration);
    });
  }

  // =========================
  // REALTIME ENGINE
  // =========================
  let audioContext =
