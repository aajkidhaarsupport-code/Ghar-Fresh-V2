'use strict';
const fs = require('fs');
const path = require('path');
const DB = require('./db');
const U = require('./util');
const core = require('./core');
const hub = require('./hub');
const mail = require('./mail');
const engine = require('./engine');

const { bad } = U;
const d = () => DB.get();

// ---------- views ----------
const userView = u => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, referralCode: u.referralCode, blocked: u.blocked,
  wallet: core.wallet(u), vehicle: u.vehicle, zoneIds: u.zoneIds });
const productView = p => ({ id: p.id, catId: p.catId, name: p.name, pack: p.pack, mrp: p.mrp, price: p.price, subOk: p.subOk, desc: p.desc, images: p.images, nutrition: p.nutrition,
  shelfLife: p.shelfLife, source: p.source, tags: p.tags || [], stock: p.stock, rating: p.rating, ratingCount: p.ratingCount, active: p.active, par: p.par, sort: p.sort });
const eligible = () => U.nextEligible(core.cutoffMin());

function loginUser(u) {
  const t = U.token();
  d().sessions[t] = { userId: u.id, exp: Date.now() + 90 * 86400000 };
  DB.save();
  return { token: t, user: userView(u) };
}
const isAdminEmail = e => String(process.env.ADMIN_EMAIL || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean).includes(e);
function newCustomer(email, name, ref) {
  const code = (name || 'GF').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 5).padEnd(3, 'X') + Math.floor(100 + Math.random() * 900);
  const role = isAdminEmail(email) ? 'admin' : 'customer';
  const u = { id: U.uid('u_'), name: name || '', email, phone: '', role, blocked: false, createdAt: new Date().toISOString(), referralCode: code, referredBy: null,
    wallet: { balance: 0, autoRecharge: { on: false, threshold: 200, amount: 500 }, lowNotified: false } };
  if (ref && d().users.some(x => x.referralCode === String(ref).toUpperCase())) u.referredBy = String(ref).toUpperCase();
  d().users.push(u);
  const bonus = core.setting('welcomeBonus');
  if (bonus > 0 && role === 'customer') core.walletApply(u, 'cashback', bonus, null, 'Welcome bonus 🎁');
  core.notify(u.id, 'welcome', 'Welcome to GharFresh 🥛', `We added a ₹${bonus} welcome bonus to your wallet. Add your address and start your first plan.`);
  return u;
}

function saveDataUrl(dataUrl, prefix) {
  const m = /^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/s.exec(dataUrl || '');
  if (!m) bad('Invalid image');
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 4 * 1024 * 1024) bad('Image is too large (max 4 MB)');
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  const name = `${prefix}-${U.uid()}.${ext}`;
  fs.writeFileSync(path.join(DB.DATA_DIR, 'uploads', name), buf);
  return '/uploads/' + name;
}

function alignNext(s, from) {
  if (['daily', 'alternate_days', 'one_time'].includes(s.freq)) return from;
  for (let i = 0; i < 14; i++) {
    const day = U.addDays(from, i), w = U.dowOf(day);
    if (s.freq === 'weekdays' && w >= 1 && w <= 5) return day;
    if (s.freq === 'weekends' && (w === 0 || w === 6)) return day;
    if (s.freq === 'custom' && (s.customDays || []).includes(U.DAYS[w])) return day;
  }
  return from;
}

const own = (col, id, user) => { const x = DB.by(col, id); if (!x || x.userId !== user.id) bad('Not found', 404); return x; };
const csv = rows => rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');

// ---------- routes ----------
const R = [];
const route = (method, pattern, auth, fn) => R.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), auth, fn });

// ===== public =====
route('GET', '/api/bootstrap', null, ({ user }) => {
  const admin = user && user.role === 'admin';
  return {
    now: U.istNow(), settings: (({ storeName, city, supportPhone, supportEmail, cutoff, deliveryWindow, slots, freeDeliveryAbove, welcomeBonus, referralBonus }) => ({ storeName, city, supportPhone, supportEmail, cutoff, deliveryWindow, slots, freeDeliveryAbove, welcomeBonus, referralBonus }))(core.settings()),
    categories: d().categories.filter(c => c.active || admin).sort((a, b) => a.sort - b.sort),
    products: d().products.filter(p => p.active || admin).sort((a, b) => a.sort - b.sort).map(productView),
    banners: d().banners.filter(b => b.active || admin).sort((a, b) => a.sort - b.sort),
    zones: d().zones.filter(z => z.active || admin),
    coupons: d().coupons.filter(c => c.active && (!c.validTo || c.validTo >= U.istNow().date)).map(c => ({ code: c.code, desc: c.desc, minOrder: c.minOrder })),
    nextEligible: eligible(), demo: !mail.enabled() || process.env.DEMO_LOGIN === '1'
  };
});
route('GET', '/api/products/:id', null, ({ params }) => {
  const p = DB.by('products', params.id); if (!p) bad('Not found', 404);
  const reviews = d().reviews.filter(r => r.productId === p.id).slice(-8).reverse();
  const related = d().products.filter(x => x.active && x.catId === p.catId && x.id !== p.id).slice(0, 6).map(productView);
  return { product: productView(p), reviews, related };
});

