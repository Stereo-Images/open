const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {harness,extract}=require('./harness.cjs');
const file='deliverables/Open-g29-Sixteen-New-Studies.html',html=fs.readFileSync(file,'utf8');
const h=harness(extract(html)),m=JSON.parse(fs.readFileSync('manifest.json'));
const plain=x=>JSON.parse(JSON.stringify(x));
for(const r of m.recordings){
 assert.ok(html.includes(`<option value="${r.seed}">`));
 const replay=h.api.parseReplayInput(r.replayFilename);
 assert.equal(replay.engine,'29');assert.equal(replay.seed,parseInt(r.seed,16));assert.equal(replay.tone,121);
 const score=h.api.createPerformance(replay.seed,replay.tone,'long',replay.engine);
 assert.deepEqual(plain(score),JSON.parse(fs.readFileSync(`scores/${r.seed}.json`)));
}
assert.ok(html.includes('open-run-${seed}-study-g29-121hz-long-44100sr-1.wav'));
assert.ok(html.includes("document.getElementById('playShortStudy').addEventListener"));
assert.ok(html.includes('open-run-0393ded7-mviswtcb-g3-200hz-short-44100sr-1792628825406.wav'));
assert.equal((html.match(/<optgroup /g)||[]).length,2);
const hash=crypto.createHash('sha256').update(html).digest('hex');
const result={engine:29,htmlSha256:hash,seedOptions:m.recordings.length,batches:2,allReplayScoresExact:true,preservedShortStudyShortcut:true};
fs.writeFileSync('batch-player-validation.json',JSON.stringify(result,null,2));console.log(result);
