'use strict';
// The automation engine. Runs inside the server: no cron, no external scheduler.
const DB = require('./db');
const U = require('./util');
const core = require('./core');
const hub = require('./hub');
const mail = require('./mail');

const d = () => DB.get();
let demoRun = false;
let lastTick = null;

// ---------- the slow loop (every 20 s): the business automations ----------
function tick() {
  try {
    const now = U.istNow(), S = core.settings(), meta = d().meta;
    lastTick = now.iso;

    // 1) every night: create tomorrow's orders from subscriptions, charge wallets, hold if low, then route + assign riders
    if (S.autoGenerate && now.min >= U.hhmm(S.genTime) && meta.lastGenDate !== now.date) {
      const tomorrow = U.addDays(now.date, 1);
      const r = core.generateForDate(tomorrow, { by: 'scheduler' });
      if (S.autoDispatch) core.dispatch(tomorrow);
      meta.lastGenDate = now.date;
      core.notifyAdmins('nightly', 'Tomorrow\'s orders are ready', `${r.created} confirmed, ${r.on_hold} on hold, ${r.skipped_items} items skipped`, r);
      DB.save();
    }
    // 1b) catch-up: the server was asleep/offline all night (e.g. free hosting). Create today's orders so nobody is missed.
    const yesterday = U.addDays(now.date, -1);
    if (S.autoGenerate && meta.lastGenDate && meta.lastGenDate < yesterday && now.min < 600) {
      const r = core.generateForDate(now.date, { by: 'catch-up' });
      if (S.autoDispatch) core.dispatch(now.date);
      core.packOrders(now.date);
      meta.lastGenDate = yesterday; meta.lastPack = now.date;
      core.audit('catch_up', r);
      core.notifyAdmins('nightly', 'Catch-up run', `Server was offline last night. ${r.created} orders created for today.`, r);
      DB.save();
    }
    // 2) early morning: restock to par level (farm supply is automatic)
    if (S.autoRestock && now.min >= U.hhmm(S.restockTime) && meta.lastRestock !== now.date) {
      let n = 0;
      for (const p of d().products) if (p.par && p.stock < p.par) { p.stock = p.par; n++; }
      meta.lastRestock = now.date; core.audit('auto_restock', { products: n }); DB.save();
    }
    // 3) pack today's orders
    if (S.autoPack && now.min >= U.hhmm(S.packTime) && meta.lastPack !== now.date) {
      if (S.autoDispatch) core.dispatch(now.date);
      core.packOrders(now.date); meta.lastPack = now.date; DB.save();
    }
    // 4) optionally start routes automatically at 5:30
    if (S.autoStartRoutes && now.min >= 330) {
      for (const r of d().routes) if (r.date === now.date && r.status === 'planned') core.startRoute(r);
    }
    // 5) held orders release themselves once the wallet is topped up
    if (S.autoRelease) core.releaseHeldOrders();
    // 6) email pump (Brevo) for notifications created in the last day
    pumpMail();
    // 7) housekeeping: expire old sessions and OTPs
    for (const [t, s] of Object.entries(d().sessions)) if (s.exp < Date.now()) delete d().sessions[t];
    for (const [e, o] of Object.entries(d().otps)) if (o.exp < Date.now()) delete d().otps[e];
  } catch (e) { console.error('engine tick failed:', e); try { core.audit('engine_error', { error: e.message }); } catch {} }
}

let mailBusy = false;
async function pumpMail() {
  if (!mail.enabled() || mailBusy) return;
  mailBusy = true;
  try {
    const pending = d().notifications.filter(n => n.email && !n.emailed && Date.now() - new Date(n.at) < 86400000).slice(0, 5);
    for (const n of pending) {
      n.emailed = true;
      const u = DB.by('users', n.userId);
      try { await mail.send(u.email, u.name, n.title, n.body); } catch (e) { n.emailError = e.message; }
    }
    if (pending.length) DB.save();
  } finally { mailBusy = false; }
}

