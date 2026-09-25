// Локальный просмотр dist/ с теми же заголовками безопасности, что на сервере
// (читаются из infra/nginx/snippets/sila-roda-headers.conf): нарушение CSP
// видно в консоли браузера ещё до деплоя.
//
//   node scripts/build.mjs && node scripts/serve.mjs   → http://127.0.0.1:4300
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { DIST, ROOT } from './lib.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ttf': 'font/ttf',
};

export function securityHeaders() {
  const snippet = readFileSync(path.join(ROOT, 'infra/nginx/snippets/sila-roda-headers.conf'), 'utf8');
  const headers = {};
  for (const match of snippet.matchAll(/^add_header\s+(\S+)\s+"([^"]*)"/gm)) {
    if (match[1] !== 'Strict-Transport-Security') headers[match[1]] = match[2];
  }
  return headers;
}

async function file(p) {
  try { return (await stat(p)).isFile() ? p : null; } catch { return null; }
}

export function startServer(port = Number(process.env.PORT) || 4300, host = '127.0.0.1') {
  const headers = securityHeaders();
  const server = createServer(async (req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { pathname = '/'; }
    const rel = path.normalize(pathname).replace(/^([/\\])+/, '');
    const base = path.join(DIST, rel);
    if (!base.startsWith(DIST)) { res.writeHead(400).end(); return; }
    const found = (pathname.endsWith('/') && await file(path.join(base, 'index.html'))) ||
      await file(base) || await file(`${base}.html`);
    const target = found || path.join(DIST, '404.html');
    res.writeHead(found ? 200 : 404, { ...headers, 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream' });
    res.end(await readFile(target));
  });
  return new Promise(resolve => server.listen(port, host, () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await startServer();
  const { address, port } = server.address();
  console.log(`dist/ → http://${address}:${port}`);
}
