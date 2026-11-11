const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {harness} = require('./support/harness.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const withoutFM = value => JSON.parse(JSON.stringify(value, (key, v) =>
  ['modRatio', 'modIndex', 'terminalModIndex'].includes(key) ? undefined : v));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10,
  `${actual} differs from ${expected}`);

test('every retained replay version matches the player before FM refinement', t => {
  if (!process.env.OPEN_FM_BASELINE) return t.skip('Set OPEN_FM_BASELINE for the historical comparison');
  const before = harness(fs.readFileSync(process.env.OPEN_FM_BASELINE, 'utf8')).api;
  const after = harness().api;
  for (const engine of ['1', ...Array.from({length: 30}, (_, i) => String(i + 3))]) {
    for (const seed of [0x0393ded7, 0x08c1db04]) for (const tone of [121, 200]) {
      for (const duration of ['short', 'long']) {
        if (duration === 'short' && ['4', '5', '31', '32'].includes(engine)) continue;
        const original = before.createPerformance(seed, tone, duration, engine);
        assert.deepEqual(plain(after.createPerformance(seed, tone, duration, engine)), plain(original));
        const refined = after.createPerformance(seed, tone, duration, '33', engine);
        assert.deepEqual(withoutFM(refined), withoutFM(original));
        const oldNotes = original.groups.flatMap(g => g.notes);
        refined.groups.flatMap(g => g.notes).forEach((note, i) => {
          if (!note.voices?.some(v => v.terminalModIndex !== undefined))
            assert.deepEqual(plain(note), plain(oldNotes[i]), 'Every untouched strike retains its full original recipe');
        });
      }
    }
  }
});

test('the original Short Study remains unchanged even when the selective rule is requested', () => {
  const {api} = harness();
  assert.deepEqual(plain(api.createPerformance(0x0393ded7, 200, 'short', '33', '3')),
    plain(api.createPerformance(0x0393ded7, 200, 'short', '3')));
});

test('older-score variations retain their base through links, exports and one-click replay', async () => {
  const h = harness();
  h.sandbox.document.dispatch('DOMContentLoaded');
  const settings = {seed: 0x08c1db04, tone: 121, duration: 'long', engine: '33', baseEngine: '21', sampleRate: 44100};
  const expected = h.api.createPerformance(settings.seed, settings.tone, settings.duration, '33', '21');
  const link = h.api.replayLink(settings);
  assert.deepEqual(plain(h.api.parseReplayInput(link)), settings);
  h.elements.get('replayInput').value = link;
  await h.api.replayFromUI();
  let snapshot = h.api.state().snapshot;
  assert.equal(snapshot.baseEngine, '21');
  assert.deepEqual(plain(snapshot.groups), plain(expected.groups));
  const pending = h.api.renderWavExport();
  h.contexts[1].resolve({length: 1, numberOfChannels: 2, sampleRate: 44100,
    getChannelData: () => new Float32Array(1), copyFromChannel: a => a.fill(0)});
  await pending;
  const filename = h.downloads[0];
  assert.match(filename, /-g33-b21-121hz-long-44100sr-/);
  assert.deepEqual(plain(h.api.parseReplayInput(filename)), settings);
  await h.api.replayLastPerformance();
  snapshot = h.api.state().snapshot;
  assert.equal(snapshot.baseEngine, '21');
  assert.deepEqual(plain(snapshot.groups), plain(expected.groups));
  h.sandbox.__OPEN_PLAYER_KILL__();
});

test('invalid or recursive original-recipe settings cannot be replayed', () => {
  const {api} = harness();
  const settings = {seed: 0x0393ded7, tone: 200, duration: 'short', engine: '33', sampleRate: 44100};
  const link = api.replayLink(settings);
  for (const suffix of ['&base=', '&base=2', '&base=33', '&base=999', '&base=31', '&base=21&base=3'])
    assert.throws(() => api.parseReplayInput(link + suffix));
  assert.throws(() => api.parseReplayInput(link.replace('engine=33', 'engine=3') + '&base=21'));
  for (const base of ['33', '2', '31']) assert.throws(() => api.createPerformance(settings.seed, 200, 'short', '33', base));
  assert.throws(() => api.createPerformance(settings.seed, 200, 'short', '3', '21'));
});

