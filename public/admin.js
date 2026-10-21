'use strict';
// GharFresh admin panel: dashboard, automation control, orders, catalogue, customers, riders, offers.
(function () {
  const { esc, inr, get, post, put, patch, del } = GF;
  const $app = document.getElementById('app');
  let me = null, boot = null, zones = [], timer;
  const TABS = [['dashboard', '📊', 'Dashboard'], ['orders', '📦', 'Orders'], ['products', '🥛', 'Products'], ['customers', '👥', 'Customers'], ['plans', '🔁', 'Plans'], ['complaints', '🛟', 'Complaints'], ['riders', '🛵', 'Riders'], ['zones', '🗺️', 'Areas'], ['offers', '🎟️', 'Offers & banners'], ['automation', '⚙️', 'Automation']];
  const page = () => (location.hash.slice(2).split('?')[0] || 'dashboard');
  const q = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const tbl = (head, rows) => `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="center muted" style="padding:30px">Nothing here yet</td></tr>`}</tbody></table></div>`;
  const sw = (id, on) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><i></i></label>`;

  function shell() {
    const p = page();
    $app.innerHTML = `<div class="adm"><aside class="adm-side"><div class="logo" style="margin:4px 8px 22px"><i>🥛</i><span>GharFresh<small>ADMIN</small></span></div>${TABS.map(([k, i, l]) => `<a href="#/${k}" class="${p === k ? 'on' : ''}"><span>${i}</span>${l}<span class="right" id="b_${k}"></span></a>`).join('')}
        <div style="margin-top:26px;padding:12px;border-radius:14px;background:rgba(255,255,255,.08);font-size:12.5px"><div class="bold">${esc(me.name || me.email)}</div><div style="opacity:.7">${esc(me.email)}</div><a href="/" style="padding:8px 0;margin:0">🛒 Open shop</a><a href="#" id="lo" style="padding:4px 0;margin:0">Log out</a></div></aside>
      <div><div class="adm-top"><div class="logo"><i>🥛</i><span>Admin</span></div><span class="right"><a class="hbtn" href="/">Shop</a> <button class="hbtn" id="lo2">Log out</button></span></div>
        <div class="adm-tabs">${TABS.map(([k, i, l]) => `<a href="#/${k}" class="${p === k ? 'on' : ''}">${i} ${l}</a>`).join('')}</div><div class="adm-main" id="main"></div></div></div>`;
    const lo = async e => { e && e.preventDefault(); try { await post('/api/auth/logout'); } catch {} GF.setToken(''); location.reload(); };
    document.getElementById('lo').onclick = lo; document.getElementById('lo2').onclick = lo;
  }
  const main = () => document.getElementById('main');
  const PAGES = {};
  async function route() {
    clearInterval(timer); shell(); const p = PAGES[page()] ? page() : 'dashboard';
    main().innerHTML = '<div class="skel" style="height:240px"></div>';
    try { boot = await get('/api/bootstrap'); zones = boot.zones; await PAGES[p](); } catch (e) { if (e.status !== 401) main().innerHTML = `<div class="empty"><div class="big">😕</div><h3>${esc(e.message)}</h3><button class="btn mt2" onclick="location.reload()">Reload</button></div>`; }
    window.scrollTo(0, 0);
  }
  let deb; const live = fn => { clearTimeout(deb); deb = setTimeout(() => { if (!document.querySelector('.sheet-wrap')) fn(); }, 600); };

  // ---------- dashboard ----------
  PAGES.dashboard = async function () {
    const d = await get('/api/admin/dashboard'); const a = d.automation, S = a.settings;
    const max = Math.max(...d.series.map(x => x.revenue), 1), tm = d.topProducts[0] ? d.topProducts[0].value : 1;
    const stat = d.statusCount;
    main().innerHTML = `<div class="row nofl between wrap"><div><h1 class="h1">Good ${new Date().getHours() < 12 ? 'morning' : 'day'}, ${esc((me.name || 'Admin').split(' ')[0])} 👋</h1><p class="muted">${GF.fdate(d.now.date)} · everything below updates live</p></div><a class="btn ghost sm" href="/api/admin/export/orders.csv" id="csv">⬇ Export orders CSV</a></div>
    <div class="auto-card mt2"><div class="row nofl between wrap gap"><div><div class="bold" style="font-size:17px"><span class="pulse-dot"></span>Automation is running</div><div style="opacity:.8;font-size:13px;margin-top:2px">${a.autopilot.on ? '🎬 Autopilot demo: simulated riders are delivering right now' : `Next orders generated tonight at <b>${esc(S.genTime)}</b> · cut-off <b>${esc(S.cutoff)}</b>`}</div></div>
      <div class="row nofl gap wrap"><button class="btn amber sm" id="dd">🎬 Run demo day</button><button class="btn amber sm" id="gn" style="background:#fff">⚡ Generate tomorrow now</button>${a.autopilot.on ? '<button class="btn sm" id="ap" style="background:rgba(255,255,255,.2)">⏹ Stop autopilot</button>' : ''}</div></div>
      <div class="row mt2 wrap" style="align-items:flex-start;gap:0 24px"><div style="flex:1;min-width:230px">${[['🌙', `${S.genTime}`, 'Create tomorrow’s orders from subscriptions, charge wallets'], ['🧊', 'Instantly', 'Hold orders if wallet is low · release on top-up'], ['🗺️', 'Instantly', 'Zone routes + nearest-stop order + balanced riders'], ['📦', `${S.packTime}`, 'Auto-pack today’s orders · restock at ' + S.restockTime]].map(([i, t, x]) => `<div class="step-i"><i>${i}</i><div><b>${t}</b> · ${x}</div></div>`).join('')}</div>
      <div style="flex:1;min-width:230px">${[['🛵', 'Live', 'Rider proof (photo+GPS) → customer notified'], ['↩️', 'Instantly', 'Failed delivery → automatic wallet refund'], ['⚡', 'Live', 'Auto-recharge wallets below threshold'], ['🛟', `≤ ${inr(S.autoRefundLimit)}`, 'Small complaints auto-refunded']].map(([i, t, x]) => `<div class="step-i"><i>${i}</i><div><b>${t}</b> · ${x}</div></div>`).join('')}</div></div></div>
    <div class="kpis mt2"><div class="kpi2"><small>Today's orders</small><b>${d.today.orders}</b><span>${d.today.delivered} delivered · ${d.today.failed} failed</span></div><div class="kpi2"><small>Revenue today</small><b>${inr(d.today.revenue)}</b><span>Last 7 days ${inr(d.kpis.weekRevenue)}</span></div><div class="kpi2"><small>Tomorrow</small><b>${d.tomorrow.orders}</b><span>${d.tomorrow.onHold} on hold · ${d.tomorrow.expectedSubs} plans due</span></div><div class="kpi2"><small>On-time delivery</small><b>${d.today.onTimePct}%</b><span>before 7:30 AM</span></div>
      <div class="kpi2"><small>Customers</small><b>${d.kpis.customers}</b><span>${d.kpis.activeSubs} active plans</span></div><div class="kpi2"><small>Wallet balance held</small><b>${inr(d.kpis.walletLiability)}</b><span>customer money</span></div><div class="kpi2"><small>Held orders</small><b style="color:${d.kpis.held ? 'var(--red)' : 'inherit'}">${d.kpis.held}</b><span>wallet too low</span></div><div class="kpi2"><small>Open complaints</small><b>${d.kpis.openComplaints}</b><span><a href="#/complaints" style="color:var(--g);font-weight:700">Review →</a></span></div></div>
    <div class="col2 mt2"><div class="card"><h3 class="h3">Revenue · last 14 days</h3><div class="bars mt2">${d.series.map((s, i) => `<div class="${i === 13 ? 'today' : ''}" style="height:${Math.max(3, s.revenue / max * 100)}%" title="${s.date}: ${inr(s.revenue)} (${s.orders} orders)"><span>${s.revenue ? Math.round(s.revenue / 100) / 10 + 'k' : ''}</span></div>`).join('')}</div><div class="barlbl">${d.series.map(s => `<span>${+s.date.slice(8)}</span>`).join('')}</div></div>
      <div class="card"><h3 class="h3">Today's status</h3>${Object.keys(stat).length ? Object.entries(stat).map(([k, v]) => `<div class="row nofl between mt">${GF.chip(k)}<b>${v}</b></div>`).join('') : '<p class="muted mt">No orders yet today.</p>'}<h3 class="h3 mt2">Riders</h3>${d.riders.map(r => `<div class="hbar"><div class="row nofl between" style="background:none;height:auto;overflow:visible"><b style="font-size:13.5px">${esc(r.name)}</b><span class="muted tiny">${r.delivered}/${r.assigned}</span></div><div><i style="width:${r.assigned ? r.delivered / r.assigned * 100 : 0}%"></i></div></div>`).join('')}</div></div>
    <div class="col2 mt2"><div class="card"><h3 class="h3">Top products · 7 days</h3>${d.topProducts.map(t => `<div class="hbar"><div class="row nofl between" style="background:none;height:auto;overflow:visible"><span>${esc(t.name)}</span><b>${inr(t.value)}</b></div><div><i style="width:${t.value / tm * 100}%"></i></div></div>`).join('')}</div>
      <div><div class="card"><h3 class="h3">⚠ Low stock</h3>${d.lowStock.length ? d.lowStock.map(p => `<div class="row nofl between mt"><span>${esc(p.name)} ${esc(p.pack)}</span><span class="chip red">${p.stock} left</span></div>`).join('') + `<p class="tiny muted mt">Stock refills to par level automatically at ${esc(S.restockTime)}.</p>` : '<p class="muted mt">All products well stocked ✅</p>'}</div>
      <div class="card"><h3 class="h3">Automation feed</h3><div class="feed">${a.recent.map(x => `<div><b>${esc(x.action.replace(/_/g, ' '))}</b> <small>${GF.ago(x.at)}</small><br><small>${esc(Object.entries(x.details || {}).filter(([k]) => k !== 'by').map(([k, v]) => `${k}: ${v}`).join(' · '))}</small></div>`).join('') || '<small class="muted">Nothing yet</small>'}</div></div></div></div>`;
    const m = main();
    m.querySelector('#csv').onclick = async e => { e.preventDefault(); const r = await fetch('/api/admin/export/orders.csv', { headers: { Authorization: 'Bearer ' + GF.token() } }); const b = await r.blob(); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'gharfresh-orders.csv'; a.click(); };
    m.querySelector('#dd').onclick = e => GF.busy(e.currentTarget, async () => { try { const r = await post('/api/admin/demo-day'); GF.toast(`🎬 ${r.created} orders created. Watch the deliveries happen live!`, 'ok'); PAGES.dashboard(); } catch (er) { GF.err(er); } });
    m.querySelector('#gn').onclick = e => GF.busy(e.currentTarget, async () => { try { const r = await post('/api/admin/generate', {}); GF.toast(`✅ ${r.created} orders created, ${r.on_hold} on hold for ${GF.fdate(r.delivery_date)}`, 'ok'); PAGES.dashboard(); } catch (er) { GF.err(er); } });
    const ap = m.querySelector('#ap'); if (ap) ap.onclick = async () => { await post('/api/admin/autopilot', { on: false }); PAGES.dashboard(); };
    timer = setInterval(() => { if (page() === 'dashboard' && !document.querySelector('.sheet-wrap')) PAGES.dashboard(); }, a.autopilot.on ? 5000 : 20000);
  };

  // ---------- orders ----------
  let ofil = { date: '', status: '', q: '' };
  PAGES.orders = async function () {
    if (!ofil.date && ofil.date !== null) ofil.date = today();
    const riders = await get('/api/admin/riders');
    const draw = async () => {
      const qs = new URLSearchParams(Object.entries(ofil).filter(([, v]) => v)).toString();
      const os = await get('/api/admin/orders?' + qs);
      const el = document.getElementById('ot'); if (!el) return;
      el.innerHTML = tbl(['#', 'Customer', 'Area', 'Items', 'Total', 'Status', 'Rider', ''], os.map(o => `<tr><td><b>#${o.no}</b><div class="tiny muted">${GF.fdateShort(o.date)}</div></td><td>${esc(o.customer ? o.customer.name : '')}<div class="tiny muted">${esc(o.customer ? o.customer.email : '')}</div></td><td>${esc(o.address ? o.address.zone : '')}</td><td class="tiny" style="max-width:220px">${esc(o.items.map(i => `${i.qty}× ${i.name} ${i.pack}`).join(', '))}</td><td><b>${inr(o.total)}</b><div class="tiny muted">${o.payStatus}</div></td><td>${GF.chip(o.status)}</td>
        <td>${['delivered', 'cancelled', 'failed'].includes(o.status) ? esc(o.rider ? o.rider.name : '—') : `<select class="input" style="height:34px;padding:0 8px;font-size:12.5px;min-width:110px" data-as="${o.id}"><option value="">Unassigned</option>${riders.map(r => `<option value="${r.id}" ${o.riderId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`}</td><td><button class="btn ghost xs" data-o="${o.id}">Open</button></td></tr>`));
      el.querySelectorAll('[data-as]').forEach(s => s.onchange = async () => { if (!s.value) return; try { await patch('/api/admin/orders/' + s.dataset.as, { action: 'assign', riderId: s.value }); GF.toast('Rider assigned ✅', 'ok'); } catch (e) { GF.err(e); } });
      el.querySelectorAll('[data-o]').forEach(b => b.onclick = () => openOrder(os.find(o => o.id === b.dataset.o), draw));
    };
    main().innerHTML = `<h1 class="h1">Orders</h1><div class="row nofl gap wrap mt" id="of"><input class="input" type="date" id="fd" value="${ofil.date || ''}" style="width:170px"><select class="input" id="fs" style="width:170px"><option value="">All statuses</option>${Object.entries(GF.STATUS).map(([k, [l]]) => `<option value="${k}" ${ofil.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select><input class="input" id="fq" placeholder="Search # / name / area" value="${esc(ofil.q)}" style="width:230px"><button class="btn ghost sm" id="fa">All dates</button><button class="btn sm" id="fn">Tomorrow</button></div><div class="mt" id="ot"></div>`;
    const m = main(), f = () => { ofil.date = m.querySelector('#fd').value; ofil.status = m.querySelector('#fs').value; ofil.q = m.querySelector('#fq').value; draw(); };
    ['#fd', '#fs'].forEach(s => m.querySelector(s).onchange = f); m.querySelector('#fq').oninput = () => { clearTimeout(deb); deb = setTimeout(f, 300); };
    m.querySelector('#fa').onclick = () => { ofil.date = null; m.querySelector('#fd').value = ''; f(); }; m.querySelector('#fn').onclick = () => { m.querySelector('#fd').value = GF.addDays(today(), 1); f(); };
    await draw(); window.__ordersRefresh = draw;
  };
  function openOrder(o, after) {
    const sh = GF.sheet(`<h3 class="h2">Order #${o.no} ${GF.chip(o.status)}</h3><p class="muted tiny">${esc(o.customer.name)} · ${esc(o.customer.email)}${o.customer.phone ? ' · ' + esc(o.customer.phone) : ''}<br>${esc(o.address ? `${o.address.house}, ${o.address.line1}` : '')} · ${esc(o.address ? o.address.zone : '')}</p>
      <div class="card flat mt">${o.items.map(i => `<div class="row nofl between mt"><span>${i.qty}× ${esc(i.name)} ${esc(i.pack)}</span><b>${inr(i.price * i.qty)}</b></div>`).join('')}<div class="row nofl between mt"><span class="muted">Delivery ${inr(o.fee)} ${o.discount ? '· Discount −' + inr(o.discount) : ''}</span><b>Total ${inr(o.total)}</b></div></div>
      <div class="tl mt2">${o.timeline.map(t => `<div class="st done"><b>${esc((GF.STATUS[t.status] || [t.status])[0])}</b><span>${GF.fdt(t.at)} · ${esc(t.note)}</span></div>`).join('')}</div>
      ${o.proof ? `<div class="proof mt"><img src="${esc(o.proof.photo)}" alt="Delivery proof"></div><p class="tiny muted">${o.proof.lat ? `GPS ${(+o.proof.lat).toFixed(5)}, ${(+o.proof.lng).toFixed(5)} · ` : ''}${GF.fdt(o.proof.at)}</p>` : ''}
      <div class="row wrap mt2">${o.status === 'pending' ? '<button class="btn ghost sm" data-a="pack">📦 Mark packed</button>' : ''}${o.status === 'on_hold' ? '<button class="btn sm" data-a="release">🔓 Release</button>' : ''}${['pending', 'packed', 'out_for_delivery'].includes(o.status) ? '<button class="btn ghost sm" data-a="deliver">✅ Mark delivered</button><button class="btn ghost sm" data-a="fail">✖ Failed</button>' : ''}${['pending', 'packed', 'on_hold'].includes(o.status) ? '<button class="btn danger sm" data-a="cancel">Cancel &amp; refund</button>' : ''}${o.status === 'delivered' && o.payStatus === 'paid' ? '<button class="btn ghost sm" data-a="refund">↩ Refund to wallet</button>' : ''}</div>`);
    sh.el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => GF.busy(b, async () => { try { await patch('/api/admin/orders/' + o.id, { action: b.dataset.a }); GF.toast('Done ✅', 'ok'); sh.close(); after && after(); } catch (e) { GF.err(e); } }));
  }

  // ---------- products ----------
  PAGES.products = async function () {
    const cats = boot.categories, ps = boot.products;
    main().innerHTML = `<div class="row nofl between wrap"><h1 class="h1">Products <span class="muted tiny">${ps.length}</span></h1><div class="row nofl gap"><button class="btn ghost sm" id="nc">+ Category</button><button class="btn sm" id="np">+ New product</button></div></div><div class="mt">${tbl(['', 'Product', 'Category', 'Price', 'Stock', 'Photos', 'Active', ''], ps.map(p => `<tr><td>${GF.img(p.images, 'th', p.name)}</td><td><b>${esc(p.name)}</b><div class="tiny muted">${esc(p.pack)} ${p.subOk ? '· 🔁 subscribable' : ''}</div></td><td>${esc((cats.find(c => c.id === p.catId) || {}).name || '')}</td><td><b>${inr(p.price)}</b><div class="tiny muted strike">${p.mrp > p.price ? inr(p.mrp) : ''}</div></td><td>${p.stock <= 15 ? `<span class="chip red">${p.stock}</span>` : p.stock}<div class="tiny muted">par ${p.par}</div></td><td>${p.images.length} 📷</td><td>${sw('a_' + p.id, p.active)}</td><td><button class="btn ghost xs" data-e="${p.id}">Edit</button></td></tr>`))}</div>`;
    const m = main();
    m.querySelector('#np').onclick = () => productSheet(null); m.querySelector('#nc').onclick = () => catSheet();
    m.querySelectorAll('[data-e]').forEach(b => b.onclick = () => productSheet(ps.find(p => p.id === b.dataset.e)));
    ps.forEach(p => { const s = m.querySelector('#a_' + p.id); if (s) s.onchange = async () => { try { await put('/api/admin/products/' + p.id, { active: s.checked }); GF.toast(s.checked ? 'Visible in shop' : 'Hidden from shop', 'ok'); } catch (e) { GF.err(e); } }; });
  };
  function catSheet() {
    const sh = GF.sheet(`<h3 class="h2">New category</h3><label class="lbl">Name</label><input class="input" id="cn" placeholder="e.g. Sweets"><label class="lbl">Emoji icon</label><input class="input" id="ci" value="🍬" maxlength="2"><button class="btn full mt2" id="ok">Create</button>`);
    sh.el.querySelector('#ok').onclick = async () => { try { await post('/api/admin/categories', { name: sh.el.querySelector('#cn').value, icon: sh.el.querySelector('#ci').value }); sh.close(); PAGES.products(); } catch (e) { GF.err(e); } };
  }
  function productSheet(p) {
    const isNew = !p; p = p || { name: '', pack: '', price: '', mrp: '', stock: 50, par: 50, subOk: true, active: true, desc: '', images: [], nutrition: {}, tags: [], source: '', shelfLife: '', catId: boot.categories[0].id };
    let imgs = [...p.images];
    const sh = GF.sheet('', { wide: true }); const el = sh.el;
    const draw = () => {
      el.innerHTML = `<h3 class="h2">${isNew ? 'New product' : 'Edit product'}</h3><div class="form-grid"><div><label class="lbl">Name</label><input class="input" id="n" value="${esc(p.name)}"></div><div><label class="lbl">Pack size</label><input class="input" id="pk" value="${esc(p.pack)}" placeholder="500 ml"></div>
      <div><label class="lbl">Category</label><select class="input" id="c">${boot.categories.map(c => `<option value="${c.id}" ${c.id === p.catId ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select></div><div><label class="lbl">Source / farm</label><input class="input" id="so" value="${esc(p.source || '')}"></div>
      <div><label class="lbl">Selling price ₹</label><input class="input" id="pr" type="number" value="${p.price}"></div><div><label class="lbl">MRP ₹</label><input class="input" id="mr" type="number" value="${p.mrp}"></div>
      <div><label class="lbl">Stock today</label><input class="input" id="st" type="number" value="${p.stock}"></div><div><label class="lbl">Daily par level (auto-restock)</label><input class="input" id="pa" type="number" value="${p.par}"></div>
      <div><label class="lbl">Shelf life</label><input class="input" id="sl" value="${esc(p.shelfLife || '')}" placeholder="3 days chilled"></div><div><label class="lbl">Tags (comma separated)</label><input class="input" id="tg" value="${esc((p.tags || []).join(', '))}" placeholder="Bestseller, A2"></div></div>
      <label class="lbl">Description</label><textarea class="input" id="d">${esc(p.desc)}</textarea>
      <label class="lbl">Nutrition (one per line: Name: value)</label><textarea class="input" id="nu" placeholder="Protein: 3.2 g">${esc(Object.entries(p.nutrition || {}).map(([k, v]) => `${k}: ${v}`).join('\n'))}</textarea>
      <label class="lbl">Photos (${imgs.length}) — the first one is the cover</label><div class="imgs">${imgs.map((u, i) => `<div class="im"><img src="${esc(u)}" alt="" onerror="this.src='/products/cow-milk-1l.svg'" data-first="${i}" title="Click to make cover" style="cursor:pointer;${i === 0 ? 'outline:3px solid var(--g)' : ''}"><button data-rm="${i}" aria-label="Remove">✕</button></div>`).join('')}</div>
      <div class="row mt"><input class="input" id="iu" placeholder="Paste image link (https://…)"><button class="btn ghost sm nofl" id="ia" style="flex:none">Add link</button></div><label class="btn ghost sm mt" style="display:inline-flex;cursor:pointer">⬆ Upload photo<input type="file" accept="image/*" hidden id="if" multiple></label>
      <div class="row nofl gap wrap mt2"><label class="row nofl gap"><span class="switch">${''}<input type="checkbox" id="so2" ${p.subOk ? 'checked' : ''}><i></i></span>Allow subscription</label><label class="row nofl gap"><span class="switch"><input type="checkbox" id="ac" ${p.active ? 'checked' : ''}><i></i></span>Visible in shop</label></div>
      <button class="btn full mt2" id="sv">${isNew ? 'Create product' : 'Save changes'}</button>`;
      const g = s => el.querySelector(s);
      g('#ia').onclick = () => { const u = g('#iu').value.trim(); if (!/^(https?:\/\/|\/)/.test(u)) return GF.toast('Enter a valid link', 'err'); keep(); imgs.push(u); draw(); };
      g('#if').onchange = async e => { keep(); for (const f of e.target.files) { try { const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => { const s = Math.min(1, 1200 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = im.width * s; c.height = im.height * s; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .85)); }; im.onerror = rej; im.src = r.result; }; r.onerror = rej; r.readAsDataURL(f); }); const r = await post('/api/admin/upload', { dataUrl }); imgs.push(r.url); } catch (er) { GF.err(er); } } draw(); };
      el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { keep(); imgs.splice(+b.dataset.rm, 1); draw(); });
      el.querySelectorAll('[data-first]').forEach(b => b.onclick = () => { keep(); const i = +b.dataset.first; imgs.unshift(imgs.splice(i, 1)[0]); draw(); });
      g('#sv').onclick = ev => GF.busy(ev.currentTarget, async () => {
        const nutrition = {}; g('#nu').value.split('\n').forEach(l => { const k = l.split(':'); if (k.length > 1 && k[0].trim()) nutrition[k[0].trim()] = k.slice(1).join(':').trim(); });
        const body = { name: g('#n').value, pack: g('#pk').value, catId: g('#c').value, source: g('#so').value, price: g('#pr').value, mrp: g('#mr').value || g('#pr').value, stock: g('#st').value, par: g('#pa').value, shelfLife: g('#sl').value, tags: g('#tg').value.split(',').map(x => x.trim()).filter(Boolean), desc: g('#d').value, nutrition, images: imgs, subOk: g('#so2').checked, active: g('#ac').checked };
        try { isNew ? await post('/api/admin/products', body) : await put('/api/admin/products/' + p.id, body); GF.toast('Saved ✅', 'ok'); sh.close(); PAGES.products(); } catch (e) { GF.err(e); }
      });
      function keep() { p = { ...p, name: g('#n').value, pack: g('#pk').value, catId: g('#c').value, source: g('#so').value, price: g('#pr').value, mrp: g('#mr').value, stock: g('#st').value, par: g('#pa').value, shelfLife: g('#sl').value, tags: g('#tg').value.split(',').map(x => x.trim()).filter(Boolean), desc: g('#d').value, subOk: g('#so2').checked, active: g('#ac').checked, nutrition: (() => { const n = {}; g('#nu').value.split('\n').forEach(l => { const k = l.split(':'); if (k.length > 1 && k[0].trim()) n[k[0].trim()] = k.slice(1).join(':').trim(); }); return n; })() }; }
    };
    draw();
  }

  // ---------- customers ----------
  PAGES.customers = async function () {
    const draw = async (qv = '') => {
      const cs = await get('/api/admin/customers?q=' + encodeURIComponent(qv)); const el = document.getElementById('ct'); if (!el) return;
      el.innerHTML = tbl(['Customer', 'Area', 'Wallet', 'Orders', 'Spent', 'Plans', 'Joined', ''], cs.map(c => `<tr><td><b>${esc(c.name || '—')}</b> ${c.blocked ? '<span class="chip red">Blocked</span>' : ''}<div class="tiny muted">${esc(c.email)}${c.phone ? ' · ' + esc(c.phone) : ''}</div></td><td>${esc(c.zone || '—')}</td><td><b style="color:${c.balance < 100 ? 'var(--red)' : 'inherit'}">${inr(c.balance)}</b></td><td>${c.orders}</td><td>${inr(c.spent)}</td><td>${c.subs}</td><td class="tiny">${GF.fdateShort(c.joined)}</td><td class="row nofl gap"><button class="btn ghost xs" data-w="${c.id}">Wallet</button><button class="btn ghost xs" data-b="${c.id}" style="${c.blocked ? '' : 'color:var(--red)'}">${c.blocked ? 'Unblock' : 'Block'}</button></td></tr>`));
      el.querySelectorAll('[data-w]').forEach(b => b.onclick = () => walletSheet(cs.find(c => c.id === b.dataset.w), draw));
      el.querySelectorAll('[data-b]').forEach(b => b.onclick = async () => { const c = cs.find(x => x.id === b.dataset.b); try { await put('/api/admin/customers/' + c.id, { blocked: !c.blocked }); draw(); } catch (e) { GF.err(e); } });
    };
    main().innerHTML = `<h1 class="h1">Customers</h1><input class="input mt" id="cq" placeholder="Search name, email or phone" style="max-width:340px"><div class="mt" id="ct"></div>`;
    main().querySelector('#cq').oninput = e => { clearTimeout(deb); deb = setTimeout(() => draw(e.target.value), 300); }; draw();
  };
  function walletSheet(c, after) {
    let type = 'credit';
    const sh = GF.sheet(`<h3 class="h2">Wallet · ${esc(c.name)}</h3><p class="muted">Balance <b>${inr(c.balance)}</b></p><div class="seg mt"><button class="on" data-t="credit">Add money</button><button data-t="cashback">Cashback</button><button data-t="debit">Deduct</button></div><label class="lbl">Amount ₹</label><input class="input" type="number" id="am" min="1"><label class="lbl">Note</label><input class="input" id="nt" placeholder="e.g. Cash received / goodwill credit"><button class="btn full mt2" id="ok">Apply</button><p class="tiny muted mt">Held orders for this customer release automatically when the balance covers them.</p>`);
    sh.el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { type = b.dataset.t; sh.el.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b)); });
    sh.el.querySelector('#ok').onclick = e => GF.busy(e.currentTarget, async () => { try { const r = await post(`/api/admin/customers/${c.id}/wallet`, { type, amount: sh.el.querySelector('#am').value, note: sh.el.querySelector('#nt').value }); GF.toast(`New balance ${inr(r.balance)}${r.released ? ` · ${r.released} order(s) released` : ''}`, 'ok'); sh.close(); after(); } catch (er) { GF.err(er); } });
  }

  // ---------- plans ----------
  PAGES.plans = async function () {
    const ss = await get('/api/admin/subscriptions');
    main().innerHTML = `<h1 class="h1">Subscriptions <span class="muted tiny">${ss.length}</span></h1><div class="mt">${tbl(['Customer', 'Product', 'Plan', 'Next delivery', 'Status', ''], ss.map(s => `<tr><td>${esc(s.customer ? s.customer.name : '')}<div class="tiny muted">${esc(s.customer ? s.customer.email : '')}</div></td><td>${s.qty}× ${esc(s.product ? s.product.name + ' ' + s.product.pack : '')}</td><td>${GF.FREQ[s.freq]}</td><td>${s.next ? GF.fdate(s.next) : '—'}</td><td><span class="chip ${s.status === 'active' ? 'green' : 'amber'}">${s.status}</span></td><td class="row nofl gap">${s.status === 'active' ? `<button class="btn ghost xs" data-s="${s.id}" data-v="paused">Pause</button>` : `<button class="btn ghost xs" data-s="${s.id}" data-v="active">Resume</button>`}<button class="btn ghost xs" style="color:var(--red)" data-s="${s.id}" data-v="cancelled">Cancel</button></td></tr>`))}</div>`;
    main().querySelectorAll('[data-s]').forEach(b => b.onclick = async () => { try { await patch('/api/admin/subscriptions/' + b.dataset.s, { status: b.dataset.v }); PAGES.plans(); } catch (e) { GF.err(e); } });
  };

  // ---------- complaints ----------
  PAGES.complaints = async function () {
    const cs = await get('/api/admin/complaints');
    main().innerHTML = `<h1 class="h1">Complaints</h1><div class="mt">${cs.length ? cs.map(c => `<div class="card"><div class="row nofl between wrap"><div><b>#${c.orderNo || ''} · ${esc(c.type.replace('_', ' '))}</b> <span class="chip ${c.status === 'open' ? 'amber' : c.status === 'resolved' ? 'green' : 'gray'}">${c.status}</span><div class="tiny muted">${esc(c.customer ? c.customer.name : '')} · ${GF.ago(c.createdAt)} · order ${inr(c.orderTotal)}</div></div>${c.status === 'open' ? `<div class="row nofl gap wrap"><button class="btn sm" data-r="${c.id}" data-t="${c.orderTotal || 0}">↩ Refund</button><button class="btn ghost sm" data-ok="${c.id}">Resolve</button><button class="btn ghost sm" data-no="${c.id}" style="color:var(--red)">Reject</button></div>` : ''}</div><p class="mt">${esc(c.description || '—')}</p>${c.resolution ? `<p class="tiny muted mt">➜ ${esc(c.resolution)}${c.refund ? ` (${inr(c.refund)} refunded)` : ''}</p>` : ''}</div>`).join('') : '<div class="empty"><div class="big">🎉</div><h3>No complaints</h3></div>'}</div>`;
    const m = main(); const act = async (id, body) => { try { await post('/api/admin/complaints/' + id, body); PAGES.complaints(); } catch (e) { GF.err(e); } };
    m.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { const sh = GF.sheet(`<h3 class="h2">Refund to wallet</h3><label class="lbl">Amount ₹</label><input class="input" id="am" type="number" value="${b.dataset.t}"><label class="lbl">Note to customer</label><input class="input" id="nt" placeholder="Sorry for the inconvenience"><button class="btn full mt2" id="ok">Refund</button>`); sh.el.querySelector('#ok').onclick = () => { act(b.dataset.r, { action: 'refund', amount: sh.el.querySelector('#am').value, note: sh.el.querySelector('#nt').value }); sh.close(); }; });
    m.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => act(b.dataset.ok, { action: 'resolve' })); m.querySelectorAll('[data-no]').forEach(b => b.onclick = () => act(b.dataset.no, { action: 'reject' }));
  };

  // ---------- riders ----------
  PAGES.riders = async function () {
    const rs = await get('/api/admin/riders');
    main().innerHTML = `<div class="row nofl between"><h1 class="h1">Riders</h1><button class="btn sm" id="nr">+ Add rider</button></div><div class="mt">${tbl(['Rider', 'Zones', 'Today', 'Delivered', 'Failed', 'Earned', 'Active', ''], rs.map(r => `<tr><td><b>${esc(r.name)}</b><div class="tiny muted">${esc(r.email)} · ${esc(r.phone || '')}<br>${esc(r.vehicle || '')}</div></td><td class="tiny">${(r.zoneIds || []).map(z => esc((zones.find(x => x.id === z) || {}).name)).join(', ') || 'All areas'}</td><td>${r.todayAssigned}</td><td>${r.delivered}</td><td>${r.failed}</td><td>${inr(r.earned)}</td><td>${sw('ra_' + r.id, r.active)}</td><td><button class="btn ghost xs" data-e="${r.id}">Edit</button></td></tr>`))}</div><p class="tiny muted mt">Riders log in on <b>/rider</b> with their email (OTP). Routes and stop order are created automatically every night.</p>`;
    const m = main(); m.querySelector('#nr').onclick = () => riderSheet(null);
    m.querySelectorAll('[data-e]').forEach(b => b.onclick = () => riderSheet(rs.find(r => r.id === b.dataset.e)));
    rs.forEach(r => { const s = m.querySelector('#ra_' + r.id); s.onchange = async () => { try { await put('/api/admin/riders/' + r.id, { active: s.checked }); GF.toast(s.checked ? 'Rider active' : 'Rider will not get new routes', 'ok'); } catch (e) { GF.err(e); } }; });
  };
  function riderSheet(r) {
    const n = !r; r = r || { zoneIds: [] }; let zs = [...(r.zoneIds || [])];
    const sh = GF.sheet(`<h3 class="h2">${n ? 'Add rider' : 'Edit rider'}</h3><div class="form-grid"><div><label class="lbl">Name</label><input class="input" id="n" value="${esc(r.name || '')}"></div><div><label class="lbl">Mobile</label><input class="input" id="p" value="${esc(r.phone || '')}"></div></div><label class="lbl">Email (login)</label><input class="input" id="e" type="email" value="${esc(r.email || '')}" ${n ? '' : 'disabled'}><label class="lbl">Vehicle</label><input class="input" id="v" value="${esc(r.vehicle || '')}"><label class="lbl">Areas (none = all)</label><div class="pills" id="zp">${zones.map(z => `<button class="pill ${zs.includes(z.id) ? 'on' : ''}" data-z="${z.id}">${esc(z.name)}</button>`).join('')}</div><button class="btn full mt2" id="ok">Save</button>`);
    sh.el.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { const z = b.dataset.z; zs = zs.includes(z) ? zs.filter(x => x !== z) : zs.concat(z); b.classList.toggle('on'); });
    sh.el.querySelector('#ok').onclick = e => GF.busy(e.currentTarget, async () => { const body = { name: sh.el.querySelector('#n').value, phone: sh.el.querySelector('#p').value, vehicle: sh.el.querySelector('#v').value, zoneIds: zs, email: sh.el.querySelector('#e').value }; try { n ? await post('/api/admin/riders', body) : await put('/api/admin/riders/' + r.id, body); sh.close(); PAGES.riders(); } catch (er) { GF.err(er); } });
  }

  // ---------- zones ----------
  PAGES.zones = async function () {
    const zs = await get('/api/admin/zones');
    main().innerHTML = `<div class="row nofl between"><h1 class="h1">Delivery areas</h1><button class="btn sm" id="nz">+ Add area</button></div><div class="mt">${tbl(['Area', 'Pincode', 'Delivery fee', 'Free above', 'Customers', 'Active', ''], zs.map(z => `<tr><td><b>${esc(z.name)}</b></td><td>${esc(z.pincode)}</td><td>${z.fee ? inr(z.fee) : 'Free'}</td><td>${z.freeAbove != null ? inr(z.freeAbove) : 'Default ' + inr(boot.settings.freeDeliveryAbove)}</td><td>${z.customers}</td><td>${sw('za_' + z.id, z.active)}</td><td><button class="btn ghost xs" data-e="${z.id}">Edit</button></td></tr>`))}</div><p class="tiny muted mt">Customers can only order to active areas. Area centre (lat/lng) is the starting point for the automatic stop ordering.</p>`;
    const m = main(); m.querySelector('#nz').onclick = () => zoneSheet(null); m.querySelectorAll('[data-e]').forEach(b => b.onclick = () => zoneSheet(zs.find(z => z.id === b.dataset.e)));
    zs.forEach(z => { const s = m.querySelector('#za_' + z.id); s.onchange = async () => { try { await put('/api/admin/zones/' + z.id, { active: s.checked }); } catch (e) { GF.err(e); } }; });
  };
  function zoneSheet(z) {
    const n = !z; z = z || { fee: 0, lat: 26.9124, lng: 75.7873 };
    const sh = GF.sheet(`<h3 class="h2">${n ? 'New' : 'Edit'} area</h3><div class="form-grid"><div><label class="lbl">Name</label><input class="input" id="n" value="${esc(z.name || '')}"></div><div><label class="lbl">Pincode</label><input class="input" id="p" value="${esc(z.pincode || '')}" maxlength="6"></div><div><label class="lbl">Delivery fee ₹</label><input class="input" id="f" type="number" value="${z.fee}"></div><div><label class="lbl">Free delivery above ₹ (blank = default)</label><input class="input" id="fa" type="number" value="${z.freeAbove ?? ''}"></div><div><label class="lbl">Centre latitude</label><input class="input" id="la" value="${z.lat}"></div><div><label class="lbl">Centre longitude</label><input class="input" id="lo" value="${z.lng}"></div></div><button class="btn full mt2" id="ok">Save</button>`);
    sh.el.querySelector('#ok').onclick = async () => { const g = s => sh.el.querySelector(s).value; const body = { name: g('#n'), pincode: g('#p'), fee: g('#f'), freeAbove: g('#fa'), lat: g('#la'), lng: g('#lo') }; try { n ? await post('/api/admin/zones', body) : await put('/api/admin/zones/' + z.id, body); sh.close(); PAGES.zones(); } catch (e) { GF.err(e); } };
  }

  // ---------- offers + banners ----------
  PAGES.offers = async function () {
    const [cs, bs] = await Promise.all([get('/api/admin/coupons'), get('/api/admin/banners')]);
    main().innerHTML = `<div class="row nofl between"><h1 class="h1">Offers &amp; banners</h1></div>
    <div class="row nofl between mt2"><h3 class="h3">Coupons</h3><button class="btn sm" id="nk">+ New coupon</button></div><div class="mt">${tbl(['Code', 'Offer', 'Min order', 'Rules', 'Valid till', 'Active'], cs.map(c => `<tr><td><b>${esc(c.code)}</b></td><td>${c.type === 'percent' ? c.value + '% off' + (c.maxDiscount ? ' (max ' + inr(c.maxDiscount) + ')' : '') : c.type === 'flat' ? inr(c.value) + ' off' : 'Free delivery'}</td><td>${inr(c.minOrder)}</td><td class="tiny">${c.firstOrderOnly ? 'First order only' : ''} ${c.perUserLimit ? '· ' + c.perUserLimit + '× per user' : ''}</td><td>${c.validTo || '—'}</td><td>${sw('ka_' + c.id, c.active)}</td></tr>`))}</div>
    <div class="row nofl between mt3"><h3 class="h3">Home banners</h3><button class="btn sm" id="nb">+ New banner</button></div><div class="mt">${bs.map(b => `<div class="card row nofl gap" style="align-items:center"><div style="width:110px;height:64px;border-radius:12px;background:#0e5a3a url('${esc(b.img)}') center/cover;flex:none"></div><div class="grow" style="min-width:0"><b>${esc(b.title)}</b><div class="tiny muted">${esc(b.sub)}</div></div>${sw('ba_' + b.id, b.active)}<button class="btn ghost xs" data-be="${b.id}">Edit</button></div>`).join('')}</div>`;
    const m = main(); m.querySelector('#nk').onclick = couponSheet; m.querySelector('#nb').onclick = () => bannerSheet(null);
    cs.forEach(c => { m.querySelector('#ka_' + c.id).onchange = async e => { try { await put('/api/admin/coupons/' + c.id, { active: e.target.checked }); } catch (er) { GF.err(er); } }; });
    bs.forEach(b => { m.querySelector('#ba_' + b.id).onchange = async e => { try { await put('/api/admin/banners/' + b.id, { active: e.target.checked }); } catch (er) { GF.err(er); } }; });
    m.querySelectorAll('[data-be]').forEach(b => b.onclick = () => bannerSheet(bs.find(x => x.id === b.dataset.be)));
  };
  function couponSheet() {
    const sh = GF.sheet(`<h3 class="h2">New coupon</h3><div class="form-grid"><div><label class="lbl">Code</label><input class="input" id="c" placeholder="DIWALI20" style="text-transform:uppercase"></div><div><label class="lbl">Type</label><select class="input" id="t"><option value="flat">Flat ₹ off</option><option value="percent">Percent off</option><option value="free_delivery">Free delivery</option></select></div><div><label class="lbl">Value (₹ or %)</label><input class="input" id="v" type="number"></div><div><label class="lbl">Max discount ₹ (for %)</label><input class="input" id="m" type="number"></div><div><label class="lbl">Minimum order ₹</label><input class="input" id="o" type="number" value="0"></div><div><label class="lbl">Valid till</label><input class="input" id="d" type="date"></div></div><label class="lbl">Description</label><input class="input" id="x" placeholder="Shown to customers"><label class="row nofl gap mt"><span class="switch"><input type="checkbox" id="f"><i></i></span>First order only</label><button class="btn full mt2" id="ok">Create</button>`);
    sh.el.querySelector('#ok').onclick = async () => { const g = s => sh.el.querySelector(s); try { await post('/api/admin/coupons', { code: g('#c').value, type: g('#t').value, value: g('#v').value, maxDiscount: g('#m').value, minOrder: g('#o').value, validTo: g('#d').value || null, desc: g('#x').value, firstOrderOnly: g('#f').checked, perUserLimit: g('#f').checked ? 1 : 0 }); sh.close(); PAGES.offers(); } catch (e) { GF.err(e); } };
  }
  function bannerSheet(b) {
    const n = !b; b = b || { tone: 'green', link: '#/shop', cta: 'Shop now' };
    const sh = GF.sheet(`<h3 class="h2">${n ? 'New' : 'Edit'} banner</h3><label class="lbl">Title</label><input class="input" id="t" value="${esc(b.title || '')}"><label class="lbl">Subtitle</label><input class="input" id="s" value="${esc(b.sub || '')}"><div class="form-grid"><div><label class="lbl">Button text</label><input class="input" id="c" value="${esc(b.cta)}"></div><div><label class="lbl">Colour</label><select class="input" id="o">${['green', 'amber', 'brown', 'blue'].map(x => `<option ${b.tone === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div><label class="lbl">Button link</label><input class="input" id="l" value="${esc(b.link)}" placeholder="#/shop/milk"><label class="lbl">Background image link</label><input class="input" id="i" value="${esc(b.img || '')}"><button class="btn full mt2" id="ok">Save</button>${n ? '' : '<button class="link mt" id="rm" style="color:var(--red)">Delete banner</button>'}`);
    const g = s => sh.el.querySelector(s);
    g('#ok').onclick = async () => { const body = { title: g('#t').value, sub: g('#s').value, cta: g('#c').value, tone: g('#o').value, link: g('#l').value, img: g('#i').value }; try { n ? await post('/api/admin/banners', body) : await put('/api/admin/banners/' + b.id, body); sh.close(); PAGES.offers(); } catch (e) { GF.err(e); } };
    if (!n) g('#rm').onclick = async () => { await del('/api/admin/banners/' + b.id); sh.close(); PAGES.offers(); };
  }

  // ---------- automation + settings ----------
  PAGES.automation = async function () {
    const [S, logs] = await Promise.all([get('/api/admin/settings'), get('/api/admin/logs')]);
    const toggles = [['autoGenerate', 'Create tomorrow\'s orders automatically', 'Every night at the generation time, from active subscriptions'], ['autoDispatch', 'Auto-build routes & assign riders', 'Groups by area, orders stops, balances rider load'], ['autoPack', 'Auto-pack orders in the morning', 'Marks today\'s orders packed at the pack time'], ['autoRelease', 'Auto-release held orders', 'When a customer tops up enough, the order releases itself'], ['autoRestock', 'Auto-restock to par level', 'Refills stock every morning (partner farm supply)'], ['autoRefundFailed', 'Auto-refund failed deliveries', 'Instant wallet refund, no customer action needed'], ['autoRecharge', 'Allow customer auto-recharge', 'Honours each customer\'s auto-recharge setting'], ['autoStartRoutes', 'Auto-start routes at 5:30 AM', 'Marks orders out for delivery without waiting for the rider']];
    main().innerHTML = `<h1 class="h1">Automation &amp; settings</h1><div class="col2 mt"><div class="card"><h3 class="h3">Automations</h3>${toggles.map(([k, t, x]) => `<div class="line"><div class="grow"><b>${t}</b><div class="tiny muted">${x}</div></div>${sw('t_' + k, S[k])}</div>`).join('')}</div>
    <div><div class="card"><h3 class="h3">Timings (IST)</h3><div class="form-grid"><div><label class="lbl">Order cut-off</label><input class="input" type="time" id="s_cutoff" value="${S.cutoff}"></div><div><label class="lbl">Generate orders at</label><input class="input" type="time" id="s_genTime" value="${S.genTime}"></div><div><label class="lbl">Restock at</label><input class="input" type="time" id="s_restockTime" value="${S.restockTime}"></div><div><label class="lbl">Pack at</label><input class="input" type="time" id="s_packTime" value="${S.packTime}"></div></div></div>
      <div class="card"><h3 class="h3">Business rules</h3><div class="form-grid"><div><label class="lbl">Rider pay per delivery ₹</label><input class="input" type="number" id="s_riderPay" value="${S.riderPay}"></div><div><label class="lbl">Auto-refund complaints up to ₹</label><input class="input" type="number" id="s_autoRefundLimit" value="${S.autoRefundLimit}"></div><div><label class="lbl">Free delivery above ₹</label><input class="input" type="number" id="s_freeDeliveryAbove" value="${S.freeDeliveryAbove}"></div><div><label class="lbl">Low-stock alert at</label><input class="input" type="number" id="s_lowStockAlert" value="${S.lowStockAlert}"></div><div><label class="lbl">Welcome bonus ₹</label><input class="input" type="number" id="s_welcomeBonus" value="${S.welcomeBonus}"></div><div><label class="lbl">Referral bonus ₹</label><input class="input" type="number" id="s_referralBonus" value="${S.referralBonus}"></div><div><label class="lbl">Support phone</label><input class="input" id="s_supportPhone" value="${esc(S.supportPhone)}"></div><div><label class="lbl">Delivery window text</label><input class="input" id="s_deliveryWindow" value="${esc(S.deliveryWindow)}"></div></div><button class="btn full mt2" id="sv">Save settings</button></div></div></div>
    <div class="card mt3" style="border:1px solid #f3c4c4"><h3 class="h3">🧹 Clean start (remove demo data)</h3><div class="muted" style="font-size:13px">Deletes all demo customers, riders, orders, wallets, reviews and activity log. Keeps your products, areas, offers, banners and settings, and your own admin login. This cannot be undone. After this, add your own riders from the Riders tab.</div><button class="btn danger mt" id="cs">Remove all demo data</button></div>
    <h3 class="h3 mt3">Activity log</h3><div class="mt">${tbl(['When', 'Action', 'Details'], logs.slice(0, 80).map(l => `<tr><td class="tiny" style="white-space:nowrap">${GF.fdt(l.at)}</td><td><b>${esc(l.action.replace(/_/g, ' '))}</b></td><td class="tiny">${esc(JSON.stringify(l.details || {}).slice(0, 160))}</td></tr>`))}</div>`;
    const m = main();
    toggles.forEach(([k]) => { m.querySelector('#t_' + k).onchange = async e => { try { await put('/api/admin/settings', { [k]: e.target.checked }); GF.toast(e.target.checked ? 'Turned on ✅' : 'Turned off', 'ok'); } catch (er) { GF.err(er); } }; });
    m.querySelector('#cs').onclick = async () => { const t = prompt('This deletes ALL customers, riders and orders.\nType CLEAN to confirm:'); if (t !== 'CLEAN') return; try { const r = await post('/api/admin/clean-start', { confirm: 'CLEAN' }); GF.toast(`Done ✅ ${r.removed.customers} customers, ${r.removed.riders} riders, ${r.removed.orders} orders removed`, 'ok'); PAGES.automation(); } catch (er) { GF.err(er); } };
    m.querySelector('#sv').onclick = e => GF.busy(e.currentTarget, async () => { const body = {}; m.querySelectorAll('[id^=s_]').forEach(i => body[i.id.slice(2)] = i.value); try { await put('/api/admin/settings', body); GF.toast('Settings saved ✅', 'ok'); } catch (er) { GF.err(er); } });
  };

  // ---------- boot ----------
  async function start() {
    GF.registerSW();
    GF.onUnauthorized = () => showLogin();
    if (GF.token()) { try { me = (await get('/api/me')).user; } catch {} }
    if (!me || me.role !== 'admin') return showLogin(me && me.role !== 'admin' ? 'This account is not an admin.' : '');
    GF.connect(); route();
    window.addEventListener('hashchange', route);
    window.addEventListener('gf:admin', e => { const p = page(); if (p === 'orders' && window.__ordersRefresh) live(window.__ordersRefresh); else if (p === 'dashboard') live(PAGES.dashboard); if (['new_order', 'complaint', 'low_stock', 'nightly', 'failed'].includes(e.detail.kind)) GF.toast(`<b>${esc(e.detail.title)}</b><br><span style="font-weight:500;font-size:13px">${esc(e.detail.body || '')}</span>`); });
    window.addEventListener('gf:demo', () => live(PAGES[page()] || PAGES.dashboard));
  }
  function showLogin(msg) {
    me = null; $app.innerHTML = '<div class="login-wrap"><div id="lg"></div></div>';
    GF.loginView(document.getElementById('lg'), { role: 'admin', title: 'GharFresh Admin', sub: msg || 'Sign in with your admin email.', onDone: u => { if (u.role !== 'admin') { GF.setToken(''); return showLogin('This account is not an admin.'); } start(); } });
  }
  window.addEventListener('load', start);
})();
