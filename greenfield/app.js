/* Greenfield UX: task-first, accessible, server-authoritative client. */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var live = document.getElementById('live');
  var model = {
    user: null, workspace: null, sections: [], subs: [], items: [], marks: {},
    query: '', filter: 'all', saving: {}, error: null, authMode: 'login'
  };
  var STATUS = ['unknown', 'have', 'missing', 'upgrade', 'blocking', 'na'];
  var STATUS_LABEL = { unknown: 'Not audited', have: 'Have', missing: 'Missing', upgrade: 'Upgrade', blocking: 'Blocking', na: 'Not applicable' };
  var STATUS_SYMBOL = { unknown: '·', have: '✓', missing: '!', upgrade: '↑', blocking: '‼', na: '—' };

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function announce(text) { live.textContent = text; }
  function api(path, options) {
    options = options || {}; options.credentials = 'same-origin';
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    return fetch(path, options).then(function (r) {
      return r.text().then(function (text) {
        var data = {}; try { data = text ? JSON.parse(text) : {}; } catch (_) {}
        if (!r.ok) { var error = new Error(data.error || ('Request failed (' + r.status + ')')); error.status = r.status; throw error; }
        return data;
      });
    });
  }
  function itemStatus(id) { return model.marks[id] && model.marks[id].status || 'unknown'; }
  function sectionItems(sectionId) { return model.items.filter(function (item) { return item.sectionId === sectionId && !item.deleted; }); }
  function sectionById(id) { return model.sections.find(function (s) { return s.id === id; }); }
  function stats(items) {
    var audited = items.filter(function (x) { return itemStatus(x.id) !== 'unknown'; }).length;
    var gaps = items.filter(function (x) { return ['missing', 'upgrade', 'blocking'].indexOf(itemStatus(x.id)) >= 0; }).length;
    var blocking = items.filter(function (x) { return itemStatus(x.id) === 'blocking'; }).length;
    return { total: items.length, audited: audited, remaining: items.length - audited, gaps: gaps, blocking: blocking, percent: items.length ? Math.round(audited / items.length * 100) : 0 };
  }
  function allStats() { return stats(model.items.filter(function (x) { return !x.deleted; })); }
  function isMobile() { return window.innerWidth <= 560 || (window.matchMedia && window.matchMedia('(max-width: 560px)').matches); }
  function closeStatusSheet() { var sheet = document.getElementById('status-sheet-backdrop'); if (sheet) sheet.remove(); }
  function openStatusSheet(itemId) {
    closeStatusSheet();
    var item = model.items.find(function (x) { return x.id === itemId; });
    if (!item) return;
    var current = itemStatus(itemId);
    var options = STATUS.map(function (status) { return '<button class="status-option" data-action="status-choice" data-id="' + esc(itemId) + '" data-status="' + status + '"><strong>' + STATUS_SYMBOL[status] + ' ' + esc(STATUS_LABEL[status]) + '</strong><span>' + (status === current ? 'Current choice' : 'Tap to choose') + '</span></button>'; }).join('');
    app.insertAdjacentHTML('beforeend', '<div class="status-sheet-backdrop" id="status-sheet-backdrop"><section class="status-sheet" role="dialog" aria-modal="true" aria-labelledby="status-sheet-title"><h2 id="status-sheet-title">Update item status</h2><p class="status-sheet-help">Choose exactly what is true for this item.</p><div class="status-options">' + options + '</div><button class="secondary-button status-sheet-close" data-action="close-status-sheet">Cancel</button></section></div>');
    var first = document.querySelector('.status-option[data-status="' + current + '"]'); if (first) first.focus();
  }
  function route() { return (location.hash || '#/').slice(2).split('/'); }
  function normalizeState(state) {
    var sections = (state.sections || []).map(function (r) { return { id: r.id, num: r.num, title: r.title, sortOrder: r.sort_order, deleted: r.deleted }; }).filter(function (x) { return !x.deleted; }).sort(function (a,b) { return a.sortOrder - b.sortOrder; });
    var sectionMap = {}; sections.forEach(function (s) { sectionMap[s.id] = s; });
    var subs = (state.subsections || []).map(function (r) { return { id: r.id, sectionId: r.section_id, num: r.num, title: r.title, sortOrder: r.sort_order, deleted: r.deleted }; }).filter(function (x) { return !x.deleted && sectionMap[x.sectionId]; });
    var subMap = {}; subs.forEach(function (s) { subMap[s.id] = s; });
    var items = (state.items || []).map(function (r) { return { id: r.id, subsectionId: r.subsection_id, sectionId: subMap[r.subsection_id] && subMap[r.subsection_id].sectionId, label: r.label, qty: r.qty, target: r.target, spec: r.spec, phase: r.phase, tags: r.tags || [], store: r.store, sortOrder: r.sort_order, deleted: r.deleted }; }).filter(function (x) { return !x.deleted && x.sectionId; });
    model.sections = sections; model.subs = subs; model.items = items; model.marks = {};
    (state.marks || []).forEach(function (r) { model.marks[r.item_id] = { status: r.status || 'unknown', q: r.q, sp: r.sp, n: r.n, c: r.c, updatedAt: r.updated_at }; });
  }

  function shell(content, current) {
    var s = allStats();
    return '<header class="topbar"><div class="container topbar-inner"><a class="brand" href="#/"><span class="brand-mark">SI</span><span class="brand-copy"><span class="brand-name">SHOP INVENTORY</span><span class="brand-sub">' + esc(model.workspace && model.workspace.name || 'Your workspace') + '</span></span></a><div class="top-actions"><span class="muted" aria-label="Audit progress">' + s.audited + '/' + s.total + '</span><button class="icon-button" data-action="settings" aria-label="Open settings">⚙</button><button class="text-button" data-action="logout">Sign out</button></div></div></header><main><div class="container">' + content + '</div></main><nav class="bottom-nav" aria-label="Primary navigation"><div class="bottom-nav-inner"><a href="#/" aria-current="' + (current === 'home' ? 'page' : 'false') + '">⌂<span>Overview</span></a><a href="#/buy" aria-current="' + (current === 'buy' ? 'page' : 'false') + '">◈<span>Buy list' + (s.gaps ? ' (' + s.gaps + ')' : '') + '</span></a><a href="#/settings" aria-current="' + (current === 'settings' ? 'page' : 'false') + '">⚙<span>Settings</span></a></div></nav>';
  }

  function renderAuth(message) {
    app.innerHTML = '<div class="auth-wrap"><section class="auth-card" aria-labelledby="auth-title"><p class="eyebrow">Private workshop inventory</p><h1 id="auth-title">Make the next audit easy.</h1><p class="lede">A calm, focused place to record what you have and what is worth buying next.</p>' + (message ? '<p class="auth-error" role="alert">' + esc(message) + '</p>' : '') + '<form id="auth-form"><label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label><label class="field"><span>Password</span><input name="password" type="password" minlength="12" autocomplete="' + (model.authMode === 'register' ? 'new-password' : 'current-password') + '" required></label>' + (model.authMode === 'register' ? '<label class="field"><span>Name</span><input name="displayName" autocomplete="name"></label>' : '') + '<div class="form-actions"><button class="primary-button" type="submit">' + (model.authMode === 'register' ? 'Create workspace' : 'Sign in') + '</button><button class="secondary-button" type="button" data-action="toggle-auth">' + (model.authMode === 'register' ? 'I already have an account' : 'Create a new account') + '</button></div></form></section></div>';
  }

  function renderHome() {
    var s = allStats();
    var query = model.query.trim().toLowerCase();
    var sections = model.sections.filter(function (section) { return !query || section.title.toLowerCase().indexOf(query) >= 0 || sectionItems(section.id).some(function (x) { return x.label.toLowerCase().indexOf(query) >= 0; }); });
    var cards = sections.map(function (section) {
      var ss = stats(sectionItems(section.id));
      return '<a class="section-card" href="#/section/' + encodeURIComponent(section.id) + '"><span class="section-number">' + String(section.num).padStart(2, '0') + '</span><span class="section-main"><span class="section-title">' + esc(section.title) + '</span><span class="section-meta">' + ss.remaining + ' left · ' + ss.gaps + ' to buy</span></span><span class="section-progress"><span class="progress-track"><span class="progress-fill" style="width:' + ss.percent + '%"></span></span><span class="section-progress-label">' + ss.audited + '/' + ss.total + ' audited</span></span></a>';
    }).join('');
    var content = '<div class="page-heading"><div><p class="eyebrow">Overview</p><h1>Know what is in the shop.</h1><p class="lede">Work through one section at a time. Changes save as you make them.</p></div><a class="primary-button" href="#/section/' + (model.sections[0] ? encodeURIComponent(model.sections[0].id) : '') + '">Continue audit →</a></div><section class="summary-grid" aria-label="Audit summary"><div class="summary-card primary"><span class="summary-label">Overall progress</span><div class="summary-value">' + s.percent + '%</div><div class="progress-track"><div class="progress-fill" style="width:' + s.percent + '%"></div></div><span class="summary-help">' + s.remaining + ' items still need a decision</span></div><div class="summary-card"><span class="summary-label">Audited</span><div class="summary-value">' + s.audited + '</div><span class="summary-help">of ' + s.total + ' items</span></div><div class="summary-card"><span class="summary-label">Buy list</span><div class="summary-value">' + s.gaps + '</div><span class="summary-help">' + s.blocking + ' blocking</span></div><div class="summary-card"><span class="summary-label">Sections</span><div class="summary-value">' + model.sections.length + '</div><span class="summary-help">organized for focus</span></div></section><div class="section-toolbar"><div><h2>Sections</h2><span class="muted">Choose a focused slice of the audit.</span></div><input class="search" id="section-search" type="search" placeholder="Search sections or items" value="' + esc(model.query) + '" aria-label="Search sections or items"></div><div class="section-list">' + (cards || '<div class="empty">No matching sections. Try a shorter search.</div>') + '</div>';
    app.innerHTML = shell(content, 'home');
  }

  function renderSection(id) {
    var section = sectionById(id); if (!section) return renderHome();
    var items = sectionItems(id); var s = stats(items); var query = model.query.trim().toLowerCase();
    var visible = items.filter(function (item) { var status = itemStatus(item.id); var matchesFilter = model.filter === 'all' || (model.filter === 'gaps' ? ['missing','upgrade','blocking'].indexOf(status) >= 0 : status === model.filter); var matchesQuery = !query || item.label.toLowerCase().indexOf(query) >= 0 || (item.store || '').toLowerCase().indexOf(query) >= 0; return matchesFilter && matchesQuery; });
    var rows = visible.map(function (item) { var status = itemStatus(item.id); var saving = model.saving[item.id]; return '<div class="item-row"><button class="status-button" data-action="mark" data-id="' + esc(item.id) + '" data-status="' + status + '" aria-label="' + esc(item.label) + ': ' + STATUS_LABEL[status] + '. Activate to change.">' + STATUS_SYMBOL[status] + '<span class="mobile-status-label">' + esc(STATUS_LABEL[status]) + '</span></button><div class="item-content"><div class="item-label">' + esc(item.label) + '</div><div class="item-detail"><span>' + esc(STATUS_LABEL[status]) + '</span>' + (item.qty ? '<span>Target ' + esc(item.target) + '</span>' : '') + (item.store ? '<span class="item-store">' + esc(item.store) + '</span>' : '') + '</div></div><span class="item-status">' + (saving ? 'Saving…' : status === 'unknown' ? '' : 'Saved') + '</span></div>'; }).join('');
    var filters = ['all','gaps','unknown','have','missing','upgrade','blocking','na'].map(function (f) { return '<button class="filter" data-action="filter" data-filter="' + f + '" aria-pressed="' + (model.filter === f ? 'true' : 'false') + '">' + (f === 'all' ? 'All' : f === 'gaps' ? 'Gaps' : STATUS_LABEL[f]) + '</button>'; }).join('');
    var content = '<a class="back-link" href="#/">← All sections</a><div class="detail-heading"><div><p class="eyebrow">Section ' + String(section.num).padStart(2, '0') + '</p><h1>' + esc(section.title) + '</h1><p class="lede">' + s.audited + ' of ' + s.total + ' audited · ' + s.gaps + ' items on the buy list</p></div><div class="detail-actions"><button class="secondary-button" data-action="mark-all" data-id="' + esc(section.id) + '">Mark remaining as Have</button></div></div><div class="filter-row" role="toolbar" aria-label="Filter checklist">' + filters + '</div><div class="section-toolbar"><div><h2>Checklist</h2><span class="muted">Choose the status that is true right now.</span></div><input class="search" id="item-search" type="search" placeholder="Search this section" value="' + esc(model.query) + '" aria-label="Search this section"></div><div class="item-list">' + (rows || '<div class="empty">Nothing matches this filter.</div>') + '</div>';
    app.innerHTML = shell(content, 'home');
  }

  function renderBuy() {
    var gaps = model.items.filter(function (item) { return ['missing','upgrade','blocking'].indexOf(itemStatus(item.id)) >= 0; });
    var grouped = {}; gaps.forEach(function (item) { var store = item.store || 'General'; (grouped[store] || (grouped[store] = [])).push(item); });
    var body = Object.keys(grouped).sort().map(function (store) { return '<section class="panel"><h2>' + esc(store) + '</h2><p class="muted">' + grouped[store].length + ' item' + (grouped[store].length === 1 ? '' : 's') + '</p><div class="item-list">' + grouped[store].map(function (item) { var status = itemStatus(item.id); return '<div class="item-row"><button class="status-button" data-action="mark" data-id="' + esc(item.id) + '" data-status="' + status + '" aria-label="' + esc(item.label) + ': ' + STATUS_LABEL[status] + '. Activate to change.">' + STATUS_SYMBOL[status] + '<span class="mobile-status-label">' + esc(STATUS_LABEL[status]) + '</span></button><div class="item-content"><div class="item-label">' + esc(item.label) + '</div><div class="item-detail"><span>' + esc(STATUS_LABEL[status]) + '</span><span class="item-store">Section ' + esc(sectionById(item.sectionId).title) + '</span></div></div><span class="item-status">' + (item.qty && item.target ? 'Target ' + esc(item.target) : '') + '</span></div>'; }).join('') + '</div></section>'; }).join('');
    app.innerHTML = shell('<div class="page-heading"><div><p class="eyebrow">Next actions</p><h1>Buy list</h1><p class="lede">Only items marked Missing, Upgrade, or Blocking appear here.</p></div></div>' + (body || '<div class="empty"><h2>You are covered.</h2><p>No purchase gaps are recorded yet.</p><a class="primary-button" href="#/">Return to overview</a></div>'), 'buy');
  }

  function renderSettings() {
    app.innerHTML = shell('<div class="page-heading"><div><p class="eyebrow">Workspace</p><h1>Settings</h1><p class="lede">Keep the audit predictable and easy to resume.</p></div></div><div class="settings-grid"><section class="panel"><h2>Account</h2><div class="settings-row"><span class="muted">Signed in as</span><strong>' + esc(model.user.email) + '</strong></div><div class="settings-row"><span class="muted">Workspace</span><strong>' + esc(model.workspace.name) + '</strong></div><div class="settings-row"><span class="muted">Data source</span><strong>Cloud workspace</strong></div></section><section class="panel"><h2>How this works</h2><p class="muted">Your checklist is stored in the cloud. Marking an item saves the decision immediately, so you can move between devices without exporting files or resolving browser copies.</p><button class="secondary-button" data-action="logout">Sign out</button></section></div>', 'settings');
  }

  function render() {
    var parts = route();
    if (parts[0] === 'section' && parts[1]) renderSection(decodeURIComponent(parts[1]));
    else if (parts[0] === 'buy') renderBuy();
    else if (parts[0] === 'settings') renderSettings();
    else renderHome();
  }

  function saveMark(itemId, next) {
    var old = model.marks[itemId]; model.marks[itemId] = { status: next, updatedAt: new Date().toISOString() }; model.saving[itemId] = true; render(); announce(next === 'unknown' ? 'Marked as not audited.' : 'Marked as ' + STATUS_LABEL[next] + '. Saving.');
    api('/api/workspaces/' + encodeURIComponent(model.workspace.id) + '/marks/' + encodeURIComponent(itemId), { method: 'PUT', body: JSON.stringify({ status: next }) }).then(function (result) { model.saving[itemId] = false; if (result.mark) model.marks[itemId] = { status: result.mark.status || 'unknown', q: result.mark.q, c: result.mark.c, updatedAt: result.mark.updated_at }; render(); announce('Saved.'); }).catch(function () { model.marks[itemId] = old || { status: 'unknown' }; model.saving[itemId] = false; render(); announce('Could not save that change. Try again.'); });
  }
  function cycle(itemId) { var current = itemStatus(itemId); var index = STATUS.indexOf(current); saveMark(itemId, STATUS[(index < 0 ? 0 : index + 1) % STATUS.length]); }
  function markAll(sectionId) { sectionItems(sectionId).filter(function (x) { return itemStatus(x.id) === 'unknown'; }).forEach(function (x) { saveMark(x.id, 'have'); }); }
  function logout() { api('/api/auth/password-logout', { method: 'POST' }).finally(function () { model.user = null; model.workspace = null; renderAuth('You are signed out.'); }); }

  app.addEventListener('click', function (event) {
    var target = event.target.closest('[data-action]'); if (!target) return;
    var action = target.getAttribute('data-action');
    if (action === 'logout') logout();
    if (action === 'settings') { location.hash = '#/settings'; }
    if (action === 'toggle-auth') { model.authMode = model.authMode === 'login' ? 'register' : 'login'; renderAuth(); }
    if (action === 'mark') { if (isMobile()) openStatusSheet(target.getAttribute('data-id')); else cycle(target.getAttribute('data-id')); }
    if (action === 'status-choice') { var choiceId = target.getAttribute('data-id'); var choiceStatus = target.getAttribute('data-status'); closeStatusSheet(); saveMark(choiceId, choiceStatus); }
    if (action === 'close-status-sheet') closeStatusSheet();
    if (action === 'filter') { model.filter = target.getAttribute('data-filter'); render(); }
    if (action === 'mark-all') markAll(target.getAttribute('data-id'));
  });
  app.addEventListener('input', function (event) { if (event.target.id === 'section-search' || event.target.id === 'item-search') { model.query = event.target.value; render(); var input = document.getElementById(event.target.id); if (input) { input.focus(); input.setSelectionRange(model.query.length, model.query.length); } } });
  app.addEventListener('submit', function (event) {
    if (event.target.id !== 'auth-form') return; event.preventDefault(); var form = event.target; var button = form.querySelector('button[type=submit]'); button.disabled = true; button.textContent = 'Connecting…';
    var body = { email: form.email.value, password: form.password.value, displayName: form.displayName ? form.displayName.value : '' };
    api('/api/auth/' + (model.authMode === 'register' ? 'register' : 'password-login'), { method: 'POST', body: JSON.stringify(body) }).then(function (session) { model.user = session.user; model.workspace = session.workspace; return api('/api/workspaces/' + encodeURIComponent(model.workspace.id) + '/state'); }).then(function (state) { normalizeState(state); location.hash = '#/'; render(); }).catch(function (error) { button.disabled = false; renderAuth(error.message === 'account_exists' ? 'That email already has an account.' : 'Sign-in failed. Check your details and try again.'); });
  });
  window.addEventListener('hashchange', render);
  window.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeStatusSheet(); });

  function boot() { api('/api/auth/me').then(function (session) { model.user = session.user; model.workspace = session.workspace; return api('/api/workspaces/' + encodeURIComponent(model.workspace.id) + '/state'); }).then(function (state) { normalizeState(state); render(); }).catch(function (error) { if (error.status === 401) renderAuth(); else renderAuth('The inventory service is unavailable. Try again shortly.'); }); }
  boot();
}());
