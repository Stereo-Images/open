const fs=require('node:fs'),assert=require('node:assert/strict'),{harness,extract}=require('./harness.cjs');
const source=extract(fs.readFileSync('deliverables/Open-Principal-Plenum-g28.html','utf8')).replace('  function resolveDuration(seed, durationInput) {',`  window.plenumTest={initialize:ctx=>initializeNoteDrift(ctx,123),schedule:schedulePrincipalPlenum,dispose:disposeNoteDrift};
  function resolveDuration(seed, durationInput) {`);
const h=harness(source),ctx=new h.sandbox.AudioContext();
ctx.createPeriodicWave=(real,imag,options)=>({real,imag,options});
const oscillator=ctx.createOscillator.bind(ctx);
ctx.createOscillator=()=>{const n=oscillator();n.setPeriodicWave=wave=>{n.wave=wave;};return n;};
const note=h.api.createPerformance(0x40dc1965,121,'long','28').groups.find(g=>g.interlude).notes[0];
const destination=ctx.createGain(),t=h.sandbox.plenumTest;t.initialize(ctx);t.schedule(ctx,destination,note,1);
const pipes=ctx.nodes.filter(n=>n.wave),delays=ctx.nodes.filter(n=>n.kind==='delay'),convolvers=ctx.nodes.filter(n=>n.kind==='convolver');
assert.equal(pipes.length,7);assert.equal(convolvers.length,1);assert.equal(convolvers[0].buffer.duration,12);
for(const pipe of pipes){assert.equal(pipe.wave.options.disableNormalization,true);assert.equal(pipe.startTime,1);assert.equal(pipe.stopTime,1+note.duration);}
for(const seconds of [.020,.028])assert.ok(delays.some(n=>n.delayTime.events.some(e=>e[1]===seconds)));
assert.ok(ctx.nodes.filter(n=>n.kind==='panner').some(n=>n.pan.value===-1));
assert.ok(ctx.nodes.filter(n=>n.kind==='panner').some(n=>n.pan.value===1));
for(const hz of [.060,.080])assert.ok(ctx.nodes.some(n=>n.kind==='oscillator'&&n.frequency.value===hz));
for(const amount of [.0030,-.0034])assert.ok(ctx.nodes.some(n=>n.kind==='gain'&&n.gain.value===amount));
const shelf=convolvers[0].connections[0],wet=shelf.connections[0];
assert.equal(shelf.gain.value,1.5);assert.equal(wet.gain.value,1.1);assert.equal(wet.connections[0],destination);
const created=ctx.nodes.filter(n=>n!==destination);t.dispose(ctx);assert.ok(created.every(n=>n.disconnected));
const result={independentPipeRanks:7,chorusPan:[-1,1],chorusRatesHz:[.06,.08],chorusDepthSeconds:[.003,-.0034],
 feedback:.1,convolutionSeconds:12,wetGain:1.1,wetShelfDb:1.5,noDuplicateRoom:true,cleanup:true};
fs.writeFileSync('g28-effects-validation.json',JSON.stringify(result,null,2));console.log(result);
