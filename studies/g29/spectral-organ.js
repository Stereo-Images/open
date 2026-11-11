  // g29 spectral chorus is frequency-selective delay modulation, not FFT
  // resynthesis or pitch transposition. Only wet paths are band-filtered;
  // a single unchanged dry path preserves the filtered organ's tonal center.
  const SPECTRAL_ORGAN_CHORUS=Object.freeze({
    kind:'three-band-spectral-chorus',dryGain:.92,feedback:.10,
    feedbackCutoffHz:850,feedbackQ:.45,releaseSeconds:.5,
    bands:Object.freeze([
      {name:'foundation',lowHz:null,highHz:180,wetGainPerSide:.055,
        left:{delaySeconds:.031,depthSeconds:.0012,rateHz:.023,pan:-.35},
        right:{delaySeconds:.039,depthSeconds:-.0015,rateHz:.029,pan:.35}},
      {name:'body',lowHz:180,highHz:500,wetGainPerSide:.22,
        left:{delaySeconds:.025,depthSeconds:.0035,rateHz:.037,pan:-1},
        right:{delaySeconds:.034,depthSeconds:-.0041,rateHz:.043,pan:1}},
      {name:'upper-partials',lowHz:500,highHz:null,wetGainPerSide:.24,
        left:{delaySeconds:.022,depthSeconds:.0042,rateHz:.053,pan:-1},
        right:{delaySeconds:.031,depthSeconds:-.0048,rateHz:.061,pan:1}}
    ].map(b=>Object.freeze({...b,left:Object.freeze(b.left),right:Object.freeze(b.right)})))
  });

  function createSpectralOrganGenerator(seed,baseFreq,duration){
    const composition=createPrincipalPlenumGenerator(seed,baseFreq,duration);
    // The retained g27 planner supplies the exact per-voice filter sweep.
    // Its independent seeded stream does not alter the g28 pipe recipes.
    const filterSource=createAudibleOrganRoomGenerator(seed,baseFreq,duration);
    const {filterEdgeHz,filterPeakHz,chorus,...registration}=PRINCIPAL_PLENUM;
    return {
      density:composition.density,arcLen:composition.arcLen,arcClimaxAt:composition.arcClimaxAt,
      study:Object.freeze({...composition.study,droneArch:Object.freeze({...composition.study.droneArch,
        instrument:'filtered-spectral-principal-organ',organChorus:SPECTRAL_ORGAN_CHORUS,
        registration:Object.freeze({...registration,filterSourceEngine:'27',chorus:SPECTRAL_ORGAN_CHORUS}),
        effectOrder:Object.freeze(['pipe-ranks','envelope','g27-filter','spectral-chorus','convolution-room'])})}),
      get nextTime(){return composition.nextTime;},
      next(){
        const group=composition.next(),filtered=filterSource.next();
        if(!group?.interlude)return group;
        return {...group,interlude:Object.freeze({...group.interlude,instrument:'filtered-spectral-principal-organ'}),
          notes:group.notes.map((note,index)=>({...note,
            interludeEffects:Object.freeze({...filtered.notes[index].interludeEffects}),
            organ:Object.freeze({...note.organ,registration:'filtered-spectral-plenum-g29',
              chorus:SPECTRAL_ORGAN_CHORUS,spectralChorus:SPECTRAL_ORGAN_CHORUS})}))};
      }
    };
  }

  function createSpectralOrganChorus(ctx,destination,note,time){
    const p=note.organ.spectralChorus,end=time+note.duration;
    const nodes=[],own=node=>{nodes.push(trackNode(ctx,node));return node;};
    try{
      const input=own(ctx.createGain()),dry=own(ctx.createGain()),mono=own(ctx.createGain());
      mono.channelCount=1;mono.channelCountMode='explicit';mono.channelInterpretation='speakers';
      dry.gain.value=p.dryGain;input.connect(dry);dry.connect(destination);input.connect(mono);
      for(const band of p.bands){
        let bandInput=mono;
        for(const [type,hz] of [['highpass',band.lowHz],['lowpass',band.highHz]]){
          if(hz==null)continue;
          const filter=own(ctx.createBiquadFilter());filter.type=type;
          filter.frequency.value=hz;filter.Q.value=Math.SQRT1_2;
          bandInput.connect(filter);bandInput=filter;
        }
        for(const side of [band.left,band.right]){
          const delay=own(ctx.createDelay(.08)),lfo=own(ctx.createOscillator()),depth=own(ctx.createGain());
          const feedback=own(ctx.createGain()),damping=own(ctx.createBiquadFilter());
          const wet=own(ctx.createGain()),pan=own(ctx.createStereoPanner());
          delay.delayTime.setValueAtTime(side.delaySeconds,time);
          lfo.type='sine';lfo.frequency.value=side.rateHz;depth.gain.value=side.depthSeconds;
          lfo.connect(depth);depth.connect(delay.delayTime);
          damping.type='lowpass';damping.frequency.value=p.feedbackCutoffHz;damping.Q.value=p.feedbackQ;
          feedback.gain.setValueAtTime(p.feedback,time);
          feedback.gain.setValueAtTime(p.feedback,end-p.releaseSeconds);
          feedback.gain.linearRampToValueAtTime(0,end);
          const level=band.wetGainPerSide*(1-p.feedback);
          wet.gain.setValueAtTime(level,time);wet.gain.setValueAtTime(level,end-p.releaseSeconds);
          wet.gain.linearRampToValueAtTime(0,end);pan.pan.value=side.pan;
          bandInput.connect(delay);delay.connect(damping);damping.connect(feedback);feedback.connect(delay);
          delay.connect(wet);wet.connect(pan);pan.connect(destination);
          lfo.start(time);lfo.stop(end);
        }
      }
      registerVoice(ctx,nodes,end);
      if(ctx!==audioContext)spatialStates.get(ctx).nodes.push(...nodes);
      return input;
    }catch(error){
      for(const node of nodes){try{node.stop?.(time);}catch{}try{node.disconnect();}catch{}activeNodes.delete(node);}
      throw error;
    }
  }
