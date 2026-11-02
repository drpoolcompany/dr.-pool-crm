/* Dr. Pool staff apps — shared sign-in + helpers.
   Needs (before this file): https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js
   The publishable key is meant to be public; data is protected by row-level security in Supabase. */
(function () {
  const SUPABASE_URL = 'https://nulgnedluaydgkcqonoh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_hYJ-gUit_qv0jQEZZC7dhw_4Kjl65i6';
  const LOGIN_DOMAIN = 'drpool.us';                 // username "david" -> david@drpool.us
  const ALIASES = { juliana: 'juiana', geff: 'geffet' };  // usernames whose login email differs
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'drpool-auth' }
  });

  const toEmail = u => { u = String(u || '').trim().toLowerCase(); if (u.includes('@')) return u; return (ALIASES[u] || u) + '@' + LOGIN_DOMAIN; };
  const root = () => location.pathname.replace(/\/(crm|board)\/?(index\.html)?$/, '/').replace(/index\.html$/, '');

  let ME = null;
  async function loadMe() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const email = session.user.email.toLowerCase();
    const { data, error } = await sb.from('staff').select('id,username,display_name,role,office_access,technician_id,active').eq('email', email).maybeSingle();
    if (error || !data || !data.active) return { email, notStaff: true };
    ME = { ...data, email, name: data.display_name, office: !!data.office_access };
    return ME;
  }

  async function signIn(username, password) {
    const { error } = await sb.auth.signInWithPassword({ email: toEmail(username), password });
    if (error) throw new Error(/invalid/i.test(error.message) ? 'Wrong username or password.' : error.message);
    return loadMe();
  }
  async function signOut() { await sb.auth.signOut(); location.href = root(); }
  async function changePassword(pw) {
    if (!pw || pw.length < 6) throw new Error('Use at least 6 characters.');
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) throw new Error(error.message);
  }

  /* Call at the top of crm/ and board/: returns ME or redirects to the sign-in page. */
  async function requireLogin(opts = {}) {
    const me = await loadMe();
    if (!me || me.notStaff) { location.href = root() + '?next=' + encodeURIComponent(location.pathname); return null; }
    if (opts.office && !me.office) { location.href = root(); return null; }
    return me;
  }

  /* View switch: only the owner (Daniel) picks "Everything" or "Mine + Office"; remembered per device.
     Everyone else simply sees what the database returns for them ('all'). */
  const viewKey = 'drpool-view';
  const isOwner = () => !!(ME && ME.role === 'owner');
  function getView() {
    if (!isOwner()) return 'all';
    let v = 'all'; try { v = localStorage.getItem(viewKey) || 'all'; } catch (e) {}
    return v === 'mine' ? 'mine' : 'all';
  }
  function setView(v) { try { localStorage.setItem(viewKey, v === 'mine' ? 'mine' : 'all'); } catch (e) {} }

  /* Top bar shared by every page: app links, who is signed in, view switch, password, sign out. */
  function topBar(current) {
    const bar = document.createElement('nav');
    bar.id = 'drbar';
    bar.innerHTML = `<span class="lb">Dr. Pool</span>
      <a href="${root()}crm/" ${current === 'crm' ? 'aria-current="page"' : ''}>CRM</a>
      ${ME && ME.office ? `<a href="${root()}board/" ${current === 'board' ? 'aria-current="page"' : ''}>Chalkboard</a>` : ''}
      <span class="sp"></span>
      ${isOwner() ? `<label class="vw">View <select id="drview"><option value="all">Everything</option><option value="mine">Mine + Office</option></select></label>` : ''}
      <button type="button" id="drme" class="me"></button>`;
    const st = document.createElement('style');
    st.textContent = `#drbar{display:flex;gap:6px 16px;flex-wrap:wrap;align-items:center;padding:8px 16px;font:500 14px system-ui,-apple-system,sans-serif;background:#0b2d38;color:#e6f3f5}
#drbar a{color:#9fe3ee;text-decoration:none}#drbar a[aria-current]{color:#fff;font-weight:700}#drbar .lb{opacity:.65}
#drbar .sp{flex:1}#drbar .vw{display:inline-flex;gap:6px;align-items:center;color:inherit;font-size:13px;font-weight:500}#drbar select{width:auto;min-height:0;margin:0;font:inherit;background:#ffffff1a;color:#fff;border:1px solid #ffffff40;border-radius:6px;padding:2px 6px}
#drbar select option{color:#06303b}#drbar .me{font:inherit;background:none;border:1px solid #ffffff50;color:#fff;border-radius:99px;padding:3px 12px;cursor:pointer}
#drmenu{position:absolute;right:12px;z-index:99;background:#fff;color:#06303b;border-radius:10px;box-shadow:0 10px 30px #0004;padding:12px;display:grid;gap:8px;min-width:220px;font:14px system-ui,sans-serif}
#drmenu input{font:inherit;padding:6px 8px;border:1px solid #c7e2e6;border-radius:6px}#drmenu button{font:inherit;padding:6px 10px;border-radius:6px;border:0;background:#0a5a6b;color:#fff;cursor:pointer}
#drmenu .o{background:none;color:#0a5a6b;border:1px solid #c7e2e6}#drmenu .msg{font-size:13px;color:#4d7480}`;
    document.head.appendChild(st);
    document.body.prepend(bar);
    const meBtn = bar.querySelector('#drme'); meBtn.textContent = ME ? ME.name + ' ▾' : '';
    const sel = bar.querySelector('#drview');
    if (sel) { sel.value = getView(); sel.onchange = () => { setView(sel.value); document.dispatchEvent(new CustomEvent('drpool:view', { detail: sel.value })); }; }
    meBtn.onclick = () => {
      let m = document.getElementById('drmenu'); if (m) { m.remove(); return; }
      m = document.createElement('div'); m.id = 'drmenu';
      m.style.top = (bar.getBoundingClientRect().bottom + window.scrollY + 4) + 'px';
      m.innerHTML = `<b></b><label class="msg">New password<input type="password" id="drpw" autocomplete="new-password"></label>
        <button type="button" id="drpwgo">Change password</button><span class="msg" id="drpwmsg"></span><button type="button" class="o" id="drout">Sign out</button>`;
      m.querySelector('b').textContent = ME.name + (ME.office ? ' · Office access' : '');
      document.body.appendChild(m);
      m.querySelector('#drout').onclick = signOut;
      m.querySelector('#drpwgo').onclick = async () => {
        const msg = m.querySelector('#drpwmsg');
        try { await changePassword(m.querySelector('#drpw').value); msg.textContent = 'Password changed.'; } catch (e) { msg.textContent = e.message; }
      };
    };
    return bar;
  }

  window.DrPool = { sb, signIn, signOut, changePassword, requireLogin, loadMe, getView, setView, topBar, isOwner, get me() { return ME; }, toEmail, root };
})();
