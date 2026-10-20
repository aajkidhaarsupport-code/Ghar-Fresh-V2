'use strict';
// First-run demo data: Jaipur zones, 20 products with photo galleries, coupons, banners, demo people and 14 days of history.
const DB = require('./db');
const U = require('./util');
const core = require('./core');
const photos = require('./photos.json');

const ZONES = [
  { name: 'Vaishali Nagar', pincode: '302021', fee: 15, lat: 26.9124, lng: 75.7424 },
  { name: 'Malviya Nagar', pincode: '302017', fee: 15, lat: 26.8566, lng: 75.8143 },
  { name: 'Mansarovar', pincode: '302020', fee: 20, lat: 26.8467, lng: 75.7623 },
  { name: 'C-Scheme', pincode: '302001', fee: 0, lat: 26.9065, lng: 75.8010 },
  { name: 'Jagatpura', pincode: '302017', fee: 25, lat: 26.8420, lng: 75.8530 }
];
const CATS = [
  ['Milk', 'milk', '🥛', '#E3F1EA'], ['Curd & Drinks', 'curd-drinks', '🥣', '#E6EDFA'], ['Paneer', 'paneer', '🧀', '#FFF1D2'],
  ['Ghee & Butter', 'ghee-butter', '🧈', '#FFEBC2'], ['Eggs', 'eggs', '🥚', '#FBE8DA'], ['Bread', 'bread', '🍞', '#F4E5D0'], ['Pantry', 'pantry', '🍯', '#FBEAB8']
];

// gallery: 5 real photos (rotated through the pools so products differ) + our pack-shot illustration
function gallery(keys, offset, slug) {
  const pools = keys.map(k => photos[k] || []);
  const mixed = []; const max = Math.max(...pools.map(p => p.length));
  for (let i = 0; i < max; i++) for (const p of pools) if (p[i]) mixed.push(p[i].url);
  const n = mixed.length, out = [];
  for (let i = 0; i < n && out.length < 5; i++) { const u = mixed[(offset + i) % n]; if (!out.includes(u)) out.push(u); }
  out.push(`/products/${slug}.svg`);
  return out;
}

