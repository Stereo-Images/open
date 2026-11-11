const fs=require('fs'),assert=require('assert/strict'),{harness,extract}=require('./harness.cjs');
const source=extract(fs.readFileSync('deliverables/Open-Filtered-Spectral-Organ-g29.html','utf8')).replace('  function resolveDuration(seed, durationInput) {',`  window.fxTest={initialize:ctx=>initializeNoteDrift(ctx,123),schedule:schedulePrincipalPlenum,dispose:disposeNoteDrift,chorus:createSpectralOrganChorus};
  function resolveDuration(seed, durationInput) {`);
const h=harness(source),ctx=new h.sandbox.AudioContext(),test=h.sandbox.fxTest;
ctx.createPeriodicWave=(real,imag,options)=>({real,imag,options});
const oscillator=ctx.createOscillator.bind(ctx);
ctx.createOscillator=()=>{const n=oscillator();n.setPeriodicWave=wave=>n.wave=wave;return n;};
const note=h.api.createPerformance(0x40dc1965,121,'long','29').groups.find(g=>g.interlude).notes[0];
const destination=ctx.createGain();test.initialize(ctx);test.schedule(ctx,destination,note,1);
const pipes=ctx.nodes.filter(n=>n.wave),delays=ctx.nodes.filter(n=>n.kind==='delay'),convolvers=ctx.nodes.filter(n=>n.kind==='convolver');
assert.equal(pipes.length,7);assert.equal(delays.length,7);assert.equal(convolvers.length,1);assert.equal(convolvers[0].buffer.duration,12);
for(const p of pipes){assert.equal(p.startTime,1);assert.equal(p.stopTime,1+note.duration);}
for(const hz of [.023,.029,.037,.043,.053,.061])assert.ok(ctx.nodes.some(n=>n.kind==='oscillator'&&n.frequency.value===hz));
assert.equal(ctx.nodes.filter(n=>n.kind==='oscillator'&&[.06,.08].includes(n.frequency.value)).length,0,'No second broadband chorus');
for(const hz of [180,500])assert.ok(ctx.nodes.some(n=>n.kind==='filter'&&n.frequency.value===hz));
const pans=ctx.nodes.filter(n=>n.kind==='panner').map(n=>n.pan.value);
for(const value of [-1,1,-.35,.35])assert.ok(pans.includes(value));
assert.ok(ctx.nodes.some(n=>n.kind==='filter'&&n.frequency.events.some(e=>e[1]===note.interludeEffects.startHz)));
const shelf=convolvers[0].connections[0];assert.equal(shelf.gain.value,1.5);assert.equal(shelf.connections[0].gain.value,1.1);
const created=ctx.nodes.filter(n=>n!==destination);test.dispose(ctx);assert.ok(created.every(n=>n.disconnected));
const broken=new h.sandbox.AudioContext();test.initialize(broken);const out=broken.createGain();
broken.createDelay=()=>{throw Error('allocation failed');};
assert.throws(()=>test.chorus(broken,out,note,1),/allocation failed/);
assert.ok(broken.nodes.filter(n=>n!==out).every(n=>n.disconnected));
const result={bandEdgesHz:[180,500],ratesHz:[.023,.029,.037,.043,.053,.061],wideMidUpperPans:[-1,1],
 foundationPans:[-.35,.35],feedback:.1,convolutionSeconds:12,oneChorus:true,oneRoom:true,g27Filter:true,cleanup:true,failureCleanup:true};
fs.writeFileSync('g29-effects-validation.json',JSON.stringify(result,null,2));console.log(result);
