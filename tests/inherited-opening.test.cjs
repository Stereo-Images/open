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
