const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Ensemble, validateScore, melodicTarget, random, voiceLeadingWeight, overlapWeight, CHORDS,
  MIN_BPM, MAX_BPM, MAX_ATTACKS, MAX_EVENTS, TAIL, ALIGNMENT_WINDOW, ALIGNMENT_COOLDOWN } = require('../modular-core.js');

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

function fixedVoice(e, id, { seed = 81, period = 6, phase = 10, semi = 0 } = {}) {
  join(e, id, seed);
  const m = e.members.get(id);
  Object.assign(m, { period, phase, nextAt: phase, pulse: 0, lastSemi: semi, step: 2,
    lastKey: 0, lastHarmony: 0, lastChord: [0, 4, 7], cadence: [6, 2] });
  m.melodyRng = () => id === 'b' ? 0.9 : 0.1;
  return m;
}

test('a lone voice holds one pitch indefinitely while FM seeds and production keep evolving', () => {
  const e = make(); join(e, 'a', 81);
  const events = advance(e, 0, 3600).events;
  assert.ok(events.length > 100);
  assert.equal(new Set(events.map(n => n.notes[0].freq)).size, 1);
  assert.equal(new Set(events.map(n => `${n.harmony}/${n.key}`)).size, 1);
  assert.equal(e.harmonySerial, 0);
  assert.ok(events.every(n => !n.alignment && n.notes.length === 1));
  assert.ok(new Set(events.map(n => n.seed)).size > 50);
  assert.ok(new Set(events.map(n => n.notes[0].production.brightness)).size > 50);
});

test('elapsed time alone cannot change notes or harmony when two pulse grids never meet', () => {
  const e = make(); e.chord = 0;
  fixedVoice(e, 'a', { phase: 3, semi: 0 });
  fixedVoice(e, 'b', { phase: 4.5, semi: 7 });
  const events = advance(e, 0, 3600).events;
  for (const id of ['a', 'b']) assert.equal(new Set(events.filter(n => n.performer === id).map(n => n.notes[0].freq)).size, 1);
  assert.equal(e.harmonySerial, 0);
  assert.ok(events.every(n => n.motion === 'hold' && n.harmony === 'I' && n.key === 0));
});

test('the 120 ms tolerance includes a meeting across the scheduling horizon without moving either strike', () => {
  for (const offset of [0.119, 0.121]) {
    const e = make(); e.chord = 0; e.rng = () => 0;
    const a = fixedVoice(e, 'a');
    const b = fixedVoice(e, 'b', { phase: 10 + offset, semi: 7 });
    const first = e.plan(7.5, 10).events;
    if (offset < ALIGNMENT_WINDOW) {
      assert.deepEqual(first.map(n => n.at), [10, 10 + offset]);
      assert.equal(e.harmonySerial, 1);
      assert.ok(first.every(n => n.alignment?.performers.length === 2));
    } else {
      assert.deepEqual(first.map(n => n.at), [10]);
      e.plan(7.7, 10.2);
      assert.equal(e.harmonySerial, 0);
    }
    for (const n of e.events) onPulse(n, n.performer === 'a' ? a : b);
    assert.equal(a.phase, 10); assert.equal(b.phase, 10 + offset);
    assert.equal(a.period, 6); assert.equal(b.period, 6);
  }
});

test('only voices in the meeting may change pitch; another active voice holds its note', () => {
  const e = make(); e.chord = 0; e.rng = () => 0;
  fixedVoice(e, 'a'); fixedVoice(e, 'b', { phase: 10.08, semi: 7 });
  fixedVoice(e, 'c', { phase: 12.5, period: 11, semi: 12 });
  const events = advance(e, 7.5, 20).events;
  assert.ok(events.some(n => n.motion === 'alignment'));
  const third = events.filter(n => n.performer === 'c');
  assert.ok(third.length);
  assert.ok(third.every(n => n.notes[0].freq === 242 && !n.alignment));
});

test('a sustained alignment counts once until the voices separate and encounter one another again', () => {
  const e = make(); e.chord = 0; e.rng = () => 0;
  fixedVoice(e, 'a'); fixedVoice(e, 'b', { phase: 10.08, semi: 7 });
  const events = advance(e, 7.5, 180).events;
  assert.equal(e.harmonySerial, 1);
  assert.ok(events.filter(n => n.at > 10.12).every(n => n.motion === 'hold' && !n.alignment));
  const drifting = make(); drifting.chord = 0; drifting.rng = () => 0;
  fixedVoice(drifting, 'a'); fixedVoice(drifting, 'b', { phase: 10.08, period: 6.04, semi: 7 });
  advance(drifting, 7.5, 1800);
  assert.ok(drifting.harmonySerial >= 2, 'the pair must re-arm after drifting apart');
});

