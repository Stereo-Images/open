/*
 * Open – Generative bell songs using the Web Audio API
 *
 * This script handles user input, schedules hourly playback, and creates
 * bell-like sounds from scratch. It leverages oscillators and gain
 * envelopes to approximate bell timbres and composes melodies based
 * on scales corresponding to different moods. Songs can be generated
 * immediately or automatically at the start of every hour.
 */

(() => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  let scheduledTimer = null;
  let activeNodes = [];

  // Preference scores to personalize generation based on user feedback. Scores
  // are persisted in localStorage so they survive page reloads. Each
  // category (mood, melody) holds numeric values that are increased or
  // decreased based on likes and dislikes. Higher values bias future
  // random selections toward that category.
  const defaultPreferences = {
    mood: { major: 0, minor: 0, pentatonic: 0 },
    melody: { simple: 0, medium: 0, complex: 0 },
  };
  let preferenceScores;
  try {
    preferenceScores = JSON.parse(localStorage.getItem('preferenceScores')) || JSON.parse(JSON.stringify(defaultPreferences));
  } catch (e) {
    preferenceScores = JSON.parse(JSON.stringify(defaultPreferences));
  }
  let lastParams = null;

  /** Save the current preference scores to localStorage. */
  function savePreferences() {
    try {
      localStorage.setItem('preferenceScores', JSON.stringify(preferenceScores));
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * Show feedback UI (like/dislike buttons).
   */
  function showFeedback() {
    const feedbackSection = document.getElementById('feedback');
    if (feedbackSection) feedbackSection.style.display = 'block';
  }

  /**
   * Hide feedback UI.
   */
  function hideFeedback() {
    const feedbackSection = document.getElementById('feedback');
    if (feedbackSection) feedbackSection.style.display = 'none';
  }

  /**
   * Handle user feedback (like/dislike) and update preference scores.
   * @param {boolean} isLike True for like, false for dislike
   */
  function handleFeedback(isLike) {
    if (!lastParams) return;
    const delta = isLike ? 1 : -1;
    const m = lastParams.mood;
    const c = lastParams.melody;
    if (m && preferenceScores.mood[m] !== undefined) {
      preferenceScores.mood[m] += delta;
    }
    if (c && preferenceScores.melody[c] !== undefined) {
      preferenceScores.melody[c] += delta;
    }
    savePreferences();
    hideFeedback();
  }

  // Attach feedback event listeners when DOM loads (these elements exist at load time)
  document.addEventListener('DOMContentLoaded', () => {
    const likeBtn = document.getElementById('likeBtn');
    const dislikeBtn = document.getElementById('dislikeBtn');
    if (likeBtn) {
      likeBtn.addEventListener('click', () => handleFeedback(true));
    }
    if (dislikeBtn) {
      dislikeBtn.addEventListener('click', () => handleFeedback(false));
    }
  });

  // Predefined scales (semitone offsets) for different moods
  const scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    random: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };

  /**
   * Choose a mood (scale) based on user preference weights. Returns one
   * of 'major', 'minor' or 'pentatonic' with probability proportional
   * to 1 plus the stored preference score for each mood. A baseline of
   * 1 ensures every mood is possible even if the score is negative.
   * @returns {string}
   */
  function chooseMoodFromPreferences() {
    const moodNames = ['major', 'minor', 'pentatonic'];
    // Compute weights as baseline + score; ensure minimum positive weight
    const weights = moodNames.map((m) => {
      const score = (preferenceScores.mood && preferenceScores.mood[m]) || 0;
      return Math.max(0.1, 1 + score);
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum;
    for (let i = 0; i < moodNames.length; i++) {
      if (r < weights[i]) {
        return moodNames[i];
      }
      r -= weights[i];
    }
    return moodNames[0]; // fallback
  }

  /**
   * Generate a set of FM voices with random modulation ratios, indices
   * and amplitude weights. Each call returns a fresh array of
   * voices to produce a slightly different timbre. The number of voices
   * varies between two and three. Amplitudes are normalized to sum to
   * one so that the overall volume remains consistent.
   * @returns {Array<{modRatio:number, modIndex:number, amp:number}>}
   */
  function generateRandomFmVoices() {
    const numVoices = 2 + Math.floor(Math.random() * 2); // 2 or 3 voices
    const voices = [];
    let totalAmp = 0;
    for (let i = 0; i < numVoices; i++) {
      // Random modulation ratio between 1.5 and 4.0
      const modRatio = 1.5 + Math.random() * 2.5;
      // Random modulation index between 1 and 5
      const modIndex = 1 + Math.random() * 4;
      // Random amplitude weight
      const amp = Math.random();
      voices.push({ modRatio, modIndex, amp });
      totalAmp += amp;
    }
    // Normalize amplitudes so they sum to 1
    voices.forEach((v) => {
      v.amp = v.amp / totalAmp;
    });
    return voices;
  }

  /**
   * Utility to convert semitone offset to a frequency.
   * @param {number} baseFreq Base frequency in Hz
   * @param {number} semitoneOffset Number of semitones from the base
   * @returns {number} Frequency in Hz
   */
  function semitoneToFreq(baseFreq, semitoneOffset) {
    return baseFreq * Math.pow(2, semitoneOffset / 12);
  }

  /**
   * Create a reusable noise buffer used to excite modal resonances.
   * The buffer contains white noise over a short duration.
   *
   * @returns {AudioBuffer}
   */
  function createNoiseBuffer() {
    const duration = 0.1; // seconds
    const sampleRate = audioContext.sampleRate;
    const buffer = audioContext.createBuffer(1, Math.floor(duration * sampleRate), sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      // White noise between -1 and 1
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /**
   * Create an impulse response buffer for a simple reverb effect.
   * This generates decaying noise to simulate reverberation. Longer
   * durations and larger decay factors produce a more distant sound.
   *
   * @param {number} duration Length of the impulse in seconds
   * @param {number} decay Decay exponent controlling how fast the reverb fades
   * @returns {AudioBuffer}
   */
  function createReverbImpulse(duration = 2.0, decay = 2.0) {
    const sampleRate = audioContext.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const impulse = audioContext.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const channelData = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        // Exponential decay with random variations
        channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return impulse;
  }

  // Create reusable resources: noise buffer and reverb node
  const noiseBuffer = createNoiseBuffer();
  const reverbNode = audioContext.createConvolver();
  // Increase reverb length and reduce decay for a more spacious effect
  reverbNode.buffer = createReverbImpulse(5.0, 1.5);
  // Wet/dry mix: amplify the reverberated signal relative to dry
  const reverbGain = audioContext.createGain();
  reverbGain.gain.value = 1.5; // increase wet level
  reverbNode.connect(reverbGain);
  reverbGain.connect(audioContext.destination);

  /**
   * Create and play a single bell-like sound using modal synthesis.
   * A short noise burst excites several resonant bandpass filters
   * (modes) that approximate the physical behaviour of a bell. Each
   * resonator has its own decay envelope and gain. The output is sent
   * through a convolver node to add reverberation, simulating distance.
   *
   * @param {number} freq The base frequency of the note
   * @param {number} duration Duration of the note in seconds
   * @param {number} volume Volume multiplier (0–1)
   * @param {number} startTime The context time at which to start playing
   */
  function playModalBell(freq, duration, volume, startTime) {
    // Ratios and amplitudes loosely based on physical bell modes. These
    // numbers were chosen for a pleasant bell-like sound and can be
    // adjusted for different timbres. The Q values control bandwidth.
    const modeRatios = [1.0, 2.706, 3.563, 4.152, 5.407];
    const modeAmps = [1.0, 0.6, 0.5, 0.4, 0.3];
    const modeQs = [15, 20, 18, 16, 14];

    // Create a gain node for overall volume and dry/wet mix
    const outputGain = audioContext.createGain();
    outputGain.gain.value = volume;
    // Connect to both dry destination and reverb for spatial effect
    outputGain.connect(audioContext.destination);
    outputGain.connect(reverbNode);

    // Create a single noise source as the excitation signal
    const noiseSource = audioContext.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    // For each mode, create a bandpass filter and a gain envelope
    modeRatios.forEach((ratio, index) => {
      const resonantFreq = freq * ratio;
      // Clamp frequency to Nyquist to avoid invalid values
      const maxFreq = audioContext.sampleRate / 2 - 50;
      const effectiveFreq = Math.min(resonantFreq, maxFreq);
      const band = audioContext.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = effectiveFreq;
      band.Q.value = modeQs[index] || 15;

      const modeGain = audioContext.createGain();
      // Envelope: quick attack to a target amplitude and exponential decay
      const attackTime = 0.005;
      const releaseTime = duration;
      modeGain.gain.setValueAtTime(0.0001, startTime);
      modeGain.gain.exponentialRampToValueAtTime(modeAmps[index] * 0.8, startTime + attackTime);
      modeGain.gain.exponentialRampToValueAtTime(0.0001, startTime + releaseTime);

      // Connect the chain: noise -> bandpass -> envelope -> outputGain
      noiseSource.connect(band);
      band.connect(modeGain);
      modeGain.connect(outputGain);

      // Track nodes for cleanup
      activeNodes.push(band, modeGain);
    });

    // Start and stop the noise source
    noiseSource.start(startTime);
    // Noise lasts only for a short portion of the duration (excitation)
    const noiseDuration = 0.02;
    noiseSource.stop(startTime + noiseDuration);
    activeNodes.push(noiseSource, outputGain);
  }

  /**
   * Create and play a single bell-like sound using FM synthesis. This
   * method uses one or more FM voices per note, each consisting of a
   * carrier oscillator and a modulator oscillator. The modulator's
   * output modulates the frequency of the carrier, producing rich,
   * inharmonic spectra. Modulation index and amplitude envelopes
   * decay over the duration to emulate the ringing of a bell. The
   * result is routed through the global reverb node as well as a dry
   * path to the destination.
   *
   * @param {number} freq The base frequency of the note
   * @param {number} duration Duration of the note in seconds
   * @param {number} volume Volume multiplier (0–1)
   * @param {number} startTime The context time at which to start playing
   */
  function playFmBell(freq, duration, volume, startTime, voicesOverride) {
    // Define FM voices with modulation ratios and indices. If an override is
    // supplied it is used; otherwise default two voices are used.
    const defaultVoices = [
      { modRatio: 2.0, modIndex: 3.0, amp: 1.0 },
      { modRatio: 3.0, modIndex: 1.5, amp: 0.6 },
    ];
    const voices = voicesOverride || defaultVoices;
    voices.forEach((voice) => {
      const carrier = audioContext.createOscillator();
      const modulator = audioContext.createOscillator();
      const modGain = audioContext.createGain();
      const ampGain = audioContext.createGain();

      // Set base frequencies
      carrier.frequency.value = freq;
      modulator.frequency.value = freq * voice.modRatio;

      // Modulation index: controls frequency deviation
      // Start with a high deviation and decay over time
      const maxDeviation = freq * voice.modIndex;
      modGain.gain.setValueAtTime(maxDeviation, startTime);
      // Decay modulation index exponentially
      modGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      // Connect modulator to modGain then to carrier frequency
      modulator.connect(modGain);
      modGain.connect(carrier.frequency);

      // Amplitude envelope for the carrier output
      ampGain.gain.setValueAtTime(0.0001, startTime);
      ampGain.gain.exponentialRampToValueAtTime(volume * voice.amp, startTime + 0.01);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      // Connect to reverb and dry destination
      carrier.connect(ampGain);
      ampGain.connect(reverbNode);
      ampGain.connect(audioContext.destination);

      // Start oscillators and stop after duration
      modulator.start(startTime);
      carrier.start(startTime);
      modulator.stop(startTime + duration);
      carrier.stop(startTime + duration);

      // Track nodes for cleanup
      activeNodes.push(carrier, modulator, modGain, ampGain);
    });
  }

  /**
   * Generate a melody as an array of frequencies based on parameters.
   * @param {Object} params Parameter object: length, base, mood, complexity, density
   * @returns {Object[]} Array of note objects {freq, start, dur}
   */
  function generateMelody(params) {
    const length = parseFloat(params.length) || 30; // total length of composition (s)
    const baseFreq = parseFloat(params.tone) || 440; // base frequency
    // Determine the actual mood to use: if random, pick using preferences
    let moodName = params.mood;
    if (moodName === 'random') {
      moodName = chooseMoodFromPreferences();
      params.actualMood = moodName;
    } else {
      params.actualMood = moodName;
    }
    const scale = scales[moodName] || scales.major;
    const complexity = params.melody; // simple, medium, complex
    const density = parseInt(params.density, 10) || 3; // density influences note rate

    // Determine note count based on density and complexity
    const complexityFactor = { simple: 0.5, medium: 1, complex: 1.5 };
    const notesPerSecond = density * (complexityFactor[complexity] || 1);
    const totalNotes = Math.max(2, Math.floor(length * notesPerSecond));

    // Create rhythm durations with wider variation. Base duration is the
    // reciprocal of notesPerSecond; we multiply by a random factor
    // depending on complexity to achieve rhythmic diversity.
    const durations = [];
    let remainingTime = length;
    const baseDur = 1 / notesPerSecond;
    for (let i = 0; i < totalNotes - 1; i++) {
      // Determine a random factor for the duration
      let factor;
      if (complexity === 'simple') {
        // Slight variation around the base duration (0.8–1.2)
        factor = 0.8 + Math.random() * 0.4;
      } else if (complexity === 'medium') {
        // Wider variation (0.5–2.0)
        factor = 0.5 + Math.random() * 1.5;
      } else {
        // Very wide variation (0.25–2.25)
        factor = 0.25 + Math.random() * 2.0;
      }
      let dur = baseDur * factor;
      // Ensure we don't overshoot the remaining time too early
      if (remainingTime - dur < baseDur * 0.5) {
        dur = Math.max(0.1, remainingTime / 2);
      }
      durations.push(dur);
      remainingTime -= dur;
    }
    durations.push(Math.max(0.2, remainingTime));

    // Compose the melody note array
    const melody = [];
    let currentTime = 0;
    durations.forEach((dur) => {
      // Pick a random interval from the scale
      const interval = scale[Math.floor(Math.random() * scale.length)];
      const freq = semitoneToFreq(baseFreq, interval);
      melody.push({ freq, start: currentTime, dur });
      currentTime += dur;
    });
    return melody;
  }

  /**
   * Play a full composition based on user parameters.
   * @param {Object} params Parameters
   */
  function playComposition(params) {
    // Clean up any existing nodes
    activeNodes.forEach((node) => {
      try {
        node.disconnect();
      } catch (e) {
        /* ignore */
      }
    });
    activeNodes = [];

    const now = audioContext.currentTime;
    const volume = parseFloat(params.volume) || 0.5;
    // Hide any previous feedback when starting a new composition
    hideFeedback();
    const melody = generateMelody(params);
    // Generate a fresh set of FM voices for this composition so each
    // song has a unique timbre. Voices vary in modulation ratio,
    // modulation index and amplitude.
    const fmVoices = generateRandomFmVoices();
    melody.forEach((note) => {
      playFmBell(note.freq, note.dur, volume, now + note.start, fmVoices);
    });

    const lastNote = melody[melody.length - 1];
    const endTime = now + lastNote.start + lastNote.dur;
    // Record parameters used for preferences (actualMood is set in generateMelody when random)
    lastParams = {
      mood: params.actualMood || params.mood,
      melody: params.melody,
    };
    setStatus(`Playing song… will finish at ${new Date(Date.now() + (endTime - now) * 1000).toLocaleTimeString()}`);
    // Reset status and show feedback after end
    setTimeout(() => {
      setStatus('No song playing.');
      showFeedback();
    }, (endTime - now) * 1000);
  }

  /**
   * Schedule the song to play periodically at a specified interval.
   * The interval is given in minutes (e.g., 30 for every 30 minutes,
   * 60 for hourly, 1440 for daily). The next play is aligned to the
   * nearest multiple of the interval from midnight.
   *
   * @param {Object} params Parameters for the composition
   * @param {number} intervalMinutes Interval between plays in minutes
   */
  function schedulePeriodicPlay(params, intervalMinutes) {
    // Clear existing timer if present
    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      scheduledTimer = null;
    }
    // Compute time until next boundary
    const now = new Date();
    const totalMinutes = now.getHours() * 60 + now.getMinutes();
    const remainder = totalMinutes % intervalMinutes;
    let minutesUntilNext = remainder === 0 ? 0 : intervalMinutes - remainder;
    // Convert to milliseconds; subtract seconds and millis to align precisely
    let msUntilNext = minutesUntilNext * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();
    // If exactly on boundary we want to play immediately (msUntilNext = 0)
    if (msUntilNext < 0) msUntilNext = 0;
    setStatus(`Scheduled: next play at ${new Date(Date.now() + msUntilNext).toLocaleTimeString()}`);
    scheduledTimer = setTimeout(function tick() {
      playComposition(params);
      scheduledTimer = setTimeout(tick, intervalMinutes * 60 * 1000);
    }, msUntilNext);
  }

  /**
   * Stop playback and any scheduled events.
   */
  function stopAll() {
    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      scheduledTimer = null;
    }
    // Stop and disconnect active nodes
    activeNodes.forEach((node) => {
      try {
        node.stop && node.stop();
        node.disconnect();
      } catch (e) {
        /* ignore */
      }
    });
    activeNodes = [];
    hideFeedback();
    setStatus('Playback stopped.');
  }

  /**
   * Helper to update the status message on the page.
   * @param {string} msg
   */
  function setStatus(msg) {
    document.getElementById('statusMessage').textContent = msg;
  }

  /**
   * Gather parameters from the form.
   * @returns {Object}
   */
  function getParams() {
    const durationSelect = document.getElementById('songDuration');
    const frequencySelect = document.getElementById('frequency');
    return {
      length: durationSelect ? durationSelect.value : 30,
      tone: document.getElementById('tone').value,
      mood: document.getElementById('mood').value,
      melody: document.getElementById('melody').value,
      density: document.getElementById('density').value,
      volume: document.getElementById('volume').value,
      frequency: frequencySelect ? frequencySelect.value : 60,
    };
  }

  // Set up event listeners when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('playNow').addEventListener('click', () => {
      const params = getParams();
      playComposition(params);
    });
    document.getElementById('schedule').addEventListener('click', () => {
      const params = getParams();
      const intervalMinutes = parseInt(params.frequency, 10) || 60;
      schedulePeriodicPlay(params, intervalMinutes);
    });
    document.getElementById('stop').addEventListener('click', () => {
      stopAll();
    });
  });
})();
