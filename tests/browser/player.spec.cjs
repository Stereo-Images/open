const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    crypto.getRandomValues = array => { array[0] = 12345; return array; };
    window.audioProbe = { contexts: [], workers: 0, recorders: [], edges: [] };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      window.audioProbe.edges.push({ source: this, destination });
      return connect.call(this, destination, ...args);
    };
    const OriginalContext = window.AudioContext;
    window.AudioContext = new Proxy(OriginalContext, {
      construct(Target, args) {
        const ctx = new Target(...args);
        window.audioProbe.contexts.push(ctx);
        return ctx;
      }
    });
    const OriginalWorker = window.Worker;
    window.Worker = new Proxy(OriginalWorker, {
      construct(Target, args) {
        window.audioProbe.workers++;
        return new Target(...args);
      }
    });
    if (window.MediaRecorder) window.MediaRecorder = new Proxy(window.MediaRecorder, {
      construct(Target, args) {
        const recorder = new Target(...args);
        window.audioProbe.recorders.push(recorder);
        return recorder;
      }
    });
  });
});

test('a blocked pop-up opens the player in the current tab', async ({ page }) => {
  await page.addInitScript(() => { window.open = () => null; });
  await page.goto('/index.html');
  await page.locator('#launchPlayer').click();
  await expect(page).toHaveURL(/\/player\.html$/);
  await expect(page.locator('#playNow')).toBeVisible();
});

test('an allowed pop-up preserves the separate player window', async ({ page }) => {
  await page.goto('/index.html');
  const opened = page.waitForEvent('popup');
  await page.locator('#launchPlayer').click();
  const player = await opened;
  await expect(player.locator('#playNow')).toBeVisible();
  await expect(page).toHaveURL(/\/index\.html$/);
  await player.close();
});

test('the tone dial has visible keyboard focus and native keyboard adjustment', async ({ page }) => {
  await page.goto('/player.html');
  await page.locator('#songDuration').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#tone')).toBeFocused();
  await expect(page.locator('.tone-dial-face')).toHaveCSS('outline-style', 'solid');
  await expect(page.locator('.tone-dial-face')).toHaveCSS('outline-width', '3px');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#tone')).toHaveValue('111');
  await expect(page.locator('#hzReadout')).toHaveText('111');
  await expect(page.locator('#tone')).toHaveAttribute('aria-valuetext', '111 hertz');
  await page.keyboard.press('End');
  await expect(page.locator('#tone')).toHaveValue('200');
  await page.keyboard.press('Home');
  await expect(page.locator('#tone')).toHaveValue('110');
});

test('dial pointer dragging preserves its value on press and persists after release', async ({ page }) => {
  await page.goto('/player.html');
  const box = await page.locator('#tone').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(page.locator('#tone')).toHaveValue('110');
  await page.mouse.move(x, y - 40, { steps: 5 });
  await expect(page.locator('#tone')).toHaveValue('130');
  await page.mouse.up();
  await expect(page.locator('#hzReadout')).toHaveText('130');
  await page.reload();
  await expect(page.locator('#tone')).toHaveValue('130');
  await expect(page.locator('#toneDial')).toHaveCSS('--tone-angle', '-75deg');
});

test('dial touch target and lower divider fit a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/player.html');
  await expect(page.locator('#tone')).toHaveCSS('touch-action', 'none');
  const dial = await page.locator('#tone').boundingBox();
  expect(dial.width).toBe(88);
  expect(dial.height).toBe(88);
  const dimensions = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth, viewport: innerWidth,
    title: document.getElementById('playerTitle').getBoundingClientRect().width,
    footer: document.getElementById('credits').getBoundingClientRect().width
  }));
  expect(dimensions.page).toBe(dimensions.viewport);
  expect(dimensions.footer).toBe(dimensions.title);
  await expect(page.locator('#credits')).toHaveCSS('border-top-width', '1px');
  await page.locator('#playNow').click();
  await expect(page.locator('#tone')).toBeDisabled();
  await expect(page.locator('#tone')).toHaveCSS('touch-action', 'auto');
  await page.locator('#stop').click();
  await expect(page.locator('#tone')).toBeEnabled();
});

