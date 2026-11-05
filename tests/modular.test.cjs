const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Ensemble, validateScore, voiceLeadingWeight, TAIL } = require('../modular-core.js');

function advance(ensemble, from, to, step = 0.2) {
  const events = [], ended = [];
  for (let now = from; now <= to; now += step) {
    const result = ensemble.plan(now);
    events.push(...result.events);
    ended.push(...result.ended);
  }
  return { events, ended };
}
function make(seed = 42, tone = 121) { return new Ensemble({ seed, tone, now: 0 }); }
function join(e, id, seed, now = 0, length = 'infinite') { e.join(id, { seed, now, length }); }

test('independent voices keep distinct, drifting clocks and melodic contours', () => {
  const e = make();
  join(e, 'a', 81); join(e, 'b', 217);
  const { events } = advance(e, 0, 900);
  const voices = ['a', 'b'].map(id => events.filter(n => n.performer === id));
  assert.ok(voices.every(v => v.length > 15));
  const gaps = voices.map(v => v.slice(1).map((n, i) => n.at - v[i].at));
  assert.notDeepEqual(gaps[0], gaps[1]);
  assert.ok(gaps.every(g => Math.max(...g) - Math.min(...g) > 5));
  assert.notDeepEqual(voices[0].map(e => e.notes[0].freq), voices[1].map(e => e.notes[0].freq));
  // Different clocks allow either voice to enter again before its partner.
  assert.ok(events.some((e, i) => i && e.performer === events[i - 1].performer));
});

test('prominent ringing pitches stay compatible; decaying bells permit prepared resolutions', () => {
  for (const tone of [110, 121, 200]) for (const seed of [1, 42, 54325756, 0xffffffff]) {
    const e = make(seed, tone);
    join(e, 'a', seed ^ 100); join(e, 'b', seed ^ 200); join(e, 'c', seed ^ 300);
    const { events } = advance(e, 0, 1800);
    assert.ok(events.length > 60, `too much silence: ${tone}/${seed}`);
    const sounding = [];
    for (const event of events) {
      for (const note of event.notes) {
        assert.ok(note.freq >= (note.kind === 'bell' ? 110 : 87.31) && note.freq <= 415.3);
        const semi = Math.round(12 * Math.log2(note.freq / tone));
        for (const old of sounding.filter(n => n.until > event.at)) {
          const interval = ((semi - old.semi) % 12 + 12) % 12;
          if ([1, 6, 11].includes(interval)) {
            const age = event.at - old.at;
            const quiet = old.kind === 'bell' && age >= old.duration / 2;
            const resolving = ['leading-tone', 'suspension'].includes(event.motion) &&
              old.kind === 'bell' && old.performer === event.performer &&
              age >= Math.min(4, old.duration / 4) && Math.abs(semi - old.semi) <= 2;
            assert.ok(quiet || resolving, `unprepared prominent clash ${tone}/${seed} at ${event.at}`);
          }
        }
        sounding.push({ semi, until: event.at + note.duration + TAIL, at: event.at,
          duration: note.duration, kind: note.kind, performer: event.performer });
      }
      assert.ok(events.filter(n => n.at > event.at - 60 && n.at <= event.at).length <= 15);
    }
  }
});

test('voice leading favors common tones, small moves, and contrary motion over parallel fifths', () => {
  const member = { id: 'a', lastSemi: 12, lastChord: [0, 4, 7], peerPitches: new Map([['b', 5]]) };
  assert.ok(voiceLeadingWeight(member, 12, [], [0, 5, 9], true) > voiceLeadingWeight(member, 17, [], [0, 5, 9], true));
  assert.ok(voiceLeadingWeight(member, 14, [], [2, 7, 11], false) > voiceLeadingWeight(member, 23, [], [2, 7, 11], false));
  const risingPeer = [{ id: 'b', lastSemi: 7 }];
  // F–C -> G–D parallels versus F–C -> G–B-flat contrary motion.
  assert.ok(voiceLeadingWeight(member, 10, risingPeer, [2, 7, 10], false) >
    voiceLeadingWeight(member, 14, risingPeer, [2, 7, 10], false));
});

