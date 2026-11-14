const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./support/harness.cjs');
const manifest=require('../studies/nov12-ordinary-seeds/manifest.json');
const plain=x=>JSON.parse(JSON.stringify(x));
const recipe=n=>{const {time,...rest}=n;return plain(rest);};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('28-note pairs place organ between the theme and its exact musical retrograde',()=>{
  const h=harness();
  for(const tone of [110,121,165,200])for(const row of manifest.recordings.slice(0,8)) {
    const score=h.api.createPerformance('2'+row.seed.slice(1),tone,'long','39');
    const original=h.api.createPerformance(row.seed,tone,'long','38');
    const m=score.study.mirror,entries=score.study.droneArch.interludes,n=28;
    assert.equal(score.study.form,'theme-organ-mirror');
    assert.deepEqual(plain(score.study.sourceTheme),plain(original.study.sourceTheme));
    assert.equal(score.density,original.density);
    assert.equal(entries.length,2*m.pairCount-1);
    assert.deepEqual(plain(score.study.droneArch.pattern),plain(score.study.droneArch.pattern).reverse());
    assert.ok(m.pairCount>=2&&score.exportDuration>=600&&score.exportDuration<=1800);
    const palettes=[];
    for(const pass of m.passes) {
      const bells=score.groups.filter(g=>g.study?.cycle===pass.cycle).flatMap(g=>g.notes);
      const forward=bells.slice(0,n),reverse=bells.slice(n);
      assert.equal(bells.length,56);
      assert.deepEqual(plain(forward.map(n=>n.freq)),plain(score.study.sourceTheme));
      assert.deepEqual(reverse.map(recipe),forward.slice().reverse().map(recipe));
      for(let i=1;i<n;i++) {
        const gap=forward[i].time-forward[i-1].time;
        near(gap,reverse[n-i].time-reverse[n-i-1].time);
        assert.ok(gap>=4-1e-8&&gap*score.density>=.925-1e-8&&gap*score.density<=1.08);
      }
      const entry=entries.find(e=>e.index===pass.turningInterlude);
      near(entry.returnTime,reverse[0].time);
      near(pass.forwardEnd,forward.at(-1).time);
      near(pass.mirrorStart,reverse[0].time);
      assert.ok(entry.start>forward.at(-1).time&&entry.end<reverse[0].time);
      assert.equal(entries.filter(e=>e.start>pass.start&&e.start<pass.end).length,1);
      palettes.push(JSON.stringify(forward.map(n=>n.voices)));
      // New placement must not redraw or slow down the existing bell statement.
      const previous=original.groups.filter(g=>g.study?.cycle===pass.cycle).flatMap(g=>g.notes);
      if(previous.length) {
        assert.deepEqual(bells.map(recipe),previous.map(recipe));
        forward.forEach((note,i)=>near(note.time-forward[0].time,previous[i].time-previous[0].time));
      }
      if(pass.cycle<m.pairCount-1) {
        const next=m.passes[pass.cycle+1];
        assert.equal(entries.filter(e=>e.start>=pass.end&&e.end<next.start).length,1);
      }
    }
    assert.equal(new Set(palettes).size,m.pairCount,'New forward statements establish fresh FM palettes');
    for(const entry of entries) {
      const organs=score.groups.filter(g=>g.interlude?.index===entry.index).flatMap(g=>g.notes);
      const dryEnd=Math.max(...organs.map(n=>n.time+n.duration));
      assert.ok(dryEnd<=entry.returnTime-2+1e-8,'Direct organ and chorus finish before returning bells');
      assert.ok(organs.every(n=>n.organ.registration==='filtered-spectral-plenum-g29'));
      assert.ok(!score.groups.some(g=>g.study&&g.time>=entry.start&&g.time<entry.returnTime-1e-8));
      for(const bg of score.groups.filter(g=>g.background).flatMap(g=>g.notes))
        assert.ok(bg.time+bg.duration<=entry.start||bg.time>=entry.returnTime,'Quiet FM accompaniment stays out of organ passages');
    }
    const last=score.groups.at(-1);
    assert.equal(last.ending,true);
    assert.equal(last.study.direction,'reverse');
    assert.ok(entries.at(-1).end<last.time);
    assert.ok(score.exportDuration>=Math.max(...score.groups.flatMap(g=>g.notes).map(n=>n.time+n.duration)));
    assert.deepEqual(plain(score),plain(h.api.createPerformance(score.seed,tone,'long','39')));
  }
  h.sandbox.__OPEN_PLAYER_KILL__();
});

test('new form seeds retain all bits through bare seed, filename, link, export and replay',async()=>{
  for(const seed of ['208b0195e037586a8','04850166b697bb2c6','2fffffffffffffffe']) {
    const h=harness();h.sandbox.document.dispatch('DOMContentLoaded');
    h.elements.get('tone').value='121';h.elements.get('songDuration').value='long';
    const settings={seed,tone:121,duration:'long',engine:'39',sampleRate:44100};
    const filename=`open-run-${seed}-study-g39-121hz-long-44100sr-1794600000000.wav`;
    for(const input of [filename,h.api.replayLink(settings)])
      assert.deepEqual(plain(h.api.parseReplayInput(input)),settings);
    const bare=h.api.parseReplayInput(seed.toUpperCase());
    assert.equal(bare.seed,seed);
    assert.deepEqual(plain(h.api.createPerformance(bare.seed,121,'long',bare.engine)),plain(h.api.createPerformance(seed,121,'long','39')));
    h.elements.get('replayInput').value=filename;await h.api.replayFromUI();
    assert.equal(h.api.state().snapshot.engine,'39');
    const expected=plain(h.api.state().snapshot.groups);
    const pending=h.api.renderWavExport();
    h.contexts[1].resolve({length:1,numberOfChannels:2,sampleRate:44100,getChannelData:()=>new Float32Array(1),copyFromChannel:a=>a.fill(0)});
    await pending;assert.deepEqual(plain(h.api.parseReplayInput(h.downloads[0])),settings);
    await h.api.replayLastPerformance();assert.deepEqual(plain(h.api.state().snapshot.groups),expected);
    if(seed[0]==='2') {
      assert.throws(()=>h.api.parseReplayInput(filename.replace('-g39-','-g38-')),/replay settings/);
      assert.throws(()=>h.api.parseReplayInput(h.api.replayLink({...settings,engine:'33',baseEngine:'38'})),/replay settings/);
      assert.throws(()=>h.api.createPerformance(seed,121,'long','38'),/replay settings/);
    }
    assert.throws(()=>h.api.parseReplayInput(h.api.replayLink({...settings,duration:'short'})),/requires Long/);
    h.sandbox.__OPEN_PLAYER_KILL__();
  }
});
