'use strict';
// GharFresh rider app: today's route, delivery proof (photo + GPS), works offline and syncs later.
(function () {
  const { esc, inr, get, post } = GF;
  const $app = document.getElementById('app');
  const QK = 'gf_rider_queue';
  const queue = { get() { try { return JSON.parse(localStorage.getItem(QK) || '[]'); } catch { return []; } }, set(q) { try { localStorage.setItem(QK, JSON.stringify(q)); } catch { GF.toast('Phone storage is full. Sync soon.', 'err'); } }, push(i) { const q = this.get(); q.push({ ...i, qid: Date.now() + Math.random() }); this.set(q); } };
  let me = null, data = null, tab = 'route', day = 'today', stats = null, busy = false;
  const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

  function compress(file, max = 900, q = 0.6) {
    return new Promise((res, rej) => { const img = new Image(); img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); res(c.toDataURL('image/jpeg', q)); }; img.onerror = rej; img.src = URL.createObjectURL(file); });
  }
  const pos = () => new Promise((res, rej) => { if (!navigator.geolocation) return rej(new Error('Location is not supported on this phone')); navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => rej(new Error('Please turn on GPS and allow location for this app')), { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }); });

  async function sync() {
    if (!navigator.onLine) return;
    let q = queue.get(); if (!q.length) return; let n = 0; const errs = [];
    for (const it of [...q]) {
      try {
        if (it.type === 'delivered') await post(`/api/rider/orders/${it.id}/delivered`, { photo: it.photo, lat: it.lat, lng: it.lng, at: it.at });
        else await post(`/api/rider/orders/${it.id}/failed`, { reason: it.reason, notes: it.notes, lat: it.lat, lng: it.lng });
        q = q.filter(x => x.qid !== it.qid); queue.set(q); n++;
      } catch (e) { if (e.offline) break; errs.push(e.message); q = q.filter(x => x.qid !== it.qid); queue.set(q); }
    }
    if (n) { GF.toast(`☁️ ${n} offline update(s) synced`, 'ok'); load(); }
    errs.forEach(m => GF.toast(m, 'err'));
    render();
  }
  window.addEventListener('online', () => { net(); sync(); }); window.addEventListener('offline', net);
  function net() { let el = document.getElementById('net'); if (!navigator.onLine) { if (!el) { el = document.createElement('div'); el.id = 'net'; el.className = 'net'; el.textContent = '📴 Offline — deliveries are saved and will sync automatically'; document.body.appendChild(el); } } else if (el) el.remove(); }

  async function load() {
    try { data = await get('/api/rider/route?date=' + (day === 'today' ? today() : GF.addDays(today(), 1))); stats = await get('/api/rider/stats'); } catch (e) { if (!e.offline) GF.err(e); }
    render();
  }

  function pending(id) { return queue.get().find(q => q.id === id); }
  function render() {
    if (!data) { $app.innerHTML = '<div class="empty"><div class="big">🛵</div><h3>Loading route…</h3></div>'; return; }
    const stops = data.stops, done = stops.filter(s => ['delivered', 'failed'].includes(s.status) || pending(s.id)).length;
    const notStarted = stops.some(s => ['pending', 'packed'].includes(s.status));
    const pct = stops.length ? Math.round(done / stops.length * 100) : 0;
    const q = queue.get().length;
    $app.innerHTML = `<div class="rider-top"><div class="row nofl between"><div><div style="opacity:.75;font-size:12px">Namaste 🙏</div><div style="font-size:21px;font-weight:900">${esc(me.name || 'Rider')}</div></div><button class="hbtn" id="lo">Log out</button></div>
      <div class="row mt2 gap"><div class="kpi"><b>${stats ? stats.today.delivered : 0}</b><span>Delivered today</span></div><div class="kpi"><b>${inr(stats ? stats.today.earned : 0)}</b><span>Earned today</span></div><div class="kpi"><b>${inr(stats ? stats.week.earned : 0)}</b><span>This week</span></div></div></div>
      <div class="wrapper" style="padding-bottom:100px">
      ${q ? `<div class="card mt" style="background:#fff3d2;border-color:#f3e1a8"><div class="row"><div><b>☁️ ${q} update(s) waiting to sync</b><div class="tiny muted">${navigator.onLine ? 'Syncing…' : 'Will sync when internet returns'}</div></div><button class="btn sm nofl" id="sy" style="flex:none">Sync now</button></div></div>` : ''}
      ${tab === 'route' ? `
        <div class="seg mt2"><button data-d="today" class="${day === 'today' ? 'on' : ''}">Today</button><button data-d="tomorrow" class="${day === 'tomorrow' ? 'on' : ''}">Tomorrow${data.tomorrow && day === 'today' ? ` (${data.tomorrow})` : ''}</button></div>
        ${stops.length ? `<div class="card mt"><div class="row nofl between"><b>${done} of ${stops.length} done</b><span class="muted tiny">${pct}% · ${inr(data.pay)} per delivery</span></div><div class="hbar"><div><i style="width:${pct}%"></i></div></div>
          ${day === 'today' && notStarted ? `<button class="btn full mt amber" id="st">🚀 Start route (${stops.filter(s => ['pending', 'packed'].includes(s.status)).length} orders)</button>` : ''}</div>` : ''}
        ${stops.length ? stops.map((s, i) => stopHtml(s, i)).join('') : `<div class="empty"><div class="big">☕</div><h3>No deliveries ${day === 'today' ? 'today' : 'tomorrow yet'}</h3><p>${day === 'today' ? 'Enjoy your day! New routes are assigned automatically every night at 10:15 PM.' : 'Routes are created automatically after 10:15 PM.'}</p></div>`}`
      : `<div class="card mt2"><h3 class="h3">Earnings</h3>${stats ? [['Today', stats.today], ['Last 7 days', stats.week], ['Last 30 days', stats.month]].map(([l, s]) => `<div class="line"><b class="grow">${l}</b><span class="muted">${s.delivered} deliveries</span><b style="min-width:70px;text-align:right">${inr(s.earned)}</b></div>`).join('') : ''}${stats && stats.rating ? `<p class="mt2">Customer rating ${GF.stars(stats.rating)}</p>` : ''}<p class="tiny muted mt">You earn ${inr(data.pay)} for every successful delivery. Paid out weekly by GharFresh.</p></div>`}
      </div>
      <nav class="bnav"><div><a href="#" data-t="route" class="${tab === 'route' ? 'on' : ''}"><span class="ic">🗺️</span>Route</a><a href="#" data-t="earn" class="${tab === 'earn' ? 'on' : ''}"><span class="ic">💰</span>Earnings</a></div></nav>`;
    $app.querySelector('#lo').onclick = async () => { try { await post('/api/auth/logout'); } catch {} GF.setToken(''); location.reload(); };
    $app.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { day = b.dataset.d; data = null; load(); });
    $app.querySelectorAll('[data-t]').forEach(b => b.onclick = e => { e.preventDefault(); tab = b.dataset.t; render(); });
    const sy = $app.querySelector('#sy'); if (sy) sy.onclick = sync;
    const st = $app.querySelector('#st'); if (st) st.onclick = e => GF.busy(e.currentTarget, async () => { try { const r = await post('/api/rider/start', { date: today() }); GF.toast(`Route started: ${r.started} orders out for delivery 🛵`, 'ok'); load(); } catch (er) { GF.err(er); } });
    $app.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => deliverSheet(stops.find(s => s.id === b.dataset.ok)));
    $app.querySelectorAll('[data-fail]').forEach(b => b.onclick = () => failSheet(stops.find(s => s.id === b.dataset.fail)));
  }

  function stopHtml(s, idx) {
    const a = s.address || {}, c = s.customer || {}, pq = pending(s.id);
    const fin = ['delivered', 'failed'].includes(s.status), items = s.items.map(i => `${i.qty}× ${i.name} ${i.pack}`).join(', ');
    const nav = a.lat ? `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}&travelmode=two_wheeler` : '#';
    return `<div class="stop ${fin || pq ? 'done' : ''}"><div class="row nofl gap" style="align-items:flex-start"><div class="no">${idx + 1}</div><div class="grow"><div class="row nofl between"><b>${esc(c.name || 'Customer')}</b>${pq ? '<span class="chip amber">☁️ Queued</span>' : GF.chip(s.status)}</div>
      <div class="tiny" style="margin-top:3px">${esc(a.house)}, ${esc(a.line1)}</div>${a.landmark ? `<div class="tiny muted">${esc(a.landmark)}</div>` : ''}${a.instructions ? `<div class="tiny" style="color:#8a5a00;font-weight:700;margin-top:3px">📝 ${esc(a.instructions)}</div>` : ''}
      <div class="tiny muted mt">${esc(items)}</div><div class="tiny muted">${esc((s.slot || '') === 'early' ? '🌅 Early slot 5:30–6:30' : '☀️ 6:30–7:30')} · #${s.no}</div></div></div>
      ${!fin && !pq && day === 'today' ? `<div class="row mt" style="gap:8px"><a class="btn ghost sm" href="${nav}" target="_blank" rel="noopener">🧭 Navigate</a>${c.phone ? `<a class="btn ghost sm" href="tel:${esc(c.phone)}">📞 Call</a>` : ''}</div>
      ${['out_for_delivery', 'packed', 'pending'].includes(s.status) ? `<div class="acts"><button class="btn" data-ok="${s.id}">✅ Delivered</button><button class="btn ghost" data-fail="${s.id}" style="color:var(--red);border-color:#f3c7c7">✖ Couldn't deliver</button></div>` : ''}` : ''}</div>`;
  }

  function deliverSheet(s) {
    let photo = null, loc = null;
    const sh = GF.sheet(`<h3 class="h2">Confirm delivery</h3><p class="muted tiny">#${s.no} · ${esc(s.customer.name)} · ${esc(s.address.house)}</p>
      <label class="photo-pick mt" id="pp"><span style="text-align:center"><span style="font-size:42px;display:block">📷</span><b>Take photo of delivered order</b><br><span class="tiny muted">at the customer's door</span></span><input type="file" accept="image/*" capture="environment" hidden id="pf"></label>
      <p class="tiny muted mt" id="gt">📍 Getting GPS location…</p><button class="btn full mt2" id="cf" disabled>Mark delivered</button>`);
    const q = x => sh.el.querySelector(x);
    pos().then(p => { loc = p; q('#gt').innerHTML = `✔ GPS captured (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})`; chk(); }).catch(e => { q('#gt').innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span> <button class="link" id="rg" style="display:inline;width:auto">Retry</button>`; const r = q('#rg'); if (r) r.onclick = () => { q('#gt').textContent = '📍 Retrying…'; pos().then(p => { loc = p; q('#gt').innerHTML = '✔ GPS captured'; chk(); }).catch(er => { q('#gt').textContent = er.message; }); }; });
    const chk = () => { q('#cf').disabled = !(photo && loc); };
    q('#pf').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { photo = await compress(f); q('#pp').innerHTML = `<img src="${photo}" alt="Delivery photo"><input type="file" accept="image/*" capture="environment" hidden id="pf">`; chk(); q('#pf').onchange = q('#pp').onchange; } catch { GF.toast('Could not read the photo. Try again.', 'err'); } };
    q('#cf').onclick = e => GF.busy(e.currentTarget, async () => {
      const item = { type: 'delivered', id: s.id, photo, lat: loc.lat, lng: loc.lng, at: new Date().toISOString() };
      try { await post(`/api/rider/orders/${s.id}/delivered`, item); GF.toast('Delivered ✅ Customer notified', 'ok'); }
      catch (er) { if (er.offline || !navigator.onLine) { queue.push(item); GF.toast('📴 Saved offline. Will sync automatically.', 'ok'); } else { GF.err(er); return; } }
      sh.close(); load();
    });
  }
  function failSheet(s) {
    const reasons = [['customer_absent', 'Customer not available'], ['gate_closed', 'Gate closed / no entry'], ['wrong_address', 'Address not found'], ['refused', 'Customer refused'], ['vehicle_issue', 'Vehicle problem'], ['other', 'Other']];
    let r = 'customer_absent';
    const sh = GF.sheet(`<h3 class="h2">Couldn't deliver</h3><p class="muted tiny">#${s.no} · ${esc(s.customer.name)}</p><div class="mt">${reasons.map(([k, l]) => `<button class="opt ${k === r ? 'on' : ''}" data-r="${k}">${l}</button>`).join('')}</div><label class="lbl">Notes (optional)</label><input class="input" id="nt" placeholder="e.g. called 3 times"><p class="tiny muted">The customer is refunded to their wallet automatically.</p><button class="btn danger full mt2" id="cf">Submit</button>`);
    sh.el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { r = b.dataset.r; sh.el.querySelectorAll('[data-r]').forEach(x => x.classList.toggle('on', x === b)); });
    sh.el.querySelector('#cf').onclick = e => GF.busy(e.currentTarget, async () => {
      let loc = {}; try { loc = await pos(); } catch {}
      const item = { type: 'failed', id: s.id, reason: r, notes: sh.el.querySelector('#nt').value, lat: loc.lat, lng: loc.lng };
      try { await post(`/api/rider/orders/${s.id}/failed`, item); GF.toast('Marked as not delivered'); }
      catch (er) { if (er.offline || !navigator.onLine) { queue.push(item); GF.toast('📴 Saved offline', 'ok'); } else { GF.err(er); return; } }
      sh.close(); load();
    });
  }

  // live location while the route is running
  setInterval(async () => { if (!me || !data || day !== 'today' || !navigator.onLine) return; if (!data.stops.some(s => s.status === 'out_for_delivery')) return; try { const p = await pos(); post('/api/rider/location', p).catch(() => {}); } catch {} }, 20000);

  async function start() {
    GF.registerSW(); net();
    GF.onUnauthorized = () => showLogin();
    if (GF.token()) { try { const r = await get('/api/me'); me = r.user; } catch {} }
    if (!me || me.role !== 'rider') return showLogin(me && me.role !== 'rider' ? 'This area is for delivery partners only.' : '');
    GF.connect(); await load(); sync();
    window.addEventListener('gf:route', load); window.addEventListener('gf:notification', e => GF.toast(`<b>${esc(e.detail.title)}</b><br>${esc(e.detail.body || '')}`));
    setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('.sheet-wrap')) load(); }, 30000);
  }
  function showLogin(msg) {
    me = null; $app.innerHTML = '<div class="login-wrap"><div id="lg"></div></div>';
    GF.loginView(document.getElementById('lg'), { role: 'rider', title: 'GharFresh Rider', sub: msg || 'Login with the email your admin added.', onDone: u => { if (u.role !== 'rider') { GF.setToken(''); return showLogin('This area is for delivery partners only.'); } start(); } });
  }
  window.addEventListener('load', start);
})();
