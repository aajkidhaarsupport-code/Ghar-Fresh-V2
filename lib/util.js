'use strict';
const crypto = require('crypto');

const uid = (p = '') => p + crypto.randomBytes(6).toString('hex');
const token = () => crypto.randomBytes(24).toString('hex');
const otp = () => String(crypto.randomInt(100000, 999999));

// ---------- India time (IST, UTC+5:30, no DST) ----------
function istNow(ms = Date.now()) {
  const d = new Date(ms + 330 * 60000);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), sec: d.getUTCSeconds(), iso, dow: d.getUTCDay() };
}
const pad = n => String(n).padStart(2, '0');
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
function dowOf(dateStr) { const [y, m, d] = dateStr.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const hhmm = s => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
const fmtMin = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// next date a change/order can still apply to (before cut-off -> tomorrow, after -> day after)
function nextEligible(cutoffMin) {
  const n = istNow();
  return n.min < cutoffMin ? addDays(n.date, 1) : addDays(n.date, 2);
}

// next occurrence of a subscription after `after`
function nextOccurrence(freq, days, after) {
  if (freq === 'daily') return addDays(after, 1);
  if (freq === 'alternate_days') return addDays(after, 2);
  if (freq === 'weekdays') { let d = after; do { d = addDays(d, 1); } while ([0, 6].includes(dowOf(d))); return d; }
  if (freq === 'weekends') { let d = after; do { d = addDays(d, 1); } while (![0, 6].includes(dowOf(d))); return d; }
  if (freq === 'custom') { let d = after; for (let i = 0; i < 14; i++) { d = addDays(d, 1); if ((days || []).includes(DAYS[dowOf(d)])) return d; } return null; }
  return null; // one_time
}

// distance in km (haversine)
function km(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return 0;
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const round = n => Math.round(Number(n) * 100) / 100;
const cleanStr = (s, max = 300) => String(s ?? '').trim().slice(0, max);
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };

module.exports = { uid, token, otp, istNow, addDays, dowOf, DAYS, hhmm, fmtMin, nextEligible, nextOccurrence, km, round, cleanStr, emailOk, HttpError, bad, pad };
