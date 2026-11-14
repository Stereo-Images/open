const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {harness}=require('./support/harness.cjs');
const manifest=require('../studies/nov12-ordinary-seeds/manifest.json');
const plain=x=>JSON.parse(JSON.stringify(x));
const word=n=>(n>>>0).toString(16).padStart(8,'0');
const seedFor=(kind,melody,performance)=>String(kind)+word(melody)+word(performance);
const renderInput=s=>plain({groups:s.groups,density:s.density,exportDuration:s.exportDuration,audioSeed:s.audioSeed??s.seed});

test('the exact 0393ded7 g3 Short Study remains identical in its saved replay and ordinary Short Play',async()=>{
  const filename='open-run-0393ded7-mviswtcb-g3-200hz-short-44100sr-1792628825406';
  const h=harness();h.sandbox.document.dispatch('DOMContentLoaded');
  h.elements.get('tone').value='200';h.elements.get('songDuration').value='short';
  const reference=h.api.createPerformance(0x0393ded7,200,'short','3');
  const portable=JSON.stringify(reference.groups,(_,v)=>typeof v==='number'?Number(v.toFixed(8)):v);
  assert.equal(crypto.createHash('sha256').update(portable).digest('hex'),'90a479f84b6a2b06f3a5fd69a526aa1f2ccace84126113699af423dc5f23fdd9');
  assert.equal(reference.exportDuration,85.56632370385142);
  assert.equal(reference.groups.flatMap(g=>g.notes).filter(n=>n.kind==='bell').length,11);
  const expected={seed:0x0393ded7,tone:200,duration:'short',engine:'3',sampleRate:44100};
  for(const input of [filename,filename+'.wav'])assert.deepEqual(plain(h.api.parseReplayInput(input)),expected);
  h.elements.get('replayInput').value=filename;await h.api.replayFromUI();
  assert.deepEqual(renderInput(h.api.state().snapshot),renderInput(reference));
  assert.equal(h.api.state().snapshot.engine,'3');
  let draws=0;h.sandbox.crypto.getRandomValues=words=>{assert.equal(words.length,1);draws++;words[0]=0x0393ded7;return words;};
  await h.api.startNewPerformance();
  assert.equal(draws,1);assert.equal(h.api.state().snapshot.engine,'33');
  assert.equal(h.api.state().snapshot.sampleRate,44100);
  assert.deepEqual(renderInput(h.api.state().snapshot),renderInput(reference));
  await h.api.replayLastPerformance();assert.equal(draws,1);
  assert.deepEqual(renderInput(h.api.state().snapshot),renderInput(reference));
  const exportJob=h.api.renderWavExport();
  h.contexts[1].resolve({length:1,numberOfChannels:2,sampleRate:44100,getChannelData:()=>new Float32Array(1),copyFromChannel:a=>a.fill(0)});
  await exportJob;
  const exported=h.api.parseReplayInput(h.downloads[0]);
  assert.equal(exported.seed,0x0393ded7);assert.equal(exported.tone,200);assert.equal(exported.sampleRate,44100);
  assert.deepEqual(renderInput(h.api.createPerformance(exported.seed,exported.tone,exported.duration,exported.engine)),renderInput(reference));
  h.sandbox.__OPEN_PLAYER_KILL__();
});

test('all 24 saved complete seeds retain their exact performances, including under the new replay engine',()=>{
  const h=harness();
  for(const row of manifest.recordings) {
    const before=h.api.createPerformance(parseInt(row.previousSeed,16),121,'long',row.previousEngine);
    for(const engine of ['38','39']) {
      const score=h.api.createPerformance(row.seed,121,'long',engine);
      assert.deepEqual(renderInput(score),renderInput(before),row.seed);
      const portable=JSON.stringify(score.groups,(_,v)=>typeof v==='number'?Number(v.toFixed(8)):v);
      assert.equal(crypto.createHash('sha256').update(portable).digest('hex'),row.portableGroupSha256);
    }
  }
  h.sandbox.__OPEN_PLAYER_KILL__();
});

test('ordinary Play draws complete current-form seeds with no parent performance or seed registry',async()=>{
  for(const row of manifest.recordings) {
    const h=harness();h.sandbox.document.dispatch('DOMContentLoaded');
    h.elements.get('tone').value='121';h.elements.get('songDuration').value='long';
    let draws=0;
    h.sandbox.crypto.getRandomValues=words=>{
      assert.equal(words.length,3);draws++;
      words.set([Number(row.seed[0]),parseInt(row.seed.slice(1,9),16),parseInt(row.seed.slice(9),16)]);return words;
    };
    await h.api.startNewPerformance();
    const score=h.api.state().snapshot;
    assert.equal(h.api.state().isPlaying,true,row.seed);assert.equal(draws,1);
    const expectedSeed=row.seed[0]==='1'?'2'+row.seed.slice(1):row.seed;
    assert.equal(score.seed,expectedSeed);assert.equal(score.engine,'39');
    assert.deepEqual(renderInput(score),renderInput(h.api.createPerformance(expectedSeed,121,'long','39')));
    assert.deepEqual(plain(h.api.createPerformance(expectedSeed,121,'long').groups),plain(score.groups));
    const before=h.api.createPerformance(parseInt(row.previousSeed,16),121,'long',row.previousEngine);
    assert.deepEqual(plain(score.study.sourceTheme),plain(before.study.sourceTheme));
    assert.equal(score.density,before.density);
    if(row.seed[0]==='0')assert.deepEqual(renderInput(score),renderInput(before),row.previousSeed);
    else assert.equal(score.study.form,'theme-organ-mirror');
    h.sandbox.__OPEN_PLAYER_KILL__();
  }
});

