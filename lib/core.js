'use strict';
// Business rules: wallet, notifications, orders, subscriptions, dispatch, delivery, refunds.
const DB = require('./db');
const hub = require('./hub');
const mail = require('./mail');
const U = require('./util');

const DEFAULTS = {
  storeName: 'GharFresh', city: 'Jaipur', supportPhone: '+91 98765 43210', supportEmail: 'support@gharfresh.in',
  cutoff: '22:00', genTime: '22:15', packTime: '04:00', restockTime: '03:00',
  deliveryWindow: '5:30 AM – 7:30 AM',
  slots: [{ id: 'early', label: '5:30 – 6:30 AM' }, { id: 'regular', label: '6:30 – 7:30 AM' }],
  autoGenerate: true, autoDispatch: true, autoPack: true, autoRelease: true, autoRestock: true,
  autoRefundFailed: true, autoStartRoutes: false, autoRecharge: true,
  autoRefundLimit: 150, riderPay: 12, lowStockAlert: 15,
  welcomeBonus: 50, referralBonus: 50, freeDeliveryAbove: 199,
  autopilot: false
};
function settings() { return Object.assign({}, DEFAULTS, DB.get().settings); }
function setting(k) { return settings()[k]; }
const cutoffMin = () => U.hhmm(setting('cutoff'));

function audit(action, details = {}, actor = null) {
  const a = DB.get().audit; a.push({ id: U.uid('a_'), at: new Date().toISOString(), action, actor, details });
  if (a.length > 3000) a.splice(0, a.length - 3000);
  DB.save();
}

// ---------- notifications ----------
function notify(userId, kind, title, body, data = {}) {
  const user = DB.by('users', userId);
  const n = { id: U.uid('n_'), userId, kind, title, body, data, read: false, at: new Date().toISOString(), email: !!(user && user.email && mail.enabled()), emailed: false };
  DB.get().notifications.push(n);
  const list = DB.get().notifications;
  if (list.length > 6000) list.splice(0, list.length - 6000);
  hub.emit(userId, 'notification', { id: n.id, kind, title, body, data });
  DB.save();
  return n;
}
function notifyAdmins(kind, title, body, data = {}) {
  hub.emit('admin', 'admin', { kind, title, body, data });
}

// ---------- wallet (the ONLY place a balance changes) ----------
function wallet(user) {
  if (!user.wallet) user.wallet = { balance: 0, autoRecharge: { on: false, threshold: 200, amount: 500 }, lowNotified: false };
  return user.wallet;
}
function walletApply(user, type, amount, orderId, desc) {
  amount = U.round(amount);
  if (!(amount > 0)) U.bad('Amount must be positive');
  const w = wallet(user);
  if (type === 'debit') {
    if (w.balance < amount) U.bad('Insufficient wallet balance');
    w.balance = U.round(w.balance - amount);
  } else w.balance = U.round(w.balance + amount);
  const tx = { id: U.uid('t_'), userId: user.id, orderId: orderId || null, type, amount, balanceAfter: w.balance, desc: desc || '', at: new Date().toISOString() };
  DB.get().txs.push(tx);
  hub.emit(user.id, 'wallet', { balance: w.balance });
  if (type !== 'debit') w.lowNotified = false;
  if (type === 'refund') notify(user.id, 'refund', `Refund of ₹${amount} processed`, `₹${amount} was added to your wallet. New balance ₹${w.balance}.`, { orderId });
  DB.save();
  return tx;
}
// after any debit: low balance warning + automatic recharge
function afterDebit(user) {
  const w = wallet(user);
  const th = w.autoRecharge.threshold || 200;
  if (w.autoRecharge.on && setting('autoRecharge') && w.balance < th) {
    const amt = w.autoRecharge.amount || 500;
    const bonus = topupBonus(amt);
    walletApply(user, 'credit', amt, null, 'Auto-recharge (UPI AutoPay)');
    if (bonus) walletApply(user, 'cashback', bonus, null, `Cashback on ₹${amt} recharge`);
    notify(user.id, 'wallet', 'Wallet auto-recharged', `₹${amt} added automatically because your balance fell below ₹${th}.`);
    audit('auto_recharge', { user: user.id, amount: amt });
  } else if (w.balance < th && !w.lowNotified) {
    w.lowNotified = true;
    notify(user.id, 'wallet_low', 'Wallet balance is low', `Your balance is ₹${w.balance}. Recharge so tomorrow's delivery is not held.`);
  }
}
const topupBonus = amt => (amt >= 2000 ? Math.round(amt * 0.06) : amt >= 1000 ? Math.round(amt * 0.05) : amt >= 500 ? Math.round(amt * 0.02) : 0);

