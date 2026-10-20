'use strict';
// GharFresh customer app: shell, router, home, product page, subscribe, basket.
(function () {
  const { esc, inr, get, post } = GF;
  const S = (GF.S = { boot: null, me: null, addrs: [], unread: 0, q: '', cat: '', skew: 0 });
  GF.R = {};
  const $app = document.getElementById('app');
  let $view;

  // ---------- cart (browser storage, prices always re-read from server at checkout) ----------
  const cart = (GF.cart = {
    get() { try { return JSON.parse(localStorage.getItem('gf_cart') || '{}'); } catch { return {}; } },
    set(c) { try { localStorage.setItem('gf_cart', JSON.stringify(c)); } catch {} window.dispatchEvent(new Event('gf-cart')); },
    qty(id) { return this.get()[id] || 0; },
    add(id) { const p = GF.prod(id); const c = this.get(); if (p && (c[id] || 0) >= Math.min(20, p.stock)) { GF.toast(p.stock <= (c[id] || 0) ? `Only ${p.stock} in stock` : 'Max 20 per order'); return; } c[id] = (c[id] || 0) + 1; this.set(c); },
    dec(id) { const c = this.get(); if (c[id] > 1) c[id]--; else delete c[id]; this.set(c); },
    count() { return Object.values(this.get()).reduce((a, b) => a + b, 0); },
    total() { return Object.entries(this.get()).reduce((s, [id, q]) => s + q * ((GF.prod(id) || {}).price || 0), 0); },
    clear() { this.set({}); }
  });
  GF.prod = id => S.boot && S.boot.products.find(p => p.id === id);
  GF.catOf = id => S.boot.categories.find(c => c.id === id);

  // ---------- time ----------
  const istNow = () => new Date(Date.now() + S.skew + 330 * 60000);
  const istMin = () => { const d = istNow(); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
  const hhmm = s => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : 1320; };
  function countdown() {
    const left = hhmm(S.boot.settings.cutoff) - istMin();
    return left > 0 ? { ok: true, t: `${Math.floor(left / 60)}h ${left % 60}m left`, d: 'tomorrow' } : { ok: false, t: 'Cut-off passed', d: 'day after tomorrow' };
  }

  // ---------- data ----------
  async function loadBoot() {
    S.boot = await get('/api/bootstrap');
    S.skew = new Date(S.boot.now.iso.replace('Z', '') + 'Z').getTime() - (Date.now() + 330 * 60000);
  }
  async function loadMe() {
    if (!GF.token()) { S.me = null; S.addrs = []; return; }
    try { const r = await get('/api/me'); S.me = r.user; S.addrs = r.addresses; S.unread = r.unread; } catch { S.me = null; }
  }
  GF.reloadMe = async () => { await loadMe(); chrome(); };
  GF.go = h => { location.hash = h; };
  GF.needLogin = () => { if (S.me) return false; GF.toast('Please log in to continue'); GF.go('#/login?next=' + encodeURIComponent(location.hash.slice(1) || '/')); return true; };

  // ---------- shell ----------
  const ICONS = {
    home: '<path d="M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>',
    plans: '<path d="M4 5h16v14H4zM4 9h16M9 3v4M15 3v4"/>',
    basket: '<path d="M6 6h15l-2 9H8L6 3H3"/><circle cx="9" cy="20" r="1.2"/><circle cx="18" cy="20" r="1.2"/>',
    orders: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'
  };
  const svg = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;
  const NAV = [['#/', 'Home', 'home'], ['#/plans', 'Plans', 'plans'], ['#/basket', 'Basket', 'basket'], ['#/orders', 'Orders', 'orders'], ['#/profile', 'Account', 'user']];

  function shell() {
    $app.innerHTML = `
    <header class="top"><div class="wrapper">
      <a href="#/" class="logo" aria-label="GharFresh home"><i>🥛</i><span>GharFresh<small>FRESH AT YOUR DOOR</small></span></a>
      <nav class="dnav" id="dnav">${NAV.map(([h, l]) => `<a href="${h}" data-nav="${h}">${l}</a>`).join('')}</nav>
      <div class="dsearch"><input id="q" type="search" placeholder="Search milk, paneer, eggs…" aria-label="Search products" autocomplete="off"></div>
      <div class="row nofl right gap" style="margin-left:auto"><a href="#/wallet" class="hbtn" id="hwallet">₹ —</a><a href="#/notifications" class="hbtn" aria-label="Notifications" id="hbell">🔔</a></div>
    </div></header>
    <div class="mobsearch"><input id="q2" type="search" placeholder="🔍  Search milk, paneer, eggs…" aria-label="Search products" autocomplete="off"></div>
    <main><div class="wrapper page" id="view"></div></main>
    <div id="cartbar"></div>
    <nav class="bnav" aria-label="Main"><div>${NAV.map(([h, l, i]) => `<a href="${h}" data-nav="${h}"><span class="ic">${svg(i)}${i === 'basket' ? '<b class="dot" id="bdot" hidden></b>' : ''}</span>${l}</a>`).join('')}</div></nav>`;
    $view = document.getElementById('view');
    for (const id of ['q', 'q2']) document.getElementById(id).addEventListener('input', e => {
      S.q = e.target.value; S.cat = '';
      document.getElementById(id === 'q' ? 'q2' : 'q').value = S.q;
      if (routeName() !== 'home') { location.hash = '#/'; } else GF.R.home.render();
    });
  }
  function chrome() {
    const w = document.getElementById('hwallet'), b = document.getElementById('hbell');
    if (!w) return;
    w.textContent = S.me ? '₹ ' + Math.floor(S.me.wallet.balance).toLocaleString('en-IN') : 'Login';
    w.href = S.me ? '#/wallet' : '#/login';
    b.innerHTML = '🔔' + (S.unread ? `<b class="dot">${S.unread > 9 ? '9+' : S.unread}</b>` : '');
    const n = cart.count(), dot = document.getElementById('bdot'); if (dot) { dot.hidden = !n; dot.textContent = n; }
    const h = location.hash || '#/';
    document.querySelectorAll('[data-nav]').forEach(a => { const t = a.dataset.nav; a.classList.toggle('on', t === '#/' ? /^#\/?($|shop|p\/)/.test(h) : h.startsWith(t)); });
    cartbar();
  }
  function cartbar() {
    const el = document.getElementById('cartbar'); if (!el) return;
    const n = cart.count(), h = location.hash;
    if (!n || h.startsWith('#/basket') || h.startsWith('#/login')) { el.innerHTML = ''; return; }
    el.innerHTML = `<a href="#/basket" class="cartbar"><span><small>${n} item${n > 1 ? 's' : ''}</small><b>${inr(cart.total())}</b></span><span class="go">View basket →</span></a>`;
  }
  window.addEventListener('gf-cart', () => { chrome(); document.querySelectorAll('[data-ctl]').forEach(el => { el.innerHTML = ctl(GF.prod(el.dataset.ctl)); }); GF.R.basket && GF.R.basket.onCart && GF.R.basket.onCart(); });

  // ---------- router ----------
  function routeName() { const h = (location.hash || '#/').slice(2).split('?')[0]; const p = h.split('/')[0]; return p === '' || p === 'shop' ? 'home' : p; }
  async function route() {
    const hash = (location.hash || '#/').slice(2); const [path, qs] = hash.split('?'); const parts = path.split('/').filter(Boolean);
    const name = routeName(); const args = { parts, query: Object.fromEntries(new URLSearchParams(qs || '')) };
    if (name === 'home') S.cat = parts[1] || '';
    if (name === 'login') { renderLogin(args); return; }
    if (!document.getElementById('view')) shell();
    chrome(); window.scrollTo(0, 0);
    const r = GF.R[name];
    if (!r) { $view.innerHTML = `<div class="empty"><div class="big">🧭</div><h3>Page not found</h3><a class="btn" href="#/">Go home</a></div>`; return; }
    try { await r.show(args); } catch (e) { if (e.status !== 401) $view.innerHTML = `<div class="empty"><div class="big">😕</div><h3>Something went wrong</h3><p>${esc(e.message)}</p><button class="btn mt2" onclick="location.reload()">Try again</button></div>`; }
    chrome();
  }
  GF.view = html => { $view.innerHTML = html; };
  GF.$view = () => $view;

  function renderLogin(args) {
    if (S.me) { GF.go('#' + (args.query.next || '/')); return; }
    document.getElementById('app').innerHTML = `<div class="login-wrap"><div id="lg"></div></div>`;
    GF.loginView(document.getElementById('lg'), { role: null, onDone: async u => {
      await loadMe(); GF.connect();
      if (u.role === 'admin') { location.href = '/admin'; return; }
      if (u.role === 'rider') { location.href = '/rider'; return; }
      shell(); GF.go('#' + (args.query.next || '/')); route();
    } });
  }

  // ---------- product card ----------
  function ctl(p) {
    if (!p) return '';
    if (p.stock <= 0) return `<button class="add" disabled style="opacity:.5">OUT OF STOCK</button>`;
    const n = cart.qty(p.id);
    return n === 0 ? `<button class="add" data-act="add" data-id="${p.id}" aria-label="Add ${esc(p.name)}">ADD</button>`
      : `<div class="step"><button data-act="dec" data-id="${p.id}" aria-label="Remove one">−</button><span>${n}</span><button data-act="add" data-id="${p.id}" aria-label="Add one more">+</button></div>`;
  }
  GF.ctl = ctl;
  GF.pcard = p => {
    const off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
    const cat = GF.catOf(p.catId);
    return `<article class="pc">
      <div class="ph" data-act="open" data-id="${p.id}" style="background:${cat ? cat.tint : '#eef4f0'}">${GF.img(p.images, '', p.name + ' ' + p.pack)}
        ${off ? `<span class="badge">${off}% OFF</span>` : ''}${p.tags && p.tags[0] ? `<span class="tagb">${esc(p.tags[0])}</span>` : ''}<span class="cnt">📷 ${p.images.length}</span>
        ${p.stock <= 0 ? '<div class="oos">Sold out</div>' : ''}</div>
      <h3 class="nm" data-act="open" data-id="${p.id}" style="cursor:pointer">${esc(p.name)}</h3>
      <div class="pk"><span>${esc(p.pack)}</span>${GF.stars(p.rating)}</div>
      <div class="pr"><b>${inr(p.price)}</b>${off ? `<s>${inr(p.mrp)}</s>` : ''}</div>
      <div data-ctl="${p.id}">${ctl(p)}</div>
      ${p.subOk ? `<button class="sub-link" data-act="sub" data-id="${p.id}">🔁 Subscribe daily</button>` : ''}
    </article>`;
  };

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const id = t.dataset.id, a = t.dataset.act;
    if (a === 'add') cart.add(id); else if (a === 'dec') cart.dec(id);
    else if (a === 'open') GF.go('#/p/' + id);
    else if (a === 'sub') { if (!GF.needLogin()) subscribeSheet(id); }
  });

  // ---------- home ----------
  let bnTimer;
  GF.R.home = {
    async show() { if (!S.boot) await loadBoot(); this.render(); },
    render() {
      const { boot } = S; const q = S.q.trim().toLowerCase();
      const cd = countdown();
      const filtered = boot.products.filter(p => (!S.cat || (GF.catOf(p.catId) || {}).slug === S.cat) && (!q || `${p.name} ${p.pack} ${(p.tags || []).join(' ')}`.toLowerCase().includes(q)));
      const showSections = !S.cat && !q;
      let html = `<div class="eta"><span class="e">🚚</span><div><b>Delivery ${esc(boot.settings.deliveryWindow)}</b><span>${S.me && S.addrs[0] ? '📍 ' + esc(S.addrs.find(a => a.isDefault)?.line1 || S.addrs[0].line1) : '<a href="#/login" style="color:var(--g);font-weight:700">Login to set your address</a>'}</span></div><span class="cd" id="cd" title="Order before cut-off for ${cd.d}">⏱ ${cd.t}</span></div>`;
      if (showSections) {
        html += `<div class="banners" id="bn"><div class="bn-track">${boot.banners.map(b => `<div class="bn ${esc(b.tone)}" style="background-image:url('${esc(b.img)}')"><div><h2>${esc(b.title)}</h2><p>${esc(b.sub)}</p><a class="btn amber" href="${esc(b.link)}">${esc(b.cta)}</a></div></div>`).join('')}</div><div class="bn-dots">${boot.banners.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div></div>
        <div class="perks"><div><b>🌅</b>Before 7:30 AM</div><div><b>⏸️</b>Pause anytime</div><div><b>💸</b>Instant refund</div></div>`;
      }
      html += `<div class="sec"><div class="sec-h"><h2 class="h2">Shop by category</h2>${S.cat || q ? '<a href="#/" onclick="GF.S.q=\'\';document.getElementById(\'q\').value=\'\';document.getElementById(\'q2\').value=\'\'">Clear ✕</a>' : ''}</div>
        <div class="cats">${boot.categories.map(c => `<a class="cat ${S.cat === c.slug ? 'on' : ''}" href="#/shop/${c.slug}" style="background:${c.tint}"><b>${c.icon}</b><span>${esc(c.name)}</span></a>`).join('')}</div></div>`;
      if (showSections) {
        const again = this.again || [];
        if (again.length) html += `<div class="sec"><div class="sec-h"><h2 class="h2">Buy again</h2><a href="#/orders">All orders</a></div><div class="hscroll">${again.map(GF.pcard).join('')}</div></div>`;
        const best = boot.products.filter(p => (p.tags || []).includes('Bestseller'));
        if (best.length) html += `<div class="sec"><div class="sec-h"><h2 class="h2">🔥 Bestsellers</h2></div><div class="hscroll">${best.map(GF.pcard).join('')}</div></div>`;
        for (const c of boot.categories) {
          const items = filtered.filter(p => p.catId === c.id); if (!items.length) continue;
          html += `<div class="sec"><div class="sec-h"><h2 class="h2">${c.icon} ${esc(c.name)} <span class="muted tiny">${items.length}</span></h2><a href="#/shop/${c.slug}">See all</a></div><div class="grid">${items.map(GF.pcard).join('')}</div></div>`;
        }
        html += `<div class="card mt3" style="background:linear-gradient(135deg,#fff7e0,#fff);border-color:#f3e1a8"><div class="row"><div><h3 class="h3">🎁 Invite friends, earn ₹${boot.settings.referralBonus}</h3><p class="muted mt">You both get ₹${boot.settings.referralBonus} in your wallet after their first delivery.</p></div><a class="btn amber nofl sm" style="flex:none" href="#/profile">Get my code</a></div></div>`;
      } else {
        html += `<div class="sec"><div class="grid">${filtered.map(GF.pcard).join('')}</div></div>`;
        if (!filtered.length) html += `<div class="empty"><div class="big">🔎</div><h3>No products found</h3><p>Try another search or category.</p></div>`;
      }
      html += `<div class="footer">🥛 GharFresh · ${esc(boot.settings.city)} · Support ${esc(boot.settings.supportPhone)}<br>Fresh from farms to your door before 7:30 AM</div>`;
      GF.view(html); this.carousel();
      if (S.me && !this.againLoaded) { this.againLoaded = true; get('/api/orders').then(os => { const seen = new Set(), list = []; os.forEach(o => o.items.forEach(i => { const p = GF.prod(i.productId); if (p && !seen.has(p.id) && p.stock > 0) { seen.add(p.id); list.push(p); } })); this.again = list.slice(0, 8); if (routeName() === 'home' && !S.cat && !S.q) this.render(); }).catch(() => {}); }
    },
    carousel() {
      clearInterval(bnTimer); const el = document.getElementById('bn'); if (!el) return;
      const track = el.querySelector('.bn-track'), dots = el.querySelectorAll('.bn-dots i'); let i = 0;
      const go = n => { i = (n + dots.length) % dots.length; track.style.transform = `translateX(-${i * 100}%)`; dots.forEach((d, k) => d.classList.toggle('on', k === i)); };
      bnTimer = setInterval(() => { if (!document.getElementById('bn')) return clearInterval(bnTimer); go(i + 1); }, 4500);
      let sx = 0; el.addEventListener('touchstart', e => sx = e.touches[0].clientX, { passive: true }); el.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); });
    }
  };
  setInterval(() => { const el = document.getElementById('cd'); if (el && S.boot) el.textContent = '⏱ ' + countdown().t; }, 30000);

  // ---------- product page ----------
  GF.R.p = {
    async show({ parts }) {
      GF.view('<div class="skel" style="height:360px"></div>');
      const { product: p, reviews, related } = await get('/api/products/' + parts[1]);
      if (!S.boot) await loadBoot();
      const cat = GF.catOf(p.catId); const off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
      const monthly = p.price * 30;
      const html = `<a href="#/" class="muted tiny bold">← Back to shop</a>
      <div class="pp mt">
        <div><div class="gal"><div class="gal-track" id="gt">${p.images.map((u, i) => `<img src="${esc(u)}" alt="${esc(p.name)} photo ${i + 1}" ${i ? 'loading="lazy"' : ''} data-i="${i}" data-fb="${esc(p.images[p.images.length - 1])}" onerror="gfImgErr(this)">`).join('')}</div>
          <span class="gn" id="gn">1 / ${p.images.length}</span><button class="arr l" id="gl" aria-label="Previous photo">‹</button><button class="arr r" id="gr" aria-label="Next photo">›</button>
          <div class="gdots" id="gd">${p.images.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div></div>
          <div class="thumbs" id="gth">${p.images.map((u, i) => `<img src="${esc(u)}" alt="" class="${i ? '' : 'on'}" data-i="${i}" loading="lazy" data-fb="${esc(p.images[p.images.length - 1])}" onerror="gfImgErr(this)">`).join('')}</div></div>
        <div class="sticky">
          <div class="row nofl gap wrap">${(p.tags || []).map(t => `<span class="chip green">${esc(t)}</span>`).join('')}${cat ? `<span class="chip">${cat.icon} ${esc(cat.name)}</span>` : ''}</div>
          <h1 class="h1 mt">${esc(p.name)}</h1><div class="row nofl gap mt"><span class="muted bold">${esc(p.pack)}</span>${GF.stars(p.rating, p.ratingCount)}</div>
          <div class="row nofl gap mt" style="align-items:baseline"><b style="font-size:32px;font-weight:900">${inr(p.price)}</b>${off ? `<s class="strike">${inr(p.mrp)}</s><span class="chip amber">${off}% OFF</span>` : ''}</div>
          <p class="tiny muted">Inclusive of all taxes · Delivery ${esc(S.boot.settings.deliveryWindow)}</p>
          ${p.stock > 0 && p.stock <= 15 ? `<p class="mt" style="color:var(--red);font-weight:800;font-size:13px">🔥 Only ${p.stock} left today</p>` : ''}
          <div class="row mt2"><div data-ctl="${p.id}">${ctl(p)}</div></div>
          ${p.subOk ? `<div class="card mt2" style="background:#fff8e6;border-color:#f3e1a8"><div class="row"><div><b>🔁 Subscribe &amp; never run out</b><p class="tiny muted">Delivered every morning. Pause, skip or cancel anytime. ≈ ${inr(monthly)}/month for daily.</p></div><button class="btn amber sm" style="flex:none" data-act="sub" data-id="${p.id}">Subscribe</button></div></div>` : ''}
          <p class="mt2" style="font-size:14.5px;line-height:1.6">${esc(p.desc)}</p>
          <div class="facts mt2"><div>🏭<b>${esc(p.source || 'Partner farms')}</b>Source</div><div>🕒<b>${esc(p.shelfLife || '—')}</b>Shelf life</div><div>🌅<b>By 7:30 AM</b>Delivery</div></div>
          ${Object.keys(p.nutrition || {}).length ? `<h3 class="h3 mt3">Nutrition <span class="muted tiny">per 100 g / ml</span></h3><table class="nutri mt">${Object.entries(p.nutrition).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
        </div></div>
      <div class="sec"><h2 class="h2">Customer reviews</h2><div class="card mt">${reviews.length ? reviews.map(r => `<div class="rev"><div class="row nofl gap between"><b>${esc(r.name)}</b>${GF.stars(r.stars)}</div><p>${esc(r.text)}</p><small class="muted">${GF.ago(r.at)} · Verified delivery</small></div>`).join('') : '<p class="muted">Reviews appear after customers receive and rate this product.</p>'}</div></div>
      ${related.length ? `<div class="sec"><h2 class="h2">You may also like</h2><div class="hscroll mt">${related.map(GF.pcard).join('')}</div></div>` : ''}`;
      GF.view(html); document.title = p.name + ' | GharFresh';
      const gt = document.getElementById('gt'), n = p.images.length;
      const setI = i => { document.getElementById('gn').textContent = `${i + 1} / ${n}`; document.querySelectorAll('#gd i').forEach((d, k) => d.classList.toggle('on', k === i)); document.querySelectorAll('#gth img').forEach((t, k) => t.classList.toggle('on', k === i)); };
      const cur = () => Math.round(gt.scrollLeft / gt.clientWidth);
      gt.addEventListener('scroll', () => setI(cur()), { passive: true });
      const goI = i => gt.scrollTo({ left: Math.max(0, Math.min(n - 1, i)) * gt.clientWidth, behavior: 'smooth' });
      document.getElementById('gl').onclick = () => goI(cur() - 1); document.getElementById('gr').onclick = () => goI(cur() + 1);
      document.getElementById('gth').onclick = e => { const i = e.target.dataset.i; if (i != null) goI(+i); };
      gt.onclick = e => { if (e.target.tagName !== 'IMG') return; const lb = document.createElement('div'); lb.className = 'lightbox'; lb.innerHTML = `<img src="${esc(e.target.src)}" alt="">`; lb.onclick = () => lb.remove(); document.body.appendChild(lb); };
    }
  };

  // ---------- subscribe sheet ----------
  function subscribeSheet(pid) {
    const p = GF.prod(pid); if (!p) return;
    const el = S.boot.nextEligible; let qty = 1, freq = 'daily', days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const per = { daily: 30, alternate_days: 15, weekdays: 22, weekends: 9, custom: 0 };
    if (!S.addrs.length) { GF.toast('Add a delivery address first'); GF.go('#/profile?add=1&next=' + encodeURIComponent(location.hash.slice(1))); return; }
    const sh = GF.sheet('');
    const draw = () => {
      const n = freq === 'custom' ? days.length * 4.3 : per[freq];
      sh.el.innerHTML = `<h3 class="h2">🔁 Subscribe</h3>
      <div class="line">${GF.img(p.images, 'th', p.name, false)}<div class="grow"><b>${esc(p.name)}</b><div class="muted tiny">${esc(p.pack)} · ${inr(p.price)}</div></div>
        <div class="mini"><button data-q="-1" aria-label="Less">−</button><span>${qty}</span><button data-q="1" aria-label="More">+</button></div></div>
      <label class="lbl">How often?</label><div class="pills">${['daily', 'alternate_days', 'weekdays', 'weekends', 'custom'].map(f => `<button class="pill ${freq === f ? 'on' : ''}" data-f="${f}">${GF.FREQ[f].replace(' (Mon–Fri)', '')}</button>`).join('')}</div>
      ${freq === 'custom' ? `<div class="pills mt">${['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => `<button class="pill ${days.includes(d) ? 'on' : ''}" data-d="${d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}</div>` : ''}
      <div class="form-grid"><div><label class="lbl">Start from</label><input class="input" type="date" id="sd" min="${el}" value="${el}"></div>
      <div><label class="lbl">Time slot</label><select class="input" id="sl">${S.boot.settings.slots.map(s => `<option value="${s.id}" ${s.id === 'regular' ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></div></div>
      <label class="lbl">Deliver to</label><select class="input" id="sa">${S.addrs.map(a => `<option value="${a.id}" ${a.isDefault ? 'selected' : ''}>${esc(a.label)} · ${esc(a.house)}, ${esc(a.line1)}</option>`).join('')}</select>
      <div class="card flat mt2" style="background:var(--g3)"><div class="between row"><span>Per delivery</span><b>${inr(p.price * qty)}</b></div><div class="between row mt"><span class="muted">Approx. per month</span><b>${inr(p.price * qty * n)}</b></div><p class="tiny muted mt">Charged from your wallet each night at ${S.boot.settings.cutoff.replace(/^(\d+):/, (m, h) => (h > 12 ? h - 12 : h) + ':')} PM for the next morning. If the balance is low we hold the order, never overcharge.</p></div>
      <button class="btn full mt2" id="ok">Start subscription</button>`;
      sh.el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { qty = Math.max(1, Math.min(10, qty + +b.dataset.q)); draw(); });
      sh.el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { freq = b.dataset.f; draw(); });
      sh.el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { const d = b.dataset.d; days = days.includes(d) ? days.filter(x => x !== d) : days.concat(d); draw(); });
      sh.el.querySelector('#ok').onclick = ev => GF.busy(ev.currentTarget, async () => {
        try { await post('/api/subscriptions', { productId: p.id, qty, freq, customDays: days, start: sh.el.querySelector('#sd').value, slot: sh.el.querySelector('#sl').value, addressId: sh.el.querySelector('#sa').value }); sh.close(); GF.toast('Subscription started ✅', 'ok'); GF.go('#/plans'); } catch (e) { GF.err(e); }
      });
    };
    draw();
  }
  GF.subscribeSheet = subscribeSheet;

  // ---------- basket ----------
  GF.R.basket = {
    state: { coupon: '', addr: '', slot: 'regular', quote: null, applied: '' },
    async show() {
      if (!S.boot) await loadBoot();
      this.render();
    },
    onCart() { if (routeName() === 'basket') this.render(); },
    async render() {
      const st = this.state, items = cart.get();
      const lines = Object.entries(items).map(([id, q]) => ({ p: GF.prod(id), q })).filter(l => l.p);
      if (!lines.length) { GF.view(`<div class="empty"><div class="big">🧺</div><h3>Your basket is empty</h3><p>Add fresh milk, paneer or eggs to get started.</p><a href="#/" class="btn mt2" style="display:inline-flex">Browse products</a></div>`); return; }
      if (!st.addr || !S.addrs.find(a => a.id === st.addr)) st.addr = (S.addrs.find(a => a.isDefault) || S.addrs[0] || {}).id || '';
      let quote = null;
      if (S.me && st.addr) { try { quote = await post('/api/orders/quote', { addressId: st.addr, items: lines.map(l => ({ productId: l.p.id, qty: l.q })), couponCode: st.applied }); } catch {} }
      if (quote && quote.couponError) { GF.toast(esc(quote.couponError), 'err'); st.applied = ''; st.coupon = ''; quote = { ...quote, couponError: null }; }
      const sub = lines.reduce((s, l) => s + l.p.price * l.q, 0), mrp = lines.reduce((s, l) => s + l.p.mrp * l.q, 0);
      const q = quote || { subtotal: sub, fee: 0, discount: 0, total: sub, balance: S.me ? S.me.wallet.balance : 0, date: S.boot.nextEligible };
      const short = Math.max(0, Math.ceil(q.total - q.balance));
      const slotOpts = S.boot.settings.slots;
      GF.view(`<h1 class="h1">Basket</h1><p class="muted tiny" id="bd">🚚 Delivery on <b>${GF.fdate(q.date)}</b>, ${esc(S.boot.settings.deliveryWindow)}${countdown().ok ? ` · order within ${countdown().t}` : ''}</p>
      <div class="col2 mt"><div>
        <div class="card">${lines.map(l => `<div class="line">${GF.img(l.p.images, 'th', l.p.name, false)}<div class="grow"><b>${esc(l.p.name)}</b><div class="muted tiny">${esc(l.p.pack)} · ${inr(l.p.price)}</div></div>
          <div class="mini"><button data-act="dec" data-id="${l.p.id}" aria-label="Less">−</button><span>${l.q}</span><button data-act="add" data-id="${l.p.id}" aria-label="More">+</button></div><b style="min-width:58px;text-align:right">${inr(l.p.price * l.q)}</b></div>`).join('')}</div>
        <div class="card"><h3 class="h3">🎟️ Offers</h3><div class="row mt"><input class="input" id="cc" placeholder="Coupon code" value="${esc(st.coupon)}" style="text-transform:uppercase"><button class="btn sm nofl" id="ca" style="flex:none">Apply</button></div>
          ${q.couponError ? `<p class="mt" style="color:var(--red);font-size:13px">${esc(q.couponError)}</p>` : st.applied && q.discount ? `<p class="mt save">✔ ${esc(st.applied)} applied — you save ${inr(q.discount)} <button class="link" style="display:inline;width:auto" id="cr">Remove</button></p>` : ''}
          <div class="pills mt">${S.boot.coupons.map(c => `<button class="pill" data-cp="${esc(c.code)}" title="${esc(c.desc)}">${esc(c.code)}</button>`).join('')}</div></div>
      </div><div>
        ${S.me ? `<div class="card"><h3 class="h3">📍 Deliver to</h3>${S.addrs.length ? `<select class="input mt" id="ba">${S.addrs.map(a => `<option value="${a.id}" ${a.id === st.addr ? 'selected' : ''}>${esc(a.label)} · ${esc(a.house)}, ${esc(a.line1)}</option>`).join('')}</select>` : `<a class="btn ghost mt full" href="#/profile?add=1&next=/basket">+ Add delivery address</a>`}
          <label class="lbl">Time slot</label><select class="input" id="bs">${slotOpts.map(s => `<option value="${s.id}" ${s.id === st.slot ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></div>` : ''}
        <div class="card"><h3 class="h3">Bill details</h3><div class="bill mt"><div><span>Items total</span><span>${inr(q.subtotal)}</span></div>
          ${mrp > sub ? `<div class="save"><span>Savings on MRP</span><span>−${inr(mrp - sub)}</span></div>` : ''}
          <div><span>Delivery fee</span><span>${q.fee ? inr(q.fee) : '<b class="save">FREE</b>'}</span></div>
          ${q.discount ? `<div class="save"><span>Coupon discount</span><span>−${inr(q.discount)}</span></div>` : ''}
          <div class="tot"><span>To pay</span><span>${inr(q.total)}</span></div></div>
          ${S.me ? `<div class="row mt" style="background:${short ? '#fdecec' : 'var(--g3)'};padding:10px 12px;border-radius:12px"><span>👛 Wallet balance</span><b style="text-align:right">${inr(q.balance)}</b></div>` : ''}
          <button class="btn full mt2" id="pay">${!S.me ? 'Login to order' : !S.addrs.length ? 'Add address to continue' : short ? `Add ${inr(Math.ceil(short / 100) * 100)} &amp; pay ${inr(q.total)}` : `Pay ${inr(q.total)} from wallet`}</button>
          ${short ? `<p class="tiny muted center mt">Wallet is short by ${inr(short)}. Top-up is instant via UPI${short ? ' and you get cashback on larger recharges' : ''}.</p>` : ''}
        </div></div></div>`);
      const v = GF.$view();
      const apply = c => { st.coupon = c; st.applied = c.trim().toUpperCase(); this.render(); };
      v.querySelector('#ca').onclick = () => apply(v.querySelector('#cc').value);
      v.querySelectorAll('[data-cp]').forEach(b => b.onclick = () => apply(b.dataset.cp));
      const cr = v.querySelector('#cr'); if (cr) cr.onclick = () => { st.coupon = ''; st.applied = ''; this.render(); };
      const ba = v.querySelector('#ba'); if (ba) ba.onchange = () => { st.addr = ba.value; this.render(); };
      const bs = v.querySelector('#bs'); if (bs) bs.onchange = () => { st.slot = bs.value; };
      v.querySelector('#pay').onclick = ev => {
        if (GF.needLogin()) return;
        if (!S.addrs.length) { GF.go('#/profile?add=1&next=/basket'); return; }
        GF.busy(ev.currentTarget, async () => {
          try {
            if (short) await GF.payUPI(Math.ceil(short / 100) * 100);
            const o = await post('/api/orders', { addressId: st.addr, items: lines.map(l => ({ productId: l.p.id, qty: l.q })), couponCode: st.applied, slot: st.slot });
            cart.clear(); st.coupon = ''; st.applied = ''; await GF.reloadMe();
            const s = GF.sheet(`<div class="success"><div class="tick">✓</div><h3 class="h2">Order placed!</h3><p class="muted mt">Order #${o.no} · ${inr(o.total)} paid from wallet.<br>Delivery on <b>${GF.fdate(o.date)}</b> ${esc(S.boot.settings.deliveryWindow)}${o.rider ? `<br>Your rider: <b>${esc(o.rider.name)}</b>` : ''}</p><button class="btn full mt2" id="tr">Track order</button></div>`);
            s.el.querySelector('#tr').onclick = () => { s.close(); GF.go('#/orders/' + o.id); }; s.root.querySelector('.sheet-bg').onclick = () => { s.close(); GF.go('#/orders/' + o.id); };
          } catch (e) { if (e.message !== 'cancelled') GF.err(e); }
        });
      };
    }
  };

  // ---------- boot ----------
  async function init() {
    GF.registerSW();
    GF.onUnauthorized = () => { S.me = null; };
    try { await loadBoot(); } catch (e) { $app.innerHTML = `<div class="empty"><div class="big">🔌</div><h3>Can't reach GharFresh</h3><p>${esc(e.message)}</p><button class="btn mt2" onclick="location.reload()">Retry</button></div>`; return; }
    await loadMe();
    if (S.me && S.me.role === 'admin' && location.pathname === '/') { /* admins can still browse the shop */ }
    if (S.me) GF.connect();
    shell(); route();
    window.addEventListener('hashchange', route);
    window.addEventListener('gf:wallet', e => { if (S.me) { S.me.wallet.balance = e.detail.balance; chrome(); } });
    window.addEventListener('gf:notification', e => { S.unread++; chrome(); GF.toast(`<b>${esc(e.detail.title)}</b><br><span style="font-weight:500;font-size:13px">${esc(e.detail.body || '')}</span>`); });
    window.addEventListener('gf:order', () => { if (['orders'].includes(routeName())) GF.R.orders.refresh && GF.R.orders.refresh(); });
    setInterval(() => { if (S.me && document.visibilityState === 'visible' && routeName() === 'orders') GF.R.orders.refresh && GF.R.orders.refresh(); }, 15000);
  }
  GF.chrome = chrome; GF.loadBoot = loadBoot; GF.route = route; GF.routeName = routeName; GF.shell = shell; GF.istNow = istNow;
  window.addEventListener('load', () => setTimeout(init, 0));
})();
