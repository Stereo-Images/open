const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const resolve = (page, asset) => path.resolve(root, path.dirname(page), asset.split('?')[0]);

for (const page of ['player.html', 'studies/index.html']) {
  const html = read(page);
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => resolve(page, match[1]));
  assert.equal(scripts.filter(file => file === path.join(root, 'player.js')).length, 1, `${page}: shared player`);
  for (const script of scripts) assert.ok(fs.existsSync(script), script);
  assert.doesNotMatch(html, /START OF SCRIPT|function createPerformance|new AudioContext/);
  const icon = html.match(/<link rel="icon"[^>]*href="([^"]+)"/);
  assert.ok(icon && fs.existsSync(resolve(page, icon[1])), `${page}: favicon`);
  assert.ok(html.includes('id="newPerformance"') && html.includes('id="playActions"'));
  assert.doesNotMatch(html, /<option[^>]*value="infinite"/);
}
const manifest = JSON.parse(read('studies/g29/manifest.json'));
const studies = read('studies/index.html');
assert.equal(manifest.recordings.length, 16);
for (const row of manifest.recordings) {
  assert.ok(studies.includes(`value="${row.seed}" data-replay="${row.replayFilename}"`));
  assert.ok(fs.existsSync(path.join(root, 'studies/g29/scores', row.seed + '.json')));
}
assert.equal(fs.readdirSync(path.join(root, 'studies/g29/scores')).length, 16);
for (const name of ['Open-g29-Sixteen-New-Studies.html', 'Open-Filtered-Spectral-Organ-g29.html']) {
  const redirect = read('studies/g29/deliverables/' + name);
  assert.ok(redirect.includes('location.replace(target + location.search + location.hash)'));
  assert.doesNotMatch(redirect, /START OF SCRIPT/);
}
for (const name of ['player.js', 'wav-worker.js', 'studies/studies.js']) new vm.Script(read(name), {filename: name});
console.log('Both listening pages use one player; study data, redirects and assets are intact.');