// ===== auth =====
route('POST', '/api/auth/otp', null, ({ body }) => {
  const email = U.cleanStr(body.email, 120).toLowerCase();
  if (!U.emailOk(email)) bad('Enter a valid email address');
  const prev = d().otps[email];
  if (prev && Date.now() - prev.sentAt < 15000) bad('Please wait a few seconds before asking for another OTP', 429);
  const code = U.otp();
  d().otps[email] = { code, exp: Date.now() + 10 * 60000, tries: 0, sentAt: Date.now() };
  const exists = d().users.some(u => u.email === email);
  if (mail.enabled()) {
    mail.send(email, '', 'Your GharFresh OTP', `Your login code is <b style="font-size:20px">${code}</b>. It is valid for 10 minutes.`).catch(e => core.audit('mail_error', { error: e.message }));
    return { sent: true, exists };
  }
  return { sent: true, exists, devOtp: code, demo: true }; // no email service configured: show the code on screen
});
route('POST', '/api/auth/verify', null, ({ body }) => {
  const email = U.cleanStr(body.email, 120).toLowerCase();
  const rec = d().otps[email];
  if (!rec || rec.exp < Date.now()) bad('OTP expired. Please request a new one.');
  if (++rec.tries > 5) { delete d().otps[email]; bad('Too many attempts. Request a new OTP.', 429); }
  if (String(body.code).trim() !== rec.code) bad('Wrong OTP. Please try again.');
  delete d().otps[email];
  let u = d().users.find(x => x.email === email);
  if (!u) u = newCustomer(email, U.cleanStr(body.name, 60), body.ref);
  else if (body.name && !u.name) u.name = U.cleanStr(body.name, 60);
  if (isAdminEmail(email) && u.role !== 'admin') { u.role = 'admin'; u.blocked = false; DB.save(); } // ADMIN_EMAIL always wins, even for an account made earlier
  if (u.blocked) bad('Your account is blocked. Please contact support.', 403);
  return loginUser(u);
});
route('POST', '/api/auth/demo', null, ({ body }) => {
  if (mail.enabled() && process.env.DEMO_LOGIN !== '1') bad('Demo login is disabled', 403);
  const role = ['customer', 'rider', 'admin'].includes(body.role) ? body.role : 'customer';
  const u = d().users.find(x => x.demo && x.role === role) || d().users.find(x => x.role === role);
  if (!u) bad('No demo user', 404);
  return loginUser(u);
});
route('POST', '/api/auth/logout', 'user', ({ req }) => { delete d().sessions[(req.headers.authorization || '').slice(7)]; DB.save(); return { ok: true }; });

// ===== customer: profile, addresses =====
route('GET', '/api/me', 'user', ({ user }) => ({
  user: userView(user), addresses: d().addresses.filter(a => a.userId === user.id && !a.deleted),
  unread: d().notifications.filter(n => n.userId === user.id && !n.read).length, nextEligible: eligible()
}));
route('PUT', '/api/me', 'user', ({ user, body }) => {
  if (body.name != null) user.name = U.cleanStr(body.name, 60);
  if (body.phone != null) { const ph = String(body.phone).replace(/\D/g, '').slice(-10); if (ph && ph.length !== 10) bad('Enter a 10-digit mobile number'); user.phone = ph; }
  DB.save(); return userView(user);
});
function addrBody(user, b, existing) {
  const z = DB.by('zones', b.zoneId); if (!z || !z.active) bad('Please choose a delivery area');
  const house = U.cleanStr(b.house, 60), line1 = U.cleanStr(b.line1, 160);
  if (!house || !line1) bad('House/flat number and street/society are required');
  const lat = b.lat != null && b.lat !== '' ? Number(b.lat) : z.lat + (Math.random() - .5) * .012;
  const lng = b.lng != null && b.lng !== '' ? Number(b.lng) : z.lng + (Math.random() - .5) * .012;
  return { label: U.cleanStr(b.label, 20) || 'Home', house, line1, landmark: U.cleanStr(b.landmark, 80), zoneId: z.id, lat, lng, instructions: U.cleanStr(b.instructions, 160) };
}
route('POST', '/api/addresses', 'user', ({ user, body }) => {
  const a = { id: U.uid('ad_'), userId: user.id, ...addrBody(user, body), isDefault: !d().addresses.some(x => x.userId === user.id && !x.deleted), deleted: false };
  d().addresses.push(a); DB.save(); return a;
});
route('PUT', '/api/addresses/:id', 'user', ({ user, params, body }) => {
  const a = own('addresses', params.id, user);
  Object.assign(a, addrBody(user, body, a));
  if (body.isDefault) d().addresses.forEach(x => { if (x.userId === user.id) x.isDefault = x.id === a.id; });
  DB.save(); return a;
});
route('DELETE', '/api/addresses/:id', 'user', ({ user, params }) => {
  const a = own('addresses', params.id, user);
  if (d().subscriptions.some(s => s.addressId === a.id && ['active', 'paused'].includes(s.status))) bad('This address is used by an active plan. Move or cancel the plan first.');
  a.deleted = true;
  if (a.isDefault) { const n = d().addresses.find(x => x.userId === user.id && !x.deleted); if (n) n.isDefault = true; }
  DB.save(); return { ok: true };
});

// ===== customer: orders =====
route('GET', '/api/orders', 'user', ({ user }) =>
  d().orders.filter(o => o.userId === user.id).sort((a, b) => b.date.localeCompare(a.date) || b.no - a.no).slice(0, 80).map(core.orderView));
