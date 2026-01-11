(() => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  let activeNodes = [];

  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    random: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  // Restoring the Original Noise Exciter Buffer
  function createNoiseBuffer() {
    const duration = 0.1;
    const rate = audioContext.sampleRate;
    const buffer = audioContext.createBuffer(1, Math.floor(duration * rate), rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
  const noiseBuffer = createNoiseBuffer();

  const reverbNode = audioContext.createConvolver();
  const reverbGain = audioContext.createGain();
  reverbGain.gain.value = 1.2; // Original "Spacious" setting

  function createReverb() {
    const duration = 5.0, rate = audioContext.sampleRate, length = rate * duration;
    const impulse = audioContext.createBuffer(2, length, rate);
    for (let j = 0; j < 2; j++) {
      const data = impulse.getChannelData(j);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 1.5);
      }
    }
    reverbNode.buffer = impulse;
    reverbNode.connect(reverbGain);
    reverbGain.connect(audioContext.destination);
  }
  createReverb();

  // The Full Original FM/Modal Hybrid logic
  function playFmBell(freq, duration, volume, startTime) {
    // Restored Original Mode Ratios for authentic bell dissonance
    const modeRatios = [1.0, 2.706, 3.563, 4.152]; 
    const modeAmps = [1.0, 0.6, 0.4, 0.2];

    modeRatios.forEach((ratio, index) => {
      const carrier = audioContext.createOscillator();
      const modulator = audioContext.createOscillator();
      const modGain = audioContext.createGain();
      const ampGain = audioContext.createGain();

      const modeFreq = freq * ratio;
      carrier.frequency.value = modeFreq;
      modulator.frequency.value = modeFreq * (1.5 + Math.random() * 2.0); // Per-note walk

      modGain.gain.setValueAtTime(modeFreq * 2, startTime);
      modGain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      ampGain.gain.setValueAtTime(0.0001, startTime);
      ampGain.gain.exponentialRampToValueAtTime(volume * modeAmps[index], startTime + 0.005);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(ampGain);
      ampGain.connect(reverbNode);
      ampGain.connect(audioContext.destination);

      modulator.start(startTime);
      carrier.start(startTime);
      modulator.stop(startTime + duration);
      carrier.stop(startTime + duration);
      activeNodes.push(carrier, modulator, ampGain);
    });

    // Restored Noise Burst for the "strike" impact
    const noiseSource = audioContext.createBufferSource();
    const noiseGain = audioContext.createGain();
    noiseSource.buffer = noiseBuffer;
    noiseGain.gain.setValueAtTime(0.1 * volume, startTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.02);
    noiseSource.connect(noiseGain);
    noiseGain.connect(reverbNode);
    noiseSource.start(startTime);
    noiseSource.stop(startTime + 0.02);
  }

  function generateMelody(params) {
    const length = parseFloat(params.length), baseFreq = parseFloat(params.tone);
    const density = parseFloat(params.density), scale = scales[params.mood] || scales.major;
    const totalNotes = Math.max(1, Math.floor(length * density));
    const melody = [];
    let currentTime = 0;

    for (let i = 0; i < totalNotes; i++) {
      const interval = scale[Math.floor(Math.random() * scale.length)];
      const freq = baseFreq * Math.pow(2, interval / 12);
      const drift = 0.95 + (Math.random() * 0.1);
      melody.push({ freq, start: currentTime, dur: (1 / density) * 2 });
      currentTime += (1 / density) * drift;
    }
    return melody;
  }

  function stopAll() {
    activeNodes.forEach(n => { try { n.stop(); } catch(e) {} });
    activeNodes = [];
    document.getElementById('statusMessage').textContent = "ready.";
  }

  document.addEventListener('DOMContentLoaded', () => {
    const toneSlider = document.getElementById('tone');
    const hzReadout = document.getElementById('hzReadout');
    toneSlider.addEventListener('input', () => hzReadout.textContent = toneSlider.value);

    document.getElementById('playNow').addEventListener('click', async () => {
      if (audioContext.state === 'suspended') await audioContext.resume();
      stopAll();
      const melody = generateMelody({
        length: document.getElementById('songDuration').value,
        tone: toneSlider.value,
        mood: document.getElementById('mood').value,
        density: document.getElementById('density').value
      });
      const now = audioContext.currentTime;
      melody.forEach(n => playFmBell(n.freq, n.dur, 0.4, now + n.start));
      document.getElementById('statusMessage').textContent = "playing...";
    });
    document.getElementById('stop').addEventListener('click', stopAll);
  });
})();
