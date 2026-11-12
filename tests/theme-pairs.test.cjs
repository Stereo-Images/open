const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {harness}=require('./support/harness.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));
const bells=s=>s.groups.flatMap(g=>g.notes).filter(n=>n.kind==='bell');
const recipe=n=>{const {time,...rest}=n;return plain(rest);};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('every complete theme is followed by its full retrograde before an interlude',()=>{
  const {api}=harness();
  for(const engine of ['35','36','37']) for(const tone of [110,121,165,200]) {
    for(const seed of [0x1a1155f9,0xf300fed2,0x4850166b,0x014bf780]) {
      const score=api.createPerformance(seed,tone,'long',engine);
      const m=score.study.mirror,n=m.forwardStrikeCount;
      assert.ok(m.pairCount>=2);
      assert.equal(m.strikesPerPair,2*n);
      assert.equal(score.study.form,'theme-mirror-pairs');
      assert.equal(m.globalPaletteMirror,false);
      assert.deepEqual(plain(m.paletteOrder),Array.from({length:m.pairCount},(_,i)=>i));
      const palettes=[];
      for(const pass of m.passes) {
        const gs=score.groups.filter(g=>g.study?.cycle===pass.cycle);
        const ns=gs.flatMap(g=>g.notes).filter(n=>n.kind==='bell');
        assert.equal(ns.length,2*n);
        assert.deepEqual(plain(ns.slice(0,n).map(n=>n.freq)),plain(score.study.sourceTheme));
        assert.deepEqual(ns.slice(n).map(recipe),ns.slice(0,n).reverse().map(recipe));
        assert.ok(gs.slice(0,n).every(g=>g.study.direction==='forward'));
        assert.ok(gs.slice(n).every(g=>g.study.direction==='reverse'));
        const gaps=ns.slice(1).map((x,i)=>x.time-ns[i].time);
        gaps.forEach((x,i)=>near(x,gaps.at(-1-i)));
        assert.ok(gaps.every(g=>g>=4-1e-8&&g*score.density>=.925-1e-8&&g*score.density<=1.08));
        near(ns[n].time,pass.mirrorStart);
        assert.ok(!score.groups.some(g=>g.interlude&&g.time>ns[0].time&&g.time<ns.at(-1).time));
        palettes.push(JSON.stringify(ns.slice(0,n).map(x=>x.voices)));
        for(const note of ns)assert.deepEqual(recipe(api.refineBellFM(note)),recipe(note));
      }
      assert.equal(new Set(palettes).size,m.pairCount,'Each new forward statement establishes a new FM palette');
      assert.equal(score.study.droneArch.interludes.length,m.pairCount-1);
      assert.ok(score.exportDuration>=600&&score.exportDuration<=1800);
      assert.deepEqual(plain(score),plain(api.createPerformance(seed,tone,'long',engine)));
      const legacy=api.createPerformance(seed,tone,'long','33');
      near(score.tempo.nominalBpm,legacy.tempo.nominalBpm);
    }
  }
});

test('reference pairs retain all source pitches and use the original unmirrored sparse theme',()=>{
  const source=fs.readFileSync(require.resolve('../player.js'),'utf8');
  const h=harness(source.replace('function createPerformance(seed,','window.struck=createStruckStudyGenerator;\n  function createPerformance(seed,'));
  for(const tone of [110,121,165,200]) {
    const reference=bells(h.api.createPerformance(0x08b0195e,tone,'long','33','32')).slice(0,28).map(n=>n.freq);
    const score=h.api.createPerformance(0x1a1155f9,tone,'long','36');
    assert.deepEqual(plain(score.study.sourceTheme),plain(reference));
    assert.equal(score.study.sourceReference.bellCount,28);
    assert.equal(score.study.sourceReference.sourceThroughSeconds,120);
    if(tone===121)assert.equal(score.study.sourceReference.adjustment.strike,23);
    assert.equal(score.study.sourceReference.inheritance,'pitches-only');
    const parent=h.sandbox.struck(0x4850166b,tone,Infinity,true,{wideTempo:true,maxBpm:15});
    const child=h.api.createPerformance(0x1a1155f9,tone,'long','37');
    assert.deepEqual(plain(child.study.sourceTheme),plain(parent.study.theme));
    if(tone===121)assert.notDeepEqual(plain(child.study.sourceTheme),plain(child.study.sourceTheme).reverse());
  }
});

test('new form replay records survive filenames, links, live plans and export',async()=>{
  for(const engine of ['35','36','37']) {
    const h=harness();h.sandbox.document.dispatch('DOMContentLoaded');
    const settings={seed:0x1a1155f9,tone:121,duration:'long',engine,sampleRate:44100};
    const filename=`open-run-1a1155f9-study-g${engine}-121hz-long-44100sr-1794450000000.wav`;
    assert.deepEqual(plain(h.api.parseReplayInput(filename)),settings);
    h.elements.get('replayInput').value=h.api.replayLink(settings);await h.api.replayFromUI();
    const expected=plain(h.api.state().snapshot.groups);
    const pending=h.api.renderWavExport();
    h.contexts[1].resolve({length:1,numberOfChannels:2,sampleRate:44100,getChannelData:()=>new Float32Array(1),copyFromChannel:a=>a.fill(0)});
    await pending;
    assert.deepEqual(plain(h.api.parseReplayInput(h.downloads[0])),settings);
    await h.api.replayLastPerformance();assert.deepEqual(plain(h.api.state().snapshot.groups),expected);
    assert.throws(()=>h.api.createPerformance(1,121,'short',engine),/requires Long/);
    assert.throws(()=>h.api.parseReplayInput(h.api.replayLink({...settings,duration:'short'})),/requires Long/);
    h.sandbox.__OPEN_PLAYER_KILL__();
  }
});