// ---------- coupons ----------
function validateCoupon(user, code, subtotal, fee) {
  if (!code) return { discount: 0 };
  const c = DB.get().coupons.find(x => x.code === String(code).trim().toUpperCase() && x.active);
  if (!c) U.bad('Invalid or expired coupon');
  const today = U.istNow().date;
  if (c.validTo && c.validTo < today) U.bad('This coupon has expired');
  if (subtotal < (c.minOrder || 0)) U.bad(`Add items worth ₹${c.minOrder} to use ${c.code}`);
  if (c.firstOrderOnly && DB.get().orders.some(o => o.userId === user.id && !['cancelled'].includes(o.status))) U.bad('This coupon is only for your first order');
  if (c.perUserLimit && DB.get().orders.filter(o => o.userId === user.id && o.coupon === c.code && o.status !== 'cancelled').length >= c.perUserLimit) U.bad('You have already used this coupon');
  let discount = 0;
  if (c.type === 'percent') discount = Math.min(subtotal * c.value / 100, c.maxDiscount || 1e9);
  else if (c.type === 'flat') discount = Math.min(c.value, subtotal);
  else if (c.type === 'free_delivery') discount = fee;
  return { discount: U.round(discount), coupon: c };
}

// ---------- order helpers ----------
function addressOf(id) { return DB.by('addresses', id); }
function zoneOf(addr) { return addr && DB.by('zones', addr.zoneId); }
function deliveryFee(addr, subtotal) {
  const z = zoneOf(addr);
  if (!z) return 0;
  const free = z.freeAbove ?? setting('freeDeliveryAbove');
  return subtotal >= free ? 0 : z.fee || 0;
}
function line(p, qty) {
  return { productId: p.id, name: p.name, pack: p.pack, qty, price: p.price, mrp: p.mrp, image: (p.images && p.images[0]) || null };
}
function pushTimeline(o, status, note) {
  o.status = status;
  o.timeline.push({ status, at: new Date().toISOString(), note: note || '' });
  o.updatedAt = new Date().toISOString();
}
function orderView(o) {
  const addr = addressOf(o.addressId);
  const z = zoneOf(addr);
  const rider = o.riderId && DB.by('users', o.riderId);
  const loc = o.riderId && DB.get().riderLoc[o.riderId];
  let stopsAway = null;
  if (o.routeId && o.status === 'out_for_delivery') {
    const r = DB.by('routes', o.routeId);
    if (r) stopsAway = r.orderIds.map(id => DB.by('orders', id)).filter(x => x && x.status === 'out_for_delivery' && x.seq < o.seq).length;
  }
  return { ...o, address: addr ? { label: addr.label, house: addr.house, line1: addr.line1, landmark: addr.landmark, zone: z && z.name, lat: addr.lat, lng: addr.lng, instructions: addr.instructions } : null,
    rider: rider ? { id: rider.id, name: rider.name, phone: rider.phone } : null, riderLoc: loc || null, stopsAway,
    canCancel: o.status === 'pending' && o.date >= U.nextEligible(cutoffMin()) };
}

// restock bookkeeping
function takeStock(p, qty) {
  if (p.stock < qty) U.bad(`${p.name} (${p.pack}) is out of stock`);
  p.stock -= qty;
  if (p.stock <= setting('lowStockAlert')) notifyAdmins('low_stock', 'Low stock', `${p.name} ${p.pack}: only ${p.stock} left`, { productId: p.id });
}

