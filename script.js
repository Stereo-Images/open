(() => {
  let audioContext = null;
  let masterGain = null;
  let reverbNode = null;
  let reverbGain = null;
  let activeNodes = [];
  let isPlaying = false;
  let nextNoteTime = 0;
  let sessionStartTime = 0;
  let scheduleAheadTime = 0.2;
  let timerId;

  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    random: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

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

  function ensureAudio() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Master Gain for smooth stop
    masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
    masterGain.gain.value = 1;

    reverbNode = audioContext.createConvolver();
    reverbGain = audioContext.createGain();
    reverbGain.gain.value = 1.2;
    createReverb();
  }

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

      modGain.gain.setValueAtTime(freq * voice.modIndex, startTime);
      modGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      ampGain.gain.setValueAtTime(0.0001, startTime);
      ampGain.gain.exponentialRampToValueAtTime((voice.amp / totalAmp) * volume, startTime + 0.01);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(ampGain);
      
      ampGain.connect(reverbNode);
      ampGain.connect(masterGain); // Prevent clicks by routing through master

      modulator.start(startTime);
      carrier.start(startTime);
      modulator.stop(startTime + duration);
      carrier.stop(startTime + duration);
      activeNodes.push(carrier, modulator, ampGain);
    });
    if (activeNodes.length > 200) activeNodes.splice(0, 50);
  }

  function scheduler() {
    if (!isPlaying) return;
    const durationInput = document.getElementById("songDuration").value;
    const currentTime = audioContext.currentTime;

    if (durationInput !== "infinite" && (currentTime - sessionStartTime) >= parseFloat(durationInput)) {
      stopAll();
      return;
    }

    while (nextNoteTime < currentTime + scheduleAheadTime) {
      const scale = scales[document.getElementById("mood").value] || scales.major;
      const freq = parseFloat(document.getElementById("tone").value) * Math.pow(2, scale[Math.floor(Math.random() * scale.length)] / 12);
      const density = parseFloat(document.getElementById("density").value);
      playFmBell(freq, (1 / density) * 2.5, 0.4, nextNoteTime);
      nextNoteTime += (1 / density) * (0.95 + Math.random() * 0.1);
    }
    timerId = requestAnimationFrame(scheduler);
  }

  function stopAll() {
    if (!isPlaying || !audioContext) return;
    isPlaying = false;
    cancelAnimationFrame(timerId);

    // Fade out master volume over 50ms to kill the click
    const now = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    setTimeout(() => {
      activeNodes.forEach(n => { try { n.stop(); } catch(e) {} });
      activeNodes = [];
      masterGain.gain.setValueAtTime(1, audioContext.currentTime);
    }, 60);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const toneSlider = document.getElementById("tone");
    toneSlider.addEventListener("input", () => document.getElementById("hzReadout").textContent = toneSlider.value);

    document.getElementById("playNow").addEventListener("click", async () => {
      ensureAudio();
      if (audioContext.state === "suspended") await audioContext.resume();
      
      // Reset state for clean restart
      isPlaying = false;
      cancelAnimationFrame(timerId);
      activeNodes.forEach(n => { try { n.stop(); } catch(e) {} });
      activeNodes = [];
      masterGain.gain.cancelScheduledValues(audioContext.currentTime);
      masterGain.gain.setValueAtTime(1, audioContext.currentTime);

      isPlaying = true;
      sessionStartTime = audioContext.currentTime;
      nextNoteTime = audioContext.currentTime;
      scheduler();
    });

    document.getElementById("stop").addEventListener("click", stopAll);
  });
})();