test('native audio and recording survive immediate Stop → Play', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/player.html');
  await page.locator('#playNow').click();
  await expect(page.locator('#playNow'), await page.locator('#playerStatus').textContent()).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    document.getElementById('stop').click();
    document.getElementById('playNow').click();
  });
  await page.waitForFunction(() => audioProbe.contexts[0].currentTime > 0.3);
  expect(await page.evaluate(() => document.getElementById('open-airplay-bridge').srcObject.active)).toBe(true);
  await page.keyboard.press('Shift+R');
  await expect(page.locator('#playerStatus')).toHaveText('Recording started');
  const recordingStartedAt = await page.evaluate(() => audioProbe.contexts[0].currentTime);
  await page.waitForFunction(start => audioProbe.contexts[0].currentTime > start + 1, recordingStartedAt);
  const downloading = page.waitForEvent('download');
  await page.keyboard.press('Shift+R');
  const download = await downloading;
  const mime = await page.evaluate(() => audioProbe.recorders[0].mimeType);
  const extension = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
  expect(download.suggestedFilename().endsWith('.' + extension)).toBe(true);
  const recorded = await fs.readFile(await download.path());
  expect(recorded.length).toBeGreaterThan(1000);
  // Decode the actual recording to verify there is sound, not just valid metadata.
  const peak = await page.evaluate(async bytes => {
    const decoded = await audioProbe.contexts[0].decodeAudioData(Uint8Array.from(bytes).buffer);
    let max = 0;
    for (const value of decoded.getChannelData(0)) max = Math.max(max, Math.abs(value));
    return max;
  }, Array.from(recorded));
  expect(peak).toBeGreaterThan(0.0001);
  await page.locator('#stop').click();
  await page.waitForFunction(() => document.getElementById('open-airplay-bridge').srcObject === null);
  expect(errors).toEqual([]);
});

