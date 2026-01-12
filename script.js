(() => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  
  // Master Gain (Final Volume & Fade Out)
  const masterGain = audioContext.createGain();
  masterGain.connect(audioContext.destination);

  // LIMITER (Revised for Resonance)
  const limiter = audioContext.createDynamicsCompressor();
  // Threshold: -10dB. We start compressing earlier but gently.
  limiter.threshold.setValueAtTime(-10, audioContext.currentTime);
  // Knee: 40 (Maximum softness). This makes the compression invisible/musical.
  limiter.knee.setValueAtTime(40, audioContext.currentTime);
  // Ratio: 4:1. Gentle compression, not hard limiting.
  limiter.ratio.setValueAtTime(4, audioContext.currentTime);
  // Attack: 0.01. Slower attack lets the "ping" transient through before clamping.
  limiter.attack.setValueAtTime(0.01, audioContext.currentTime);
  limiter.release.setValueAtTime(0.25, audioContext.currentTime);
  
  limiter.connect(masterGain);

  let activeNodes = [];
  let isPlaying = false;
  let nextNoteTime = 0;
  let sessionStartTime = 0;
  let timerId;

  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    random: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  const reverbNode = audioContext.createConvolver();
  const reverbGain = audioContext.createGain();
  // Boosted Reverb slightly (0.8 -> 1.0) to regain "space"
  reverbGain.gain.value = 1.0;

  (function createReverb() {
    const duration = 4.0, rate = audioContext.sampleRate, length = rate * duration;
    const impulse = audioContext.createBuffer(2, length, rate);
    for (let j = 0; j < 2; j++) {
      const data = impulse.getChannelData(j);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }
    }
    reverbNode.buffer = impulse;
    reverbNode.connect(reverbGain);
    reverbGain.connect(limiter);
  })();

  function playFmBell(freq, duration, volume, startTime) {
    const carrier = audioContext.createOscillator();
    const modulator = audioContext.createOscillator();
    const modGain = audioContext.createGain();
    const ampGain = audioContext.createGain();

    carrier.frequency.value = freq;
    modulator.frequency.value = freq * (1.5 + Math.random() * 2);
    modGain.gain.setValueAtTime(freq * 2, startTime);
    modGain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

    // LOWERED DRY VOLUME (0.2 -> 0.15)
    // This gives the limiter more "headroom" so it doesn't squash the reverb
    const safeVolume = 0.15;

    ampGain.gain.setValueAtTime(0.0001, startTime);
    ampGain.gain.exponentialRampToValueAtTime(safeVolume, startTime + 0.05);
    ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(ampGain);
    
    ampGain.connect(limiter);
    ampGain.connect(reverbNode);

    modulator.start(startTime);
    carrier.start(startTime);
    modulator.stop(startTime + duration);
    carrier.stop(startTime + duration);
    activeNodes.push(carrier, modulator, ampGain);
  }

  function scheduler() {
    if (!isPlaying) return;
    const durationInput = document.getElementById('songDuration').value;
    const currentTime = audioContext.currentTime;
    
    if (durationInput !== 'infinite') {
      if (currentTime - sessionStartTime >= parseFloat(durationInput)) {
        stopAll();
        return;
      }
    }

    while (nextNoteTime < currentTime + 0.2) {
      const baseFreq = parseFloat(document.getElementById('tone').value);
      const mood = document.getElementById('mood').value;
      const density = parseFloat(document.getElementById('density').value);
      const scale = scales[mood] || scales.major;
      const freq = baseFreq * Math.pow(2, scale[Math.floor(Math.random() * scale.length)] / 12);

      playFmBell(freq, 4.0, 0.2, nextNoteTime);
      nextNoteTime += (1 / density) * (0.9 + Math.random() * 0.2);
    }
    timerId = requestAnimationFrame(scheduler);
  }

  function stopAll() {
    if (!isPlaying) return;
    isPlaying = false;
    cancelAnimationFrame(timerId);

    const now = audioContext.currentTime;
    const fadeDuration = 0.5;

    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + fadeDuration);

    setTimeout(() => {
      activeNodes.forEach(n => { try { n.stop(); } catch(e) {} });
      activeNodes = [];
    }, (fadeDuration * 1000) + 50);
  }

  document.getElementById('playNow').addEventListener('click', async () => {
    if (audioContext.state === 'suspended') await audioContext.resume();
    
    isPlaying = false; 
    activeNodes.forEach(n => { try { n.stop(); } catch(e) {} });
    activeNodes = [];
    cancelAnimationFrame(timerId);

    const now = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(1.0, now);

    isPlaying = true;
    sessionStartTime = audioContext.currentTime;
    nextNoteTime = audioContext.currentTime;
    scheduler();
  });

  document.getElementById('stop').addEventListener('click', stopAll);
  document.getElementById('tone').addEventListener('input', (e) => {
    document.getElementById('hzReadout').textContent = e.target.value;
  });
})();
