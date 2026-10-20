'use strict';
// GharFresh customer app: plans, orders + live tracking, wallet, profile, notifications.
(function () {
  const { esc, inr, get, post, put, patch, del } = GF;
  const S = GF.S, R = GF.R;
  const needAuth = () => { if (!S.me) { GF.go('#/login?next=' + encodeURIComponent(location.hash.slice(1))); return true; } return false; };

  // ---------- UPI payment sheet (demo gateway; swap /api/wallet/topup for Razorpay/Cashfree verification) ----------
  GF.payUPI = amount => new Promise((resolve, reject) => {
    let done = false, app = 'gpay';
    const apps = [['gpay', 'GPay', '🟦'], ['phonepe', 'PhonePe', '🟪'], ['paytm', 'Paytm', '🟦'], ['bhim', 'BHIM', '🟧'], ['upi', 'UPI ID', '🔗'], ['card', 'Card', '💳']];
    const bonus = amount >= 2000 ? Math.round(amount * .06) : amount >= 1000 ? Math.round(amount * .05) : amount >= 500 ? Math.round(amount * .02) : 0;
    const sh = GF.sheet('', { onClose: () => { if (!done) reject(new Error('cancelled')); } });
    const draw = () => {
      sh.el.innerHTML = `<h3 class="h2">Add ${inr(amount)} to wallet</h3>${bonus ? `<p class="save mt">🎁 You get ${inr(bonus)} cashback</p>` : ''}
        <div class="upi">${apps.map(([k, n, e]) => `<button class="${app === k ? 'on' : ''}" data-a="${k}"><b>${e}</b>${n}</button>`).join('')}</div>
        <button class="btn full mt2" id="pp">Pay ${inr(amount)}</button><p class="tiny muted center mt">🔒 Demo payment: no real money is charged. The gateway slot is ready for Razorpay/Cashfree.</p>`;
      sh.el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { app = b.dataset.a; draw(); });
      sh.el.querySelector('#pp').onclick = e => GF.busy(e.currentTarget, async () => {
        try {
          await new Promise(r => setTimeout(r, 1200));
          const r = await post('/api/wallet/topup', { amount, method: app }); done = true;
          sh.el.innerHTML = `<div class="success"><div class="tick">✓</div><h3 class="h2">${inr(amount)} added</h3><p class="muted mt">${r.bonus ? `+ ${inr(r.bonus)} cashback · ` : ''}New balance <b>${inr(r.wallet.balance)}</b>${r.released ? `<br>🔓 ${r.released} held order(s) released` : ''}</p></div>`;
          await GF.reloadMe(); setTimeout(() => { sh.close(); resolve(r); }, 1100);
        } catch (er) { GF.err(er); }
      });
    };
    draw();
  });

  // ---------- plans ----------
  function plannedDays(s, n = 7) {
    // which of the next n days this plan delivers (client mirror of the server rules)
    const out = {}; if (s.status !== 'active' || !s.next) return out;
    let d = s.next; const today = GF.istNow().toISOString().slice(0, 10), end = GF.addDays(today, n);
    for (let i = 0; i < 60 && d && d <= end; i++) {
      out[d] = !(s.pauseDates || []).includes(d) ? 'ok' : 'skip';
      if (s.freq === 'daily') d = GF.addDays(d, 1); else if (s.freq === 'alternate_days') d = GF.addDays(d, 2);
      else { let k = 0; do { d = GF.addDays(d, 1); k++; } while (k < 14 && !(s.freq === 'weekdays' ? [1, 2, 3, 4, 5] : s.freq === 'weekends' ? [0, 6] : ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((x, i) => (s.customDays || []).includes(x) ? i : -1)).includes(GF.dow(d))); if (s.freq === 'one_time') break; }
    }
    return out;
  }
  R.plans = {
    async show() {
      if (needAuth()) return;
      GF.view('<div class="skel" style="height:200px"></div>');
      const subs = await get('/api/subscriptions');
      const today = GF.istNow().toISOString().slice(0, 10);
      const days = Array.from({ length: 7 }, (_, i) => GF.addDays(today, i + 1));
      const plans = subs.map(s => ({ s, m: plannedDays(s, 8) }));
      const monthly = subs.filter(s => s.status === 'active').reduce((a, s) => a + s.product.price * s.qty * ({ daily: 30, alternate_days: 15, weekdays: 22, weekends: 9, custom: (s.customDays || []).length * 4.3 }[s.freq] || 0), 0);
      let html = `<div class="row nofl between"><h1 class="h1">My plans</h1><a class="btn sm" href="#/">+ Add plan</a></div>`;
      if (!subs.length) html += `<div class="empty"><div class="big">🔁</div><h3>No active plans</h3><p>Subscribe to milk, curd or eggs and wake up to fresh deliveries every morning.</p><a class="btn mt2" style="display:inline-flex" href="#/">Choose products</a></div>`;
      else {
        html += `<div class="card mt"><div class="row nofl between"><div><div class="muted tiny bold">NEXT 7 DAYS</div><div class="muted tiny">Estimated monthly spend <b style="color:var(--ink)">${inr(Math.round(monthly))}</b></div></div></div>
          <div class="cal mt">${days.map(d => { const n = plans.filter(p => p.m[d] === 'ok').length, sk = plans.filter(p => p.m[d] === 'skip').length; return `<div class="${n ? 'dv' : sk ? 'sk' : ''}">${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][GF.dow(d)]}<b>${+d.slice(8)}</b>${n ? `<i>${n}×</i>` : sk ? '<i style="color:#999">skip</i>' : '<i>–</i>'}</div>`; }).join('')}</div></div>`;
        html += plans.map(({ s }) => `<div class="card mt"><div class="line" style="border:0;padding:0">${GF.img(s.product.images, 'th', s.product.name, false)}<div class="grow"><b>${esc(s.product.name)}</b><div class="muted tiny">${esc(s.product.pack)} · ${inr(s.product.price)} each</div>
            <div class="row nofl gap wrap mt"><span class="chip ${s.status === 'active' ? 'green' : 'amber'}">${s.status === 'active' ? '● Active' : '⏸ Paused'}</span><span class="chip">${GF.FREQ[s.freq]}</span></div></div></div>
          <div class="row mt2" style="align-items:center"><div><div class="muted tiny">Quantity</div><div class="mini"><button data-q="${s.id}" data-d="-1" aria-label="Less">−</button><span>${s.qty}</span><button data-q="${s.id}" data-d="1" aria-label="More">+</button></div></div>
            <div style="text-align:right"><div class="muted tiny">${s.status === 'active' ? 'Next delivery' : 'Paused'}</div><b>${s.next ? GF.fdate(s.next) : '—'}</b>${(s.pauseDates || []).length ? `<div class="tiny muted">${s.pauseDates.length} day(s) skipped</div>` : ''}</div></div>
          <div class="row mt2 wrap">${s.status === 'active' ? `<button class="btn ghost sm" data-pa="pause" data-id="${s.id}">⏸ Pause</button><button class="btn ghost sm" data-skip="${s.id}" data-date="${s.next}">Skip ${s.next ? GF.fdateShort(s.next) : ''}</button>` : `<button class="btn sm" data-pa="resume" data-id="${s.id}">▶ Resume</button>`}<button class="btn ghost sm" style="color:var(--red);border-color:#f3c7c7" data-pa="cancel" data-id="${s.id}">Cancel</button></div></div>`).join('');
        html += `<p class="tiny muted center mt2">Changes apply from the next delivery after the ${S.boot.settings.cutoff} cut-off. Wallet is charged each night for the next morning.</p>`;
      }
      GF.view(html);
      const v = GF.$view();
      v.querySelectorAll('[data-q]').forEach(b => b.onclick = async () => { const s = subs.find(x => x.id === b.dataset.q); try { await patch('/api/subscriptions/' + s.id, { action: 'qty', qty: s.qty + +b.dataset.d }); R.plans.show(); } catch (e) { GF.err(e); } });
      v.querySelectorAll('[data-pa]').forEach(b => b.onclick = async () => {
        const a = b.dataset.pa; if (a === 'cancel' && !await GF.confirm('Cancel this plan?', 'Deliveries will stop. You can always start a new plan.', 'Yes, cancel', true)) return;
        try { await patch('/api/subscriptions/' + b.dataset.id, { action: a }); GF.toast(a === 'pause' ? 'Plan paused ⏸' : a === 'resume' ? 'Plan resumed ▶' : 'Plan cancelled', 'ok'); R.plans.show(); } catch (e) { GF.err(e); }
      });
      v.querySelectorAll('[data-skip]').forEach(b => b.onclick = async () => { try { await patch('/api/subscriptions/' + b.dataset.skip, { action: 'skip', date: b.dataset.date }); GF.toast('Skipped ' + GF.fdate(b.dataset.date), 'ok'); R.plans.show(); } catch (e) { GF.err(e); } });
    }
  };

  // ---------- orders ----------
  const STEPS = [['pending', 'Order confirmed', '✅'], ['packed', 'Packed fresh', '📦'], ['out_for_delivery', 'Out for delivery', '🛵'], ['delivered', 'Delivered', '🏠']];
  R.orders = {
    tab: 'upcoming', cache: null,
    async show({ parts }) {
      if (needAuth()) return;
      if (parts[1]) return this.detail(parts[1]);
      this.id = null; await this.refresh();
    },
    async refresh() {
      if (this.id) return this.detail(this.id, true);
      const os = await get('/api/orders'); this.cache = os;
      const up = os.filter(o => ['pending', 'packed', 'out_for_delivery', 'on_hold'].includes(o.status)).sort((a, b) => a.date.localeCompare(b.date));
      const past = os.filter(o => !up.includes(o));
      const list = this.tab === 'upcoming' ? up : past;
      GF.view(`<h1 class="h1">My orders</h1><div class="seg mt"><button data-t="upcoming" class="${this.tab === 'upcoming' ? 'on' : ''}">Upcoming (${up.length})</button><button data-t="past" class="${this.tab === 'past' ? 'on' : ''}">Past (${past.length})</button></div>
        ${list.length ? list.map(o => `<a href="#/orders/${o.id}" class="card mt" style="display:block"><div class="row nofl between"><b>#${o.no}</b>${GF.chip(o.status)}</div><div class="row nofl gap mt" style="overflow:hidden">${o.items.slice(0, 4).map(i => GF.img([i.image], 'th', i.name, false).replace('class="th"', 'class="th" style="width:44px;height:44px;border-radius:10px;object-fit:cover"')).join('')}${o.items.length > 4 ? `<span class="muted tiny">+${o.items.length - 4}</span>` : ''}</div>
          <div class="row nofl between mt"><span class="muted tiny">${GF.fdate(o.date)} · ${o.items.reduce((a, i) => a + i.qty, 0)} items</span><b>${inr(o.total)}</b></div>${o.status === 'on_hold' ? '<p class="tiny mt" style="color:var(--red);font-weight:700">⚠ Wallet is low. Recharge to release this delivery.</p>' : ''}${o.status === 'out_for_delivery' ? `<p class="tiny mt" style="color:#8a5a00;font-weight:800">🛵 On the way${o.stopsAway != null ? ` · ${o.stopsAway} stop(s) before you` : ''}</p>` : ''}</a>`).join('') : `<div class="empty"><div class="big">🧾</div><h3>No ${this.tab} orders</h3><a class="btn mt2" style="display:inline-flex" href="#/">Start shopping</a></div>`}`);
      GF.$view().querySelectorAll('[data-t]').forEach(b => b.onclick = () => { this.tab = b.dataset.t; this.refresh(); });
    },
    async detail(id, silent) {
      this.id = id;
      if (!silent) GF.view('<div class="skel" style="height:300px"></div>');
      const o = await get('/api/orders/' + id);
      const tl = o.timeline, has = s => tl.find(t => t.status === s);
      let html = `<a href="#/orders" class="muted tiny bold" onclick="GF.R.orders.id=null">← All orders</a><div class="row nofl between mt"><h1 class="h1">Order #${o.no}</h1>${GF.chip(o.status)}</div><p class="muted tiny">${GF.fdate(o.date)} · ${esc((S.boot.settings.slots.find(s => s.id === o.slot) || {}).label || '')}</p>`;
      html += `<div class="col2 mt"><div>`;
      if (o.status === 'out_for_delivery' && o.rider) html += `<div class="rider-card"><div class="avatar">${esc(o.rider.name[0])}</div><div class="grow"><b>${esc(o.rider.name)} is on the way</b><div class="tiny muted">${o.stopsAway ? `${o.stopsAway} stop${o.stopsAway > 1 ? 's' : ''} before yours` : 'You are next! 🎉'}</div></div>${o.rider.phone ? `<a class="btn sm" style="flex:none" href="tel:${esc(o.rider.phone)}">📞 Call</a>` : ''}</div>`;
      if (o.status === 'on_hold') html += `<div class="card" style="background:#fdecec;border-color:#f3c7c7"><b>⚠ Delivery on hold</b><p class="tiny mt">Wallet balance is lower than ${inr(o.total)}. Add money and this releases automatically — you haven't been charged.</p><button class="btn sm mt" id="topup">Add money</button></div>`;
      if (o.status === 'failed') html += `<div class="card" style="background:#fff5f5;border-color:#f3c7c7"><b>We couldn't deliver this order</b><p class="tiny mt">${esc(GF.STATUS.failed[0])}: ${esc((o.timeline.slice(-1)[0] || {}).note || '')}</p>${o.payStatus === 'refunded' ? `<p class="save mt">✔ ${inr(o.total)} refunded to your wallet</p>` : `<button class="btn sm mt" id="rf">Refund ${inr(o.total)} to wallet</button>`}</div>`;
      html += `<div class="card"><h3 class="h3">Order status</h3><div class="tl mt">`;
      if (['cancelled'].includes(o.status)) html += tl.map(t => `<div class="st done"><b>${esc(GF.STATUS[t.status] ? GF.STATUS[t.status][0] : t.status)}</b><span>${GF.fdt(t.at)} · ${esc(t.note)}</span></div>`).join('');
      else { const idx = STEPS.findIndex(s => s[0] === (o.status === 'failed' || o.status === 'on_hold' ? 'pending' : o.status));
        html += STEPS.map(([k, l, e], i) => { const t = has(k); const st = i < idx || (t && i <= idx && k !== o.status) ? 'done' : i === idx && o.status !== 'delivered' ? 'now' : o.status === 'delivered' ? 'done' : 'todo'; return `<div class="st ${st}"><b>${e} ${l}</b><span>${t ? GF.fdt(t.at) : k === 'delivered' ? 'Expected by 7:30 AM' : ''}</span></div>`; }).join(''); }
      html += `</div></div>`;
      if (o.proof && o.status === 'delivered') html += `<div class="card"><h3 class="h3">📸 Delivery proof</h3><div class="proof mt"><img src="${esc(o.proof.photo)}" alt="Photo of delivered order" onerror="this.style.display='none'"></div><p class="tiny muted mt">Delivered ${GF.fdt(o.proof.at)}${o.proof.lat ? ` · GPS verified (${(+o.proof.lat).toFixed(4)}, ${(+o.proof.lng).toFixed(4)})` : ''}</p></div>`;
      html += `</div><div><div class="card"><h3 class="h3">Items</h3>${o.items.map(i => `<div class="line">${GF.img([i.image], 'th', i.name, false)}<div class="grow"><b>${esc(i.name)}</b><div class="muted tiny">${esc(i.pack)} × ${i.qty}</div></div><b>${inr(i.price * i.qty)}</b></div>`).join('')}
        <div class="bill mt"><div><span>Subtotal</span><span>${inr(o.subtotal)}</span></div><div><span>Delivery</span><span>${o.fee ? inr(o.fee) : 'FREE'}</span></div>${o.discount ? `<div class="save"><span>Discount ${o.coupon ? '(' + esc(o.coupon) + ')' : ''}</span><span>−${inr(o.discount)}</span></div>` : ''}<div class="tot"><span>Total</span><span>${inr(o.total)}</span></div></div>
        <p class="tiny muted mt">${o.payStatus === 'paid' ? '✔ Paid from wallet' : o.payStatus === 'refunded' ? '↩ Refunded to wallet' : 'Payment pending'}${o.source === 'subscription' ? ' · from your subscription' : ''}</p></div>
        ${o.address ? `<div class="card"><h3 class="h3">📍 Delivery address</h3><p class="mt">${esc(o.address.house)}, ${esc(o.address.line1)}${o.address.landmark ? '<br><span class="muted">' + esc(o.address.landmark) + '</span>' : ''}</p></div>` : ''}
        <div class="card"><div class="row wrap">${o.canCancel ? '<button class="btn ghost sm" id="cx" style="color:var(--red);border-color:#f3c7c7">Cancel order</button>' : ''}<button class="btn ghost sm" id="ro">🔁 Reorder</button>${['delivered', 'failed'].includes(o.status) ? '<button class="btn ghost sm" id="cm">Report a problem</button>' : ''}</div>
        ${o.status === 'delivered' && !o.rating ? `<div class="mt2"><b>How was your delivery?</b><div class="stars-in" id="stars">${[1, 2, 3, 4, 5].map(n => `<button data-s="${n}" aria-label="${n} stars">★</button>`).join('')}</div><textarea class="input" id="rt" placeholder="Tell us more (optional)"></textarea><button class="btn full mt" id="rs" disabled>Submit rating</button></div>` : ''}
        ${o.rating ? `<p class="mt2">Your rating: ${GF.stars(o.rating.stars)}${o.rating.text ? `<br><span class="muted">“${esc(o.rating.text)}”</span>` : ''}</p>` : ''}</div></div></div>`;
      GF.view(html);
      const v = GF.$view(), q = s => v.querySelector(s);
      if (q('#cx')) q('#cx').onclick = async () => { if (await GF.confirm('Cancel this order?', `${inr(o.total)} will be refunded to your wallet instantly.`, 'Cancel order', true)) try { await post(`/api/orders/${o.id}/cancel`); GF.toast('Order cancelled. Refunded to wallet.', 'ok'); await GF.reloadMe(); R.orders.detail(o.id); } catch (e) { GF.err(e); } };
      if (q('#rf')) q('#rf').onclick = e => GF.busy(e.currentTarget, async () => { try { await post(`/api/orders/${o.id}/refund`); GF.toast('Refunded to wallet ✅', 'ok'); await GF.reloadMe(); R.orders.detail(o.id); } catch (er) { GF.err(er); } });
      if (q('#topup')) q('#topup').onclick = () => GF.go('#/wallet');
      q('#ro').onclick = async () => { const r = await post(`/api/orders/${o.id}/reorder`); const c = {}; r.items.forEach(i => c[i.productId] = i.qty); GF.cart.set(c); GF.toast('Items added to basket', 'ok'); GF.go('#/basket'); };
      if (q('#cm')) q('#cm').onclick = () => {
        const sh = GF.sheet(`<h3 class="h2">Report a problem</h3><p class="muted tiny mt">Small issues are refunded to your wallet instantly.</p><label class="lbl">What went wrong?</label><div class="pills" id="ty">${[['quality', 'Quality issue'], ['not_received', 'Not received'], ['wrong_item', 'Wrong item'], ['billing', 'Billing'], ['other', 'Other']].map(([k, l], i) => `<button class="pill ${i ? '' : 'on'}" data-k="${k}">${l}</button>`).join('')}</div><label class="lbl">Details</label><textarea class="input" id="ds" placeholder="Tell us what happened"></textarea><button class="btn full mt2" id="sb">Submit</button>`);
        let ty = 'quality'; sh.el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { ty = b.dataset.k; sh.el.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('on', x === b)); });
        sh.el.querySelector('#sb').onclick = e => GF.busy(e.currentTarget, async () => { try { const c = await post(`/api/orders/${o.id}/complain`, { type: ty, description: sh.el.querySelector('#ds').value }); sh.close(); GF.toast(c.status === 'resolved' ? `✅ Resolved: ${inr(c.refund)} refunded to wallet` : 'Complaint received. We will update you shortly.', 'ok'); await GF.reloadMe(); } catch (er) { GF.err(er); } });
      };
      if (q('#stars')) { let sc = 0; q('#stars').onclick = e => { const n = +e.target.dataset.s; if (!n) return; sc = n; q('#stars').querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i < n)); q('#rs').disabled = false; };
        q('#rs').onclick = e => GF.busy(e.currentTarget, async () => { try { await post(`/api/orders/${o.id}/rate`, { stars: sc, text: q('#rt').value }); GF.toast('Thanks for rating! ⭐', 'ok'); R.orders.detail(o.id); } catch (er) { GF.err(er); } }); }
    }
  };

  // ---------- wallet ----------
  const TXI = { credit: ['➕', 'pos'], cashback: ['🎁', 'pos'], refund: ['↩️', 'pos'], adjustment: ['⚙️', 'pos'], debit: ['🛒', ''] };
  R.wallet = {
    async show() {
      if (needAuth()) return;
      const { wallet: w, txs, offers } = await get('/api/wallet');
      GF.view(`<div class="walletcard"><small>Wallet balance</small><b>${inr(w.balance)}</b><small>Auto-pays your daily deliveries · refunds land here instantly</small></div>
      <div class="card mt2"><h3 class="h3">Add money</h3><div class="pills mt">${[200, 500, 1000, 2000].map(a => `<button class="pill" data-a="${a}">₹${a}${a >= 500 ? ` <span class="save">+${a >= 2000 ? 6 : a >= 1000 ? 5 : 2}%</span>` : ''}</button>`).join('')}</div>
        <div class="row mt"><input class="input" id="amt" type="number" min="50" max="10000" step="50" placeholder="Enter amount" inputmode="numeric"><button class="btn nofl" id="go" style="flex:none">Add money</button></div>
        <p class="tiny muted mt">Cashback: ₹500+ → 2%, ₹1000+ → 5%, ₹2000+ → 6%</p></div>
      <div class="card"><div class="row"><div><b>⚡ Auto-recharge</b><p class="tiny muted">Never miss a delivery. We top up when your balance runs low.</p></div><label class="switch nofl" style="flex:none"><input type="checkbox" id="ar" ${w.autoRecharge.on ? 'checked' : ''}><i></i></label></div>
        <div id="arf" ${w.autoRecharge.on ? '' : 'hidden'}><div class="form-grid"><div><label class="lbl">When balance below</label><input class="input" id="art" type="number" value="${w.autoRecharge.threshold}"></div><div><label class="lbl">Add</label><input class="input" id="ara" type="number" value="${w.autoRecharge.amount}"></div></div><button class="btn sm mt" id="ars">Save</button></div></div>
      <div class="card"><h3 class="h3">Transactions</h3>${txs.length ? txs.map(t => { const [ic, cls] = TXI[t.type] || ['•', '']; return `<div class="tx"><div class="ti">${ic}</div><div><b>${esc(t.desc || t.type)}</b><div class="tiny muted">${GF.fdt(t.at)}</div></div><div class="amt ${cls}">${cls ? '+' : '−'}${inr(t.amount)}<small>Bal ${inr(t.balanceAfter)}</small></div></div>`; }).join('') : '<p class="muted mt">No transactions yet.</p>'}</div>`);
      const v = GF.$view();
      v.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { v.querySelector('#amt').value = b.dataset.a; v.querySelectorAll('[data-a]').forEach(x => x.classList.toggle('on', x === b)); });
      v.querySelector('#go').onclick = async () => { const a = Math.floor(+v.querySelector('#amt').value); if (!(a >= 50 && a <= 10000)) return GF.toast('Enter an amount between ₹50 and ₹10,000', 'err'); try { await GF.payUPI(a); R.wallet.show(); } catch (e) { if (e.message !== 'cancelled') GF.err(e); } };
      v.querySelector('#ar').onchange = async e => { v.querySelector('#arf').hidden = !e.target.checked; try { await put('/api/wallet/auto', { on: e.target.checked, threshold: v.querySelector('#art').value, amount: v.querySelector('#ara').value }); GF.toast(e.target.checked ? 'Auto-recharge on ✅' : 'Auto-recharge off', 'ok'); } catch (er) { GF.err(er); } };
      v.querySelector('#ars').onclick = async () => { try { await put('/api/wallet/auto', { on: true, threshold: v.querySelector('#art').value, amount: v.querySelector('#ara').value }); GF.toast('Saved ✅', 'ok'); } catch (er) { GF.err(er); } };
    }
  };

  // ---------- profile + addresses ----------
  function addressSheet(a, next) {
    a = a || {}; const zones = S.boot.zones;
    const sh = GF.sheet(`<h3 class="h2">${a.id ? 'Edit' : 'Add'} address</h3>
      <label class="lbl">Save as</label><div class="pills" id="lb">${['Home', 'Office', 'Other'].map(l => `<button class="pill ${(a.label || 'Home') === l ? 'on' : ''}" data-l="${l}">${l}</button>`).join('')}</div>
      <label class="lbl">Delivery area</label><select class="input" id="az">${zones.map(z => `<option value="${z.id}" ${z.id === a.zoneId ? 'selected' : ''}>${esc(z.name)} (${z.pincode})${z.fee ? ' · ₹' + z.fee + ' delivery' : ' · free delivery'}</option>`).join('')}</select>
      <div class="form-grid"><div><label class="lbl">House / flat no.</label><input class="input" id="ah" value="${esc(a.house || '')}" placeholder="B-204"></div><div><label class="lbl">Landmark (optional)</label><input class="input" id="al" value="${esc(a.landmark || '')}" placeholder="Near park"></div></div>
      <label class="lbl">Society / street</label><input class="input" id="as" value="${esc(a.line1 || '')}" placeholder="Green Valley Society, Vaishali Nagar">
      <label class="lbl">Delivery instructions (optional)</label><input class="input" id="ai" value="${esc(a.instructions || '')}" placeholder="Leave at door, don't ring bell">
      <button class="btn ghost full mt" id="gps">📍 Use my current location</button><p class="tiny muted" id="gpst">${a.lat ? `Location saved (${(+a.lat).toFixed(4)}, ${(+a.lng).toFixed(4)})` : 'Optional: helps our rider find you faster'}</p>
      <button class="btn full mt2" id="sv">Save address</button>${a.id ? '<button class="link mt" id="rm" style="color:var(--red)">Delete this address</button>' : ''}`);
    let label = a.label || 'Home', lat = a.lat, lng = a.lng; const q = s => sh.el.querySelector(s);
    sh.el.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { label = b.dataset.l; sh.el.querySelectorAll('[data-l]').forEach(x => x.classList.toggle('on', x === b)); });
    q('#gps').onclick = () => { if (!navigator.geolocation) return GF.toast('Location not supported', 'err'); q('#gpst').textContent = 'Finding you…'; navigator.geolocation.getCurrentPosition(p => { lat = p.coords.latitude; lng = p.coords.longitude; q('#gpst').textContent = `✔ Location captured (${lat.toFixed(4)}, ${lng.toFixed(4)})`; }, () => { q('#gpst').textContent = 'Could not get location. You can still save.'; }, { enableHighAccuracy: true, timeout: 10000 }); };
    q('#sv').onclick = e => GF.busy(e.currentTarget, async () => {
      try { const body = { label, zoneId: q('#az').value, house: q('#ah').value, landmark: q('#al').value, line1: q('#as').value, instructions: q('#ai').value, lat, lng }; a.id ? await put('/api/addresses/' + a.id, body) : await post('/api/addresses', body); sh.close(); await GF.reloadMe(); GF.toast('Address saved ✅', 'ok'); if (next) GF.go('#' + next); else R.profile.show(); } catch (er) { GF.err(er); }
    });
    if (q('#rm')) q('#rm').onclick = async () => { try { await del('/api/addresses/' + a.id); sh.close(); await GF.reloadMe(); R.profile.show(); } catch (er) { GF.err(er); } };
  }
  R.profile = {
    async show({ query } = {}) {
      if (needAuth()) return;
      await GF.reloadMe(); const u = S.me;
      const link = `${location.origin}/?ref=${u.referralCode}`;
      GF.view(`<div class="card row nofl gap"><div class="avatar">${esc((u.name || u.email)[0].toUpperCase())}</div><div class="grow"><b style="font-size:17px">${esc(u.name || 'Add your name')}</b><div class="muted tiny">${esc(u.email)}</div></div><span class="chip green">${inr(u.wallet.balance)}</span></div>
      <div class="card mt"><h3 class="h3">Your details</h3><div class="form-grid"><div><label class="lbl">Name</label><input class="input" id="pn" value="${esc(u.name || '')}"></div><div><label class="lbl">Mobile (for rider calls)</label><input class="input" id="pp" value="${esc(u.phone || '')}" inputmode="numeric" maxlength="10" placeholder="10-digit number"></div></div><button class="btn sm mt" id="ps">Save</button></div>
      <div class="card"><div class="row nofl between"><h3 class="h3">📍 Addresses</h3><button class="btn sm" id="aa" style="flex:none">+ Add</button></div>
        ${S.addrs.length ? S.addrs.map(a => `<div class="line"><div style="font-size:22px">${a.label === 'Office' ? '🏢' : '🏠'}</div><div class="grow"><b>${esc(a.label)}</b> ${a.isDefault ? '<span class="chip green">Default</span>' : ''}<div class="muted tiny">${esc(a.house)}, ${esc(a.line1)}</div></div><button class="btn ghost xs" data-ea="${a.id}">Edit</button>${a.isDefault ? '' : `<button class="btn ghost xs" data-da="${a.id}">Make default</button>`}</div>`).join('') : '<p class="muted mt">No address yet. Add one to start ordering.</p>'}</div>
      <div class="card" style="background:linear-gradient(135deg,#fff7e0,#fff);border-color:#f3e1a8"><h3 class="h3">🎁 Refer &amp; earn ₹${S.boot.settings.referralBonus}</h3><p class="muted tiny mt">Share your code. You both get ₹${S.boot.settings.referralBonus} after their first delivery.</p><div class="row mt"><div class="input" style="display:grid;place-items:center;font-weight:900;letter-spacing:.15em;font-size:18px">${esc(u.referralCode)}</div><button class="btn amber nofl" id="sh" style="flex:none">Share</button></div></div>
      <div class="card"><a class="line" href="#/notifications"><span style="font-size:20px">🔔</span><b class="grow">Notifications</b>${S.unread ? `<span class="chip amber">${S.unread} new</span>` : ''}</a><a class="line" href="#/wallet"><span style="font-size:20px">👛</span><b class="grow">Wallet &amp; auto-recharge</b>›</a><a class="line" href="tel:${esc(S.boot.settings.supportPhone)}"><span style="font-size:20px">📞</span><b class="grow">Call support</b><span class="muted tiny">${esc(S.boot.settings.supportPhone)}</span></a>
        ${u.role === 'admin' ? '<a class="line" href="/admin"><span style="font-size:20px">🧑‍💼</span><b class="grow">Open admin panel</b>›</a>' : ''}</div>
      <button class="btn ghost full mt2" id="lo">Log out</button>`);
      const v = GF.$view();
      v.querySelector('#ps').onclick = async () => { try { await put('/api/me', { name: v.querySelector('#pn').value, phone: v.querySelector('#pp').value }); await GF.reloadMe(); GF.toast('Saved ✅', 'ok'); } catch (e) { GF.err(e); } };
      v.querySelector('#aa').onclick = () => addressSheet(null, null);
      v.querySelectorAll('[data-ea]').forEach(b => b.onclick = () => addressSheet(S.addrs.find(a => a.id === b.dataset.ea)));
      v.querySelectorAll('[data-da]').forEach(b => b.onclick = async () => { const a = S.addrs.find(x => x.id === b.dataset.da); try { await put('/api/addresses/' + a.id, { ...a, isDefault: true }); await GF.reloadMe(); R.profile.show({ query: {} }); } catch (e) { GF.err(e); } });
      v.querySelector('#sh').onclick = async () => { const text = `Get fresh milk & dairy delivered before 7:30 AM with GharFresh! Use my code ${u.referralCode} for a welcome bonus: ${link}`; if (navigator.share) { try { await navigator.share({ title: 'GharFresh', text, url: link }); } catch {} } else { try { await navigator.clipboard.writeText(text); GF.toast('Invite copied! Paste it in WhatsApp', 'ok'); } catch { GF.toast(text); } } };
      v.querySelector('#lo').onclick = async () => { try { await post('/api/auth/logout'); } catch {} GF.setToken(''); GF.disconnect(); S.me = null; S.addrs = []; location.hash = '#/'; location.reload(); };
      if (query && query.add) addressSheet(null, query.next);
    }
  };

  // ---------- notifications ----------
  R.notifications = {
    async show() {
      if (needAuth()) return;
      const list = await get('/api/notifications');
      const ic = { order: '📦', refund: '↩️', wallet: '👛', wallet_low: '⚠️', order_on_hold: '⏸️', subscription: '🔁', complaint: '🛟', route: '🛵', welcome: '🎉' };
      GF.view(`<div class="row nofl between"><h1 class="h1">Notifications</h1></div><div class="card mt bell-list">${list.length ? list.map(n => `<div class="n ${n.read ? '' : 'unread'}"><div class="ni">${ic[n.kind] || '🔔'}</div><div><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${GF.ago(n.at)}</small></div></div>`).join('') : '<div class="empty"><div class="big">🔔</div><h3>All caught up</h3></div>'}</div>`);
      if (S.unread) { await post('/api/notifications/read'); S.unread = 0; GF.chrome(); }
    }
  };
})();