// [cat, name, pack, mrp, price, subOk, slug, description, pools, offset, nutrition, shelf, source, tags, par]
const P = [
  ['milk', 'Farm Fresh Cow Milk', '500 ml', 30, 28, true, 'cow-milk-500ml', 'Fresh cow milk from partner farms around Jaipur, chilled within 2 hours of milking and packed the same night. Pasteurised, no preservatives, no added water.', ['milk'], 0, { Energy: '62 kcal', Protein: '3.2 g', Fat: '3.5 g', Calcium: '120 mg' }, '2 days chilled', 'Partner farms, Jaipur', ['Bestseller', 'Daily'], 120],
  ['milk', 'Farm Fresh Cow Milk', '1 L', 58, 55, true, 'cow-milk-1l', 'Our everyday family pack. Fresh cow milk, pasteurised and delivered before 7:30 AM in a reusable-friendly pouch.', ['milk'], 3, { Energy: '62 kcal', Protein: '3.2 g', Fat: '3.5 g', Calcium: '120 mg' }, '2 days chilled', 'Partner farms, Jaipur', ['Bestseller', 'Family pack'], 150],
  ['milk', 'Buffalo Milk', '500 ml', 38, 36, true, 'buffalo-milk-500ml', 'Thick, creamy full-fat buffalo milk (6% fat). Perfect for chai, kheer, mithai and thick curd.', ['farm', 'milk'], 1, { Energy: '97 kcal', Protein: '3.7 g', Fat: '6.9 g', Calcium: '169 mg' }, '2 days chilled', 'Partner dairies, Jaipur', ['Full cream'], 90],
  ['milk', 'Buffalo Milk', '1 L', 74, 70, true, 'buffalo-milk-1l', 'Rich, high-fat buffalo milk in a family pack. Makes the creamiest curd and the best chai.', ['farm', 'milk'], 4, { Energy: '97 kcal', Protein: '3.7 g', Fat: '6.9 g', Calcium: '169 mg' }, '2 days chilled', 'Partner dairies, Jaipur', ['Full cream', 'Family pack'], 90],
  ['milk', 'A2 Desi Cow Milk', '1 L', 90, 85, true, 'a2-desi-cow-milk-1l', 'A2 beta-casein milk from desi Gir and Sahiwal cows. Naturally easy to digest, rich in taste.', ['milk', 'farm'], 5, { Energy: '65 kcal', Protein: '3.4 g', Fat: '4.0 g', Calcium: '125 mg' }, '2 days chilled', 'Desi cow gaushala', ['A2', 'Premium'], 60],
  ['curd-drinks', 'Fresh Set Curd', '400 g', 40, 38, true, 'set-curd-400g', 'Thick, creamy set curd made every day from farm milk using a traditional culture. No stabilisers.', ['curd'], 0, { Energy: '98 kcal', Protein: '11 g', Fat: '4.3 g', Calcium: '83 mg' }, '4 days chilled', 'Our dairy kitchen', ['Probiotic'], 80],
  ['curd-drinks', 'Fresh Set Curd', '1 kg', 95, 90, true, 'set-curd-1kg', 'Family pack of our thick set curd. Great for raita, kadhi and lassi at home.', ['curd'], 2, { Energy: '98 kcal', Protein: '11 g', Fat: '4.3 g', Calcium: '83 mg' }, '4 days chilled', 'Our dairy kitchen', ['Probiotic', 'Family pack'], 60],
  ['curd-drinks', 'Masala Chaas (Buttermilk)', '500 ml', 25, 22, true, 'masala-chaas-500ml', 'Lightly spiced buttermilk with roasted cumin and mint. The perfect Jaipur summer cooler.', ['lassi', 'curd'], 0, { Energy: '40 kcal', Protein: '3 g', Fat: '1 g', Calcium: '110 mg' }, '3 days chilled', 'Our dairy kitchen', ['Refreshing'], 70],
  ['curd-drinks', 'Sweet Lassi', '200 ml', 30, 28, true, 'sweet-lassi-200ml', 'Thick, sweet lassi blended fresh from our set curd with a hint of cardamom.', ['lassi'], 2, { Energy: '150 kcal', Protein: '5 g', Fat: '4 g', Sugar: '18 g' }, '3 days chilled', 'Our dairy kitchen', ['Treat'], 60],
  ['paneer', 'Fresh Paneer', '200 g', 85, 80, true, 'paneer-200g', 'Soft, melt-in-the-mouth paneer made fresh every morning from full-cream milk. No preservatives, no starch.', ['paneer'], 0, { Energy: '265 kcal', Protein: '18 g', Fat: '20 g', Calcium: '208 mg' }, '3 days chilled', 'Our dairy kitchen', ['Fresh daily', 'High protein'], 60],
  ['paneer', 'Fresh Paneer', '500 g', 205, 195, true, 'paneer-500g', 'Family-size block of fresh paneer. Cube it for curries, grill it for tikka, or crumble for bhurji.', ['paneer'], 2, { Energy: '265 kcal', Protein: '18 g', Fat: '20 g', Calcium: '208 mg' }, '3 days chilled', 'Our dairy kitchen', ['Fresh daily', 'Family pack'], 40],
  ['ghee-butter', 'Desi Cow Ghee', '500 ml', 480, 450, false, 'desi-cow-ghee-500ml', 'Slow-cooked cow ghee with a rich, nutty aroma, made the traditional way in small batches.', ['ghee'], 0, { Energy: '900 kcal', Fat: '100 g', 'Vitamin A': 'Rich', Cholesterol: '250 mg' }, '9 months', 'Partner dairies', ['Traditional'], 40],
  ['ghee-butter', 'A2 Bilona Ghee', '500 ml', 780, 730, false, 'a2-bilona-ghee-500ml', 'Hand-churned using the bilona method from A2 curd. Granular texture, golden colour and deep flavour.', ['ghee'], 2, { Energy: '900 kcal', Fat: '100 g', 'Vitamin A': 'Rich', Cholesterol: '250 mg' }, '12 months', 'Desi cow gaushala', ['A2', 'Bilona', 'Premium'], 25],
  ['ghee-butter', 'White Butter (Makhan)', '100 g', 58, 55, true, 'white-butter-100g', 'Fresh unsalted white butter churned from farm cream. Spread it on parathas or melt it over pav bhaji.', ['butter'], 0, { Energy: '717 kcal', Fat: '81 g', Protein: '0.9 g', Salt: '0 g' }, '15 days chilled', 'Our dairy kitchen', ['Unsalted'], 50],
  ['eggs', 'Farm Fresh Eggs', '6 pcs', 60, 55, true, 'farm-eggs-6', 'Fresh brown eggs collected daily from partner poultry farms. Graded and tray-packed for safe delivery.', ['eggs'], 0, { Energy: '72 kcal/egg', Protein: '6.3 g', Fat: '4.8 g', 'Vitamin D': '1.1 µg' }, '12 days', 'Partner poultry farms', ['High protein'], 100],
  ['eggs', 'Farm Fresh Eggs', '12 pcs', 115, 108, true, 'farm-eggs-12', 'A full tray of 12 fresh farm eggs. Great value for the week.', ['eggs'], 2, { Energy: '72 kcal/egg', Protein: '6.3 g', Fat: '4.8 g', 'Vitamin D': '1.1 µg' }, '12 days', 'Partner poultry farms', ['High protein', 'Family pack'], 100],
  ['eggs', 'Country (Desi) Eggs', '6 pcs', 90, 84, true, 'desi-eggs-6', 'Free-range country eggs with deep orange yolks and a richer taste.', ['desi_eggs', 'eggs'], 0, { Energy: '70 kcal/egg', Protein: '6.5 g', Fat: '4.5 g', Omega3: 'Higher' }, '12 days', 'Free-range village farms', ['Free range'], 60],
  ['bread', 'Whole Wheat Bread', '400 g', 45, 42, true, 'whole-wheat-bread-400g', 'Soft 100% whole wheat bread baked fresh every night. No maida, no palm oil.', ['bread'], 0, { Energy: '247 kcal', Protein: '9 g', Fibre: '6 g', Fat: '3 g' }, '3 days', 'Local bakery, Jaipur', ['No maida'], 80],
  ['bread', 'Multigrain Bread', '400 g', 55, 50, true, 'multigrain-bread-400g', 'Soft multigrain loaf with sunflower, flax and oats. Baked fresh and delivered warm-to-room.', ['multigrain'], 0, { Energy: '259 kcal', Protein: '10 g', Fibre: '7 g', Fat: '4 g' }, '3 days', 'Local bakery, Jaipur', ['Seeds', 'High fibre'], 60],
  ['pantry', 'Raw Forest Honey', '500 g', 330, 299, false, 'raw-forest-honey-500g', 'Raw, unprocessed forest honey collected from wild hives. Never heated, never blended.', ['honey'], 0, { Energy: '304 kcal', Sugars: '82 g', Protein: '0.3 g', Fat: '0 g' }, '24 months', 'Aravalli forest collectives', ['Raw', 'Unprocessed'], 30]
];

