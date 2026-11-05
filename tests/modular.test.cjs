const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Ensemble, validateScore, voiceLeadingWeight, MAX_ATTACKS, MAX_EVENTS, TAIL } = require('../modular-core.js');

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
function onPulse(event, member) {
  const pulse = (event.at - member.phase) / member.period;
  assert.ok(Math.abs(pulse - Math.round(pulse)) < 1e-6, `off pulse: ${event.performer}/${event.at}`);
}

test('independent voices keep steady, distinct pulses and different melodic contours', () => {
  const e = make();
  join(e, 'a', 81); join(e, 'b', 217);
  const { events } = advance(e, 0, 900);
  const voices = ['a', 'b'].map(id => events.filter(n => n.performer === id));
  assert.ok(voices.every(v => v.length > 15));
  const gaps = voices.map(v => v.slice(1).map((n, i) => n.at - v[i].at));
  assert.notDeepEqual(gaps[0], gaps[1]);
  assert.notEqual(e.members.get('a').period, e.members.get('b').period);
  for (const event of events) onPulse(event, e.members.get(event.performer));
  for (const [i, id] of ['a', 'b'].entries()) {
    const period = e.members.get(id).period;
    assert.ok(gaps[i].filter(g => Math.abs(g - period) < 1e-6).length > gaps[i].length * 0.8);
  }
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
            const resolving = ['leading-tone', 'suspension', 'passing', 'neighbor', 'passing-resolution', 'neighbor-resolution'].includes(event.motion) &&
              old.kind === 'bell' && old.performer === event.performer &&
              age >= Math.min(4, old.duration / 4) && Math.abs(semi - old.semi) <= 2;
            assert.ok(quiet || resolving, `unprepared prominent clash ${tone}/${seed} at ${event.at}`);
          }
        }
        sounding.push({ semi, until: event.at + note.duration + TAIL, at: event.at,
          duration: note.duration, kind: note.kind, performer: event.performer });
      }
      assert.ok(events.filter(n => n.at > event.at - 60 && n.at <= event.at).length <= MAX_ATTACKS);
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

test('joining and leaving changes harmony and production without changing any existing pulse', () => {
  const e = make(); join(e, 'a', 81);
  const first = advance(e, 0, 60).events;
  const committed = structuredClone(e.events);
  const a = e.members.get('a');
  const originalPeriod = a.period, originalPhase = a.phase;
  join(e, 'b', 217, 60); join(e, 'c', 876, 60);
  assert.deepEqual(e.events, committed);
  const together = advance(e, 60.2, 240).events;
  assert.equal(a.period, originalPeriod);
  assert.equal(a.phase, originalPhase);
  e.leave('b', 240); e.leave('c', 240);
  const after = advance(e, 240.2, 420).events;
  assert.ok(after.every(n => n.performer === 'a'));
  assert.equal(a.period, originalPeriod);
  assert.equal(a.phase, originalPhase);
  for (const event of [...first, ...together, ...after].filter(n => n.performer === 'a')) onPulse(event, a);
  assert.ok(first.length > 2);
});

test('each tempo and phase depend only on its own seed and start, not peers or length', () => {
  const solo = make(), ensemble = make(99);
  join(solo, 'a', 81, 17, 'short');
  join(ensemble, 'b', 217); join(ensemble, 'c', 876);
  join(ensemble, 'a', 81, 17, 'long');
  for (const key of ['period', 'phase', 'nextAt'])
    assert.equal(solo.members.get('a')[key], ensemble.members.get('a')[key]);
});

