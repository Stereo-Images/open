(() => {
  const STATE_KEY = "open_player_settings_v26";

  // UTILITIES
  function isPopoutMode() { return window.location.hash === "#popout"; }
  function isMobileDevice() {
    const ua = navigator.userAgent || "";
    // Robust check for phones/tablets including iPadOS
    return /iPhone|iPad|iPod|Android/i.test(ua) || 
           (window.matchMedia?.("(pointer: coarse)")?.matches && window.matchMedia?.("(max-width: 820px)")?.matches);
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
  // SHARED LOGIC (Renderer & Realtime)
  // =========================
  const scales = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], pentatonic: [0, 2, 4, 7, 9] };
  let runMood = "major", runDensity = 0.2;

  function createReverbBuffer(ctx) {
    const duration = 5.0, decay = 1.5, rate = ctx.sampleRate, length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return impulse;
  }

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

    if (Math.random() < 0.15) shift += (Math.random() < 0.5 ? 1 : -1); 

    let newIndex = currentLastIndex + shift;
    if (newIndex < 0) newIndex = 1;
    if (newIndex >= len * 2) newIndex = (len * 2) - 2;
    
    const octave = Math.floor(newIndex / len);
    const noteDegree = newIndex % len;
    const interval = scale[noteDegree];
    
    return { freq: baseFreq * Math.pow(2, (interval / 12) + octave), newIndex: newIndex };
  }

  function scheduleNote(ctx, destination, freq, time, duration, volume, reverbBuffer) {
    const numVoices = 2 + Math.floor(Math.random() * 2);
    let totalAmp = 0;
    
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

      modulator.connect(modGain); modGain.connect(carrier.frequency);
      carrier.connect(ampGain); 
      ampGain.connect(conv); 
      ampGain.connect(destination);

      modulator.start(time); carrier.start(time);
      modulator.stop(time + duration); carrier.stop(time + duration);
    });
  }

  // =========================
  // REALTIME ENGINE
  // =========================
  let audioContext = null, masterGain = null, streamDest = null, heartbeat = null;
  let liveReverbBuffer = null;
  let isPlaying = false, isEndingNaturally = false;
  let nextNoteTime = 0, sessionStartTime = 0, timerInterval = null;
  let lastNoteIndex = 3; 

  function ensureAudio() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    streamDest = audioContext.createMediaStreamDestination();
    masterGain = audioContext.createGain();
    masterGain.connect(streamDest);
    masterGain.connect(audioContext.destination);

    const silentBuffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
    heartbeat = audioContext.createBufferSource();
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
    if (durationInput !== "infinite" && (audioContext.currentTime - sessionStartTime) >= parseFloat(durationInput)) {
      beginNaturalEnd(); return;
    }
    while (nextNoteTime < audioContext.currentTime + 0.5) {
      const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");
      const result = getNextNote(baseFreq, lastNoteIndex);
      lastNoteIndex = result.newIndex;
      
      scheduleNote(audioContext, masterGain, result.freq, nextNoteTime, (1 / runDensity) * 2.5, 0.4, liveReverbBuffer);
      nextNoteTime += (1 / runDensity) * (0.95 + Math.random() * 0.1);
    }
  }

  // =========================
  // OFFLINE RENDERER
  // =========================
  async function renderWavExport() {
    console.log("Starting Offline Render...");
    const sampleRate = 44100;
    const duration = 30; 
    const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
    
    const offlineMaster = offlineCtx.createGain();
    offlineMaster.connect(offlineCtx.destination);
    const offlineReverbBuffer = createReverbBuffer(offlineCtx);

    let offlineTime = 0;
    let offlineNoteIndex = 3;
    const baseFreq = parseFloat(document.getElementById("tone")?.value ?? "110");

    while (offlineTime < duration - 2.0) { 
        const result = getNextNote(baseFreq, offlineNoteIndex);
        offlineNoteIndex = result.newIndex;
        scheduleNote(offlineCtx, offlineMaster, result.freq, offlineTime, (1 / runDensity) * 2.5, 0.4, offlineReverbBuffer);
        offlineTime += (1 / runDensity) * (0.95 + Math.random() * 0.1);
    }

    const renderedBuffer = await offlineCtx.startRendering();
    const wavBlob = bufferToWave(renderedBuffer, duration * sampleRate);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `open-studio-render-${Date.now()}.wav`;
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
        if (e.key.toLowerCase() === 'r') renderWavExport();
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
    masterGain.gain.setValueAtTime(masterGain.gain.value, audioContext.currentTime + 1.0);
    masterGain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 2.5);
    setTimeout(() => { killImmediate(); setButtonState("stopped"); }, 2600);
  }

  // =========================
  // INITIALIZATION (Bulletproof Mobile Fix)
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    
    // 1. Popout Mode (Child Window)
    if (isPopoutMode()) {
        document.body.classList.add("popout");
        applyControls(loadState());
        
        document.getElementById("tone")?.addEventListener("input", (e) => {
            const val = e.target.value;
            const ro = document.getElementById("hzReadout");
            if (ro) ro.textContent = val;
            saveState(readControls());
        });
        
        document.getElementById("songDuration")?.addEventListener("change", () => saveState(readControls()));
        
        const playBtn = document.getElementById("playNow");
        const stopBtn = document.getElementById("stop");
        if (playBtn) playBtn.onclick = startFromUI;
        if (stopBtn) stopBtn.onclick = stopAllManual;
        
        setButtonState("stopped");
    }

    // 2. Launch Button (Main Window)
    const launchBtn = document.getElementById("launchPlayer");
    if (launchBtn) {
        launchBtn.addEventListener("click", () => {
            
            // Re-check mobile status on click to be safe
            if (!isPopoutMode() && isMobileDevice()) {
                // MOBILE: Inline Player
                document.body.classList.add("mobile-player");
                applyControls(loadState());
                
                // Re-attach listeners for the inline controls
                document.getElementById("tone")?.addEventListener("input", (e) => {
                    const val = e.target.value;
                    const ro = document.getElementById("hzReadout");
                    if (ro) ro.textContent = val;
                    saveState(readControls());
                });

                document.getElementById("songDuration")?.addEventListener("change", () => saveState(readControls()));

                const playBtn = document.getElementById("playNow");
                const stopBtn = document.getElementById("stop");
                if (playBtn) playBtn.onclick = startFromUI;
                if (stopBtn) stopBtn.onclick = stopAllManual;

            } else {
                // DESKTOP: Popout Window
                // Optimized size for the new typography
                window.open(
                    `${window.location.href.split("#")[0]}#popout`, 
                    "open_player", 
                    "width=500,height=680,resizable=yes"
                );
            }
        });
    }
  });
})();
