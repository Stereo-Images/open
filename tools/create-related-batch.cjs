const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {harness}=require('../tests/support/harness.cjs');
const dir=path.resolve(process.argv[2]||'checks/nov11');
fs.mkdirSync(path.join(dir,'scores'),{recursive:true});
if(fs.existsSync(path.join(dir,'manifest.json')))throw Error('Refusing to redraw an existing batch');
let source=fs.readFileSync(path.join(__dirname,'../player.js'),'utf8');
source=source.replace('  function resolveDuration(seed, durationInput) {',
  '  window.batchTheme=seed=>createFixedStudyGenerator(seed,121,Infinity,true,G22_OPTIONS).study.theme;\n  function resolveDuration(seed, durationInput) {');
const h=harness(source),parent=h.api.createPerformance(0x08b0195e,121,'long','3');
const originalTheme=parent.groups.flatMap(g=>g.notes).filter(n=>n.kind==='bell').slice(0,11).map(n=>n.freq);
const key=x=>Array.from(x).map(f=>Math.round(12*Math.log2(f/121))).join(',');
const used=new Set(['08b0195e','0393ded7','0b086950']);
for(const row of require('../studies/g29/manifest.json').recordings)used.add(row.seed);
const draw=()=>{for(;;){const s=crypto.randomBytes(4).toString('hex');if(!used.has(s)){used.add(s);return s;}}};
// Related seeds preserve the parent's complete eleven-note source motif;
// the replay family separately preserves every opening recipe through 2:00.
const related=[];let attempts=0;
while(related.length<8){
  const seed=draw();attempts++;
  if(key(h.sandbox.batchTheme(parseInt(seed,16)))===key(originalTheme))related.push(seed);
  if(attempts>1000000)throw Error('Motif search exceeded limit');
}
const independent=Array.from({length:8},draw),recordings=[];
for(const [batch,seeds,engine] of [['reference',related,'32'],['random',independent,'30']])for(let i=0;i<8;i++){
  const seed=seeds[i],score=h.api.createPerformance(parseInt(seed,16),121,'long',engine);
  const bells=score.groups.flatMap(g=>g.notes).filter(n=>n.kind==='bell');
  const replayFilename=`open-run-${seed}-study-g${engine}-121hz-long-44100sr-${Date.now()+i}.wav`;
  const snapshot={seed:parseInt(seed,16),tone:121,duration:'long',engine,sampleRate:44100};
  const row={batch,number:i+1,seed,engine,rootHz:121,sampleRate:44100,duration:'long',
    durationSeconds:score.exportDuration,nominalBpm:score.tempo.nominalBpm,bellCount:bells.length,
    iterations:score.study.mirror.passCount,interludeCount:score.study.droneArch.interludes.length,
    chordStatements:score.study.droneArch.pattern,themeSemitones:key(score.study.theme).split(',').map(Number),
    sourceThemeSemitones:key(score.study.sourceTheme).split(',').map(Number),
    paletteOrder:score.study.mirror.paletteOrder,replayFilename,replayLink:h.api.replayLink(snapshot),
    ...(score.study.inheritedOpening?{inheritedOpening:score.study.inheritedOpening}:{})};
  recordings.push(row);fs.writeFileSync(path.join(dir,'scores',seed+'.json'),JSON.stringify(score));
  console.log(JSON.stringify({seed,batch,minutes:score.exportDuration/60,bpm:row.nominalBpm,notes:bells.length}));
}
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({created:new Date().toISOString(),referenceSeed:'08b0195e',
  referenceEngine:'3',rootHz:121,referenceThroughSeconds:120,referenceBellCount:28,
  relatedSelection:'Eight random seeds matching the original eleven-note motif, with the original two-minute opening except the tritone landing lowered one semitone',
  randomSelection:'Eight unconditioned random draws; no pitch, tempo, duration or timbre filtering',
  referenceSearchAttempts:attempts,playerSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../player.js'))).digest('hex'),recordings},null,2));
