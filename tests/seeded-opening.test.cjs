const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {harness}=require('./support/harness.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));
const seeds=[0x3460e991,0xf300fed2,0x1a1155f9,0xaf8338ca,0x0cb6f3c0,0xc785636f,0x64984799,0x141bf02b];
const bells=score=>score.groups.flatMap(g=>g.notes).filter(n=>n.kind==='bell');
const gaps=notes=>notes.slice(1).map((n,i)=>n.time-notes[i].time);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('pitch-only derivatives use the child tempo and bell recipes from their first strike',()=>{
  const source=fs.readFileSync(require.resolve('../player.js'),'utf8');
  const {api}=harness(source);
  // Expose the existing raw Long planner only in this test, to compare the
  // actual child event clock and unrefined voice recipes before pitch mapping.
  const probe=harness(source.replace('function createPerformance(seed,','window.struck=createStruckStudyGenerator;\n  function createPerformance(seed,'));
  for(const tone of [110,121,165,200]){
    const old=api.createPerformance(0x08b0195e,tone,'long','33','32');
    const pitches=bells(old).slice(0,28).map(n=>n.freq);
    for(const seed of seeds){
      const score=api.createPerformance(seed,tone,'long','33','34'),ns=bells(score);
      const raw=probe.sandbox.struck(seed,tone,Infinity,true,{wideTempo:true,maxBpm:15});
      assert.deepEqual(plain(ns.slice(0,28).map(n=>n.freq)),plain(pitches));
      assert.equal(score.density,raw.density);
      assert.equal(score.tempo.nominalBpm,60*raw.density);
      assert.equal(score.study.inheritedOpening.nominalBpm,score.tempo.nominalBpm);
      assert.equal(score.study.inheritedOpening.inheritance,'pitches-only');
      assert.equal(score.audioSeed,undefined,'Room uses child seed');
      for(let i=0;i<28;i++){
        const n=raw.next().notes.find(n=>n.kind==='bell');
        const mapped={...n,freq:pitches[i],voices:n.voices.map(v=>({...v,frequency:pitches[i]+(v.frequency-n.freq)}))};
        assert.deepEqual(plain(ns[i]),plain(api.refineBellFM(mapped)));
      }
      near(ns[28].time,raw.nextTime);
      const normalized=gaps(ns.slice(0,29)).map(g=>g*score.density);
      assert.ok(normalized.every(v=>v>=.95-1e-8&&v<=1.08));
      for(const pass of score.study.mirror.passes){
        const notes=score.groups.filter(g=>g.study?.cycle===pass.cycle).flatMap(g=>g.notes).filter(n=>n.kind==='bell');
        const gs=gaps(notes);gs.forEach((g,i)=>near(g,gs.at(-1-i)));
        assert.ok(gs.every(g=>g*score.density>=.925-1e-8&&g*score.density<=1.08));
      }
      assert.ok(score.exportDuration>=600&&score.exportDuration<=1800);
      assert.deepEqual(plain(score),plain(api.createPerformance(seed,tone,'long','33','34')));
      if(tone===121)assert.ok(ns.slice(1).every((n,i)=>Math.abs(Math.round(12*Math.log2(n.freq/ns[i].freq)))!==6));
    }
  }
});

test('the new pitch-only recipe survives filename, link, playback, export and replay',async()=>{
  const h=harness();h.sandbox.document.dispatch('DOMContentLoaded');
  const settings={seed:0x1a1155f9,tone:121,duration:'long',engine:'33',baseEngine:'34',sampleRate:44100};
  const filename='open-run-1a1155f9-study-g33-b34-121hz-long-44100sr-1794445000000.wav';
  assert.deepEqual(plain(h.api.parseReplayInput(filename)),settings);
  h.elements.get('replayInput').value=h.api.replayLink(settings);
  await h.api.replayFromUI();const expected=plain(h.api.state().snapshot.groups);
  const pending=h.api.renderWavExport();
  h.contexts[1].resolve({length:1,numberOfChannels:2,sampleRate:44100,getChannelData:()=>new Float32Array(1),copyFromChannel:a=>a.fill(0)});
  await pending;assert.deepEqual(plain(h.api.parseReplayInput(h.downloads[0])),settings);
  await h.api.replayLastPerformance();assert.deepEqual(plain(h.api.state().snapshot.groups),expected);
  assert.throws(()=>h.api.createPerformance(1,121,'short','33','34'),/requires Long/);
  assert.throws(()=>h.api.parseReplayInput(h.api.replayLink({...settings,duration:'short'})),/requires Long/);
  assert.equal(h.api.createPerformance(0x1a1155f9,121,'long').study.inheritedOpening,undefined);
  h.sandbox.__OPEN_PLAYER_KILL__();
});
