// Pré-visualiza o site estático (dist/) como o GitHub Pages o serviria:
// numa subpasta, ex.: http://localhost:4173/Office-Presence-Management-App/
//
//   npm run build:static && npm run preview:static

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const BASE = process.env.BASE || '/Office-Presence-Management-App/';
const PORT = Number(process.env.PORT) || 4173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith(BASE)) {
    res.writeHead(302, { Location: BASE }).end();
    return;
  }
  let rel = normalize(path.slice(BASE.length) || '.').replace(/^(\.\.[/\\])+/, '');
  if (rel === '.') rel = 'index.html';
  else if (rel.endsWith('/')) rel += 'index.html';
  try {
    const body = await readFile(join(DIST, rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('404');
  }
}).listen(PORT, () => console.log(`Site estático: http://localhost:${PORT}${BASE}`));
