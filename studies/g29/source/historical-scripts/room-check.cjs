const fs=require('node:fs'),assert=require('node:assert/strict');
const {harness,extract}=require('./harness.cjs');
const source=extract(fs.readFileSync('deliverables/Open-Mirrored-Study-g27.html','utf8')).replace('  function resolveDuration(seed, durationInput) {',`  window.roomTest={
 initialize:ctx=>initializeNoteDrift(ctx,123),get:(ctx,dest,tag)=>getOrganEffects(ctx,dest,tag),
 dispose:ctx=>disposeNoteDrift(ctx)
};
  function resolveDuration(seed, durationInput) {`);
const h=harness(source),ctx=new h.sandbox.AudioContext(),test=h.sandbox.roomTest;
test.initialize(ctx);const destination=ctx.createGain(),room=test.get(ctx,destination,'audible-convolution-g27');
assert.equal(test.get(ctx,destination,'audible-convolution-g27'),room);
const convolver=ctx.nodes.find(n=>n.kind==='convolver');assert.equal(convolver.buffer.duration,12);
assert.equal(convolver.buffer.numberOfChannels,2);
const [left,right]=[0,1].map(ch=>convolver.buffer.getChannelData(ch));
assert.ok(left.some((n,i)=>n!==right[i]));
const shelf=convolver.connections[0],wet=shelf.connections[0];
assert.equal(shelf.type,'highshelf');assert.equal(shelf.frequency.value,1600);assert.equal(shelf.gain.value,1.5);
assert.equal(wet.gain.value,1.1);assert.equal(wet.connections[0],destination);
const direct=room.input.connections.find(n=>n.kind==='gain');assert.equal(direct.gain.value,.8);
assert.equal(room.input.connections.find(n=>n.kind==='delay').delayTime.value,.025);
assert.equal(room.silentSend.gain.value,0);
const g26=test.get(ctx,destination,'long-convolution-g26');assert.notEqual(g26,room);
assert.equal(ctx.nodes.filter(n=>n.kind==='convolver')[1].buffer.duration,12);
const legacy=test.get(ctx,destination);assert.notEqual(legacy,room);
assert.equal(ctx.nodes.filter(n=>n.kind==='convolver')[2].buffer.duration,4);
const nodes=ctx.nodes.slice(1);test.dispose(ctx);assert.ok(nodes.every(n=>n.disconnected));
const broken=new h.sandbox.AudioContext();test.initialize(broken);const dest=broken.createGain();
broken.createConvolver=()=>{throw Error('allocation failed');};
assert.throws(()=>test.get(broken,dest,'audible-convolution-g27'),/allocation failed/);
assert.ok(broken.nodes.slice(1).every(n=>n.disconnected));
const result={longRoomSeconds:12,legacyRoomSeconds:4,wetGain:1.1,dryGain:.8,stereo:true,wetShelfDb:1.5,
 singleRoomPerContext:true,noBellRoomDoubleSend:true,cleanup:true,failureCleanup:true};
fs.writeFileSync('room-validation.json',JSON.stringify(result,null,2));console.log(result);
