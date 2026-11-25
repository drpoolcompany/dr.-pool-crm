/* Chemical Tally: invoice scans (Supabase Storage).
   Private bucket "invoice-scans". Path: <SCP|Proline>/<invoice_no>.jpg ; extra pages <invoice_no>_2.jpg, _3.jpg ...
   Row-level security on storage.objects: Office access only (can_office()) for read, upload, replace and delete. No anon access.
   Pictures are shown through short-lived signed URLs (about 10 minutes) from the signed-in session.
   The page hands this file what it needs through TallyScans.init(). Nothing here uses a service key. */
(function () {
  'use strict';
  var BUCKET = 'invoice-scans', FOLDERS = ['SCP', 'Proline'], MAX_BYTES = 5 * 1024 * 1024, COMPRESS_OVER = 600 * 1024, MAX_PX = 1600, QUALITY = 0.75, SIGN_SECS = 600;
  var ZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  var host = { getInvoices: function () { return []; }, render: function () {}, mirrorNo: function (v) { return v.invoice; }, isOffice: function () { return true; } };
  var sb = null;
  var state = { ok: false, err: '', files: {} };   /* files: "SCP/B7980083" -> { pages: [{n, path, ext}] } sorted by page */
  var batch = null;                                /* the upload preview being worked on */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { n = Number(n || 0); return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function bucket() { return (sb || (sb = window.DrPool.sb)).storage.from(BUCKET); }

  /* ---- naming rules ---- */
  var EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };
  /* "b7980083_2.JPG" -> { stem: "B7980083", page: 2, ext: "jpg" }; null when the name is not an image or PDF. */
  function parseName(name) {
    var base = String(name || '').split(/[\\/]/).pop().trim();
    var m = /^(.+?)\.([A-Za-z0-9]+)$/.exec(base);
    if (!m) return null;
    var ext = m[2].toLowerCase();
    if (!EXT_MIME[ext]) return null;
    var stem = m[1].trim(), page = 1, p = /^(.+?)_(\d{1,2})$/.exec(stem);
    if (p) { stem = p[1].trim(); page = parseInt(p[2], 10) || 1; }
    stem = stem.toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{3,}$/.test(stem)) return null;
    return { stem: stem, page: page, ext: ext === 'jpeg' ? 'jpg' : ext };
  }
  function realInvoice(v) { return v && v.source !== 'sheet' && v.source !== 'stock' && v.source !== 'phone' && !!v.invoice; }
  function folderOf(v) { return v && v.vendor === 'Proline' ? 'Proline' : 'SCP'; }
  function keyOf(v) { return folderOf(v) + '/' + String(host.mirrorNo(v)).toUpperCase(); }
  function pathFor(key, page, ext) { return key + (page > 1 ? '_' + page : '') + '.' + ext; }
  function matchInvoice(stem) {
    return host.getInvoices().filter(function (v) { return realInvoice(v) && String(host.mirrorNo(v)).toUpperCase() === stem; });
  }
  function pagesOf(key) { return (state.files[key] && state.files[key].pages) || []; }
  function hasScan(v) { return realInvoice(v) && pagesOf(keyOf(v)).length > 0; }
  function missingList(list) { return (list || host.getInvoices()).filter(function (v) { return realInvoice(v) && !pagesOf(keyOf(v)).length; }); }

  /* ---- list what is in the bucket ---- */
  async function load() {
    try {
      var files = {};
      for (var f = 0; f < FOLDERS.length; f++) {
        for (var off = 0; ; off += 1000) {
          var r = await bucket().list(FOLDERS[f], { limit: 1000, offset: off, sortBy: { column: 'name', order: 'asc' } });
          if (r.error) throw r.error;
          (r.data || []).forEach(function (o) {
            if (!o.name || o.id === null) return;       /* sub-folders have no id */
            var pn = parseName(o.name); if (!pn) return;
            var key = FOLDERS[f] + '/' + pn.stem;
            (files[key] = files[key] || { pages: [] }).pages.push({ n: pn.page, path: FOLDERS[f] + '/' + o.name, ext: pn.ext, size: o.metadata && o.metadata.size });
          });
          if (!r.data || r.data.length < 1000) break;
        }
      }
      Object.keys(files).forEach(function (k) { files[k].pages.sort(function (a, b) { return a.n - b.n; }); });
      state.files = files; state.ok = true; state.err = '';
    } catch (e) { state.ok = false; state.err = (e && e.message) || String(e); }
    return state;
  }

  /* ---- buttons the page puts into rows and the invoice detail ---- */
  var CLIP = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>';
  function viewBtn(v) {
    var pg = pagesOf(keyOf(v));
    return '<button class="btn scanb" type="button" data-scan="view" data-sk="' + esc(keyOf(v)) + '" aria-label="View scan of invoice ' + esc(v.invoice) + '">' + CLIP + ' Scan' + (pg.length > 1 ? ' (' + pg.length + ')' : '') + '</button>';
  }
  function rowBtn(v) {
    if (!realInvoice(v)) return '';
    if (!state.ok) return '<span class="muted">&mdash;</span>';
    if (hasScan(v)) return viewBtn(v);
    return '<span class="muted">none</span>' + (host.isOffice() ? ' <button class="btn scanb" type="button" data-scan="attach" data-sk="' + esc(keyOf(v)) + '" aria-label="Attach scan to invoice ' + esc(v.invoice) + '">Attach</button>' : '');
  }
  function detailBar(v) {
    if (!realInvoice(v)) return '';
    if (!state.ok) return state.err ? '<div class="note">Scans could not be loaded: ' + esc(state.err) + '</div>' : '';
    var k = keyOf(v), has = hasScan(v), o = host.isOffice();
    return '<div class="row scanbar">' + (has ? viewBtn(v) : '<span class="muted">No scan attached.</span>') +
      (o ? ' <button class="btn scanb" type="button" data-scan="attach" data-sk="' + esc(k) + '">' + (has ? 'Replace scan' : 'Attach scan') + '</button>' : '') +
      (o && has ? ' <button class="btn scanb" type="button" data-scan="delall" data-sk="' + esc(k) + '">Delete scan</button>' : '') + '</div>';
  }
  function counter(list) {
    if (!state.ok) return '';
    var all = (list || []).filter(realInvoice), miss = all.filter(function (v) { return !hasScan(v); });
    return { total: all.length, missing: miss.length, have: all.length - miss.length };
  }

  /* ---- viewer ---- */
  var vw = null;   /* { el, key, i, urls, zoom, label } */
  async function signed(pages) {
    var r = await bucket().createSignedUrls(pages.map(function (p) { return p.path; }), SIGN_SECS);
    if (r.error) throw r.error;
    var m = {}; (r.data || []).forEach(function (x) { if (x.signedUrl) m[x.path] = x.signedUrl; });
    return m;
  }
  async function openViewer(key, from) {
    if (vw) closeViewer();
    var pages = pagesOf(key); if (!pages.length) return;
    var label = key.split('/')[1];
    var el = document.createElement('div');
    el.className = 'scanvw'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Scan of invoice ' + label);
    el.innerHTML = '<div class="svbar"><span class="svt" id="svT"></span>' +
      '<button type="button" class="btn" data-sv="prev" aria-label="Previous page">&lsaquo; Prev</button><button type="button" class="btn" data-sv="next" aria-label="Next page">Next &rsaquo;</button>' +
      '<button type="button" class="btn" data-sv="out" aria-label="Zoom out">&minus;</button><button type="button" class="btn" data-sv="fit" aria-label="Fit to screen">Fit</button><button type="button" class="btn" data-sv="in" aria-label="Zoom in">+</button>' +
      (host.isOffice() ? '<button type="button" class="btn" data-sv="del">Delete page</button>' : '') +
      '<button type="button" class="btn primary svx" data-sv="close" aria-label="Close scan viewer">Close</button></div>' +
      '<div class="svbody" id="svBody"><div class="svmsg" id="svMsg">Loading&hellip;</div><img id="svImg" alt="" hidden><a id="svPdf" class="btn" target="_blank" rel="noopener" hidden>Open the PDF</a></div>';
    document.body.appendChild(el); document.body.style.overflow = 'hidden';
    vw = { el: el, key: key, i: 0, urls: {}, zoom: 1, label: label, from: from || null };
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sv]'); if (!b) return;
      var a = b.getAttribute('data-sv');
      if (a === 'close') closeViewer(); else if (a === 'prev') go(-1); else if (a === 'next') go(1);
      else if (a === 'in') zoom(1.4); else if (a === 'out') zoom(1 / 1.4); else if (a === 'fit') { vw.zoom = 1; applyZoom(); }
      else if (a === 'del') delPage();
    });
    document.addEventListener('keydown', vkey, true);
    el.querySelector('.svx').focus();
    try { vw.urls = await signed(pages); } catch (e) { setMsg('Could not open the scan: ' + ((e && e.message) || e)); return; }
    show();
  }
  function setMsg(t) { if (!vw) return; var m = vw.el.querySelector('#svMsg'); m.textContent = t; m.hidden = !t; }
  function show() {
    if (!vw) return;
    var pages = pagesOf(vw.key); if (!pages.length) { closeViewer(); return; }
    if (vw.i >= pages.length) vw.i = pages.length - 1; if (vw.i < 0) vw.i = 0;
    var p = pages[vw.i], url = vw.urls[p.path], img = vw.el.querySelector('#svImg'), pdf = vw.el.querySelector('#svPdf');
    vw.el.querySelector('#svT').textContent = 'Invoice ' + vw.label + ' · page ' + (vw.i + 1) + ' of ' + pages.length;
    vw.el.querySelector('[data-sv="prev"]').disabled = vw.i === 0; vw.el.querySelector('[data-sv="next"]').disabled = vw.i >= pages.length - 1;
    var isPdf = p.ext === 'pdf'; vw.zoom = 1;
    ['in', 'out', 'fit'].forEach(function (x) { vw.el.querySelector('[data-sv="' + x + '"]').hidden = isPdf; });
    img.hidden = true; pdf.hidden = true;
    if (!url) { setMsg('This page could not be opened.'); return; }
    if (isPdf) { pdf.href = url; pdf.textContent = 'Open the PDF'; pdf.hidden = false; setMsg('This page is a PDF.'); return; }
    setMsg('Loading…');
    img.onload = function () { setMsg(''); img.hidden = false; applyZoom(); };
    img.onerror = function () { setMsg('The picture could not be loaded. Close and open it again.'); };
    img.alt = 'Scan of invoice ' + vw.label + ', page ' + (vw.i + 1);
    img.src = url;
  }
  function applyZoom() { var img = vw && vw.el.querySelector('#svImg'); if (img) img.style.width = (vw.zoom * 100) + '%'; }
  function zoom(f) { if (!vw) return; vw.zoom = Math.max(1, Math.min(6, vw.zoom * f)); applyZoom(); }
  function go(d) { if (!vw) return; vw.i += d; show(); }
  function vkey(e) {
    if (!vw) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeViewer(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'Tab') { var f = vw.el.querySelectorAll('button:not([disabled]):not([hidden]),a[href]:not([hidden])'); if (!f.length) return; var first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } else if (!vw.el.contains(document.activeElement)) { e.preventDefault(); first.focus(); } }
  }
  function closeViewer() {
    if (!vw) return;
    var v = vw; vw = null;
    document.removeEventListener('keydown', vkey, true);
    v.el.remove(); document.body.style.overflow = '';
    if (v.from && document.body.contains(v.from)) try { v.from.focus(); } catch (x) {}
  }
  async function delPage() {
    if (!vw || !host.isOffice()) return;
    var p = pagesOf(vw.key)[vw.i]; if (!p) return;
    if (!window.confirm('Delete page ' + (vw.i + 1) + ' of the scan for invoice ' + vw.label + '? This cannot be undone.')) return;
    var r = await bucket().remove([p.path]);
    if (r.error) { setMsg('Could not delete: ' + r.error.message); return; }
    await load(); host.render(); show();
  }
  async function deleteAll(key) {
    var pages = pagesOf(key); if (!pages.length || !host.isOffice()) return;
    if (!window.confirm('Delete ' + (pages.length === 1 ? 'the scan' : 'all ' + pages.length + ' pages') + ' of invoice ' + key.split('/')[1] + '? This cannot be undone.')) return;
    var r = await bucket().remove(pages.map(function (p) { return p.path; }));
    if (r.error) { window.alert('Could not delete: ' + r.error.message); return; }
    await load(); host.render();
  }

  /* ---- reading files (images, PDFs, or a zip of them) ---- */
  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load the zip reader. Check your connection.')); }; document.head.appendChild(s); });
  }
  async function expand(fileList, onStatus) {
    var out = [];
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      if (/\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') {
        if (!window.JSZip) { if (onStatus) onStatus('Loading the zip reader…'); await loadScript(ZIP_URL); }
        if (onStatus) onStatus('Opening ' + f.name + '…');
        var z = await window.JSZip.loadAsync(f), names = Object.keys(z.files);
        for (var j = 0; j < names.length; j++) {
          var ent = z.files[names[j]], base = names[j].split('/').pop();
          if (ent.dir || /^__MACOSX\//.test(names[j]) || base.charAt(0) === '.' || !base) continue;
          var ext = (/\.([A-Za-z0-9]+)$/.exec(base) || [])[1];
          var blob = await ent.async('blob');
          out.push({ name: base, blob: ext && EXT_MIME[ext.toLowerCase()] ? new Blob([blob], { type: EXT_MIME[ext.toLowerCase()] }) : blob, size: blob.size });
        }
      } else out.push({ name: f.name, blob: f, size: f.size });
    }
    return out;
  }
  function toJpeg(blob) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(blob), im = new Image();
      im.onload = function () {
        var w = im.naturalWidth, h = im.naturalHeight, s = Math.min(1, MAX_PX / Math.max(w, h)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? res(b) : rej(new Error('Could not compress the picture.')); }, 'image/jpeg', QUALITY);
      };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Could not read the picture.')); };
      im.src = url;
    });
  }
  /* Image over 600 KB -> JPEG, longest side 1600 px, quality 0.75. PDFs are never changed. */
  async function prepare(item) {
    var pn = item.pn, blob = item.blob, ext = pn.ext;
    if (ext !== 'pdf' && blob.size > COMPRESS_OVER) { blob = await toJpeg(blob); ext = 'jpg'; }
    return { blob: blob, ext: ext, contentType: EXT_MIME[ext] };
  }

  /* ---- preview rows for a batch of files ---- */
  function buildRows(items) {
    var seen = {}, rows = [];
    items.forEach(function (it) {
      var pn = parseName(it.name), row = { name: it.name, blob: it.blob, size: it.size, pn: pn, status: '', inv: null, key: '', page: 1, on: false, can: false };
      if (!pn) { row.status = 'bad'; row.why = /\.(heic|heif|webp|gif|tiff?|bmp)$/i.test(it.name) ? 'Picture type not supported, use JPG, PNG or PDF' : 'Name is not an invoice number (use B7980083.jpg or 4520395.jpg)'; rows.push(row); return; }
      row.page = pn.page;
      var m = matchInvoice(pn.stem);
      if (!m.length) { row.status = 'none'; row.why = 'No matching invoice in the tally'; rows.push(row); return; }
      if (m.length > 1) { row.status = 'bad'; row.why = 'More than one invoice has this number'; rows.push(row); return; }
      row.inv = m[0]; row.key = keyOf(m[0]);
      var id = row.key + '#' + pn.page;
      if (seen[id]) { row.status = 'dup'; row.why = 'Same invoice page already in this list (' + seen[id] + ')'; rows.push(row); return; }
      seen[id] = it.name;
      if (it.size > MAX_BYTES && pn.ext === 'pdf') { row.status = 'big'; row.why = 'PDF is over 5 MB'; rows.push(row); return; }
      var ex = pagesOf(row.key).filter(function (p) { return p.n === pn.page; })[0];
      row.exists = !!ex; row.status = ex ? 'replace' : 'new'; row.can = true; row.on = !ex;
      rows.push(row);
    });
    return rows;
  }
  var STATUS_TXT = { 'new': 'New', replace: 'Already has a scan. Replace?', none: 'No matching invoice', bad: 'Skipped', dup: 'Duplicate', big: 'Too big' };

  /* ---- Attach scans panel ---- */
  function box() { return $('scanBox'); }
  function openBox(open) {
    var b = box(), btn = $('scanBtn'); if (!b) return;
    b.hidden = !open; if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) drawBox();
  }
  function stats() { var c = counter(host.getInvoices()); return c || { total: 0, missing: 0, have: 0 }; }
  function drawBox(msg) {
    var b = box(); if (!b || b.hidden) return;
    var c = stats(), h = '<div class="dhead"><div><h2>Attach scans</h2><p>' + (state.ok ? c.have + ' of ' + c.total + ' invoices have a scan, ' + c.missing + ' missing.' : 'Scans are not available: ' + esc(state.err || 'loading')) + '</p></div><button class="btn" type="button" data-scan="boxclose">Close</button></div>';
    if (!host.isOffice()) { b.innerHTML = h + '<div class="empty">Only Office users can attach scans.</div>'; return; }
    h += '<div class="drop" id="scanDrop" tabindex="0" role="button" aria-label="Drop scan files here or press Enter to choose files"><p>Drop the scans here (pictures, PDFs, or one zip of them). Files must be named by invoice number: <b>B7980083.jpg</b> for SCP, <b>4520395.jpg</b> for Proline, <b>B7980083_2.jpg</b> for a second page.</p></div>' +
      '<div class="row"><label class="btn" for="scanFiles" id="scanFilesLbl">Choose files or a zip</label><input type="file" id="scanFiles" accept=".zip,application/zip,image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf" multiple hidden><span id="scanStatus" class="muted" role="status">' + esc(msg || '') + '</span></div>';
    if (batch) h += batchHtml();
    b.innerHTML = h;
  }
  function batchHtml() {
    var r = batch.rows, n = r.filter(function (x) { return x.on && x.can; }).length, busy = batch.busy;
    var cnt = { 'new': 0, replace: 0, none: 0, other: 0 }; r.forEach(function (x) { if (x.status === 'new' || x.status === 'replace' || x.status === 'none') cnt[x.status]++; else cnt.other++; });
    var h = '<p class="muted">' + r.length + ' file' + (r.length === 1 ? '' : 's') + ': ' + cnt['new'] + ' new, ' + cnt.replace + ' already have a scan, ' + cnt.none + ' no matching invoice' + (cnt.other ? ', ' + cnt.other + ' skipped' : '') + '.</p>';
    h += '<div class="scroll"><table class="scantbl"><thead><tr><th class="l">Upload</th><th class="l">File</th><th class="l">Invoice</th><th>Date</th><th>Total</th><th class="l">Status</th></tr></thead><tbody>';
    r.forEach(function (x, i) {
      var st = x.result ? x.result : (x.why || STATUS_TXT[x.status]);
      h += '<tr data-st="' + esc(x.status) + '"><td class="l"><input type="checkbox" data-scrow="' + i + '"' + (x.on ? ' checked' : '') + (x.can && !busy ? '' : ' disabled') + ' aria-label="Upload ' + esc(x.name) + '"></td>' +
        '<td class="l mono">' + esc(x.name) + '<small>' + Math.round(x.size / 1024) + ' KB</small></td>' +
        '<td class="l mono">' + (x.inv ? esc(x.inv.invoice) + ' <span class="pill neutral">' + folderOf(x.inv) + '</span>' + (x.page > 1 ? ' <span class="muted">page ' + x.page + '</span>' : '') : '<span class="muted">&mdash;</span>') + '</td>' +
        '<td class="m">' + (x.inv ? esc(String(x.inv.date || '').slice(5, 10).replace('-', '/')) : '') + '</td><td class="m">' + (x.inv ? money(x.inv.total) : '') + '</td>' +
        '<td class="l"><span class="pill ' + (x.result ? (x.ok ? 'ok' : 'bad') : x.status === 'new' ? 'ok' : x.status === 'replace' ? 'neutral' : 'bad') + '">' + esc(st) + '</span></td></tr>';
    });
    h += '</tbody></table></div>';
    if (batch.prog) h += '<div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="' + batch.prog.total + '" aria-valuenow="' + batch.prog.done + '"><i style="width:' + Math.round(100 * batch.prog.done / Math.max(1, batch.prog.total)) + '%"></i></div><p class="muted" role="status">' + batch.prog.done + ' of ' + batch.prog.total + ' done' + (batch.prog.fail ? ', ' + batch.prog.fail + ' failed' : '') + '</p>';
    if (batch.summary) h += '<div class="alert"><div><b>' + esc(batch.summary) + '</b></div></div>';
    h += '<div class="row"><button class="btn primary" type="button" id="scanGo" data-scan="go"' + (n && !busy ? '' : ' disabled') + '>' + (batch.done ? 'Upload more ticked' : 'Upload ' + n + ' ticked') + '</button>' +
      '<button class="btn" type="button" data-scan="tickrep"' + (busy ? ' disabled' : '') + '>Tick the replacements too</button>' +
      '<button class="btn" type="button" data-scan="clear"' + (busy ? ' disabled' : '') + '>Clear list</button></div>';
    return h;
  }
  async function takeFiles(fileList) {
    if (!host.isOffice() || !fileList || !fileList.length) return;
    var st = $('scanStatus'), say = function (t) { if (st) st.textContent = t; };
    try {
      var items = await expand(fileList, say);
      if (!state.ok) await load();
      batch = { rows: buildRows(items), busy: false, prog: null, summary: '', done: false };
      drawBox(items.length ? '' : 'No files found.');
    } catch (e) { drawBox('Could not read the files: ' + ((e && e.message) || e)); }
  }
  async function putOne(key, page, blob, ext, contentType) {
    var path = pathFor(key, page, ext);
    var r = await bucket().upload(path, blob, { upsert: true, contentType: contentType, cacheControl: '3600' });
    if (r.error) throw r.error;
    /* same page saved earlier with another extension: remove it so one page has one file */
    var old = pagesOf(key).filter(function (p) { return p.n === page && p.path !== path; }).map(function (p) { return p.path; });
    if (old.length) await bucket().remove(old);
    return path;
  }
  async function upload() {
    if (!batch || batch.busy || !host.isOffice()) return;
    var todo = batch.rows.filter(function (x) { return x.on && x.can && !x.ok; });
    if (!todo.length) return;
    batch.busy = true; batch.summary = ''; batch.prog = { done: 0, total: todo.length, fail: 0 }; drawBox();
    var next = 0, okN = 0;
    async function worker() {
      while (next < todo.length) {
        var x = todo[next++];
        try {
          var p = await prepare(x);
          if (p.blob.size > MAX_BYTES) throw new Error('Still over 5 MB after compressing');
          await putOne(x.key, x.page, p.blob, p.ext, p.contentType);
          x.ok = true; x.result = 'Uploaded' + (p.blob !== x.blob ? ' (compressed to ' + Math.round(p.blob.size / 1024) + ' KB)' : ''); okN++;
        } catch (e) { x.ok = false; x.result = 'Failed: ' + ((e && e.message) || e); batch.prog.fail++; }
        batch.prog.done++; drawBox();
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    await load();
    /* rows that went in are now existing scans */
    batch.rows.forEach(function (x) { if (x.ok) { x.on = false; x.can = false; } });
    batch.busy = false; batch.done = true;
    batch.summary = okN + ' uploaded' + (batch.prog.fail ? ', ' + batch.prog.fail + ' failed (see the list)' : '') + '. ' + batch.rows.filter(function (x) { return !x.on && !x.ok && x.status !== 'new' && x.status !== 'replace'; }).length + ' skipped.';
    host.render(); drawBox();
  }

  /* ---- single invoice: choose file(s) for one invoice, whatever they are called ---- */
  var singleKey = '';
  async function attachTo(key, files) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) { var e = (/\.([A-Za-z0-9]+)$/.exec(f.name) || [])[1]; return e && EXT_MIME[e.toLowerCase()]; });
    if (!list.length || !host.isOffice()) { if (files && files.length) window.alert('Choose a JPG, PNG or PDF.'); return; }
    list.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    var ex = pagesOf(key), no = key.split('/')[1];
    if (ex.length && !window.confirm('Invoice ' + no + ' already has ' + (ex.length === 1 ? 'a scan' : ex.length + ' pages') + '. Replace ' + (list.length === 1 ? 'page 1' : 'pages 1 to ' + list.length) + ' with the new file' + (list.length === 1 ? '' : 's') + '?')) return;
    var fails = [];
    for (var i = 0; i < list.length; i++) {
      try {
        var e = (/\.([A-Za-z0-9]+)$/.exec(list[i].name) || [])[1].toLowerCase(); e = e === 'jpeg' ? 'jpg' : e;
        var p = await prepare({ pn: { ext: e }, blob: new Blob([list[i]], { type: EXT_MIME[e] }) });
        if (p.blob.size > MAX_BYTES) throw new Error('over 5 MB');
        await putOne(key, i + 1, p.blob, p.ext, p.contentType);
      } catch (er) { fails.push(list[i].name + ': ' + ((er && er.message) || er)); }
    }
    await load(); host.render(); drawBox();
    if (fails.length) window.alert('Some files were not saved:\n' + fails.join('\n'));
  }

  /* ---- events ---- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-scan]'); if (!b) return;
    var a = b.getAttribute('data-scan'), k = b.getAttribute('data-sk');
    if (a === 'view') openViewer(k, b);
    else if (a === 'attach') { singleKey = k; var inp = $('scanOne'); if (inp) { inp.value = ''; inp.click(); } }
    else if (a === 'delall') deleteAll(k);
    else if (a === 'boxclose') openBox(false);
    else if (a === 'go') upload();
    else if (a === 'clear') { batch = null; drawBox(); }
    else if (a === 'tickrep') { if (batch) { batch.rows.forEach(function (x) { if (x.can) x.on = true; }); drawBox(); } }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'scanFiles') { var fl = Array.prototype.slice.call(t.files); t.value = ''; takeFiles(fl); }
    else if (t.id === 'scanOne') { var f1 = Array.prototype.slice.call(t.files), kk = singleKey; t.value = ''; attachTo(kk, f1); }
    else if (t.hasAttribute && t.hasAttribute('data-scrow') && batch) { var r = batch.rows[parseInt(t.getAttribute('data-scrow'), 10)]; if (r && r.can) { r.on = t.checked; drawBox(); } }
  });
  document.addEventListener('dragover', function (e) { var d = e.target.closest && e.target.closest('#scanDrop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
  document.addEventListener('dragleave', function (e) { var d = e.target.closest && e.target.closest('#scanDrop'); if (d) d.classList.remove('over'); });
  document.addEventListener('drop', function (e) {
    var d = e.target.closest && e.target.closest('#scanDrop'); if (!d) return;
    e.preventDefault(); d.classList.remove('over');
    takeFiles(Array.prototype.slice.call(e.dataTransfer.files || []));
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.id === 'scanDrop') { e.preventDefault(); var i = $('scanFiles'); if (i) i.click(); }
  });

  function init(h) {
    for (var k in h) host[k] = h[k];
    var btn = $('scanBtn');
    if (btn) { btn.addEventListener('click', function () { openBox(box().hidden); }); }
  }

  window.TallyScans = {
    init: init, load: load, parseName: parseName, buildRows: buildRows, rowBtn: rowBtn, detailBar: detailBar, counter: counter, hasScan: hasScan, missingList: missingList,
    keyOf: keyOf, pagesOf: pagesOf, openViewer: openViewer, closeViewer: closeViewer, takeFiles: takeFiles, upload: upload, drawBox: drawBox, realInvoice: realInvoice,
    get state() { return state; }, get batch() { return batch; }, BUCKET: BUCKET
  };
})();
