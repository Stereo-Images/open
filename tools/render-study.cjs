const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {harness}=require('../tests/support/harness.cjs');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'studies/g29');
async function render({sourceFile=path.join(root,'player.js'),seed,engine='29',duration='long',tone=121,filename,mode='full',interludeIndex=1}){
 // Native audio handles need explicit collection between offline segments;
 // otherwise ended panners can accumulate during very dense, long studies.
 if(!global.gc){require('node:v8').setFlagsFromString('--expose_gc');global.gc=require('node:vm').runInNewContext('gc');}
 const {OfflineAudioContext}=await import(process.env.OPEN_AUDIO_RUNTIME
   ? require('node:url').pathToFileURL(path.resolve(process.env.OPEN_AUDIO_RUNTIME)).href
   : 'node-web-audio-api');
 let source=fs.readFileSync(sourceFile,'utf8');
 source=source.replace('  function resolveDuration(seed, durationInput) {','  window.renderStudy=renderWavSession;\n  function resolveDuration(seed, durationInput) {');
 source=source.replace('  function resolveDuration(seed, durationInput) {','  window.releaseOfflineRefs=(ctx,finished)=>{const s=spatialStates.get(ctx);s.nodes=s.nodes.filter(n=>!finished.has(n));};\n  function resolveDuration(seed, durationInput) {');
 // Native adapter: explicitly commit the older room's channel writes.
 source=source.replace('    if (cache) cachedImpulseBuffer = impulse;','    for(let ch=0;ch<2;ch++) impulse.copyToChannel(impulse.getChannelData(ch),ch);\n    if (cache) cachedImpulseBuffer = impulse;');
 source=source.replace('    if (ctx !== audioContext || !bus) return;','    if(ctx!==audioContext){window.trackOffline(nodes,endTime+VOICE_SETTLE_SECONDS);return;}\n    if(!bus)return;');
 source=source.replace('      for (const group of sessionSnapshot.groups) renderGroup(offlineCtx, offlineMaster, offlineSend, group, 0);','');
 source=source.replace('renderedBuffer = await offlineCtx.startRendering();','renderedBuffer = await window.renderInStages(offlineCtx,sessionSnapshot,g=>renderGroup(offlineCtx,offlineMaster,offlineSend,g,0));');
 source=source.replace('    const wavBlob = await bufferToWave(renderedBuffer);','    return window.captureRender(renderedBuffer);\n    const wavBlob = await bufferToWave(renderedBuffer);');
 const h=harness(source);h.sandbox.OfflineAudioContext=OfflineAudioContext;
 let pending=[];
 h.sandbox.trackOffline=(nodes,at)=>pending.push({nodes,at});
 h.sandbox.renderInStages=async(ctx,score,schedule)=>{
  let cursor=0,boundary=30;
  const add=t=>{while(cursor<score.groups.length&&score.groups[cursor].time<t)schedule(score.groups[cursor++]);};
  add(boundary+1.5);
  // This native backend requires all suspension requests before rendering.
  const pauses=[];
  // A pause rounds to a render quantum. Never request one at the final
  // quantum (e.g. a 60-second probe represented as 60.0000000000001).
  for(let time=boundary;time+128/ctx.sampleRate<score.exportDuration;time+=30)pauses.push(ctx.suspend(time));
  const running=ctx.startRendering();
  for(const suspended of pauses){
   await suspended;
   const finished=new Set();
   pending=pending.filter(v=>{if(v.at>ctx.currentTime)return true;for(const n of v.nodes){n.disconnect();finished.add(n);}return false;});
   h.sandbox.releaseOfflineRefs(ctx,finished);
   finished.clear();
   if(global.gc)global.gc();
   if(Math.round(boundary)%300===0)console.log(JSON.stringify({seed,renderedSeconds:Math.round(ctx.currentTime)}));
   boundary+=30;add(boundary+1.5);
   await ctx.resume();
  }
  return await running;
 };
 let score=h.api.createPerformance(parseInt(seed,16),tone,duration,engine),tailStartsAt=27,lateTailStartsAt=27;
 if(mode==='background'){
  const source=score.groups.find(g=>g.background),start=source.time;
  const group={...source,time:0,notes:source.notes.map(n=>({...n,time:n.time-start}))};
  score={...score,groups:[group],exportDuration:Math.max(...group.notes.map(n=>n.time+n.duration))+10.465};
 }
 if(mode==='probe'||mode==='audition'){
  // Isolated first interlude plus its entire tail, at the real native rate.
  const entry=score.study.droneArch.interludes[interludeIndex-1];
  const groups=score.groups.filter(g=>g.interlude?.index===entry.index).map(g=>({...g,time:g.time-entry.start,notes:g.notes.map(n=>({...n,time:n.time-entry.start}))}));
  tailStartsAt=entry.returnTime-entry.start;
  lateTailStartsAt=Math.max(...groups.flatMap(g=>g.notes).map(n=>n.time+n.duration))+5;
  score={...score,groups,exportDuration:Math.max(tailStartsAt,lateTailStartsAt-5+12.325)+(mode==='probe'?1:.1)};
 }
 const start=Date.now();let result;
 h.sandbox.captureRender=b=>{
  const frames=b.length,rate=b.sampleRate,header=Buffer.alloc(44);
  header.write('RIFF');header.writeUInt32LE(frames*4+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);
  header.writeUInt16LE(1,20);header.writeUInt16LE(2,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*4,28);
  header.writeUInt16LE(4,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(frames*4,40);
  fs.mkdirSync(path.dirname(filename),{recursive:true});const file=fs.openSync(filename,'w');fs.writeSync(file,header);
  const hash=crypto.createHash('sha256');let peak=0,energy=0,nonfinite=0,clipped=0;
  let tailPeak=0,lateTailPeak=0;
  const block=65536,channels=[new Float32Array(block),new Float32Array(block)],pcm=Buffer.alloc(block*4);
  for(let offset=0;offset<frames;offset+=block){
   const count=Math.min(block,frames-offset);
   for(let ch=0;ch<2;ch++){b.copyFromChannel(channels[ch],ch,offset);hash.update(Buffer.from(channels[ch].buffer,0,count*4));}
   for(let i=0;i<count;i++)for(let ch=0;ch<2;ch++){
    const value=channels[ch][i];if(!Number.isFinite(value))nonfinite++;
    peak=Math.max(peak,Math.abs(value));energy+=value*value;if(Math.abs(value)>=1)clipped++;
    if(mode==='probe'&&(offset+i)/rate>=tailStartsAt)tailPeak=Math.max(tailPeak,Math.abs(value));
    if(mode==='probe'&&(offset+i)/rate>=lateTailStartsAt)lateTailPeak=Math.max(lateTailPeak,Math.abs(value));
    const v=Math.max(-1,Math.min(1,value));
    // Match the existing browser WAV worker's exact 16-bit conversion.
    pcm.writeInt16LE((0.5+v<0?v*32768:v*32767)|0,i*4+ch*2);
   }
   fs.writeSync(file,pcm,0,count*4);
  }
  fs.closeSync(file);
  result={seed,engine,duration:score.exportDuration,frames,sampleRate:rate,renderSeconds:(Date.now()-start)/1000,
   peak,peakDb:20*Math.log10(peak),rms:Math.sqrt(energy/(frames*2)),nonfinite,clipped,
   pcmSha256:hash.digest('hex'),playerSha256:crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex'),filename,
   ...(mode==='probe'?{interludeIndex,tailStartsAt,tailPeakAfterReturn:tailPeak,tailPeakFiveSecondsAfterDirectEnd:lateTailPeak}:{})};
 };
 console.log(JSON.stringify({rendering:seed,engine,mode,seconds:score.exportDuration}));
 await h.sandbox.renderStudy({...score,sampleRate:44100,engine,runId:seed+'-study'});
 h.sandbox.__OPEN_PLAYER_KILL__();
 assert.equal(result.nonfinite,0);assert.equal(result.clipped,0);
 console.log(JSON.stringify(result));return result;
}
module.exports={render};
if(require.main===module)(async()=>{
 const seed=process.argv[2];
 const row=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))).recordings.find(r=>r.seed===seed);
 if(!row)throw Error('Unknown batch seed');
 const result=await render({seed,engine:row.engine,duration:row.duration,tone:row.rootHz,filename:path.join(root,'checks/wav',row.replayFilename)});
 fs.mkdirSync(path.join(root,'checks/render-results'),{recursive:true});
 fs.writeFileSync(path.join(root,'checks/render-results',seed+'.json'),JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
