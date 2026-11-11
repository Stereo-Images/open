const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const {harness,extract}=require('./harness.cjs');
let source=extract(fs.readFileSync(path.join(__dirname,'deliverables/Open-Mirrored-Study-g27.html'),'utf8'));
source=source.replace('  function resolveDuration(seed, durationInput) {',`  window.chorusTest = (ctx, t, duration) => {
    initializeNoteDrift(ctx, 123);
    const destination=ctx.createGain();
    createOrganChorus(ctx,destination,{duration,organ:{chorus:ORGAN_CHORUS_PROFILE}},t);
    return ctx.nodes;
  };
  function resolveDuration(seed, durationInput) {`);
const h=harness(source),ctx=new h.sandbox.AudioContext();
const nodes=h.sandbox.chorusTest(ctx,10,22);
const delays=nodes.filter(n=>n.kind==='delay'),lfos=nodes.filter(n=>n.kind==='oscillator');
assert.equal(delays.length,2);assert.deepEqual(lfos.map(n=>n.frequency.value),[.06,.08]);
assert.ok(lfos.every(n=>n.startTime===10&&n.stopTime===32));
assert.deepEqual(nodes.filter(n=>n.kind==='panner').map(n=>n.pan.value),[-1,1]);
for(const delay of delays){
  const damping=delay.connections.find(n=>n.kind==='filter');assert.ok(damping);
  assert.equal(damping.frequency.value,850);assert.equal(damping.Q.value,.45);
  const feedback=damping.connections[0];assert.equal(feedback.connections[0],delay);
  assert.deepEqual(feedback.gain.events,[['set',.1,10],['set',.1,31.5],['ramp',0,32]]);
  const wet=delay.connections.find(n=>n.kind==='gain');assert.ok(wet);
  assert.deepEqual(wet.gain.events.at(-1),['ramp',0,32]);
  assert.equal(wet.connections[0].kind,'panner');
}
const broken=new h.sandbox.AudioContext(),makeDelay=broken.createDelay.bind(broken);let count=0;
broken.createDelay=()=>{if(++count===2)throw Error('simulated allocation failure');return makeDelay();};
assert.throws(()=>h.sandbox.chorusTest(broken,10,22),/simulated allocation/);
assert.ok(broken.nodes.slice(1).every(n=>n.disconnected),'Allocated nodes disconnected on failure');
assert.ok(broken.nodes.filter(n=>n.kind==='oscillator').every(n=>n.stopTime===10),'LFO stopped on failure');
const result={singleChorusStage:true,delayTaps:2,ratesHz:[.06,.08],feedback:.1,dampingHz:850,
  fullStereo:true,wetAndFeedbackZeroAtVoiceEnd:true,allocationFailureCleanup:true};
fs.writeFileSync(path.join(__dirname,'effects-validation.json'),JSON.stringify(result,null,2));console.log(result);
