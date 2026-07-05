'use strict';
/* Lagoon Ledger v2 — UI layer. Depends on the pure core (window.LL). */
(function () {
const C = window.LL;
const LS_KEY = 'lagoon-ledger-v2';

/* ---------------- utilities ---------------- */
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function curMonth() { return todayISO().slice(0, 7); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function monthLabel(m) {
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return names[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4);
}
function dateLabel(iso) {
  if (!iso) return '';
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return +iso.slice(8, 10) + ' ' + names[+iso.slice(5, 7) - 1] + ' ' + iso.slice(0, 4);
}
function amtClass(c) { return c > 0 ? 'pos' : c < 0 ? 'neg' : 'zero'; }
function money(c) { return `<span class="amt ${amtClass(c)}">${C.fmtCAD(c)}</span>`; }

/* ---------------- state ---------------- */
let S = null;
let UI = {
  view: 'budget',
  month: curMonth(),
  reg: { accountId: 'all', q: '', categoryId: 'all', from: '', to: '', cleared: 'all' },
  repMonth: curMonth(),
  modal: null,
  imp: null,
  saveError: null,
  loadProblem: null,
};

// Copy damaged stored data to a sidecar key BEFORE any reseed/save can
// overwrite it, so a first edit after a bad load can't destroy the original.
function stashCorrupt(raw) {
  try { localStorage.setItem(LS_KEY + ':corrupt', raw); } catch (e) { /* storage full — in-memory copy + banner still hold it */ }
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(LS_KEY); } catch (e) { /* private mode etc. */ }
  if (!raw) { S = C.blankState(todayISO()); return; }
  try {
    const parsed = JSON.parse(raw);
    const v = C.validateState(parsed);
    if (!v.ok) { stashCorrupt(raw); UI.loadProblem = { raw, errors: v.errors }; S = C.blankState(todayISO()); return; }
    S = parsed;
  } catch (e) {
    stashCorrupt(raw);
    UI.loadProblem = { raw, errors: [String(e)] };
    S = C.blankState(todayISO());
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(S));
      if (UI.saveError) { UI.saveError = null; render(); }
    } catch (e) {
      UI.saveError = 'Autosave failed — browser storage is full or blocked. Export a JSON backup now, then remove old data or free storage.';
      render();
    }
  }, 250);
}
function commit() { save(); render(); }

/* ---------------- lookups ---------------- */
function acct(id) { return S.accounts.find(a => a.id === id); }
function cat(id) { return S.categories.find(c => c.id === id); }
function group(id) { return S.groups.find(g => g.id === id); }
function catName(id) {
  if (id === C.INFLOW) return 'Inflow: To Be Budgeted';
  const c = cat(id); return c ? c.name : '—';
}
function openAccounts() { return S.accounts.filter(a => !a.closed); }
function budgetOpen() { return openAccounts().filter(C.isBudgetAccount); }
function payeeList() {
  const set = new Set();
  for (const t of S.transactions) if (t.payee && !t.transferPairId) set.add(t.payee);
  return [...set].sort((a, b) => a.localeCompare(b));
}
function paymentCatForCard(cardId) { return S.categories.find(c => c.paymentForAccountId === cardId); }

function ensurePaymentCategory(cardAcct) {
  if (paymentCatForCard(cardAcct.id)) return;
  let g = S.groups.find(g => g.id === 'gCC');
  if (!g) { g = { id: 'gCC', name: 'Credit Card Payments' }; S.groups.unshift(g); }
  S.categories.push({ id: C.uid(), groupId: 'gCC', name: cardAcct.name + ' Payment', paymentForAccountId: cardAcct.id });
}

/* ---------------- transfers ---------------- */
function makeTransfer(o) { // {fromId, toId, date, cents (positive), memo, categoryId?}
  const from = acct(o.fromId), to = acct(o.toId);
  const idOut = C.uid(), idIn = C.uid();
  const budgetToTracking = C.isBudgetAccount(from) && !C.isBudgetAccount(to);
  S.transactions.push({
    id: idOut, accountId: o.fromId, date: o.date, payee: 'Transfer: ' + to.name,
    categoryId: budgetToTracking ? (o.categoryId || null) : null,
    amountCents: -o.cents, memo: o.memo || '', cleared: false, transferPairId: idIn,
  });
  S.transactions.push({
    id: idIn, accountId: o.toId, date: o.date, payee: 'Transfer: ' + from.name,
    categoryId: (!C.isBudgetAccount(from) && C.isBudgetAccount(to)) ? (o.categoryId || null) : null,
    amountCents: o.cents, memo: o.memo || '', cleared: false, transferPairId: idOut,
  });
}
function deleteTxn(id) {
  const t = S.transactions.find(x => x.id === id);
  if (!t) return;
  S.transactions = S.transactions.filter(x => x.id !== id && x.id !== t.transferPairId);
}

/* ---------------- boot & render root ---------------- */
function boot() {
  load();
  document.getElementById('app').innerHTML = `
    <nav class="sidebar" id="sidebar" aria-label="Main"></nav>
    <main class="main" id="main"></main>`;
  const tb = document.createElement('nav');
  tb.className = 'tabbar'; tb.id = 'tabbar'; tb.setAttribute('aria-label', 'Main');
  document.body.appendChild(tb);
  const mr = document.createElement('div'); mr.id = 'modalRoot';
  document.body.appendChild(mr);
  render();
}

let budgetCache = null;
function render() {
  budgetCache = C.computeBudget(S, UI.month);
  renderSidebar();
  renderTabbar();
  renderMain();
  renderModal();
}

const NAV = [
  ['budget', 'Budget', '◍'],
  ['accounts', 'Accounts', '☰'],
  ['scheduled', 'Scheduled', '↻'],
  ['reports', 'Reports', '▤'],
  ['import', 'Import', '⇣'],
  ['settings', 'Settings', '⚙'],
];

function renderSidebar() {
  const bals = C.accountBalances(S);
  const nowB = C.computeBudget(S, curMonth()).months[curMonth()];
  const nowTbb = nowB ? nowB.tbb : 0;
  document.getElementById('sidebar').innerHTML = `
    <div class="brand">Lagoon Ledger<small>every dollar has a job</small></div>
    ${NAV.map(([id, label]) => `
      <button class="nav-btn" ${UI.view === id ? 'aria-current="page"' : ''} onclick="A.nav('${id}')">
        <span>${label}</span>${id === 'budget' ? `<span class="nav-tbb ${nowTbb > 0 ? 'pos' : nowTbb < 0 ? 'neg' : ''}">${C.fmtCAD(nowTbb)}</span>` : ''}
      </button>`).join('')}
    <div class="side-accounts">
      <div class="side-h">Accounts</div>
      ${openAccounts().map(a => `
        <button class="side-acct" onclick="A.gotoAccount('${a.id}')">
          <span>${esc(a.name)}</span>
          <span class="amt ${bals[a.id].working < 0 ? 'neg' : ''}">${C.fmtCAD(bals[a.id].working)}</span>
        </button>`).join('') || '<div class="side-h" style="font-weight:400;text-transform:none;letter-spacing:0">None yet</div>'}
    </div>`;
}

function renderTabbar() {
  document.getElementById('tabbar').innerHTML = NAV.map(([id, label, glyph]) => `
    <button ${UI.view === id ? 'aria-current="page"' : ''} onclick="A.nav('${id}')">
      <span class="glyph" aria-hidden="true">${glyph}</span>${label}
    </button>`).join('');
}

function banners() {
  let h = '';
  if (UI.loadProblem) {
    h += `<div class="banner err" role="alert"><span>Saved data could not be read (${esc(UI.loadProblem.errors[0] || 'unknown error')}). The damaged copy was preserved at localStorage key "${esc(LS_KEY)}:corrupt" — nothing has been overwritten.</span>
      <span class="row"><button class="btn sm" onclick="A.downloadRaw()">Download raw data</button>
      <button class="btn sm ghost" onclick="A.dismissLoadProblem()">Start fresh</button></span></div>`;
  }
  if (UI.saveError) h += `<div class="banner err" role="alert"><span>${esc(UI.saveError)}</span><button class="btn sm" onclick="A.exportJSON()">Export backup</button></div>`;
  const last = S.meta.lastExport;
  const stale = S.transactions.length > 0 && (!last || C.daysBetween(last.slice(0, 10), todayISO()) > 7);
  if (stale && UI.view !== 'settings') {
    h += `<div class="banner warn"><span>${last ? `Last JSON backup: ${dateLabel(last.slice(0, 10))}.` : 'No JSON backup yet.'} Browser storage is per-device and can be evicted — the JSON export is the real backup.</span>
      <button class="btn sm" onclick="A.exportJSON()">Export backup</button></div>`;
  }
  return h;
}

function renderMain() {
  const views = { budget: vBudget, accounts: vAccounts, scheduled: vScheduled, reports: vReports, import: vImport, settings: vSettings };
  document.getElementById('main').innerHTML = banners() + views[UI.view]();
  if (UI.view === 'import' && UI.imp && UI.imp.step === 1) wireDrop();
}