test('the troublesome 1:00 bell reproduces approved E parameters without changing its envelope or carrier layers', () => {
  const {api} = harness();
  const note = api.createPerformance(0x08c1db04, 121, 'long', '21')
    .groups.flatMap(g => g.notes).filter(n => n.kind === 'bell')[7];
  near(note.time, 59.802327696464054);
  const saved = plain(note), refined = api.refineBellFM(note);
  assert.notEqual(refined, note);
  assert.deepEqual(plain(note), saved);
  assert.deepEqual(withoutFM(refined), withoutFM(note));
  const expectedIndices = [2.4969521793938534, 2.376, 1.2283347105549047];
  refined.voices.forEach((voice, i) => {
    near(voice.modRatio, 1.98);
    near(voice.modIndex, expectedIndices[i]);
    near(voice.terminalModIndex, 0.010783225926300015);
  });
  near(Math.abs(refined.freq * refined.voices[1].modRatio - 2 * refined.voices[1].frequency), 3.487997064260294);
  assert.equal(api.refineBellFM(refined), refined, 'Refinement is idempotent');
});

test('the rule leaves unrelated, shallow, faint and widely detuned cases alone', () => {
  const {api} = harness();
  const bell = {kind: 'bell', freq: 150, totalAmp: 1, voices: [
    {frequency: 150, amp: 0.7, modRatio: 1.85, modIndex: 4},
    {frequency: 151, amp: 0.3, modRatio: 1.85, modIndex: 2}
  ]};
  const cases = [
    {kind: 'bass', freq: 150},
    {...bell, voices: bell.voices.map(v => ({...v, modRatio: 3}))},
    {...bell, voices: bell.voices.map(v => ({...v, modIndex: 1}))},
    {...bell, voices: [{...bell.voices[0], amp: 0.1}, {...bell.voices[1], amp: 0.9}]},
    {...bell, voices: [bell.voices[0], {...bell.voices[1], frequency: 157}]}
  ];
  for (const note of cases) assert.equal(api.refineBellFM(note), note);
  assert.notEqual(api.refineBellFM(bell), bell);
});

test('new Short and Long plans change only selected FM parameters and replay deterministically', () => {
  const {api} = harness();
  let affected = 0, untouched = 0;
  for (const seed of [0x08c1db04, 0x0393ded7, 0x08b0195e, 0x0b086950]) {
    for (const tone of [110, 121, 165, 200]) for (const duration of ['short', 'long']) {
      const before = api.createPerformance(seed, tone, duration, duration === 'short' ? '21' : '30');
      const after = api.createPerformance(seed, tone, duration);
      assert.deepEqual(withoutFM(after), withoutFM(before));
      const oldNotes = before.groups.flatMap(g => g.notes);
      after.groups.flatMap(g => g.notes).forEach((note, i) => {
        assert.ok(Object.isFrozen(note));
        if (!note.voices?.some(v => v.terminalModIndex !== undefined)) {
          assert.deepEqual(plain(note), plain(oldNotes[i])); untouched++; return;
        }
        affected++;
        assert.ok(Object.isFrozen(note.voices));
        note.voices.forEach((voice, j) => {
          assert.ok(Object.isFrozen(voice));
          near(voice.terminalModIndex / voice.modRatio, 0.01 / oldNotes[i].voices[j].modRatio);
          if (voice.amp / note.totalAmp < 0.10) return;
          assert.ok(Math.abs(note.freq * voice.modRatio - 2 * voice.frequency) <= 6 + 1e-10);
          assert.ok(voice.modIndex / voice.modRatio <= 1.2 + 1e-10);
        });
      });
      const record = {seed, tone, duration, engine: '33', sampleRate: 44100};
      const replay = api.parseReplayInput(api.replayLink(record));
      assert.deepEqual(plain(replay), record);
      assert.deepEqual(plain(api.createPerformance(replay.seed, replay.tone, replay.duration, replay.engine)), plain(after));
    }
  }
  assert.ok(affected > 0 && untouched > affected);
});

test('synthesis uses the refined FM endpoint and preserves the original fallback', () => {
  const h = harness(); h.api.setup();
  const note = h.api.createPerformance(0x08c1db04, 121, 'long', '21')
    .groups.flatMap(g => g.notes).filter(n => n.kind === 'bell')[7];
  const ctx = h.contexts[0];
  for (const planned of [note, h.api.refineBellFM(note)]) {
    const start = ctx.nodes.length;
    h.api.scheduleNote(ctx, ctx.destination, ctx.destination, planned.freq, 1, planned.duration, planned.volume, 0, 0, planned);
    const mods = ctx.nodes.slice(start).filter(n => n.kind === 'gain' && n.gain.events[0]?.[1] > 1);
    assert.equal(mods.length, planned.voices.length);
    mods.forEach((n, i) => {
      near(n.gain.events[1][1], planned.freq * (planned.voices[i].terminalModIndex ?? 0.01));
      near(n.gain.events[1][2], 1 + planned.duration * 0.3);
    });
  }
  h.sandbox.__OPEN_PLAYER_KILL__();
});
