const fs=require('node:fs'),assert=require('node:assert/strict');
const {harness}=require('./support/harness.cjs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const load=p=>harness(fs.readFileSync(p,'utf8'));
const now=load(path.join(root,'player.js'));
const old=process.env.OPEN_RELEASE_BASELINE?load(process.env.OPEN_RELEASE_BASELINE):null;
const plain=x=>JSON.parse(JSON.stringify(x));
const equal=(a,b)=>assert.deepEqual(plain(a),plain(b));
const close=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-7,`${message}: ${a} vs ${b}`);
const recipe=n=>{const {time,...r}=n;return r;};
let legacy=0,short=0,notesChecked=0;
if(old) for(const seed of [0x0393ded7,0x6fa6f7c1,0x0b086950,0x477805c9]){
 for(const engine of ['1',...Array.from({length:27},(_,i)=>String(i+3))]){
  for(const duration of ['short','long']){
   if(['4','5'].includes(engine)&&duration!=='long')continue;
   equal(now.api.createPerformance(seed,121,duration,engine),old.api.createPerformance(seed,121,duration,engine));legacy++;
  }
 }
 for(const duration of ['short']){
  const a=now.api.createPerformance(seed,121,duration),b=old.api.createPerformance(seed,121,duration);
  equal(a,b);equal(now.api.createPerformance(seed,121,duration,'29'),b);short++;
 }
}
const replay=now.api.parseReplayInput('open-run-0393ded7-mviswtcb-g3-200hz-short-44100sr-1792628825406.wav');
assert.equal(replay.engine,'3');assert.equal(replay.seed,0x0393ded7);assert.equal(replay.tone,200);
function verify(seed,tone){
 const s=now.api.createPerformance(seed,tone,'long','29'),m=s.study.mirror,a=s.study.droneArch;
 assert.ok(s.exportDuration>=600&&s.exportDuration<=1800);assert.ok(s.density*60>=3&&s.density*60<15);
 assert.equal(m.passCount%2,0);assert.ok(m.passCount>=6);assert.equal(a.interludes.length,m.passCount-1);
 equal(m.paletteOrder,m.paletteOrder.slice().reverse());equal(a.pattern,a.pattern.slice().reverse());
 assert.equal(a.pattern.filter(v=>v===3).length,1);assert.equal(a.pattern[0],1);
 const bells=s.groups.filter(g=>g.study).map(g=>g.notes[0]);
 const all=s.groups.flatMap(g=>g.notes);
 assert.equal(m.eventSymmetry,false);assert.equal(m.orderSymmetry,true);
 for(let c=0;c<m.passCount;c++){
  const left=s.groups.filter(g=>g.study?.cycle===c||g.background?.cycle===c).flatMap(g=>g.notes);
  const right=s.groups.filter(g=>g.study?.cycle===m.passCount-1-c||g.background?.cycle===m.passCount-1-c).flatMap(g=>g.notes);
  equal(left.map(recipe),right.map(recipe));
  for(let i=0;i<left.length;i++)close(left[i].time-m.passes[c].start,right[i].time-m.passes[m.passCount-1-c].start,'Paired pass timing');
 }
 notesChecked+=all.length;
 const palettes=new Set();
 for(let c=0;c<m.passCount;c++){
  const pass=bells.slice(c*11,(c+1)*11);equal(pass.map(n=>n.freq),s.study.theme);
  for(let i=0;i<11;i++)equal(recipe(pass[i]),recipe(pass[10-i]));
  for(let i=1;i<11;i++){
   assert.ok(pass[i].time-pass[i-1].time>=4-1e-8);
   const jump=Math.abs(Math.round(12*Math.log2(pass[i].freq/pass[i-1].freq)));assert.notEqual(jump%12,6);
  }
  if(c<m.halfCount)palettes.add(JSON.stringify(pass.map(recipe)));
 }
 assert.equal(palettes.size,m.halfCount,'Distinct palettes on outward half, matched on return');
 const pc=f=>((Math.round(12*Math.log2(f/tone))%12)+12)%12;
 for(const e of a.interludes){
  const organ=s.groups.filter(g=>g.interlude?.index===e.index),pair=a.interludes[e.pairedIndex-1];
  equal(e.harmony.semitones,pair.harmony.semitones);assert.equal(organ.length,e.swells);
  const directEnd=Math.max(...organ.flatMap(g=>g.notes).map(n=>n.time+n.duration));
  close(e.returnTime-directEnd,2,'Dry handoff');
  close(m.passes[e.index].start,e.returnTime,'Return is next pass');
  const lastBell=bells.filter(n=>n.time<e.start).at(-1);
  const hold=e.start-lastBell.time;assert.ok(hold>=6-1e-8&&hold<=14+1e-8);
  assert.ok(e.start<lastBell.time+lastBell.duration,'Organ enters the fading bell tail');
  for(const g of organ)for(const n of g.notes){
   assert.equal(n.organ.registration,'filtered-spectral-plenum-g29');assert.ok(!n.granular);
   assert.equal(n.organ.chorus.feedback,.1);assert.ok(n.freq>=87.31&&n.freq<=349.23);
   assert.equal(n.envelope[0].value,0);assert.equal(n.envelope.at(-1).value,0);
   for(let k=0;k<n.envelope.length;k++)close(n.envelope[k].value,n.envelope.at(-1-k).value,'Symmetric organ envelope');
   const other=all.filter(o=>!organ.some(g=>g.notes.includes(o))&&o.time<n.time+n.duration+12.325&&o.time+o.duration+10.465>n.time);
   for(const o of other)assert.ok(![1,6,11].includes((pc(n.freq)-pc(o.freq)+12)%12),'Consonant organ overlap');
  }
 }
 assert.ok(s.groups.some(g=>g.background));
 for(const g of s.groups.filter(g=>g.background))for(const n of g.notes){assert.equal(n.kind,'bass');assert.ok(!n.organ&&!n.granular&&!n.interludeEffects);}
 assert.equal(a.effects.impulseSeconds,12);assert.equal(a.effects.wetGain,1.1);assert.equal(s.groups.filter(g=>g.ending).length,1);
 assert.equal(s.groups.at(-1).endingKind,'mirrored-theme-end');
 close(s.exportDuration,m.end+10.465,'Complete form with normal room tail');
 equal(s,now.api.createPerformance(seed,tone,'long','29'));
 return {seed:seed.toString(16).padStart(8,'0'),tone,duration:s.exportDuration,passes:m.passCount,bpm:s.density*60};
}
const seeds=[];
for(const r of JSON.parse(fs.readFileSync(path.join(root,'studies/g29/manifest.json'))).recordings)seeds.push(parseInt(r.seed,16));
const checked=[];for(const seed of new Set(seeds))for(const tone of [121])checked.push(verify(seed,tone));
console.log(JSON.stringify({legacy,short,longScores:checked.length,notesChecked,passed:true}));
