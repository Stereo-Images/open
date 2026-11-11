const fs=require('fs');const{harness,extract}=require('./harness.cjs');
const h=harness(extract(fs.readFileSync('deliverables/Open-g29-Sixteen-New-Studies.html','utf8')));
const m=JSON.parse(fs.readFileSync('manifest.json'));
for(const r of m.recordings){
 const s=h.api.createPerformance(parseInt(r.seed,16),r.rootHz,r.duration,r.engine);const a=s.study.droneArch;
 const bells=s.groups.flatMap(g=>g.notes).filter(n=>n.kind==='bell');
 Object.assign(r,{durationSeconds:s.exportDuration,nominalBpm:s.density*60,bellCount:bells.length,iterations:bells.length/11,interludeCount:a.interludes.length,chordStatements:a.interludes.map(e=>e.swells),paletteOrder:s.study.mirror.paletteOrder});
 fs.writeFileSync('scores/'+r.seed+'.json',JSON.stringify(s));
}
fs.writeFileSync('manifest.json',JSON.stringify(m,null,2));console.log('Updated the saved g29 batch scores without changing seeds or replay settings.');
