const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {harness,extract}=require('./harness.cjs');
const before='source/rendered-g26.html',after='deliverables/Open-Mirrored-Study-g26.html';
const beforeSource=extract(fs.readFileSync(before,'utf8')),afterSource=extract(fs.readFileSync(after,'utf8'));
assert.equal(afterSource.replace('    roomSeconds: 12, tailAllowanceSeconds: 12.325, minimumDryGapSeconds: 13,\n',''),beforeSource);
const old=harness(beforeSource),now=harness(afterSource),manifest=JSON.parse(fs.readFileSync('manifest.json'));
let checked=0;
for(const r of manifest.recordings){
 const a=JSON.parse(JSON.stringify(old.api.createPerformance(parseInt(r.seed,16),121,'long','26')));
 const b=JSON.parse(JSON.stringify(now.api.createPerformance(parseInt(r.seed,16),121,'long','26')));
 const corrected=JSON.stringify(b);
 for(const key of ['roomSeconds','tailAllowanceSeconds','minimumDryGapSeconds'])a.study.droneArch.effects[key]=b.study.droneArch.effects[key];
 assert.deepEqual(a,b);checked++;
 fs.writeFileSync('scores/'+r.seed+'.json',corrected);
}
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const result={scoreComparisons:checked,allAudioEventsIdentical:true,onlyChange:'Correct three descriptive effect fields; synthesis uses unchanged impulseSeconds and sectionGapSeconds',renderedPlayerSha256:hash(before),finalPlayerSha256:hash(after)};
fs.writeFileSync('metadata-validation.json',JSON.stringify(result,null,2));
const player=JSON.parse(fs.readFileSync('player-validation.json'));Object.assign(player,{htmlSha256:hash(after),renderedHtmlSha256:hash(before),metadataOnlyCorrection:true});fs.writeFileSync('player-validation.json',JSON.stringify(player,null,2));
console.log(result);
require('./render.cjs').render({html:after,seed:'477805c9',engine:'26',tone:121,mode:'probe',interludeIndex:1,filename:__dirname+'/checks/final-g26-probe.wav'}).then(result=>{
 const prior=JSON.parse(fs.readFileSync('audio-validation.json')).probes[0];assert.equal(result.pcmSha256,prior.pcmSha256);
 const metadata=JSON.parse(fs.readFileSync('metadata-validation.json'));metadata.nativeProbeSampleIdentical=true;fs.writeFileSync('metadata-validation.json',JSON.stringify(metadata,null,2));
 console.log('Descriptive metadata corrected; native audio unchanged');
}).catch(e=>{console.error(e);process.exitCode=1;});
