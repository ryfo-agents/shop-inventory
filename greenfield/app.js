/* Greenfield UX: task-first, accessible, server-authoritative client. */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var live = document.getElementById('live');
  var model = {
    user: null, workspace: null, sections: [], subs: [], items: [], marks: {},
    views: {}, writes: {}, drafts: {}, history: [], bulk: null, authMode: 'login'
  };
  var STATUS = ['unknown', 'have', 'missing', 'upgrade', 'blocking', 'na'];
  var STATUS_LABEL = { unknown: 'Not audited', have: 'Have', missing: 'Missing', upgrade: 'Upgrade', blocking: 'Blocking', na: 'Not applicable' };
  var STATUS_SYMBOL = { unknown: '·', have: '✓', missing: '!', upgrade: '↑', blocking: '‼', na: '—' };

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function announce(text) { live.textContent = text; }
  function api(path, options) {
    options = options || {}; options.credentials = 'same-origin'; options.cache = 'no-store';
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    return fetch(path, options).then(function (r) {
      return r.text().then(function (text) {
        var data; try { data = JSON.parse(text); } catch (_) { throw new Error('Invalid service response.'); }
        if (!data || typeof data !== 'object') throw new Error('Invalid service response.');
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
    var gaps = items.filter(purchase).length;
    var blocking = items.filter(function (x) { return itemStatus(x.id) === 'blocking'; }).length;
    return { total: items.length, audited: audited, remaining: items.length - audited, gaps: gaps, blocking: blocking, percent: items.length ? Math.round(audited / items.length * 100) : 0 };
  }
  function allStats() { return stats(model.items.filter(function (x) { return !x.deleted; })); }
  function viewState() { var key = route().slice(0, 2).join('/'); return model.views[key] || (model.views[key] = { query: '', filter: 'all' }); }
  function route() { return (location.hash || '#/').slice(2).split('/'); }
  function normalizeState(state) {
    var sections = (state.sections || []).map(function (r) { return { id: r.id, num: r.num, title: r.title, sortOrder: r.sort_order, deleted: r.deleted }; }).filter(function (x) { return !x.deleted; }).sort(function (a,b) { return a.sortOrder - b.sortOrder; });
    var sectionMap = {}; sections.forEach(function (s) { sectionMap[s.id] = s; });
    var subs = (state.subsections || []).map(function (r) { return { id: r.id, sectionId: r.section_id, num: r.num, title: r.title, sortOrder: r.sort_order, deleted: r.deleted }; }).filter(function (x) { return !x.deleted && sectionMap[x.sectionId]; });
    var subMap = {}; subs.forEach(function (s) { subMap[s.id] = s; });
    var items = (state.items || []).map(function (r) { return { id: r.id, subsectionId: r.subsection_id, sectionId: subMap[r.subsection_id] && subMap[r.subsection_id].sectionId, label: r.label, qty: r.qty, target: r.target, spec: r.spec, phase: r.phase, tags: r.tags || [], store: r.store, sortOrder: r.sort_order, deleted: r.deleted }; }).filter(function (x) { return !x.deleted && x.sectionId; });
    subs.sort(function (a,b) { return sections.indexOf(sectionMap[a.sectionId]) - sections.indexOf(sectionMap[b.sectionId]) || (a.sortOrder || 0) - (b.sortOrder || 0) || a.id.localeCompare(b.id); });
    items.sort(function (a,b) { return subs.indexOf(subMap[a.subsectionId]) - subs.indexOf(subMap[b.subsectionId]) || (a.sortOrder || 0) - (b.sortOrder || 0) || a.id.localeCompare(b.id); });
    model.sections = sections; model.subs = subs; model.items = items; model.marks = {}; model.writes = {}; model.drafts = {}; model.history = []; model.views = {};
    (state.marks || []).forEach(function (r) { model.marks[r.item_id] = fullMark(r); });
  }

  function shell(content, current) {
    var s = allStats();
    return '<header class="topbar"><div class="container topbar-inner"><a class="brand" href="#/"><span class="brand-mark">SI</span><span class="brand-copy"><span class="brand-name">SHOP INVENTORY</span><span class="brand-sub">' + esc(model.workspace && model.workspace.name || 'Your workspace') + '</span></span></a><nav class="desktop-nav" aria-label="Desktop primary navigation"><a class="text-button" href="#/">Overview</a><a class="text-button" href="#/buy">Buy list</a><a class="text-button" href="#/settings">Settings</a></nav><div class="top-actions"><button class="secondary-button" data-action="undo" ' + (!model.history.length ? 'disabled' : '') + '>Undo</button><span class="muted" aria-label="Audit progress">' + s.audited + '/' + s.total + '</span><button class="icon-button" data-action="settings" aria-label="Open settings">⚙</button><button class="text-button" data-action="logout">Sign out</button></div></div></header><main><div class="container"><div id="write-summary" role="status"></div>' + content + '</div></main><nav class="bottom-nav" aria-label="Primary navigation"><div class="bottom-nav-inner"><a href="#/" aria-current="' + (current === 'home' ? 'page' : 'false') + '">⌂<span>Overview</span></a><a href="#/buy" aria-current="' + (current === 'buy' ? 'page' : 'false') + '">◈<span>Buy list' + (s.gaps ? ' (' + s.gaps + ')' : '') + '</span></a><a href="#/settings" aria-current="' + (current === 'settings' ? 'page' : 'false') + '">⚙<span>Settings</span></a></div></nav>';
  }

  function renderAuth(message) {
    app.innerHTML = '<div class="auth-wrap"><section class="auth-card" aria-labelledby="auth-title"><p class="eyebrow">Private workshop inventory</p><h1 id="auth-title">Make the next audit easy.</h1><p class="lede">A calm, focused place to record what you have and what is worth buying next.</p>' + (message ? '<p class="auth-error" role="alert">' + esc(message) + '</p>' : '') + '<form id="auth-form"><label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label><label class="field"><span>Password</span><input name="password" type="password" minlength="12" autocomplete="' + (model.authMode === 'register' ? 'new-password' : 'current-password') + '" required></label>' + (model.authMode === 'register' ? '<label class="field"><span>Name</span><input name="displayName" autocomplete="name"></label>' : '') + '<div class="form-actions"><button class="primary-button" type="submit">' + (model.authMode === 'register' ? 'Create workspace' : 'Sign in') + '</button><button class="secondary-button" type="button" data-action="toggle-auth">' + (model.authMode === 'register' ? 'I already have an account' : 'Create a new account') + '</button></div></form></section></div>';
  }

  function matches(item, query) {
    var m = fullMark(model.marks[item.id]);
    return !query || [item.label, item.store, m.sp, m.n].join(' ').toLowerCase().indexOf(query) >= 0;
  }
  function homeResults(query) {
    var direct = query ? model.items.filter(function (item) { return matches(item, query); }).map(function (item) { return '<a class="section-card" data-search-item="' + esc(item.id) + '" href="#/section/' + encodeURIComponent(item.sectionId) + '/item/' + encodeURIComponent(item.id) + '"><span class="section-main"><span class="section-title">' + esc(item.label) + '</span><span class="section-meta">' + esc(sectionById(item.sectionId).title) + ' · ' + STATUS_LABEL[itemStatus(item.id)] + '</span></span></a>'; }).join('') : '';
    var cards = model.sections.filter(function (section) { return !query || section.title.toLowerCase().indexOf(query) >= 0; }).map(function (section) {
      var ss = stats(sectionItems(section.id));
      return '<a class="section-card" href="#/section/' + encodeURIComponent(section.id) + '"><span class="section-number">' + esc(String(section.num).padStart(2, '0')) + '</span><span class="section-main"><span class="section-title">' + esc(section.title) + '</span><span class="section-meta">' + ss.remaining + ' left · ' + ss.gaps + ' to buy</span></span><span class="section-progress"><span class="progress-track"><span class="progress-fill" style="width:' + ss.percent + '%"></span></span><span class="section-progress-label">' + ss.audited + '/' + ss.total + ' audited</span></span></a>';
    }).join('');
    return direct + cards || '<div class="empty">No matching sections or items.</div>';
  }
  function visibleItems(sectionId) {
    var v = viewState(), query = v.query.trim().toLowerCase();
    return sectionItems(sectionId).filter(function (item) { return matches(item, query) && (v.filter === 'all' || (v.filter === 'gaps' ? !!purchase(item) : itemStatus(item.id) === v.filter)); });
  }
  function sectionRows(sectionId) {
    var visible = visibleItems(sectionId);
    return model.subs.filter(function (sub) { return sub.sectionId === sectionId; }).map(function (sub) {
      var items = visible.filter(function (item) { return item.subsectionId === sub.id; });
      return items.length ? '<section data-subsection="' + esc(sub.id) + '"><h3>' + esc(sub.title) + '</h3><div class="item-list">' + items.map(renderRow).join('') + '</div></section>' : '';
    }).join('') || '<div class="empty">Nothing matches this filter.</div>';
  }
  function resumeKey() { return 'shop-resume:' + model.workspace.id; }
  function rememberSection(id, itemId) { try { localStorage.setItem(resumeKey(), JSON.stringify({ section: id, item: itemId || null })); } catch (_) {} }
  function resumeHref() {
    var last = {}; try { last = JSON.parse(localStorage.getItem(resumeKey()) || '{}'); } catch (_) {}
    var incomplete = model.sections.filter(function (s) { return stats(sectionItems(s.id)).remaining > 0; });
    var section = incomplete.find(function (s) { return s.id === last.section; }) || incomplete[0] || sectionById(last.section) || model.sections[0];
    if (!section) return '#/';
    var items = sectionItems(section.id), item = items.find(function (x) { return x.id === last.item && itemStatus(x.id) === 'unknown'; }) || items.find(function (x) { return itemStatus(x.id) === 'unknown'; });
    return '#/section/' + encodeURIComponent(section.id) + (item ? '/item/' + encodeURIComponent(item.id) : '');
  }
  function updateResults() {
    var parts = route(), target;
    if (parts[0] === 'section') { target = document.getElementById('section-results'); if (target) target.innerHTML = sectionRows(decodeURIComponent(parts[1])); }
    else if (parts[0] === 'buy') { target = document.getElementById('buy-results'); if (target) target.innerHTML = buyResults(); }
    else { target = document.getElementById('home-results'); if (target) target.innerHTML = homeResults(viewState().query.trim().toLowerCase()); }
    app.querySelectorAll('[data-action="filter"]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.filter === viewState().filter)); });
    updateSummary();
  }
  function renderHome() {
    var s = allStats();
    var query = viewState().query.trim().toLowerCase();
    var cards = homeResults(query);
    var content = '<div class="page-heading"><div><p class="eyebrow">Overview</p><h1>Know what is in the shop.</h1><p class="lede">Work through one section at a time. Changes save as you make them.</p></div><a class="primary-button" data-resume href="' + resumeHref() + '">Continue audit →</a></div><section class="summary-grid" aria-label="Audit summary"><div class="summary-card primary"><span class="summary-label">Overall progress</span><div class="summary-value">' + s.percent + '%</div><div class="progress-track"><div class="progress-fill" style="width:' + s.percent + '%"></div></div><span class="summary-help">' + s.remaining + ' items still need a decision</span></div><div class="summary-card"><span class="summary-label">Audited</span><div class="summary-value">' + s.audited + '</div><span class="summary-help">of ' + s.total + ' items</span></div><div class="summary-card"><span class="summary-label">Buy list</span><div class="summary-value">' + s.gaps + '</div><span class="summary-help">' + s.blocking + ' blocking</span></div><div class="summary-card"><span class="summary-label">Sections</span><div class="summary-value">' + model.sections.length + '</div><span class="summary-help">organized for focus</span></div></section><div class="section-toolbar"><div><h2>Sections</h2><span class="muted">Choose a focused slice of the audit.</span></div><input class="search" id="section-search" type="search" placeholder="Search sections or items" value="' + esc(viewState().query) + '" aria-label="Search sections or items"></div><div class="section-list" id="home-results">' + (cards || '<div class="empty">No matching sections. Try a shorter search.</div>') + '</div>';
    app.innerHTML = shell(content, 'home');
  }

  function renderSection(id) {
    var section = sectionById(id); if (!section) return renderHome();
    var items = sectionItems(id); var s = stats(items);
    var rows = sectionRows(id);
    var filters = ['all','gaps','unknown','have','missing','upgrade','blocking','na'].map(function (f) { return '<button class="filter" data-action="filter" data-filter="' + f + '" aria-pressed="' + (viewState().filter === f ? 'true' : 'false') + '">' + (f === 'all' ? 'All' : f === 'gaps' ? 'Gaps' : STATUS_LABEL[f]) + '</button>'; }).join('');
    var content = '<a class="back-link" href="#/">← All sections</a><div class="detail-heading"><div><p class="eyebrow">Section ' + String(section.num).padStart(2, '0') + '</p><h1>' + esc(section.title) + '</h1><p class="lede" id="section-progress">' + s.audited + ' of ' + s.total + ' audited · ' + s.gaps + ' items on the buy list</p></div><div class="detail-actions"><button class="secondary-button" data-action="mark-all" data-id="' + esc(section.id) + '">Review up to 20 visible unaudited items</button></div></div><div id="bulk-feedback" role="status"></div><div class="filter-row" role="toolbar" aria-label="Filter checklist">' + filters + '</div><div class="section-toolbar"><div><h2>Checklist</h2><span class="muted">Choose the status that is true right now.</span></div><input class="search" id="item-search" type="search" placeholder="Search this section" value="' + esc(viewState().query) + '" aria-label="Search this section"></div><div class="item-list" id="section-results">' + (rows || '<div class="empty">Nothing matches this filter.</div>') + '</div>';
    app.innerHTML = shell(content, 'home');
  }

  // Inventory rules: a counted zero is meaningful; an uncounted consumable is not a gap.
  function purchase(item) {
    var m = fullMark(model.marks[item.id]);
    if (m.status === 'na') return null;
    var short = item.qty && Number(item.target) > 0 && m.q !== null && m.q < Number(item.target);
    var gap = ['missing', 'upgrade', 'blocking'].indexOf(m.status) >= 0;
    if (!short && !gap) return null;
    return { kind: gap ? STATUS_LABEL[m.status] : 'Restock', quantity: short ? Number(item.target) - m.q : 1, mark: m };
  }
  function detailField(item, field, label, type) {
    var draft = model.drafts[item.id] && model.drafts[item.id][field];
    var value = draft ? draft.value : fullMark(model.marks[item.id])[field];
    return '<label class="field"><span>' + label + '</span><input data-field="' + field + '" aria-label="' + esc(item.label + ': ' + label) + '" type="' + (type || 'text') + '" ' + (type === 'number' ? 'min="0" max="' + (field === 'q' ? '2147483647' : '1000000000') + '" step="' + (field === 'q' ? '1' : 'any') + '" inputmode="decimal" ' : 'maxlength="' + (field === 'sp' ? '2000' : '10000') + '" ') + 'value="' + esc(value) + '"></label>';
  }
  function renderRow(item) {
    var status = itemStatus(item.id), p = purchase(item), mark = fullMark(model.marks[item.id]);
    return '<div class="item-row" data-item-id="' + esc(item.id) + '" id="item-' + esc(item.id) + '"><button class="status-button" data-action="mark" data-id="' + esc(item.id) + '" data-status="' + status + '" aria-label="' + esc(item.label + ': ' + STATUS_LABEL[status] + '. Activate to change.') + '">' + STATUS_SYMBOL[status] + '<span class="mobile-status-label">' + esc(STATUS_LABEL[status]) + '</span></button><div class="item-content"><div class="item-label">' + esc(item.label) + '</div><div class="item-detail"><span>' + esc(STATUS_LABEL[status]) + '</span><span>' + esc(item.store || '') + '</span></div>' + (item.qty ? detailField(item, 'q', 'Count' + (item.target ? ' (target ' + item.target + ')' : ''), 'number') : '') + '<details><summary>Notes, specification and cost</summary>' + detailField(item, 'sp', 'Specification') + detailField(item, 'n', 'Note') + detailField(item, 'c', 'Estimated line cost', 'number') + '<p class="muted">Cost is the total planned spend for this line, not a unit price.</p></details><span class="purchase-detail">' + (p ? esc(p.kind + ' · Buy ' + p.quantity + (mark.c !== null ? ' · $' + Number(mark.c).toFixed(2) : '')) : '') + '</span></div><span class="item-status">' + feedbackText(item.id) + '</span></div>';
  }
  function feedbackText(id) {
    if (model.drafts[id] && Object.keys(model.drafts[id]).length) return '<span role="alert">Not saved: invalid numeric draft. Correct the number or reload cloud state to discard it.</span>';
    var state = model.writes[id];
    if (state && state.error) return '<span role="alert">Not saved: ' + esc(state.error) + '</span> ' + (state.conflict ? '<button class="text-button" data-action="reload-cloud">Reload cloud state (discard unsaved)</button>' : '<button class="text-button" data-action="retry" data-id="' + esc(id) + '">Retry</button>');
    return state && state.busy ? 'Saving…' : model.marks[id] ? 'Saved' : 'Not audited';
  }
  function buyResults() {
    var query = viewState().query.trim().toLowerCase(), grouped = Object.create(null);
    model.items.filter(function (item) { return purchase(item) && matches(item, query); }).forEach(function (item) { var store = item.store || 'General'; (grouped[store] || (grouped[store] = [])).push(item); });
    return Object.keys(grouped).sort().map(function (store) { return '<section class="panel"><h2>' + esc(store) + '</h2><div class="item-list">' + grouped[store].map(renderRow).join('') + '</div></section>'; }).join('') || '<div class="empty">No matching purchase gaps. Uncounted consumables are excluded.</div>';
  }
  function renderBuy() {
    var gaps = model.items.filter(purchase), cost = 0, unpriced = 0;
    gaps.forEach(function (item) { var c = purchase(item).mark.c; if (c === null) unpriced++; else cost += Number(c); });

    app.innerHTML = shell('<div class="page-heading"><div><p class="eyebrow">Next actions</p><h1>Buy list</h1><p class="lede">Gaps and counted shortfalls. Uncounted consumables stay off this list. Rows stay in place while cycling; reopen the list to refresh its membership.</p><p id="purchase-totals">' + gaps.length + ' lines · Estimated line totals $' + cost.toFixed(2) + ' · ' + unpriced + ' unpriced</p></div><button class="secondary-button" data-action="export">Export purchase CSV</button></div><label class="field"><span>Search buy list</span><input class="search" id="buy-search" type="search" value="' + esc(viewState().query) + '" aria-label="Search buy list"></label><div id="export-result"></div><div id="buy-results">' + buyResults() + '</div>', 'buy');
  }
  function exportPurchases() {
    var target = document.getElementById('export-result');
    if (Object.keys(model.drafts).length || Object.keys(model.writes).some(function (id) { return model.writes[id].busy || model.writes[id].error; })) { target.innerHTML = '<p role="alert">Export unavailable until all changes and numeric drafts are saved. Correct drafts, retry or reload cloud state.</p>'; return; }
    var rows = [['Item', 'Section', 'Store', 'Reason', 'Buy quantity', 'Count', 'Target', 'Specification', 'Note', 'Estimated line cost']];
    model.items.forEach(function (item) { var p = purchase(item); if (p) rows.push([item.label, sectionById(item.sectionId).title, item.store, p.kind, p.quantity, p.mark.q, item.target, p.mark.sp, p.mark.n, p.mark.c]); });
    var csv = rows.map(function (row) { return row.map(function (v) { var s = String(v == null ? '' : v); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
    target.innerHTML = '<label class="field"><span>Purchase CSV (copy or download)</span><textarea id="purchase-export" readonly rows="8">' + esc(csv) + '</textarea></label><a class="secondary-button" download="shop-purchases.csv" href="data:text/csv;charset=utf-8,' + esc(encodeURIComponent(csv)) + '">Download CSV</a>';
  }

  function renderSettings() {
    app.innerHTML = shell('<div class="page-heading"><div><p class="eyebrow">Workspace</p><h1>Settings</h1><p class="lede">Keep the audit predictable and easy to resume.</p></div></div><div class="settings-grid"><section class="panel"><h2>Account</h2><div class="settings-row"><span class="muted">Signed in as</span><strong>' + esc(model.user.email) + '</strong></div><div class="settings-row"><span class="muted">Workspace</span><strong>' + esc(model.workspace.name) + '</strong></div><div class="settings-row"><span class="muted">Data source</span><strong>Cloud workspace</strong></div></section><section class="panel"><h2>How this works</h2><p class="muted">Checklist structure editing is deferred until a safe, revision-protected editing API is available. Status, counts, specifications, notes and costs remain editable here.</p><p class="muted">Your checklist is stored in the cloud. Marking an item saves the decision immediately, so you can move between devices without exporting files or resolving browser copies.</p><button class="secondary-button" data-action="logout">Sign out</button></section></div>', 'settings');
  }

  function render() {
    if (!model.user) return;
    var parts = route();
    if (parts[0] === 'section' && parts[1]) { if (parts[2] === 'item' && parts[3]) { viewState().query = ''; viewState().filter = 'all'; } renderSection(decodeURIComponent(parts[1])); rememberSection(decodeURIComponent(parts[1]), parts[3] ? decodeURIComponent(parts[3]) : null); }
    else if (parts[0] === 'buy') renderBuy();
    else if (parts[0] === 'settings') renderSettings();
    else renderHome();
    Object.keys(model.writes).forEach(refreshItem); updateBulk(); updateUndo(); updateSummary();
    if (parts[0] === 'section' && parts[2] === 'item' && parts[3]) { var row = document.getElementById('item-' + decodeURIComponent(parts[3])); if (row) { row.querySelector('[data-action="mark"]').focus({ preventScroll: true }); if (row.scrollIntoView) row.scrollIntoView({ block: 'center' }); } }
  }

  // Full marks preserve details; version is the server's per-mark precondition.
  // Requests are serialized per item; only the latest unsent intent is retained.
  var sessionGeneration = 0;
  function fullMark(mark) {
    mark = mark || {};
    var result = { status: mark.status || 'unknown', q: mark.q == null ? null : Number(mark.q),
      sp: mark.sp == null ? null : mark.sp, n: mark.n == null ? null : mark.n, c: mark.c == null ? null : Number(mark.c) };
    result.version = mark.version == null ? 0 : mark.version;
    if (mark.updated_at != null || mark.updatedAt != null) result.updatedAt = mark.updated_at || mark.updatedAt;
    return result;
  }
  function writeState(id) {
    return model.writes[id] || (model.writes[id] = { confirmed: fullMark(model.marks[id]), intent: fullMark(model.marks[id]), version: 0, busy: false, error: null, conflict: false });
  }
  function refreshMetrics() {
    var s = allStats(), progress = app.querySelector('[aria-label="Audit progress"]'); if (progress) progress.textContent = s.audited + '/' + s.total;
    var detail = document.getElementById('section-progress'); if (detail) { var items = sectionItems(decodeURIComponent(route()[1] || '')), ss = stats(items); detail.textContent = ss.audited + ' of ' + ss.total + ' audited · ' + ss.gaps + ' items on the buy list'; }
    var total = document.getElementById('purchase-totals'); if (total) { var gaps = model.items.filter(purchase), cost = 0, unpriced = 0; gaps.forEach(function (item) { var c = purchase(item).mark.c; if (c === null) unpriced++; else cost += c; }); total.textContent = gaps.length + ' lines · Estimated line totals $' + cost.toFixed(2) + ' · ' + unpriced + ' unpriced'; }
  }
  function updateSummary() {
    var target = document.getElementById('write-summary'); if (!target) return;
    var ids = Object.keys(model.writes), pending = ids.filter(function (id) { return model.writes[id].busy; }), failed = ids.filter(function (id) { return model.writes[id].error; }), drafts = Object.keys(model.drafts);
    target.innerHTML = (!navigator.onLine ? '<p class="auth-error">Offline — inventory is read-only. Reconnect to retry; nothing will be replayed automatically.</p>' : '') + (pending.length || failed.length || drafts.length ? '<p>' + pending.length + ' saving · ' + failed.length + ' not saved · ' + drafts.length + ' numeric drafts not saved. Correct drafts or <button class="text-button" data-action="reload-cloud" ' + (pending.length ? 'disabled' : '') + '>Reload cloud state (discard unsaved)</button></p>' : ids.length ? '<p>All changes saved to cloud.</p>' : '') + failed.map(function (id) { var item = model.items.find(function (x) { return x.id === id; }); return '<p role="alert">' + esc(item.label) + ': ' + esc(model.writes[id].error) + (model.writes[id].conflict ? '' : ' <button class="text-button" data-action="retry" data-id="' + esc(id) + '">Retry</button>') + ' <button class="text-button" data-action="reload-cloud" ' + (pending.length ? 'disabled' : '') + '>Reload cloud state (discard unsaved)</button></p>'; }).join('');
    app.querySelectorAll('[data-item-id]').forEach(function (row) { row.querySelectorAll('[data-field]').forEach(function (input) { var draft = model.drafts[row.dataset.itemId] && model.drafts[row.dataset.itemId][input.dataset.field]; if (draft) { input.setAttribute('aria-invalid', 'true'); input.setCustomValidity(draft.message); } }); });
    app.querySelectorAll('[data-action="mark"], [data-field], [data-action="mark-all"], [data-action="confirm-bulk"]').forEach(function (el) { el.disabled = !navigator.onLine; });
  }
  function reloadCloud() {
    if (model.reloading || !navigator.onLine || !model.user || Object.keys(model.writes).some(function (id) { return model.writes[id].busy; })) { announce('Wait for pending saves and reconnect before reloading.'); return; }
    model.reloading = true; var generation = sessionGeneration;
    api('/api/workspaces/' + encodeURIComponent(model.workspace.id) + '/state').then(function (state) { if (generation !== sessionGeneration) return; normalizeState(state); model.bulk = null; model.reloading = false; render(); announce('Reloaded cloud inventory. Unsaved changes discarded.'); }).catch(function (error) { if (generation !== sessionGeneration) return; model.reloading = false; if (error.status === 401) { clearSession(); renderAuth('Your session expired. Sign in again.'); } else { var target = document.getElementById('write-summary'); if (target) target.innerHTML = '<p role="alert">Could not reload cloud inventory. <button class="text-button" data-action="reload-cloud">Retry reload</button></p>'; } });
  }
  function clearSession() {
    sessionGeneration++; model.user = null; model.workspace = null; model.writes = {}; model.drafts = {}; model.marks = {}; model.items = []; model.subs = []; model.sections = []; model.views = {}; model.history = []; model.bulk = null; model.reloading = false;
  }
  function refreshItem(id) {
    updateSummary(); refreshMetrics();
    var status = itemStatus(id);
    app.querySelectorAll('[data-item-id]').forEach(function (row) {
      if (row.dataset.itemId !== id) return;
      var button = row.querySelector('[data-action="mark"]');
      if (button) { button.dataset.status = status; button.setAttribute('aria-label', (model.items.find(function (x) { return x.id === id; }) || {}).label + ': ' + STATUS_LABEL[status] + '. Activate to change.'); button.innerHTML = STATUS_SYMBOL[status] + '<span class="mobile-status-label">' + esc(STATUS_LABEL[status]) + '</span>'; }
      var label = row.querySelector('.item-detail span'); if (label) label.textContent = STATUS_LABEL[status];
      var feedback = row.querySelector('.item-status');
      if (feedback) feedback.innerHTML = feedbackText(id);
      var m = fullMark(model.marks[id]); row.querySelectorAll('[data-field]').forEach(function (input) { if (document.activeElement !== input && !(model.drafts[id] && model.drafts[id][input.dataset.field])) input.value = m[input.dataset.field] == null ? '' : m[input.dataset.field]; });
      var p = purchase(model.items.find(function (x) { return x.id === id; })), detail = row.querySelector('.purchase-detail'); if (detail) detail.textContent = p ? p.kind + ' · Buy ' + p.quantity + (m.c !== null ? ' · $' + Number(m.c).toFixed(2) : '') : route()[0] === 'buy' ? 'No longer on buy list' : '';
    });
  }
  function pump(id) {
    var state = writeState(id); if (state.busy) return state.pending; if (state.error || model.reloading || !model.user) return;
    if (!navigator.onLine) { state.error = 'Offline. Reconnect and retry.'; refreshItem(id); return; }
    var version = state.version, sent = fullMark(state.intent), generation = sessionGeneration;
    // Never send the local intent counter, workspace revision, or read metadata.
    sent.version = state.confirmed.version;
    delete sent.updatedAt;
    state.busy = true; refreshItem(id);
    state.pending = api('/api/workspaces/' + encodeURIComponent(model.workspace.id) + '/marks/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(sent) }).then(function (result) {
      if (generation !== sessionGeneration) return;
      if (!result.mark || (result.mark.status !== null && STATUS.indexOf(result.mark.status) < 0) || !Number.isSafeInteger(result.mark.version) || result.mark.version <= sent.version) throw new Error('Invalid mark acknowledgment.');
      state.confirmed = fullMark(Object.assign({}, sent, result.mark));
      state.busy = false;
      if (version !== state.version) {
        // Rebase only fields not edited since this request. An old ack must not
        // clobber newer input, but its canonical details must survive the queue.
        ['status', 'q', 'sp', 'n', 'c'].forEach(function (key) { if (state.intent[key] === sent[key]) state.intent[key] = state.confirmed[key]; });
        state.intent.version = state.confirmed.version;
        state.intent.updatedAt = state.confirmed.updatedAt;
        model.marks[id] = fullMark(state.intent);
        return pump(id);
      }
      state.intent = fullMark(state.confirmed); model.marks[id] = fullMark(state.confirmed);
      refreshItem(id); announce(Object.keys(model.drafts).length || Object.keys(model.writes).some(function (key) { return model.writes[key].busy || model.writes[key].error; }) ? 'Changes still pending or not saved.' : 'All changes saved.'); return true;
    }).catch(function (error) {
      if (generation !== sessionGeneration) return;
      state.busy = false;
      if (error.status === 401) { clearSession(); renderAuth('Your session expired. Sign in again to reload cloud inventory. Unsaved changes were not replayed.'); return; }
      state.conflict = [403, 404, 409].indexOf(error.status) >= 0;
      state.error = error.status === 409 ? 'Changed on another device. Reload before editing.' : 'Could not save. Check your connection.';
      refreshItem(id); announce(state.conflict ? 'Not saved. Reload cloud state before editing.' : 'Not saved. Retry is available.'); return false;
    });
    return state.pending;
  }
  function saveMark(itemId, next, remember) {
    if (!model.user || !navigator.onLine) { announce('Offline. Inventory is read-only until reconnected.'); return; }
    var state = writeState(itemId);
    if (state.conflict || model.reloading) { announce('Reload cloud state before making another change.'); return; }
    var change = typeof next === 'string' ? { status: next } : next;
    var previous = {}; Object.keys(change).forEach(function (key) { previous[key] = state.intent[key]; });
    if (!state.error && Object.keys(change).every(function (key) { return previous[key] === change[key]; })) return state.busy ? state.pending : Promise.resolve(true);
    if (remember !== false) { model.history.push([{ id: itemId, previous: previous }]); if (model.history.length > 30) model.history.shift(); }
    state.intent = Object.assign(fullMark(state.intent), change);
    state.version++; state.error = null; model.marks[itemId] = fullMark(state.intent);
    var pending = pump(itemId); refreshItem(itemId); updateUndo(); return pending;
  }
  function updateUndo() { var button = app.querySelector('[data-action="undo"]'); if (button) button.disabled = !model.history.length || !!(model.bulk && model.bulk.running); }
  function undo() {
    if (!navigator.onLine || !model.user) { announce('Offline. Undo requires a connection.'); return; }
    if (model.bulk && model.bulk.running) return;
    var group = model.history[model.history.length - 1]; if (!group) return;
    if (group.some(function (entry) { return writeState(entry.id).conflict; })) { announce('Reload cloud state before undoing a conflicting change.'); return; }
    model.history.pop();
    if (group.length > 1) runGroup(group, true);
    else group.forEach(function (entry) { saveMark(entry.id, entry.previous, false); }); updateUndo();
  }
  function cycle(itemId) { var current = itemStatus(itemId); var index = STATUS.indexOf(current); saveMark(itemId, STATUS[(index < 0 ? 0 : index + 1) % STATUS.length]); }
  // The deployed contract has targeted PUT only. This is explicitly non-atomic:
  // preview at most 20 visible unknown items, one request at a time, report every failure.
  function markAll(sectionId) {
    if (!navigator.onLine || model.bulk && model.bulk.running) { announce('Bulk changes require an idle online connection.'); return; }
    var ids = visibleItems(sectionId).filter(function (x) { var s = model.writes[x.id]; return itemStatus(x.id) === 'unknown' && !(s && (s.busy || s.error)); }).slice(0, 20).map(function (x) { return x.id; });
    model.bulk = { ids: ids, preview: true, running: false, done: 0, failed: 0 }; updateBulk();
  }
  function updateBulk() {
    var target = document.getElementById('bulk-feedback'), b = model.bulk; if (!target || !b) return;
    if (b.preview) target.innerHTML = '<section class="panel"><p>Mark ' + b.ids.length + ' visible unaudited items as Have? Maximum 20 per batch. Each saves separately; this is not atomic. Counts and details are unchanged.</p><p>' + b.ids.map(function (id) { return esc(model.items.find(function (x) { return x.id === id; }).label); }).join(', ') + '</p><button class="secondary-button" data-action="confirm-bulk" ' + (!b.ids.length ? 'disabled' : '') + '>Confirm batch</button> <button class="text-button" data-action="cancel-bulk">Cancel</button></section>';
    else target.textContent = (b.undo ? 'Undo batch: ' : 'Batch: ') + b.done + ' saved · ' + b.failed + ' not saved' + (b.skipped ? ' · ' + b.skipped + ' skipped (changed since preview)' : '') + (b.running ? ' · Saving…' : ' · Complete. Failed rows have Retry; Undo applies to this whole batch.');
  }
  function runGroup(group, isUndo) {
    var generation = sessionGeneration, b = { ids: group.map(function (x) { return x.id; }), running: true, undo: isUndo, done: 0, failed: 0, skipped: 0 };
    model.bulk = b; updateBulk(); updateUndo();
    function step(index) {
      if (generation !== sessionGeneration || !model.user) return;
      if (index === group.length) { b.running = false; updateBulk(); updateUndo(); return; }
      var entry = group[index];
      if (!isUndo && (itemStatus(entry.id) !== 'unknown' || writeState(entry.id).version !== entry.version)) { group.splice(index, 1); b.skipped++; updateBulk(); step(index); return; }
      Promise.resolve(saveMark(entry.id, isUndo ? entry.previous : { status: 'have' }, false)).then(function (ok) {
        if (generation !== sessionGeneration) return;
        if (ok) b.done++; else b.failed++;
        updateBulk(); step(index + 1);
      });
    }
    step(0);
  }
  function confirmBulk() {
    var b = model.bulk; if (!b || !b.preview || !navigator.onLine) return;
    var group = b.ids.filter(function (id) { var s = model.writes[id]; return itemStatus(id) === 'unknown' && !(s && (s.busy || s.error)); }).map(function (id) { return { id: id, previous: { status: itemStatus(id) }, version: writeState(id).version }; });
    if (!group.length) { model.bulk = null; var target = document.getElementById('bulk-feedback'); if (target) target.textContent = 'No eligible items remain.'; return; }
    model.history.push(group); if (model.history.length > 30) model.history.shift(); runGroup(group, false);
  }
  var signingOut = false;
  function logout() {
    if (signingOut) return;
    clearSession(); var generation = sessionGeneration; signingOut = true;
    app.innerHTML = '<div class="auth-wrap"><section class="auth-card" aria-labelledby="signout-title" aria-busy="true"><h1 id="signout-title">Signing out…</h1><p role="status">Wait for confirmation before signing in again.</p></section></div>';
    announce('Signing out…');
    api('/api/auth/password-logout', { method: 'POST' }).then(function () {
      if (generation !== sessionGeneration) return;
      signingOut = false; model.authMode = 'login'; renderAuth('You are signed out.'); announce('You are signed out.');
    }).catch(function () {
      if (generation !== sessionGeneration) return;
      signingOut = false; model.authMode = 'login';
      renderAuth('Could not confirm sign-out. Your cloud session may still be active. Retry sign out below, or sign in again to recover access.');
      announce('Could not confirm sign-out.');
      var card = app.querySelector('.auth-card'); if (card) card.insertAdjacentHTML('beforeend', '<button class="secondary-button" data-action="logout">Retry sign out</button>');
    });
  }

  app.addEventListener('click', function (event) {
    var target = event.target.closest('[data-action]'); if (!target) return;
    var action = target.getAttribute('data-action');
    if (action === 'logout') logout();
    if (action === 'undo') undo();
    if (action === 'export') exportPurchases();
    if (action === 'settings') { location.hash = '#/settings'; }
    if (action === 'toggle-auth') { model.authMode = model.authMode === 'login' ? 'register' : 'login'; renderAuth(); }
    if (action === 'mark') cycle(target.getAttribute('data-id'));
    if (action === 'retry') { var id = target.getAttribute('data-id'); var state = writeState(id); if (!state.conflict && !model.reloading) { state.error = null; pump(id); } }
    if (action === 'reload-cloud') reloadCloud();
    if (action === 'filter') { viewState().filter = target.getAttribute('data-filter'); updateResults(); }
    if (action === 'mark-all') markAll(target.getAttribute('data-id'));
    if (action === 'confirm-bulk') confirmBulk();
    if (action === 'cancel-bulk') { model.bulk = null; document.getElementById('bulk-feedback').textContent = ''; }
  });
  app.addEventListener('change', function (event) {
    var input = event.target, field = input.dataset.field, row = input.closest('[data-item-id]');
    if (!field || !row) return;
    if ((field === 'q' || field === 'c') && !validateNumericDraft(input, row.dataset.itemId)) { input.reportValidity(); return; }
    var value = input.value === '' ? null : input.value;
    if (field === 'q' || field === 'c') {
      value = value === null ? null : Number(value);
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > (field === 'q' ? 2147483647 : 1e9) || (field === 'q' && !Number.isInteger(value)))) { input.setCustomValidity('Enter a nonnegative ' + (field === 'q' ? 'whole count up to 2147483647' : 'cost up to 1000000000') + '.'); input.reportValidity(); return; }
    } else if ((field === 'sp' || field === 'n') && value !== null && value.length > (field === 'sp' ? 2000 : 10000)) {
      input.setCustomValidity('Use at most ' + (field === 'sp' ? '2000' : '10000') + ' characters.'); input.reportValidity(); return;
    }
    input.setCustomValidity(''); var change = {}; change[field] = value; saveMark(row.dataset.itemId, change);
  });
  function validateNumericDraft(input, id) {
    var field = input.dataset.field, value = Number(input.value);
    var invalid = input.validity.badInput || (input.value !== '' && (!Number.isFinite(value) || value < 0 || value > (field === 'q' ? 2147483647 : 1e9) || (field === 'q' && !Number.isInteger(value))));
    if (invalid) {
      var message = 'Enter a nonnegative ' + (field === 'q' ? 'whole count up to 2147483647' : 'cost up to 1000000000') + '.';
      (model.drafts[id] || (model.drafts[id] = {}))[field] = { value: input.value, message: message };
      input.setCustomValidity(message); input.setAttribute('aria-invalid', 'true');
    } else {
      if (model.drafts[id]) { delete model.drafts[id][field]; if (!Object.keys(model.drafts[id]).length) delete model.drafts[id]; }
      input.setCustomValidity(''); input.removeAttribute('aria-invalid');
    }
    app.querySelectorAll('[data-item-id]').forEach(function (row) { if (row.dataset.itemId === id) { var feedback = row.querySelector('.item-status'); if (feedback) feedback.innerHTML = feedbackText(id); } });
    updateSummary();
    return !invalid;
  }
  app.addEventListener('input', function (event) {
    var input = event.target, row = input.closest('[data-item-id]');
    if (row && (input.dataset.field === 'q' || input.dataset.field === 'c')) validateNumericDraft(input, row.dataset.itemId);
    if (input.id === 'section-search' || input.id === 'item-search' || input.id === 'buy-search') { viewState().query = input.value; updateResults(); }
  });
  window.addEventListener('beforeunload', function (event) {
    if (Object.keys(model.drafts).length || Object.keys(model.writes).some(function (id) { return model.writes[id].busy || model.writes[id].error; })) { event.preventDefault(); event.returnValue = ''; }
  });
  app.addEventListener('submit', function (event) {
    if (event.target.id !== 'auth-form') return; event.preventDefault(); var form = event.target; var button = form.querySelector('button[type=submit]'); button.disabled = true; button.textContent = 'Connecting…';
    var body = { email: form.elements.namedItem('email').value, password: form.elements.namedItem('password').value, displayName: form.elements.namedItem('displayName') ? form.elements.namedItem('displayName').value : '' };
    clearSession(); var generation = sessionGeneration;
    api('/api/auth/' + (model.authMode === 'register' ? 'register' : 'password-login'), { method: 'POST', body: JSON.stringify(body) }).then(function (session) { if (generation !== sessionGeneration) return; model.user = session.user; model.workspace = session.workspace; return api('/api/workspaces/' + encodeURIComponent(model.workspace.id) + '/state'); }).then(function (state) { if (generation !== sessionGeneration) return; normalizeState(state); location.hash = '#/'; render(); }).catch(function (error) { if (generation !== sessionGeneration) return; clearSession(); button.disabled = false; renderAuth(error.message === 'account_exists' ? 'That email already has an account.' : 'Sign-in failed. Check your details and try again.'); });
  });
  window.addEventListener('hashchange', render);
  window.addEventListener('online', updateSummary);
  window.addEventListener('offline', updateSummary);

  function boot() { var generation = sessionGeneration; api('/api/auth/me').then(function (session) { if (generation !== sessionGeneration) return; model.user = session.user; model.workspace = session.workspace; return api('/api/workspaces/' + encodeURIComponent(model.workspace.id) + '/state'); }).then(function (state) { if (generation !== sessionGeneration) return; normalizeState(state); render(); }).catch(function (error) { if (generation !== sessionGeneration) return; clearSession(); if (error.status === 401) renderAuth(); else renderAuth('The inventory service is unavailable. Try again shortly.'); }); }
  boot();
}());
