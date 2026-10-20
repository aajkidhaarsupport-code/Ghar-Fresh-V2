'use strict';
// Shared helpers for the shop, rider and admin apps.
(function () {
  const TOKEN_KEY = 'gf_token';
  const GF = (window.GF = {});

  GF.token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  GF.setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

  GF.api = async function (method, url, body) {
    let res;
    try {
      res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(GF.token() ? { Authorization: 'Bearer ' + GF.token() } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { const err = new Error('You seem to be offline. Please check your internet.'); err.offline = true; throw err; }
    let data = null; try { data = await res.json(); } catch {}
    if (!res.ok) {
      if (res.status === 401) { GF.setToken(''); GF.onUnauthorized && GF.onUnauthorized(); }
      const err = new Error((data && data.error) || 'Something went wrong'); err.status = res.status; err.data = data; throw err;
    }
    return data;
  };
  GF.get = u => GF.api('GET', u);
  GF.post = (u, b) => GF.api('POST', u, b || {});
  GF.put = (u, b) => GF.api('PUT', u, b || {});
  GF.patch = (u, b) => GF.api('PATCH', u, b || {});
  GF.del = u => GF.api('DELETE', u);

  // ---------- formatting ----------
  GF.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  GF.inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  GF.fdate = s => { if (!s) return ''; const [y, m, d] = s.slice(0, 10).split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); return `${DOW[dt.getUTCDay()]}, ${d} ${MON[m - 1]}`; };
  GF.fdateShort = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return `${d} ${MON[m - 1]}`; };
  GF.ftime = iso => iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }) : '';
  GF.fdt = iso => iso ? `${new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}, ${GF.ftime(iso)}` : '';
  GF.ago = iso => { const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return Math.floor(s / 86400) + ' d ago'; };
  GF.addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  GF.dow = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  GF.stars = (r, n) => `<span class="stars" aria-label="${r} out of 5"><b>★</b> ${Number(r).toFixed(1)}${n ? ` <i>(${n})</i>` : ''}</span>`;
  GF.STATUS = { pending: ['Confirmed', 'blue'], packed: ['Packed', 'indigo'], out_for_delivery: ['Out for delivery', 'amber'], delivered: ['Delivered', 'green'], failed: ['Not delivered', 'red'], cancelled: ['Cancelled', 'gray'], on_hold: ['On hold', 'red'] };
  GF.chip = s => { const [t, c] = GF.STATUS[s] || [s, 'gray']; return `<span class="chip ${c}">${t}</span>`; };
  GF.FREQ = { daily: 'Every day', alternate_days: 'Alternate days', weekdays: 'Weekdays (Mon–Fri)', weekends: 'Weekends', custom: 'Custom days', one_time: 'One time' };

  // broken photo -> next fallback image
  window.gfImgErr = function (img) {
    const fb = (img.dataset.fb || '').split('|').filter(Boolean);
    if (fb.length) { img.dataset.fb = fb.slice(1).join('|'); img.src = fb[0]; } else { img.onerror = null; img.src = '/products/cow-milk-1l.svg'; }
  };
  GF.img = (images, cls, alt, lazy = true) => {
    const list = (images || []).filter(Boolean);
    const svg = list.find(u => u.startsWith('/products/'));
    const first = list[0] || svg || '/products/cow-milk-1l.svg';
    const rest = list.slice(1).filter(u => u !== first);
    return `<img class="${cls || ''}" src="${GF.esc(first)}" alt="${GF.esc(alt || '')}" ${lazy ? 'loading="lazy"' : ''} data-fb="${GF.esc((svg && svg !== first ? [svg] : []).concat(rest.filter(u => u !== svg)).join('|'))}" onerror="gfImgErr(this)">`;
  };

  // ---------- toasts, modal, confirm ----------
  let toastBox;
  GF.toast = (msg, kind = '') => {
    if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'toasts'; toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite'); document.body.appendChild(toastBox); }
    const t = document.createElement('div'); t.className = 'toast ' + kind; t.innerHTML = msg; toastBox.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'err' ? 5000 : 3200);
  };
  GF.err = e => GF.toast(GF.esc(e.message || e), 'err');

  GF.sheet = (html, { wide = false, onClose } = {}) => {
    const wrap = document.createElement('div'); wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="sheet-bg"></div><div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="sheet-x" aria-label="Close">✕</button><div class="sheet-body">${html}</div></div>`;
    document.body.appendChild(wrap); document.body.classList.add('noscroll');
    const close = () => { wrap.classList.add('out'); document.body.classList.remove('noscroll'); setTimeout(() => wrap.remove(), 200); onClose && onClose(); };
    wrap.querySelector('.sheet-bg').onclick = close; wrap.querySelector('.sheet-x').onclick = close;
    const esc = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } }; document.addEventListener('keydown', esc);
    requestAnimationFrame(() => wrap.classList.add('in'));
    return { el: wrap.querySelector('.sheet-body'), close, root: wrap };
  };
  GF.confirm = (title, text, okLabel = 'Confirm', danger = false) => new Promise(res => {
    const s = GF.sheet(`<h3 class="h3">${GF.esc(title)}</h3><p class="muted mt">${GF.esc(text)}</p><div class="row mt2"><button class="btn ghost" data-no>Not now</button><button class="btn ${danger ? 'danger' : ''}" data-yes>${GF.esc(okLabel)}</button></div>`, { onClose: () => res(false) });
    s.el.querySelector('[data-no]').onclick = () => { res(false); s.close(); };
    s.el.querySelector('[data-yes]').onclick = () => { res(true); s.close(); };
  });
  GF.busy = async (btn, fn) => {
    if (btn.disabled) return; const old = btn.innerHTML; btn.disabled = true; btn.classList.add('loading');
    try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('loading'); btn.innerHTML = old; }
  };

  // ---------- realtime ----------
  let es;
  GF.connect = () => {
    if (!GF.token() || es) return;
    es = new EventSource('/api/stream?token=' + encodeURIComponent(GF.token()));
    for (const t of ['order', 'notification', 'wallet', 'admin', 'route', 'demo']) es.addEventListener(t, e => { let d = {}; try { d = JSON.parse(e.data); } catch {} window.dispatchEvent(new CustomEvent('gf:' + t, { detail: d })); });
    es.onerror = () => { /* browser auto-reconnects */ };
  };
  GF.disconnect = () => { if (es) { es.close(); es = null; } };

  // ---------- login (shared by all three apps) ----------
  GF.loginView = function (el, { role, title, sub, onDone }) {
    el.innerHTML = `<div class="login-card">
      <div class="login-logo">🥛</div><h1 class="h2 center">${GF.esc(title || 'Welcome to GharFresh')}</h1><p class="muted center">${GF.esc(sub || 'Login with your email. No password needed.')}</p>
      <form id="lf1"><label class="lbl">Email</label><input class="input" type="email" name="email" placeholder="you@example.com" autocomplete="email" required inputmode="email">
        <button class="btn full mt" type="submit">Get OTP</button></form>
      <form id="lf2" hidden><div id="otpHint"></div><label class="lbl">Enter 6-digit OTP</label><input class="input otp" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="••••••" required>
        <div id="nameWrap" hidden><label class="lbl">Your name</label><input class="input" name="name" placeholder="Full name" autocomplete="name"></div>
        <button class="btn full mt" type="submit">Verify &amp; continue</button><button type="button" class="link center mt" id="back">← Change email</button></form>
      <div id="demoBox" hidden><div class="or"><span>or try instantly</span></div><div class="demo-row" id="demoBtns"></div><p class="tiny muted center">Demo mode: sample customers, riders and admin are pre-loaded.</p></div></div>`;
    const f1 = el.querySelector('#lf1'), f2 = el.querySelector('#lf2');
    let email = '';
    const ref = new URLSearchParams(location.search).get('ref') || '';
    f1.onsubmit = async e => {
      e.preventDefault(); const b = f1.querySelector('button');
      await GF.busy(b, async () => {
        try {
          email = f1.email.value.trim().toLowerCase(); const r = await GF.post('/api/auth/otp', { email });
          f1.hidden = true; f2.hidden = false; f2.querySelector('#nameWrap').hidden = !!r.exists;
          el.querySelector('#otpHint').innerHTML = r.devOtp ? `<div class="otp-demo">Demo mode: your OTP is <b>${r.devOtp}</b></div>` : `<p class="muted">We emailed a code to <b>${GF.esc(email)}</b></p>`;
          if (r.devOtp) f2.code.value = r.devOtp; f2.code.focus();
        } catch (er) { GF.err(er); }
      });
    };
    f2.onsubmit = async e => {
      e.preventDefault(); const b = f2.querySelector('button[type=submit]');
      await GF.busy(b, async () => {
        try { const r = await GF.post('/api/auth/verify', { email, code: f2.code.value, name: f2.name.value, ref }); GF.setToken(r.token); onDone(r.user); } catch (er) { GF.err(er); }
      });
    };
    el.querySelector('#back').onclick = () => { f2.hidden = true; f1.hidden = false; };
    GF.get('/api/bootstrap').then(b => {
      if (!b.demo) return;
      const roles = role ? [role] : ['customer', 'rider', 'admin'];
      const lbl = { customer: '🛒 Demo customer', rider: '🛵 Demo rider', admin: '🧑‍💼 Demo admin' };
      el.querySelector('#demoBox').hidden = false;
      el.querySelector('#demoBtns').innerHTML = roles.map(r => `<button class="btn ghost" data-demo="${r}">${lbl[r]}</button>`).join('');
      el.querySelectorAll('[data-demo]').forEach(btn => btn.onclick = () => GF.busy(btn, async () => { try { const r = await GF.post('/api/auth/demo', { role: btn.dataset.demo }); GF.setToken(r.token); onDone(r.user); } catch (er) { GF.err(er); } }));
    }).catch(() => {});
  };

  GF.registerSW = () => { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); };
})();
