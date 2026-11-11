  // g23 changes only the foreground interlude instrument. Retain g22's score,
  // harmonic choices, voice envelopes, timing, filter sweep and dedicated room.
  // A separate random stream selects full, softly voiced pipe registrations.
  function createSmoothOrganGenerator(seed, baseFreq, duration) {
    const composition = createG20LongGenerator(seed, baseFreq, duration, G22_OPTIONS);
    const random = mulberry32((seed ^ 0x4F52474E) >>> 0);
    const organEvolution = detail => Object.freeze({ ...detail,
      families: Object.freeze(detail.families.map(() => "rich-pipe-organ")) });
    const { granularTextures, ...arch } = composition.study.droneArch;
    return {
      density: composition.density, arcLen: composition.arcLen, arcClimaxAt: composition.arcClimaxAt,
      study: Object.freeze({ ...composition.study, droneArch: Object.freeze({ ...arch,
        instrument: "rich-pipe-organ", synthesis: "additive-harmonic",
        organLevelCalibration: 1.4,
        effects: Object.freeze({ ...arch.effects, wetGain: 0.32 }),
        evolution: Object.freeze(arch.evolution.map(organEvolution)) }) }),
      get nextTime() { return composition.nextTime; },
      next() {
        const group = composition.next();
        if (!group?.interlude) return group;
        // One registration for the whole chord. Variation is static per
        // statement, without beating, tremolo, percussion or a rotary effect.
        const harmonics = Object.freeze([1, 0.58 + random() * 0.06,
          0.24 + random() * 0.04, 0.20 + random() * 0.04,
          0.045 + random() * 0.015, 0.05 + random() * 0.015, 0.008, 0.025]);
        const stopPans = Object.freeze([0, -0.42, 0.24, 0.42, -0.22, 0.22, -0.3, 0.3]);
        return { ...group,
          interlude: Object.freeze({ ...group.interlude,
            instrument: "rich-pipe-organ", evolution: organEvolution(group.interlude.evolution) }),
          notes: group.notes.map(note => {
            const { granular, detune, ...retained } = note;
            return { ...retained, organ: Object.freeze({
              registration: "warm-foundation-and-octaves", harmonics, stopPans,
              outputGain: granular.outputGain * 1.4,
              pitchModulation: 0, tremolo: 0, percussion: false, rotary: false
            }) };
          }) };
      }
    };
  }

  // A broader organ room, with no second send into the bells' reverb. The
  // impulse still ends at four seconds, inside the existing five-second gap.
  const organEffectStates = new WeakMap();
  function getOrganEffects(ctx, destination) {
    if (organEffectStates.has(ctx)) return organEffectStates.get(ctx);
    const nodes = [], own = node => { nodes.push(trackNode(ctx, node)); return node; };
    const input = own(ctx.createGain()), dry = own(ctx.createGain());
    const pre = own(ctx.createDelay(0.1)), reverb = own(ctx.createConvolver());
    const shelf = own(ctx.createBiquadFilter()), wet = own(ctx.createGain());
    const silentSend = own(ctx.createGain());
    const ir = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * 4), ctx.sampleRate);
    const random = mulberry32(0x47323352);
    for (let channel = 0; channel < 2; channel++) {
      const data = new Float32Array(ir.length);
      for (let i = 0; i < data.length; i++) {
        const t = i / ctx.sampleRate, attack = Math.min(1, t / 0.025);
        data[i] = (random() * 2 - 1) * attack * Math.pow(1 - i / data.length, 1.9);
      }
      ir.copyToChannel(data, channel);
    }
    reverb.buffer = ir;
    dry.gain.value = 0.9; wet.gain.value = 0.32; silentSend.gain.value = 0;
    pre.delayTime.value = 0.025;
    shelf.type = 'highshelf'; shelf.frequency.value = 1600; shelf.gain.value = 1.5;
    input.connect(dry); dry.connect(destination);
    input.connect(pre); pre.connect(reverb); reverb.connect(shelf);
    shelf.connect(wet); wet.connect(destination);
    spatialStates.get(ctx).nodes.push(...nodes);
    const state = {input, silentSend}; organEffectStates.set(ctx, state);
    return state;
  }

  function scheduleSmoothOrgan(ctx, destination, note, time) {
    const nodes = [], own = node => { nodes.push(trackNode(ctx, node)); return node; };
    try {
      const amp = own(ctx.createGain()), lp = own(ctx.createBiquadFilter());
      const partials = note.organ.harmonics;
      // Hold oscillator power constant as the registration varies. Octave
      // stops provide body; the subdued higher partials avoid a sharp edge.
      const normalization = 1 / Math.sqrt(partials.reduce((sum, level) => sum + level * level, 0));
      amp.gain.setValueAtTime(0, time);
      for (const point of note.envelope) {
        amp.gain.linearRampToValueAtTime(note.volume * note.organ.outputGain * point.value,
          time + point.time);
      }
      const fx = note.interludeEffects, room = getOrganEffects(ctx, destination);
      lp.type = "lowpass"; lp.Q.value = 0.45;
      lp.frequency.setValueAtTime(fx.startHz, time);
      lp.frequency.exponentialRampToValueAtTime(fx.peakHz, time + note.duration * fx.peakFraction);
      lp.frequency.exponentialRampToValueAtTime(fx.endHz, time + note.duration);
      amp.connect(lp);
      lp.connect(createNoteDrift(ctx, room.input, room.silentSend, time, note.duration, note.pan));
      partials.forEach((level, i) => {
        const oscillator = own(ctx.createOscillator()), stop = own(ctx.createGain());
        const position = own(ctx.createStereoPanner());
        oscillator.type = "sine";
        oscillator.frequency.value = note.freq * (i + 1);
        stop.gain.value = level * normalization;
        position.pan.value = note.organ.stopPans[i];
        oscillator.connect(stop); stop.connect(position); position.connect(amp);
        oscillator.start(time); oscillator.stop(time + note.duration);
      });
      registerVoice(ctx, nodes, time + note.duration);
      if (ctx !== audioContext) spatialStates.get(ctx).nodes.push(...nodes);
    } catch (error) {
      for (const node of nodes) {
        try { node.stop?.(time); } catch {}
        try { node.disconnect(); } catch {}
        activeNodes.delete(node);
      }
      throw error;
    }
  }
