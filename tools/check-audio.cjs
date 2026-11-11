const assert = require('node:assert/strict');
const path = require('node:path');
const {render} = require('./render-study.cjs');
const checks = path.resolve(__dirname, '../checks');

(async () => {
  const short = await render({seed: '0393ded7', engine: '3', duration: 'short', tone: 200,
    filename: path.join(checks, 'preserved-short.wav')});
  assert.equal(short.pcmSha256, 'a259348dc27fb39ca87c047d36e23d848bd35e18fce689971f799f91bd68dafa');
  assert.equal(short.frames, 3773475);
  const first = await render({seed: '40dc1965', mode: 'probe', filename: path.join(checks, 'organ-first.wav')});
  const second = await render({seed: '40dc1965', mode: 'probe', filename: path.join(checks, 'organ-repeat.wav')});
  assert.equal(first.pcmSha256, second.pcmSha256);
  assert.ok(first.tailPeakFiveSecondsAfterDirectEnd > 1e-6);
  if (process.env.OPEN_RELEASE_BASELINE) {
    const baseline = await render({sourceFile: process.env.OPEN_RELEASE_BASELINE, seed: '40dc1965',
      mode: 'probe', filename: path.join(checks, 'organ-baseline.wav')});
    assert.equal(first.pcmSha256, baseline.pcmSha256);
  }
  console.log('Original Short Study PCM preserved; Long organ audio is repeatable and its room tail is intact.');
})().catch(error => { console.error(error); process.exitCode = 1; });
