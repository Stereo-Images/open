// Local-only fixture server for native browser tests.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = new Map([
  ['/index.html', 'text/html'], ['/player.html', 'text/html'],
  ['/favicon.svg', 'image/svg+xml'],
  ['/player.js', 'text/javascript'], ['/wav-worker.js', 'text/javascript'], ['/style.css', 'text/css'],
  ['/studies/index.html', 'text/html'], ['/studies/studies.js', 'text/javascript'],
  ['/studies/g29/deliverables/Open-g29-Sixteen-New-Studies.html', 'text/html'],
  ['/studies/g29/deliverables/Open-Filtered-Spectral-Organ-g29.html', 'text/html']
]);
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const name = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
  if (!files.has(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', files.get(name));
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(path.join(root, name)).pipe(res);
}).listen(4173, '127.0.0.1');
