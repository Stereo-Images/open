  // g28: a voiced Principal chorus, not a sample of a particular Bach recording.
  // Stops have their own harmonic spectra and stable, seeded pipe phases.
  // The g27 score, bell FM, quiet accompaniment, envelopes and room are retained.
  const PRINCIPAL_PLENUM = Object.freeze({
    registration: 'principal-plenum-g28', outputScale: 1.12,
    filterEdgeHz: 2400, filterPeakHz: 3100, filterQ: .45,
    bass16Gain: .26,
    ranks: Object.freeze([
      {name: "Principal 8′", ratio: 1, gain: 1, pan: -.18,
        harmonics: [1,.65,.42,.24,.13,.10,.055,.045,.022,.017,.010,.008]},
      {name: "Octave 4′", ratio: 2, gain: .60, pan: .28,
        harmonics: [1,.45,.20,.10,.05,.025,.012,.008]},
      {name: "Superoctave 2′", ratio: 4, gain: .30, pan: -.32,
        harmonics: [1,.28,.08,.025,.01]},
      {name: "Mixture III — 2⅔′", ratio: 3, gain: .065, pan: .18,
        harmonics: [1,.12,.025]},
      {name: "Mixture III — 1⅓′", ratio: 6, gain: .045, pan: -.25,
        harmonics: [1,.10,.015]},
      {name: "Mixture III — 1′", ratio: 8, gain: .030, pan: .35,
        harmonics: [1,.08]}
    ].map(rank => Object.freeze({...rank, harmonics:Object.freeze(rank.harmonics)}))),
    chorus: ORGAN_CHORUS_PROFILE
  });

  function createPrincipalPlenumGenerator(seed, baseFreq, duration) {
    const composition = createAudibleOrganRoomGenerator(seed, baseFreq, duration);
    return {
      density:composition.density, arcLen:composition.arcLen, arcClimaxAt:composition.arcClimaxAt,
      study:Object.freeze({...composition.study, droneArch:Object.freeze({...composition.study.droneArch,
        instrument:'principal-plenum-organ', registration:PRINCIPAL_PLENUM,
        organChorus:PRINCIPAL_PLENUM.chorus,
        evolution:Object.freeze(composition.study.droneArch.evolution.map(detail => Object.freeze({
          ...detail, families:Object.freeze(detail.families.map(()=>'principal-plenum-organ')) }))) })}),
      get nextTime(){return composition.nextTime;},
      next(){
        const group=composition.next();
        if(!group?.interlude)return group;
        const e=group.interlude;
        // Paired interludes and reflected statements use identical recipes.
        const pair=Math.min(e.index,e.pairedIndex), statement=Math.min(e.swell,e.swells+1-e.swell);
        const pipeRandom=mulberry32((seed^0x504C454E^Math.imul(pair,0x9E3779B1)^Math.imul(statement,0x85EBCA6B))>>>0);
        const edge=PRINCIPAL_PLENUM.filterEdgeHz*(.97+pipeRandom()*.06);
        const peak=PRINCIPAL_PLENUM.filterPeakHz*(.97+pipeRandom()*.06);
        const lowest=Math.min(...group.notes.map(n=>n.freq));
        const notes=group.notes.map(note=>{
          const ranks=PRINCIPAL_PLENUM.ranks.map(rank=>({...rank}));
          // A quiet octave doubling of the lowest chord voice supplies weight;
          // this is part of the interlude chord, not an independent pedal line.
          if(note.freq===lowest)ranks.unshift({name:"Foundation 16′",ratio:.5,
            gain:PRINCIPAL_PLENUM.bass16Gain,pan:0,harmonics:[1,.20,.065,.025]});
          const pipes=Object.freeze(ranks.map(rank=>Object.freeze({...rank,
            detuneCents:(pipeRandom()-.5)*1.2,phase:pipeRandom()*Math.PI*2})));
          return {...note,
            interludeEffects:Object.freeze({startHz:edge,peakHz:peak,endHz:edge,peakFraction:.5}),
            organ:Object.freeze({...note.organ,registration:PRINCIPAL_PLENUM.registration,
              synthesis:'independent-periodic-pipe-ranks',ranks:pipes,
              outputGain:note.organ.outputGain*PRINCIPAL_PLENUM.outputScale,
              chorus:PRINCIPAL_PLENUM.chorus})};
        });
        return {...group,interlude:Object.freeze({...e,instrument:'principal-plenum-organ',
          evolution:Object.freeze({...e.evolution,families:Object.freeze(notes.map(()=>'principal-plenum-organ'))})}),notes};
      }
    };
  }

  function schedulePrincipalPlenum(ctx,destination,note,time) {
    const nodes=[],own=node=>{nodes.push(trackNode(ctx,node));return node;};
    try {
      const amp=own(ctx.createGain()),lp=own(ctx.createBiquadFilter());
      const ranks=note.organ.ranks;
      const normalization=1/Math.sqrt(ranks.reduce((sum,rank)=>sum+rank.gain**2,0));
      amp.gain.setValueAtTime(0,time);
      for(const point of note.envelope)
        amp.gain.linearRampToValueAtTime(note.volume*note.organ.outputGain*point.value,time+point.time);
      const fx=note.interludeEffects,room=getOrganEffects(ctx,destination,note.organ.room);
      lp.type='lowpass';lp.Q.value=PRINCIPAL_PLENUM.filterQ;
      lp.frequency.setValueAtTime(fx.startHz,time);
      lp.frequency.exponentialRampToValueAtTime(fx.peakHz,time+note.duration*fx.peakFraction);
      lp.frequency.exponentialRampToValueAtTime(fx.endHz,time+note.duration);
      amp.connect(lp);
      const output=createNoteDrift(ctx,room.input,room.silentSend,time,note.duration,note.pan);
      lp.connect(createOrganChorus(ctx,output,note,time));
      for(const rank of ranks){
        const oscillator=own(ctx.createOscillator()),gain=own(ctx.createGain()),pan=own(ctx.createStereoPanner());
        const real=new Float32Array(rank.harmonics.length+1),imag=new Float32Array(real.length);
        const levelScale=1/Math.sqrt(rank.harmonics.reduce((sum,a)=>sum+a*a,0));
        rank.harmonics.forEach((level,index)=>{
          const harmonic=index+1,phase=rank.phase*harmonic;
          if(note.freq*rank.ratio*harmonic<ctx.sampleRate*.45){
            real[harmonic]=level*levelScale*Math.sin(phase);
            imag[harmonic]=level*levelScale*Math.cos(phase);
          }
        });
        oscillator.setPeriodicWave(ctx.createPeriodicWave(real,imag,{disableNormalization:true}));
        oscillator.frequency.value=note.freq*rank.ratio;oscillator.detune.value=rank.detuneCents;
        gain.gain.value=rank.gain*normalization;pan.pan.value=rank.pan;
        oscillator.connect(gain);gain.connect(pan);pan.connect(amp);
        oscillator.start(time);oscillator.stop(time+note.duration);
      }
      registerVoice(ctx,nodes,time+note.duration);
      if(ctx!==audioContext)spatialStates.get(ctx).nodes.push(...nodes);
    } catch(error) {
      for(const node of nodes){try{node.stop?.(time);}catch{}try{node.disconnect();}catch{}activeNodes.delete(node);}
      throw error;
    }
  }