test('a prepared F over C resolves to E on its own next entry, even after its ending target', () => {
  const e = make(); join(e, 'a', 81);
  const m = e.members.get('a');
  m.lastSemi = 5; m.lastKey = 0; m.lastChord = [5, 9, 0]; m.lastHarmony = 0;
  m.deadline = 8;
  e.chord = 1; e.nextHarmony = 8; e.rng = () => 0; // IV -> I
  e.sounding = [{ semi: 5, kind: 'bell', performer: 'a', at: 0, duration: 28, until: 28 + TAIL }];
  const event = e.makeEvent(m, 8);
  assert.equal(event.motion, 'suspension');
  assert.equal(Math.round(12 * Math.log2(event.notes[0].freq / 121)), 4);
  assert.equal(event.ending, false); // Finish the resolution before seeking an ending.
  assert.equal(m.resolution, null);
});

test('the leading tone resolves up a semitone when tonic harmony returns', () => {
  const e = make(); join(e, 'a', 81);
  const m = e.members.get('a');
  m.lastSemi = 11; m.lastKey = 0; m.lastChord = [7, 11, 2];
  e.sounding = [{ semi: 11, kind: 'bell', performer: 'a', at: 0, duration: 28, until: 28 + TAIL }];
  const event = e.makeEvent(m, 8);
  assert.equal(event.motion, 'leading-tone');
  assert.equal(Math.round(12 * Math.log2(event.notes[0].freq / 121)), 12);
  assert.equal(event.at, 8);
});

test('adding voices changes existing players while leaving already scheduled music intact', () => {
  const e = make(); join(e, 'a', 81);
  const first = advance(e, 0, 60).events;
  const committed = structuredClone(e.events);
  const originalPeriod = e.members.get('a').period;
  join(e, 'b', 217, 60); join(e, 'c', 876, 60);
  assert.deepEqual(e.events, committed);
  advance(e, 60.2, 240);
  const crowdedPeriod = e.members.get('a').period;
  assert.ok(crowdedPeriod > originalPeriod * 1.5);
  e.leave('b', 240); e.leave('c', 240);
  const after = advance(e, 240.2, 420).events;
  assert.ok(after.every(n => n.performer === 'a'));
  assert.ok(e.members.get('a').period < crowdedPeriod * 0.8);
  assert.ok(first.length > 2);
});

test('voices end individually and Infinite continues after Short voices finish', () => {
  const e = make();
  join(e, 'a', 81, 0, 'short');
  join(e, 'b', 217, 17, 'short');
  join(e, 'c', 876, 0, 'infinite');
  const { events, ended } = advance(e, 0, 500);
  const endings = events.filter(e => e.ending);
  assert.equal(endings.length, 2);
  assert.notEqual(endings[0].at, endings[1].at);
  assert.deepEqual(new Set(ended), new Set(['a', 'b']));
  assert.deepEqual([...e.members.keys()], ['c']);
  assert.ok(events.some(n => n.performer === 'c' && n.at > Math.max(...endings.map(n => n.at)) + 60));
  for (const ending of endings) assert.equal(events.filter(n => n.performer === ending.performer && n.at > ending.at).length, 0);
});

test('a long scheduler suspension skips missed notes instead of playing a burst', () => {
  const e = make(); join(e, 'a', 1); join(e, 'b', 2);
  advance(e, 0, 20);
  assert.equal(e.plan(900).events.length, 0);
  const later = advance(e, 900.2, 920).events;
  assert.ok(later.length > 0 && later.length < 8);
  assert.ok(later.every(n => n.at > 902));
});

