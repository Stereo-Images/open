  // g25 reflects events and recipes, not sampled audio. Natural decays run forward.
  function createMirroredStudyGenerator(seed, baseFreq, duration) {
    const clone = value => JSON.parse(JSON.stringify(value));
    const raw = createStruckStudyGenerator(seed, baseFreq, Infinity, true, G22_OPTIONS);
    const originalTheme = raw.study.theme.slice(), slots = [0,1,2,3,4,5,4,3,2,1,0];
    const theme = slots.map(i => originalTheme[i]);
    const tail = VOICE_SETTLE_SECONDS + 0.1 + 10 + 0.015 + 0.25;
    const startTime = 0.05, sectionGap = 5, statementDuration = 22;
    const halves = [], candidates = [];
    // One expanding/contracting arch, stretched for the selected total length.
    const countsFor = h => Array.from({length: 2*h-1}, (_, i) => h === 1 ? 3 :
      1 + Math.floor(2*Math.min(i, 2*h-2-i)/(h-1)));
    for (let h = 1; h <= 64; h++) {
      const source = Array.from({length: 11}, () => raw.next());
      const originals = source.map(g => g.notes.find(n => n.kind === 'bell'));
      const gaps = originals.slice(1,6).map((n,i) => Math.max(4,n.time-originals[i].time));
      const reflectedGaps = [...gaps,...gaps.slice().reverse()], offsets = [0];
      reflectedGaps.forEach(gap => offsets.push(offsets.at(-1)+gap));
      const bells = slots.map((slot,i) => ({...clone(originals[slot]),time:offsets[i]}));
      const span = offsets.at(-1)+bells.at(-1).duration;
      // Center quiet accompaniment inside a pass, retaining one chord's gain.
      const background = source.flatMap(g=>g.notes).filter(n=>n.kind==='bass')
        .map(n=>({...clone(n),time:(span-n.duration)/2}));
      halves.push({bells,background,span,gaps:reflectedGaps});
      const counts=countsFor(h);
      const end=startTime+2*halves.reduce((sum,p)=>sum+p.span,0)
        +statementDuration*counts.reduce((a,b)=>a+b,0)+sectionGap*(4*h-2);
      if(h>=3&&end+tail>=600&&end+tail<=1800)
        candidates.push({halfCount:h,counts,end,exportDuration:end+tail});
      if(end+tail>1800)break;
    }
    if(!candidates.length)throw new Error('No complete mirrored Long form in the duration range');
    const chosen=candidates.reduce((best,c)=>Math.abs(c.exportDuration-duration)<Math.abs(best.exportDuration-duration)?c:best);
    const h=chosen.halfCount,passCount=2*h;
    const paletteOrder=[...Array(h).keys(),...Array(h).keys()].map((i,j)=>j<h?i:h-1-i);
    const groups=[],entries=[],passes=[];
    let cursor=startTime;
    for(let cycle=0;cycle<passCount;cycle++){
      const palette=paletteOrder[cycle],pass=halves[palette],start=cursor;
      for(let slot=0;slot<pass.bells.length;slot++){
        const bell={...clone(pass.bells[slot]),time:start+pass.bells[slot].time};
        const ending=cycle===passCount-1&&slot===pass.bells.length-1;
        groups.push({time:bell.time,notes:[bell],ending,
          ...(ending?{endingKind:'mirrored-theme-end'}:{}),
          study:{cycle,slot,palette,mirroredSlot:10-slot,varied:false}});
      }
      if(pass.background.length){
        const notes=pass.background.map(n=>({...clone(n),time:start+n.time}));
        groups.push({time:Math.min(...notes.map(n=>n.time)),notes,ending:false,
          background:{cycle,palette,centered:true}});
      }
      cursor+=pass.span;passes.push({cycle,palette,start,end:cursor,span:pass.span});
      if(cycle===passCount-1)continue;
      cursor+=sectionGap;
      const swells=chosen.counts[cycle],end=cursor+swells*statementDuration;
      entries.push({index:cycle+1,start:cursor,end,returnTime:end+sectionGap,
        swells,pairedIndex:passCount-1-cycle});
      cursor=end+sectionGap;
    }
    // g24 supplies the quiet Principal registration, chorus and energy budget.
    const organSource=createChorusedOrganGenerator(seed,baseFreq,1800),organTemplates=[];
    for(let g;(g=organSource.next());)if(g.interlude)organTemplates.push(g);
    const pc=f=>((Math.round(12*Math.log2(f/baseFreq))%12)+12)%12;
    const palette=[
      {name:'I',root:0,quality:'major',pitches:[0,4,7]},
      {name:'ii',root:2,quality:'minor',pitches:[2,5,9]},
      {name:'IV',root:5,quality:'major',pitches:[5,9,0]},
      {name:'vi',root:9,quality:'minor',pitches:[9,0,4]},
      ...[0,2,5,7,9].map((root,i)=>({name:['I','ii','IV','V','vi'][i]+' (open fifth)',
        root,quality:'open-fifth',pitches:[root,(root+7)%12]}))];
    const voicings=chord=>{
      const result=[],pitches=chord.pitches.flatMap(p=>[-24,-12,0,12,24].map(o=>p+o))
        .filter(p=>baseFreq*2**(p/12)>=DRONE_FLOOR_HZ&&baseFreq*2**(p/12)<=349.23).sort((a,b)=>a-b);
      function add(chosen,start){
        if(chosen.length===chord.pitches.length){
          const inversion=chord.pitches.indexOf((chosen[0]%12+12)%12);
          if(inversion>(chord.quality==='open-fifth'?0:1)||baseFreq*2**(chosen[0]/12)>200||
            chosen.at(-1)-chosen[0]>19||(baseFreq*2**(chosen[0]/12)<130&&chosen[1]-chosen[0]<5))return;
          result.push({semitones:chosen,inversion,spacing:chosen.at(-1)-chosen[0]>12?'open':'close'});return;
        }
        for(let i=start;i<pitches.length;i++){
          const p=pitches[i];if(chosen.some(q=>(p-q)%12===0)||(chosen.length&&p-chosen.at(-1)<3))continue;
          add([...chosen,p],i+1);
        }
      }
      add([],0);return result;
    };
    const options=palette.map(c=>({...c,voicings:voicings(c)})),random=mulberry32((seed^0x4D495252)>>>0);
    const choose=(items,score)=>{
      const weights=items.map(x=>Math.exp(score(x)));let draw=random()*weights.reduce((a,b)=>a+b,0);
      return items.find((_,i)=>(draw-=weights[i])<0)||items.at(-1);
    };
    const bells=groups.flatMap(g=>g.notes).filter(n=>n.kind==='bell');
    const contextFor=entry=>({
      before:bells.filter(n=>n.time<entry.start).slice(-4),
      after:bells.filter(n=>n.time>=entry.returnTime-1e-8).slice(0,4),
      overlap:groups.flatMap(g=>g.notes).filter(n=>n.time<entry.end+tail&&n.time+n.duration+tail>entry.start)
    });
    const power=points=>points.slice(1).reduce((sum,p,i)=>{
      const a=points[i];return sum+(p.time-a.time)*(a.value**2+a.value*p.value+p.value**2)/3;
    },0);
    const valueAt=(points,t)=>{
      const j=points.findIndex(p=>p.time>=t);if(j<=0)return points[0].value;
      const a=points[j-1],b=points[j];return a.value+(b.value-a.value)*(t-a.time)/(b.time-a.time);
    };
    function statement(template,semitones){
      const originals=template.notes,budget=originals.reduce((sum,n)=>sum+n.volume,0);
      const weights=semitones.length===3?[.45,.25,.30]:[.625,.375],registration=clone(originals[0].organ);
      const notes=semitones.map((pitch,i)=>{
        const sourceIndex=i===semitones.length-1?originals.length-1:Math.min(i,originals.length-1);
        const source=originals[sourceIndex],n=clone(source),d=n.duration,count=Math.ceil(d/.25);
        n.envelope=Array.from({length:count+1},(_,k)=>{
          const t=d*k/count;return {time:t,value:k===0||k===count?0:(valueAt(source.envelope,t)+valueAt(source.envelope,d-t))/2};
        });
        n.freq=baseFreq*2**(pitch/12);n.time=(statementDuration-d)/2;n.volume=budget*weights[i];n.interludeVoice=i;
        n.organ={...registration,outputGain:source.organ.outputGain};
        const edgeHz=Math.sqrt(n.interludeEffects.startHz*n.interludeEffects.endHz);
        n.interludeEffects={...n.interludeEffects,startHz:edgeHz,endHz:edgeHz,peakFraction:.5};return n;
      });
      // Preserve quiet planned chord energy when voice count/envelope changes.
      const energy=ns=>ns.reduce((sum,n)=>sum+power(n.envelope)*(n.volume*n.organ.outputGain)**2,0);
      const scale=Math.sqrt(energy(originals)/energy(notes));
      notes.forEach(n=>n.envelope.forEach(p=>{p.value*=scale;}));return notes;
    }
    let previous=null,templateCursor=0;
    for(let i=0;i<h;i++){
      const pair=[entries[i]];if(i!==entries.length-1-i)pair.push(entries[entries.length-1-i]);
      const contexts=pair.map(contextFor);
      const safe=options.filter(c=>c.voicings.length&&c.pitches.every(p=>contexts.every(ctx=>
        ctx.overlap.every(n=>![1,6,11].includes((p-pc(n.freq)+12)%12)))));
      if(!safe.length)throw new Error('No chord compatible with both reflected interludes');
      const chord=choose(safe,c=>{
        let coverage=0,endpoints=0;
        for(const ctx of contexts){
          ctx.before.forEach((n,j)=>{if(c.pitches.includes(pc(n.freq)))coverage+=(j+1)/ctx.before.length;});
          ctx.after.forEach((n,j)=>{if(c.pitches.includes(pc(n.freq)))coverage+=(ctx.after.length-j)/ctx.after.length;});
          endpoints+=[ctx.before.at(-1),ctx.after[0]].filter(n=>n&&c.pitches.includes(pc(n.freq))).length;
        }
        return .45*coverage/pair.length+.6*endpoints/pair.length+(c.pitches.length===3?.65:0)-(previous?.name===c.name?1.25:0);
      });
      const voicing=choose(chord.voicings,c=>{
        if(!previous)return -Math.abs(c.semitones[0])*.08;
        const old=previous.semitones,next=c.semitones,common=next.filter(p=>old.includes(p)).length;
        const motion=next.reduce((sum,p)=>sum+Math.min(...old.map(q=>Math.abs(p-q))),0)/next.length;
        const bassLeap=Math.abs(next[0]-old[0]);
        return common*.55-motion*.12-bassLeap*.12-Math.max(0,bassLeap-5)*.2;
      });
      const count=pair[0].swells;
      const left=Array.from({length:Math.ceil(count/2)},()=>statement(organTemplates[templateCursor++%organTemplates.length],voicing.semitones));
      const statements=Array.from({length:count},(_,j)=>left[Math.min(j,count-1-j)]);
      pair.forEach((entry,pairIndex)=>{
        const ctx=contexts[pairIndex];
        entry.harmony={name:chord.name,quality:chord.quality,root:chord.root,pitchClasses:chord.pitches.slice(),
          semitones:voicing.semitones.slice(),inversion:voicing.inversion,spacing:voicing.spacing,voiceCount:voicing.semitones.length,
          precedingPitches:ctx.before.map(n=>pc(n.freq)),followingPitches:ctx.after.map(n=>pc(n.freq)),
          overlappingPitchClasses:[...new Set(ctx.overlap.map(n=>pc(n.freq)))].sort((a,b)=>a-b)};
        for(let j=0;j<count;j++){
          const time=entry.start+j*statementDuration;
          groups.push({time,ending:false,interlude:{index:entry.index,swell:j+1,swells:count,harmony:entry.harmony,
            instrument:'principal-organ',pairedIndex:entry.pairedIndex,
            evolution:{movement:null,symmetricEnvelope:true,families:statements[j].map(()=>'principal-organ')}},
            notes:statements[j].map(n=>({...clone(n),time:time+n.time}))});
        }
      });
      previous={name:chord.name,semitones:voicing.semitones};
    }
    groups.sort((a,b)=>a.time-b.time);let position=0;
    return {
      density:raw.density,arcLen:0,arcClimaxAt:-1,
      study:Object.freeze({form:'nested-mirror',scale:[0,2,4,5,7,9],theme,sourceTheme:originalTheme,
        pitchPolicy:'exact-mirrored-theme',endingPolicy:'complete-mirror',
        mirror:{slotOrder:slots,paletteOrder,passCount,halfCount:h,passes,start:startTime,end:cursor,
          midpoint:(startTime+cursor)/2,sectionGapSeconds:sectionGap,eventSymmetry:true,reverseAudio:false},
        droneArch:{...clone(organSource.study.droneArch),pattern:chosen.counts,form:'single-mirrored-arch',interludes:entries,
          evolution:groups.filter(g=>g.interlude).map(g=>g.interlude.evolution),
          harmony:{...clone(organSource.study.droneArch.harmony),policy:'paired-melody-context'},minimumDryGapSeconds:sectionGap}}),
      get nextTime(){return groups[position]?.time??Infinity;},next(){return groups[position++]??null;}
    };
  }
