const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const { validateScore } = require('../../modular-core.js');

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.modularProbe = { contexts: [], messages: [], starts: [], errors: [] };
    window.addEventListener('error', e => modularProbe.errors.push(e.message));
    const NativeContext = window.AudioContext;
    window.AudioContext = new Proxy(NativeContext, {
      construct(Target, args) { const ctx = new Target(...args); modularProbe.contexts.push(ctx); return ctx; }
    });
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function(time) {
      if (this.frequency.value > 10) modularProbe.starts.push({ time, frequency: this.frequency.value });
      return start.call(this, time);
    };
    if (window.SharedWorker) {
      const NativeWorker = window.SharedWorker;
      window.SharedWorker = new Proxy(NativeWorker, {
        construct(Target, args) {
          const worker = new Target(...args);
          worker.port.addEventListener('message', e => modularProbe.messages.push(e.data));
          return worker;
        }
      });
    }
  });
});
test.afterEach(async ({ context }, info) => {
  if (info.status === info.expectedStatus) return;
  for (const page of context.pages()) {
    console.log('Modular diagnostic', await page.evaluate(() => ({
      url: location.href, ensemble: document.getElementById('ensembleStatus')?.textContent,
      status: document.getElementById('windowStatus')?.textContent,
      clock: window.OpenModular?.clock(), contexts: window.modularProbe?.contexts.map(c => ({ state: c.state, time: c.currentTime })),
      messages: window.modularProbe?.messages.slice(-8), errors: window.modularProbe?.errors
    })).catch(() => 'Page closed'));
  }
});
async function open(page, room) {
  await page.goto('/modular.html?room=' + room);
  await expect(page.locator('#modularPlay')).toBeEnabled();
}
async function scoreControls(page) { await page.locator('.modular-scores').evaluate(e => e.open = true); }

test('three real windows share tuning, keep their own lengths, and continue after the first closes', async ({ page, context }) => {
  test.setTimeout(90000);
  await open(page, 'trio');
  expect(await page.evaluate(() => modularProbe.contexts.length)).toBe(0);
  await page.locator('#modularTone').fill('121');
  await page.locator('#modularLength').selectOption('short');
  await page.locator('#modularPlay').click();
  await expect(page.locator('#ensembleStatus')).toHaveText('1 voice · 121 Hz');
  const popup = page.waitForEvent('popup');
  await page.locator('#addWindow').click();
  const second = await popup;
  await expect(second.locator('#modularPlay')).toBeEnabled();
  expect(await second.evaluate(() => modularProbe.contexts.length)).toBe(0);
  await expect(second.locator('#modularTone')).toHaveValue('121');
  await second.locator('#modularLength').selectOption('long');
  await second.locator('#modularPlay').click();
  const third = await context.newPage();
  await open(third, 'trio');
  await third.locator('#modularPlay').click();
  for (const p of [page, second, third]) {
    await expect(p.locator('#ensembleStatus')).toHaveText('3 voices · 121 Hz');
    await expect.poll(() => p.evaluate(() => modularProbe.starts.length), { timeout: 10000 }).toBeGreaterThan(0);
  }
  const state = await third.evaluate(() => modularProbe.messages.filter(m => m.type === 'state').at(-1));
  expect(state.members.map(m => m.length)).toEqual(['short', 'long', 'infinite']);
  await page.close();
  await expect(third.locator('#ensembleStatus')).toHaveText('2 voices · 121 Hz');
  const count = await third.evaluate(() => modularProbe.starts.length);
  await expect.poll(() => third.evaluate(() => modularProbe.starts.length), { timeout: 45000 }).toBeGreaterThan(count);
  await second.locator('#modularStop').click();
  await expect(third.locator('#ensembleStatus')).toHaveText('1 voice · 121 Hz');
  await expect(third.locator('#windowStatus')).toContainText('Solo');
  expect(await third.evaluate(() => modularProbe.errors)).toEqual([]);
});