/* ================= BUDGET ================= */
function vBudget() {
  const m = UI.month;
  const B = budgetCache.months[m] || { tbb: 0, futureAssigned: 0, categories: {}, inflowThisMonth: 0, assignedThisMonth: 0 };
  if (!S.accounts.length) {
    return `<h1>Budget</h1>
      <div class="card empty"><div class="big">Nothing in the lagoon yet</div>
      <p>Add an account with its current balance, build a few envelopes, then give every dollar a job.</p>
      <div class="row" style="justify-content:center">
        <button class="btn" onclick="A.openAccountModal()">Add your first account</button>
        <button class="btn ghost" onclick="A.seedSample()">Seed sample data</button>
      </div></div>`;
  }
  const tbbCls = B.tbb > 0 ? 'pos' : B.tbb < 0 ? 'neg' : 'zero';
  const tbbWord = B.tbb > 0 ? 'to assign' : B.tbb < 0 ? 'over-assigned — pull money back from a category' : 'Every dollar has a job.';
  let underCount = 0;
  for (const c of S.categories) {
    if (c.hidden || !c.goal) continue;
    const row = B.categories[c.id] || { assigned: 0, available: 0 };
    if (C.goalStatus(c.goal, m, row.assigned, row.available).status === 'underfunded') underCount++;
  }
  const head = `
    <div class="row spread">
      <h1>Budget</h1>
      <div class="month-nav">
        <button aria-label="Previous month" onclick="A.month(-1)">‹</button>
        <span class="mname">${monthLabel(m)}</span>
        <button aria-label="Next month" onclick="A.month(1)">›</button>
      </div>
    </div>
    <section class="card hero" aria-live="polite">
      <span class="tag">To Be Budgeted</span>
      <div class="tbb-num ${tbbCls}">${C.fmtCAD(B.tbb)}</div>
      <div class="tbb-word ${tbbCls}">${tbbWord}</div>
      <div class="hero-meta">
        <span>Inflow this month <strong>${C.fmtCAD(B.inflowThisMonth)}</strong></span>
        <span>Assigned this month <strong>${C.fmtCAD(B.assignedThisMonth)}</strong></span>
        ${B.futureAssigned > 0 ? `<span>Assigned in future months <strong>${C.fmtCAD(B.futureAssigned)}</strong> (not subtracted here)</span>` : ''}
        ${underCount ? `<span class="amt neg">${underCount} goal${underCount > 1 ? 's' : ''} underfunded</span>` : ''}
      </div>
      <div class="waterline ${tbbCls}"></div>
    </section>`;

  let body = '';
  for (const g of S.groups) {
    const cats = S.categories.filter(c => c.groupId === g.id && !c.hidden);
    if (!cats.length && g.id === 'gCC') continue;
    body += `<tr class="grp-row"><td class="cat" colspan="4">${esc(g.name)}
      <span class="grp-tools"><button class="btn quiet sm" onclick="A.openCatModal(null,'${g.id}')">+ category</button>
      ${g.id !== 'gCC' ? `<button class="btn quiet sm" onclick="A.openGroupModal('${g.id}')">rename</button>` : ''}</span></td></tr>`;
    for (const c of cats) {
      const row = B.categories[c.id] || { assigned: 0, activity: 0, available: 0, creditOverspend: 0, cashOverspend: 0 };
      const gs = C.goalStatus(c.goal, m, row.assigned, row.available);
      const pillCls = row.available > 0 ? 'pos' : row.available < 0 ? (row.creditOverspend > 0 && row.cashOverspend === 0 ? 'debt' : 'neg') : 'zero';
      body += `<tr>
        <td class="cat">
          <button class="cat-name" onclick="A.openCatModal('${c.id}')">
            ${c.goal ? `<span class="goal-dot ${gs.status === 'underfunded' ? 'under' : 'funded'}"></span>` : ''}${esc(c.name)}
          </button>
          ${gs.status === 'underfunded' ? `<span class="goal-note">${C.fmtCAD(gs.neededCents)} more to stay on target</span>` : ''}
          ${row.creditOverspend > 0 ? `<span class="goal-note">overspent on credit — becomes card debt</span>` : ''}
          ${row.cashOverspend > 0 ? `<span class="goal-note">cash overspend — reduces next month's TBB</span>` : ''}
        </td>
        <td><input class="assign-in amt" type="text" inputmode="decimal" value="${(row.assigned / 100).toFixed(2)}"
             aria-label="Assigned to ${esc(c.name)}" onchange="A.setAssigned('${c.id}', this)"></td>
        <td>${money(row.activity)}</td>
        <td><span class="pill ${pillCls}">${C.fmtCAD(row.available)}</span></td>
      </tr>`;
    }
  }
  return head + `
    <div class="card" style="overflow:hidden"><div class="scroll-x">
    <table class="budget-table">
      <thead><tr><th>Category</th><th>Assigned</th><th>Activity</th><th>Available</th></tr></thead>
      <tbody>${body || `<tr><td class="cat" colspan="4" style="color:var(--ink-soft);padding:20px">No categories yet — add a group to start building envelopes.</td></tr>`}</tbody>
    </table></div></div>
    <div class="row budget-tools">
      <button class="btn ghost" onclick="A.openGroupModal()">+ Category group</button>
      ${underCount ? `<button class="btn" onclick="A.fundGoals()">Fund goals this month</button>` : ''}
    </div>`;
}

/* ================= ACCOUNTS / REGISTER ================= */
function vAccounts() {
  const bals = C.accountBalances(S);
  const f = UI.reg;
  const acctOpts = (sel) => `<option value="all" ${sel === 'all' ? 'selected' : ''}>All accounts</option>` +
    S.accounts.map(a => `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)}${a.closed ? ' (closed)' : ''}</option>`).join('');
  const catOpts = (sel, blankLabel) => `<option value="all" ${sel === 'all' ? 'selected' : ''}>${blankLabel || 'All categories'}</option>
    <option value="${C.INFLOW}" ${sel === C.INFLOW ? 'selected' : ''}>Inflow: To Be Budgeted</option>` +
    S.categories.map(c => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  let head = `<div class="row spread"><h1>Accounts</h1>
    <div class="row"><button class="btn ghost" onclick="A.openTransferModal()">Transfer</button>
    <button class="btn" onclick="A.openAccountModal()">+ Account</button></div></div>`;

  if (f.accountId !== 'all') {
    const a = acct(f.accountId), b = bals[f.accountId];
    if (a && b) head += `<div class="acct-head">
      <div><span class="lbl">${esc(a.name)} — working</span><span class="bal amt ${b.working < 0 ? 'neg' : ''}">${C.fmtCAD(b.working)}</span></div>
      <div><span class="lbl">Cleared (reconcile against your bank)</span><span class="bal amt ${b.cleared < 0 ? 'neg' : ''}">${C.fmtCAD(b.cleared)}</span></div>
      <div><span class="lbl">Uncleared</span><span class="bal amt">${C.fmtCAD(b.uncleared)}</span></div>
      <button class="btn quiet sm" onclick="A.openAccountModal('${a.id}')">Edit account</button>
    </div>`;
  }

  const filters = `<div class="filters">
    <select aria-label="Account filter" onchange="A.regSet('accountId', this.value)">${acctOpts(f.accountId)}</select>
    <input type="search" placeholder="Search payee or memo" value="${esc(f.q)}" aria-label="Search" oninput="A.regSearch(this.value)">
    <select aria-label="Category filter" onchange="A.regSet('categoryId', this.value)">${catOpts(f.categoryId)}</select>
    <input type="date" value="${f.from}" aria-label="From date" onchange="A.regSet('from', this.value)">
    <input type="date" value="${f.to}" aria-label="To date" onchange="A.regSet('to', this.value)">
    <select aria-label="Cleared filter" onchange="A.regSet('cleared', this.value)">
      <option value="all" ${f.cleared === 'all' ? 'selected' : ''}>Cleared + uncleared</option>
      <option value="cleared" ${f.cleared === 'cleared' ? 'selected' : ''}>Cleared only</option>
      <option value="uncleared" ${f.cleared === 'uncleared' ? 'selected' : ''}>Uncleared only</option>
    </select>
  </div>`;

  const quick = `<div class="card pad" style="margin-bottom:16px">
    <form class="quickadd" onsubmit="return A.quickAdd(this)">
      <div><label class="f" for="qaDate">Date</label><input id="qaDate" name="date" type="date" required value="${todayISO()}"></div>
      <div><label class="f" for="qaPayee">Payee</label><input id="qaPayee" name="payee" type="text" required list="payees" placeholder="Metro, Employer…"></div>
      <div><label class="f" for="qaCat">Category</label><select id="qaCat" name="categoryId">${catOpts('all', 'Uncategorized')}</select></div>
      <div><label class="f" for="qaAcct">Account</label><select id="qaAcct" name="accountId" required>${S.accounts.filter(a => !a.closed).map(a => `<option value="${a.id}" ${f.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
      <div><label class="f" for="qaAmt">Amount (− out, + in)</label><input id="qaAmt" name="amount" type="text" inputmode="text" required placeholder="-12.50"></div>
      <button class="btn" type="submit">Add</button>
    </form>
    <datalist id="payees">${payeeList().map(p => `<option value="${esc(p)}">`).join('')}</datalist>
  </div>`;

  const txns = S.transactions
    .filter(t => f.accountId === 'all' || t.accountId === f.accountId)
    .filter(t => f.categoryId === 'all' || t.categoryId === f.categoryId || (t.splits || []).some(sp => sp.categoryId === f.categoryId))
    .filter(t => !f.from || t.date >= f.from)
    .filter(t => !f.to || t.date <= f.to)
    .filter(t => f.cleared === 'all' || (f.cleared === 'cleared') === !!t.cleared)
    .filter(t => {
      if (!f.q) return true;
      const q = f.q.toLowerCase();
      return (t.payee || '').toLowerCase().includes(q) || (t.memo || '').toLowerCase().includes(q);
    })
    .sort((a, b) => b.date < a.date ? -1 : b.date > a.date ? 1 : 0)
    .slice(0, 400);

  const rows = txns.map(t => {
    const catCell = t.splits && t.splits.length
      ? `Split (${t.splits.length})`
      : t.categoryId ? esc(catName(t.categoryId)) : (t.transferPairId ? '<span class="tag">transfer</span>' : '<span class="tag">uncategorized</span>');
    return `<tr class="txn" onclick="A.openTxnModal('${t.id}')">
      <td style="white-space:nowrap">${dateLabel(t.date)}</td>
      <td>${esc(t.payee)}${t.memo ? `<div class="memo-line">${esc(t.memo)}</div>` : ''}</td>
      ${f.accountId === 'all' ? `<td>${esc((acct(t.accountId) || {}).name || '?')}</td>` : ''}
      <td>${catCell}</td>
      <td class="r">${t.amountCents < 0 ? money(t.amountCents) : ''}</td>
      <td class="r">${t.amountCents > 0 ? money(t.amountCents) : ''}</td>
      <td class="r"><button class="clr-btn ${t.cleared ? 'on' : ''}" aria-label="${t.cleared ? 'Cleared' : 'Uncleared'} — toggle" onclick="event.stopPropagation();A.toggleCleared('${t.id}')">✓</button></td>
    </tr>`;
  }).join('');

  return head + filters + quick + `<div class="card" style="overflow:hidden"><div class="scroll-x">
    <table class="reg-table"><thead><tr>
      <th>Date</th><th>Payee</th>${f.accountId === 'all' ? '<th>Account</th>' : ''}<th>Category</th>
      <th class="r">Outflow</th><th class="r">Inflow</th><th class="r">C</th>
    </tr></thead><tbody>${rows || `<tr><td colspan="7" style="padding:22px;color:var(--ink-soft)">No transactions match. Add one above or import a CSV.</td></tr>`}</tbody></table>
  </div></div>
  ${txns.length === 400 ? '<p class="sub" style="margin-top:8px">Showing the 400 most recent matches — narrow the filters to see older ones.</p>' : ''}`;
}

/* ================= SCHEDULED ================= */
function vScheduled() {
  const today = todayISO();
  const horizon = C.addDays(today, 30);
  const upcoming = [];
  for (const s of S.scheduled) {
    for (const d of C.occurrencesUntil(s.nextDate, s.freq, horizon)) upcoming.push({ date: d, s });
  }
  upcoming.sort((a, b) => a.date < b.date ? -1 : 1);
  const list = S.scheduled.map(s => {
    const due = s.nextDate <= today;
    return `<div class="sched-row ${due ? 'due' : ''}">
      <div><strong>${esc(s.payee)}</strong> · ${esc(catName(s.categoryId))} · ${esc((acct(s.accountId) || {}).name || '?')}
        <div class="when">${due ? 'Due — ' : 'Next: '}${dateLabel(s.nextDate)} · ${s.freq}</div></div>
      <div class="row">${money(s.amountCents)}
        <button class="btn sm" onclick="A.postScheduled('${s.id}')">Post now</button>
        <button class="btn sm quiet" onclick="A.skipScheduled('${s.id}')">Skip</button>
        <button class="btn sm quiet" onclick="A.openSchedModal('${s.id}')">Edit</button></div>
    </div>`;
  }).join('');
  return `<div class="row spread"><h1>Scheduled</h1><button class="btn" onclick="A.openSchedModal()">+ Scheduled transaction</button></div>
    <p class="sub">Recurring transactions post as real transactions when you say so. Their monthly totals show inside each category's editor to guide funding.</p>
    <div class="card pad">${list || '<div class="empty">No scheduled transactions yet.</div>'}</div>
    <h2>Next 30 days</h2>
    <div class="card pad">${upcoming.map(u => `<div class="sched-row"><div>${dateLabel(u.date)} — <strong>${esc(u.s.payee)}</strong></div>${money(u.s.amountCents)}</div>`).join('') || '<div class="empty">Nothing upcoming.</div>'}</div>`;
}

/* ================= REPORTS ================= */
function svgBarsH(items) { // [{label, cents}]
  if (!items.length) return '<div class="empty">No spending this month.</div>';
  const max = Math.max(...items.map(i => i.cents));
  const W = 460, rowH = 30, labelW = 150;
  const H = items.length * rowH + 6;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Spending by category">`;
  items.forEach((it, i) => {
    const y = i * rowH + 4;
    const w = Math.max(2, Math.round((W - labelW - 90) * it.cents / max));
    s += `<text x="${labelW - 8}" y="${y + 15}" text-anchor="end" font-size="12" fill="#12333A">${esc(it.label).slice(0, 22)}</text>
      <rect x="${labelW}" y="${y + 3}" width="${w}" height="16" rx="4" fill="#2F9E96"></rect>
      <text x="${labelW + w + 6}" y="${y + 15}" font-size="12" fill="#4E6A6F">${C.fmtCAD(it.cents)}</text>`;
  });
  return s + '</svg>';
}
function svgIncomeExpense(series) { // [{month, income, expense}]
  const W = 460, H = 190, pad = 28;
  const max = Math.max(1, ...series.map(s => Math.max(s.income, s.expense)));
  const bw = (W - pad * 2) / series.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Income versus expense by month">`;
  series.forEach((m, i) => {
    const x = pad + i * bw;
    const hi = Math.round((H - 50) * m.income / max), he = Math.round((H - 50) * m.expense / max);
    s += `<rect x="${x + bw * 0.14}" y="${H - 30 - hi}" width="${bw * 0.3}" height="${hi}" rx="3" fill="#2F9E96"></rect>
      <rect x="${x + bw * 0.52}" y="${H - 30 - he}" width="${bw * 0.3}" height="${he}" rx="3" fill="#0E3B43"></rect>
      <text x="${x + bw / 2}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#4E6A6F">${m.month.slice(5)}</text>`;
  });
  s += `<circle cx="${pad}" cy="12" r="5" fill="#2F9E96"></circle><text x="${pad + 10}" y="16" font-size="11" fill="#4E6A6F">income</text>
    <circle cx="${pad + 78}" cy="12" r="5" fill="#0E3B43"></circle><text x="${pad + 88}" y="16" font-size="11" fill="#4E6A6F">expense</text>`;
  return s + '</svg>';
}
function svgLine(points) { // [{month, cents}]
  const W = 460, H = 180, pad = 30;
  const vals = points.map(p => p.cents);
  const min = Math.min(0, ...vals), max = Math.max(1, ...vals);
  const x = i => pad + i * (W - pad * 2) / Math.max(1, points.length - 1);
  const y = v => H - 28 - (H - 56) * (v - min) / (max - min || 1);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.cents).toFixed(1)}`).join(' ');
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Net worth over time">
    <line x1="${pad}" y1="${y(0)}" x2="${W - pad}" y2="${y(0)}" stroke="#D5E0DC" stroke-width="1"></line>
    <path d="${path}" fill="none" stroke="#17555E" stroke-width="2.5" stroke-linejoin="round"></path>`;
  points.forEach((p, i) => {
    s += `<circle cx="${x(i)}" cy="${y(p.cents)}" r="3" fill="#17555E"></circle>`;
    if (i % 2 === 0) s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#4E6A6F">${p.month.slice(5)}</text>`;
  });
  const lastP = points[points.length - 1];
  if (lastP) s += `<text x="${W - pad}" y="${y(lastP.cents) - 8}" text-anchor="end" font-size="12" font-weight="600" fill="#0E3B43">${C.fmtCAD(lastP.cents)}</text>`;
  return s + '</svg>';
}

