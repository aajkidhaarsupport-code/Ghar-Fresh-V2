'use strict';
// Tiny zero-dependency JSON database. Whole state lives in memory, saved atomically to disk.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const COLLECTIONS = ['users', 'addresses', 'zones', 'categories', 'products', 'subscriptions', 'orders', 'routes',
  'txs', 'complaints', 'coupons', 'banners', 'notifications', 'audit', 'reviews', 'payments'];

let db = null;
let timer = null;

function empty() {
  const d = { meta: { seeded: false, counters: { order: 1000 }, lastGenDate: null, lastRestock: null, lastPack: null }, settings: {}, sessions: {}, otps: {}, riderLoc: {} };
  for (const c of COLLECTIONS) d[c] = [];
  return d;
}

function load() {
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { db = null; }
  if (!db) db = empty();
  for (const c of COLLECTIONS) if (!db[c]) db[c] = [];
  for (const k of ['settings', 'sessions', 'otps', 'riderLoc']) if (!db[k]) db[k] = {};
  if (!db.meta) db.meta = empty().meta;
  return db;
}

function saveNow() {
  clearTimeout(timer); timer = null;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}
function save() { dirty = true; if (!timer) timer = setTimeout(() => { try { saveNow(); } catch (e) { console.error('save failed', e.message); } }, 400); }

// ---------- optional free cloud backup (Supabase table) so data survives Render free restarts ----------
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const remoteOn = () => !!(SB_URL && SB_KEY);
const sbHeaders = () => ({ apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' });
let dirty = false, pushing = false;

async function init() {
  if (remoteOn()) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/gf_state?id=eq.main&select=data`, { headers: sbHeaders() });
      if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 150));
      const rows = await r.json();
      if (rows[0] && rows[0].data && rows[0].data.meta) { fs.writeFileSync(FILE, JSON.stringify(rows[0].data)); console.log('☁️  Data restored from Supabase backup'); }
      else console.log('☁️  Supabase backup is empty: starting fresh');
    } catch (e) { console.error('☁️  Could not read Supabase backup:', e.message, '\n   (Did you run the one-time SQL from the README?)'); }
  } else if (process.env.RENDER && !process.env.DATA_DIR) console.warn('⚠️  Running on Render without a disk or SUPABASE_URL backup: data will reset on every restart. See README.');
  load();
  if (remoteOn()) setInterval(push, 15000).unref();
}
async function push(force) {
  if (!remoteOn() || !db || pushing || (!dirty && !force)) return;
  pushing = true;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/gf_state`, { method: 'POST', headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id: 'main', data: db, updated_at: new Date().toISOString() }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 150));
    dirty = false;
  } catch (e) { console.error('☁️  Backup failed (will retry):', e.message); }
  pushing = false;
}

const get = () => db;
const by = (col, id) => db[col].find(x => x.id === id);
const nextOrderNo = () => ++db.meta.counters.order;

process.on('exit', () => { try { if (db) saveNow(); } catch {} });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { try { saveNow(); } catch {} try { await push(true); } catch {} process.exit(0); });

module.exports = { init, push, remoteOn, load, get, save, saveNow, by, nextOrderNo, DATA_DIR };
