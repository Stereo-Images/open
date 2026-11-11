  // g27 exposes a fuller organ tail and removes the long empty handoffs.
  // Only reverb may overlap the returning bells; all direct voices finish first.
  const AUDIBLE_ORGAN_ROOM = Object.freeze({
    kind: 'convolution', impulseSeconds: 12, preDelaySeconds: .025,
    roomSeconds: 12, impulseDecayExponent: .9, tailAllowanceSeconds: 12.325, minimumDryGapSeconds: 2,
    dryGain: .8, wetGain: 1.1, wetShelfHz: 1600, wetShelfDb: 1.5,
    sectionGapSeconds: 2, bellTailHandoff: true, tailMayOverlapBells: true,
    bellHoldFraction: .35, bellHoldMinimumSeconds: 4, bellHoldMaximumSeconds: 12,
    backgroundInstrument: 'legacy-fm-drone'
  });
  function createAudibleOrganRoomGenerator(seed, baseFreq, duration) {
    const composition = createMirroredStudyGenerator(seed, baseFreq, duration,
      {sectionGapSeconds: AUDIBLE_ORGAN_ROOM.sectionGapSeconds,
        organTailSeconds: AUDIBLE_ORGAN_ROOM.tailAllowanceSeconds, bellTailHandoff: true});
    return {
      density: composition.density, arcLen: composition.arcLen, arcClimaxAt: composition.arcClimaxAt,
      study: Object.freeze({...composition.study,
        backgroundInstrument: AUDIBLE_ORGAN_ROOM.backgroundInstrument,
        droneArch: Object.freeze({...composition.study.droneArch,
          effects: Object.freeze({...composition.study.droneArch.effects, ...AUDIBLE_ORGAN_ROOM})})}),
      get nextTime() { return composition.nextTime; },
      next() {
        const group = composition.next();
        if (!group?.interlude) return group;
        return {...group, notes: group.notes.map(note => ({...note,
          organ: Object.freeze({...note.organ, room:'audible-convolution-g27'})}))};
      }
    };
  }

  const audibleOrganEffectStates = new WeakMap();
  function getAudibleOrganEffects(ctx, destination) {
    if (audibleOrganEffectStates.has(ctx)) return audibleOrganEffectStates.get(ctx);
    const p = AUDIBLE_ORGAN_ROOM;
    const nodes = [], own = node => { nodes.push(trackNode(ctx, node)); return node; };
    try {
      const input = own(ctx.createGain()), dry = own(ctx.createGain());
      const pre = own(ctx.createDelay(.1)), reverb = own(ctx.createConvolver());
      const shelf = own(ctx.createBiquadFilter()), wet = own(ctx.createGain());
      const silentSend = own(ctx.createGain());
      const ir = ctx.createBuffer(2, Math.ceil(ctx.sampleRate*p.impulseSeconds), ctx.sampleRate);
      const random = mulberry32(0x47323652);
      for (let channel = 0; channel < 2; channel++) {
        const data = new Float32Array(ir.length);
        for (let i = 0; i < data.length; i++) {
          const t = i/ctx.sampleRate, attack = Math.min(1, t/.025);
          data[i] = (random()*2-1)*attack*Math.pow(1-i/data.length, p.impulseDecayExponent);
        }
        ir.copyToChannel(data,channel);
      }
      reverb.buffer = ir;
      dry.gain.value = p.dryGain; wet.gain.value = p.wetGain; silentSend.gain.value = 0;
      pre.delayTime.value = p.preDelaySeconds;
      shelf.type = 'highshelf'; shelf.frequency.value = p.wetShelfHz; shelf.gain.value = p.wetShelfDb;
      input.connect(dry); dry.connect(destination);
      input.connect(pre); pre.connect(reverb); reverb.connect(shelf);
      shelf.connect(wet); wet.connect(destination);
      spatialStates.get(ctx).nodes.push(...nodes);
      const state = {input,silentSend}; audibleOrganEffectStates.set(ctx,state);
      return state;
    } catch (error) {
      for (const node of nodes) {try {node.disconnect();} catch {} activeNodes.delete(node);}
      throw error;
    }
  }