route('GET', '/api/orders/:id', 'user', ({ user, params }) => core.orderView(own('orders', params.id, user)));
route('POST', '/api/orders', 'user', ({ user, body }) => core.orderView(core.placeBasketOrder(user, body)));
route('POST', '/api/orders/quote', 'user', ({ user, body }) => {
  const addr = core.addressOf(body.addressId);
  let subtotal = 0;
  for (const it of body.items || []) { const p = DB.by('products', it.productId); if (p) subtotal += p.price * Math.floor(it.qty); }
  const fee = addr ? core.deliveryFee(addr, subtotal) : 0;
  let discount = 0, couponError = null;
  try { discount = core.validateCoupon(user, body.couponCode, subtotal, fee).discount; } catch (e) { couponError = e.message; }
  return { subtotal: U.round(subtotal), fee, discount, total: U.round(subtotal + fee - discount), couponError, balance: core.wallet(user).balance, date: eligible() };
});
route('POST', '/api/orders/:id/cancel', 'user', ({ user, params }) => { const o = own('orders', params.id, user); core.cancelOrder(user, o); DB.save(); return core.orderView(o); });
route('POST', '/api/orders/:id/rate', 'user', ({ user, params, body }) => {
  const o = own('orders', params.id, user);
  if (o.status !== 'delivered') bad('You can rate an order after it is delivered');
  if (o.rating) bad('You have already rated this order');
  const stars = Math.floor(Number(body.stars)); if (!(stars >= 1 && stars <= 5)) bad('Choose 1 to 5 stars');
  const text = U.cleanStr(body.text, 300);
  o.rating = { stars, text, at: new Date().toISOString() };
  const nm = (user.name || 'Customer').split(' ');
  for (const it of o.items) {
    const p = DB.by('products', it.productId); if (!p) continue;
    p.ratingSum = (p.ratingSum || p.rating * p.ratingCount) + stars; p.ratingCount++; p.rating = Math.round(p.ratingSum / p.ratingCount * 10) / 10;
    if (text) d().reviews.push({ id: U.uid('rv_'), productId: p.id, userId: user.id, name: nm[0] + (nm[1] ? ' ' + nm[1][0] + '.' : ''), stars, text, at: o.rating.at });
  }
  DB.save(); return core.orderView(o);
});
route('POST', '/api/orders/:id/refund', 'user', ({ user, params }) => {
  const o = own('orders', params.id, user);
  if (o.status !== 'failed') bad('Only undelivered orders can be refunded');
  if (!core.refundOrder(o, `Refund for undelivered order #${o.no}`)) bad('This order was already refunded');
  DB.save(); return core.orderView(o);
});
route('POST', '/api/orders/:id/complain', 'user', ({ user, params, body }) => { const c = core.fileComplaint(user, own('orders', params.id, user), body); return c; });
route('POST', '/api/orders/:id/reorder', 'user', ({ user, params }) => {
  const o = own('orders', params.id, user);
  const items = o.items.map(i => ({ productId: i.productId, qty: i.qty })).filter(i => DB.by('products', i.productId)?.active);
  return { items };
});
route('GET', '/api/complaints', 'user', ({ user }) => d().complaints.filter(c => c.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

// ===== customer: subscriptions =====
const subView = s => { const p = DB.by('products', s.productId); const a = core.addressOf(s.addressId); return { ...s, product: p && productView(p), address: a && { label: a.label, house: a.house, line1: a.line1 } }; };
route('GET', '/api/subscriptions', 'user', ({ user }) => d().subscriptions.filter(s => s.userId === user.id && s.status !== 'cancelled').map(subView));
route('POST', '/api/subscriptions', 'user', ({ user, body }) => subView(core.createSubscription(user, body)));
route('PATCH', '/api/subscriptions/:id', 'user', ({ user, params, body }) => {
  const s = own('subscriptions', params.id, user); const el = eligible();
  if (s.status === 'cancelled') bad('This plan is cancelled');
  switch (body.action) {
    case 'pause': s.status = 'paused'; break;
    case 'resume': s.status = 'active'; s.next = alignNext(s, !s.next || s.next < el ? el : s.next); break;
    case 'cancel': s.status = 'cancelled'; s.next = null; break;
    case 'qty': { const q = Math.floor(Number(body.qty)); if (!(q >= 1 && q <= 10)) bad('Invalid quantity'); s.qty = q; break; }
    case 'slot': s.slot = body.slot; break;
    case 'skip': if (!body.date || body.date < el) bad('Cut-off passed for that date'); if (!s.pauseDates.includes(body.date)) s.pauseDates.push(body.date); break;
    case 'unskip': s.pauseDates = s.pauseDates.filter(x => x !== body.date); break;
    default: bad('Unknown action');
  }
  DB.save(); return subView(s);
});

// ===== wallet =====
route('GET', '/api/wallet', 'user', ({ user }) => ({
  wallet: core.wallet(user), txs: d().txs.filter(t => t.userId === user.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100),
  offers: [{ min: 500, pct: 2 }, { min: 1000, pct: 5 }, { min: 2000, pct: 6 }]
}));
route('POST', '/api/wallet/topup', 'user', ({ user, body }) => {
  core.assertActive(user);
  const amt = Math.floor(Number(body.amount));
  if (!(amt >= 50 && amt <= 10000)) bad('Enter an amount between ₹50 and ₹10,000');
  // Payment gateway hook: swap this block for Razorpay/Cashfree order verification. Demo mode confirms instantly.
  const pay = { id: U.uid('pay_'), userId: user.id, amount: amt, method: body.method || 'upi', status: 'paid', at: new Date().toISOString(), gateway: 'demo' };
  d().payments.push(pay);
  core.walletApply(user, 'credit', amt, null, `Wallet recharge (${(pay.method || 'upi').toUpperCase()})`);
  const bonus = core.topupBonus(amt);
  if (bonus) core.walletApply(user, 'cashback', bonus, null, `Cashback on ₹${amt} recharge`);
  const released = core.releaseHeldOrders(user.id);
  DB.save();
  return { wallet: core.wallet(user), bonus, released };
});
route('PUT', '/api/wallet/auto', 'user', ({ user, body }) => {
  const w = core.wallet(user);
  w.autoRecharge = { on: !!body.on, threshold: Math.max(50, Math.floor(Number(body.threshold) || 200)), amount: Math.min(10000, Math.max(100, Math.floor(Number(body.amount) || 500))) };
  DB.save(); return w;
});

// ===== notifications + coupons + realtime =====
route('GET', '/api/notifications', 'user', ({ user }) => d().notifications.filter(n => n.userId === user.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60));
route('POST', '/api/notifications/read', 'user', ({ user }) => { d().notifications.forEach(n => { if (n.userId === user.id) n.read = true; }); DB.save(); return { ok: true }; });
route('POST', '/api/coupons/validate', 'user', ({ user, body }) => { const r = core.validateCoupon(user, body.code, Number(body.subtotal) || 0, Number(body.fee) || 0); return { discount: r.discount, desc: r.coupon && r.coupon.desc }; });

// ===== rider =====
function riderOrders(user, date) {
  return d().orders.filter(o => o.riderId === user.id && o.date === date && o.status !== 'cancelled' && o.status !== 'on_hold')
    .sort((a, b) => d().routes.findIndex(r => r.id === a.routeId) - d().routes.findIndex(r => r.id === b.routeId) || (a.seq || 0) - (b.seq || 0));
}
const stopView = o => { const v = core.orderView(o); const c = DB.by('users', o.userId); return { ...v, customer: c && { name: c.name, phone: c.phone } }; };
route('GET', '/api/rider/route', 'rider', ({ user, query }) => {
  const date = query.date || U.istNow().date;
  const list = riderOrders(user, date);
  const rts = d().routes.filter(r => r.riderId === user.id && r.date === date);
  return { date, stops: list.map(stopView), routeStatus: rts.every(r => r.status === 'completed') && rts.length ? 'completed' : rts.some(r => r.status === 'in_progress') ? 'in_progress' : 'planned',
    pay: core.setting('riderPay'), tomorrow: riderOrders(user, U.addDays(date, 1)).length };
});
route('POST', '/api/rider/start', 'rider', ({ user, body }) => {
  const date = body.date || U.istNow().date; let n = 0;
  for (const r of d().routes.filter(r => r.riderId === user.id && r.date === date && r.status !== 'completed')) n += core.startRoute(r);
  if (!n) bad('No orders to start. Check with the admin.');
  return { started: n };
});
route('POST', '/api/rider/orders/:id/delivered', 'rider', ({ user, params, body }) => {
  const o = DB.by('orders', params.id); if (!o || o.riderId !== user.id) bad('Order not found', 404);
  if (o.status === 'delivered') return { ok: true, already: true };
  const photo = saveDataUrl(body.photo, 'proof');
  core.markDelivered(o, { photo, lat: body.lat, lng: body.lng, at: body.at, riderId: user.id });
  return { ok: true };
});
route('POST', '/api/rider/orders/:id/failed', 'rider', ({ user, params, body }) => {
  const o = DB.by('orders', params.id); if (!o || o.riderId !== user.id) bad('Order not found', 404);
  if (o.status === 'failed') return { ok: true, already: true };
  core.markFailed(o, { reason: body.reason, notes: U.cleanStr(body.notes, 200), lat: body.lat, lng: body.lng, riderId: user.id });
  return { ok: true };
});
route('POST', '/api/rider/location', 'rider', ({ user, body }) => { d().riderLoc[user.id] = { lat: Number(body.lat), lng: Number(body.lng), at: Date.now() }; return { ok: true }; });
route('GET', '/api/rider/stats', 'rider', ({ user }) => {
  const today = U.istNow().date, mine = d().orders.filter(o => o.riderId === user.id && o.status === 'delivered');
  const sum = from => mine.filter(o => o.date >= from).reduce((a, o) => a + (o.riderPay || 0), 0);
  return { today: { delivered: mine.filter(o => o.date === today).length, earned: sum(today) }, week: { delivered: mine.filter(o => o.date >= U.addDays(today, -6)).length, earned: sum(U.addDays(today, -6)) },
    month: { delivered: mine.filter(o => o.date >= U.addDays(today, -29)).length, earned: sum(U.addDays(today, -29)) }, rating: (() => { const r = mine.filter(o => o.rating); return r.length ? Math.round(r.reduce((a, o) => a + o.rating.stars, 0) / r.length * 10) / 10 : null; })() };
});

// ===== admin =====
const A = (m, p, fn) => route(m, '/api/admin' + p, 'admin', fn);
A('GET', '/dashboard', () => {
  const now = U.istNow(), today = now.date, od = d().orders, live = od.filter(o => o.status !== 'cancelled');
  const on = dt => live.filter(o => o.date === dt);
  const rev = dt => on(dt).filter(o => o.payStatus === 'paid' || o.status === 'delivered').reduce((a, o) => a + o.total, 0);
  const days = Array.from({ length: 14 }, (_, i) => U.addDays(today, i - 13));
  const top = {};
  live.filter(o => o.date >= U.addDays(today, -6) && o.date <= today).forEach(o => o.items.forEach(i => { const k = i.name + ' ' + i.pack; top[k] = (top[k] || 0) + i.qty * i.price; }));
  const statusCount = {}; on(today).forEach(o => statusCount[o.status] = (statusCount[o.status] || 0) + 1);
  const tmr = U.addDays(today, 1);
  const delivered = on(today).filter(o => o.status === 'delivered' && o.proof);
  const ontime = delivered.length ? Math.round(delivered.filter(o => new Date(o.proof.at).getTime() <= new Date(today + 'T07:30:00+05:30').getTime()).length / delivered.length * 100) : 100;
  return {
    now, today: { orders: on(today).length, revenue: rev(today), delivered: delivered.length, failed: on(today).filter(o => o.status === 'failed').length, onTimePct: ontime },
    tomorrow: { orders: on(tmr).length, onHold: od.filter(o => o.date === tmr && o.status === 'on_hold').length, expectedSubs: d().subscriptions.filter(s => s.status === 'active' && s.next === tmr).length },
    kpis: { customers: d().users.filter(u => u.role === 'customer').length, activeSubs: d().subscriptions.filter(s => s.status === 'active').length, walletLiability: d().users.reduce((a, u) => a + (u.wallet ? u.wallet.balance : 0), 0),
      openComplaints: d().complaints.filter(c => c.status === 'open').length, held: od.filter(o => o.status === 'on_hold').length, weekRevenue: days.slice(7).reduce((a, dt) => a + rev(dt), 0) },
    series: days.map(dt => ({ date: dt, orders: on(dt).length, revenue: rev(dt) })), statusCount,
    topProducts: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value })),
    lowStock: d().products.filter(p => p.active && p.stock <= core.setting('lowStockAlert')).map(p => ({ id: p.id, name: p.name, pack: p.pack, stock: p.stock })),
    riders: d().users.filter(u => u.role === 'rider').map(r => { const mine = on(today).filter(o => o.riderId === r.id); return { id: r.id, name: r.name, assigned: mine.length, delivered: mine.filter(o => o.status === 'delivered').length, loc: d().riderLoc[r.id] || null }; }),
    automation: { settings: core.settings(), lastGenDate: d().meta.lastGenDate, autopilot: engine.status(), recent: d().audit.filter(a => ['nightly_generation', 'auto_dispatch', 'auto_pack', 'auto_release', 'auto_recharge', 'auto_restock', 'refund', 'sub_skipped'].includes(a.action)).slice(-12).reverse() }
  };
});
A('GET', '/orders', ({ query }) => {
  let list = d().orders.slice();
  if (query.date) list = list.filter(o => o.date === query.date);
  if (query.status) list = list.filter(o => o.status === query.status);
  if (query.rider) list = list.filter(o => o.riderId === query.rider);
  const q = (query.q || '').toLowerCase();
  const out = list.sort((a, b) => b.date.localeCompare(a.date) || b.no - a.no).slice(0, 400).map(o => { const v = core.orderView(o); const c = DB.by('users', o.userId); return { ...v, customer: c && { name: c.name, email: c.email, phone: c.phone } }; });
  return q ? out.filter(o => `${o.no} ${o.customer?.name} ${o.customer?.email} ${o.address?.line1}`.toLowerCase().includes(q)) : out;
});
A('PATCH', '/orders/:id', ({ params, body, user }) => {
  const o = DB.by('orders', params.id); if (!o) bad('Not found', 404);
  const cust = DB.by('users', o.userId);
  switch (body.action) {
    case 'cancel': core.cancelOrder(cust, o, true); break;
    case 'pack': if (o.status !== 'pending') bad('Only pending orders can be packed'); core.pushTimeline(o, 'packed', 'Packed'); break;
    case 'assign': { const r = DB.by('users', body.riderId); if (!r || r.role !== 'rider') bad('Choose a rider'); const rt = d().routes.find(x => x.date === o.date && x.riderId === r.id && x.zoneId === (core.addressOf(o.addressId) || {}).zoneId && x.status !== 'completed');
      if (o.routeId) { const old = DB.by('routes', o.routeId); if (old) old.orderIds = old.orderIds.filter(i => i !== o.id); }
      let route = rt; if (!route) { route = { id: U.uid('r_'), date: o.date, zoneId: (core.addressOf(o.addressId) || {}).zoneId, name: `Manual · ${o.date}`, riderId: r.id, status: 'planned', orderIds: [], createdAt: new Date().toISOString() }; d().routes.push(route); }
      route.orderIds.push(o.id); o.routeId = route.id; o.riderId = r.id; o.seq = route.orderIds.length; core.notify(r.id, 'route', 'Order assigned', `Order #${o.no} was added to your route.`); break; }
    case 'release': { if (o.status !== 'on_hold') bad('Order is not on hold'); if (core.wallet(cust).balance < o.total) bad(`Customer wallet has only ₹${core.wallet(cust).balance}`); core.walletApply(cust, 'debit', o.total, o.id, `Delivery on ${o.date}`); o.payStatus = 'paid'; core.pushTimeline(o, 'pending', 'Released by admin'); break; }
    case 'refund': if (!core.refundOrder(o, `Refund for order #${o.no}`)) bad('Nothing to refund'); break;
    case 'deliver': o.proof = o.proof || { photo: '/proof-sample.svg', lat: null, lng: null, at: new Date().toISOString(), byAdmin: true }; o.riderPay = o.riderPay || core.setting('riderPay'); core.pushTimeline(o, 'delivered', 'Marked delivered by admin'); core.notify(o.userId, 'order', 'Delivered ✅', `Order #${o.no} was delivered.`, { orderId: o.id }); break;
    case 'fail': core.markFailed(o, { reason: body.reason || 'other', notes: 'Marked by admin', riderId: null }); break;
    default: bad('Unknown action');
  }
  core.audit('admin_order_' + body.action, { order: o.id }, user.id);
  hub.emit(o.userId, 'order', { id: o.id, status: o.status });
  DB.save(); return core.orderView(o);
});
A('POST', '/generate', ({ body, user }) => { const date = body.date || U.addDays(U.istNow().date, 1); const r = core.generateForDate(date, { by: user.email }); r.dispatch = core.dispatch(date); return r; });
A('POST', '/dispatch', ({ body }) => core.dispatch(body.date || U.addDays(U.istNow().date, 1)));
A('POST', '/pack', ({ body }) => ({ packed: core.packOrders(body.date || U.istNow().date) }));
A('POST', '/release-held', () => ({ released: core.releaseHeldOrders() }));
A('POST', '/demo-day', () => engine.startDemoDay());
// One-time "clean start": removes all demo customers, riders, orders, wallets, reviews and logs. Keeps products, areas, offers, banners, settings and the admin who clicks it.
A('POST', '/clean-start', ({ user, body }) => {
  if (body.confirm !== 'CLEAN') bad('Type CLEAN to confirm');
  const db = d();
  const removed = { customers: db.users.filter(u => u.role === 'customer' && u.id !== user.id).length, riders: db.users.filter(u => u.role === 'rider').length, orders: db.orders.length };
  db.users = db.users.filter(u => u.id === user.id);
  for (const c of ['addresses', 'subscriptions', 'orders', 'routes', 'txs', 'complaints', 'notifications', 'audit', 'reviews', 'payments']) db[c] = [];
  for (const t of Object.keys(db.sessions)) if (db.sessions[t].userId !== user.id) delete db.sessions[t];
  db.otps = {}; db.riderLoc = {};
  db.meta.counters.order = 1000;
  user.wallet = { balance: 0, autoRecharge: { on: false, threshold: 200, amount: 500 }, lowNotified: false };
  for (const p of db.products) { p.rating = 0; p.ratingCount = 0; p.ratingSum = 0; }
  db.meta.seeded = true;
  core.audit('clean_start', removed);
  DB.saveNow(); DB.push(true);
  return { ok: true, removed };
});
A('POST', '/autopilot', ({ body }) => { engine.setAutopilot(!!body.on); return engine.status(); });