const NAMES = ['Priya Sharma', 'Rahul Verma', 'Anita Gupta', 'Vikram Singh', 'Neha Jain', 'Amit Agarwal', 'Sunita Meena', 'Rohit Saini', 'Kavita Rathore', 'Manish Joshi', 'Pooja Khandelwal', 'Deepak Mathur', 'Shweta Bhatt', 'Arjun Choudhary'];
const HOUSES = ['A-12', 'B-204', 'C-31', 'D-7', 'E-118', 'F-402', '22', '48/B', '105', 'G-9', 'H-66', '301'];
const STREETS = ['Shanti Apartments', 'Green Valley Society', 'Sunrise Enclave', 'Royal Residency', 'Krishna Heights', 'Laxmi Vihar', 'Ashok Nagar Lane 3', 'Gandhi Path'];
const REVIEWS = ['Super fresh, tastes like village milk!', 'Delivery is always on time. Love it.', 'Quality is consistently good.', 'Best paneer in Jaipur, soft and fresh.', 'Thick curd, my kids love it.', 'Packaging is great and neat.', 'Great value for the price.'];

function rnd(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

function run() {
  const d = DB.get();
  if (d.meta.seeded) return false;
  const R = rnd(42);
  const pick = a => a[Math.floor(R() * a.length)];
  const now = U.istNow();

  d.settings = {};
  const zones = ZONES.map(z => { const o = { id: U.uid('z_'), ...z, active: true }; d.zones.push(o); return o; });
  const cats = CATS.map(([name, slug, icon, tint], i) => { const c = { id: U.uid('c_'), name, slug, icon, tint, sort: i + 1, active: true }; d.categories.push(c); return c; });
  const prods = P.map((r, i) => {
    const [cat, name, pack, mrp, price, subOk, slug, desc, pools, off, nutrition, shelf, source, tags, par] = r;
    const p = { id: U.uid('p_'), catId: cats.find(c => c.slug === cat).id, name, pack, mrp, price, subOk, desc, images: gallery(pools, off, slug), nutrition, shelfLife: shelf, source, tags, stock: par, par, active: true, sort: i, createdAt: new Date().toISOString(), rating: 0, ratingCount: 0 };
    d.products.push(p); return p;
  });

  const exp = U.addDays(now.date, 365);
  d.coupons.push(
    { id: U.uid('k_'), code: 'WELCOME50', type: 'flat', value: 50, minOrder: 199, firstOrderOnly: true, perUserLimit: 1, validTo: exp, active: true, desc: '₹50 off your first order above ₹199' },
    { id: U.uid('k_'), code: 'FRESH10', type: 'percent', value: 10, maxDiscount: 60, minOrder: 150, validTo: exp, active: true, desc: '10% off (up to ₹60) on orders above ₹150' },
    { id: U.uid('k_'), code: 'FREEDEL', type: 'free_delivery', value: 0, minOrder: 99, validTo: exp, active: true, desc: 'Free delivery on orders above ₹99' }
  );
  d.banners.push(
    { id: U.uid('b_'), title: 'Fresh milk before 7:30 AM', sub: 'Subscribe once. Pause or skip any day.', cta: 'Start a plan', link: '#/shop', img: photos.milk[0].url, tone: 'green', active: true, sort: 1 },
    { id: U.uid('b_'), title: 'Flat ₹50 off your first order', sub: 'Use code WELCOME50 on orders above ₹199', cta: 'Shop now', link: '#/shop', img: photos.bread[1].url, tone: 'amber', active: true, sort: 2 },
    { id: U.uid('b_'), title: 'Pure A2 Bilona Ghee', sub: 'Hand-churned. Golden. Granular.', cta: 'See ghee', link: '#/shop/ghee-butter', img: photos.ghee[0].url, tone: 'brown', active: true, sort: 3 },
    { id: U.uid('b_'), title: 'Recharge ₹1000, get 5% back', sub: 'Auto-recharge keeps deliveries on time', cta: 'Open wallet', link: '#/wallet', img: photos.honey[1].url, tone: 'blue', active: true, sort: 4 }
  );

  // people
  const mk = (name, email, role, extra = {}) => { const u = { id: U.uid('u_'), name, email, phone: '9' + String(Math.floor(R() * 1e9)).padStart(9, '0'), role, blocked: false, createdAt: new Date(Date.now() - 20 * 86400000).toISOString(), referralCode: name.split(' ')[0].toUpperCase().slice(0, 5) + Math.floor(100 + R() * 900), wallet: { balance: 0, autoRecharge: { on: false, threshold: 200, amount: 500 }, lowNotified: false }, ...extra }; d.users.push(u); return u; };
  const admin = mk('GharFresh Admin', 'admin@gharfresh.in', 'admin', { demo: true });
  const riders = [
    mk('Ramesh Kumar', 'ramesh@gharfresh.in', 'rider', { demo: true, zoneIds: [zones[0].id, zones[3].id], vehicle: 'Scooter RJ14 AB 1234' }),
    mk('Sunil Yadav', 'sunil@gharfresh.in', 'rider', { demo: true, zoneIds: [zones[1].id, zones[4].id], vehicle: 'Bike RJ14 CD 5678' }),
    mk('Mohan Lal', 'mohan@gharfresh.in', 'rider', { demo: true, zoneIds: [zones[2].id], vehicle: 'Scooter RJ14 EF 9012' })
  ];
  const customers = NAMES.map((n, i) => {
    const u = mk(n, i === 0 ? 'priya@demo.in' : n.split(' ')[0].toLowerCase() + '@demo.in', 'customer', { demo: i === 0, firstDelivered: true });
    const z = zones[i % zones.length];
    d.addresses.push({ id: U.uid('ad_'), userId: u.id, label: i % 3 === 0 ? 'Home' : i % 3 === 1 ? 'Home' : 'Office', house: pick(HOUSES), line1: pick(STREETS) + ', ' + z.name, landmark: 'Near ' + pick(['temple', 'park', 'school', 'metro station', 'bank']), zoneId: z.id, lat: z.lat + (R() - .5) * .018, lng: z.lng + (R() - .5) * .018, instructions: '', isDefault: true, deleted: false });
    u.wallet.balance = i === 0 ? 1180 : Math.round(300 + R() * 1500);
    u.wallet.autoRecharge = { on: i === 0, threshold: 200, amount: 500 };
    return u;
  });
  // one customer with low balance to demonstrate "on hold" automation
  customers[5].wallet.balance = 40; customers[5].name = 'Amit Agarwal';

  const addrOf = u => d.addresses.find(a => a.userId === u.id);
  const subDefs = [
    ['cow-milk-500ml', 1, 'daily'], ['cow-milk-1l', 1, 'daily'], ['buffalo-milk-1l', 1, 'daily'], ['a2-desi-cow-milk-1l', 1, 'daily'],
    ['set-curd-400g', 1, 'alternate_days'], ['paneer-200g', 1, 'weekends'], ['farm-eggs-6', 1, 'weekdays'], ['whole-wheat-bread-400g', 1, 'daily'], ['masala-chaas-500ml', 2, 'daily']
  ];
  const bySlug = s => prods.find(p => p.images[p.images.length - 1].includes(s));
  const startDay = U.addDays(now.date, -14);
  const subs = [];
  customers.forEach((u, i) => {
    const picks = [subDefs[i % 4], subDefs[4 + (i % 5)]];
    if (i % 3 === 0) picks.push(subDefs[(i + 3) % subDefs.length]);
    picks.forEach(([slug, qty, freq]) => {
      const p = bySlug(slug);
      const s = { id: U.uid('s_'), userId: u.id, addressId: addrOf(u).id, productId: p.id, qty, freq, customDays: [], start: startDay, end: null, status: 'active', next: startDay, pauseDates: [], slot: i % 2 ? 'early' : 'regular', createdAt: new Date(Date.now() - 14 * 86400000).toISOString() };
      d.subscriptions.push(s); subs.push(s);
    });
  });
  // pause one subscription (demonstrates pause handling)
  subs[3].status = 'paused';

  // history: orders for each day until today
  const byDay = {};
  for (const s of subs) {
    let n = s.next;
    while (n && n <= now.date) {
      if (s.status === 'active' || n < U.addDays(now.date, -3)) (byDay[n + '|' + s.userId + '|' + s.addressId] = byDay[n + '|' + s.userId + '|' + s.addressId] || []).push(s);
      n = U.nextOccurrence(s.freq, s.customDays, n);
    }
    s.next = n || null;
  }
  const rideTimes = [5.6, 5.9, 6.2, 6.5, 6.8];
  let rIdx = 0;
  for (const key of Object.keys(byDay).sort()) {
    const [date, uid] = key.split('|'); const list = byDay[key];
    const user = DB.by('users', uid), addr = addrOf(user), z = DB.by('zones', addr.zoneId);
    const lines = list.map(s => ({ p: DB.by('products', s.productId), q: s.qty }));
    const subtotal = lines.reduce((a, { p, q }) => a + p.price * q, 0), fee = z.fee, total = subtotal + fee;
    const rider = riders.find(r => r.zoneIds.includes(z.id)) || riders[0];
    const o = { id: U.uid('o_'), no: DB.nextOrderNo(), userId: user.id, addressId: addr.id, subId: list[0].id, subIds: list.map(s => s.id), date, slot: list[0].slot, source: 'subscription', status: 'pending', items: lines.map(({ p, q }) => ({ productId: p.id, name: p.name, pack: p.pack, qty: q, price: p.price, mrp: p.mrp, image: p.images[0] })), subtotal, fee, discount: 0, total, coupon: null, payStatus: 'paid', riderId: rider.id, routeId: null, seq: null, timeline: [], createdAt: date + 'T16:50:00.000Z' };
    const at = h => new Date(`${date}T00:00:00+05:30`).getTime() + h * 3600000;
    const tl = (st, h, note) => { o.status = st; o.timeline.push({ status: st, at: new Date(at(h)).toISOString(), note }); };
    tl('pending', -1.7, 'Auto-generated from your subscription'); tl('packed', 4.2, 'Packed at our dairy hub'); tl('out_for_delivery', 5.4, 'Rider left with your order');
    const isToday = date === now.date;
    const doneToday = !isToday || now.min >= 480 || R() < 0.6;
    if (doneToday) {
      tl('delivered', pick(rideTimes), 'Delivered');
      o.proof = { photo: '/proof-sample.svg', lat: addr.lat, lng: addr.lng, at: o.timeline[o.timeline.length - 1].at, riderId: rider.id }; o.riderPay = 12;
      if (R() < 0.45) { o.rating = { stars: R() < 0.8 ? 5 : 4, text: pick(REVIEWS), at: o.proof.at }; const p = lines[0].p; p.ratingSum = (p.ratingSum || 0) + o.rating.stars; p.ratingCount++; p.rating = Math.round(p.ratingSum / p.ratingCount * 10) / 10; d.reviews.push({ id: U.uid('rv_'), productId: p.id, userId: user.id, name: user.name.split(' ')[0] + ' ' + user.name.split(' ')[1][0] + '.', stars: o.rating.stars, text: o.rating.text, at: o.proof.at }); }
    }
    d.txs.push({ id: U.uid('t_'), userId: user.id, orderId: o.id, type: 'debit', amount: total, balanceAfter: 0, desc: `Delivery on ${date}`, at: o.createdAt });
    d.orders.push(o);
  }
  // wallet history for the demo customer
  const demoU = customers[0];
  d.txs.push({ id: U.uid('t_'), userId: demoU.id, type: 'credit', amount: 2000, balanceAfter: 2000, desc: 'Wallet recharge (UPI)', at: new Date(Date.now() - 13 * 86400000).toISOString() },
    { id: U.uid('t_'), userId: demoU.id, type: 'cashback', amount: 100, balanceAfter: 2100, desc: 'Cashback on ₹2000 recharge', at: new Date(Date.now() - 13 * 86400000 + 1000).toISOString() });
  // product ratings floor so every product has a plausible rating
  prods.forEach((p, i) => { if (!p.ratingCount) { p.ratingCount = 8 + (i * 7) % 40; p.rating = 4.3 + (i % 6) * 0.1; p.ratingSum = p.rating * p.ratingCount; } });

  d.complaints.push({ id: U.uid('c_'), userId: customers[2].id, orderId: d.orders.find(o => o.userId === customers[2].id).id, type: 'quality', description: 'Curd was slightly sour today.', status: 'open', resolution: null, refund: 0, createdAt: new Date(Date.now() - 3 * 3600000).toISOString() });

  d.meta.seeded = true;
  // tomorrow's orders appear through the same engine that runs every night
  const tomorrow = U.addDays(now.date, 1);
  core.generateForDate(tomorrow, { by: 'seed' });
  d.meta.lastGenDate = now.date;
  core.dispatch(tomorrow);
  // fix balances in history rows (cosmetic)
  DB.saveNow();
  return true;
}

module.exports = { run };
