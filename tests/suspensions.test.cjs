const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {harness}=require('./support/harness.cjs');
const source=fs.readFileSync(path.join(__dirname,'../player.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const equal=(a,b)=>assert.deepEqual(plain(a),plain(b));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} vs ${b}`);

test('Long suspensions preserve bells, fixed harmony, mirrored form and safe handoffs across the tone range',()=>{
  const {api}=harness(source),counts={sus2:0,sus4:0,resolved:0,total:0};
  for(let i=0;i<24;i++)for(const tone of [110,121,165,200]){
    const seed=Math.imul(i+1,0x9e3779b1)>>>0;
    const score=api.createPerformance(seed,tone,'long','30');
    const old=api.createPerformance(seed,tone,'long','29');
    equal(score.groups.filter(g=>!g.interlude),old.groups.filter(g=>!g.interlude));
    equal(score.study.mirror,old.study.mirror);
    equal(score.study.droneArch.effects,old.study.droneArch.effects);
    equal(score.study.droneArch.registration,old.study.droneArch.registration);
    assert.equal(score.exportDuration,old.exportDuration);
    const pc=f=>((Math.round(12*Math.log2(f/tone))%12)+12)%12;
    const pitches=n=>[n.freq,...(n.organResolution?[n.organResolution.freq]:[])];
    const entries=score.study.droneArch.interludes,all=score.groups.flatMap(g=>g.notes);
    for(const entry of entries){
      counts.total++;
      const harmony=entry.harmony,paired=entries[entry.pairedIndex-1].harmony;
      const suspended=harmony.quality.startsWith('sus');
      equal(harmony.semitones,paired.semitones);
      equal(harmony.resolution??null,paired.resolution??null);
      if(suspended){
        counts[harmony.quality]++;
        assert.equal(harmony.inversion,0);
        assert.ok(harmony.semitones.at(-1)-harmony.semitones[0]>12);
        equal(harmony.pitchClasses.map(p=>(p-harmony.root+12)%12),harmony.quality==='sus2'?[0,2,7]:[0,5,7]);
      }
      const groups=score.groups.filter(g=>g.interlude?.index===entry.index);
      const pairedGroups=score.groups.filter(g=>g.interlude?.index===entry.pairedIndex);
      const recipe=n=>{const {time,...rest}=n;return rest;};
      equal(groups.flatMap(g=>g.notes.map(recipe)),pairedGroups.flatMap(g=>g.notes.map(recipe)));
      for(let j=0;j<groups.length;j++)equal(groups[j].notes.map(recipe),groups.at(-1-j).notes.map(recipe));
      const notes=groups.flatMap(g=>g.notes);
      close(entry.returnTime-Math.max(...notes.map(n=>n.time+n.duration)),2);
      if(harmony.resolution){
        counts.resolved++;
        assert.ok(suspended);
        assert.equal(notes.filter(n=>n.organResolution).length,1,'Only one voice in the middle statement moves');
        assert.equal(harmony.resolution.statement,(groups.length+1)/2);
      }
      for(const group of groups){
        const freq=group.notes.map(n=>n.freq);
        for(let j=1;j<freq.length;j++)assert.ok(12*Math.log2(freq[j]/freq[j-1])>=3-1e-8);
        for(const note of group.notes){
          assert.equal(note.organ.registration,'filtered-spectral-plenum-g29');
          assert.equal(note.organ.spectralChorus.feedback,.1);
          for(const f of pitches(note)){
            assert.ok(f>=87.31&&f<=349.23);
            assert.ok([0,2,4,5,7,9].includes(pc(f)));
            const overlap=all.filter(other=>!notes.includes(other)&&other.time<note.time+note.duration+12.325&&
              other.time+other.duration+10.465>note.time);
            for(const other of overlap)for(const otherFreq of pitches(other))
              assert.ok(![1,6,11].includes((pc(f)-pc(otherFreq)+12)%12),'Suspension and target respect ringing notes');
          }
          if(note.organResolution){
            const change=note.organResolution;
            const motion=Math.abs(12*Math.log2(change.freq/note.freq));
            assert.ok(motion>=1-1e-8&&motion<=2+1e-8);
            assert.ok(change.at>0&&change.at+change.crossfadeSeconds<note.duration);
            const targetPitch=harmony.resolution.semitones[harmony.resolution.voice];
            close(change.freq,tone*2**(targetPitch/12));
          }
        }
      }
    }
  }
  assert.ok(counts.sus2>counts.sus4&&counts.sus4>0,'Both colors occur, favoring sus2');
  assert.ok(counts.sus2+counts.sus4<counts.total*.35,'Suspensions remain occasional');
  assert.ok(counts.resolved>0&&counts.resolved<counts.sus2+counts.sus4,'Some resolve and some stay open');
});

test('saved suspension recipes preserve Short and replay Long deterministically',()=>{
  const {api}=harness(source);
  for(const seed of [0,0x0393ded7,0x0b086950,0xffffffff])for(const tone of [110,121,165,200]){
    const short=api.createPerformance(seed,tone,'short','21');
    equal(short,api.createPerformance(seed,tone,'short','30'));
  }
  const snapshot={seed:0x8ff34739,tone:110,duration:'long',engine:'30',sampleRate:44100};
  const original=api.createPerformance(snapshot.seed,snapshot.tone,snapshot.duration,snapshot.engine);
  const link=api.replayLink(snapshot),record=api.parseReplayInput(link);
  equal(record,snapshot);
  equal(original,api.createPerformance(record.seed,record.tone,record.duration,record.engine));
  const filename=api.parseReplayInput('open-run-8ff34739-example-g30-110hz-long-44100sr-1.wav');
  equal(filename,snapshot);
});

test('a resolving organ voice crossfades fixed pitches through one shared chorus and room and cleans up',()=>{
  const instrumented=source.replace('  function resolveDuration(seed, durationInput) {',
    '  window.organTest={initialize:ctx=>initializeNoteDrift(ctx,123),schedule:schedulePrincipalPlenum,dispose:disposeNoteDrift};\n  function resolveDuration(seed, durationInput) {');
  const h=harness(instrumented),ctx=new h.sandbox.AudioContext(),fx=h.sandbox.organTest;
  const note=h.api.createPerformance(0x8ff34739,110,'long').groups.flatMap(g=>g.notes).find(n=>n.organResolution);
  assert.ok(note);
  const out=ctx.createGain(),time=9,start=time+note.organResolution.at,end=start+note.organResolution.crossfadeSeconds;
  fx.initialize(ctx);fx.schedule(ctx,out,note,time);
  const pipes=ctx.nodes.filter(n=>n.wave),ranks=note.organ.ranks;
  assert.equal(pipes.length,ranks.length*2);
  for(let i=0;i<ranks.length;i++){
    const from=pipes[2*i],to=pipes[2*i+1];
    close(from.frequency.value,note.freq*ranks[i].ratio);
    close(to.frequency.value,note.organResolution.freq*ranks[i].ratio);
    assert.equal(from.frequency.events.length,0);assert.equal(to.frequency.events.length,0);
    close(from.startTime,time);close(from.stopTime,end);
    close(to.startTime,start);close(to.stopTime,time+note.duration);
    const fadeOut=from.connections[0].gain.events,fadeIn=to.connections[0].gain.events;
    assert.equal(fadeOut[0][0],'set');assert.equal(fadeOut[1][0],'ramp');
    assert.equal(fadeIn[0][0],'set');assert.equal(fadeIn[1][0],'ramp');
    close(fadeOut[0][1],fadeIn[1][1]);close(fadeOut[1][1],0);close(fadeIn[0][1],0);
    close(fadeOut[0][2],start);close(fadeIn[0][2],start);
    close(fadeOut[1][2],end);close(fadeIn[1][2],end);
  }
  assert.equal(ctx.nodes.filter(n=>n.kind==='convolver').length,1);
  assert.equal(ctx.nodes.filter(n=>n.kind==='delay').length,7);
  fx.dispose(ctx);
  assert.ok(ctx.nodes.filter(n=>n!==out).every(n=>n.disconnected));
});

