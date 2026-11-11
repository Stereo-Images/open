  // g24 voices Long-study foreground chords as Principal/Diapason and adds
  // one slow stereo chorus. Feedback stays inside short, low-pass damped taps.
  const ORGAN_CHORUS_PROFILE = Object.freeze({
    dryGain: 0.92, wetGainPerSide: 0.18, feedback: 0.10,
    feedbackCutoffHz: 850, feedbackQ: 0.45, releaseSeconds: 0.5,
    left: Object.freeze({delaySeconds: 0.020, depthSeconds: 0.0030, rateHz: 0.060, pan: -1}),
    right: Object.freeze({delaySeconds: 0.028, depthSeconds: -0.0034, rateHz: 0.080, pan: 1})
  });

  function createChorusedOrganGenerator(seed, baseFreq, duration) {
    const composition = createSmoothOrganGenerator(seed, baseFreq, duration);
    const random = mulberry32((seed ^ 0x5052494E) >>> 0);
    return {
      density: composition.density, arcLen: composition.arcLen, arcClimaxAt: composition.arcClimaxAt,
      study: Object.freeze({ ...composition.study, droneArch: Object.freeze({ ...composition.study.droneArch,
        instrument: "principal-organ", organChorus: ORGAN_CHORUS_PROFILE,
        evolution: Object.freeze(composition.study.droneArch.evolution.map(detail => Object.freeze({
          ...detail, families: Object.freeze(detail.families.map(() => "principal-organ")) }))),
        effectOrder: Object.freeze(['registration', 'envelope', 'filter', 'chorus-with-feedback', 'room']) }) }),
      get nextTime() { return composition.nextTime; },
      next() {
        const group = composition.next();
        if (!group?.interlude) return group;
        // A firm foundation with a fuller sequence of upper harmonics. This is
        // a gently voiced Principal model, not a mixture/reed registration or
        // a claim to reproduce a particular recorded acoustic pipe rank.
        const harmonics = Object.freeze([1, 0.58 + random() * 0.06,
          0.36 + random() * 0.04, 0.28 + random() * 0.04,
          0.10 + random() * 0.03, 0.08 + random() * 0.02, 0.045, 0.055]);
        return { ...group,
          interlude: Object.freeze({ ...group.interlude, instrument: "principal-organ",
            evolution: Object.freeze({ ...group.interlude.evolution,
              families: Object.freeze(group.interlude.evolution.families.map(() => "principal-organ")) }) }),
          notes: group.notes.map(note => ({ ...note,
            organ: Object.freeze({ ...note.organ, registration: "principal-diapason",
              harmonics, chorus: ORGAN_CHORUS_PROFILE }) })) };
      }
    };
  }

  function createOrganChorus(ctx, destination, note, time) {
    const p = note.organ.chorus, end = time + note.duration;
    const nodes = [], own = node => { nodes.push(trackNode(ctx, node)); return node; };
    try {
      const input = own(ctx.createGain()), dry = own(ctx.createGain());
      const mono = own(ctx.createGain());
      // Preserve the dry stop placement. A common wet source feeds the two
      // independently moving taps; full-width outputs carry their difference.
      mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
      dry.gain.value = p.dryGain;
      input.connect(dry); dry.connect(destination); input.connect(mono);
      for (const side of [p.left, p.right]) {
        const delay = own(ctx.createDelay(0.08)), lfo = own(ctx.createOscillator());
        const depth = own(ctx.createGain()), feedback = own(ctx.createGain());
        const damping = own(ctx.createBiquadFilter()), wet = own(ctx.createGain());
        const pan = own(ctx.createStereoPanner());
        delay.delayTime.setValueAtTime(side.delaySeconds, time);
        lfo.type = 'sine'; lfo.frequency.value = side.rateHz;
        depth.gain.value = side.depthSeconds;
        lfo.connect(depth); depth.connect(delay.delayTime);
        damping.type = 'lowpass'; damping.frequency.value = p.feedbackCutoffHz; damping.Q.value = p.feedbackQ;
        feedback.gain.setValueAtTime(p.feedback, time);
        feedback.gain.setValueAtTime(p.feedback, end - p.releaseSeconds);
        feedback.gain.linearRampToValueAtTime(0, end);
        const level = p.wetGainPerSide * (1 - p.feedback);
        wet.gain.setValueAtTime(level, time);
        wet.gain.setValueAtTime(level, end - p.releaseSeconds);
        wet.gain.linearRampToValueAtTime(0, end);
        pan.pan.value = side.pan;
        mono.connect(delay);
        delay.connect(damping); damping.connect(feedback); feedback.connect(delay);
        delay.connect(wet); wet.connect(pan); pan.connect(destination);
        lfo.start(time); lfo.stop(end);
      }
      registerVoice(ctx, nodes, end);
      if (ctx !== audioContext) spatialStates.get(ctx).nodes.push(...nodes);
      return input;
    } catch (error) {
      for (const node of nodes) {
        try { node.stop?.(time); } catch {}
        try { node.disconnect(); } catch {}
        activeNodes.delete(node);
      }
      throw error;
    }
  }
