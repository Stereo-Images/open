const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./support/harness.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));
const seeds=[0x3460e991,0xf300fed2,0x1a1155f9,0xaf8338ca,0x0cb6f3c0,0xc785636f,0x64984799,0x141bf02b];

test('related variations retain the corrected 08b0195e opening with selective FM',()=>{
  const {api}=harness();
  for(const tone of [110,121,165,200]){
    const parent=api.createPerformance(0x08b0195e,tone,'long','33','32');
    const opening=parent.groups.filter(g=>g.time<=120);
    const next=parent.study.inheritedOpening.bodyStartSeconds;
    for(const seed of seeds){
      const score=api.createPerformance(seed,tone,'long','33','32');
      assert.deepEqual(plain(score.groups.filter(g=>g.time<=120)),plain(opening));
      assert.equal(score.study.inheritedOpening.bellCount,28);
      assert.equal(score.study.inheritedOpening.seed,'08b0195e');
      assert.equal(score.study.inheritedOpening.bodyStartSeconds,next);
      assert.equal(score.audioSeed,parent.seed);
      assert.equal(score.density,parent.density);
      assert.ok(score.exportDuration>=600&&score.exportDuration<=1800);
      const bells=score.groups.flatMap(g=>g.notes).filter(n=>n.kind==='bell');
      // The requested batch is at 121 Hz. Other roots preserve their original
      // opening even where the old register-folding policy changes a leap.
      if(tone===121)assert.ok(bells.slice(1).every((n,i)=>Math.abs(Math.round(12*Math.log2(n.freq/bells[i].freq)))!==6));
      assert.deepEqual(plain(api.createPerformance(seed,tone,'long','33','32')),plain(score));
      const record={seed,tone,duration:'long',engine:'33',baseEngine:'32',sampleRate:44100};
      assert.deepEqual(plain(api.parseReplayInput(api.replayLink(record))),record);
      const filename=`open-run-${seed.toString(16).padStart(8,'0')}-study-g33-b32-${tone}hz-long-44100sr-1794432436271.wav`;
      assert.deepEqual(plain(api.parseReplayInput(filename)),record);
    }
  }
});

test('the reference variation retains its recipe through playback, export and replay',async()=>{
  const h=harness();h.sandbox.document.dispatch('DOMContentLoaded');
  const settings={seed:0x3460e991,tone:121,duration:'long',engine:'33',baseEngine:'32',sampleRate:44100};
  h.elements.get('replayInput').value=h.api.replayLink(settings);
  await h.api.replayFromUI();
  const expected=plain(h.api.state().snapshot.groups);
  const pending=h.api.renderWavExport();
  h.contexts[1].resolve({length:1,numberOfChannels:2,sampleRate:44100,
    getChannelData:()=>new Float32Array(1),copyFromChannel:a=>a.fill(0)});
  await pending;
  assert.deepEqual(plain(h.api.parseReplayInput(h.downloads[0])),settings);
  await h.api.replayLastPerformance();
  assert.deepEqual(plain(h.api.state().snapshot.groups),expected);
  h.sandbox.__OPEN_PLAYER_KILL__();
});

test('the reference family is explicit and cannot silently replace ordinary Short or Long',()=>{
  const {api}=harness();
  assert.throws(()=>api.createPerformance(1,121,'short','33','32'),/requires Long/);
  assert.throws(()=>api.parseReplayInput('https://stereo-images.github.io/open/player.html?seed=3460e991&tone=121&length=short&engine=33&base=32&rate=44100'),/requires Long/);
  assert.equal(api.createPerformance(0x3460e991,121,'long').study.inheritedOpening,undefined);
});