test('a harmonic rest skips pulses without delaying the following entries', () => {
  const e = make(); join(e, 'a', 81);
  const m = e.members.get('a');
  e.nextHarmony = Infinity;
  Object.assign(m, { lastSemi: 5, lastKey: 0, lastChord: [0, 4, 7],
    resolution: { type: 'neighbor-resolution', target: 4 } });
  e.sounding = [{ semi: 5, kind: 'bell', performer: 'other', at: m.phase,
    duration: 28, until: m.phase + 28 + TAIL }];
  const events = advance(e, 0, 80).events;
  assert.ok(events[0].at >= m.phase + 14);
  assert.equal(events[0].motion, 'neighbor-resolution');
  assert.ok(events.length > 3);
  for (const event of events) onPulse(event, m);
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
  const later = [...e.plan(900).events, ...advance(e, 900.2, 920).events];
  assert.ok(later.length > 0 && later.length < 8);
  assert.ok(later.every(n => n.at >= 900.25));
  for (const event of later) onPulse(event, e.members.get(event.performer));
});

test('scores include all voices, omit unheard future events, and retain a bounded timeline', () => {
  const e = make(); join(e, 'a', 1); join(e, 'b', 2);
  advance(e, 0, 3900);
  const snapshot = e.snapshot(3900);
  const score = validateScore(JSON.parse(JSON.stringify(snapshot)));
  assert.equal(score.events[0].time, 0);
  assert.ok(score.events.at(-1).time <= 1800);
  assert.deepEqual(new Set(score.events.map(n => n.performer)), new Set(['a', 'b']));
  assert.ok(e.events.length <= MAX_EVENTS);
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
    s => s.version = 99,
    s => s.events = Array(MAX_EVENTS + 1).fill(s.events[0]),
    s => s.events[0].time = -1,
    s => s.events[0].notes[0].freq = Infinity,
    s => s.events[0].notes[0].volume = 10,
    s => s.events[0].notes[0].duration = 100000,
    s => s.events[0].performer = '<script>',
    s => delete s.events[0].notes[0].production,
    s => s.events[0].notes[0].production.brightness = 1,
    s => s.events[0].notes[0].production.panStart = NaN,
    s => s.events[0].notes[0].production.panEnd = -5,
    s => s.events[0].notes.push(...Array(10).fill(s.events[0].notes[0]))
  ]) {
    const copy = structuredClone(valid); mutate(copy);
    assert.throws(() => validateScore(copy), /supported/);
  }
  assert.deepEqual(validateScore(valid), validateScore(JSON.parse(JSON.stringify(valid))));
});

test('passing and neighbor departures resolve by step on the next own entry, before ending', () => {
  for (const [choice, motion, departure, destination] of [
    [0.1, 'neighbor', 11, 12], [0.7, 'passing', 14, 16]
  ]) {
    const e = make(); join(e, 'a', 81);
    const m = e.members.get('a');
    Object.assign(m, { lastSemi: 12, lastKey: 0, lastChord: [0, 4, 7], lastHarmony: 0, step: 2, deadline: 15 });
    e.nextHarmony = Infinity;
    // Direction, contour size, ornament probability, then the ornament choice.
    const draws = [0.5, 0.5, 0, choice];
    m.rng = () => draws.length ? draws.shift() : 0.5;
    e.sounding = [{ semi: 12, kind: 'bell', performer: 'a', at: 0, duration: 28, until: 28 + TAIL }];
    const first = e.makeEvent(m, 8);
    assert.equal(first.motion, motion);
    assert.equal(Math.round(12 * Math.log2(first.notes[0].freq / 121)), departure);
    assert.equal(m.resolution.target, destination);
    e.nextHarmony = 9;
    e.harmony(10);
    assert.equal(e.chord, 0, 'hold the harmony while the departure resolves');
    const second = e.makeEvent(m, 18);
    assert.equal(second.motion, `${motion}-resolution`);
    assert.equal(Math.round(12 * Math.log2(second.notes[0].freq / 121)), destination);
    assert.equal(second.ending, false);
    assert.equal(m.resolution, null);
    assert.ok(m.ornamentAfter > m.step);
    assert.equal(e.makeEvent(m, 55).ending, true);
  }
});

