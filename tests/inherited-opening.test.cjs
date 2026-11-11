const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {harness}=require('./support/harness.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));

test('Related Long studies retain the entire original opening and complete a safe new form',()=>{
  const {api}=harness();
  for(const tone of [110,121,165,200]){
    const original=api.createPerformance(0x08b0195e,tone,'long','3');
    const prefix=original.groups.filter(g=>g.time<=120);
    for(const seed of [0x12345678,0x98765432,0xffffffff,0]){
      const score=api.createPerformance(seed,tone,'long','31');
      assert.deepEqual(plain(score.groups.filter(g=>g.time<=120)),plain(prefix));
      assert.equal(score.audioSeed,original.seed);
      assert.equal(score.density,original.density);
      assert.ok(score.exportDuration>=600&&score.exportDuration<=1800);
      const start=score.study.inheritedOpening.bodyStartSeconds;
      assert.ok(start>120);
      assert.ok(score.groups.slice(prefix.length).every(g=>g.time>=start));
      for(const g of score.groups.slice(prefix.length))for(const n of g.notes){
        const pc=((Math.round(12*Math.log2(n.freq/tone))%12)+12)%12;
        assert.ok([0,2,4,5,7,9].includes(pc));
        if(!g.interlude)assert.equal(n.organResolution,undefined);
      }
      const snapshot={seed,tone,duration:'long',engine:'31',sampleRate:44100};
      assert.deepEqual(plain(api.parseReplayInput(api.replayLink(snapshot))),snapshot);
      assert.deepEqual(plain(api.createPerformance(seed,tone,'long','31')),plain(score));
    }
  }
});

test('New opening family leaves every retained version and both default modes unchanged',()=>{
  const baseline=process.env.OPEN_RELEASE_BASELINE;
  if(!baseline)return;
  const old=harness(fs.readFileSync(path.resolve(baseline),'utf8')).api;
  const current=harness().api;
  for(const seed of [0x08b0195e,0x0393ded7,0x12345678])for(const mode of ['short','long']){
    for(const engine of [undefined,'3','21','29','30']){
      assert.deepEqual(plain(current.createPerformance(seed,121,mode,engine)),plain(old.createPerformance(seed,121,mode,engine)));
    }
  }
});

test('Gentler opening changes only the tritone landing pitch while preserving timing, detuning and the entire continuation',()=>{
  const {api}=harness();
  for(const seed of [0xd4030604,0x5e350109,0x9e98b56d,0xa06b094d,0x4eb4023d,0x6d12dcc9,0x60ccdd40,0x070f9ead]){
    const original=api.createPerformance(seed,121,'long','31');
    const current=api.createPerformance(seed,121,'long','32');
    const before=plain(original.groups),after=plain(current.groups);
    const bells=after.flatMap(g=>g.notes).filter(n=>n.kind==='bell');
    const change=current.study.inheritedOpening.adjustment;
    assert.equal(change.strike,23);
    assert.ok(change.time>95&&change.time<96);
    assert.equal(Math.round(12*Math.log2(bells[22].freq/bells[21].freq)),5);
    assert.ok(Math.abs(bells[22].freq-bells[23].freq)<1e-9);
    assert.ok(bells.slice(1).every((n,i)=>Math.abs(Math.round(12*Math.log2(n.freq/bells[i].freq)))!==6));
    const changed=after.flatMap(g=>g.notes).find(n=>n.kind==='bell'&&n.time===change.time);
    const old=before.flatMap(g=>g.notes).find(n=>n.kind==='bell'&&n.time===change.time);
    const shift=changed.freq-old.freq;
    changed.voices.forEach((v,i)=>assert.ok(Math.abs((v.frequency-old.voices[i].frequency)-shift)<1e-9));
    changed.freq=old.freq;changed.voices.forEach((v,i)=>v.frequency=old.voices[i].frequency);
    assert.deepEqual(after,before);
    assert.equal(current.exportDuration,original.exportDuration);
    const record=api.parseReplayInput(api.replayLink({seed,tone:121,duration:'long',engine:'32',sampleRate:44100}));
    assert.equal(record.engine,'32');
  }
});
