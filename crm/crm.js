/* Dr. Pool Team CRM — tasks, customers, jobs on Supabase (workspace 'team'). */
(async function () {
'use strict';
const T = { call: 'Return call', po: 'Make PO', est: 'Send estimate', appr: 'Get approval', inv: 'Send invoice', pay: 'Check payment', visit: 'Site visit', other: 'Other', close: 'Close loop' };
const KINDS = { repair: 'Repair', renovation: 'Renovation', service: 'Service', equipment: 'Equipment', other: 'Other' };
const PRI = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
const DOCST = { PO: ['Draft', 'Sent', 'Received'], Estimate: ['Draft', 'Sent', 'Approved', 'Declined'], Invoice: ['Draft', 'Sent', 'Paid'] };
const PM = ['Check', 'Cash', 'Card', 'Zelle', 'ACH', 'Other'];
const STAGES = ['Site visit', 'Demo', 'Plumbing', 'Electrical', 'Tile', 'Coping / deck', 'Plaster / finish', 'Equipment', 'Fill & start-up', 'Punch list', 'Done'];
const PEOPLE = ['Daniel', 'Juliana', 'Malu', 'David', 'Geffet', 'Aldo', 'Office'];
const WS = 'team';

const me = await DrPool.requireLogin();
if (!me) return;
DrPool.topBar('crm');
const sb = DrPool.sb;
const $ = (s, el = document) => el.querySelector(s);
const main = $('#main');

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $$ = n => (n < 0 ? '-$' : '$') + Math.abs(+n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayKey = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const today = () => dayKey(new Date());
const fmtDay = d => new Date(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const fmtAt = d => new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtMonth = d => new Date(d + 'T12:00').toLocaleDateString([], { month: 'short', year: 'numeric' });
const addrOf = c => c ? [c.address, c.city].filter(Boolean).join(', ') : '';
const mapUrl = c => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addrOf(c) + (c && c.city ? ', FL' : ''));
const mapLink = c => addrOf(c) ? `<a class="addr" href="${esc(mapUrl(c))}" target="_blank" rel="noopener">${esc(addrOf(c))}</a>` : '';
const priB = p => p && p !== 'normal' ? `<span class="b p-${esc(p)}">${esc(PRI[p] || p)}</span>` : '';
const isOffice = () => !!me.office;
const officeView = () => isOffice() && DrPool.getView() === 'office';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
const errMsg = e => {
  const m = (e && (e.message || e.details)) || String(e);
  if (/row-level security|permission denied|42501/i.test(m + (e && e.code))) return "You don't have permission to do that.";
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Could not reach the server. Check your connection.';
  return m;
};
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }

let toastT;
function toast(text, undo) {
  const t = $('#toast'); clearTimeout(toastT);
  t.innerHTML = `<span></span>${undo ? '<button type="button">Undo</button>' : ''}`;
  t.firstChild.textContent = text; t.classList.add('on');
  if (undo) t.querySelector('button').onclick = () => { t.classList.remove('on'); undo(); };
  toastT = setTimeout(() => t.classList.remove('on'), undo ? 6000 : 3000);
}

/* ---------- reference data ---------- */
let STAFF = [];
async function loadStaff() {
  try {
    const rows = await q(sb.from('staff').select('id,display_name,active').eq('active', true));
    STAFF = rows.sort((a, b) => { const i = PEOPLE.indexOf(a.display_name), j = PEOPLE.indexOf(b.display_name); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.display_name.localeCompare(b.display_name); });
  } catch (e) { STAFF = []; }
}
const staffId = name => (STAFF.find(s => s.display_name === name) || {}).id || null;
const assignees = () => [...STAFF.map(s => s.display_name), 'Office'];
const whoOpts = cur => assignees().map(n => `<option${n === cur ? ' selected' : ''}>${esc(n)}</option>`).join('');

/* ---------- data access ---------- */
const CUST_MIN = 'id,name,address,city,account_no,community,status';
const TASK_SEL = `id,job_id,customer_id,type,assignee,assignee_staff_id,note,done,due_at,done_at,messages,priority,tags,created_by,created_at,
  customer:customers!tasks_customer_id_fkey(${CUST_MIN}),
  job:jobs!tasks_job_id_fkey(id,title,kind,open,priority,customer_id,customer:customers!jobs_customer_id_fkey(${CUST_MIN}))`.replace(/\s+/g, '');

async function loadOpenTasks() {
  let qy = sb.from('tasks').select(TASK_SEL).eq('workspace', WS).eq('done', false);
  if (!officeView()) {
    const names = ['"' + me.name.replace(/"/g, '') + '"'];
    if (isOffice()) names.push('"Office"');
    qy = qy.or(`assignee.in.(${names.join(',')}),assignee_staff_id.eq.${me.id}`);
  }
  return q(qy.order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true }).limit(500));
}
const taskCust = t => t.customer || (t.job && t.job.customer) || null;

async function setDone(t, done) {
  await q(sb.from('tasks').update({ done, done_at: done ? new Date().toISOString() : null }).eq('id', t.id));
}
async function addNote(taskId, text) {
  const row = await q(sb.from('tasks').select('messages').eq('id', taskId).single());
  const msgs = Array.isArray(row.messages) ? row.messages : [];
  msgs.push({ at: new Date().toISOString(), by: me.name, text });
  await q(sb.from('tasks').update({ messages: msgs }).eq('id', taskId));
}

/* ---------- routing ---------- */
const S = { who: '', type: '', jf: 'open', jk: '', cq: '', taskCount: null };
let dirty = false, rendering = false;
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { v: parts[0] || 'tasks', id: parts[1] ? decodeURIComponent(parts[1]) : null, qs: new URLSearchParams(qs || '') };
}
function tabs() {
  const r = parseHash(), cur = r.v === 'c' ? 'customers' : r.v === 'j' || r.v === 'new' ? 'jobs' : r.v;
  const n = S.taskCount;
  const L = [['tasks', officeView() ? 'Team tasks' : 'My tasks'], ['customers', 'Customers'], ['jobs', isOffice() ? 'Jobs' : 'My jobs']];
  $('#tabs').innerHTML = L.map(([k, l]) => `<a href="#/${k}" class="${cur === k ? 'on' : ''}"${cur === k ? ' aria-current="page"' : ''}>${l}${k === 'tasks' && n ? `<i>${n}</i>` : ''}</a>`).join('');
  $('#hsub').textContent = officeView() ? 'Office view: everything in motion' : me.name;
}
async function route(opts = {}) {
  if (rendering) return; rendering = true;
  const r = parseHash();
  tabs();
  try {
    if (r.v === 'tasks') await viewTasks();
    else if (r.v === 'customers') await viewCustomers();
    else if (r.v === 'c' && r.id) await viewCustomer(r.id);
    else if (r.v === 'jobs') await viewJobs();
    else if (r.v === 'j' && r.id) await viewJob(r.id);
    else if (r.v === 'new') await viewNewJob(r.qs.get('c'));
    else { location.hash = '#/tasks'; }
  } catch (e) {
    main.innerHTML = `<p class="err">Could not load this page. ${esc(errMsg(e))}</p><button class="btn o" type="button" data-a="retry">Try again</button>`;
  }
  dirty = false; rendering = false;
  if (!opts.keepScroll) window.scrollTo(0, 0);
  tabs();
}
const refresh = () => route({ keepScroll: true });
window.addEventListener('hashchange', () => route());
document.addEventListener('drpool:view', () => { S.who = ''; route({ keepScroll: true }); });
main.addEventListener('input', e => { if (e.target.matches('input,textarea,select') && !e.target.closest('.search')) dirty = true; });

/* ---------- task card ---------- */
function taskCard(t, opts = {}) {
  const c = taskCust(t), j = t.job, overdue = t.due_at && dayKey(t.due_at) < today();
  const msgs = Array.isArray(t.messages) ? t.messages : [];
  const canAct = isOffice() || t.assignee === me.name || t.assignee_staff_id === me.id;
  return `<article class="tk p-${esc(t.priority || 'normal')}${overdue ? ' over' : ''}" data-task="${esc(t.id)}">
  <div style="min-width:0">
    <div class="ln"><span class="ty">${esc(T[t.type] || t.type)}</span>${priB(t.priority)}${j && j.kind === 'renovation' ? '<span class="b reno">Renovation</span>' : ''}</div>
    ${c ? `<div class="ln"><b>${esc(c.name)}</b>${c.account_no ? `<span class="sub">#${esc(c.account_no)}</span>` : ''}</div><div class="ln">${mapLink(c)}</div>` : ''}
    ${j ? `<div class="ln"><a href="#/j/${esc(j.id)}">${esc(j.title)}</a>${j.open ? '' : '<span class="b ok">Job closed</span>'}</div>` : ''}
    ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
    ${(t.tags || []).length ? `<div class="ln">${t.tags.map(g => `<span class="tag">${esc(g)}</span>`).join('')}</div>` : ''}
    ${msgs.length ? `<div class="msgs">${msgs.slice(-3).map(m => `<div class="msg">${esc(m.text)}<span class="sub">${esc(m.by || '')} · ${m.at ? esc(fmtAt(m.at)) : ''}</span></div>`).join('')}${msgs.length > 3 ? `<span class="sub">${msgs.length - 3} earlier notes on the job page</span>` : ''}</div>` : ''}
    ${canAct ? `<div class="acts"><button type="button" class="btn o sm" data-a="note" data-x="${esc(t.id)}">Add note</button></div><div class="notebox" hidden></div>` : ''}
  </div>
  <div class="side">
    <div><span class="who">${esc(t.assignee || 'Unassigned')}</span>
      <div class="sub">${t.due_at ? (overdue ? 'Was due ' : 'Due ') + esc(fmtDay(t.due_at)) : 'No due date'}</div></div>
    ${canAct ? `<button type="button" class="chk${t.done ? ' done' : ''}" data-a="done" data-x="${esc(t.id)}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(T[t.type] || t.type)}${c ? ' for ' + esc(c.name) : ''}">${ICON_CHECK}</button>` : ''}
  </div></article>`;
}

/* ---------- My tasks / Team tasks ---------- */
let TASKS = [];
async function viewTasks() {
  const all = await loadOpenTasks();
  TASKS = all;
  S.taskCount = all.filter(t => officeView() ? true : (t.assignee === me.name || t.assignee_staff_id === me.id || t.assignee === 'Office')).length;
  const ov = officeView();
  let list = all;
  if (ov && S.who) list = list.filter(t => t.assignee === S.who);
  if (S.type) list = list.filter(t => t.type === S.type);
  const td = today(), G = { over: [], today: [], up: [], none: [] };
  for (const t of list) {
    if (!t.due_at) G.none.push(t);
    else { const k = dayKey(t.due_at); (k < td ? G.over : k === td ? G.today : G.up).push(t); }
  }
  const prRank = { urgent: 0, high: 1, normal: 2, low: 3 };
  G.none.sort((a, b) => (prRank[a.priority] ?? 2) - (prRank[b.priority] ?? 2) || (a.created_at < b.created_at ? -1 : 1));
  const cnt = (arr, f) => arr.filter(f).length;
  const people = ov ? [...new Set([...PEOPLE.filter(p => assignees().includes(p) || p === 'Office'), ...all.map(t => t.assignee).filter(Boolean)])] : [];
  const types = [...new Set(all.map(t => t.type))];
  const chips = (ov ? `<div class="chips" role="group" aria-label="Filter by person"><button class="chip ${S.who ? '' : 'on'}" data-a="who" data-x="">Everyone<i>${all.length}</i></button>${people.map(p => `<button class="chip ${S.who === p ? 'on' : ''}" data-a="who" data-x="${esc(p)}">${esc(p)}<i>${cnt(all, t => t.assignee === p)}</i></button>`).join('')}</div>` : '')
    + (types.length > 1 ? `<div class="chips" role="group" aria-label="Filter by step"><button class="chip ${S.type ? '' : 'on'}" data-a="type" data-x="">All steps</button>${types.map(k => `<button class="chip ${S.type === k ? 'on' : ''}" data-a="type" data-x="${esc(k)}">${esc(T[k] || k)}</button>`).join('')}</div>` : '');
  const sec = (key, title, arr) => arr.length ? `<div class="grp ${key}"><h2>${title}</h2><span class="n">${arr.length}</span></div>${arr.map(t => taskCard(t)).join('')}` : '';
  const head = ov
    ? `<div class="jh" style="justify-content:space-between"><h2>Everything in motion</h2><span class="live${LIVE ? ' on' : ''}">${LIVE ? 'Live' : 'Refreshes every minute'}</span></div><p class="sub">All open team tasks. Switch to "Just mine" in the top bar to see only yours.</p>`
    : `<div class="jh" style="justify-content:space-between"><h2>Hi ${esc(me.name)}</h2><span class="live${LIVE ? ' on' : ''}">${LIVE ? 'Live' : 'Refreshes every minute'}</span></div><p class="sub">${isOffice() ? 'Your open tasks, plus tasks for the Office.' : 'Your open tasks. Tap the circle when one is done.'}</p>`;
  const body = sec('over', 'Overdue', G.over) + sec('today', 'Today', G.today) + sec('up', 'Upcoming', G.up) + sec('none', 'No date', G.none);
  main.innerHTML = head + `<div style="margin-top:12px">${chips}</div>` + (body || `<div class="empty"><b>${all.length ? 'Nothing matches these filters.' : 'No open tasks.'}</b>${all.length ? 'Clear a filter to see more.' : isOffice() ? 'Open a customer and start a job to hand out work.' : 'New work from the office shows up here.'}</div>`);
}

/* ---------- Customers ---------- */
const clean = s => String(s || '').replace(/[%*,()"\\:]/g, ' ').trim();
async function searchCustomers(term) {
  const t = clean(term);
  if (!t) return [];
  const words = t.split(/\s+/).filter(Boolean).slice(0, 4);
  let qy = sb.from('customers').select(CUST_MIN + ',phone');
  for (const w of words) qy = qy.or(['name', 'address', 'account_no', 'community', 'city'].map(f => `${f}.ilike.*${w}*`).join(','));
  const rows = await q(qy.order('name').limit(120));
  const rank = { active: 0, suspended: 1, lead: 2, canceled: 3 };
  return rows.sort((a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || a.name.localeCompare(b.name)).slice(0, 50);
}
const statusB = s => s && s !== 'active' ? `<span class="b ${s === 'canceled' ? 'no' : 'wait'}">${esc(s[0].toUpperCase() + s.slice(1))}</span>` : '';
function custRow(c) {
  return `<a class="row" href="#/c/${esc(c.id)}"><div><b>${esc(c.name)}</b> ${statusB(c.status)}<div class="sub m">${c.account_no ? `<span>#${esc(c.account_no)}</span>` : ''}<span>${esc(addrOf(c))}</span>${c.community ? `<span>${esc(c.community)}</span>` : ''}</div></div></a>`;
}
let searchT, searchSeq = 0;
async function runSearch() {
  const box = $('#cres'); if (!box) return;
  const term = S.cq, seq = ++searchSeq;
  if (!clean(term)) { box.innerHTML = `<div class="empty"><b>Find a customer</b>Search by name, street, account number or community.</div>`; return; }
  box.innerHTML = '<p class="sub">Searching…</p>';
  try {
    const rows = await searchCustomers(term);
    if (seq !== searchSeq) return;
    box.innerHTML = rows.length ? rows.map(custRow).join('') + (rows.length >= 50 ? '<p class="sub">Showing the first 50. Keep typing to narrow it.</p>' : '') : `<div class="empty"><b>No customers match "${esc(term)}".</b>Try part of the street name or the account number.</div>`;
  } catch (e) { if (seq === searchSeq) box.innerHTML = `<p class="err">Search failed. ${esc(errMsg(e))}</p>`; }
}
async function viewCustomers() {
  main.innerHTML = `<div class="search">${ICON_SEARCH}<input id="cq" type="search" placeholder="Name, address, account # or community" aria-label="Search customers" autocomplete="off" value="${esc(S.cq)}"></div><div id="cres"></div>`;
  const inp = $('#cq');
  inp.oninput = () => { S.cq = inp.value; clearTimeout(searchT); searchT = setTimeout(runSearch, 250); };
  if (!matchMedia('(hover:none)').matches) inp.focus();
  await runSearch();
}

async function latestWeek() {
  const r = await q(sb.from('route_stops').select('week_of').order('week_of', { ascending: false }).limit(1));
  return r[0] ? r[0].week_of : null;
}
const DAYS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const JOB_SEL = `id,title,kind,open,priority,created_at,created_by,customer_id,tasks:tasks!tasks_job_id_fkey(id,type,assignee,done,due_at)`;
function jobRow(j, showCust) {
  const open = (j.tasks || []).filter(t => !t.done);
  const c = j.customer;
  return `<a class="row" href="#/j/${esc(j.id)}"><div><b>${esc(showCust && c ? c.name : j.title)}</b> ${j.kind === 'renovation' ? '<span class="b reno">Renovation</span>' : ''} ${priB(j.priority)}
    <div class="sub">${showCust ? esc(j.title) + (c && addrOf(c) ? ' · ' + esc(addrOf(c)) : '') : esc(KINDS[j.kind] || j.kind || '')}</div>
    <div class="sub">${open.length ? 'Next: ' + open.slice(0, 3).map(t => esc(T[t.type] || t.type) + ' (' + esc(t.assignee || '?') + ')').join(', ') : 'No open tasks'}</div></div>
    <div class="rt"><span class="b ${j.open ? 'wait' : 'ok'}">${j.open ? 'Open' : 'Closed'}</span><div class="sub">${esc(new Date(j.created_at).toLocaleDateString())}</div></div></a>`;
}
async function viewCustomer(id) {
  const office = isOffice();
  const [c, wk] = await Promise.all([q(sb.from('customers').select('*').eq('id', id).maybeSingle()), latestWeek().catch(() => null)]);
  if (!c) { main.innerHTML = `<a class="back" href="#/customers">Back to customers</a><div class="empty"><b>Customer not found.</b>It may have been removed.</div>`; return; }
  const jobs = q(sb.from('jobs').select(JOB_SEL).eq('workspace', WS).eq('customer_id', id).order('open', { ascending: false }).order('created_at', { ascending: false })).catch(() => null);
  const stops = wk ? q(sb.from('route_stops').select('day,slot,route_no,label,price,service_code,flag,tech:technicians!route_stops_technician_id_fkey(name)').eq('customer_id', id).eq('week_of', wk).order('day')).catch(() => null) : Promise.resolve([]);
  const bills = office ? q(sb.from('billing_months').select('period,amount,service,pool_info').eq('customer_id', id).order('period', { ascending: false }).limit(12)).catch(() => null) : Promise.resolve(null);
  const evs = office ? q(sb.from('account_events').select('kind,period,event_date,amount,service,reason,tech,name').eq('customer_id', id).order('event_date', { ascending: false, nullsFirst: false }).limit(40)).catch(() => null) : Promise.resolve(null);
  const [J, R, B, E] = await Promise.all([jobs, stops, bills, evs]);
  const kv = [['Account #', c.account_no], ['Service', [c.service_level, c.customer_type === 'commercial' ? 'Commercial' : ''].filter(Boolean).join(' · ')], ['Monthly', office && c.monthly_rate != null ? $$(c.monthly_rate) : ''], ['Pool', c.pool_info], ['Community', [c.community, c.subdivision].filter(Boolean).join(' · ')], ['Phone', c.phone ? `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>` : '', true], ['Email', c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '', true], ['Started', c.start_date ? new Date(c.start_date + 'T12:00').toLocaleDateString() : ''], ['Canceled', c.cancel_date ? new Date(c.cancel_date + 'T12:00').toLocaleDateString() + (c.cancel_reason ? ' · ' + c.cancel_reason : '') : ''], ['Suspended', c.suspend_reason]].filter(x => x[1]);
  const evName = { new: 'New account', cancel: 'Canceled', suspend: 'Suspended', raise: 'Price raise', price_down: 'Price lowered', name_change: 'Name change', transfer: 'Transfer', note: 'Note' };
  main.innerHTML = `<a class="back" href="#/customers">Back to customers</a>
  <div class="jh"><h2>${esc(c.name)}</h2>${statusB(c.status)}</div>
  <div class="m" style="margin:4px 0 10px">${mapLink(c)}</div>
  ${office ? `<div class="row-a"><a class="btn" href="#/new?c=${esc(c.id)}">Start a job</a></div>` : ''}
  ${c.notes ? `<div class="gate"><b>Notes and gate codes</b><br>${esc(c.notes)}</div>` : ''}
  ${kv.length ? `<h3>Details</h3><dl class="kv">${kv.map(([k, v, html]) => `<dt>${k}</dt><dd>${html ? v : esc(v)}</dd>`).join('')}</dl>` : ''}
  <h3>This week's route${wk ? ` <span class="sub">(week of ${esc(new Date(wk + 'T12:00').toLocaleDateString([], { month: 'short', day: 'numeric' }))})</span>` : ''}</h3>
  ${R === null ? '<p class="sub">Route could not be loaded.</p>' : R.length ? `<table class="tbl"><tr><th>Day</th><th>Tech</th><th>Route</th><th>Note</th></tr>${R.sort((a, b) => Object.keys(DAYS).indexOf(a.day) - Object.keys(DAYS).indexOf(b.day)).map(s => `<tr><td>${esc(DAYS[s.day] || s.day)}</td><td>${esc(s.tech ? s.tech.name : '')}</td><td>#${esc(s.route_no)} · stop ${esc(s.slot)}</td><td>${esc([s.service_code, s.flag && s.flag.replace('_', ' ')].filter(Boolean).join(' · '))}</td></tr>`).join('')}</table>` : '<p class="sub">Not on this week\'s route.</p>'}
  <h3>Jobs</h3>
  ${J === null ? '<p class="sub">Jobs could not be loaded.</p>' : J.length ? J.map(j => jobRow(j, false)).join('') : `<p class="sub">${office ? 'No team jobs for this account yet.' : 'None of your jobs are on this account.'}</p>`}
  ${office ? `<h3>Billing, last 12 months</h3>${B === null ? '<p class="sub">Billing could not be loaded.</p>' : B.length ? `<table class="tbl"><tr><th>Month</th><th>Service</th><th class="n">Amount</th></tr>${B.map(b => `<tr><td>${esc(fmtMonth(b.period))}</td><td>${esc(b.service || '')}</td><td class="n">${b.amount != null ? $$(b.amount) : ''}</td></tr>`).join('')}</table>` : '<p class="sub">No billing history.</p>'}
  <h3>Account history</h3>${E === null ? '<p class="sub">History could not be loaded.</p>' : E.length ? `<table class="tbl">${E.map(e => `<tr><td style="white-space:nowrap">${esc(e.event_date ? new Date(e.event_date + 'T12:00').toLocaleDateString() : e.period ? fmtMonth(e.period) : '')}</td><td><b>${esc(evName[e.kind] || e.kind)}</b>${e.reason ? ' · ' + esc(e.reason) : ''}${e.service ? ' · ' + esc(e.service) : ''}${e.tech ? ' · ' + esc(e.tech) : ''}</td><td class="n">${e.amount != null ? $$(e.amount) : ''}</td></tr>`).join('')}</table>` : '<p class="sub">No account events.</p>'}` : ''}`;
}

/* ---------- Jobs ---------- */
async function viewJobs() {
  const office = isOffice();
  let qy = sb.from('jobs').select(JOB_SEL + `,customer:customers!jobs_customer_id_fkey(${CUST_MIN})`).eq('workspace', WS);
  if (S.jf === 'open') qy = qy.eq('open', true); else if (S.jf === 'closed') qy = qy.eq('open', false);
  if (S.jk) qy = qy.eq('kind', S.jk);
  const rows = await q(qy.order('created_at', { ascending: false }).limit(300));
  const f = (k, l) => `<button class="chip ${S.jf === k ? 'on' : ''}" data-a="jf" data-x="${k}">${l}</button>`;
  main.innerHTML = `<div class="jh" style="justify-content:space-between"><h2>${office ? 'Jobs' : 'Jobs with your tasks'}</h2>${office ? '<a class="btn" href="#/new">New job</a>' : ''}</div>
  <div class="chips" style="margin-top:12px">${f('open', 'Open')}${f('closed', 'Closed')}${f('all', 'All')}</div>
  <div class="chips"><button class="chip ${S.jk ? '' : 'on'}" data-a="jk" data-x="">All kinds</button>${Object.keys(KINDS).map(k => `<button class="chip ${S.jk === k ? 'on' : ''}" data-a="jk" data-x="${k}">${KINDS[k]}</button>`).join('')}</div>
  ${rows.length ? rows.map(j => jobRow(j, true)).join('') : `<div class="empty"><b>No ${S.jf === 'all' ? '' : S.jf + ' '}jobs${S.jk ? ' of this kind' : ''}.</b>${office ? 'Find a customer and press Start a job, or press New job.' : 'Jobs show up here when the office gives you a task on them.'}</div>`}`;
}

function taskForm(prefix) {
  const t = new Date(); t.setDate(t.getDate() + 1);
  return `<div class="fg">
    <label>Step<select name="type">${Object.keys(T).map(k => `<option value="${k}">${T[k]}</option>`).join('')}</select></label>
    <label>Assign to<select name="assignee">${whoOpts('Office')}</select></label>
    <label>Due<input type="date" name="due"></label>
    <label>Priority<select name="priority">${Object.keys(PRI).map(k => `<option value="${k}"${k === 'normal' ? ' selected' : ''}>${PRI[k]}</option>`).join('')}</select></label>
    <label class="w2">Note<textarea name="note" rows="2" placeholder="What exactly needs doing"></textarea></label>
    <label class="w2">Tags<input name="tags" placeholder="Comma separated, e.g. heater, warranty"></label></div>`;
}
const dueISO = v => v ? new Date(v + 'T17:00').toISOString() : null;
function taskFromForm(f, job) {
  const g = n => (f.elements[n] ? f.elements[n].value : '').trim();
  const who = g('assignee') || 'Office';
  return { workspace: WS, job_id: job.id, customer_id: job.customer_id, type: g('type') || 'other', assignee: who, assignee_staff_id: who === 'Office' ? null : staffId(who),
    due_at: dueISO(g('due')), priority: g('priority') || 'normal', note: g('note') || null, tags: g('tags').split(',').map(s => s.trim()).filter(Boolean),
    created_by: me.name, source: 'manual', done: false, messages: [] };
}

async function viewNewJob(cid) {
  if (!isOffice()) { main.innerHTML = '<div class="empty"><b>Only the office can start jobs.</b></div>'; return; }
  let c = cid ? await q(sb.from('customers').select(CUST_MIN).eq('id', cid).maybeSingle()) : null;
  main.innerHTML = `<a class="back" href="${c ? '#/c/' + esc(c.id) : '#/jobs'}">Back</a><h2>New job</h2>
  <form id="nj" class="panel" autocomplete="off">
    <div id="pick">${c ? `<div class="jh"><b>${esc(c.name)}</b><span class="sub">${esc(addrOf(c))}</span><button type="button" class="btn o sm" data-a="repick">Change</button></div><input type="hidden" name="cid" value="${esc(c.id)}">`
      : `<label>Customer<input id="pq" type="search" placeholder="Search name, address or account #"></label><div id="pres"></div>`}</div>
    <div class="fg">
      <label class="w2">Job title<input name="title" required maxlength="120" placeholder="e.g. Heater not firing"></label>
      <label>Kind<select name="kind">${Object.keys(KINDS).map(k => `<option value="${k}">${KINDS[k]}</option>`).join('')}</select></label>
      <label>Priority<select name="jpriority">${Object.keys(PRI).map(k => `<option value="${k}"${k === 'normal' ? ' selected' : ''}>${PRI[k]}</option>`).join('')}</select></label>
    </div>
    <b>First task</b>${taskForm()}
    <div class="row-a"><button class="btn" type="submit">Create job</button><span class="sub" id="njmsg"></span></div>
  </form>`;
  const pq = $('#pq');
  if (pq) {
    let st;
    pq.oninput = () => { clearTimeout(st); st = setTimeout(async () => {
      const box = $('#pres'); if (!box) return;
      try { const rows = await searchCustomers(pq.value); box.innerHTML = rows.slice(0, 8).map(r => `<button type="button" class="row" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line);text-align:left;font:inherit" data-a="pick" data-x="${esc(r.id)}"><div><b>${esc(r.name)}</b> ${statusB(r.status)}<div class="sub">${esc(addrOf(r))}${r.account_no ? ' · #' + esc(r.account_no) : ''}</div></div></button>`).join('') || (clean(pq.value) ? '<p class="sub">No match.</p>' : ''); }
      catch (e) { box.innerHTML = `<p class="err">${esc(errMsg(e))}</p>`; }
    }, 250); };
  }
  $('#nj').onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target, msg = $('#njmsg'), cidv = f.elements.cid && f.elements.cid.value;
    if (!cidv) { msg.textContent = 'Pick a customer first.'; return; }
    const title = f.elements.title.value.trim(); if (!title) { msg.textContent = 'Add a job title.'; return; }
    const btn = f.querySelector('[type=submit]'); btn.disabled = true; msg.textContent = 'Saving…';
    try {
      const job = await q(sb.from('jobs').insert({ workspace: WS, customer_id: cidv, title, kind: f.elements.kind.value, priority: f.elements.jpriority.value, open: true, created_by: me.name }).select('id,customer_id').single());
      try { await q(sb.from('tasks').insert(taskFromForm(f, job))); } catch (e) { toast('Job created, but the task failed: ' + errMsg(e)); }
      dirty = false; location.hash = '#/j/' + job.id;
    } catch (e) { msg.textContent = errMsg(e); btn.disabled = false; }
  };
}

async function viewJob(id) {
  const office = isOffice();
  const j = await q(sb.from('jobs').select(`*,customer:customers!jobs_customer_id_fkey(*)`).eq('id', id).eq('workspace', WS).maybeSingle());
  if (!j) { main.innerHTML = `<a class="back" href="#/jobs">Back to jobs</a><div class="empty"><b>This job isn't available.</b>It may be closed to you or removed.</div>`; return; }
  const c = j.customer;
  const [tasks, docs, pays, ups] = await Promise.all([
    q(sb.from('tasks').select('*').eq('job_id', id).eq('workspace', WS).order('created_at')),
    office ? q(sb.from('documents').select('*').eq('job_id', id).eq('workspace', WS).order('created_at')).catch(() => null) : null,
    office ? q(sb.from('payments').select('*').eq('job_id', id).eq('workspace', WS).order('received_on')).catch(() => null) : null,
    j.kind === 'renovation' ? q(sb.from('renovation_updates').select('*').eq('job_id', id).eq('workspace', WS).order('created_at', { ascending: false })).catch(() => null) : null
  ]);
  const canTask = t => office || t.assignee === me.name || t.assignee_staff_id === me.id;
  const step = t => {
    const msgs = Array.isArray(t.messages) ? t.messages : [];
    return `<div class="st${t.done ? ' d' : ''}" data-task="${esc(t.id)}"><div class="jh"><span class="ty"><b>${esc(T[t.type] || t.type)}</b></span><span class="b">${esc(t.assignee || 'Unassigned')}</span>${priB(t.priority)}
      <span class="sub">${t.done ? 'Done ' + (t.done_at ? esc(fmtAt(t.done_at)) : '') : t.due_at ? 'Due ' + esc(fmtDay(t.due_at)) : ''}</span></div>
      ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
      ${(t.tags || []).length ? `<div class="m">${t.tags.map(g => `<span class="tag">${esc(g)}</span>`).join('')}</div>` : ''}
      ${msgs.length ? `<div class="msgs">${msgs.map(m => `<div class="msg">${esc(m.text)}<span class="sub">${esc(m.by || '')} · ${m.at ? esc(fmtAt(m.at)) : ''}</span></div>`).join('')}</div>` : ''}
      ${t.created_by ? `<div class="sub">Added by ${esc(t.created_by)}</div>` : ''}
      ${canTask(t) ? `<div class="row-a" style="margin-top:6px"><button type="button" class="btn sm${t.done ? ' o' : ''}" data-a="done" data-x="${esc(t.id)}">${t.done ? 'Reopen' : 'Mark done'}</button><button type="button" class="btn o sm" data-a="note" data-x="${esc(t.id)}">Add note</button>
        ${office && !t.done ? `<label class="sub" style="display:flex;gap:6px;align-items:center">Reassign<select data-a="reassign" data-x="${esc(t.id)}" style="width:auto;min-height:36px;padding:4px 8px">${whoOpts(t.assignee)}</select></label>` : ''}</div><div class="notebox" hidden></div>` : ''}
    </div>`;
  };
  const open = tasks.filter(t => !t.done).length;
  let money = '';
  if (office) {
    const inv = (docs || []).filter(d => d.kind === 'Invoice' && d.amount != null), est = (docs || []).filter(d => d.kind === 'Estimate' && d.status === 'Approved' && d.amount != null);
    const total = j.total != null ? +j.total : (inv.length ? inv : est).reduce((a, d) => a + +d.amount, 0);
    const paid = (pays || []).reduce((a, p) => a + +p.amount, 0);
    money = `<h3>Documents</h3>
    ${docs === null ? '<p class="sub">Documents could not be loaded.</p>' : docs.length ? docs.map(d => `<div class="doc"><b>${esc(d.kind)}</b><span>${esc(d.number || '')}${d.description ? ` <span class="sub">${esc(d.description)}</span>` : ''}</span><span class="money">${d.amount != null ? $$(d.amount) : ''}</span>
      <select data-a="docst" data-x="${esc(d.id)}" aria-label="Status of ${esc(d.kind)} ${esc(d.number || '')}">${(DOCST[d.kind] || ['Draft']).map(s => `<option${s === d.status ? ' selected' : ''}>${s}</option>`).join('')}</select></div>`).join('') : '<p class="sub">No documents yet.</p>'}
    <details class="add"><summary class="btn o">Add a document</summary><form id="docf" class="panel"><div class="fg"><label>Kind<select name="kind">${Object.keys(DOCST).map(k => `<option>${k}</option>`).join('')}</select></label>
      <label>Number<input name="number" placeholder="e.g. 4512"></label><label>Amount<input name="amount" inputmode="decimal" placeholder="$0.00"></label>
      <label>Status<select name="status">${DOCST.PO.concat(['Approved', 'Declined', 'Paid']).filter((v, i, a) => a.indexOf(v) === i).map(s => `<option>${s}</option>`).join('')}</select></label>
      <label class="w2">Description<input name="description" placeholder="Optional"></label></div>
      <div class="row-a"><button class="btn" type="submit">Add document</button><span class="sub" data-msg></span></div></form></details>
    <h3>Payments</h3>
    <div class="stats"><span><b class="money">${$$(Math.max(total - paid, 0))}</b> balance</span><span class="sub">${$$(paid)} paid of ${$$(total)}${total ? '' : ' (add an invoice or approved estimate to set the total)'}</span></div>
    ${pays === null ? '<p class="sub">Payments could not be loaded.</p>' : pays.length ? `<table class="tbl">${pays.map(p => `<tr><td>${esc(new Date(p.received_on + 'T12:00').toLocaleDateString())}</td><td>${esc(p.method || '')}${p.note ? ' · ' + esc(p.note) : ''}${p.recorded_by ? ` <span class="sub">by ${esc(p.recorded_by)}</span>` : ''}</td><td class="n">${$$(p.amount)}</td><td><button type="button" class="btn o sm" data-a="paydel" data-x="${esc(p.id)}">Remove</button></td></tr>`).join('')}</table>` : '<p class="sub">No payments recorded.</p>'}
    <details class="add"><summary class="btn o">Record a payment</summary><form id="payf" class="panel"><div class="fg"><label>Amount<input name="amount" inputmode="decimal" required placeholder="$0.00"></label><label>Received<input type="date" name="received_on" value="${today()}"></label>
      <label>Method<select name="method">${PM.map(m => `<option>${m}</option>`).join('')}</select></label><label>Note<input name="note" placeholder="Check #, who paid"></label></div>
      <div class="row-a"><button class="btn" type="submit">Record payment</button><span class="sub" data-msg></span></div></form></details>`;
  }
  let reno = '';
  if (j.kind === 'renovation') {
    reno = `<h3>Renovation updates</h3>
    <form id="renof" class="panel"><div class="fg"><label>Stage<input name="stage" list="stages" placeholder="e.g. Tile"></label><label class="w2">Update<textarea name="note" rows="2" required placeholder="What happened today, what's next"></textarea></label></div>
      <div class="row-a"><button class="btn" type="submit">Post update</button><span class="sub" data-msg></span></div></form>
    <datalist id="stages">${STAGES.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
    ${ups === null ? '<p class="sub">Updates could not be loaded.</p>' : ups.length ? ups.map(u => `<div class="ru">${u.stage ? `<b>${esc(u.stage)}</b> · ` : ''}${esc(u.note || '')}<div class="sub">${esc(u.by_name || '')} · ${esc(fmtAt(u.created_at))}</div></div>`).join('') : '<p class="sub">No updates yet.</p>'}
    ${!office ? '<p class="sub">You see the updates you posted. The office sees everyone\'s.</p>' : ''}`;
  }
  main.innerHTML = `<a class="back" href="#/jobs">Back to jobs</a>
  <div class="jh"><h2>${esc(j.title)}</h2><span class="b ${j.open ? 'wait' : 'ok'}">${j.open ? 'Open' : 'Closed'}</span>${j.kind === 'renovation' ? '<span class="b reno">Renovation</span>' : `<span class="b">${esc(KINDS[j.kind] || j.kind || '')}</span>`}${priB(j.priority)}</div>
  ${c ? `<div class="sub m" style="margin-top:4px"><a href="#/c/${esc(c.id)}"><b>${esc(c.name)}</b></a>${c.account_no ? `<span>#${esc(c.account_no)}</span>` : ''}${mapLink(c)}${c.phone ? `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>` : ''}</div>${c.notes ? `<div class="gate">${esc(c.notes)}</div>` : ''}` : '<p class="sub">No customer linked.</p>'}
  <div class="sub" style="margin-top:6px">Started ${esc(new Date(j.created_at).toLocaleDateString())}${j.created_by ? ' by ' + esc(j.created_by) : ''}</div>
  ${office ? `<div class="row-a" style="margin-top:10px">${j.open ? `<button type="button" class="btn o" data-a="jopen" data-x="0">Close job${open ? ` (${open} open)` : ''}</button>` : '<button type="button" class="btn o" data-a="jopen" data-x="1">Reopen job</button>'}</div>` : ''}
  <h3>Steps</h3>
  ${tasks.length ? `<div class="tl">${tasks.map(step).join('')}</div>` : '<p class="sub">No tasks yet.</p>'}
  ${office ? `<details class="add"${tasks.length ? '' : ' open'}><summary class="btn">Add a task</summary><form id="addt" class="panel">${taskForm()}<div class="row-a"><button class="btn" type="submit">Add task</button><span class="sub" data-msg></span></div></form></details>` : ''}
  ${reno}${money}`;
  main.dataset.job = j.id;
  const wire = (fid, fn) => { const f = $('#' + fid); if (f) f.onsubmit = async ev => {
    ev.preventDefault(); const m = f.querySelector('[data-msg]'), b = f.querySelector('[type=submit]'); b.disabled = true; m.textContent = 'Saving…';
    try { await fn(f); dirty = false; await refresh(); } catch (e) { m.textContent = errMsg(e); b.disabled = false; }
  }; };
  const num = v => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, '')); return isNaN(n) ? null : Math.round(n * 100) / 100; };
  wire('addt', f => q(sb.from('tasks').insert(taskFromForm(f, j))).then(() => toast('Task added.')));
  wire('renof', f => { const note = f.elements.note.value.trim(); if (!note) throw new Error('Write the update first.');
    return q(sb.from('renovation_updates').insert({ workspace: WS, job_id: j.id, customer_id: j.customer_id, stage: f.elements.stage.value.trim() || null, note, by_name: me.name })).then(() => toast('Update posted.')); });
  wire('docf', f => { const k = f.elements.kind.value, st = f.elements.status.value;
    return q(sb.from('documents').insert({ workspace: WS, job_id: j.id, kind: k, number: f.elements.number.value.trim() || null, amount: num(f.elements.amount.value), status: (DOCST[k] || []).includes(st) ? st : 'Draft', description: f.elements.description.value.trim() || null })).then(() => toast(k + ' added.')); });
  wire('payf', f => { const a = num(f.elements.amount.value); if (!a) throw new Error('Enter the amount received.');
    return q(sb.from('payments').insert({ workspace: WS, job_id: j.id, customer_id: j.customer_id, amount: a, received_on: f.elements.received_on.value || today(), method: f.elements.method.value, note: f.elements.note.value.trim() || null, recorded_by: me.name })).then(() => toast('Payment recorded.')); });
}