test('complete Long seeds round-trip without losing high bits, and legacy records keep their meaning',async()=>{
  for(const row of [manifest.recordings[0],manifest.recordings[8],manifest.recordings[16]]) {
    const h=harness();h.sandbox.document.dispatch('DOMContentLoaded');
    h.elements.get('tone').value='121';h.elements.get('songDuration').value='long';
    const expected={seed:row.seed,tone:121,duration:'long',engine:'38',sampleRate:44100};
    for(const input of [row.replayLink,row.replayFilename,row.replayFilename.replace('.wav',' (2).mp3')])
      assert.deepEqual(plain(h.api.parseReplayInput(input)),expected);
    h.elements.get('replayInput').value=row.seed.toUpperCase();await h.api.replayFromUI();
    assert.equal(h.api.state().snapshot.seed,row.seed);
    const before=renderInput(h.api.state().snapshot);
    const pending=h.api.renderWavExport();
    h.contexts[1].resolve({length:1,numberOfChannels:2,sampleRate:44100,getChannelData:()=>new Float32Array(1),copyFromChannel:a=>a.fill(0)});
    await pending;assert.deepEqual(plain(h.api.parseReplayInput(h.downloads[0])),expected);
    await h.api.replayLastPerformance();assert.deepEqual(renderInput(h.api.state().snapshot),before);
    h.sandbox.__OPEN_PLAYER_KILL__();
  }
  const h=harness();h.sandbox.document.dispatch('DOMContentLoaded');h.elements.get('songDuration').value='long';
  assert.equal(h.api.parseReplayInput('4850166b').engine,'35');
  const high='0fffffffffffffffe', low='0ffffffffffffffff';
  assert.notEqual(h.api.parseReplayInput(high).seed,h.api.parseReplayInput(low).seed);
  for(const bad of ['3ffffffffffffffff','000000000000000000','000000000000000g0'])assert.throws(()=>h.api.parseReplayInput(bad));
  assert.throws(()=>h.api.parseReplayInput(manifest.recordings[0].replayLink.replace('engine=38','engine=35')));
  assert.throws(()=>h.api.parseReplayInput(manifest.recordings[0].replayLink.replace('length=long','length=short')));
  h.sandbox.__OPEN_PLAYER_KILL__();
});

test('new draws retry duration-incompatible phrases without filtering musical quality or changing a replay',async()=>{
  const h=harness();h.sandbox.document.dispatch('DOMContentLoaded');h.elements.get('tone').value='121';h.elements.get('songDuration').value='long';
  const slow=seedFor(2,0x08b0195e,0x8ee63dc6),next=manifest.recordings[1],nextSeed='2'+next.seed.slice(1);let draws=0;
  assert.throws(()=>h.api.createPerformance(slow,121,'long','39'),e=>e.code==='LONG_FORM_DURATION');
  h.sandbox.crypto.getRandomValues=words=>{words.set(draws++===0?[1,0x08b0195e,0x8ee63dc6]:[1,0x08b0195e,parseInt(next.previousSeed,16)]);return words;};
  await h.api.startNewPerformance();assert.equal(draws,2);assert.equal(h.api.state().snapshot.seed,nextSeed);
  await h.api.replayLastPerformance();assert.equal(draws,2);assert.equal(h.api.state().snapshot.seed,nextSeed);
  h.elements.get('replayInput').value=slow;await h.api.replayFromUI();
  assert.equal(draws,2,'An incompatible replay must not draw a replacement');
  assert.match(h.elements.get('replayStatus').textContent,/faster seed/);
  h.sandbox.__OPEN_PLAYER_KILL__();
});

test('ordinary phrase construction accepts unrelated melody seeds and respects register, key and mirrored form',()=>{
  const h=harness();let accepted=0, durationRejected=0;const constructions=new Set(),themes=new Set();
  let n=0x4d595df4;const next=()=>n=(Math.imul(n,1664525)+1013904223)>>>0;
  for(const root of [110,121,165,200])for(let i=0;i<12;i++) {
    const kind=(i%2)*2,melody=next(),performance=next(),seed=seedFor(kind,melody,performance);let s;
    try{s=h.api.createPerformance(seed,root,'long','39');}catch(e){assert.equal(e.code,'LONG_FORM_DURATION');durationRejected++;continue;}
    accepted++;constructions.add(s.study.sourceTheme.length);themes.add(JSON.stringify(s.study.sourceTheme));
    assert.equal(s.study.sourceReference.melodySeed,word(melody));assert.equal(s.audioSeed,performance);
    assert.equal(s.study.sourceTheme.length,kind===0?11:28);assert.ok(s.exportDuration>=600&&s.exportDuration<=1800);
    const pitches=s.study.sourceTheme;
    pitches.forEach((f,j)=>{
      assert.ok(f>=110-1e-8&&f<=415.30+1e-8);
      const pc=(Math.round(12*Math.log2(f/root))%12+12)%12;
      assert.ok((kind===0?[0,2,4,5,7,9]:[0,2,4,5,7,9,11]).includes(pc));
      if(j)assert.notEqual(Math.abs(Math.round(12*Math.log2(f/pitches[j-1])))%12,6);
    });
    assert.ok(s.study.mirror.pairCount>=2);
  }
  assert.equal(accepted+durationRejected,48);assert.ok(accepted>=30);assert.deepEqual([...constructions].sort(),[11,28]);assert.ok(themes.size>=20);
  h.sandbox.__OPEN_PLAYER_KILL__();
});
