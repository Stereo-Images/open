// Descriptive coverage audit, not a listening-quality score or seed filter.
const assert = require('node:assert/strict');
const {harness} = require('../tests/support/harness.cjs');
const {api} = harness();
const seeds = [0x08c1db04, 0x0393ded7, 0x08b0195e, 0x0b086950];
let state = 0x4f50454e;
while (seeds.length < 128) {
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  seeds.push(state >>> 0);
}
const roots = [110, 121, 165, 200], results = [];
for (const duration of ['short', 'long']) {
  let strikes = 0, changed = 0, affectedScores = 0, maxPairGap = 0;
  for (const seed of seeds) for (const tone of roots) {
    const score = api.createPerformance(seed, tone, duration, duration === 'short' ? '21' : '30');
    let affected = false;
    for (const note of score.groups.flatMap(g => g.notes).filter(n => n.kind === 'bell')) {
      strikes++;
      const refined = api.refineBellFM(note);
      if (refined === note) continue;
      changed++; affected = true;
      for (const voice of refined.voices.filter(v => v.amp / refined.totalAmp >= 0.10)) {
        const gap = Math.abs(refined.freq * voice.modRatio - 2 * voice.frequency);
        assert.ok(gap <= 6 + 1e-10);
        assert.ok(voice.modIndex / voice.modRatio <= 1.2 + 1e-10);
        maxPairGap = Math.max(maxPairGap, gap);
      }
    }
    affectedScores += affected;
  }
  results.push({duration, scores: seeds.length * roots.length, strikes, changed,
    percentChanged: 100 * changed / strikes, affectedScores, maxPairGap});
}
console.log(JSON.stringify({seedCount: seeds.length, roots, results}, null, 2));