// one-time basket order, paid from wallet. Prices always come from the server.
function placeBasketOrder(user, { addressId, items, couponCode, slot, payFromWallet = true }) {
  assertActive(user);
  const addr = addressOf(addressId);
  if (!addr || addr.userId !== user.id || addr.deleted) U.bad('Please choose a valid delivery address');
  const z = zoneOf(addr); if (!z || !z.active) U.bad('Sorry, we do not deliver to this area yet');
  if (!Array.isArray(items) || !items.length) U.bad('Your basket is empty');
  const date = U.nextEligible(cutoffMin());
  const lines = []; let subtotal = 0;
  for (const it of items) {
    const p = DB.by('products', it.productId);
    const q = Math.floor(Number(it.qty));
    if (!p || !p.active) U.bad('A product in your basket is no longer available');
    if (!(q >= 1 && q <= 20)) U.bad('Invalid quantity');
    if (p.stock < q) U.bad(`${p.name} (${p.pack}) — only ${p.stock} left`);
    lines.push({ p, q }); subtotal += p.price * q;
  }
  const fee = deliveryFee(addr, subtotal);
  const { discount, coupon } = validateCoupon(user, couponCode, subtotal, fee);
  const total = U.round(subtotal + fee - discount);
  const w = wallet(user);
  if (w.balance < total) { const e = new U.HttpError(402, `Wallet balance is ₹${w.balance}. Add ₹${Math.ceil(total - w.balance)} more to place this order.`); e.shortfall = Math.ceil(total - w.balance); throw e; }
  for (const { p, q } of lines) takeStock(p, q);
  const o = {
    id: U.uid('o_'), no: DB.nextOrderNo(), userId: user.id, addressId, subId: null, date, slot: slot || 'regular', source: 'basket',
    status: 'pending', items: lines.map(({ p, q }) => line(p, q)), subtotal: U.round(subtotal), fee, discount, total, coupon: coupon ? coupon.code : null,
    payStatus: 'paid', riderId: null, routeId: null, seq: null, timeline: [], createdAt: new Date().toISOString()
  };
  pushTimeline(o, 'pending', 'Order placed');
  DB.get().orders.push(o);
  if (total > 0) walletApply(user, 'debit', total, o.id, `Order #${o.no}`);
  afterDebit(user);
  notify(user.id, 'order', `Order #${o.no} confirmed`, `₹${total} paid from wallet. Delivery on ${date} between ${setting('deliveryWindow')}.`, { orderId: o.id });
  notifyAdmins('new_order', 'New order', `#${o.no} · ₹${total}`, { orderId: o.id });
  audit('order_placed', { order: o.id, total });
  if (setting('autoDispatch')) dispatch(date);
  return o;
}

function assertActive(user) { if (user.blocked) U.bad('Your account is blocked. Please contact support.', 403); }

function restock(o) { for (const it of o.items) { const p = DB.by('products', it.productId); if (p) p.stock += it.qty; } }

function cancelOrder(user, o, byAdmin = false) {
  if (!byAdmin) {
    if (o.userId !== user.id) U.bad('Order not found', 404);
    if (o.status !== 'pending' && o.status !== 'on_hold') U.bad('This order can no longer be cancelled');
    if (o.date < U.nextEligible(cutoffMin())) U.bad('Cut-off time has passed for this order');
  }
  if (['delivered', 'cancelled'].includes(o.status)) U.bad('Order cannot be cancelled');
  restock(o);
  const customer = DB.by('users', o.userId);
  pushTimeline(o, 'cancelled', byAdmin ? 'Cancelled by admin' : 'Cancelled by you');
  if (o.payStatus === 'paid' && o.total > 0) { o.payStatus = 'refunded'; walletApply(customer, 'refund', o.total, o.id, `Order #${o.no} cancelled`); }
  detachFromRoute(o);
  audit('order_cancelled', { order: o.id, byAdmin });
}

function detachFromRoute(o) {
  if (!o.routeId) return;
  const r = DB.by('routes', o.routeId);
  if (r) r.orderIds = r.orderIds.filter(id => id !== o.id);
  o.routeId = null; o.riderId = null; o.seq = null;
}

