const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {harness,extract}=require('./harness.cjs');
const dir=__dirname,html=fs.readFileSync('deliverables/Open-g29-Sixteen-New-Studies.html','utf8');
const h=harness(extract(html)),manifest=JSON.parse(fs.readFileSync('manifest.json'));
const scores=[];
for(const r of manifest.recordings){
 const s=JSON.parse(fs.readFileSync(`scores/${r.seed}.json`)),m=s.study.mirror;
 const entries=s.study.droneArch.interludes.map(e=>{
  const organs=s.groups.filter(g=>g.interlude?.index===e.index).flatMap(g=>g.notes);
  const directEnd=Math.max(...organs.map(n=>n.time+n.duration));
  const bells=s.groups.flatMap(g=>g.notes).filter(n=>n.kind==='bell'&&n.time<e.start);
  const afterBell=e.start-m.passes[e.index-1].end,beforeBell=e.returnTime-directEnd;
  assert.ok(Math.abs(beforeBell-2)<1e-8);
  assert.ok(e.start-bells.at(-1).time>=6-1e-8&&e.start-bells.at(-1).time<=14+1e-8);
  return {index:e.index,afterAllocatedBellTail:afterBell,overlapsFadingBell:true,beforeNextBell:beforeBell,lastStrikeToOrgan:e.start-bells.at(-1).time};
 });scores.push({seed:r.seed,entries});
}
fs.mkdirSync('checks',{recursive:true});
const dryHtml=path.join(dir,'checks/g29-direct-only.html');
assert.equal(html.split('dryGain: .8, wetGain: 1.1').length,2);
fs.writeFileSync(dryHtml,html.replace('dryGain: .8, wetGain: 1.1','dryGain: .8, wetGain: 0'));
const s=h.api.createPerformance(0xbf187689,121,'long','29'),probes=[];
for(const count of [1,2,3]){
 const entry=s.study.droneArch.interludes.find(e=>e.swells===count);
 const args={html:dryHtml,seed:'bf187689',engine:'29',tone:121,mode:'probe',interludeIndex:entry.index,filename:path.join(dir,`checks/g29-direct-${count}.wav`)};
 const output=args.filename+'.json';
 const code="require('./render.cjs').render(JSON.parse(process.argv[1])).then(r=>require('fs').writeFileSync(process.argv[2],JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1});";
 for(let attempt=0;attempt<3;attempt++){
  const run=spawnSync(process.execPath,['-e',code,JSON.stringify(args),output],{cwd:dir,encoding:'utf8',maxBuffer:1e6});
  if(run.status===0)break;
  if(attempt===2||!run.stderr.includes('OfflineAudioContext.suspend'))throw Error(run.stderr);
 }
 const p=JSON.parse(fs.readFileSync(output));assert.equal(p.tailPeakAfterReturn,0);assert.equal(p.tailPeakFiveSecondsAfterDirectEnd,0);probes.push(p);
 console.log(JSON.stringify({statements:count,directAfterNextBell:p.tailPeakAfterReturn}));
}
fs.writeFileSync('batch-handoff-validation.json',JSON.stringify({scoreChecks:scores,directVoiceProbes:probes,allDirectVoicesClearBeforeBell:true},null,2));
