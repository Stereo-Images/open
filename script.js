(() => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  let activeNodes = [];
  let isPlaying = false;
  let nextNoteTime = 0;
  let scheduleAheadTime = 0.2; 
  let timerId;

  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    random: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  const reverbNode = audioContext.createConvolver();
  const reverbGain = audioContext.createGain();
  reverbGain.gain.value = 1.2;

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

  function playFmBell(freq, duration, volume, startTime) {
    const numVoices = 2 + Math.floor(Math.random() * 2); 
    const voices = [];
    let totalAmp = 0;
    for (let i = 0; i < numVoices; i++) {
      const amp = Math.random();
      voices.push({ modRatio: 1.5 + Math.random() * 2.5, modIndex: 1 + Math.random() * 4, amp });
      totalAmp += amp;
    }

    voices.forEach((voice) => {
      const carrier = audioContext.createOscillator();
      const modulator = audioContext.createOscillator();
      const modGain = audioContext.createGain();
      const ampGain = audioContext.createGain();

      carrier.frequency.value = freq;
      modulator.frequency.value = freq * voice.modRatio;

      const maxDeviation = freq * voice.modIndex;
      modGain.gain.setValueAtTime(maxDeviation, startTime);
      modGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      ampGain.gain.setValueAtTime(0.0001, startTime);
      ampGain.gain.exponentialRampToValueAtTime((voice.amp / totalAmp) * volume, startTime + 0.01);
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
    
    // Periodically clean the reference array to keep memory flat
    if (activeNodes.length > 150) activeNodes.splice(0, 50);
  }

  function scheduler() {
    if (!isPlaying) return;
    const durationInput = document.getElementById('songDuration').value;
    
    if (durationInput !== 'infinite' && nextNoteTime > parseFloat(durationInput)) {
      stopAll();
      return;
    }

    while (nextNoteTime < audioContext.currentTime + scheduleAheadTime) {
      const baseFreq = parseFloat(document.getElementById('tone').value);
      const mood = document.getElementById('mood').value;
      const density = parseFloat(document.getElementById('density').value);
      const scale = scales[mood] || scales.major;

      const interval = scale[Math.floor(Math.random() * scale.length)];
      const freq = baseFreq * Math.pow(2, interval / 12);
      const dur = (1 / density) * 2.5;

      playFmBell(freq, dur, 0.4, nextNoteTime);
      
      const drift = 0.95 + (Math.random() * 0.1);
      nextNoteTime += (1 / density) * drift;
    }
    timerId = requestAnimationFrame(scheduler);
  }

  function stopAll() {
    isPlaying = false;
    cancelAnimationFrame(timerId);
    activeNodes.forEach(n => { try { n.stop(); } catch(e) {} });
    activeNodes = [];
  }

  document.addEventListener('DOMContentLoaded', () => {
    const toneSlider = document.getElementById('tone');
    const hzReadout = document.getElementById('hzReadout');
    toneSlider.addEventListener('input', () => hzReadout.textContent = toneSlider.value);

    document.getElementById('playNow').addEventListener('click', async () => {
      if (audioContext.state === 'suspended') await audioContext.resume();
      stopAll();
      isPlaying = true;
      nextNoteTime = audioContext.currentTime;
      scheduler();
    });
    document.getElementById('stop').addEventListener('click', stopAll);
  });
})();