// products / categories
A('POST', '/products', ({ body }) => {
  const cat = DB.by('categories', body.catId); if (!cat) bad('Choose a category');
  const name = U.cleanStr(body.name, 80); if (!name) bad('Name is required');
  const price = Number(body.price), mrp = Number(body.mrp || body.price);
  if (!(price >= 0)) bad('Invalid price');
  const p = { id: U.uid('p_'), catId: cat.id, name, pack: U.cleanStr(body.pack, 30), mrp, price, subOk: !!body.subOk, desc: U.cleanStr(body.desc, 600), images: (body.images || []).slice(0, 12), nutrition: body.nutrition || {}, shelfLife: U.cleanStr(body.shelfLife, 40), source: U.cleanStr(body.source, 80), tags: body.tags || [],
    stock: Math.max(0, Math.floor(Number(body.stock) || 0)), par: Math.max(0, Math.floor(Number(body.par ?? body.stock) || 0)), active: body.active !== false, sort: d().products.length, createdAt: new Date().toISOString(), rating: 0, ratingCount: 0 };
  d().products.push(p); DB.save(); return productView(p);
});
A('PUT', '/products/:id', ({ params, body, user }) => {
  const p = DB.by('products', params.id); if (!p) bad('Not found', 404);
  const old = p.price;
  for (const k of ['name', 'pack', 'desc', 'shelfLife', 'source']) if (body[k] != null) p[k] = U.cleanStr(body[k], 600);
  for (const k of ['price', 'mrp']) if (body[k] != null) { if (!(Number(body[k]) >= 0)) bad('Invalid ' + k); p[k] = Number(body[k]); }
  for (const k of ['stock', 'par']) if (body[k] != null) p[k] = Math.max(0, Math.floor(Number(body[k]) || 0));
  for (const k of ['subOk', 'active']) if (body[k] != null) p[k] = !!body[k];
  if (body.catId && DB.by('categories', body.catId)) p.catId = body.catId;
  if (Array.isArray(body.images)) p.images = body.images.slice(0, 12);
  if (Array.isArray(body.tags)) p.tags = body.tags;
  if (body.nutrition && typeof body.nutrition === 'object') p.nutrition = body.nutrition;
  if (p.price !== old) core.audit('price_change', { product: p.id, from: old, to: p.price }, user.id);
  DB.save(); return productView(p);
});
A('DELETE', '/products/:id', ({ params }) => { const p = DB.by('products', params.id); if (!p) bad('Not found', 404); p.active = false; DB.save(); return { ok: true }; });
A('POST', '/upload', ({ body }) => ({ url: saveDataUrl(body.dataUrl, 'img') }));
A('POST', '/categories', ({ body }) => { const name = U.cleanStr(body.name, 40); if (!name) bad('Name is required'); const c = { id: U.uid('c_'), name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), icon: body.icon || '🛒', tint: body.tint || '#EEF5F0', sort: d().categories.length + 1, active: true }; d().categories.push(c); DB.save(); return c; });
A('PUT', '/categories/:id', ({ params, body }) => { const c = DB.by('categories', params.id); if (!c) bad('Not found', 404); for (const k of ['name', 'icon', 'tint']) if (body[k] != null) c[k] = body[k]; if (body.active != null) c.active = !!body.active; if (body.sort != null) c.sort = Number(body.sort); DB.save(); return c; });