test('new entries reserve the pending destination; a blocked resolution waits and survives', () => {
  const e = make(); join(e, 'a', 81); join(e, 'b', 217);
  e.nextHarmony = Infinity; // I: no new F neighbor may obscure a promised E.
  const m = e.members.get('a');
  Object.assign(m, { lastSemi: 5, lastKey: 0, lastChord: [0, 4, 7], resolution: { type: 'neighbor-resolution', target: 4 } });
  Object.assign(e.members.get('b'), { lastSemi: 4, lastKey: 0, lastChord: [0, 4, 7], lastHarmony: 0, step: 2, rng: () => 0 });
  const other = e.makeEvent(e.members.get('b'), 3);
  assert.notEqual(Math.round(12 * Math.log2(other.notes[0].freq / 121)) % 12, 5);
  e.chord = 0;
  e.sounding = [{ semi: 5, kind: 'bell', performer: 'b', at: 9, duration: 28, until: 37 + TAIL }];
  assert.equal(e.makeEvent(m, 10), null);
  assert.equal(m.resolution.target, 4);
  assert.equal(e.makeEvent(m, 25).motion, 'neighbor-resolution');
  e.leave('a', 26);
  assert.ok(![...e.members.values()].some(m => m.resolution));
});

test('production spreads strikes, gives bright peers darker answers, and shares level headroom', () => {
  const e = make(); join(e, 'a', 81); join(e, 'b', 217);
  const a = e.members.get('a'), b = e.members.get('b');
  a.mixRng = b.mixRng = () => 0.99;
  const first = e.makeEvent(a, 3).notes[0];
  const committed = structuredClone(first);
  const second = e.makeEvent(b, 4).notes[0];
  assert.ok(first.production.panStart < -0.4 && second.production.panStart > 0.4);
  assert.ok(first.production.brightness > 0.7 && second.production.brightness < 0.3);
  assert.ok(first.production.brightness + second.production.brightness <= 0.98 + 1e-9);
  assert.ok(first.volume < 0.4 / Math.sqrt(2) && second.volume < 0.4 / Math.sqrt(2));
  // Removing a bright owner still accounts for its fading intended tail.
  e.leave('a', 4.1);
  const oldPan = b.panCenter;
  const after = e.makeEvent(b, 5).notes[0];
  assert.ok(after.production.brightness < 0.4);
  assert.ok(after.volume < 0.4 / Math.sqrt(2));
  assert.ok(Math.abs(b.panCenter - oldPan) <= 0.18 + 1e-9);
  assert.deepEqual(first, committed, 'already planned strikes do not move');
});

test('version-3 production survives saving and version-1/2 scores retain their rendering contracts', () => {
  const e = make(); join(e, 'a', 81); advance(e, 0, 60);
  const current = e.snapshot(60);
  assert.equal(current.version, 3);
  const clean = validateScore(JSON.parse(JSON.stringify(current)));
  assert.deepEqual(clean.events.map(e => e.notes), current.events.map(e => e.notes));
  const version2 = structuredClone(current); version2.version = 2;
  assert.deepEqual(validateScore(version2).events, clean.events);
  const old = structuredClone(current); old.version = 1;
  old.events.forEach(e => e.notes.forEach(n => delete n.production));
  const legacy = validateScore(old);
  assert.equal(legacy.version, 1);
  assert.ok(legacy.events.every(e => e.notes.every(n => !('production' in n))));
});

test('eight steady voices fit score limits without the old ensemble slowdown; a ninth is rejected', () => {
  const e = make();
  for (let i = 0; i < 8; i++) join(e, `w${i}`, i + 4);
  assert.throws(() => join(e, 'extra', 42), /eight/);
  const events = advance(e, 0, 1800).events;
  assert.equal(new Set(events.map(e => e.performer)).size, 8);
  const densities = events.map(e => events.filter(n => n.at > e.at - 60 && n.at <= e.at).length);
  assert.ok(Math.max(...densities) > 15);
  assert.ok(Math.max(...densities) <= MAX_ATTACKS);
  for (const event of events) onPulse(event, e.members.get(event.performer));
  const snapshot = e.snapshot(1800);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 2 * 1024 * 1024);
  assert.equal(validateScore(snapshot).events.length, snapshot.events.length);
  assert.throws(() => validateScore({ ...snapshot, version: 2 }), /supported/);
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