// ---------- subscriptions ----------
function createSubscription(user, b) {
  assertActive(user);
  const addr = addressOf(b.addressId);
  if (!addr || addr.userId !== user.id || addr.deleted) U.bad('Invalid address');
  const p = DB.by('products', b.productId);
  if (!p || !p.active || !p.subOk) U.bad('This product is not available for subscription');
  const qty = Math.floor(Number(b.qty));
  if (!(qty >= 1 && qty <= 10)) U.bad('Invalid quantity');
  const freq = b.freq;
  if (!['daily', 'alternate_days', 'weekdays', 'weekends', 'custom', 'one_time'].includes(freq)) U.bad('Invalid frequency');
  if (freq === 'custom' && !(b.customDays || []).length) U.bad('Select at least one day');
  const eligible = U.nextEligible(cutoffMin());
  const start = b.start && b.start > eligible ? b.start : eligible;
  const s = { id: U.uid('s_'), userId: user.id, addressId: addr.id, productId: p.id, qty, freq, customDays: b.customDays || [], start, end: b.end || null,
    status: 'active', next: start, pauseDates: [], slot: b.slot || 'regular', createdAt: new Date().toISOString() };
  // for weekday-based plans make sure start lands on a valid day
  if (freq === 'weekdays' && [0, 6].includes(U.dowOf(start))) s.next = U.nextOccurrence('weekdays', [], start);
  if (freq === 'weekends' && ![0, 6].includes(U.dowOf(start))) s.next = U.nextOccurrence('weekends', [], start);
  if (freq === 'custom' && !s.customDays.includes(U.DAYS[U.dowOf(start)])) s.next = U.nextOccurrence('custom', s.customDays, start);
  DB.get().subscriptions.push(s);
  notify(user.id, 'subscription', 'Subscription started', `${p.name} ${p.pack} × ${qty} will be delivered from ${s.next}.`, { subId: s.id });
  audit('sub_created', { sub: s.id });
  return s;
}

