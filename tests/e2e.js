// End-to-end API test. Usage: node server.js (fresh DATA_DIR) then: BASE=http://localhost:3000 node tests/e2e.js
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘ FAIL:', m); } };
async function api(m, p, body, tok) {
  const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
}
const login = async role => (await api('POST', '/api/auth/demo', { role })).j.token;

(async () => {
  console.log('Auth');
  const boot = (await api('GET', '/api/bootstrap')).j;
  ok(boot.products.length >= 15, `catalogue has ${boot.products.length} products`);
  ok(boot.products.every(p => p.images.length >= 5), 'every product has 5+ photos');
  const email = 'test' + Date.now() + '@t.in';
  const o1 = await api('POST', '/api/auth/otp', { email });
  ok(o1.j.devOtp, 'OTP issued (demo mode)');
  const bad = await api('POST', '/api/auth/verify', { email, code: '000000' });
  ok(bad.s === 400, 'wrong OTP rejected');
  const v = await api('POST', '/api/auth/verify', { email, code: o1.j.devOtp, name: 'Test User' });
  ok(v.j.token, 'OTP login works, new customer created');
  const T = v.j.token;
  const me = (await api('GET', '/api/me', null, T)).j;
  ok(me.user.wallet.balance === boot.settings.welcomeBonus, `welcome bonus ₹${me.user.wallet.balance} credited`);

  console.log('Address + basket');
  ok((await api('POST', '/api/addresses', { house: '', line1: '', zoneId: boot.zones[0].id }, T)).s === 400, 'incomplete address rejected');
  const ad = (await api('POST', '/api/addresses', { label: 'Home', house: 'A-1', line1: 'Test Society', zoneId: boot.zones[0].id }, T)).j;
  ok(ad.id && ad.isDefault, 'address created and default');
  const milk = boot.products.find(p => p.name.includes('Cow Milk') && p.pack === '1 L');
  const ghee = boot.products.find(p => p.name.includes('A2 Bilona'));
  const q = (await api('POST', '/api/orders/quote', { addressId: ad.id, items: [{ productId: ghee.id, qty: 2 }] }, T)).j;
  ok(q.total > q.balance, 'quote shows shortfall');
  const poor = await api('POST', '/api/orders', { addressId: ad.id, items: [{ productId: ghee.id, qty: 2 }] }, T);
  ok(poor.s === 402 && poor.j.shortfall > 0, 'order blocked with exact shortfall');
  const top = (await api('POST', '/api/wallet/topup', { amount: 1000 }, T)).j;
  ok(top.bonus === 50 && top.wallet.balance === boot.settings.welcomeBonus + 1050, 'top-up ₹1000 gives 5% cashback');
  const bq = await api('POST', '/api/orders/quote', { addressId: ad.id, items: [{ productId: milk.id, qty: 3 }], couponCode: 'WELCOME50' }, T);
  ok(bq.j.couponError, 'WELCOME50 needs ₹199 minimum (' + bq.j.couponError + ')');
  const stockBefore = (await api('GET', '/api/products/' + milk.id)).j.product.stock;
  const ord = await api('POST', '/api/orders', { addressId: ad.id, items: [{ productId: milk.id, qty: 4 }], couponCode: 'WELCOME50' }, T);
  ok(ord.s === 200 && ord.j.discount === 50, 'order placed, coupon applied');
  ok((await api('GET', '/api/products/' + milk.id)).j.product.stock === stockBefore - 4, 'stock reduced');
  ok(ord.j.riderId, 'rider auto-assigned: ' + (ord.j.rider && ord.j.rider.name));
  const w1 = (await api('GET', '/api/wallet', null, T)).j;
  ok(w1.wallet.balance === boot.settings.welcomeBonus + 1050 - ord.j.total, 'wallet debited exactly');
  const cancel = await api('POST', `/api/orders/${ord.j.id}/cancel`, null, T);
  ok(cancel.s === 200 && cancel.j.status === 'cancelled', 'cancel before cut-off');
  const w2 = (await api('GET', '/api/wallet', null, T)).j;
  ok(w2.wallet.balance === boot.settings.welcomeBonus + 1050 && w2.txs[0].type === 'refund', 'refund returned to wallet');
  ok((await api('GET', '/api/products/' + milk.id)).j.product.stock === stockBefore, 'stock restored on cancel');

  console.log('Subscription + nightly automation');
  const sub = (await api('POST', '/api/subscriptions', { addressId: ad.id, productId: milk.id, qty: 2, freq: 'daily' }, T)).j;
  ok(sub.id && sub.next, 'subscription starts ' + sub.next);
  ok((await api('PATCH', '/api/subscriptions/' + sub.id, { action: 'skip', date: sub.next }, T)).j.pauseDates.length === 1, 'skip a day');
  await api('PATCH', '/api/subscriptions/' + sub.id, { action: 'unskip', date: sub.next }, T);
  const AD = await login('admin');
  const gen = (await api('POST', '/api/admin/generate', { date: sub.next }, AD)).j;
  ok(gen.created >= 1, `admin generate: ${gen.created} orders created, ${gen.on_hold} on hold`);
  const mine = (await api('GET', '/api/orders', null, T)).j.find(o => o.date === sub.next && o.status !== 'cancelled');
  ok(mine && mine.payStatus === 'paid' && mine.riderId, 'subscription order generated, paid from wallet, rider assigned');
  const gen2 = (await api('POST', '/api/admin/generate', { date: sub.next }, AD)).j;
  ok((await api('GET', '/api/orders', null, T)).j.filter(o => o.date === sub.next && o.status !== 'cancelled').length === 1, 'running twice never duplicates orders');

  console.log('Low-wallet hold + auto release');
  const held = (await api('GET', '/api/admin/orders?status=on_hold', null, AD)).j;
  ok(held.length >= 1, `${held.length} order(s) on hold (wallet too low)`);
  const hc = held[0];
  const cust = (await api('GET', '/api/admin/customers', null, AD)).j.find(c => c.email === hc.customer.email);
  const bal = cust.balance;
  await api('POST', `/api/admin/customers/${cust.id}/wallet`, { type: 'credit', amount: 2000 }, AD);
  const after = (await api('GET', '/api/admin/orders?q=' + hc.no, null, AD)).j.find(o => o.id === hc.id);
  ok(after.status === 'pending' && after.payStatus === 'paid', 'held order auto-released after top-up');

  console.log('Rider flow');
  const RD = await login('rider');
  const rt = (await api('GET', '/api/rider/route?date=' + gen.delivery_date, null, RD)).j;
  const others = (await api('GET', '/api/admin/orders?date=' + gen.delivery_date, null, AD)).j.filter(o => o.riderId);
  ok(others.length > 0, `${others.length} orders routed to riders for ${gen.delivery_date}`);
  const riders = (await api('GET', '/api/admin/riders', null, AD)).j;
  let riderTok = null, stops = [];
  for (const r of riders) { const tok = (await api('POST', '/api/auth/demo', { role: 'rider' })).j.token; }
  // find the rider who owns our order
  const myOrder = mine; const rr = riders.find(r => r.id === myOrder.riderId);
  const em = rr.email; const code = (await api('POST', '/api/auth/otp', { email: em })).j.devOtp; riderTok = (await api('POST', '/api/auth/verify', { email: em, code })).j.token;
  stops = (await api('GET', '/api/rider/route?date=' + sub.next, null, riderTok)).j.stops;
  ok(stops.length && stops.some(s => s.id === myOrder.id), `rider sees ${stops.length} stops`);
  ok((await api('POST', '/api/rider/orders/' + myOrder.id + '/delivered', { photo: 'x', lat: 1, lng: 1 }, riderTok)).s === 400, 'delivery without valid photo rejected');
  const st = await api('POST', '/api/rider/start', { date: sub.next }, riderTok);
  ok(st.j.started >= 1, 'route started');
  ok((await api('GET', '/api/orders/' + myOrder.id, null, T)).j.status === 'out_for_delivery', 'customer sees out_for_delivery');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const dl = await api('POST', '/api/rider/orders/' + myOrder.id + '/delivered', { photo: png, lat: 26.9, lng: 75.8 }, riderTok);
  ok(dl.s === 200, 'delivered with photo + GPS');
  const del = (await api('GET', '/api/orders/' + myOrder.id, null, T)).j;
  ok(del.status === 'delivered' && del.proof.photo.startsWith('/uploads/'), 'proof photo stored: ' + del.proof.photo);
  const rate = await api('POST', `/api/orders/${myOrder.id}/rate`, { stars: 5, text: 'Great!' }, T);
  ok(rate.s === 200 && rate.j.rating.stars === 5, 'customer rated order');
  const nt = (await api('GET', '/api/notifications', null, T)).j;
  ok(nt.some(n => n.title.includes('Delivered')), 'customer got delivered notification');

  console.log('Failed delivery -> automatic refund');
  const second = others.find(o => o.id !== myOrder.id && o.status !== 'on_hold');
  const rr2 = riders.find(r => r.id === second.riderId);
  const c2 = (await api('POST', '/api/auth/otp', { email: rr2.email })).j.devOtp; const t2 = (await api('POST', '/api/auth/verify', { email: rr2.email, code: c2 })).j.token;
  await api('POST', '/api/rider/start', { date: gen.delivery_date }, t2);
  const f = await api('POST', `/api/rider/orders/${second.id}/failed`, { reason: 'customer_absent' }, t2);
  ok(f.s === 200, 'rider marked failed');
  const fo = (await api('GET', '/api/admin/orders?q=' + second.no, null, AD)).j[0];
  ok(fo.status === 'failed' && fo.payStatus === 'refunded', 'failed order auto-refunded to wallet');

  console.log('Complaints');
  const cm = await api('POST', `/api/orders/${myOrder.id}/complain`, { type: 'quality', description: 'test' }, T);
  ok(cm.s === 200 && cm.j.status === 'resolved' && cm.j.refund > 0, 'small complaint auto-refunded: ₹' + cm.j.refund);

  console.log('Admin');
  const dash = (await api('GET', '/api/admin/dashboard', null, AD)).j;
  ok(dash.series.length === 14 && dash.kpis.customers > 10, 'dashboard data (customers ' + dash.kpis.customers + ', 14-day series)');
  ok((await api('GET', '/api/admin/dashboard', null, T)).s === 403, 'customer cannot open admin API');
  const np = (await api('POST', '/api/admin/products', { catId: boot.categories[0].id, name: 'Test Milk', pack: '250 ml', price: 20, mrp: 22, stock: 10, subOk: true, images: ['/products/cow-milk-500ml.svg'] }, AD)).j;
  ok(np.id, 'admin created product');
  ok((await api('PUT', '/api/admin/products/' + np.id, { price: 25 }, AD)).j.price === 25, 'admin edited price');
  ok((await api('GET', '/api/admin/export/orders.csv', null, AD)).j.startsWith('"Order"'), 'CSV export works');
  const demo = await api('POST', '/api/admin/demo-day', null, AD);
  ok(demo.j.created > 0, 'demo day started: ' + demo.j.created + ' orders');
  await new Promise(r => setTimeout(r, 20000));
  const st2 = (await api('GET', '/api/admin/dashboard', null, AD)).j;
  ok(st2.today.delivered > 0, 'autopilot delivered ' + st2.today.delivered + ' orders live');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
