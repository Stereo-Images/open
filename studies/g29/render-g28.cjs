const fs=require('node:fs'),path=require('node:path');
const {harness,extract}=require('./harness.cjs'),{render}=require('./render.cjs');
(async()=>{
 const seed='40dc1965',html=path.join(__dirname,'deliverables/Open-Principal-Plenum-g28.html');
 const score=harness(extract(fs.readFileSync(html,'utf8'))).api.createPerformance(parseInt(seed,16),121,'long','28');
 const replayFilename=`open-run-${seed}-study-g28-121hz-long-44100sr-${Date.now()}.wav`;
 const manifest={engine:'28',change:'Principal chorus interludes; g27 composition and effects preserved',
  recordings:[{seed,engine:'28',duration:'long',durationSeconds:score.exportDuration,rootHz:121,sampleRate:44100,replayFilename}]};
 fs.writeFileSync('manifest-g28.json',JSON.stringify(manifest,null,2));
 fs.writeFileSync('score-g28-40dc1965.json',JSON.stringify(score,null,2));
 const result=await render({html,seed,engine:'28',duration:'long',tone:121,filename:path.join(__dirname,'deliverables',replayFilename)});
 fs.writeFileSync('g28-full-render.json',JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