// ---------- nightly generation ----------
function generateForDate(target, { by = 'system' } = {}) {
  const d = DB.get();
  let created = 0, held = 0, skipped = 0, errors = 0;
  // 1) catch up subscriptions whose date is in the past (after pause/resume)
  for (const s of d.subscriptions) {
    if (s.status !== 'active' || !s.next || s.next >= target) continue;
    let n = s.next, guard = 0;
    while (n && n < target && guard++ < 400) n = U.nextOccurrence(s.freq, s.customDays, n);
    if (!n) { s.status = 'completed'; s.next = null; } else s.next = n;
  }
  // 2) one order per customer + address
  const groups = new Map();
  for (const s of d.subscriptions) if (s.status === 'active' && s.next === target) {
    const k = s.userId + '|' + s.addressId + '|' + (s.slot || 'regular');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  for (const subs of groups.values()) {
    const user = DB.by('users', subs[0].userId), addr = addressOf(subs[0].addressId);
    try {
      if (d.orders.some(o => o.subId && subs.some(s => s.id === o.subId) && o.date === target && o.status !== 'cancelled')) continue; // already generated
      const ok = user && !user.blocked && addr && !addr.deleted && zoneOf(addr) && zoneOf(addr).active;
      const lines = [];
      for (const s of subs) {
        const next = U.nextOccurrence(s.freq, s.customDays, target);
        if (!next || (s.end && next > s.end)) { s.status = 'completed'; s.next = null; } else s.next = next;
        if (!ok || (s.end && s.end < target) || (s.pauseDates || []).includes(target)) { skipped++; continue; }
        const p = DB.by('products', s.productId);
        if (!p || !p.active || p.stock < s.qty) {
          skipped++; audit('sub_skipped', { sub: s.id, date: target, reason: 'unavailable or out of stock' });
          if (user) notify(user.id, 'subscription', 'Item skipped', `${p ? p.name : 'A product'} was unavailable for ${target}. You were not charged for it.`);
          continue;
        }
        lines.push({ p, q: s.qty, s });
      }
      if (!lines.length) continue;
      for (const { p, q } of lines) takeStock(p, q);
      const subtotal = U.round(lines.reduce((a, { p, q }) => a + p.price * q, 0));
      const fee = deliveryFee(addr, subtotal), total = U.round(subtotal + fee);
      const o = { id: U.uid('o_'), no: DB.nextOrderNo(), userId: user.id, addressId: addr.id, subId: lines[0].s.id, subIds: lines.map(l => l.s.id), date: target, slot: subs[0].slot || 'regular', source: 'subscription',
        status: 'pending', items: lines.map(({ p, q }) => line(p, q)), subtotal, fee, discount: 0, total, coupon: null, payStatus: 'unpaid', riderId: null, routeId: null, seq: null, timeline: [], createdAt: new Date().toISOString() };
      pushTimeline(o, 'pending', 'Auto-generated from your subscription');
      d.orders.push(o);
      if (wallet(user).balance >= total) {
        walletApply(user, 'debit', total, o.id, `Delivery on ${target}`); o.payStatus = 'paid'; created++;
        notify(user.id, 'order', `Delivery confirmed for ${target}`, `₹${total} paid from wallet. Arrives ${setting('deliveryWindow')}.`, { orderId: o.id });
        afterDebit(user);
      } else {
        pushTimeline(o, 'on_hold', 'Wallet balance too low'); held++;
        notify(user.id, 'order_on_hold', `Delivery on ${target} is on hold`, `Wallet ₹${wallet(user).balance} is less than ₹${total}. Add money and it releases automatically — you have not been charged.`, { orderId: o.id });
      }
    } catch (e) { errors++; audit('generation_error', { user: subs[0].userId, error: e.message }); }
  }
  const res = { delivery_date: target, created, on_hold: held, skipped_items: skipped, errors };
  audit('nightly_generation', { ...res, by });
  DB.save();
  return res;
}

// released automatically when the customer tops up
function releaseHeldOrders(userId) {
  let n = 0;
  const today = U.istNow().date;
  for (const o of DB.get().orders) {
    if (o.status !== 'on_hold' || (userId && o.userId !== userId)) continue;
    const user = DB.by('users', o.userId);
    if (o.date < today) continue;
    if (wallet(user).balance >= o.total) {
      walletApply(user, 'debit', o.total, o.id, `Delivery on ${o.date}`); o.payStatus = 'paid';
      pushTimeline(o, 'pending', 'Released after wallet top-up'); n++;
      notify(user.id, 'order', `Delivery on ${o.date} released`, `₹${o.total} paid from wallet. See you in the morning!`, { orderId: o.id });
      afterDebit(user);
      if (setting('autoDispatch')) dispatch(o.date);
    }
  }
  if (n) audit('auto_release', { count: n });
  return n;
}

// ---------- dispatch: zone routes, nearest-neighbour stop order, balanced rider assignment ----------
function dispatch(date) {
  const d = DB.get();
  const orders = d.orders.filter(o => o.date === date && ['pending', 'packed'].includes(o.status) && !o.riderId);
  if (!orders.length) return { routes: 0, assigned: 0 };
  const riders = d.users.filter(u => u.role === 'rider' && !u.blocked && u.active !== false);
  let assigned = 0, newRoutes = 0;
  const byZone = {};
  for (const o of orders) { const z = (addressOf(o.addressId) || {}).zoneId || 'none'; (byZone[z] = byZone[z] || []).push(o); }
  const load = id => d.orders.filter(o => o.date === date && o.riderId === id && o.status !== 'cancelled').length;
  for (const [zid, list] of Object.entries(byZone)) {
    const zone = DB.by('zones', zid);
    const pool = riders.filter(r => !r.zoneIds || !r.zoneIds.length || r.zoneIds.includes(zid));
    const cand = (pool.length ? pool : riders).slice().sort((a, b) => load(a.id) - load(b.id));
    if (!cand.length) { audit('dispatch_no_rider', { zone: zid, date }); continue; }
    const rider = cand[0];
    let route = d.routes.find(r => r.date === date && r.zoneId === zid && r.riderId === rider.id && r.status !== 'completed');
    if (!route) { route = { id: U.uid('r_'), date, zoneId: zid, name: `${zone ? zone.name : 'Area'} · ${date}`, riderId: rider.id, status: 'planned', orderIds: [], createdAt: new Date().toISOString() }; d.routes.push(route); newRoutes++; }
    // nearest-neighbour ordering starting from the zone centre
    let cur = zone ? { lat: zone.lat, lng: zone.lng } : null;
    const all = route.orderIds.map(id => DB.by('orders', id)).concat(list).filter(Boolean);
    const rest = all.slice(); const seq = [];
    while (rest.length) {
      let bi = 0, bd = Infinity;
      rest.forEach((o, i) => { const a = addressOf(o.addressId); const dist = cur && a ? U.km(cur, a) : i; if (dist < bd) { bd = dist; bi = i; } });
      const o = rest.splice(bi, 1)[0]; seq.push(o); cur = addressOf(o.addressId) || cur;
    }
    seq.forEach((o, i) => { o.seq = i + 1; o.routeId = route.id; o.riderId = rider.id; });
    route.orderIds = seq.map(o => o.id);
    assigned += list.length;
    notify(rider.id, 'route', `New route: ${route.name}`, `${seq.length} stops assigned.`, { routeId: route.id });
  }
  if (assigned) audit('auto_dispatch', { date, assigned, routes: newRoutes });
  DB.save();
  hub.emit('riders', 'route', { date });
  return { routes: newRoutes, assigned };
}

function packOrders(date) {
  let n = 0;
  for (const o of DB.get().orders) if (o.date === date && o.status === 'pending') { pushTimeline(o, 'packed', 'Packed at our dairy hub'); n++; hub.emit(o.userId, 'order', { id: o.id, status: o.status }); }
  if (n) audit('auto_pack', { date, count: n });
  DB.save();
  return n;
}

function startRoute(route) {
  if (route.status === 'planned') route.status = 'in_progress';
  let n = 0;
  for (const id of route.orderIds) {
    const o = DB.by('orders', id);
    if (o && ['pending', 'packed'].includes(o.status)) {
      if (o.status === 'pending') pushTimeline(o, 'packed', 'Packed');
      pushTimeline(o, 'out_for_delivery', 'Rider left with your order'); n++;
      const r = DB.by('users', route.riderId);
      notify(o.userId, 'order', 'Your order is out for delivery 🚚', `${r ? r.name : 'Your rider'} is on the way with order #${o.no}.`, { orderId: o.id });
      hub.emit(o.userId, 'order', { id: o.id, status: o.status });
    }
  }
  DB.save();
  return n;
}

function markDelivered(o, { photo, lat, lng, at, riderId }) {
  if (!['out_for_delivery', 'packed', 'pending'].includes(o.status)) U.bad('This order is not active');
  if (!photo || lat == null || lng == null) U.bad('Photo and GPS location are required to complete a delivery');
  const when = at ? new Date(at).toISOString() : new Date().toISOString();
  o.proof = { photo, lat: Number(lat), lng: Number(lng), at: when, riderId };
  o.riderPay = setting('riderPay');
  pushTimeline(o, 'delivered', 'Delivered');
  const r = o.routeId && DB.by('routes', o.routeId);
  if (r && r.orderIds.every(id => { const x = DB.by('orders', id); return x && ['delivered', 'failed', 'cancelled'].includes(x.status); })) { r.status = 'completed'; r.completedAt = new Date().toISOString(); }
  notify(o.userId, 'order', 'Delivered ✅', `Order #${o.no} was delivered. Tap to see the delivery photo and rate your order.`, { orderId: o.id });
  hub.emit(o.userId, 'order', { id: o.id, status: 'delivered' });
  notifyAdmins('delivered', 'Delivered', `#${o.no}`, { orderId: o.id });
  // referral / welcome rewards on a customer's first delivery
  const user = DB.by('users', o.userId);
  if (user && !user.firstDelivered) {
    user.firstDelivered = true;
    if (user.referredBy) {
      const ref = DB.get().users.find(u => u.referralCode === user.referredBy);
      const amt = setting('referralBonus');
      if (ref && amt > 0) { walletApply(ref, 'cashback', amt, null, `Referral reward: ${user.name || 'a friend'} got their first delivery`); walletApply(user, 'cashback', amt, null, 'Referral welcome reward'); }
    }
  }
  audit('delivered', { order: o.id, rider: riderId });
  DB.save();
}

function refundOrder(o, reason, auto) {
  if (o.payStatus !== 'paid' || o.total <= 0) return false;
  const user = DB.by('users', o.userId);
  o.payStatus = 'refunded';
  restock(o);
  walletApply(user, 'refund', o.total, o.id, reason || `Refund for order #${o.no}`);
  audit('refund', { order: o.id, auto: !!auto, amount: o.total });
  return true;
}

const REASONS = { customer_absent: 'the customer was not available', gate_closed: 'the gate was closed', wrong_address: 'the address could not be found', refused: 'the order was refused', vehicle_issue: 'a vehicle problem', other: 'an unexpected issue' };
function markFailed(o, { reason, notes, lat, lng, riderId }) {
  if (!['out_for_delivery', 'packed', 'pending'].includes(o.status)) U.bad('This order is not active');
  if (!REASONS[reason]) U.bad('Please choose a reason');
  o.fail = { reason, notes: notes || '', lat, lng, at: new Date().toISOString(), riderId };
  pushTimeline(o, 'failed', 'Could not deliver: ' + REASONS[reason]);
  const r = o.routeId && DB.by('routes', o.routeId);
  if (r && r.orderIds.every(id => { const x = DB.by('orders', id); return x && ['delivered', 'failed', 'cancelled'].includes(x.status); })) { r.status = 'completed'; r.completedAt = new Date().toISOString(); }
  let msg = `We could not deliver order #${o.no} because ${REASONS[reason]}.`;
  if (setting('autoRefundFailed') && refundOrder(o, `Refund for undelivered order #${o.no}`, true)) msg += ` ₹${o.total} has been refunded to your wallet automatically.`;
  notify(o.userId, 'order', 'We missed your delivery', msg, { orderId: o.id });
  hub.emit(o.userId, 'order', { id: o.id, status: 'failed' });
  notifyAdmins('failed', 'Delivery failed', `#${o.no}: ${REASONS[reason]}`, { orderId: o.id });
  DB.save();
}

// ---------- complaints (auto-resolution rules) ----------
function fileComplaint(user, o, { type, description }) {
  if (!['not_received', 'wrong_item', 'quality', 'billing', 'other'].includes(type)) U.bad('Choose a complaint type');
  if (o.userId !== user.id) U.bad('Order not found', 404);
  const d = DB.get();
  const c = { id: U.uid('c_'), userId: user.id, orderId: o.id, type, description: U.cleanStr(description, 500), status: 'open', resolution: null, refund: 0, createdAt: new Date().toISOString() };
  const recent = d.complaints.filter(x => x.userId === user.id && x.status === 'resolved' && x.refund > 0 && Date.now() - new Date(x.createdAt) < 30 * 86400000).length;
  const limit = setting('autoRefundLimit');
  if (['not_received', 'quality', 'wrong_item'].includes(type) && o.payStatus === 'paid' && o.total <= limit && recent < 2 && o.status === 'delivered' || (type === 'not_received' && o.status === 'failed')) {
    if (o.payStatus === 'paid') {
      const amt = o.total;
      o.payStatus = 'refunded';
      walletApply(user, 'refund', amt, o.id, `Complaint refund for order #${o.no}`);
      c.status = 'resolved'; c.refund = amt; c.resolution = 'Auto-approved: refunded to wallet'; c.resolvedAt = new Date().toISOString();
      notify(user.id, 'complaint', 'Complaint resolved', `Sorry about that! ₹${amt} was refunded to your wallet instantly.`, { orderId: o.id });
    }
  }
  if (c.status === 'open') { notify(user.id, 'complaint', 'Complaint received', 'Our team will review it within a few hours.', { orderId: o.id }); notifyAdmins('complaint', 'New complaint', `#${o.no}: ${type}`, { complaintId: c.id }); }
  d.complaints.push(c);
  audit('complaint', { id: c.id, status: c.status });
  DB.save();
  return c;
}

module.exports = { settings, setting, cutoffMin, audit, notify, notifyAdmins, wallet, walletApply, afterDebit, topupBonus, validateCoupon, addressOf, zoneOf, deliveryFee, orderView,
  placeBasketOrder, cancelOrder, createSubscription, generateForDate, releaseHeldOrders, dispatch, packOrders, startRoute, markDelivered, markFailed, refundOrder, fileComplaint,
  pushTimeline, assertActive, restock, REASONS, DEFAULTS };
