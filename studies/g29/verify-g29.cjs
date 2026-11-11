const fs=require('node:fs'),assert=require('node:assert/strict'),{harness,extract}=require('./harness.cjs');
const load=p=>harness(extract(fs.readFileSync(p,'utf8')));
const old=load('source/Open-Principal-Plenum-g28.html'),now=load('deliverables/Open-Filtered-Spectral-Organ-g29.html');
const plain=x=>JSON.parse(JSON.stringify(x)),equal=(a,b)=>assert.deepEqual(plain(a),plain(b));
const recipe=n=>{const {time,...r}=n;return r;};
let legacy=0,statements=0,scores=0;
for(const seed of [0x0393ded7,0x0b086950,0x6fa6f7c1,0x40dc1965]){
 for(const engine of ['1',...Array.from({length:26},(_,i)=>String(i+3))])for(const duration of ['short','long']){
  if(['4','5'].includes(engine)&&duration!=='long')continue;
  equal(old.api.createPerformance(seed,121,duration,engine),now.api.createPerformance(seed,121,duration,engine));legacy++;
 }
 for(const duration of ['short']){
  const a=old.api.createPerformance(seed,121,duration),b=now.api.createPerformance(seed,121,duration);
  equal(a,b);equal(b,now.api.createPerformance(seed,121,duration,'29'));
 }
}
const seeds=[0,1,0xffffffff,...JSON.parse(fs.readFileSync('source/manifest-g27.json')).recordings.map(r=>parseInt(r.seed,16))];
for(const seed of seeds)for(const tone of [110,121,200]){
 const a=old.api.createPerformance(seed,tone,'long','28'),f=old.api.createPerformance(seed,tone,'long','27');
 const b=now.api.createPerformance(seed,tone,'long','29');
 assert.equal(a.exportDuration,b.exportDuration);assert.equal(a.density,b.density);
 equal(a.study.mirror,b.study.mirror);equal(a.study.theme,b.study.theme);equal(a.study.droneArch.interludes,b.study.droneArch.interludes);
 equal(a.groups.filter(g=>!g.interlude),b.groups.filter(g=>!g.interlude));
 for(let i=0;i<a.groups.length;i++){
  if(!a.groups[i].interlude)continue;
  const g=b.groups[i],e=g.interlude;statements++;
  for(let j=0;j<g.notes.length;j++){
   const o=a.groups[i].notes[j],n=g.notes[j];
   for(const key of ['freq','time','duration','volume','pan','envelope','interludeVoice'])equal(o[key],n[key]);
   equal(o.organ.ranks,n.organ.ranks);assert.equal(o.organ.outputGain,n.organ.outputGain);
   equal(f.groups[i].notes[j].interludeEffects,n.interludeEffects);
   assert.equal(n.organ.registration,'filtered-spectral-plenum-g29');assert.equal(n.organ.spectralChorus.bands.length,3);
   assert.equal(n.organ.spectralChorus.feedback,.1);assert.equal(n.organ.room,'audible-convolution-g27');
   assert.ok(n.interludeEffects.startHz<600&&n.interludeEffects.peakHz<800);
  }
  for(const partner of [b.groups.find(p=>p.interlude?.index===e.pairedIndex&&p.interlude.swell===e.swell),
    b.groups.find(p=>p.interlude?.index===e.index&&p.interlude.swell===e.swells+1-e.swell)])equal(g.notes.map(recipe),partner.notes.map(recipe));
 }
 equal(b,now.api.createPerformance(seed,tone,'long','29'));scores++;
}
const result={legacyScoreComparisons:legacy,g29Scores:scores,organStatements:statements,
 g27FiltersExact:true,g28PipeRecipesExact:true,bellsAndBackgroundExact:true,harmonyAndTimingExact:true,
 mirroredOrganRecipes:true,shortUnchanged:true,deterministic:true};
fs.writeFileSync('g29-score-validation.json',JSON.stringify(result,null,2));console.log(result);
