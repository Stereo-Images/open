No, the previous response only included the parts that needed changing.

Here is the **complete** updated `script.js` file. You can replace your entire current JS file with this.

```javascript
(() => {
  let audioContext = null;
  let masterGain = null;
  let limiter = null;
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
    // Route reverb through limiter for safety
    reverbGain.connect(limiter);
  }

  function ensureAudio() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // 1. Initialize Limiter (DynamicsCompressor)
    limiter = audioContext.createDynamicsCompressor();
    limiter.threshold.setValueAtTime(-1.0, audioContext.currentTime); 
    limiter.knee.setValueAtTime(0, audioContext.currentTime);          
    limiter.ratio.setValueAtTime(20, audioContext.currentTime);       
    limiter.attack.setValueAtTime(0.003, audioContext.currentTime);   
    limiter.release.setValueAtTime(0.1, audioContext.currentTime);    
    limiter.connect(audioContext.destination);

    // 2. Master Gain (Controls the dry signal)
    masterGain = audioContext.createGain();
    masterGain.connect(limiter);
    masterGain.gain.value = 1;

    // 3. Setup Reverb
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
      
      // Connect to Reverb (Independent path)
      ampGain.connect(reverbNode);
      // Connect to Master (Dry path that we can fade)
      ampGain.connect(masterGain); 

      modulator.start(startTime);
      carrier.start(startTime);
      modulator.stop(startTime + duration);
      carrier.stop(startTime + duration);
      activeNodes.push(carrier, modulator, ampGain);
    });
    
    // Cleanup active nodes array to prevent memory leaks
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

    const now = audioContext.currentTime;

    // 1. Slow Fade of the "Dry" signal (4 seconds)
    // We leave the reverb path alone so it rings out naturally.
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 4);

    // 2. Delayed Cleanup
    // We wait 5 seconds before clearing nodes to ensure the fade is done
    // and the reverb tail has mostly decayed.
    setTimeout(() => {
      if (!isPlaying) {
        activeNodes = [];
      }
    }, 5000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const toneSlider = document.getElementById("tone");
    toneSlider.addEventListener("input", () => document.getElementById("hzReadout").textContent = toneSlider.value);

    document.getElementById("playNow").addEventListener("click", async () => {
      ensureAudio();
      if (audioContext.state === "suspended") await audioContext.resume();
      
      isPlaying = false;
      cancelAnimationFrame(timerId);
      
      // Stop previous sounds immediately if we are hitting Play again
      activeNodes.forEach(n => { try { n.stop(); } catch(e) {} });
      activeNodes = [];
      
      // Reset Master Gain immediately to full volume
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

```
