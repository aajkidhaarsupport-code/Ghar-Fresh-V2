'use strict';
// Email via Brevo (optional). Without BREVO_API_KEY nothing leaves the server; messages still show in-app.
const enabled = () => !!(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL);

const html = (name, title, body) => `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #e5ece6;border-radius:12px;overflow:hidden">
<div style="background:#0B5D3B;color:#fff;padding:14px 18px;font-weight:bold;font-size:18px">🥛 GharFresh</div>
<div style="padding:18px"><p>Hi ${name || 'there'},</p><p><b>${title}</b></p><p>${body}</p>
<p style="color:#6b7280;font-size:12px">Fresh at your door, every morning.</p></div></div>`;

async function send(to, name, subject, body) {
  if (!enabled()) return { skipped: true };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME || 'GharFresh' },
      to: [{ email: to, name: name || undefined }], subject, htmlContent: html(name, subject, body)
    })
  });
  if (!res.ok) throw new Error('Brevo ' + res.status + ' ' + (await res.text()).slice(0, 120));
  return { sent: true };
}
module.exports = { enabled, send };
