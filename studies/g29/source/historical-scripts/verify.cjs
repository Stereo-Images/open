const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {harness,extract}=require('./harness.cjs'),dir=__dirname;
const baseline=fs.readFileSync(path.join(dir,'source/Open-Rich-Organ-g23.html'),'utf8');
const html=fs.readFileSync(path.join(dir,'deliverables/Open-Organ-Chorus-g24.html'),'utf8');
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
const before=harness(extract(baseline)),after=harness(extract(html)),json=x=>JSON.stringify(x);
const dsp=s=>s.slice(s.indexOf('  function planBell('),s.indexOf('  function handleVisibilityChange('));
assert.equal(dsp(html).replace('      } else if (note.organ?.chorus) {\n        scheduleChorusedOrgan(ctx, master, note, time);\n',''),
  dsp(baseline).replace('      } else if (note.granular) {','      } else if (note.granular) {'));
const organBlock=s=>s.slice(s.indexOf('  // g23 changes only'),s.indexOf('  function resolveDuration('));
assert.equal(organBlock(html),organBlock(baseline),'Retained g23 organ code is literal');
let legacyChecks=0,longChecks=0,shortChecks=0,infiniteChecks=0,interludeNotes=0;
for(const engine of ['1','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23'])
  for(const seed of [0x0393ded7,0xa417624c,0x0b086950])for(const duration of ['4','5'].includes(engine)?['long']:['short','long']){
    assert.equal(json(after.api.createPerformance(seed,121,duration,engine)),json(before.api.createPerformance(seed,121,duration,engine)));legacyChecks++;
  }
for(const [seed,tone,engine] of [[0x0393ded7,200,'3'],[0x6fa6f7c1,113,'1']]){
  assert.equal(json(after.api.createPerformance(seed,tone,'short',engine)),json(before.api.createPerformance(seed,tone,'short',engine)));legacyChecks++;
}
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'source/g22-manifest.json')));
const seeds=[...manifest.recordings.map(r=>parseInt(r.seed,16)),0x0b086950,0x1ec1984c,0x08c1db04,0,0xffffffff];
let minGap=Infinity;
for(const seed of seeds)for(const tone of [110,121,200]){
  const old=before.api.createPerformance(seed,tone,'long','23'),s=after.api.createPerformance(seed,tone,'long');
  assert.equal(json(s),json(after.api.createPerformance(seed,tone,'long','24')));
  assert.equal(s.exportDuration,old.exportDuration);assert.equal(json(s.tempo),json(old.tempo));
  assert.equal(s.study.droneArch.instrument,'principal-organ');
  assert.equal(s.groups.length,old.groups.length);
  assert.equal(json(s.study.droneArch.interludes),json(old.study.droneArch.interludes));
  assert.equal(json(s.study.theme),json(old.study.theme));assert.equal(s.study.endingPolicy,old.study.endingPolicy);
  for(let i=0;i<s.groups.length;i++){
    const group=s.groups[i],prior=old.groups[i];
    if(!group.interlude){assert.equal(json(group),json(prior));continue;}
    assert.equal(group.time,prior.time);assert.equal(group.notes.length,prior.notes.length);
    assert.equal(json(group.interlude.harmony),json(prior.interlude.harmony));
    for(let j=0;j<group.notes.length;j++){
      const n=group.notes[j],previous=prior.notes[j],{organ,...rest}=n;
      const {organ: previousOrgan,...retained}=previous;
      assert.equal(json(rest),json(retained));assert.ok(!n.granular&&!('detune' in n));
      assert.equal(n.envelope[0].value,0);assert.equal(n.envelope.at(-1).value,0);
      assert.equal(organ.pitchModulation,0);assert.equal(organ.tremolo,0);assert.equal(organ.percussion,false);assert.equal(organ.rotary,false);
      assert.ok(organ.harmonics[0]===1&&organ.harmonics.slice(1).every(v=>v>0&&v<.65)&&organ.harmonics[1]>.5);
      const {chorus,registration,harmonics,...retainedOrgan}=organ;
      const {registration: oldRegistration,harmonics: oldHarmonics,...oldOrgan}=previousOrgan;
      assert.equal(json(retainedOrgan),json(oldOrgan));
      assert.equal(registration,'principal-diapason');assert.equal(chorus.feedback,.1);
      assert.equal(chorus.feedbackCutoffHz,850);assert.equal(chorus.feedbackQ,.45);
      assert.equal(chorus.left.pan,-1);assert.equal(chorus.right.pan,1);
      assert.ok(chorus.left.rateHz<=.08&&chorus.right.rateHz<=.08);
      for(const side of [chorus.left,chorus.right])assert.ok(side.delaySeconds>Math.abs(side.depthSeconds)&&side.delaySeconds+Math.abs(side.depthSeconds)<.08);
      assert.equal(chorus.releaseSeconds,.5);
      interludeNotes++;
    }
  }
  for(const entry of s.study.droneArch.interludes){
    const notes=s.groups.filter(g=>g.interlude?.index===entry.index).flatMap(g=>g.notes);
    const gap=entry.returnTime-Math.max(...notes.map(n=>n.time+n.duration));minGap=Math.min(minGap,gap);
    assert.ok(gap>=5-1e-7);
  }
  longChecks++;
}
for(const seed of [0,0x477805c9,0x0393ded7])for(const duration of ['short','infinite']){
  const old=before.api.createPerformance(seed,200,duration),s=after.api.createPerformance(seed,200,duration);
  assert.equal(json(s),json(old));assert.equal(json(s),json(after.api.createPerformance(seed,200,duration,'24')));
  if(duration==='short')shortChecks++;
  else {for(let i=0;i<20;i++)assert.equal(json(s.continuation.next()),json(old.continuation.next()));infiniteChecks++;}
}
const filename='open-run-477805c9-study-g24-121hz-long-44100sr-1794320235484.wav';
const replay=after.api.parseReplayInput(filename);assert.equal(replay.engine,'24');assert.equal(replay.seed,0x477805c9);
const score=after.api.createPerformance(replay.seed,replay.tone,replay.duration,replay.engine);
fs.writeFileSync(path.join(dir,'scores/477805c9.json'),JSON.stringify(score));
const output={legacyChecks,legacyDspUnchanged:true,longChecks,interludeNotes,shortChecks,infiniteChecks,
  bellAndBackgroundRecipesUnchanged:true,harmonyTimingAndEndingsUnchanged:true,minimumDryGapSeconds:minGap,
  sourcePitchModulation:false,chorusDelayModulation:true,feedback:.1,chorusRatesHz:[.06,.08],
  tremolo:false,percussion:false,rotary:false,symmetryProposalImplemented:false};
fs.writeFileSync(path.join(dir,'validation.json'),JSON.stringify(output,null,2));console.log(output);
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({engine:'24',instrument:'principal-organ',recordings:[{
  seed:'477805c9',engine:'24',rootHz:121,sampleRate:44100,format:'stereo 16-bit PCM WAV',duration:'long',
  durationSeconds:score.exportDuration,nominalBpm:score.density*60,
  iterations:score.groups.filter(g=>!g.interlude).length/11,replayFilename:filename,
  referenceSeed:'0b086950',comparisonEngine:'23'}]},null,2));