/* ---------- clicks ---------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-a]'); if (!el || !main.contains(el)) return;
  const a = el.dataset.a, x = el.dataset.x;
  if (a === 'retry') return refresh();
  if (a === 'who') { S.who = x; return refresh(); }
  if (a === 'type') { S.type = x; return refresh(); }
  if (a === 'jf') { S.jf = x; return refresh(); }
  if (a === 'jk') { S.jk = x; return refresh(); }
  if (a === 'done') {
    const card = el.closest('[data-task]'); const wasDone = el.classList.contains('done') || /Reopen/.test(el.textContent);
    el.disabled = true;
    try {
      await setDone({ id: x }, !wasDone);
      if (!wasDone && card && card.classList.contains('tk')) { el.classList.add('done'); card.style.opacity = '.45'; }
      toast(wasDone ? 'Task reopened.' : 'Marked done.', wasDone ? null : async () => { try { await setDone({ id: x }, false); toast('Task reopened.'); refresh(); } catch (err) { toast(errMsg(err)); } });
      setTimeout(refresh, card && card.classList.contains('tk') ? 600 : 0);
    } catch (err) { el.disabled = false; toast(errMsg(err)); }
    return;
  }
  if (a === 'note') {
    const box = el.closest('[data-task]').querySelector('.notebox'); if (!box) return;
    if (!box.hidden) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<textarea rows="2" aria-label="Note" placeholder="Add a note for the team"></textarea><div class="row-a"><button type="button" class="btn sm" data-a="notego" data-x="${esc(x)}">Save note</button><button type="button" class="btn o sm" data-a="note" data-x="${esc(x)}">Cancel</button></div>`;
    box.querySelector('textarea').focus(); return;
  }
  if (a === 'notego') {
    const box = el.closest('.notebox'), text = box.querySelector('textarea').value.trim();
    if (!text) { box.querySelector('textarea').focus(); return; }
    el.disabled = true;
    try { await addNote(x, text); dirty = false; toast('Note saved.'); refresh(); } catch (err) { el.disabled = false; toast(errMsg(err)); }
    return;
  }
  if (a === 'jopen') {
    const id = main.dataset.job; el.disabled = true;
    try { await q(sb.from('jobs').update({ open: x === '1' }).eq('id', id)); toast(x === '1' ? 'Job reopened.' : 'Job closed.'); refresh(); } catch (err) { el.disabled = false; toast(errMsg(err)); }
    return;
  }
  if (a === 'paydel') {
    if (!confirm('Remove this payment?')) return;
    try { await q(sb.from('payments').delete().eq('id', x)); toast('Payment removed.'); refresh(); } catch (err) { toast(errMsg(err)); }
    return;
  }
  if (a === 'pick' || a === 'repick') {
    const pick = $('#pick');
    if (a === 'repick') { location.hash = '#/new'; return; }
    try { const c = await q(sb.from('customers').select(CUST_MIN).eq('id', x).single());
      pick.innerHTML = `<div class="jh"><b>${esc(c.name)}</b><span class="sub">${esc(addrOf(c))}</span><button type="button" class="btn o sm" data-a="repick">Change</button></div><input type="hidden" name="cid" value="${esc(c.id)}">`;
    } catch (err) { toast(errMsg(err)); }
  }
});
document.addEventListener('change', async e => {
  const el = e.target.closest('select[data-a]'); if (!el) return;
  const a = el.dataset.a, x = el.dataset.x;
  try {
    if (a === 'docst') { await q(sb.from('documents').update({ status: el.value }).eq('id', x)); toast('Status set to ' + el.value + '.'); }
    else if (a === 'reassign') { const w = el.value; await q(sb.from('tasks').update({ assignee: w, assignee_staff_id: w === 'Office' ? null : staffId(w) }).eq('id', x)); toast('Assigned to ' + w + '.'); }
    else return;
    dirty = false; refresh();
  } catch (err) { toast(errMsg(err)); refresh(); }
});

/* ---------- live-ish refresh ---------- */
let LIVE = false;
const busyTyping = () => { const a = document.activeElement; return dirty || (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && main.contains(a)) || [...main.querySelectorAll('.notebox')].some(b => !b.hidden); };
const autoRefresh = () => { if (document.visibilityState === 'visible' && !busyTyping() && parseHash().v !== 'customers' && parseHash().v !== 'new') refresh(); };
setInterval(autoRefresh, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoRefresh(); });
try {
  let rt;
  sb.channel('crm-tasks').on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => { clearTimeout(rt); rt = setTimeout(autoRefresh, 800); })
    .subscribe(st => { const was = LIVE; LIVE = st === 'SUBSCRIBED'; if (was !== LIVE) { const l = $('.live'); if (l) { l.classList.toggle('on', LIVE); l.textContent = LIVE ? 'Live' : 'Refreshes every minute'; } } });
} catch (e) { LIVE = false; }

await loadStaff();
if (!location.hash) history.replaceState(null, '', '#/tasks');
await route();
})();
