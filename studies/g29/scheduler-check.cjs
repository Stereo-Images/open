const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {harness,extract}=require('./harness.cjs');
const source=extract(fs.readFileSync(path.join(__dirname,'deliverables/Open-g29-Sixteen-New-Studies.html'),'utf8'))
 .replace('        scheduleNote(ctx, master, wetSend, note.freq, time, note.duration, note.volume, 0, 0, note);',
  '        window.scheduled.push({planned:note.time,actual:time,freq:note.freq});')
 .replace('        schedulePrincipalPlenum(ctx, master, note, time);',
  '        window.organs.push({planned:note.time,actual:time,freq:note.freq});');
(async()=>{
 const checks=[];
 for(const duration of ['short','long']){
  const h=harness(source);h.sandbox.scheduled=[];h.sandbox.organs=[];
  h.sandbox.document.getElementById('replayInput').value=`open-run-477805c9-test-g29-121hz-${duration}-44100sr-1.wav`;
  await h.api.replayFromUI();assert.equal(h.api.state().snapshot.engine,'29');
  const score=h.api.state().snapshot;h.advance(duration==='short'?120:600);
  const heard=h.sandbox.scheduled;
  for(const n of score.groups.flatMap(g=>g.notes).filter(n=>n.kind==='bell'&&n.time<(duration==='short'?118:598)))
    assert.equal(heard.filter(s=>s.planned===n.time).length,1);
  const offsets=heard.map(n=>n.actual-n.planned);assert.ok(Math.max(...offsets)-Math.min(...offsets)<1e-8);
  if(duration==='long'){
    for(const n of score.groups.filter(g=>g.interlude&&g.time<598).flatMap(g=>g.notes))
      assert.equal(h.sandbox.organs.filter(s=>s.planned===n.time&&s.freq===n.freq).length,1);
  }else assert.equal(h.sandbox.organs.length,0);
  checks.push({duration,nominalBpm:score.density*60,bells:heard.length,organVoices:h.sandbox.organs.length,
    missing:0,duplicates:0,slowdown:false});h.sandbox.__OPEN_PLAYER_KILL__();
 }
 fs.writeFileSync(path.join(__dirname,'scheduler-validation.json'),JSON.stringify(checks,null,2));console.log(checks);
})().catch(e=>{console.error(e);process.exitCode=1;});