test('saved scores contain every voice, replay independently, and export real non-silent WAV audio', async ({ page, context }) => {
  test.setTimeout(90000);
  await open(page, 'score');
  await page.locator('#modularPlay').click();
  const second = await context.newPage();
  await open(second, 'score');
  await second.locator('#modularPlay').click();
  await expect.poll(() => page.evaluate(() => {
    const now = OpenModular.clock();
    return new Set(modularProbe.messages.filter(m => m.type === 'event' && m.event.at <= now).map(m => m.event.performer)).size;
  }), { timeout: 12000 }).toBe(2);
  await scoreControls(page);
  await expect(page.locator('#saveScore')).toBeEnabled();
  const downloaded = page.waitForEvent('download');
  await page.locator('#saveScore').click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/^open-modular-.*\.json$/);
  const score = validateScore(JSON.parse(await fs.readFile(await file.path(), 'utf8')));
  expect(new Set(score.events.map(e => e.performer)).size).toBe(2);
  await page.locator('#modularStop').click();
  await second.locator('#modularStop').click();
  await page.locator('#loadScore').setInputFiles({ name: 'ensemble.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(score)) });
  await expect(page.locator('#loadedScoreStatus')).toContainText('2 voices');
  await page.locator('#replayScore').click();
  await expect(page.locator('#windowStatus')).toContainText('Playing the loaded ensemble');
  await expect(second.locator('#ensembleStatus')).toHaveText('Ready for a voice.');
  const wavDownload = page.waitForEvent('download');
  await page.locator('#exportScore').click();
  const wavFile = await wavDownload;
  expect(wavFile.suggestedFilename()).toMatch(/^open-modular-.*\.wav$/);
  const wav = await fs.readFile(await wavFile.path());
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  expect(wav.readUInt32LE(24)).toBe(44100);
  expect(wav.length).toBeGreaterThan(44100 * 4 * 20);
  let energy = 0;
  for (let i = 44; i < wav.length; i += 128) energy += Math.abs(wav.readInt16LE(i));
  expect(energy).toBeGreaterThan(10000);
  expect(await page.evaluate(() => modularProbe.errors)).toEqual([]);
});

test('Stop during startup cancels joining; a paused audio context leaves the ensemble', async ({ page, context }) => {
  await open(page, 'lifecycle');
  await page.evaluate(() => {
    document.getElementById('modularPlay').click();
    document.getElementById('modularStop').click();
  });
  await expect(page.locator('#modularPlay')).toBeEnabled();
  await expect(page.locator('#ensembleStatus')).toHaveText('Ready for a voice.');
  await page.locator('#modularPlay').click();
  const second = await context.newPage();
  await open(second, 'lifecycle');
  await second.locator('#modularPlay').click();
  await expect(second.locator('#ensembleStatus')).toContainText('2 voices');
  await page.evaluate(() => modularProbe.contexts[0].suspend());
  await expect(page.locator('#windowStatus')).toContainText('Audio paused');
  await expect(second.locator('#ensembleStatus')).toContainText('1 voice');
  await page.locator('#modularPlay').click();
  await expect(second.locator('#ensembleStatus')).toContainText('2 voices');
});

test('room names isolate ensembles and blocked popups offer a usable link', async ({ page, context }) => {
  await page.addInitScript(() => { window.open = () => null; });
  await open(page, 'separate-a');
  await page.locator('#modularTone').fill('110');
  await page.locator('#modularPlay').click();
  const second = await context.newPage();
  await open(second, 'separate-b');
  await second.locator('#modularTone').fill('200');
  await second.locator('#modularPlay').click();
  await expect(page.locator('#ensembleStatus')).toHaveText('1 voice · 110 Hz');
  await expect(second.locator('#ensembleStatus')).toHaveText('1 voice · 200 Hz');
  await page.locator('#addWindow').click();
  await expect(page.locator('#popupFallback')).toBeVisible();
  await expect(page.locator('#popupFallback')).toHaveAttribute('href', /modular\.html\?room=separate-a$/);
});

test('unsupported browsers fail clearly; malformed scores stay silent; narrow layout fits', async ({ page }) => {
  await page.addInitScript(() => { delete window.SharedWorker; });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/modular.html');
  await expect(page.locator('#windowStatus')).toContainText('supported desktop browser');
  await expect(page.locator('#modularPlay')).toBeDisabled();
  await scoreControls(page);
  await page.locator('#loadScore').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}') });
  await expect(page.locator('#loadedScoreStatus')).toContainText('Could not load');
  await expect(page.locator('#replayScore')).toBeDisabled();
  expect(await page.evaluate(() => modularProbe.contexts.length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(page.getByRole('link', { name: 'Solo Open' })).toBeVisible();
});
