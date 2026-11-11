const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const dir=__dirname,html=path.join(dir,'deliverables/Open-Principal-Plenum-g28.html');
const results=[];
function render(args){
 const output=args.filename+'.json';
 const code="require('./render.cjs').render(JSON.parse(process.argv[1])).then(r=>require('fs').writeFileSync(process.argv[2],JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1})";
 const run=spawnSync(process.execPath,['-e',code,JSON.stringify(args),output],{cwd:dir,encoding:'utf8',maxBuffer:1e6});
 if(run.status!==0)throw Error(run.stderr);
 const result=JSON.parse(fs.readFileSync(output));results.push(result);return result;
}
const g3=render({html,seed:'0393ded7',engine:'3',duration:'short',tone:200,filename:path.join(dir,'checks/g28-preserved-g3.wav')});
assert.equal(g3.pcmSha256,'a259348dc27fb39ca87c047d36e23d848bd35e18fce689971f799f91bd68dafa');
const g27=render({html,seed:'40dc1965',engine:'27',tone:121,mode:'probe',filename:path.join(dir,'checks/g28-preserved-g27.wav')});
assert.equal(g27.pcmSha256,'cd429cc2b150cda61474e9bc9de00ec29e09a7e344afac869478f877d2f9f13b');
const repeats=[];
for(let i=0;i<2;i++)repeats.push(render({html,seed:'40dc1965',engine:'28',tone:121,mode:'probe',filename:path.join(dir,`checks/g28-repeat-${i}.wav`)}));
assert.equal(repeats[0].pcmSha256,repeats[1].pcmSha256);
assert.ok(repeats[0].tailPeakFiveSecondsAfterDirectEnd>1e-6);
const background=[];
for(const engine of ['27','28'])background.push(render({html,seed:'40dc1965',engine,tone:121,mode:'background',filename:path.join(dir,`checks/g28-background-${engine}.wav`)}));
assert.equal(background[0].pcmSha256,background[1].pcmSha256);
const source=fs.readFileSync(html,'utf8'),dry=path.join(dir,'checks/g28-direct-only.html');
assert.equal(source.split('dryGain: .8, wetGain: 1.1').length,2);
fs.writeFileSync(dry,source.replace('dryGain: .8, wetGain: 1.1','dryGain: .8, wetGain: 0'));
for(const index of [1,4,6]){
 const result=render({html:dry,seed:'40dc1965',engine:'28',tone:121,mode:'probe',interludeIndex:index,filename:path.join(dir,`checks/g28-direct-${index}.wav`)});
 assert.equal(result.tailPeakAfterReturn,0);
}
fs.writeFileSync('g28-audio-validation.json',JSON.stringify({g3SampleIdentical:true,g27SampleIdentical:true,
 legacyBackgroundSampleIdentical:true,g28Deterministic:true,directOrganEndsBeforeBell:true,
 longReverbTailPresent:true,results},null,2));
console.log('g3/g27 PCM preserved; background exact; g28 deterministic; 1/2/3-statement dry handoffs clear; wet tail present');