test('a fresh meeting inside the cooldown holds all pitches and does not create a timed retry', () => {
  const e = make(); e.chord = 0; e.rng = () => 0;
  fixedVoice(e, 'a'); fixedVoice(e, 'b', { phase: 10.05, semi: 7 });
  fixedVoice(e, 'c', { phase: 15.99, period: 13, semi: 12 });
  const events = advance(e, 7.5, 32).events;
  const changes = events.filter(n => n.alignment);
  assert.ok(changes.length >= 2);
  assert.ok(changes.every(n => n.at < 10.12));
  assert.ok(events.filter(n => n.at > 10.12).every(n => n.motion === 'hold'));
  assert.ok(e.nextAlignmentChange >= 10 + ALIGNMENT_COOLDOWN);
});

test('a pulse skipped by the attack limit cannot supply a phantom synchronization partner', () => {
  const e = make(); e.chord = 0;
  fixedVoice(e, 'a'); fixedVoice(e, 'b', { phase: 10.05, semi: 7 });
  e.attacks = Array.from({ length: MAX_ATTACKS - 1 }, () => ({ at: 1, performer: 'old' }));
  const events = e.plan(7.5, 10).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].motion, 'hold');
  assert.equal(e.harmonySerial, 0);
});

test('removing a partner before an encounter leaves the remaining pitch and harmony fixed', () => {
  const e = make(); e.chord = 0;
  fixedVoice(e, 'a'); fixedVoice(e, 'b', { phase: 10.05, semi: 7 });
  e.leave('b', 7);
  const events = advance(e, 7.5, 120).events;
  assert.ok(events.every(n => n.performer === 'a' && n.notes[0].freq === 121 && !n.alignment));
  assert.equal(e.harmonySerial, 0);
});

test('a blocked voicing stays held after the obstruction fades, with no delayed timer-based change', () => {
  const e = make(); e.chord = 0; e.rng = () => 0;
  fixedVoice(e, 'a'); fixedVoice(e, 'b', { phase: 10.05, semi: 7 });
  e.sounding = Array.from({ length: 37 }, (_, i) => ({ semi: i - 12, at: 0,
    kind: 'bell', performer: 'old', duration: 40, until: 50 }));
  const events = advance(e, 7.5, 100).events;
  assert.equal(e.harmonySerial, 0);
  assert.ok(events.length > 20);
  assert.ok(events.every(n => n.motion === 'hold' && !n.alignment));
});

test('a missed meeting during a scheduler stall does not change pitches on resumption', () => {
  const e = make(); e.chord = 0;
  fixedVoice(e, 'a'); fixedVoice(e, 'b', { phase: 10.05, period: 6.3, semi: 7 });
  const events = advance(e, 11, 30).events;
  assert.ok(events.length > 2);
  assert.ok(events.every(n => n.at >= 16 && n.motion === 'hold'));
  assert.equal(e.harmonySerial, 0);
});

test('timed voices end on their held pitch without requiring a meeting or adding a final cadence', () => {
  const e = make(); join(e, 'a', 81, 0, 'short');
  const events = advance(e, 0, 150).events;
  assert.equal(events.filter(n => n.ending).length, 1);
  assert.equal(new Set(events.map(n => n.notes[0].freq)).size, 1);
  assert.equal(events.at(-1).notes[0].duration, 25);
  assert.equal(e.members.size, 0);
});

test('every changed pitch, harmonic context, and bass entry has real coincident strikes across seeded runs', () => {
  let changes = 0, basses = 0;
  for (const tone of [110, 121, 200]) for (const count of [2, 3, 8]) {
    const e = make(42, tone);
    for (let i = 0; i < count; i++) join(e, `w${i}`, 81 + i * 136);
    const events = advance(e, 0, 1800).events, last = new Map();
    let context;
    for (const event of events) {
      onPulse(event, e.members.get(event.performer));
      const changed = last.has(event.performer) && last.get(event.performer) !== event.notes[0].freq;
      const nextContext = `${event.harmony}/${event.key}`;
      if (changed || (context && context !== nextContext) || event.notes[1]) {
        assert.ok(event.alignment, 'no musical change without a real meeting');
        assert.ok(events.some(peer => peer !== event && peer.performer !== event.performer &&
          peer.alignment?.id === event.alignment.id && Math.abs(peer.at - event.at) <= ALIGNMENT_WINDOW + 1e-7));
      }
      if (changed) changes++;
      if (event.notes[1]) { basses++; assert.ok(event.notes[1].freq <= event.notes[0].freq); }
      last.set(event.performer, event.notes[0].freq);
      context = nextContext;
    }
  }
  assert.ok(changes > 30);
  assert.ok(basses > 0);
});

