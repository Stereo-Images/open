const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {harness}=require('../studies/g29/harness.cjs');
const {assertSavedScoreEqual}=require('../studies/g29/score-check.cjs');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'player.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));

test('published engine matches the approved player and unchanged WAV encoder',()=>{
  const check=spawnSync('python3',['tools/build-player.py','--check'],{cwd:root,encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);
});

test('published Long player reproduces all sixteen saved g29 scores',()=>{
  const h=harness(source);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'studies/g29/manifest.json')));
  for(const row of manifest.recordings){
    const replay=h.api.parseReplayInput(row.replayFilename);
    assert.equal(replay.engine,'29');
    const actual=h.api.createPerformance(replay.seed,replay.tone,replay.duration,replay.engine);
    const expected=JSON.parse(fs.readFileSync(path.join(root,'studies/g29/scores',row.seed+'.json')));
    assertSavedScoreEqual(plain(actual),expected,row.seed);
  }
});

test('saved-score checks tolerate only machine roundoff and detect musical changes',()=>{
  assertSavedScoreEqual({pitch:[242]}, {pitch:[241.99999999999997]});
  for(const changed of [{pitch:[242.000001]},{pitch:[243]},{pitch:[242,242]},{pitch:[242],extra:true},{pitch:[NaN]}]){
    assert.throws(()=>assertSavedScoreEqual(changed,{pitch:[242]}));
  }
});

test('new duration defaults preserve g21 Short and select g29 Long',()=>{
  const h=harness(source);
  for(const [duration,engine] of [['short','21'],['long','29']]){
    const score=h.api.createPerformance(0x0393ded7,121,duration);
    assert.deepEqual(plain(score),plain(h.api.createPerformance(0x0393ded7,121,duration,engine)));
    assert.equal(score.study.form,duration==='long'?'nested-mirror':'fixed-collection-walk');
    assert.ok(score.density*60>=3&&score.density*60<=15);
  }
});

test('Infinite mode cannot start from a saved filename, replay link or planner input',()=>{
  const h=harness(source);
  const filename='open-run-0393ded7-abc-g3-200hz-infinite-44100sr-1.wav';
  const link='https://stereo-images.github.io/open/player.html?seed=0393ded7&tone=200&length=infinite&engine=3&rate=44100';
  for(const input of [filename,link]) assert.throws(()=>h.api.parseReplayInput(input),/short or long/);
  assert.throws(()=>h.api.createPerformance(0x0393ded7,200,'infinite','3'),/Invalid duration/);
  for(const file of ['player.html','studies/g29/deliverables/Open-Filtered-Spectral-Organ-g29.html','studies/g29/deliverables/Open-g29-Sixteen-New-Studies.html']){
    assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/<option[^>]*value="infinite"/);
  }
});

test('the original Short Study and converted audio filenames retain their engine',()=>{
  const h=harness(source);
  const base='open-run-0393ded7-mviswtcb-g3-200hz-short-44100sr-1792628825406';
  for(const suffix of ['', '.wav','.mp3','.flac']){
    const replay=h.api.parseReplayInput(base+suffix);
    assert.equal(replay.engine,'3');assert.equal(replay.seed,0x0393ded7);
    assert.equal(replay.tone,200);assert.equal(replay.duration,'short');assert.equal(replay.sampleRate,44100);
  }
});
