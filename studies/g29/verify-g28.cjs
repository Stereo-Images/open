const fs=require('node:fs'),assert=require('node:assert/strict');
const {harness,extract}=require('./harness.cjs');
const read=p=>harness(extract(fs.readFileSync(p,'utf8')));
const old=read('source/Open-Mirrored-Study-g27.html'),now=read('deliverables/Open-Principal-Plenum-g28.html');
const plain=x=>JSON.parse(JSON.stringify(x));
const equal=(a,b)=>assert.deepEqual(plain(a),plain(b));
const recipe=note=>{const {time,...r}=note;return r;};
let legacyComparisons=0,scoreComparisons=0,interludes=0;
for(const seed of [0x0393ded7,0x0b086950,0x6fa6f7c1,0x40dc1965]){
 for(const engine of ['1',...Array.from({length:25},(_,i)=>String(i+3))])for(const duration of ['short','long','infinite']){
  if(['4','5'].includes(engine)&&duration!=='long')continue;
  equal(old.api.createPerformance(seed,121,duration,engine),now.api.createPerformance(seed,121,duration,engine));legacyComparisons++;
 }
 for(const duration of ['short','infinite']){
  const a=old.api.createPerformance(seed,121,duration),b=now.api.createPerformance(seed,121,duration);
  equal(a,b);equal(now.api.createPerformance(seed,121,duration,'28'),b);
  if(duration==='infinite')for(let i=0;i<100;i++)equal(a.continuation.next(),b.continuation.next());
 }
}
const seeds=[0,1,0xffffffff,...JSON.parse(fs.readFileSync('source/manifest-g27.json')).recordings.map(r=>parseInt(r.seed,16))];
for(const seed of seeds)for(const tone of [110,121,200]){
 const a=old.api.createPerformance(seed,tone,'long','27'),b=now.api.createPerformance(seed,tone,'long','28');
 equal(a.study.mirror,b.study.mirror);equal(a.study.theme,b.study.theme);
 equal(a.study.droneArch.interludes,b.study.droneArch.interludes);
 assert.equal(a.exportDuration,b.exportDuration);assert.equal(a.density,b.density);
 equal(a.groups.filter(g=>!g.interlude),b.groups.filter(g=>!g.interlude));
 assert.equal(a.groups.length,b.groups.length);
 for(let i=0;i<a.groups.length;i++){
  if(!a.groups[i].interlude)continue;
  const oldGroup=a.groups[i],g=b.groups[i],e=g.interlude;interludes++;
  assert.equal(oldGroup.time,g.time);assert.equal(oldGroup.notes.length,g.notes.length);
  for(let j=0;j<g.notes.length;j++){
   const o=oldGroup.notes[j],n=g.notes[j];
   for(const key of ['freq','time','duration','volume','pan','envelope','interludeVoice'])equal(o[key],n[key]);
   assert.equal(n.organ.registration,'principal-plenum-g28');
   equal(n.organ.chorus,o.organ.chorus);
   assert.equal(n.organ.chorus.feedback,.1);assert.equal(n.organ.room,'audible-convolution-g27');
   assert.ok(n.interludeEffects.startHz>=2300&&n.interludeEffects.peakHz<=3200);
   assert.equal(n.organ.ranks.filter(r=>r.ratio===.5).length,j===0?1:0);
   assert.ok(n.organ.ranks.every(r=>[.5,1,2,3,4,6,8].includes(r.ratio)&&Math.abs(r.detuneCents)<=.6));
   assert.equal(n.envelope.at(-1).value,0);
  }
  const partner=b.groups.find(p=>p.interlude?.index===e.pairedIndex&&p.interlude.swell===e.swell);
  equal(g.notes.map(recipe),partner.notes.map(recipe));
  const inner=b.groups.find(p=>p.interlude?.index===e.index&&p.interlude.swell===e.swells+1-e.swell);
  equal(g.notes.map(recipe),inner.notes.map(recipe));
 }
 equal(b,now.api.createPerformance(seed,tone,'long','28'));scoreComparisons++;
}
const replay=now.api.parseReplayInput('open-run-0393ded7-mviswtcb-g3-200hz-short-44100sr-1792628825406.wav');
assert.equal(replay.engine,'3');assert.equal(replay.seed,0x0393ded7);assert.equal(replay.tone,200);
const result={legacyComparisons,g28Scores:scoreComparisons,organStatements:interludes,
 unchangedBellAndBackgroundScores:true,unchangedHarmonyAndTiming:true,mirroredOrganRecipes:true,
 deterministic:true,shortAndInfiniteUnchanged:true,originalG3ReplayParsed:true};
fs.writeFileSync('g28-score-validation.json',JSON.stringify(result,null,2));console.log(result);