function vReports() {
  const m = UI.repMonth;
  const monthsBack = (n) => { const out = []; for (let i = n - 1; i >= 0; i--) out.push(C.addMonths(m, -i)); return out; };
  const spend = C.spendingByCategory(S, m);
  const items = Object.entries(spend).map(([cid, cents]) => ({ label: catName(cid), cents }))
    .sort((a, b) => b.cents - a.cents).slice(0, 12);
  const ive = C.incomeVsExpense(S, monthsBack(6));
  const iveSeries = monthsBack(6).map(mm => ({ month: mm, income: ive[mm].income, expense: ive[mm].expense }));
  const nw = C.netWorthSeries(S, monthsBack(12));
  const aom = C.ageOfMoney(S);
  const opts = [];
  for (let i = 0; i < 18; i++) { const mm = C.addMonths(curMonth(), -i); opts.push(`<option value="${mm}" ${mm === m ? 'selected' : ''}>${monthLabel(mm)}</option>`); }
  return `<div class="row spread"><h1>Reports</h1>
    <select style="width:auto" aria-label="Report month" onchange="A.repMonth(this.value)">${opts.join('')}</select></div>
    <div class="rep-grid">
      <div class="card pad rep-card"><h3>Spending by category — ${monthLabel(m)}</h3>${svgBarsH(items)}</div>
      <div class="card pad rep-card"><h3>Income vs expense — last 6 months</h3>${svgIncomeExpense(iveSeries)}</div>
      <div class="card pad rep-card"><h3>Net worth — last 12 months</h3><p class="sub" style="margin-bottom:6px">Includes tracking accounts.</p>${svgLine(nw)}</div>
      <div class="card pad rep-card"><h3>Age of money</h3>
        ${aom == null ? '<div class="empty">Needs income and spending history.</div>'
          : `<div class="aom-num">${aom} days</div><p class="sub" style="margin-top:8px">FIFO approximation over your last 10 outflows — how long a dollar sits before it's spent.</p>`}
      </div>
    </div>`;
}

/* ================= IMPORT ================= */
function freshImp() {
  return {
    step: 1, accountId: (budgetOpen()[0] || {}).id || '', fileName: '', raw: '', parsed: null,
    hasHeader: true, presetId: '',
    map: { dateCol: 0, payeeCol: 1, memoCol: -1, mode: 'signed', amountCol: 2, outCol: 2, inCol: 3, dateFmt: 'DMY', invert: false },
    defaultCatId: '', rows: null,
  };
}
function parseRow(cells, m) {
  const dateISO = C.parseDateStr(cells[m.dateCol], m.dateFmt);
  const payee = String(cells[m.payeeCol] || '').trim();
  const memo = m.memoCol >= 0 ? String(cells[m.memoCol] || '').trim() : '';
  let cents = null;
  if (m.mode === 'signed') {
    cents = C.parseMoneyToCents(cells[m.amountCol]);
    if (cents != null && m.invert) cents = -cents;
  } else {
    const out = C.parseMoneyToCents(cells[m.outCol]);
    const inn = C.parseMoneyToCents(cells[m.inCol]);
    if (out != null && out !== 0) cents = -Math.abs(out);
    else if (inn != null && inn !== 0) cents = Math.abs(inn);
    else if (out === 0 || inn === 0) cents = 0;
  }
  return { dateISO, payee, memo, cents };
}
function buildReviewRows() {
  const I = UI.imp;
  const raw = (I.hasHeader ? I.parsed.rows.slice(1) : I.parsed.rows);
  const rows = raw.map((cells, idx) => {
    const p = parseRow(cells, I.map);
    if (!p.dateISO) return { idx, ok: false, cells, reason: 'Unreadable date' };
    if (p.cents == null) return { idx, ok: false, cells, reason: 'Unreadable amount' };
    return Object.assign({ idx, ok: true, cells, dup: false, include: true }, p);
  });
  const existingKeys = S.transactions.filter(t => t.accountId === I.accountId)
    .map(t => C.importKey(I.accountId, t.date, t.amountCents, t.payee));
  const goodRows = rows.filter(r => r.ok);
  const flags = C.flagDuplicates(existingKeys, goodRows.map(r => C.importKey(I.accountId, r.dateISO, r.cents, r.payee)));
  goodRows.forEach((r, i) => { r.dup = flags[i]; r.include = !flags[i]; });
  I.rows = rows;
}

function vImport() {
  if (!UI.imp) UI.imp = freshImp();
  const I = UI.imp;
  if (!S.accounts.length) return `<h1>Import</h1><div class="card empty"><div class="big">Add an account first</div><p>Imported rows need an account to land in.</p><button class="btn" onclick="A.openAccountModal()">Add account</button></div>`;
  const steps = `<div class="steps">
    <span class="${I.step === 1 ? 'on' : ''}">1 · File & account</span><span>→</span>
    <span class="${I.step === 2 ? 'on' : ''}">2 · Map columns</span><span>→</span>
    <span class="${I.step === 3 ? 'on' : ''}">3 · Review & commit</span></div>`;
  let body = '';

  if (I.step === 1) {
    body = `<div class="card pad">
      <label class="f" for="impAcct">Import into account</label>
      <select id="impAcct" onchange="A.impSet('accountId', this.value)">${S.accounts.filter(a => !a.closed).map(a => `<option value="${a.id}" ${I.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      ${S.mappingPresets.length ? `<label class="f" for="impPreset">Mapping preset</label>
      <select id="impPreset" onchange="A.impPreset(this.value)"><option value="">— none / set up manually —</option>
        ${S.mappingPresets.map(p => `<option value="${p.id}" ${I.presetId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
      <label class="f">CSV file</label>
      <div class="drop" id="dropzone">
        <p><strong>Drop a .csv here</strong> or</p>
        <input type="file" accept=".csv,text/csv,text/plain" onchange="A.impFile(this.files[0])" aria-label="Choose CSV file" style="width:auto">
        ${I.fileName ? `<p>Loaded: <strong>${esc(I.fileName)}</strong>${I.parsed ? ' — ' + I.parsed.rows.length + ' rows' : ''}</p>` : ''}
      </div>
      ${I.parsed && I.parsed.errors.length ? `<div class="banner warn" style="margin-top:12px">${I.parsed.errors.length} parsing issue(s), e.g. line ${I.parsed.errors[0].line}: ${esc(I.parsed.errors[0].message)}. Problem rows are kept and shown so nothing is silently lost.</div>` : ''}
      <div class="actions" style="display:flex;justify-content:flex-end;margin-top:14px">
        <button class="btn" ${I.parsed && I.parsed.rows.length ? '' : 'disabled'} onclick="A.impGoto(2)">Next: map columns</button>
      </div></div>`;
  }

  if (I.step === 2) {
    const rows = I.parsed.rows;
    const header = I.hasHeader ? rows[0] : rows[0].map((_, i) => 'Column ' + (i + 1));
    const colOpts = (sel, allowNone) => (allowNone ? `<option value="-1" ${sel === -1 ? 'selected' : ''}>— none —</option>` : '') +
      header.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(String(h).slice(0, 28) || 'Column ' + (i + 1))}</option>`).join('');
    const m = I.map;
    const dataRows = (I.hasHeader ? rows.slice(1) : rows).slice(0, 8);
    const prev = dataRows.map(r => {
      const p = parseRow(r, m);
      return `<tr>
        <td class="${p.dateISO ? 'okp' : 'bad'}">${p.dateISO ? dateLabel(p.dateISO) : 'unparsed: ' + esc(r[m.dateCol] || '∅')}</td>
        <td>${esc(p.payee || '∅')}</td>
        <td class="${p.cents == null ? 'bad' : 'okp'}">${p.cents == null ? 'unparsed' : `<span class="amt ${p.cents < 0 ? 'neg' : 'pos'}">${C.fmtCAD(p.cents)}</span>`}</td>
        <td>${esc(p.memo || '')}</td></tr>`;
    }).join('');
    body = `<div class="card pad">
      <div class="row spread">
        <label class="row" style="gap:8px"><input type="checkbox" style="width:auto;min-height:0" ${I.hasHeader ? 'checked' : ''} onchange="A.impSet('hasHeader', this.checked)"> First row is a header</label>
        <div class="seg" role="group" aria-label="Amount layout">
          <button aria-pressed="${m.mode === 'signed'}" onclick="A.impMap('mode','signed')">One signed amount</button>
          <button aria-pressed="${m.mode === 'split'}" onclick="A.impMap('mode','split')">Outflow / inflow columns</button>
        </div>
      </div>
      <div class="grid2">
        <div><label class="f">Date column</label><select onchange="A.impMap('dateCol', +this.value)">${colOpts(m.dateCol)}</select></div>
        <div><label class="f">Date format</label><select onchange="A.impMap('dateFmt', this.value)">
          <option value="DMY" ${m.dateFmt === 'DMY' ? 'selected' : ''}>Day / Month / Year</option>
          <option value="MDY" ${m.dateFmt === 'MDY' ? 'selected' : ''}>Month / Day / Year</option>
          <option value="YMD" ${m.dateFmt === 'YMD' ? 'selected' : ''}>Year / Month / Day (ISO)</option></select></div>
        <div><label class="f">Payee / description column</label><select onchange="A.impMap('payeeCol', +this.value)">${colOpts(m.payeeCol)}</select></div>
        <div><label class="f">Memo column</label><select onchange="A.impMap('memoCol', +this.value)">${colOpts(m.memoCol, true)}</select></div>
        ${m.mode === 'signed'
          ? `<div><label class="f">Amount column</label><select onchange="A.impMap('amountCol', +this.value)">${colOpts(m.amountCol)}</select></div>
             <div><label class="f" style="visibility:hidden">.</label><label class="row" style="gap:8px"><input type="checkbox" style="width:auto;min-height:0" ${m.invert ? 'checked' : ''} onchange="A.impMap('invert', this.checked)"> Flip sign (statement shows spending as positive)</label></div>`
          : `<div><label class="f">Outflow column</label><select onchange="A.impMap('outCol', +this.value)">${colOpts(m.outCol)}</select></div>
             <div><label class="f">Inflow column</label><select onchange="A.impMap('inCol', +this.value)">${colOpts(m.inCol)}</select></div>`}
      </div>
      <h2 style="margin-top:18px">Parsed preview — check the dates read correctly</h2>
      <div class="scroll-x"><table class="prev-table"><thead><tr><th>Date (parsed)</th><th>Payee</th><th>Amount (parsed)</th><th>Memo</th></tr></thead><tbody>${prev}</tbody></table></div>
      <div class="row" style="margin-top:14px">
        <input type="text" id="presetName" placeholder="Preset name, e.g. RBC Chequing" style="max-width:240px" aria-label="Preset name" value="${esc((S.mappingPresets.find(p => p.id === I.presetId) || {}).name || '')}">
        <button class="btn ghost sm" onclick="A.impSavePreset()">Save mapping as preset</button>
      </div>
      <div class="actions" style="display:flex;justify-content:space-between;margin-top:14px">
        <button class="btn quiet" onclick="A.impGoto(1)">‹ Back</button>
        <button class="btn" onclick="A.impGoto(3)">Next: review duplicates</button>
      </div></div>`;
  }

  if (I.step === 3) {
    const rows = I.rows;
    const catOpts = `<option value="">Uncategorized (assign later)</option><option value="${C.INFLOW}" ${I.defaultCatId === C.INFLOW ? 'selected' : ''}>Inflow: To Be Budgeted</option>` +
      S.categories.map(c => `<option value="${c.id}" ${I.defaultCatId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const good = rows.filter(r => r.ok);
    const dupCount = good.filter(r => r.dup).length;
    const incCount = good.filter(r => r.include).length;
    body = `<div class="card pad">
      <p class="sub" style="margin-bottom:12px">${good.length} rows parsed for <strong>${esc((acct(I.accountId) || {}).name || '')}</strong> · ${dupCount} flagged as likely duplicates (unticked below) · ${rows.length - good.length} unreadable rows skipped and listed at the bottom.</p>
      <label class="f" for="bulkCat">Category for all imported rows</label>
      <select id="bulkCat" onchange="A.impSet('defaultCatId', this.value)" style="max-width:340px">${catOpts}</select>
      <div class="scroll-x" style="margin-top:14px"><table class="prev-table"><thead><tr><th></th><th>Date</th><th>Payee</th><th>Amount</th><th></th></tr></thead><tbody>
        ${good.map(r => `<tr>
          <td><input type="checkbox" style="width:auto;min-height:0" ${r.include ? 'checked' : ''} onchange="A.impToggle(${r.idx})" aria-label="Include row"></td>
          <td>${dateLabel(r.dateISO)}</td><td>${esc(r.payee)}</td>
          <td><span class="amt ${r.cents < 0 ? 'neg' : 'pos'}">${C.fmtCAD(r.cents)}</span></td>
          <td>${r.dup ? '<span class="dup-badge">LIKELY DUPLICATE</span>' : ''}</td></tr>`).join('')}
      </tbody></table></div>
      ${rows.some(r => !r.ok) ? `<h2>Skipped rows</h2><div class="scroll-x"><table class="prev-table"><tbody>
        ${rows.filter(r => !r.ok).map(r => `<tr><td class="bad">${esc(r.reason)}</td><td>${esc(r.cells.join(' · ').slice(0, 120))}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="actions" style="display:flex;justify-content:space-between;margin-top:16px">
        <button class="btn quiet" onclick="A.impGoto(2)">‹ Back to mapping</button>
        <button class="btn" ${incCount ? '' : 'disabled'} onclick="A.impCommit()">Import ${incCount} transaction${incCount === 1 ? '' : 's'}</button>
      </div></div>`;
  }
  return `<h1>Import CSV</h1><p class="sub">Imported rows arrive marked cleared — they came from the bank.</p>${steps}${body}`;
}

/* ================= SETTINGS ================= */
function vSettings() {
  const last = S.meta.lastExport;
  return `<h1>Settings</h1>
  <div class="card pad set-block">
    <h2 style="margin-top:0">Backup</h2>
    <p class="sub">Autosave keeps data in this browser's localStorage — per-device, per-browser, and evictable. <strong>The JSON export is the real backup.</strong> Export after every session.</p>
    <p>Last export: <strong>${last ? dateLabel(last.slice(0, 10)) : 'never'}</strong></p>
    <div class="row">
      <button class="btn" onclick="A.exportJSON()">Export backup (JSON)</button>
      <label class="btn ghost" style="display:inline-block">Restore from backup<input type="file" accept=".json,application/json" style="display:none" onchange="A.restoreJSON(this.files[0])"></label>
    </div>
  </div>
  <div class="card pad set-block">
    <h2 style="margin-top:0">About & known limits</h2>
    <ul class="limits">
      <li><strong>Credit cards:</strong> spending on a credit account in a budgeted category automatically moves coverage into that card's payment category. Simplified relative to full YNAB: pre-existing card debt at setup isn't auto-budgeted (assign to the payment category yourself); refunds pull coverage back out naively; coverage isn't reassignable across months.</li>
      <li><strong>Overspending:</strong> cash overspending resets the envelope to $0 and reduces <em>next</em> month's To Be Budgeted. Credit overspending becomes card debt and does not touch TBB.</li>
      <li><strong>TBB and future months:</strong> money assigned in future months is shown as its own line under the hero number, not silently subtracted from this month's TBB.</li>
      <li><strong>Age of money:</strong> a FIFO approximation over the last 10 outflows, not YNAB's exact algorithm.</li>
      <li><strong>Scheduled transactions:</strong> plain transactions only in this version — no scheduled transfers.</li>
      <li><strong>Type:</strong> system font stacks (New York / system sans) instead of the suite's Carter One + Atkinson Hyperlegible — embedding webfonts would break the zero-dependency, fully-offline constraint.</li>
      <li><strong>Dependencies:</strong> none. CSV parsing and charts are built in, so nothing breaks offline.</li>
    </ul>
  </div>
  <div class="card pad set-block">
    <h2 style="margin-top:0">Danger zone</h2>
    <div class="row">
      ${S.transactions.length === 0 ? '<button class="btn ghost" onclick="A.seedSample()">Seed sample data</button>' : ''}
      <button class="btn danger" onclick="A.eraseAll()">Erase all data</button>
    </div>
  </div>`;
}

/* ================= MODALS ================= */
function renderModal() {
  const root = document.getElementById('modalRoot');
  if (!UI.modal) { root.innerHTML = ''; document.body.style.overflow = ''; return; }
  document.body.style.overflow = 'hidden';
  const builders = { txn: mTxn, account: mAccount, category: mCategory, group: mGroup, sched: mSched, transfer: mTransfer };
  root.innerHTML = `<div class="overlay" onclick="if(event.target===this)A.closeModal()"><div class="modal" role="dialog" aria-modal="true">${builders[UI.modal.kind]()}</div></div>`;
  const first = root.querySelector('input, select');
  if (first) first.focus();
}

function catSelectOpts(sel, inflow) {
  return `<option value="" ${!sel ? 'selected' : ''}>Uncategorized</option>` +
    (inflow ? `<option value="${C.INFLOW}" ${sel === C.INFLOW ? 'selected' : ''}>Inflow: To Be Budgeted</option>` : '') +
    S.groups.map(g => `<optgroup label="${esc(g.name)}">` +
      S.categories.filter(c => c.groupId === g.id).map(c => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('') + '</optgroup>').join('');
}

function mTxn() {
  const M = UI.modal;
  const t = M.id ? S.transactions.find(x => x.id === M.id) : null;
  if (t && t.transferPairId) {
    const pair = S.transactions.find(x => x.id === t.transferPairId);
    const from = t.amountCents < 0 ? t : pair, to = t.amountCents < 0 ? pair : t;
    return `<h3>Transfer</h3>
      <p class="sub">${esc((acct(from.accountId) || {}).name)} → ${esc((acct(to.accountId) || {}).name)}</p>
      <label class="f">Amount</label><input id="mAmt" type="text" inputmode="decimal" value="${(Math.abs(t.amountCents) / 100).toFixed(2)}">
      <label class="f">Date</label><input id="mDate" type="date" value="${t.date}">
      ${from.categoryId != null && from.categoryId !== '' ? `<label class="f">Category (budget → tracking)</label><select id="mCat">${catSelectOpts(from.categoryId)}</select>` : ''}
      <div class="actions">
        <button class="btn danger" onclick="A.deleteTxnConfirm('${t.id}')">Delete both sides</button>
        <button class="btn quiet" onclick="A.closeModal()">Cancel</button>
        <button class="btn" onclick="A.saveTransferEdit('${t.id}')">Save</button>
      </div>`;
  }
  const v = t || { date: todayISO(), payee: '', categoryId: '', accountId: (M.accountId || (S.accounts[0] || {}).id), amountCents: 0, memo: '', cleared: false, splits: null };
  if (M.splits === undefined) M.splits = v.splits ? v.splits.map(sp => ({ categoryId: sp.categoryId, val: (Math.abs(sp.amountCents) / 100).toFixed(2), neg: sp.amountCents < 0 })) : null;
  const splits = M.splits;
  return `<h3>${t ? 'Edit transaction' : 'New transaction'}</h3>
    <div class="grid2">
      <div><label class="f">Date</label><input id="mDate" type="date" value="${v.date}"></div>
      <div><label class="f">Account</label><select id="mAcct">${S.accounts.map(a => `<option value="${a.id}" ${v.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
    </div>
    <label class="f">Payee</label><input id="mPayee" type="text" list="mPayees" value="${esc(v.payee)}">
    <label class="f">Amount (use − for outflow)</label><input id="mAmt" type="text" inputmode="text" value="${t ? (v.amountCents / 100).toFixed(2) : ''}" placeholder="-12.50">
    ${splits ? `
      <label class="f">Splits (must sum to the amount)</label>
      ${splits.map((sp, i) => `<div class="split-row">
        <select onchange="A.splitSet(${i},'categoryId',this.value)">${catSelectOpts(sp.categoryId)}</select>
        <input type="text" inputmode="text" value="${sp.neg ? '-' : ''}${sp.val}" aria-label="Split amount" onchange="A.splitSet(${i},'amount',this.value)">
        <button class="btn quiet sm" aria-label="Remove split" onclick="A.splitRemove(${i})">✕</button></div>`).join('')}
      <button class="btn ghost sm" onclick="A.splitAdd()">+ split line</button>`
    : `<label class="f">Category</label><select id="mCat">${catSelectOpts(v.categoryId, true)}</select>
       <button class="btn quiet sm" style="margin-top:8px" onclick="A.splitStart()">Split across categories…</button>`}
    <label class="f">Memo</label><input id="mMemo" type="text" value="${esc(v.memo)}">
    <label class="row" style="gap:8px;margin-top:12px"><input id="mClr" type="checkbox" style="width:auto;min-height:0" ${v.cleared ? 'checked' : ''}> Cleared (matches the bank)</label>
    <div class="actions">
      ${t ? `<button class="btn danger" onclick="A.deleteTxnConfirm('${t.id}')">Delete</button>` : ''}
      <button class="btn quiet" onclick="A.closeModal()">Cancel</button>
      <button class="btn" onclick="A.saveTxn('${t ? t.id : ''}')">Save</button>
    </div>
    <datalist id="mPayees">${payeeList().map(p => `<option value="${esc(p)}">`).join('')}</datalist>`;
}

function mAccount() {
  const M = UI.modal;
  const a = M.id ? acct(M.id) : null;
  return `<h3>${a ? 'Edit account' : 'New account'}</h3>
    <label class="f">Name</label><input id="mName" type="text" value="${a ? esc(a.name) : ''}" placeholder="RBC Chequing">
    <label class="f">Type</label>
    <select id="mType" ${a ? 'disabled' : ''}>
      ${C.ACCOUNT_TYPES.map(t => `<option value="${t}" ${a && a.type === t ? 'selected' : ''}>${t === 'tracking' ? 'tracking (off-budget: investments etc.)' : t}</option>`).join('')}
    </select>
    ${a ? '<p class="sub" style="margin-top:6px">Type is fixed after creation — the budget math depends on it.</p>' : `
    <label class="f">Current balance (credit cards: enter debt as a negative number)</label>
    <input id="mBal" type="text" inputmode="text" placeholder="1234.56">
    <label class="f">As of</label><input id="mAsOf" type="date" value="${todayISO()}">`}
    <div class="actions">
      ${a ? `<button class="btn quiet" onclick="A.toggleClosed('${a.id}')">${a.closed ? 'Reopen' : 'Close account'}</button>
             <button class="btn danger" onclick="A.deleteAccount('${a.id}')">Delete</button>` : ''}
      <button class="btn quiet" onclick="A.closeModal()">Cancel</button>
      <button class="btn" onclick="A.saveAccount('${a ? a.id : ''}')">Save</button>
    </div>`;
}

function mCategory() {
  const M = UI.modal;
  const c = M.id ? cat(M.id) : null;
  if (M.goal === undefined) M.goal = c && c.goal ? { ...c.goal } : null;
  const goal = M.goal;
  let schedNote = '';
  if (c) {
    const monthEnd = UI.month + '-31';
    const monthStart = UI.month + '-01';
    let total = 0;
    for (const s of S.scheduled) {
      if (s.categoryId !== c.id) continue;
      for (const d of C.occurrencesUntil(s.nextDate, s.freq, monthEnd)) if (d >= monthStart) total += s.amountCents;
    }
    if (total !== 0) schedNote = `<p class="sub">Scheduled in ${monthLabel(UI.month)}: <strong>${C.fmtCAD(total)}</strong> — a floor for what to assign.</p>`;
  }
  const isPayment = c && c.paymentForAccountId;
  return `<h3>${c ? 'Edit category' : 'New category'}</h3>
    ${isPayment ? `<p class="sub">Payment category for ${esc((acct(c.paymentForAccountId) || {}).name || '')} — coverage flows here automatically.</p>` : ''}
    <label class="f">Name</label><input id="mName" type="text" value="${c ? esc(c.name) : ''}">
    ${schedNote}
    ${isPayment ? '' : `<label class="f">Goal</label>
    <div class="seg" role="group" aria-label="Goal type">
      <button aria-pressed="${!goal}" onclick="A.goalSet(null)">None</button>
      <button aria-pressed="${!!goal && goal.type === 'monthly'}" onclick="A.goalSet('monthly')">Monthly target</button>
      <button aria-pressed="${!!goal && goal.type === 'byDate'}" onclick="A.goalSet('byDate')">Needed by date</button>
    </div>
    ${goal ? `<div class="grid2" style="margin-top:8px">
      <div><label class="f">Amount</label><input id="mGoalAmt" type="text" inputmode="decimal" value="${goal.amountCents ? (goal.amountCents / 100).toFixed(2) : ''}"></div>
      ${goal.type === 'byDate' ? `<div><label class="f">By month</label><input id="mGoalDue" type="month" value="${goal.dueMonth || C.addMonths(curMonth(), 3)}"></div>` : ''}
    </div>` : ''}`}
    <div class="actions">
      ${c && !isPayment ? `<button class="btn quiet" onclick="A.toggleHideCat('${c.id}')">${c.hidden ? 'Unhide' : 'Hide'}</button>
        <button class="btn danger" onclick="A.deleteCat('${c.id}')">Delete</button>` : ''}
      <button class="btn quiet" onclick="A.closeModal()">Cancel</button>
      <button class="btn" onclick="A.saveCat('${c ? c.id : ''}','${M.groupId || (c ? c.groupId : '')}')">Save</button>
    </div>`;
}

function mGroup() {
  const M = UI.modal;
  const g = M.id ? group(M.id) : null;
  return `<h3>${g ? 'Rename group' : 'New category group'}</h3>
    <label class="f">Name</label><input id="mName" type="text" value="${g ? esc(g.name) : ''}" placeholder="Everyday, Bills, Savings…">
    <div class="actions">
      ${g ? `<button class="btn danger" onclick="A.deleteGroup('${g.id}')">Delete</button>` : ''}
      <button class="btn quiet" onclick="A.closeModal()">Cancel</button>
      <button class="btn" onclick="A.saveGroup('${g ? g.id : ''}')">Save</button>
    </div>`;
}

function mSched() {
  const M = UI.modal;
  const s = M.id ? S.scheduled.find(x => x.id === M.id) : null;
  const v = s || { payee: '', accountId: (S.accounts[0] || {}).id, categoryId: '', amountCents: 0, memo: '', freq: 'monthly', nextDate: todayISO() };
  return `<h3>${s ? 'Edit scheduled transaction' : 'New scheduled transaction'}</h3>
    <label class="f">Payee</label><input id="mPayee" type="text" value="${esc(v.payee)}">
    <div class="grid2">
      <div><label class="f">Account</label><select id="mAcct">${S.accounts.filter(a => !a.closed).map(a => `<option value="${a.id}" ${v.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
      <div><label class="f">Category</label><select id="mCat">${catSelectOpts(v.categoryId, true)}</select></div>
      <div><label class="f">Amount (− out)</label><input id="mAmt" type="text" inputmode="text" value="${s ? (v.amountCents / 100).toFixed(2) : ''}"></div>
      <div><label class="f">Repeats</label><select id="mFreq">
        ${['weekly', 'biweekly', 'monthly', 'yearly'].map(fq => `<option value="${fq}" ${v.freq === fq ? 'selected' : ''}>${fq}</option>`).join('')}</select></div>
      <div><label class="f">Next date</label><input id="mDate" type="date" value="${v.nextDate}"></div>
    </div>
    <label class="f">Memo</label><input id="mMemo" type="text" value="${esc(v.memo)}">
    <div class="actions">
      ${s ? `<button class="btn danger" onclick="A.deleteSched('${s.id}')">Delete</button>` : ''}
      <button class="btn quiet" onclick="A.closeModal()">Cancel</button>
      <button class="btn" onclick="A.saveSched('${s ? s.id : ''}')">Save</button>
    </div>`;
}

function mTransfer() {
  const accts = S.accounts.filter(a => !a.closed);
  return `<h3>Transfer between accounts</h3>
    <div class="grid2">
      <div><label class="f">From</label><select id="mFrom">${accts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div>
      <div><label class="f">To</label><select id="mTo">${accts.map((a, i) => `<option value="${a.id}" ${i === 1 ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
      <div><label class="f">Amount</label><input id="mAmt" type="text" inputmode="decimal" placeholder="150.00"></div>
      <div><label class="f">Date</label><input id="mDate" type="date" value="${todayISO()}"></div>
    </div>
    <label class="f">Category (only used when moving budget → tracking money)</label>
    <select id="mCat">${catSelectOpts('')}</select>
    <label class="f">Memo</label><input id="mMemo" type="text">
    <p class="sub" style="margin-top:10px">Paying a credit card is a transfer to it — the payment category drains automatically.</p>
    <div class="actions">
      <button class="btn quiet" onclick="A.closeModal()">Cancel</button>
      <button class="btn" onclick="A.saveTransfer()">Save transfer</button>
    </div>`;
}

/* ================= ACTIONS ================= */
function val(id) { const el = document.getElementById(id); return el ? el.value : null; }
function moneyVal(id) { return C.parseMoneyToCents(val(id)); }

const A = {
  nav(v) { UI.view = v; if (v === 'import' && !UI.imp) UI.imp = freshImp(); render(); },
  month(d) { UI.month = C.addMonths(UI.month, d); render(); },
  repMonth(m) { UI.repMonth = m; render(); },
  gotoAccount(id) { UI.view = 'accounts'; UI.reg.accountId = id; render(); },
  regSet(k, v) { UI.reg[k] = v; render(); },
  regSearch(v) {
    UI.reg.q = v;
    clearTimeout(A._st);
    A._st = setTimeout(() => {
      const wasSearch = document.activeElement && document.activeElement.type === 'search';
      render();
      if (wasSearch) {
        const s = document.querySelector('input[type=search]');
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      }
    }, 300);
  },
  closeModal() { UI.modal = null; renderModal(); },
  dismissLoadProblem() { if (confirm('Start fresh? The unreadable saved data will be overwritten on the next change. Download it first if in doubt.')) { UI.loadProblem = null; commit(); } },
  downloadRaw() {
    const blob = new Blob([UI.loadProblem.raw], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'lagoon-ledger-unreadable-' + todayISO() + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },

  /* budget */
  setAssigned(cid, el) {
    const cents = C.parseMoneyToCents(el.value);
    if (cents == null) { el.value = '0.00'; return; }
    S.assigned[UI.month] = S.assigned[UI.month] || {};
    if (cents === 0) delete S.assigned[UI.month][cid]; else S.assigned[UI.month][cid] = cents;
    if (!Object.keys(S.assigned[UI.month]).length) delete S.assigned[UI.month];
    commit();
  },
  fundGoals() {
    const m = UI.month;
    let total = 0; const plan = [];
    for (const c of S.categories) {
      if (c.hidden || !c.goal) continue;
      const row = (budgetCache.months[m] && budgetCache.months[m].categories[c.id]) || { assigned: 0, available: 0 };
      const gs = C.goalStatus(c.goal, m, row.assigned, row.available);
      if (gs.status === 'underfunded' && gs.neededCents > 0) { plan.push([c.id, gs.neededCents]); total += gs.neededCents; }
    }
    if (!plan.length) return;
    const tbb = budgetCache.months[m].tbb;
    if (!confirm(`Assign ${C.fmtCAD(total)} across ${plan.length} underfunded goal${plan.length > 1 ? 's' : ''}?` + (total > tbb ? `\n\nHeads up: that's more than your ${C.fmtCAD(tbb)} TBB — it will go negative.` : ''))) return;
    S.assigned[m] = S.assigned[m] || {};
    for (const [cid, add] of plan) S.assigned[m][cid] = (S.assigned[m][cid] || 0) + add;
    commit();
  },

  /* transactions */
  quickAdd(form) {
    const fd = new FormData(form);
    const cents = C.parseMoneyToCents(fd.get('amount'));
    const date = fd.get('date');
    if (cents == null || !date) { alert('Enter a date and a readable amount (use − for spending).'); return false; }
    let categoryId = fd.get('categoryId'); if (categoryId === 'all') categoryId = null;
    S.transactions.push({ id: C.uid(), accountId: fd.get('accountId'), date, payee: String(fd.get('payee')).trim(), categoryId: categoryId || null, amountCents: cents, memo: '', cleared: false });
    commit();
    setTimeout(() => { const p = document.getElementById('qaPayee'); if (p) p.focus(); }, 0);
    return false;
  },
  openTxnModal(id) { UI.modal = { kind: 'txn', id: id || null }; renderModal(); },
  toggleCleared(id) { const t = S.transactions.find(x => x.id === id); if (t) { t.cleared = !t.cleared; commit(); } },
  _stash() { // keep typed values across in-modal rerenders
    const M = UI.modal;
    const s = { date: val('mDate'), payee: val('mPayee'), amt: val('mAmt'), memo: val('mMemo'), acct: val('mAcct'), clr: (document.getElementById('mClr') || {}).checked };
    setTimeout(() => {
      const put = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
      put('mDate', s.date); put('mPayee', s.payee); put('mAmt', s.amt); put('mMemo', s.memo); put('mAcct', s.acct);
      const clr = document.getElementById('mClr'); if (clr && s.clr != null) clr.checked = s.clr;
    }, 0);
  },
  splitStart() { A._stash(); UI.modal.splits = [{ categoryId: '', val: '', neg: true }, { categoryId: '', val: '', neg: true }]; renderModal(); },
  splitAdd() { A._stash(); UI.modal.splits.push({ categoryId: '', val: '', neg: true }); renderModal(); },
  splitRemove(i) { A._stash(); UI.modal.splits.splice(i, 1); if (!UI.modal.splits.length) UI.modal.splits = null; renderModal(); },
  splitSet(i, k, v) {
    const sp = UI.modal.splits[i];
    if (k === 'categoryId') sp.categoryId = v;
    else { const c = C.parseMoneyToCents(v); sp.neg = c != null && c < 0; sp.val = c == null ? '' : (Math.abs(c) / 100).toFixed(2); }
  },
  saveTxn(id) {
    const cents = moneyVal('mAmt');
    const date = val('mDate');
    if (cents == null || !date) { alert('Enter a date and a readable amount.'); return; }
    let splits;
    if (UI.modal.splits) {
      splits = [];
      let sum = 0;
      for (const sp of UI.modal.splits) {
        const c = C.parseMoneyToCents((sp.neg ? '-' : '') + sp.val);
        if (c == null || !sp.categoryId) { alert('Every split line needs a category and an amount.'); return; }
        splits.push({ categoryId: sp.categoryId, amountCents: c }); sum += c;
      }
      if (sum !== cents) { alert(`Splits sum to ${C.fmtCAD(sum)} but the transaction is ${C.fmtCAD(cents)}. They must match to the cent.`); return; }
    }
    const data = {
      accountId: val('mAcct'), date, payee: String(val('mPayee') || '').trim(),
      categoryId: splits ? null : (val('mCat') || null), amountCents: cents,
      memo: String(val('mMemo') || ''), cleared: !!(document.getElementById('mClr') || {}).checked,
    };
    if (id) {
      const t = S.transactions.find(x => x.id === id);
      Object.assign(t, data);
      if (splits) t.splits = splits; else delete t.splits;
    } else {
      const t = Object.assign({ id: C.uid() }, data);
      if (splits) t.splits = splits;
      S.transactions.push(t);
    }
    UI.modal = null; commit();
  },
  deleteTxnConfirm(id) { if (confirm('Delete this transaction?')) { deleteTxn(id); UI.modal = null; commit(); } },
  saveTransferEdit(id) {
    const t = S.transactions.find(x => x.id === id); const pair = S.transactions.find(x => x.id === t.transferPairId);
    const cents = moneyVal('mAmt'); const date = val('mDate');
    if (cents == null || cents <= 0 || !date) { alert('Enter a positive amount and a date.'); return; }
    const from = t.amountCents < 0 ? t : pair, to = t.amountCents < 0 ? pair : t;
    from.amountCents = -cents; to.amountCents = cents; from.date = date; to.date = date;
    const catEl = document.getElementById('mCat'); if (catEl) from.categoryId = catEl.value || null;
    UI.modal = null; commit();
  },

  /* accounts */
  openAccountModal(id) { UI.modal = { kind: 'account', id: id || null }; renderModal(); },
  saveAccount(id) {
    const name = String(val('mName') || '').trim();
    if (!name) { alert('Name the account.'); return; }
    if (id) {
      const a = acct(id); a.name = name;
      const pc = paymentCatForCard(id); if (pc) pc.name = name + ' Payment';
    } else {
      const a = { id: C.uid(), name, type: val('mType'), closed: false };
      S.accounts.push(a);
      if (C.isCreditAccount(a)) ensurePaymentCategory(a);
      const bal = moneyVal('mBal');
      if (bal != null && bal !== 0) {
        S.transactions.push({
          id: C.uid(), accountId: a.id, date: val('mAsOf') || todayISO(), payee: 'Starting balance',
          categoryId: (C.isBudgetAccount(a) && !C.isCreditAccount(a) && bal > 0) ? C.INFLOW : null,
          amountCents: bal, memo: '', cleared: true,
        });
      }
    }
    UI.modal = null; commit();
  },
  toggleClosed(id) { const a = acct(id); a.closed = !a.closed; UI.modal = null; commit(); },
  deleteAccount(id) {
    const n = S.transactions.filter(t => t.accountId === id).length;
    if (n) { alert(`This account has ${n} transaction${n > 1 ? 's' : ''}. Close it instead of deleting, or delete its transactions first.`); return; }
    if (!confirm('Delete this account?')) return;
    const pc = paymentCatForCard(id);
    if (pc) {
      const pcUsed = Object.values(S.assigned).some(m => pc.id in m);
      if (!pcUsed) S.categories = S.categories.filter(c => c.id !== pc.id);
    }
    S.accounts = S.accounts.filter(a => a.id !== id);
    if (UI.reg.accountId === id) UI.reg.accountId = 'all';
    UI.modal = null; commit();
  },
  openTransferModal() { UI.modal = { kind: 'transfer' }; renderModal(); },
  saveTransfer() {
    const fromId = val('mFrom'), toId = val('mTo'), cents = moneyVal('mAmt'), date = val('mDate');
    if (fromId === toId) { alert('Pick two different accounts.'); return; }
    if (cents == null || cents <= 0 || !date) { alert('Enter a positive amount and a date.'); return; }
    makeTransfer({ fromId, toId, date, cents, memo: String(val('mMemo') || ''), categoryId: val('mCat') || null });
    UI.modal = null; commit();
  },

  /* categories & groups */
  openCatModal(id, groupId) { UI.modal = { kind: 'category', id: id || null, groupId: groupId || null }; renderModal(); },
  goalSet(type) {
    const M = UI.modal;
    const keepName = val('mName');
    const amt = moneyVal('mGoalAmt');
    M.goal = type === null ? null : { type, amountCents: amt || (M.goal && M.goal.amountCents) || 0, dueMonth: (M.goal && M.goal.dueMonth) || C.addMonths(curMonth(), 3) };
    renderModal();
    setTimeout(() => { const el = document.getElementById('mName'); if (el && keepName != null) el.value = keepName; }, 0);
  },
  saveCat(id, groupId) {
    const name = String(val('mName') || '').trim();
    if (!name) { alert('Name the category.'); return; }
    let goal = null;
    if (UI.modal.goal) {
      const amt = moneyVal('mGoalAmt');
      if (amt == null || amt <= 0) { alert('Goals need a positive amount.'); return; }
      goal = { type: UI.modal.goal.type, amountCents: amt };
      if (goal.type === 'byDate') goal.dueMonth = val('mGoalDue') || C.addMonths(curMonth(), 3);
    }
    if (id) {
      const c = cat(id); c.name = name;
      if (!c.paymentForAccountId) { if (goal) c.goal = goal; else delete c.goal; }
    } else {
      if (!groupId) { alert('No group selected.'); return; }
      const c = { id: C.uid(), groupId, name };
      if (goal) c.goal = goal;
      S.categories.push(c);
    }
    UI.modal = null; commit();
  },
  toggleHideCat(id) { const c = cat(id); c.hidden = !c.hidden; UI.modal = null; commit(); },
  deleteCat(id) {
    const used = S.transactions.filter(t => t.categoryId === id || (t.splits || []).some(sp => sp.categoryId === id)).length;
    const assignedAnywhere = Object.values(S.assigned).some(m => id in m);
    if (used || assignedAnywhere) { alert(`Can't delete: ${used} transaction${used === 1 ? '' : 's'}${assignedAnywhere ? ' and past assignments' : ''} reference it. Recategorize those first, or hide the category instead.`); return; }
    if (!confirm('Delete this category?')) return;
    S.categories = S.categories.filter(c => c.id !== id);
    UI.modal = null; commit();
  },
  openGroupModal(id) { UI.modal = { kind: 'group', id: id || null }; renderModal(); },
  saveGroup(id) {
    const name = String(val('mName') || '').trim();
    if (!name) { alert('Name the group.'); return; }
    if (id) group(id).name = name;
    else S.groups.push({ id: C.uid(), name });
    UI.modal = null; commit();
  },
  deleteGroup(id) {
    if (S.categories.some(c => c.groupId === id)) { alert('Move or delete its categories first.'); return; }
    S.groups = S.groups.filter(g => g.id !== id);
    UI.modal = null; commit();
  },

  /* scheduled */
  openSchedModal(id) { UI.modal = { kind: 'sched', id: id || null }; renderModal(); },
  saveSched(id) {
    const cents = moneyVal('mAmt'); const date = val('mDate');
    if (cents == null || !date) { alert('Enter an amount and a next date.'); return; }
    const data = { payee: String(val('mPayee') || '').trim(), accountId: val('mAcct'), categoryId: val('mCat') || null, amountCents: cents, memo: String(val('mMemo') || ''), freq: val('mFreq'), nextDate: date };
    if (id) Object.assign(S.scheduled.find(s => s.id === id), data);
    else S.scheduled.push(Object.assign({ id: C.uid() }, data));
    UI.modal = null; commit();
  },
  deleteSched(id) { if (confirm('Delete this scheduled transaction?')) { S.scheduled = S.scheduled.filter(s => s.id !== id); UI.modal = null; commit(); } },
  postScheduled(id) {
    const s = S.scheduled.find(x => x.id === id);
    S.transactions.push({ id: C.uid(), accountId: s.accountId, date: s.nextDate, payee: s.payee, categoryId: s.categoryId, amountCents: s.amountCents, memo: s.memo, cleared: false });
    s.nextDate = C.advanceRecurrence(s.nextDate, s.freq);
    commit();
  },
  skipScheduled(id) { const s = S.scheduled.find(x => x.id === id); s.nextDate = C.advanceRecurrence(s.nextDate, s.freq); commit(); },

  /* import */
  impSet(k, v) {
    UI.imp[k] = v;
    if (k === 'hasHeader') render();
    else if (k === 'accountId' && UI.imp.step === 3) { buildReviewRows(); render(); }
  },
  impFile(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => { UI.imp.raw = r.result; UI.imp.fileName = file.name; UI.imp.parsed = C.parseCSV(r.result); render(); };
    r.onerror = () => { alert('Could not read that file.'); };
    r.readAsText(file);
  },
  impPreset(pid) {
    UI.imp.presetId = pid;
    const p = S.mappingPresets.find(x => x.id === pid);
    if (p) UI.imp.map = { ...p.map };
    render();
  },
  impMap(k, v) { UI.imp.map[k] = v; render(); },
  impSavePreset() {
    const name = String(val('presetName') || '').trim();
    if (!name) { alert('Give the preset a name (e.g. "RBC Visa").'); return; }
    const existing = S.mappingPresets.find(p => p.name === name);
    if (existing) { existing.map = { ...UI.imp.map }; UI.imp.presetId = existing.id; }
    else { const p = { id: C.uid(), name, map: { ...UI.imp.map } }; S.mappingPresets.push(p); UI.imp.presetId = p.id; }
    save();
    alert(`Preset "${name}" saved.`);
    render();
  },
  impGoto(step) {
    if (step === 3) buildReviewRows();
    UI.imp.step = step; render();
  },
  impToggle(idx) { const r = UI.imp.rows.find(x => x.idx === idx); if (r) { r.include = !r.include; render(); } },
  impCommit() {
    const I = UI.imp;
    const cid = I.defaultCatId || null;
    let n = 0;
    for (const r of I.rows) {
      if (!r.ok || !r.include) continue;
      S.transactions.push({
        id: C.uid(), accountId: I.accountId, date: r.dateISO, payee: r.payee || '(no payee)',
        categoryId: cid, amountCents: r.cents, memo: r.memo || '', cleared: true,
        importHash: C.importKey(I.accountId, r.dateISO, r.cents, r.payee),
      });
      n++;
    }
    const acctName = (acct(I.accountId) || {}).name;
    UI.reg.accountId = I.accountId;
    UI.imp = null; UI.view = 'accounts';
    commit();
    alert(`${n} transaction${n === 1 ? '' : 's'} imported into ${acctName}, marked cleared.${cid ? '' : ' Assign categories from the register.'}`);
  },

  /* settings */
  exportJSON() {
    S.meta.lastExport = new Date().toISOString();
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lagoon-ledger-backup-' + todayISO() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    commit();
  },
  restoreJSON(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      let parsed;
      try { parsed = JSON.parse(r.result); } catch (e) { alert('Not valid JSON: ' + e.message); return; }
      const v = C.validateState(parsed);
      if (!v.ok) { alert('Backup rejected:\n• ' + v.errors.slice(0, 6).join('\n• ')); return; }
      if (!confirm(`Replace everything currently in the app with this backup (${parsed.transactions.length} transactions, ${parsed.accounts.length} accounts)?`)) return;
      S = parsed; UI.loadProblem = null; commit();
    };
    r.readAsText(file);
  },
  eraseAll() {
    if (!confirm('Erase ALL data from this browser? Export a backup first if you have any doubt.')) return;
    if (!confirm('Really erase? This cannot be undone from within the app.')) return;
    S = C.blankState(todayISO());
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    commit();
  },
  seedSample() {
    if (S.transactions.length) return;
    const m = curMonth();
    const chq = { id: C.uid(), name: 'Sample Chequing', type: 'chequing', closed: false };
    const visa = { id: C.uid(), name: 'Sample Visa', type: 'credit', closed: false };
    S.accounts.push(chq, visa); ensurePaymentCategory(visa);
    const g = { id: C.uid(), name: 'Everyday' }; S.groups.push(g);
    const groc = { id: C.uid(), groupId: g.id, name: 'Groceries', goal: { type: 'monthly', amountCents: 40000 } };
    const rent = { id: C.uid(), groupId: g.id, name: 'Rent' };
    S.categories.push(groc, rent);
    S.transactions.push(
      { id: C.uid(), accountId: chq.id, date: m + '-01', payee: 'Starting balance', categoryId: C.INFLOW, amountCents: 250000, memo: '', cleared: true },
      { id: C.uid(), accountId: chq.id, date: m + '-02', payee: 'Metro', categoryId: groc.id, amountCents: -6420, memo: '', cleared: true },
      { id: C.uid(), accountId: visa.id, date: m + '-03', payee: 'Provigo', categoryId: groc.id, amountCents: -3180, memo: '', cleared: false },
    );
    S.assigned[m] = { [groc.id]: 40000, [rent.id]: 150000 };
    S.scheduled.push({ id: C.uid(), payee: 'Landlord', accountId: chq.id, categoryId: rent.id, amountCents: -150000, memo: '', freq: 'monthly', nextDate: C.addMonths(m, 1) + '-01' });
    commit();
  },
};
A._st = null;

function wireDrop() {
  const z = document.getElementById('dropzone');
  if (!z) return;
  ['dragover', 'dragenter'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove('over'); }));
  z.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) A.impFile(f); });
}

window.A = A;
boot();
})();