test('scores include all voices, omit unheard future events, and retain a bounded timeline', () => {
  const e = make(); join(e, 'a', 1); join(e, 'b', 2);
  advance(e, 0, 3900);
  const snapshot = e.snapshot(3900);
  const score = validateScore(JSON.parse(JSON.stringify(snapshot)));
  assert.equal(score.events[0].time, 0);
  assert.ok(score.events.at(-1).time <= 1800);
  assert.deepEqual(new Set(score.events.map(n => n.performer)), new Set(['a', 'b']));
  assert.ok(e.events.length < 450);
  assert.equal(score.events.length, e.events.filter(n => n.at <= 3900).length);
  const future = e.events.find(n => n.at > 3900);
  if (future) {
    e.leave(future.performer, 3900);
    assert.ok(!e.events.some(n => n.id === future.id));
  }
});

test('score loading rejects unsafe resource sizes, versions, and synthesis values', () => {
  const e = make(); join(e, 'a', 1); advance(e, 0, 50);
  const valid = e.snapshot(50);
  for (const mutate of [
    s => s.version = 2,
    s => s.events = Array(600).fill(s.events[0]),
    s => s.events[0].time = -1,
    s => s.events[0].notes[0].freq = Infinity,
    s => s.events[0].notes[0].volume = 10,
    s => s.events[0].notes[0].duration = 100000,
    s => s.events[0].performer = '<script>',
    s => s.events[0].notes.push(...Array(10).fill(s.events[0].notes[0]))
  ]) {
    const copy = structuredClone(valid); mutate(copy);
    assert.throws(() => validateScore(copy), /supported/);
  }
  assert.deepEqual(validateScore(valid), validateScore(JSON.parse(JSON.stringify(valid))));
});

test('eight voices share the density ceiling; a ninth is rejected', () => {
  const e = make();
  for (let i = 0; i < 8; i++) join(e, `w${i}`, i + 4);
  assert.throws(() => join(e, 'extra', 42), /eight/);
  const events = advance(e, 0, 600).events;
  assert.equal(new Set(events.map(e => e.performer)).size, 8);
  assert.ok(events.every(e => events.filter(n => n.at > e.at - 60 && n.at <= e.at).length <= 15));
});

test('shared coordinator survives the first window, expires a frozen voice, and does not rejoin on ping', () => {
  let now = 0, tick, seed = 10;
  const sandbox = {
    self: {}, performance: { timeOrigin: 0, now: () => now * 1000 },
    crypto: { getRandomValues(a) { a[0] = seed++; return a; } }, Uint32Array,
    setInterval(fn) { tick = fn; }, console
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  sandbox.importScripts = () => vm.runInContext(fs.readFileSync(require.resolve('../modular-core.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../modular-worker.js'), 'utf8'), context);
  function connect() {
    const messages = [];
    const port = { postMessage(data) { messages.push(structuredClone(data)); }, start() {}, close() {} };
    sandbox.self.onconnect({ ports: [port] });
    return { messages, send(data) { port.onmessage({ data }); } };
  }
  const a = connect(), b = connect();
  a.send({ type: 'join', tone: 121, length: 'infinite' });
  b.send({ type: 'join', tone: 200, length: 'infinite' });
  assert.equal(b.messages.find(n => n.type === 'joined').tone, 121);
  a.send({ type: 'disconnect' });
  for (now = 0.2; now < 20; now += 0.2) { b.send({ type: 'ping' }); tick(); }
  assert.ok(b.messages.some(n => n.type === 'event' && n.event.performer === 'w2'));
  now = 30; tick();
  assert.ok(b.messages.some(n => n.type === 'left' && n.reason.includes('paused')));
  b.send({ type: 'ping' }); now = 32; tick();
  assert.equal(b.messages.filter(n => n.type === 'state').at(-1).members.length, 0);
  b.send({ type: 'join', tone: 200, length: 'infinite' });
  assert.equal(b.messages.filter(n => n.type === 'joined').at(-1).tone, 200);
});
