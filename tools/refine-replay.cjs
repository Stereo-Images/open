// Produce a versioned FM variation without changing an older score's planner.
const {harness} = require('../tests/support/harness.cjs');
const input = process.argv[2];
if (!input) throw Error('Pass a complete saved filename or replay link.');
const {api} = harness();
const record = api.parseReplayInput(input);
if (record.partial) throw Error('Use a complete versioned filename or link so the original recipe, root, length and sample rate are known.');
const baseEngine = record.baseEngine ?? (record.engine === '33' ? (record.duration === 'long' ? '30' : '21') : record.engine);
const original = api.createPerformance(record.seed, record.tone, record.duration, baseEngine);
const refined = api.createPerformance(record.seed, record.tone, record.duration, '33', baseEngine);
const before = original.groups.flatMap(g => g.notes), after = refined.groups.flatMap(g => g.notes);
let bellNumber = 0;
const changedStrikes = [];
after.forEach((note, i) => {
  if (note.kind !== 'bell') return;
  bellNumber++;
  if (JSON.stringify(note) !== JSON.stringify(before[i]))
    changedStrikes.push({strike: bellNumber, timeSeconds: note.time, frequencyHz: note.freq});
});
console.log(JSON.stringify({replayLink: api.replayLink({...record, engine: '33', baseEngine}),
  baseEngine, durationSeconds: original.exportDuration, bellStrikes: bellNumber,
  changedStrikes, unchangedStrikes: bellNumber - changedStrikes.length}, null, 2));
