'use strict';
// Server-sent events hub: pushes live updates to customers, riders and admins.
const clients = new Set();

function add(res, user) {
  const c = { res, userId: user.id, role: user.role };
  clients.add(c);
  res.on('close', () => clients.delete(c));
  return c;
}
// target: userId | 'admin' | 'riders' | 'all'
function emit(target, type, data = {}) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    const hit = target === 'all' || c.userId === target || (target === 'admin' && c.role === 'admin') || (target === 'riders' && c.role === 'rider');
    if (hit) { try { c.res.write(msg); } catch {} }
  }
}
setInterval(() => { for (const c of clients) { try { c.res.write(': ping\n\n'); } catch {} } }, 25000).unref();
module.exports = { add, emit, count: () => clients.size };
