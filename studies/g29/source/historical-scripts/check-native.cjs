const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {harness,extract}=require('./harness.cjs');
const dir=__dirname,old=path.join(dir,'source/Open-Mirrored-Study-g26.html'),html=path.join(dir,'deliverables/Open-Mirrored-Study-g27.html');
const results=[],comparisons=[];
function render(args){
 const output=args.filename+'.json';
 const code="require('./render.cjs').render(JSON.parse(process.argv[1])).then(r=>require('node:fs').writeFileSync(process.argv[2],JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});";
 for(let attempt=0;attempt<3;attempt++){
  const r=spawnSync(process.execPath,['-e',code,JSON.stringify(args),output],{cwd:dir,encoding:'utf8',maxBuffer:1e7});
  if(r.status===0){const result=JSON.parse(fs.readFileSync(output));results.push(result);console.log(JSON.stringify({seed:args.seed,engine:args.engine,mode:args.mode,peakDb:result.peakDb,tail:result.tailPeakAfterReturn}));return result;}
  if(attempt===2||!r.stderr.includes('OfflineAudioContext.suspend'))throw Error(r.stderr);
 }
}
for(const [seed,engine,tone,mode] of [['0393ded7','3',200,'full'],['6fa6f7c1','1',113,'full'],['477805c9','24',121,'probe'],['477805c9','25',121,'probe'],['477805c9','26',121,'probe']]){
 const pair=[];
 for(const [tag,source] of [['old',old],['new',html]])pair.push(render({html:source,seed,engine,tone,duration:mode==='full'?'short':'long',mode,filename:path.join(dir,'checks',`${tag}-${seed}-g${engine}.wav`)}));
 assert.equal(pair[0].pcmSha256,pair[1].pcmSha256);comparisons.push({seed,engine,identical:true,hash:pair[1].pcmSha256});
}
const h=harness(extract(fs.readFileSync(html,'utf8'))),score=h.api.createPerformance(0x477805c9,121,'long','27');
const probes=[];
for(const count of [1,2,3]){
 const entry=score.study.droneArch.interludes.find(e=>e.swells===count);
 const result=render({html,seed:'477805c9',engine:'27',tone:121,mode:'probe',interludeIndex:entry.index,filename:path.join(dir,'checks',`g27-${count}-chords.wav`)});
 assert.ok(result.tailPeakAfterReturn>1e-5);assert.ok(result.tailPeakFiveSecondsAfterDirectEnd>1e-6);probes.push(result);
}
const background=[];for(const [tag,source,engine] of [['old',old,'26'],['new',html,'27']])background.push(render({html:source,seed:'477805c9',engine,tone:121,mode:'background',filename:path.join(dir,'checks',`${tag}-background.wav`)}));
assert.equal(background[0].pcmSha256,background[1].pcmSha256);
assert.equal(comparisons[0].hash,'a259348dc27fb39ca87c047d36e23d848bd35e18fce689971f799f91bd68dafa');
const repeat=render({html,seed:'477805c9',engine:'27',tone:121,mode:'probe',interludeIndex:1,filename:path.join(dir,'checks/g27-repeat.wav')});
assert.equal(repeat.pcmSha256,probes[0].pcmSha256);
fs.writeFileSync('audio-validation.json',JSON.stringify({comparisons,probes,legacyBackgroundAudioExact:true,reproducibleG27:true,results},null,2));
console.log('Legacy audio exact; g27 reverb persists after returning strike; new render deterministic');
