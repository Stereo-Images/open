const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./support/harness.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));
const bellGroups=s=>s.groups.filter(g=>g.study);
const fm=n=>plain({freq:n.freq,duration:n.duration,voices:n.voices,totalAmp:n.totalAmp});
const renderInput=s=>plain({groups:s.groups,density:s.density,
  exportDuration:s.exportDuration,audioSeed:s.audioSeed});

test('the selected study retains its complete first half and returns through C B A',()=>{
  const h=harness(),original=h.api.createPerformance('008b0195e3db9492e',121,'long','39');
  const score=h.api.createPerformance('508b0195e3db9492e',121,'long');
  assert.deepEqual(plain(score.study.mirror.paletteOrder),[0,1,2,2,1,0]);
  assert.deepEqual(plain(score.groups.filter(g=>g.time<original.exportDuration/2)),
    plain(original.groups.filter(g=>g.time<original.exportDuration/2)));
  assert.equal(score.exportDuration,800.9150781135365);
  const bells=bellGroups(score).flatMap(g=>g.notes);
  assert.equal(bells.length,132);
  assert.deepEqual(fm(bells[0]),fm(bells.at(-1)));
  assert.equal(score.groups.find((g,i)=>JSON.stringify(g)!==JSON.stringify(original.groups[i])).time,
    430.18858872536475);
  h.sandbox.__OPEN_PLAYER_KILL__();
});

test('unrelated seeds have nested pitch and FM mirrors while timing, dynamics, space and accompaniment remain intact',()=>{
  const h=harness();let word=0x4d595df4;const next=()=>word=(Math.imul(word,1664525)+1013904223)>>>0;
  const hex=n=>n.toString(16).padStart(8,'0'),counts=new Set();
  for(const root of [110,121,165,200])for(let i=0;i<12;i++){
    const payload=hex(next())+hex(next());
    const original=h.api.createPerformance('0'+payload,root,'long','39');
    const score=h.api.createPerformance('5'+payload,root,'long','41');
    const m=score.study.mirror;counts.add(m.pairCount);
    assert.equal(m.globalPaletteMirror,true);
    assert.equal(score.study.sourceTheme.length,11);
    assert.equal(score.groups.length,original.groups.length);
    assert.equal(score.exportDuration,original.exportDuration);
    assert.equal(score.density,original.density);
    assert.equal(score.audioSeed,original.audioSeed);
    assert.deepEqual(plain(score.study.droneArch),plain(original.study.droneArch));
    const passes=Array.from({length:m.pairCount},(_,cycle)=>
      bellGroups(score).filter(g=>g.study.cycle===cycle).flatMap(g=>g.notes));
    const originals=Array.from({length:m.pairCount},(_,cycle)=>
      bellGroups(original).filter(g=>g.study.cycle===cycle).flatMap(g=>g.notes));
    for(let cycle=0;cycle<m.pairCount;cycle++){
      const notes=passes[cycle];assert.equal(notes.length,22);
      assert.deepEqual(notes.slice(0,11).map(fm),notes.slice(11).reverse().map(fm));
      assert.deepEqual(notes.map(fm),passes.at(-1-cycle).map(fm));
      if(cycle<Math.ceil(m.pairCount/2))assert.deepEqual(plain(notes),plain(originals[cycle]));
    }
    score.groups.forEach((g,j)=>{
      const before=original.groups[j];
      if(!g.study){assert.deepEqual(plain(g),plain(before));return;}
      assert.equal(g.time,before.time);assert.equal(g.ending,before.ending);
      g.notes.forEach((n,k)=>{
        const {voices,totalAmp,...retained}=n;
        const {voices:oldVoices,totalAmp:oldAmp,...oldRetained}=before.notes[k];
        assert.deepEqual(plain(retained),plain(oldRetained));
      });
    });
  }
  assert.ok([...counts].some(n=>n%2===0));assert.ok([...counts].some(n=>n%2===1));
  h.sandbox.__OPEN_PLAYER_KILL__();
});

test('ordinary Play, bare seed, replay link and exported filename restore the same FM arch',async()=>{
  const h=harness();h.sandbox.document.dispatch('DOMContentLoaded');
  h.elements.get('tone').value='121';h.elements.get('songDuration').value='long';
  let draws=0;h.sandbox.crypto.getRandomValues=words=>{
    assert.equal(words.length,2);draws++;words.set([0x08b0195e,0x3db9492e]);return words;
  };
  await h.api.startNewPerformance();
  const score=h.api.state().snapshot;
  assert.equal(draws,1);assert.equal(score.seed,'508b0195e3db9492e');assert.equal(score.engine,'41');
  assert.deepEqual(renderInput(score),renderInput(h.api.createPerformance(score.seed,121,'long')));
  for(const input of [score.seed,h.api.replayLink(score)]){
    h.elements.get('replayInput').value=input;await h.api.replayFromUI();
    assert.deepEqual(renderInput(h.api.state().snapshot),renderInput(score));
    assert.equal(h.api.state().snapshot.engine,'41');assert.equal(draws,1);
  }
  const pending=h.api.renderWavExport();
  h.contexts.at(-1).resolve({length:1,numberOfChannels:2,sampleRate:44100,
    getChannelData:()=>new Float32Array(1),copyFromChannel:a=>a.fill(0)});
  await pending;
  const record=h.api.parseReplayInput(h.downloads[0]);
  assert.equal(record.seed,score.seed);assert.equal(record.engine,'41');
  assert.deepEqual(renderInput(h.api.createPerformance(record.seed,record.tone,record.duration,record.engine)),renderInput(score));
  assert.throws(()=>h.api.parseReplayInput(h.api.replayLink({...score,engine:'39'})));
  assert.throws(()=>h.api.parseReplayInput(h.api.replayLink({...score,seed:'008b0195e3db9492e'})));
  assert.throws(()=>h.api.createPerformance(score.seed,121,'short','41'),/requires Long/);
  h.sandbox.__OPEN_PLAYER_KILL__();
});