test('different scheduler polling intervals produce the same meetings and recorded notes', () => {
  const run = step => {
    const e = make(); join(e, 'a', 81); join(e, 'b', 217); join(e, 'c', 353);
    return advance(e, 0, 900, step).events.filter(n => n.at <= 900);
  };
  assert.deepEqual(run(0.1), run(0.2));
});

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

test('prominent overlaps protect other voices while allowing own steps and spaced scale sevenths', () => {
  for (const tone of [110, 121, 200]) for (const seed of [1, 42, 54325756, 0xffffffff]) {
    const e = make(seed, tone);
    join(e, 'a', seed ^ 100); join(e, 'b', seed ^ 200); join(e, 'c', seed ^ 300);
    const { events } = advance(e, 0, 1800);
    assert.ok(events.length > 60, `too much silence: ${tone}/${seed}`);
    const sounding = [];
    const previous = new Map();
    for (const event of events) {
      for (const note of event.notes) {
        assert.ok(note.freq >= (note.kind === 'bell' ? 110 : 87.31) && note.freq <= 415.3);
        const semi = Math.round(12 * Math.log2(note.freq / tone));
        for (const old of sounding.filter(n => n.until > event.at)) {
          const interval = ((semi - old.semi) % 12 + 12) % 12;
          if ([1, 6, 11].includes(interval)) {
            const age = event.at - old.at;
            const quiet = age >= old.duration * (old.kind === 'bell' ? 0.5 : 1);
            const ownStep = note.kind === 'bell' && old.kind === 'bell' && old.performer === event.performer &&
              old.semi === previous.get(event.performer) &&
              age >= Math.min(4, old.duration / 4) && Math.abs(semi - old.semi) <= 2;
            const chord = CHORDS.find(c => c.name === event.harmony).tones.map(n => (n + event.key) % 12);
            const chordColor = chord.length === 4 && chord.includes((semi % 12 + 12) % 12) &&
              chord.includes((old.semi % 12 + 12) % 12) && (interval === 6 || Math.abs(semi - old.semi) >= 11);
            const scale = [...new Set([...chord, ...[0, 2, 4, 5, 7, 9, 11].map(n => (n + event.key) % 12)])];
            const spacedSeventh = interval !== 6 && Math.abs(semi - old.semi) >= 11 &&
              scale.includes((semi % 12 + 12) % 12) && scale.includes((old.semi % 12 + 12) % 12);
            assert.ok(quiet || ownStep || chordColor || spacedSeventh, `unprepared prominent clash ${tone}/${seed} at ${event.at}`);
          }
        }
        sounding.push({ semi, until: event.at + note.duration + TAIL, at: event.at,
          duration: note.duration, kind: note.kind, performer: event.performer });
      }
      previous.set(event.performer, Math.round(12 * Math.log2(event.notes[0].freq / tone)));
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

test('joining and leaving preserves existing pitches and pulses while production adapts', () => {
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
  assert.ok(later.length > 0 && later.length <= 16);
  assert.ok(later.every(n => n.at >= 900.25));
  for (const event of later) onPulse(event, e.members.get(event.performer));
  for (const id of ['a', 'b']) {
    const own = later.filter(e => e.performer === id);
    assert.ok(own.slice(1).every((event, i) => event.at - own[i].at >= e.members.get(id).period - 1e-6));
  }
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

test('version-4 production survives saving and version-1/2/3 scores retain their rendering contracts', () => {
  const e = make(); join(e, 'a', 81); advance(e, 0, 60);
  const current = e.snapshot(60);
  assert.equal(current.version, 4);
  const clean = validateScore(JSON.parse(JSON.stringify(current)));
  assert.deepEqual(clean.events.map(e => e.notes), current.events.map(e => e.notes));
  for (const version of [2, 3]) {
    const legacy = { ...structuredClone(current), version, events: structuredClone(current.events.slice(0, 3)) };
    assert.deepEqual(validateScore(legacy).events, clean.events.slice(0, 3));
  }
  const old = structuredClone(current); old.version = 1; old.events = old.events.slice(0, 3);
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
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 4 * 1024 * 1024);
  assert.equal(validateScore(snapshot).events.length, snapshot.events.length);
  assert.throws(() => validateScore({ ...snapshot, version: 2 }), /supported/);
});

test('the wider independent tempo range retains slow voices and reaches twenty BPM', () => {
  assert.equal(MAX_BPM, 20);
  const bpms = [];
  for (let seed = 0; seed < 128; seed++) {
    const e = make(); join(e, 'a', seed);
    bpms.push(e.state().members[0].bpm);
  }
  assert.ok(bpms.every(n => n >= MIN_BPM && n <= 20));
  assert.ok(Math.min(...bpms) < 4.5);
  assert.ok(Math.max(...bpms) > 19.5);
  assert.ok(bpms.filter(n => n > 12).length > 40);
});

test('major sevenths and dominant tritones are intentional colors, with no adjacent-semitone shortcut', () => {
  const old = semi => [{ semi, at: 0, duration: 28, kind: 'bell', performer: 'other' }];
  const m = { id: 'a', lastSemi: null };
  assert.ok(overlapWeight(11, old(0), 1, m, null, [0, 4, 7, 11]) > 0);
  assert.equal(overlapWeight(12, old(11), 1, m, null, [0, 4, 7, 11]), 0);
  assert.ok(overlapWeight(24, old(11), 1, m, null, [0, 4, 7, 11]) > 0);
  assert.ok(overlapWeight(11, old(5), 1, m, null, [7, 11, 2, 5]) > 0);
  assert.equal(overlapWeight(6, old(0), 1, m, null, [0, 4, 7, 11]), 0);
  assert.equal(overlapWeight(11, old(0), 1, m, null, [0, 4, 7]), 0);
});

test('melodic proposals use their own randomness and turn away from register edges', () => {
  for (const lastSemi of [0, 20]) {
    const a = { step: 2, lastSemi, melodyRng: random(8) };
    const b = { ...a, melodyRng: random(8), rng: () => 0.99, peerPitches: new Map([['peer', 5]]) };
    const notes = Array.from({ length: 100 }, () => melodicTarget(a, 121, 0, 220));
    assert.deepEqual(notes, Array.from({ length: 100 }, () => melodicTarget(b, 121, 0, 220)));
    const inward = notes.filter(n => lastSemi === 0 ? n > lastSemi : n < lastSemi);
    assert.ok(inward.length > 70);
  }
});

test('selective overlap ignores faded tails and permits own steps, without exposing another voice to a close clash', () => {
  const m = { id: 'a', lastSemi: 4 };
  const old = { semi: 4, kind: 'bell', performer: 'b', at: 0, duration: 20 };
  assert.equal(overlapWeight(5, [old], 3, m, null, [0, 4, 7]), 0);
  assert.equal(overlapWeight(5, [old], 10, m, null, [0, 4, 7]), 1);
  assert.ok(overlapWeight(5, [{ ...old, performer: 'a' }], 5, m, null, [0, 4, 7]) > 0);
  const scale = [0, 2, 4, 5, 7, 9, 11];
  assert.ok(overlapWeight(11, [{ ...old, semi: 0 }], 1, m, null, [0, 4, 7], scale) > 0);
  assert.equal(overlapWeight(12, [{ ...old, semi: 11 }], 1, m, null, [0, 4, 7], scale), 0);
});

test('an inversion cannot put the bass above a held melody note', () => {
  const e = make(); e.lastBassSemi = 4;
  for (let i = 0; i < 30; i++) {
    const bass = e.chooseBass([0, 4, 7, 11], [{ semi: 0 }]);
    assert.ok(bass !== null && bass <= 0);
  }
});

test('faster voices use shorter decays and lower levels, while saved events retain their values', () => {
  const slow = make(), fast = make(); join(slow, 'a', 81); join(fast, 'a', 81);
  slow.members.get('a').period = 15; fast.members.get('a').period = 3;
  const a = slow.makeEvent(slow.members.get('a'), 3).notes[0];
  const b = fast.makeEvent(fast.members.get('a'), 3).notes[0];
  assert.ok(a.duration >= 18 && b.duration === 9);
  assert.ok(b.volume < a.volume);
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
