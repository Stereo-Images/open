const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const dir=__dirname,results=[],comparisons=[];
function render(args){
  const resultPath=args.filename+'.json';
  const code="require('./render.cjs').render(JSON.parse(process.argv[1])).then(r=>require('node:fs').writeFileSync(process.argv[2],JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});";
  const run=spawnSync(process.execPath,['-e',code,JSON.stringify(args),resultPath],{cwd:dir,stdio:'inherit'});
  assert.equal(run.status,0);const result=JSON.parse(fs.readFileSync(resultPath));results.push(result);return result;
}
const old=path.join(dir,'source/Open-Rich-Organ-g23.html');
const html=path.join(dir,'deliverables/Open-Organ-Chorus-g24.html');
for(const [seed,engine,tone,mode] of [['0393ded7','3',200,'full'],['6fa6f7c1','1',113,'full'],['477805c9','23',121,'probe']]){
  const pair=[];
  for(const [tag,source] of [['old',old],['new',html]])pair.push(render({html:source,seed,engine,tone,
    duration:mode==='full'?'short':'long',mode,filename:path.join(dir,'checks',`${tag}-${seed}-g${engine}.wav`)}));
  assert.equal(pair[0].pcmSha256,pair[1].pcmSha256);comparisons.push({seed,engine,identical:true});
}
const levels=[];
for(const interludeIndex of [1,2,3]){
  const base=render({html:old,seed:'477805c9',engine:'23',mode:'probe',interludeIndex,
    filename:path.join(dir,'checks',`baseline-interlude-${interludeIndex}.wav`)});
  const organ=render({html,seed:'477805c9',engine:'24',mode:'probe',interludeIndex,
    filename:path.join(dir,'checks',`organ-interlude-${interludeIndex}.wav`)});
  assert.ok(organ.tailPeakAfterReturn<1e-8);
  const db=20*Math.log10(organ.rms/base.rms);
  assert.ok(db<2&&db>-3,'Organ preserves the quiet interlude balance');
  levels.push({interludeIndex,oldRms:base.rms,organRms:organ.rms,changeDb:db,tailPeakAfterReturn:organ.tailPeakAfterReturn});
}
const repeat=render({html,seed:'477805c9',engine:'24',mode:'probe',interludeIndex:1,filename:path.join(dir,'checks/organ-repeat.wav')});
assert.equal(repeat.pcmSha256,results.find(r=>r.filename.endsWith('organ-interlude-1.wav')).pcmSha256);
const audition=render({html,seed:'477805c9',engine:'24',mode:'audition',interludeIndex:1,
  filename:path.join(dir,'deliverables/Open-g24-Principal-Organ-Audition.wav')});
fs.writeFileSync(path.join(dir,'audio-validation.json'),JSON.stringify({comparisons,nativeComparisonsIsolated:true,
  levels,newOrganReproducible:true,clippedSamples:0,nonfiniteSamples:0,audition,results},null,2));