// ---------- the fast loop (every 3 s): autopilot = simulated riders delivering today's orders ----------
const stepAt = {};
function fastTick() {
  if (!core.settings().autopilot) return;
  try {
    const today = U.istNow().date;
    const routes = d().routes.filter(r => r.date === today && r.status !== 'completed');
    // make sure everything has a rider
    if (d().orders.some(o => o.date === today && ['pending', 'packed'].includes(o.status) && !o.riderId)) core.dispatch(today);
    let remaining = 0;
    for (const r of routes) {
      const open = r.orderIds.map(id => DB.by('orders', id)).filter(o => o && ['pending', 'packed', 'out_for_delivery'].includes(o.status));
      if (!open.length) { r.status = 'completed'; continue; }
      remaining += open.length;
      if (r.status === 'planned' || open.some(o => o.status !== 'out_for_delivery')) { core.startRoute(r); continue; }
      const next = open.sort((a, b) => a.seq - b.seq)[0];
      const k = 'step_' + next.id;
      stepAt[k] = (stepAt[k] || 0) + 1;
      const addr = core.addressOf(next.addressId);
      // phase 1: ride towards the customer, phase 3: hand over
      if (addr) d().riderLoc[r.riderId] = { lat: addr.lat + (stepAt[k] === 1 ? 0.004 : 0.0006), lng: addr.lng + (stepAt[k] === 1 ? 0.004 : 0.0006), at: Date.now() };
      if (stepAt[k] >= 3) {
        const fail = Math.random() < 0.07;
        if (fail) core.markFailed(next, { reason: 'customer_absent', notes: 'Autopilot demo', lat: addr && addr.lat, lng: addr && addr.lng, riderId: r.riderId });
        else core.markDelivered(next, { photo: '/proof-sample.svg', lat: addr ? addr.lat + (Math.random() - .5) * 1e-4 : 26.9, lng: addr ? addr.lng + (Math.random() - .5) * 1e-4 : 75.8, riderId: r.riderId });
        delete stepAt[k];
      }
    }
    if (!remaining && demoRun) {
      demoRun = false; d().settings.autopilot = false;
      core.audit('demo_day_done', {}); core.notifyAdmins('demo', 'Demo day finished', 'All of today\'s deliveries are complete.');
      DB.save();
    }
  } catch (e) { console.error('autopilot failed:', e); }
}

// ---------- demo day: creates a realistic morning of orders and lets simulated riders deliver them live ----------
function startDemoDay() {
  const today = U.istNow().date;
  const customers = d().users.filter(u => u.role === 'customer' && !u.blocked && d().addresses.some(a => a.userId === u.id && !a.deleted));
  const prods = d().products.filter(p => p.active && p.stock > 5);
  if (!customers.length || !prods.length) U.bad('No customers or products to run a demo day');
  const pick = a => a[Math.floor(Math.random() * a.length)];
  let made = 0;
  const shuffled = customers.slice().sort(() => Math.random() - .5).slice(0, 9);
  for (const u of shuffled) {
    const addr = d().addresses.find(a => a.userId === u.id && !a.deleted && a.isDefault) || d().addresses.find(a => a.userId === u.id && !a.deleted);
    if (!core.zoneOf(addr)) continue;
    const lines = []; const n = 2 + Math.floor(Math.random() * 3);
    while (lines.length < n) { const p = pick(prods); if (!lines.find(l => l.p.id === p.id)) lines.push({ p, q: 1 + Math.floor(Math.random() * 2) }); }
    const subtotal = lines.reduce((a, { p, q }) => a + p.price * q, 0), fee = core.deliveryFee(addr, subtotal), total = subtotal + fee;
    if (core.wallet(u).balance < total) core.walletApply(u, 'credit', Math.ceil(total / 100) * 100 + 200, null, 'Wallet recharge (UPI)');
    const o = { id: U.uid('o_'), no: DB.nextOrderNo(), userId: u.id, addressId: addr.id, subId: null, date: today, slot: Math.random() < .5 ? 'early' : 'regular', source: 'basket', status: 'pending',
      items: lines.map(({ p, q }) => ({ productId: p.id, name: p.name, pack: p.pack, qty: q, price: p.price, mrp: p.mrp, image: p.images[0] })), subtotal, fee, discount: 0, total, coupon: null, payStatus: 'paid', riderId: null, routeId: null, seq: null, timeline: [], createdAt: new Date().toISOString() };
    core.pushTimeline(o, 'pending', 'Order placed');
    for (const { p, q } of lines) p.stock = Math.max(0, p.stock - q);
    d().orders.push(o);
    core.walletApply(u, 'debit', total, o.id, `Order #${o.no}`);
    core.notify(u.id, 'order', `Order #${o.no} confirmed`, `₹${total} paid from wallet.`, { orderId: o.id });
    made++;
  }
  const dr = core.dispatch(today);
  core.packOrders(today);
  demoRun = true; d().settings.autopilot = true;
  core.audit('demo_day_started', { orders: made });
  DB.save();
  hub.emit('all', 'demo', {});
  return { created: made, ...dr, message: 'Autopilot is delivering today\'s orders. Watch Orders, the customer tracker and the rider app live.' };
}
function setAutopilot(on) { d().settings.autopilot = !!on; if (!on) demoRun = false; DB.save(); }
function status() {
  const today = U.istNow().date;
  return { on: !!d().settings.autopilot, remaining: d().orders.filter(o => o.date === today && ['pending', 'packed', 'out_for_delivery'].includes(o.status)).length, lastTick, demoRun };
}

function start() {
  setInterval(tick, 20000).unref();
  setInterval(fastTick, 3000).unref();
  setTimeout(tick, 1500);
}

module.exports = { start, tick, startDemoDay, setAutopilot, status };
