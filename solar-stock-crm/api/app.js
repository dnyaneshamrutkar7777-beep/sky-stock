const crypto = require('crypto');
const SEED = require('./seed.json');
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SECRET = process.env.SECRET || 'change-me';
const STATUSES = ['Enquiry', 'Booked', 'Material Delivered', 'Installed', 'Closed'];
const DEFAULT_TYPES = [...new Set(['Panel', ...SEED.map((s) => s.type), 'Other'])];

const redis = async (cmd) => {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(cmd) });
  return (await r.json()).result;
};
const load = async (k, def) => { const r = await redis(['GET', k]); return r == null ? def : JSON.parse(r); };
const save = (k, v) => redis(['SET', k, JSON.stringify(v)]);
const hmac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const sign = (role) => { const p = role + '.' + (Date.now() + 7 * 864e5); return p + '.' + hmac(p); };
const verify = (t) => {
  const [r, e, h] = (t || '').split('.');
  if (!h || h !== hmac(r + '.' + e) || Date.now() > +e) return null;
  return r;
};
const num = (v) => Math.max(0, Number(v) || 0);
const id = () => crypto.randomBytes(6).toString('hex');
const txt = (v, n = 80) => String(v || '').trim().slice(0, n);

// first run: load the opening stock from SKY ELECTROFAB list
const getStock = async () => {
  const s = await load('stock', null);
  if (s) return s;
  const seeded = SEED.map((x) => ({ ...x, id: id() }));
  await save('stock', seeded);
  return seeded;
};
const state = async () => ({
  stock: await getStock(),
  types: await load('types', DEFAULT_TYPES),
  out: (await load('out', [])).slice(-100).reverse(),
  orders: (await load('orders', [])).slice(-60).reverse(),
});
const addType = async (name) => {
  const types = await load('types', DEFAULT_TYPES);
  if (name && !types.some((t) => t.toLowerCase() === name.toLowerCase())) { types.push(name); await save('types', types); }
};

