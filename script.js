(() => {
    let audioContext;
    let masterGain;
    let reverbNode;
    let reverbGain;
    let activeNodes = [];
    let isPlaying = false;
    let nextNoteTime = 0;
    let sessionStartTime = 0;
    const scheduleAheadTime = 0.2;
    let timerId;

    const scales = {
        major: [0, 2, 4, 5, 7, 9, 11],
        minor: [0, 2, 3, 5, 7, 8, 10],
        pentatonic: [0, 2, 4, 7, 9],
        random: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    };

    function initAudio() {
        if (audioContext) return;
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Master Gain for smooth stopping (prevents clicking)
        masterGain = audioContext.createGain();
        masterGain.connect(audioContext.destination);

        // Reverb setup
        reverbNode = audioContext.createConvolver();
        reverbGain = audioContext.createGain();
        reverbGain.gain.value = 1.2;

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
        reverbGain.connect(masterGain);
    }

    function playFmBell(freq, duration, volume, startTime) {
        const carrier = audioContext.createOscillator();
        const modulator = audioContext.createOscillator();
        const modGain = audioContext.createGain();
        const ampGain = audioContext.createGain();

        carrier.frequency.value = freq;
        modulator.frequency.value = freq * (1.5 + Math.random() * 2);
        modGain.gain.setValueAtTime(freq * 2, startTime);
        modGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

        ampGain.gain.setValueAtTime(0.0001, startTime);
        ampGain.gain.exponentialRampToValueAtTime(volume, startTime + 0.01);
        ampGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

        modulator.connect(modGain);
        modGain.connect(carrier.frequency);
        carrier.connect(ampGain);
        ampGain.connect(reverbNode);
        ampGain.connect(masterGain);

        modulator.start(startTime);
        carrier.start(startTime);
        activeNodes.push(carrier, modulator, ampGain);
    }

    function scheduler() {
        if (!isPlaying) return;
        const currentTime = audioContext.currentTime;
        
        while (nextNoteTime < currentTime + scheduleAheadTime) {
            const baseFreq = parseFloat(document.getElementById('tone').value);
            const mood = document.getElementById('mood').value;
            const density = parseFloat(document.getElementById('density').value);
            const scale = scales[mood] || scales.major;

            const interval = scale[Math.floor(Math.random() * scale.length)];
            const freq = baseFreq * Math.pow(2, interval / 12);
            const dur = (1 / density) * 2;

            playFmBell(freq, dur, 0.3, nextNoteTime);
            nextNoteTime += (1 / density) * (0.9 + Math.random() * 0.2);
        }
        timerId = requestAnimationFrame(scheduler);
    }

    function stopAll() {
        if (!isPlaying) return;
        isPlaying = false;
        cancelAnimationFrame(timerId);

        // AVOID CLICKING: Ramp down master volume quickly but smoothly
        const now = audioContext.currentTime;
        masterGain.gain.setValueAtTime(masterGain.gain.value, now);
        masterGain.gain.linearRampToValueAtTime(0, now + 0.1);

        setTimeout(() => {
            activeNodes.forEach(n => { try { n.stop(); } catch(e) {} });
            activeNodes = [];
        }, 120);
    }

    document.addEventListener('DOMContentLoaded', () => {
        const toneSlider = document.getElementById('tone');
        const hzReadout = document.getElementById('hzReadout');

        // Fix: Update the readout when sliding
        toneSlider.addEventListener('input', () => {
            hzReadout.textContent = toneSlider.value;
        });

        document.getElementById('playNow').addEventListener('click', async () => {
            initAudio();
            if (audioContext.state === 'suspended') await audioContext.resume();
            
            stopAll(); // Clear previous session
            
            // Ensure master volume is up
            masterGain.gain.setValueAtTime(1, audioContext.currentTime);
            isPlaying = true;
            nextNoteTime = audioContext.currentTime;
            scheduler();
        });

        document.getElementById('stop').addEventListener('click', stopAll);
    });
})();
