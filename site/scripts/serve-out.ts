#!/usr/bin/env node
// Serve the static export (out/) the way Cloudflare Pages does: /page/ -> page/index.html,
// 404.html for misses. For local review only; binds to localhost.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(fileURLToPath(new URL('../out', import.meta.url)));
const PORT = Number(process.env.PORT ?? 3100);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.jsonl': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

if (!existsSync(OUT)) {
  console.error('no site/out: run `npm run build -w site` first');
  process.exit(1);
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  let file = normalize(join(OUT, path));
  if (!file.startsWith(OUT)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  let status = 200;
  if (!existsSync(file)) { status = 404; file = join(OUT, '404.html'); }
  res.writeHead(status, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`site: http://localhost:${PORT}/`));