// zones / riders / customers
A('GET', '/zones', () => d().zones.map(z => ({ ...z, customers: d().addresses.filter(a => a.zoneId === z.id && !a.deleted).length })));
A('POST', '/zones', ({ body }) => { const name = U.cleanStr(body.name, 60); if (!name) bad('Name is required'); const z = { id: U.uid('z_'), name, pincode: U.cleanStr(body.pincode, 6), fee: Number(body.fee) || 0, freeAbove: body.freeAbove === '' || body.freeAbove == null ? null : Number(body.freeAbove), lat: Number(body.lat) || 26.9124, lng: Number(body.lng) || 75.7873, active: true }; d().zones.push(z); DB.save(); return z; });
A('PUT', '/zones/:id', ({ params, body }) => { const z = DB.by('zones', params.id); if (!z) bad('Not found', 404); for (const k of ['name', 'pincode']) if (body[k] != null) z[k] = U.cleanStr(body[k], 60); for (const k of ['fee', 'lat', 'lng']) if (body[k] != null) z[k] = Number(body[k]); if ('freeAbove' in body) z.freeAbove = body.freeAbove === '' || body.freeAbove == null ? null : Number(body.freeAbove); if (body.active != null) z.active = !!body.active; DB.save(); return z; });
A('GET', '/riders', () => { const today = U.istNow().date; return d().users.filter(u => u.role === 'rider').map(r => { const mine = d().orders.filter(o => o.riderId === r.id); const del = mine.filter(o => o.status === 'delivered'); return { ...userView(r), todayAssigned: mine.filter(o => o.date === today).length, delivered: del.length, earned: del.reduce((a, o) => a + (o.riderPay || 0), 0), failed: mine.filter(o => o.status === 'failed').length, active: r.active !== false, loc: d().riderLoc[r.id] || null }; }); });
A('POST', '/riders', ({ body }) => {
  const email = U.cleanStr(body.email, 120).toLowerCase(); if (!U.emailOk(email)) bad('Enter a valid email');
  let u = d().users.find(x => x.email === email);
  if (u && u.role === 'admin') bad('That email belongs to an admin');
  if (!u) { u = { id: U.uid('u_'), name: U.cleanStr(body.name, 60), email, phone: U.cleanStr(body.phone, 15), role: 'rider', blocked: false, createdAt: new Date().toISOString(), referralCode: 'RID' + Math.floor(1000 + Math.random() * 9000), wallet: { balance: 0, autoRecharge: { on: false, threshold: 200, amount: 500 }, lowNotified: false } }; d().users.push(u); }
  u.role = 'rider'; if (body.name) u.name = U.cleanStr(body.name, 60); if (body.phone) u.phone = U.cleanStr(body.phone, 15);
  u.zoneIds = Array.isArray(body.zoneIds) ? body.zoneIds : []; u.vehicle = U.cleanStr(body.vehicle, 40);
  DB.save(); return userView(u);
});
A('PUT', '/riders/:id', ({ params, body }) => { const u = DB.by('users', params.id); if (!u || u.role !== 'rider') bad('Not found', 404); for (const k of ['name', 'phone', 'vehicle']) if (body[k] != null) u[k] = U.cleanStr(body[k], 60); if (Array.isArray(body.zoneIds)) u.zoneIds = body.zoneIds; if (body.active != null) u.active = !!body.active; if (body.remove) u.role = 'customer'; DB.save(); return userView(u); });
A('GET', '/customers', ({ query }) => {
  const q = (query.q || '').toLowerCase();
  return d().users.filter(u => u.role === 'customer' && (!q || `${u.name} ${u.email} ${u.phone}`.toLowerCase().includes(q))).map(u => {
    const os = d().orders.filter(o => o.userId === u.id && o.status !== 'cancelled'); const a = d().addresses.find(x => x.userId === u.id && !x.deleted);
    return { id: u.id, name: u.name, email: u.email, phone: u.phone, blocked: u.blocked, balance: core.wallet(u).balance, orders: os.length, spent: os.filter(o => o.status === 'delivered').reduce((s, o) => s + o.total, 0), subs: d().subscriptions.filter(s => s.userId === u.id && s.status === 'active').length, zone: a && (DB.by('zones', a.zoneId) || {}).name, joined: u.createdAt, notes: u.notes || '' };
  }).sort((a, b) => b.spent - a.spent);
});
A('POST', '/customers/:id/wallet', ({ params, body, user }) => {
  const c = DB.by('users', params.id); if (!c) bad('Not found', 404);
  const amt = Number(body.amount); if (!(amt > 0 && amt <= 50000)) bad('Enter a valid amount');
  const type = ['credit', 'debit', 'cashback', 'adjustment'].includes(body.type) ? body.type : 'credit';
  core.walletApply(c, type === 'debit' ? 'debit' : type, amt, null, U.cleanStr(body.note, 100) || (type === 'debit' ? 'Admin debit' : 'Added by admin'));
  core.audit('admin_wallet', { user: c.id, type, amt }, user.id);
  const released = type === 'debit' ? 0 : core.releaseHeldOrders(c.id);
  DB.save(); return { balance: core.wallet(c).balance, released };
});
A('PUT', '/customers/:id', ({ params, body }) => { const c = DB.by('users', params.id); if (!c) bad('Not found', 404); if (body.blocked != null) c.blocked = !!body.blocked; if (body.notes != null) c.notes = U.cleanStr(body.notes, 300); DB.save(); return { ok: true }; });
A('GET', '/subscriptions', () => d().subscriptions.filter(s => s.status !== 'cancelled').sort((a, b) => (a.next || 'z').localeCompare(b.next || 'z')).map(s => { const u = DB.by('users', s.userId); return { ...subView(s), customer: u && { name: u.name, email: u.email } }; }));
A('PATCH', '/subscriptions/:id', ({ params, body }) => { const s = DB.by('subscriptions', params.id); if (!s) bad('Not found', 404); if (['active', 'paused', 'cancelled'].includes(body.status)) { s.status = body.status; if (body.status === 'active') s.next = alignNext(s, eligible()); if (body.status === 'cancelled') s.next = null; } DB.save(); return subView(s); });
A('GET', '/complaints', () => d().complaints.slice().sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.createdAt.localeCompare(a.createdAt)).map(c => { const o = DB.by('orders', c.orderId); const u = DB.by('users', c.userId); return { ...c, orderNo: o && o.no, orderTotal: o && o.total, customer: u && { name: u.name, email: u.email } }; }));
A('POST', '/complaints/:id', ({ params, body, user }) => {
  const c = DB.by('complaints', params.id); if (!c) bad('Not found', 404);
  if (c.status === 'resolved' || c.status === 'rejected') bad('Already closed');
  const cust = DB.by('users', c.userId);
  if (body.action === 'refund') { const amt = Number(body.amount); if (!(amt > 0)) bad('Enter a refund amount'); core.walletApply(cust, 'refund', amt, c.orderId, 'Complaint refund'); c.refund = amt; c.status = 'resolved'; c.resolution = U.cleanStr(body.note, 200) || 'Refunded to wallet'; }
  else if (body.action === 'reject') { c.status = 'rejected'; c.resolution = U.cleanStr(body.note, 200) || 'Not eligible'; }
  else { c.status = 'resolved'; c.resolution = U.cleanStr(body.note, 200) || 'Resolved'; }
  c.resolvedAt = new Date().toISOString();
  core.notify(c.userId, 'complaint', 'Update on your complaint', c.resolution + (c.refund ? ` (₹${c.refund} refunded)` : ''), { orderId: c.orderId });
  core.audit('complaint_' + c.status, { id: c.id }, user.id); DB.save(); return c;
});
A('GET', '/coupons', () => d().coupons);
A('POST', '/coupons', ({ body }) => { const code = U.cleanStr(body.code, 20).toUpperCase().replace(/\s/g, ''); if (!code) bad('Code is required'); if (d().coupons.some(c => c.code === code)) bad('Code already exists'); const c = { id: U.uid('k_'), code, type: ['percent', 'flat', 'free_delivery'].includes(body.type) ? body.type : 'flat', value: Number(body.value) || 0, maxDiscount: Number(body.maxDiscount) || 0, minOrder: Number(body.minOrder) || 0, firstOrderOnly: !!body.firstOrderOnly, perUserLimit: Number(body.perUserLimit) || 0, validTo: body.validTo || null, active: true, desc: U.cleanStr(body.desc, 100) }; d().coupons.push(c); DB.save(); return c; });
A('PUT', '/coupons/:id', ({ params, body }) => { const c = DB.by('coupons', params.id); if (!c) bad('Not found', 404); if (body.active != null) c.active = !!body.active; if (body.desc != null) c.desc = body.desc; if (body.value != null) c.value = Number(body.value); DB.save(); return c; });
A('GET', '/banners', () => d().banners);
A('POST', '/banners', ({ body }) => { const b = { id: U.uid('b_'), title: U.cleanStr(body.title, 60), sub: U.cleanStr(body.sub, 100), cta: U.cleanStr(body.cta, 20) || 'Shop now', link: body.link || '#/shop', img: body.img || '', tone: body.tone || 'green', active: true, sort: d().banners.length + 1 }; d().banners.push(b); DB.save(); return b; });
A('PUT', '/banners/:id', ({ params, body }) => { const b = DB.by('banners', params.id); if (!b) bad('Not found', 404); for (const k of ['title', 'sub', 'cta', 'link', 'img', 'tone']) if (body[k] != null) b[k] = body[k]; if (body.active != null) b.active = !!body.active; DB.save(); return b; });
A('DELETE', '/banners/:id', ({ params }) => { d().banners = d().banners.filter(b => b.id !== params.id); DB.save(); return { ok: true }; });
A('GET', '/settings', () => core.settings());
A('PUT', '/settings', ({ body, user }) => {
  const allowed = Object.keys(core.DEFAULTS);
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.includes(k) || k === 'autopilot') continue;
    const def = core.DEFAULTS[k];
    d().settings[k] = typeof def === 'boolean' ? !!v : typeof def === 'number' ? Number(v) : v;
  }
  core.audit('settings', body, user.id); DB.save(); return core.settings();
});
A('GET', '/logs', ({ query }) => d().audit.filter(a => !query.action || a.action === query.action).slice(-250).reverse());
A('GET', '/export/orders.csv', ({ query }) => {
  const rows = [['Order', 'Date', 'Status', 'Customer', 'Email', 'Area', 'Items', 'Subtotal', 'Fee', 'Discount', 'Total', 'Payment', 'Rider']];
  d().orders.filter(o => !query.date || o.date === query.date).sort((a, b) => a.date.localeCompare(b.date)).forEach(o => { const c = DB.by('users', o.userId), a = core.addressOf(o.addressId), z = core.zoneOf(a), r = o.riderId && DB.by('users', o.riderId); rows.push([o.no, o.date, o.status, c?.name, c?.email, z?.name, o.items.map(i => `${i.name} ${i.pack} x${i.qty}`).join('; '), o.subtotal, o.fee, o.discount, o.total, o.payStatus, r?.name]); });
  return { __csv: csv(rows), name: 'gharfresh-orders.csv' };
});

module.exports = { routes: R, userView };
