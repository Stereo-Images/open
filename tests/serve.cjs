// Local-only fixture server for native browser tests.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = new Map([
  ['/index.html', 'text/html'], ['/player.html', 'text/html'],
  ['/favicon.svg', 'image/svg+xml'],
  ['/player.js', 'text/javascript'], ['/wav-worker.js', 'text/javascript'], ['/style.css', 'text/css'],
  ['/modular.html', 'text/html'], ['/modular-core.js', 'text/javascript'],
  ['/modular-worker.js', 'text/javascript'], ['/modular-ui.js', 'text/javascript']
]);
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const name = pathname === '/' ? '/index.html' : pathname;
  if (!files.has(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', files.get(name));
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(path.join(root, name)).pipe(res);
}).listen(4173, '127.0.0.1');