module.exports = async (req, res) => {
  const b = req.body || {};
  const a = b.action;
  const bad = (m) => res.status(400).json({ error: m });
  try {
    if (a === 'login') {
      const key = b.user === 'admin' ? 'ADMIN_PASSWORD' : 'STOCKIST_PASSWORD';
      const pw = String(process.env[key] || '').trim();
      if (!pw) return res.status(500).json({ error: key + ' is not set on the server. In Vercel: Settings > Environment Variables, add it, then Redeploy.' });
      if (String(b.password || '').trim() !== pw) return res.status(401).json({ error: 'Wrong password for ' + (b.user === 'admin' ? 'Admin' : 'Stockist') });
      return res.json({ token: sign(b.user), role: b.user === 'admin' ? 'admin' : 'stockist' });
    }
    const role = verify(req.headers.authorization);
    if (!role) return res.status(401).json({ error: 'Please login again' });
    if (!URL_ || !TOKEN) return res.status(500).json({ error: 'Database not connected (see README step 2)' });

    // ---- Stock: stockist + admin ----
    if (a === 'stock') return res.json(await state());
    if (a === 'typeAdd') {
      const n = txt(b.name, 30);
      if (!n) return bad('Enter type name');
      await addType(n);
      return res.json(await state());
    }
    if (a === 'stockChange') {
      const name = txt(b.name), type = txt(b.type, 30) || 'Other', unit = txt(b.unit, 12) || 'Nos';
      const delta = Math.trunc(Number(b.delta));
      if (!name || !delta) return bad('Enter item name and quantity');
      const stock = await getStock();
      let it = stock.find((s) => s.name.toLowerCase() === name.toLowerCase() && s.type === type);
      if (!it) {
        if (delta < 0) return bad('Item not in stock');
        it = { id: id(), name, type, unit, watt: num(b.watt), qty: 0 };
        stock.push(it);
      }
      if (it.qty + delta < 0) return bad('Only ' + it.qty + ' ' + it.unit + ' in stock');
      it.qty += delta;
      await addType(type);
      await save('stock', stock);
      return res.json(await state());
    }
    if (a === 'stockDelete') {
      if (role !== 'admin') return res.status(403).json({ error: 'Only admin can delete items' });
      await save('stock', (await getStock()).filter((s) => s.id !== b.id));
      return res.json(await state());
    }
    if (a === 'stockOut') {
      const bill = txt(b.bill, 30), customer = txt(b.customer, 80);
      if (!bill) return bad('Bill number required');
      const custType = ['B2B', 'B2C'].includes(b.custType) ? b.custType : '';
      const payType = ['Cash', 'Online', 'Site'].includes(b.payType) ? b.payType : '';
      if (!custType) return bad('Select customer type (B2B or B2C)');
      if (!payType) return bad('Select payment type (Cash, Online or Site)');
      const want = {};
      (b.items || []).forEach((i) => { const q = Math.trunc(Number(i.qty)); if (i.id && q > 0) want[i.id] = (want[i.id] || 0) + q; });
      const ids = Object.keys(want);
      if (!ids.length) return bad('Select at least one item');
      const stock = await getStock();
      const lines = [];
      for (const k of ids) {
        const it = stock.find((s) => s.id === k);
        if (!it) return bad('Item not found');
        if (it.qty < want[k]) return bad(it.name + ': only ' + it.qty + ' ' + it.unit + ' in stock');
        lines.push({ it, q: want[k] });
      }
      lines.forEach((l) => { l.it.qty -= l.q; });
      const out = await load('out', []);
      out.push({ id: id(), bill, customer, custType, payType, date: new Date().toISOString(), by: role, items: lines.map((l) => ({ name: l.it.name, unit: l.it.unit, qty: l.q })) });
      await save('stock', stock);
      await save('out', out);
      if (b.orderId) {
        const orders = await load('orders', []);
        const o = orders.find((x) => x.id === b.orderId);
        if (o) { o.status = 'Delivered'; o.bill = bill; o.deliveredAt = new Date().toISOString(); await save('orders', orders); }
      }
      return res.json(await state());
    }

    // ---- Delivery orders: admin creates, stockist prepares ----
    if (a === 'orderAdd') {
      if (role !== 'admin') return res.status(403).json({ error: 'Only admin can create delivery orders' });
      const customer = txt(b.customer);
      if (!customer) return bad('Customer name required');
      const stock = await getStock(), want = {};
      (b.items || []).forEach((i) => { const q = Math.trunc(Number(i.qty)); if (i.id && q > 0) want[i.id] = (want[i.id] || 0) + q; });
      const items = Object.keys(want).map((k) => { const s = stock.find((x) => x.id === k); return s && { id: k, name: s.name, unit: s.unit, qty: want[k] }; }).filter(Boolean);
      if (!items.length) return bad('Select at least one item');
      const orders = await load('orders', []);
      orders.push({ id: id(), no: await redis(['INCR', 'orderno']), customer, site: txt(b.site, 200), note: txt(b.note, 300), items, status: 'Pending', date: new Date().toISOString() });
      await save('orders', orders);
      return res.json(await state());
    }
    if (a === 'orderStatus') {
      const orders = await load('orders', []);
      const o = orders.find((x) => x.id === b.id);
      if (o && o.status !== 'Delivered' && ['Pending', 'Ready'].includes(b.status)) { o.status = b.status; o.updatedBy = role; await save('orders', orders); }
      return res.json(await state());
    }
    if (a === 'orderDelete') {
      if (role !== 'admin') return res.status(403).json({ error: 'Only admin can delete orders' });
      await save('orders', (await load('orders', [])).filter((x) => x.id !== b.id));
      return res.json(await state());
    }

    // ---- CRM: admin only ----
    if (role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    if (a === 'customers') return res.json(await load('customers', []));
    if (a === 'customerAdd') {
      const name = txt(b.name);
      if (!name) return bad('Customer name required');
      const payType = b.payType === 'loan' ? 'loan' : 'cash';
      const list = await load('customers', []);
      const c = {
        id: id(), no: Math.max(0, ...list.map((x) => x.no || 0)) + 1, name, phone: txt(b.phone, 20), address: txt(b.address, 200), district: txt(b.district, 40), consumerNo: txt(b.consumerNo, 30),
        panelWatt: num(b.panelWatt), inverterWatt: num(b.inverterWatt), payType, totalCost: num(b.totalCost),
        loanAmount: payType === 'loan' ? num(b.loanAmount) : 0, status: 'Booked', date: new Date().toISOString(), payments: [],
      };
      if (num(b.cashAmount) > 0) c.payments.push({ id: id(), rno: await redis(['INCR', 'rcpno']), date: c.date, amount: num(b.cashAmount) });
      list.push(c);
      await save('customers', list);
      return res.json(list);
    }
    if (a === 'paymentAdd') {
      const list = await load('customers', []);
      const c = list.find((x) => x.id === b.id);
      if (!c || !(num(b.amount) > 0)) return bad('Enter payment amount');
      c.payments = c.payments || [];
      c.payments.push({ id: id(), rno: await redis(['INCR', 'rcpno']), date: new Date().toISOString(), amount: num(b.amount) });
      await save('customers', list);
      return res.json(list);
    }
    if (a === 'customerStatus') {
      const list = await load('customers', []);
      const c = list.find((x) => x.id === b.id);
      if (c && STATUSES.includes(b.status)) c.status = b.status;
      await save('customers', list);
      return res.json(list);
    }
    if (a === 'customerDelete') {
      const list = (await load('customers', [])).filter((c) => c.id !== b.id);
      await save('customers', list);
      return res.json(list);
    }
    return bad('Unknown action');
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
