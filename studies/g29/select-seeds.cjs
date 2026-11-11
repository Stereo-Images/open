const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {harness,extract}=require('./harness.cjs');
const dir=__dirname;
const source=extract(fs.readFileSync(path.join(dir,'deliverables/Open-Filtered-Spectral-Organ-g29.html'),'utf8')).replace('  function resolveDuration(seed, durationInput) {','  window.opening22=seed=>createFixedStudyGenerator(seed,121,Infinity,true,G22_OPTIONS).study.theme;\n  function resolveDuration(seed, durationInput) {');
const h=harness(source);
const reference=Array.from(h.api.createPerformance(0x0b086950,121,'long','19').study.theme);
const key=x=>Array.from(x).map(f=>Math.round(12*Math.log2(f/121))).join(',');
const used=new Set(['0b086950','0393ded7','657a2d5a','92c62d1c','4306c924','a417624c','46eaf72e','4e3a1a97','c9cef0c1','2680d760']);
for(const seed of require('./excluded-seeds.json'))used.add(seed);
for(const directory of fs.readdirSync(path.dirname(dir),{withFileTypes:true}).filter(d=>d.isDirectory())){
 const file=path.join(path.dirname(dir),directory.name,'manifest.json');
 if(!fs.existsSync(file))continue;
 const prior=JSON.parse(fs.readFileSync(file));for(const row of prior.recordings||[])if(row.seed)used.add(row.seed);
}
const draw=()=>{for(;;){const s=crypto.randomBytes(4).toString('hex');if(!used.has(s)){used.add(s);return s;}}};
const related=[];let attempts=0;
while(related.length<8){
 const seed=draw();attempts++;
 if(key(h.sandbox.opening22(parseInt(seed,16)))===key(reference)){related.push(seed);console.log('reference match',seed,attempts);}
 if(attempts>1000000)throw Error('Reference search exceeded limit');
}
// Unconditioned random draws for the second batch: no motif or tempo filtering.
const independent=Array.from({length:8},draw),recordings=[];
fs.mkdirSync(path.join(dir,'scores'),{recursive:true});
for(const [batch,seeds] of [['reference',related],['random',independent]])for(let i=0;i<seeds.length;i++){
 const seed=seeds[i],score=h.api.createPerformance(parseInt(seed,16),121,'long','29');
 const bells=score.groups.flatMap(g=>g.notes).filter(n=>n.kind==='bell');
 const arch=score.study.droneArch;
 const filename=`open-run-${seed}-study-g29-121hz-long-44100sr-${Date.now()+i}.wav`;
 const row={batch,number:i+1,seed,engine:'29',rootHz:121,sampleRate:44100,duration:'long',durationSeconds:score.exportDuration,
   nominalBpm:score.density*60,bellCount:bells.length,iterations:bells.length/11,
   interludeCount:arch.interludes.length,chordStatements:arch.interludes.map(e=>e.swells),targetDurationSeconds:score.targetDuration,
   themeSemitones:key(score.study.theme).split(',').map(Number),sourceThemeSemitones:key(score.study.sourceTheme).split(',').map(Number),
   paletteOrder:score.study.mirror.paletteOrder,replayFilename:filename};
 recordings.push(row);fs.writeFileSync(path.join(dir,'scores',seed+'.json'),JSON.stringify(score));
 console.log(JSON.stringify(row));
}
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({engine:'29',referenceSeed:'0b086950',referenceThemeSemitones:key(reference).split(',').map(Number),
 relatedSelection:'Exact original 11-note motif match before applying the g29 mirror',randomSelection:'Eight unconditioned new random seeds',referenceSearchAttempts:attempts,recordings},null,2));
