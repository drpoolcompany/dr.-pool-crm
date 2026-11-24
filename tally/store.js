/* Chemical Tally: storage layer (Supabase).
   The Claude tally artifact keeps its working copy in its own database and mirrors every invoice to Supabase.
   This file reads and writes that Supabase copy through the signed-in staff session (shared/drpool.js).
   Row-level security decides who can do what:
     supplier_invoices, supplier_invoice_lines   Office access only (read and write)
     tally_settings                              Office read; Office insert/update for the keys listed in SETTING_KEYS
   Nothing here uses a service key. */
(function () {
  'use strict';
  var sb = DrPool.sb;
  var SETTING_KEYS = ['config', 'alerts', 'missing', 'stops', 'schedules', 'skipped'];
  var LINE_COLS = 'line_no,sku,description,um,qty,price,ext,category,label,product_group,gpu,fulfilled_by';
  var INV_COLS = 'supplier,invoice_no,order_no,order_date,invoice_date,route_no,total,source,note,po_text';

  function mmdd(iso) { var m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[1] + '/' + m[2] : String(iso || ''); }
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00')); }
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function isPro(v) { return !!v && v.vendor === 'Proline'; }
  function mirrorNo(v) { return v.source === 'sheet' ? 'BEFORE-APP-R' + v.route : v.invoice; }
  /* "Ordered 10/22, invoiced 10/22" is added to the saved note by the Claude page; the page rebuilds it from orderDate, so it is not stored twice. */
  function ordNote(v) { return v && v.orderDate && v.source !== 'stock' && v.source !== 'phone' ? 'Ordered ' + mmdd(v.orderDate) + ', invoiced ' + mmdd(v.date) : ''; }
  function savedNote(v) {
    var o = ordNote(v), n = v.note || '';
    if (v.phoneOrderId) o = (o ? o + ' · ' : '') + 'replaced phone order ' + v.phoneOrderId;
    return n && o ? n + ' · ' + o : (n || o);
  }
  function poOf(v) { var m = /P\.O\.:\s*([^;=(]+)/.exec(v.note || ''); return v.po || (m ? m[1].trim() : ''); }

  /* One Supabase invoice row (with its lines) -> the invoice object the tally page works with. */
  function rowToInv(r) {
    var its = (r.supplier_invoice_lines || []).slice().sort(function (a, b) { return (a.line_no || 0) - (b.line_no || 0); }).map(function (l) {
      var o = { cat: l.category || 'other', desc: l.description || '', ext: Number(l.ext) || 0, label: l.label || l.description || '', price: Number(l.price) || 0, qty: Number(l.qty) || 0, sku: l.sku || '', um: l.um || '' };
      if (l.product_group) o.group = l.product_group;
      if (l.fulfilled_by) o.fulfilledBy = l.fulfilled_by;
      if (l.gpu != null && Number(l.gpu) > 0) o.gpu = Number(l.gpu);
      return o;
    });
    var route = r.route_no == null ? (/stock/i.test(r.po_text || '') ? 'Stock' : '?') : String(r.route_no);
    var note = String(r.note || ''), phoneOrderId = '';
    note = note.replace(/(^| · )replaced phone order (\S+)/, function (m, a, id) { phoneOrderId = id; return ''; });
    note = note.replace(/(^| · )Ordered \d\d\/\d\d, invoiced \d\d\/\d\d/, '');
    var v = { date: String(r.invoice_date || '').slice(0, 10), invoice: r.invoice_no, order: r.order_no || '', route: route, total: Number(r.total) || 0, items: its };
    if (r.source === 'sheet') v.invoice = 'Before app R' + r.route_no;
    if (r.supplier === 'Proline') v.vendor = 'Proline';
    if (r.source === 'sheet' || r.source === 'stock' || r.source === 'phone') v.source = r.source;
    if (note) v.note = note;
    if (phoneOrderId) v.phoneOrderId = phoneOrderId;
    if (r.po_text) v.po = r.po_text;
    if (r.order_date) v.orderDate = String(r.order_date).slice(0, 10);
    return v;
  }

  async function loadInvoices() {
    var out = [], from = 0, step = 500;
    for (;;) {
      var q = await sb.from('supplier_invoices').select(INV_COLS + ',supplier_invoice_lines(' + LINE_COLS + ')')
        .order('invoice_date', { ascending: false }).order('invoice_no').range(from, from + step - 1);
      if (q.error) throw q.error;
      out = out.concat(q.data || []);
      if (!q.data || q.data.length < step) break;
      from += step;
    }
    return out.map(rowToInv);
  }

  /* Brain: technicians (names per route), the weekly route schedule, and which week the brain is on. */
  async function loadBrain() {
    var res = { techs: {}, techRows: [], weeks: [], cur: '' };
    var t = await sb.from('technicians').select('id,route_no,name,active');
    if (t.error) throw t.error;
    res.techRows = t.data || [];
    res.techRows.forEach(function (x) { if (x.active && (x.route_no != null || x.name === 'Geffet')) res.techs[String(x.route_no == null ? 0 : x.route_no)] = x.name; });
    var w = await sb.from('v_route_summary').select('week_of,route_no,tech_name,stops,pools,income');
    if (w.error) throw w.error;
    var m = {};
    (w.data || []).forEach(function (x) {
      var k = String(x.week_of).slice(0, 10), wk = m[k] || (m[k] = { week: addDaysISO(k, 1), brainWeek: k, src: 'brain', routes: {} });
      wk.routes[String(x.route_no)] = { name: x.tech_name, pools: Number(x.pools) || 0, income: Number(x.income) || 0, stops: Number(x.stops) || 0 };
    });
    res.weeks = Object.keys(m).sort().map(function (k) { return m[k]; });
    var c = await sb.rpc('brain_current_week');
    if (!c.error && c.data) res.cur = String(c.data).slice(0, 10);
    return res;
  }
  function addDaysISO(iso, n) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  async function loadSettings() {
    var s = await sb.from('tally_settings').select('key,value');
    if (s.error) throw s.error;
    var o = {};
    (s.data || []).forEach(function (x) { o[x.key] = x.value; });
    return o;
  }
  async function saveSetting(key, value) {
    if (SETTING_KEYS.indexOf(key) < 0) throw new Error('Unknown setting ' + key);
    var me = DrPool.me;
    var q = await sb.from('tally_settings').upsert({ key: key, value: value, updated_by: 'staff:' + ((me && me.username) || 'site'), updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (q.error) throw q.error;
  }

  /* Write one invoice header and replace its lines. New lines go in before the old ones are removed,
     so a failed save never leaves an invoice without lines. */
  async function saveInvoice(v, techRows) {
    var vd = isPro(v) ? 'Proline' : 'SCP', no = mirrorNo(v), rt = parseInt(v.route, 10), rn = Number.isFinite(rt) ? rt : null;
    var tech = rn == null ? null : (techRows || []).filter(function (t) { return t.route_no === rn || (rn === 0 && t.name === 'Geffet'); })[0];
    var src = v.source === 'sheet' || v.source === 'stock' || v.source === 'phone' ? v.source : (isPro(v) ? 'proline' : 'scp');
    var hdr = {
      supplier: vd, invoice_no: no, order_no: v.order || null, invoice_date: v.date, order_date: validDate(String(v.orderDate || '')) ? v.orderDate : null,
      route_no: rn, technician_id: tech ? tech.id : null, total: r2(v.total), source: src, note: savedNote(v) || null, po_text: poOf(v) || null,
      doc_id: no, synced_at: new Date().toISOString(), updated_at: new Date().toISOString()
    };
    var h = await sb.from('supplier_invoices').upsert(hdr, { onConflict: 'supplier,invoice_no' }).select('id').single();
    if (h.error) throw h.error;
    var id = h.data.id;
    var old = await sb.from('supplier_invoice_lines').select('id').eq('invoice_id', id);
    if (old.error) throw old.error;
    var lines = (v.items || []).map(function (i, k) {
      return { invoice_id: id, line_no: k + 1, sku: i.sku || null, description: i.desc, um: i.um, qty: Number(i.qty), price: Number(i.price), ext: Number(i.ext), category: i.cat, label: i.label, product_group: i.group || null, gpu: i.gpu == null ? null : Number(i.gpu), fulfilled_by: i.fulfilledBy || null };
    });
    if (lines.length) { var ins = await sb.from('supplier_invoice_lines').insert(lines); if (ins.error) throw ins.error; }
    var oldIds = (old.data || []).map(function (x) { return x.id; });
    if (oldIds.length) { var del = await sb.from('supplier_invoice_lines').delete().in('id', oldIds); if (del.error) throw del.error; }
  }
  async function deleteInvoice(no, vendor) {
    var q = await sb.from('supplier_invoices').delete().eq('supplier', vendor === 'Proline' ? 'Proline' : 'SCP').eq('invoice_no', no);
    if (q.error) throw q.error;
  }

  window.TallyStore = { SETTING_KEYS: SETTING_KEYS, rowToInv: rowToInv, loadInvoices: loadInvoices, loadBrain: loadBrain, loadSettings: loadSettings, saveSetting: saveSetting, saveInvoice: saveInvoice, deleteInvoice: deleteInvoice, mirrorNo: mirrorNo };
})();