test('real WAV rendering and worker encoding allow playback interaction', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // Slow worker acknowledgements to exercise interaction during encoding reliably.
  // All DSP, PCM conversion, transfers, and the resulting download remain native.
  const worker = await fs.readFile(path.join(__dirname, '../../wav-worker.js'), 'utf8');
  await page.route('**/wav-worker.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `const send = self.postMessage.bind(self);
      self.postMessage = data => data.type === 'ready' ? setTimeout(() => send(data), 10) : send(data);\n${worker}`
  }));
  await page.goto('/player.html');
  await page.locator('#playNow').click();
  await expect(page.locator('#playNow')).toHaveAttribute('aria-pressed', 'true');
  const expectedRate = await page.evaluate(() => audioProbe.contexts[0].sampleRate);
  const downloading = page.waitForEvent('download');
  await page.keyboard.press('Shift+E');
  await page.waitForFunction(() => audioProbe.workers === 1);
  await page.evaluate(() => {
    document.getElementById('stop').click();
    document.getElementById('playNow').click();
  });
  await expect(page.locator('#playNow')).toHaveAttribute('aria-pressed', 'true');
  const download = await downloading;
  const wav = await fs.readFile(await download.path());
  expect(download.suggestedFilename()).toMatch(/\.wav$/);
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  expect(wav.readUInt16LE(22)).toBe(2);
  expect(wav.readUInt32LE(24)).toBe(expectedRate);
  expect(wav.readUInt16LE(34)).toBe(16);
  // The live ending resolves after the selected duration, followed by its full tail.
  const duration = (wav.length - 44) / (expectedRate * 2 * 2);
  expect(duration).toBeGreaterThan(60);
  expect(duration).toBeLessThan(200);
  let tailPeak = 0;
  for (let offset = wav.length - Math.floor(expectedRate / 10) * 4; offset < wav.length; offset += 2)
    tailPeak = Math.max(tailPeak, Math.abs(wav.readInt16LE(offset)));
  expect(tailPeak).toBeLessThanOrEqual(2);
  expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
  expect(wav.subarray(44).some(value => value !== 0)).toBe(true);
  expect(await page.evaluate(() => document.getElementById('open-airplay-bridge').srcObject.active)).toBe(true);
  expect(errors).toEqual([]);
});

test('the direct output and media bridge are active and share the live mix', async ({ page }) => {
  await page.goto('/player.html');
  await page.locator('#playNow').click();
  await page.waitForFunction(() => {
    const bridge = document.getElementById('open-airplay-bridge');
    return bridge && !bridge.paused && bridge.readyState >= 2;
  });
  const routing = await page.evaluate(() => {
    const ctx = audioProbe.contexts[0];
    const bridge = document.getElementById('open-airplay-bridge');
    const direct = audioProbe.edges.find(edge => edge.destination === ctx.destination);
    const stream = audioProbe.edges.find(edge => edge.destination.stream === bridge.srcObject);
    const source = ctx.createMediaStreamSource(bridge.srcObject);
    const analyser = ctx.createAnalyser();
    source.connect(analyser);
    audioProbe.bridgeProbe = { source, analyser };
    return {
      sharedMix: !!direct && !!stream && direct.source === stream.source,
      muted: bridge.muted, volume: bridge.volume, tracks: bridge.srcObject.getAudioTracks().length
    };
  });
  expect(routing).toEqual({ sharedMix: true, muted: false, volume: 1, tracks: 1 });
  await expect.poll(() => page.evaluate(() => {
    const analyser = audioProbe.bridgeProbe.analyser;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    return samples.some(sample => Math.abs(sample) > 0.0001);
  })).toBe(true);
  await page.evaluate(() => {
    audioProbe.bridgeProbe.source.disconnect();
    audioProbe.bridgeProbe.analyser.disconnect();
  });
  await page.locator('#stop').click();
  await page.waitForFunction(() => document.getElementById('open-airplay-bridge').srcObject === null);
});


test('reloading the script disposes the old instance and binds controls once', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/player.html');
  await page.locator('#playNow').click();
  await expect(page.locator('#playNow')).toHaveAttribute('aria-pressed', 'true');
  await page.addScriptTag({ url: '/player.js?reload=1' });
  await page.addScriptTag({ url: '/player.js?reload=2' });
  await expect.poll(() => page.evaluate(() => audioProbe.contexts[0].state)).toBe('closed');
  await page.locator('#playNow').click();
  await expect(page.locator('#playNow')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => audioProbe.contexts.length)).toBe(2);
  await expect(page.locator('#open-airplay-bridge')).toHaveCount(1);
  await page.keyboard.press('Shift+R');
  await expect(page.locator('#playerStatus')).toHaveText('Recording started');
  expect(await page.evaluate(() => audioProbe.recorders.length)).toBe(1);
  await page.evaluate(() => window.__OPEN_PLAYER_KILL__());
  await expect(page.locator('#open-airplay-bridge')).toHaveCount(0);
  expect(errors).toEqual([]);
});


test('native note drift starts at the strike and moves stereo energy through its decay', async ({ page }) => {
  const source = await fs.readFile(path.join(__dirname, '../../player.js'), 'utf8');
  await page.route('**/player.js*', route => route.fulfill({ contentType: 'text/javascript',
    body: source.replace('  function teardownBusHard() {',
      '  window.testNoteDrift = createNoteDrift; window.testInitializeDrift = initializeNoteDrift; window.testDisposeDrift = disposeNoteDrift;\n  function teardownBusHard() {') }));
  await page.goto('/player.html');
  const result = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(2, 120 * 22050, 22050);
    const wetInput = ctx.createGain();
    window.testInitializeDrift(ctx, 2);
    const drift = window.testNoteDrift(ctx, ctx.destination, wetInput, 0, 120);
    const tone = ctx.createOscillator(); tone.frequency.value = 220;
    tone.connect(drift); tone.start(); tone.stop(120);
    const buffer = await ctx.startRendering(); window.testDisposeDrift(ctx);
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    const rms = (a, start, count) => Math.sqrt(a.slice(start, start + count).reduce((sum,x)=>sum+x*x,0)/count);
    const balances = [0, 15, 30, 60, 90].map(t => {
      const l = rms(left, t*22050, 2205), r = rms(right, t*22050, 2205);
      return (r-l)/(r+l);
    });
    return { center: rms(left, 0, 2205), balances };
  });
  expect(result.center).toBeGreaterThan(0.69);
  expect(result.center).toBeLessThan(0.72);
  expect(Math.abs(result.balances[0])).toBeLessThan(0.005);
  expect(Math.max(...result.balances) - Math.min(...result.balances)).toBeGreaterThan(0.02);
  expect(result.balances.every(x => Math.abs(x) < 0.2)).toBe(true);
});

test('repeated native WAV exports preserve the performance after Stop and control changes', async ({ page }) => {
  await page.goto('/player.html');
  await page.locator('#playNow').click();
  await expect(page.locator('#playNow')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#songDuration').focus();
  let downloading = page.waitForEvent('download');
  await page.keyboard.press('Shift+E');
  const first = await fs.readFile(await (await downloading).path());
  await expect(page.locator('#playerStatus')).toHaveText('WAV downloaded');
  await page.locator('#stop').click();
  await page.locator('#songDuration').selectOption('1800');
  await page.evaluate(() => {
    const tone = document.getElementById('tone'); tone.value = '200';
    tone.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#tone').focus();
  downloading = page.waitForEvent('download');
  await page.keyboard.press('Shift+E');
  const second = await fs.readFile(await (await downloading).path());
  expect(second.length).toBe(first.length);
  expect(second.subarray(0, 44).equals(first.subarray(0, 44))).toBe(true);
  let maxDifference = 0, differenceEnergy = 0, signalEnergy = 0, changed = 0;
  for (let offset = 44; offset < first.length; offset += 2) {
    const a = first.readInt16LE(offset), b = second.readInt16LE(offset), delta = a - b;
    maxDifference = Math.max(maxDifference, Math.abs(delta));
    differenceEnergy += delta * delta; signalEnergy += a * a;
    if (delta) changed++;
  }
  const relativeError = Math.sqrt(differenceEnergy / signalEnergy);
  console.log('Repeat WAV comparison', { maxDifference, relativeError, changed });
  // Native floating-point DSP can round differently at the final PCM conversion.
  expect(maxDifference).toBeLessThanOrEqual(2);
  expect(relativeError).toBeLessThan(0.0001);
});
