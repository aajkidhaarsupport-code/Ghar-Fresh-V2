'use strict';
// GharFresh: one process, zero dependencies. Run:  node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DB = require('./lib/db');
const U = require('./lib/util');
const core = require('./lib/core');
const hub = require('./lib/hub');
const engine = require('./lib/engine');
const seed = require('./lib/seed');
const { routes, userView } = require('./lib/api');


const PUBLIC = path.join(__dirname, 'public');
const UPLOADS = path.join(DB.DATA_DIR, 'uploads');
const PORT = Number(process.env.PORT) || 3000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.txt': 'text/plain' };
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest']);

const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' };

function send(req, res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const ext = headers.__ext; delete headers.__ext;
  const h = { ...SEC, ...headers };
  if (ext && COMPRESS.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && buf.length > 800) {
    res.writeHead(status, { ...h, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    return res.end(zlib.gzipSync(buf));
  }
  res.writeHead(status, h); res.end(buf);
}
const json = (req, res, status, obj) => send(req, res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

function readBody(req, limit = 9 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(new U.HttpError(413, 'Upload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new U.HttpError(400, 'Invalid JSON')); } });
    req.on('error', reject);
  });
}

function authUser(req, urlObj) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : urlObj.searchParams.get('token');
  const s = t && DB.get().sessions[t];
  if (!s || s.exp < Date.now()) return null;
  return DB.by('users', s.userId) || null;
}

function serveFile(req, res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return json(req, res, 404, { error: 'Not found' });
    const ext = path.extname(file).toLowerCase();
    fs.readFile(file, (e, data) => {
      if (e) return json(req, res, 500, { error: 'read failed' });
      send(req, res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache, __ext: ext });
    });
  });
}
const exists = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(urlObj.pathname);
  try {
    if (pathname === '/healthz') return json(req, res, 200, { ok: true, time: new Date().toISOString() });

    if (pathname === '/api/stream') {
      const user = authUser(req, urlObj);
      if (!user) return json(req, res, 401, { error: 'Please log in' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 4000\n\n');
      hub.add(res, user);
      return;
    }

    if (pathname.startsWith('/api/')) {
      const r = routes.find(x => x.method === req.method && x.re.test(pathname));
      if (!r) return json(req, res, 404, { error: 'Not found' });
      const user = authUser(req, urlObj);
      if (r.auth) {
        if (!user) return json(req, res, 401, { error: 'Please log in to continue' });
        if (r.auth === 'admin' && user.role !== 'admin') return json(req, res, 403, { error: 'Admins only' });
        if (r.auth === 'rider' && user.role !== 'rider') return json(req, res, 403, { error: 'This area is for delivery partners only' });
      }
      const params = r.re.exec(pathname).groups || {};
      const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
      const query = Object.fromEntries(urlObj.searchParams);
      const out = await r.fn({ req, res, user, params, query, body });
      if (out && out.__csv) return send(req, res, 200, out.__csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${out.name}"` });
      return json(req, res, 200, out === undefined ? { ok: true } : out);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return json(req, res, 405, { error: 'Method not allowed' });

    // uploaded images
    if (pathname.startsWith('/uploads/')) {
      const f = path.join(UPLOADS, path.basename(pathname));
      if (exists(f)) return serveFile(req, res, f, 'public, max-age=31536000, immutable');
      return json(req, res, 404, { error: 'Not found' });
    }
    // static app
    let rel = pathname === '/' ? '/index.html' : pathname;
    const f = path.normalize(path.join(PUBLIC, rel));
    if (f.startsWith(PUBLIC) && exists(f)) return serveFile(req, res, f, /\.(svg|png|jpg|webp)$/.test(f) ? 'public, max-age=86400' : 'no-cache');
    // page routes: /admin and /rider open their own apps, everything else the shop
    if (pathname.startsWith('/admin')) return serveFile(req, res, path.join(PUBLIC, 'admin.html'), 'no-cache');
    if (pathname.startsWith('/rider')) return serveFile(req, res, path.join(PUBLIC, 'rider.html'), 'no-cache');
    if (!path.extname(pathname)) return serveFile(req, res, path.join(PUBLIC, 'index.html'), 'no-cache');
    return json(req, res, 404, { error: 'Not found' });
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(req.method, pathname, e);
    const out = { error: status === 500 ? 'Something went wrong. Please try again.' : e.message };
    if (e.shortfall) out.shortfall = e.shortfall;
    if (!res.headersSent) json(req, res, status, out); else res.end();
  }
});

(async () => {
  await DB.init();
  if (seed.run()) console.log('✔ Demo data created (Jaipur zones, 20 products, riders, customers, 14 days of history)');
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  🥛 GharFresh is running\n  Shop:   http://localhost:${PORT}/\n  Admin:  http://localhost:${PORT}/admin   (admin@gharfresh.in)\n  Rider:  http://localhost:${PORT}/rider   (ramesh@gharfresh.in)\n`);
    engine.start();
    // Render free plan sleeps after 15 min without visitors. Pinging our own public address keeps it awake so the night job runs.
    if (process.env.RENDER_EXTERNAL_URL) setInterval(() => fetch(process.env.RENDER_EXTERNAL_URL + '/healthz').catch(() => {}), 9 * 60 * 1000).unref();
  });
})();
