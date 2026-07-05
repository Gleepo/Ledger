/* Lagoon Ledger v2 — pure logic core.
   No DOM, no I/O. Every function here is deterministic and unit-tested in Node.
   All money is integer cents. All dates are ISO strings (YYYY-MM-DD); months are "YYYY-MM".
   Loaded in the browser as window.LL; in Node via module.exports. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.LL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const STATE_VERSION = 2;

/* ---------------- money ---------------- */

function fmtCAD(cents, opts) {
  opts = opts || {};
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  let s = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  s = '$' + s + '.' + rem;
  if (neg) s = '\u2212' + s; // proper minus sign
  else if (opts.plus && cents > 0) s = '+' + s;
  return s;
}

/* Accepts: "1,234.56", "$1,234.56", "(45.00)", "-12.30", "1 234,56", "12,30",
   "1.234,56", "", "  ". Returns integer cents or null if unparseable. */
function parseMoneyToCents(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (s === '') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$\sCAD]/gi, '');
  if (s.startsWith('-') || s.startsWith('\u2212')) { neg = true; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (s === '') return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decSep = null;
  if (lastDot > -1 && lastComma > -1) {
    decSep = lastDot > lastComma ? '.' : ','; // whichever comes last is the decimal
  } else if (lastDot > -1) {
    // Sole separator kind. It's a decimal only if it appears once with ≤2 trailing digits;
    // "1.234" and "1.234.567" are thousands-style.
    decSep = (s.indexOf('.') === lastDot && s.length - lastDot - 1 <= 2) ? '.' : null;
  } else if (lastComma > -1) {
    decSep = (s.indexOf(',') === lastComma && s.length - lastComma - 1 <= 2) ? ',' : null;
  }
  let intPart, fracPart = '';
  if (decSep) {
    const idx = decSep === '.' ? lastDot : lastComma;
    intPart = s.slice(0, idx);
    fracPart = s.slice(idx + 1);
  } else intPart = s;
  intPart = intPart.replace(/[.,]/g, '');
  fracPart = fracPart.replace(/[^0-9]/g, '');
  if (!/^\d*$/.test(intPart)) return null;
  if (intPart === '' && fracPart === '') return null;
  if (fracPart.length > 2) fracPart = fracPart.slice(0, 2);
  while (fracPart.length < 2) fracPart += '0';
  const cents = (parseInt(intPart || '0', 10) * 100) + parseInt(fracPart, 10);
  if (!isFinite(cents)) return null;
  return neg ? -cents : cents;
}

/* ---------------- dates ---------------- */

const MONTH_NAMES = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
  janv:1,'févr':2,fevr:2,mars:3,avr:4,mai:5,juin:6,juil:7,'août':8,aout:8,sept:9,'déc':12 };

function pad2(n) { return String(n).padStart(2, '0'); }

function validYMD(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

/* fmt: 'YMD' | 'DMY' | 'MDY'. Also auto-accepts ISO and "12 Jan 2026"-style regardless of fmt. */
function parseDateStr(raw, fmt) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    return validYMD(y, mo, d) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-zéûà.]+)[\s-,]+(\d{4})$/) || s.match(/^([A-Za-zéûà.]+)[\s-]+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    let d, name, y;
    if (/^\d/.test(m[1])) { d = +m[1]; name = m[2]; y = +m[3]; }
    else { name = m[1]; d = +m[2]; y = +m[3]; }
    const key = name.toLowerCase().replace(/\./g, '').slice(0, 4);
    const mo = MONTH_NAMES[key] || MONTH_NAMES[key.slice(0, 3)];
    if (mo && validYMD(y, mo, d)) return `${y}-${pad2(mo)}-${pad2(d)}`;
    return null;
  }
  m = s.match(/^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})$/);
  if (!m) return null;
  const a = +m[1], b = +m[2], c = +m[3];
  let y, mo, d;
  if (fmt === 'YMD' || String(m[1]).length === 4) { y = a; mo = b; d = c; }
  else if (fmt === 'MDY') { mo = a; d = b; y = c; }
  else { d = a; mo = b; y = c; } // DMY default
  if (y < 100) y += 2000;
  return validYMD(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
}

function monthOf(iso) { return iso.slice(0, 7); }
function cmpMonth(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function addMonths(month, n) {
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad2((t % 12) + 1)}`;
}
function monthRange(from, to) {
  const out = [];
  let m = from;
  while (cmpMonth(m, to) <= 0) { out.push(m); m = addMonths(m, 1); }
  return out;
}
function daysBetween(isoA, isoB) {
  return Math.round((Date.parse(isoB + 'T00:00:00Z') - Date.parse(isoA + 'T00:00:00Z')) / 86400000);
}
function addDays(iso, n) {
  const d = new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000);
  return d.toISOString().slice(0, 10);
}
/* Add n months to a full date, clamping the day (Jan 31 + 1mo → Feb 28/29). */
function addMonthsToDate(iso, n) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12), nm = (t % 12) + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad2(nm)}-${pad2(Math.min(d, dim))}`;
}

/* ---------------- CSV (RFC 4180-ish, tolerant) ---------------- */

function sniffDelimiter(text) {
  const firstLine = text.slice(0, text.indexOf('\n') > -1 ? text.indexOf('\n') : text.length);
  let best = ',', bestCount = -1;
  for (const d of [',', ';', '\t']) {
    let count = 0, inQ = false;
    for (const ch of firstLine) {
      if (ch === '"') inQ = !inQ;
      else if (ch === d && !inQ) count++;
    }
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

/* Returns { rows: string[][], errors: [{line, message}], delimiter }.
   Handles BOM, CRLF, quoted fields with embedded delimiters/newlines/escaped quotes.
   Never throws on bad input: problems become entries in errors. */
function parseCSV(text, delimiter) {
  if (text == null) return { rows: [], errors: [{ line: 0, message: 'Empty input' }], delimiter: ',' };
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const d = delimiter || sniffDelimiter(text);
  const rows = [];
  const errors = [];
  let field = '', row = [], inQ = false, line = 1, sawQuoteInField = false;
  const pushField = () => { row.push(field); field = ''; sawQuoteInField = false; };
  const pushRow = () => {
    // skip fully blank rows
    if (!(row.length === 1 && row[0].trim() === '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
    } else if (ch === '"') {
      if (field.trim() === '' && !sawQuoteInField) { inQ = true; sawQuoteInField = true; field = ''; }
      else field += ch; // stray quote mid-field: keep literally, note it
    } else if (ch === d) pushField();
    else if (ch === '\n') { pushField(); pushRow(); line++; }
    else if (ch === '\r') { /* swallow; \n follows or line ends */ }
    else field += ch;
  }
  if (inQ) errors.push({ line, message: 'Unclosed quote at end of file; last field closed automatically' });
  if (field !== '' || row.length > 0) { pushField(); pushRow(); }
  return { rows, errors, delimiter: d };
}

/* ---------------- payees & duplicate detection ---------------- */

function normalizePayee(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[0-9#*]/g, '')
    .replace(/[^\p{L}\s&']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function importKey(accountId, dateISO, amountCents, payee) {
  return accountId + '|' + dateISO + '|' + amountCents + '|' + normalizePayee(payee);
}

/* Occurrence-counting duplicate detection.
   existing: array of {key} (precomputed importKey for ledger txns in the account/date window).
   incoming: array of {key} in file order.
   Returns boolean[] — true = flagged as likely duplicate.
   Rule: if the ledger already holds N transactions with key K, the FIRST N incoming
   rows with key K are flagged; any beyond N are treated as genuinely new. */
function flagDuplicates(existingKeys, incomingKeys) {
  const counts = new Map();
  for (const k of existingKeys) counts.set(k, (counts.get(k) || 0) + 1);
  return incomingKeys.map(k => {
    const c = counts.get(k) || 0;
    if (c > 0) { counts.set(k, c - 1); return true; }
    return false;
  });
}

/* ---------------- recurrence ---------------- */

function advanceRecurrence(dateISO, freq) {
  switch (freq) {
    case 'weekly': return addDays(dateISO, 7);
    case 'biweekly': return addDays(dateISO, 14);
    case 'monthly': return addMonthsToDate(dateISO, 1);
    case 'yearly': return addMonthsToDate(dateISO, 12);
    default: return null;
  }
}

/* All occurrences of a scheduled txn with next date `nextDate` up to and incl. `untilISO`. */
function occurrencesUntil(nextDate, freq, untilISO, cap) {
  const out = [];
  let d = nextDate;
  cap = cap || 60;
  while (d && d <= untilISO && out.length < cap) {
    out.push(d);
    d = advanceRecurrence(d, freq);
    if (freq === 'once') break;
  }
  return out;
}

/* ---------------- state ---------------- */

function uid() {
  return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function blankState(todayISO) {
  return {
    version: STATE_VERSION,
    meta: { createdAt: todayISO || null, lastExport: null },
    accounts: [],
    groups: [],
    categories: [],
    transactions: [],
    assigned: {},       // { "YYYY-MM": { categoryId: cents } }
    scheduled: [],
    mappingPresets: [],
  };
}

const ACCOUNT_TYPES = ['chequing', 'savings', 'cash', 'credit', 'tracking'];
const INFLOW = '__tbb__'; // sentinel categoryId: "Inflow: To Be Budgeted"

function isBudgetAccount(acct) { return acct.type !== 'tracking'; }
function isCreditAccount(acct) { return acct.type === 'credit'; }

/* Validation: returns { ok, errors: string[] }. Strict on version + structural shape. */
function validateState(s) {
  const errs = [];
  if (!s || typeof s !== 'object') return { ok: false, errors: ['Not an object'] };
  if (s.version !== STATE_VERSION) errs.push(`Unsupported schema version ${s.version} (this app uses v${STATE_VERSION})`);
  for (const k of ['accounts', 'groups', 'categories', 'transactions', 'scheduled', 'mappingPresets']) {
    if (!Array.isArray(s[k])) errs.push(`Missing array: ${k}`);
  }
  if (typeof s.assigned !== 'object' || s.assigned === null || Array.isArray(s.assigned)) errs.push('Missing object: assigned');
  if (errs.length) return { ok: false, errors: errs };
  const acctIds = new Set(s.accounts.map(a => a.id));
  const catIds = new Set(s.categories.map(c => c.id)); catIds.add(INFLOW);
  for (const a of s.accounts) {
    if (!ACCOUNT_TYPES.includes(a.type)) errs.push(`Account ${a.name}: bad type ${a.type}`);
  }
  for (const t of s.transactions) {
    if (!acctIds.has(t.accountId)) errs.push(`Transaction ${t.id}: unknown account`);
    if (!Number.isInteger(t.amountCents)) errs.push(`Transaction ${t.id}: amount not integer cents`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) errs.push(`Transaction ${t.id}: bad date`);
    if (t.categoryId && !catIds.has(t.categoryId)) errs.push(`Transaction ${t.id}: unknown category`);
    if (t.splits) for (const sp of t.splits) {
      if (!Number.isInteger(sp.amountCents)) errs.push(`Transaction ${t.id}: split amount not integer cents`);
      if (sp.categoryId && !catIds.has(sp.categoryId)) errs.push(`Transaction ${t.id}: split has unknown category`);
    }
  }
  for (const mo of Object.keys(s.assigned)) {
    if (!/^\d{4}-\d{2}$/.test(mo)) errs.push(`assigned: bad month key ${mo}`);
    for (const cid of Object.keys(s.assigned[mo])) {
      if (!catIds.has(cid)) errs.push(`assigned[${mo}]: unknown category ${cid}`);
      if (!Number.isInteger(s.assigned[mo][cid])) errs.push(`assigned[${mo}][${cid}]: not integer cents`);
    }
  }
  return { ok: errs.length === 0, errors: errs };
}

/* ---------------- the budget engine ---------------- */

/* Flatten transactions into category "postings": {date, month, accountId, categoryId, amountCents}.
   Splits become one posting per split. Transfers (categoryId null + transferPairId) produce
   no posting — they move money between accounts without touching the budget. A budget→tracking
   transfer carries a categoryId on the budget side and DOES post (it left the budget). */
function postings(state) {
  const out = [];
  for (const t of state.transactions) {
    const base = { date: t.date, month: monthOf(t.date), accountId: t.accountId };
    if (t.splits && t.splits.length) {
      for (const sp of t.splits) {
        if (sp.categoryId) out.push({ ...base, categoryId: sp.categoryId, amountCents: sp.amountCents });
      }
    } else if (t.categoryId) {
      out.push({ ...base, categoryId: t.categoryId, amountCents: t.amountCents });
    }
  }
  return out;
}

/* Core computation. Returns:
   {
     months: { [month]: {
       tbb, futureAssigned, cashOverspendThisMonth,
       categories: { [catId]: { assigned, activity, available, cashOverspend, creditOverspend } }
     }},
     range: [firstMonth, lastMonth]
   }
   viewMonth extends the range forward so you can budget into empty future months. */
function computeBudget(state, viewMonth) {
  const acctById = Object.fromEntries(state.accounts.map(a => [a.id, a]));
  const posts = postings(state);
  // Determine range
  let first = viewMonth, last = viewMonth;
  for (const p of posts) { if (cmpMonth(p.month, first) < 0) first = p.month; if (cmpMonth(p.month, last) > 0) last = p.month; }
  for (const t of state.transactions) { const m = monthOf(t.date); if (cmpMonth(m, first) < 0) first = m; if (cmpMonth(m, last) > 0) last = m; }
  for (const m of Object.keys(state.assigned)) { if (cmpMonth(m, first) < 0) first = m; if (cmpMonth(m, last) > 0) last = m; }
  const months = monthRange(first, last);

  // Index postings: activity per (month, cat) split into cash vs credit; TBB inflows per month
  const actCash = {}, actCredit = {}, tbbIn = {};
  for (const p of posts) {
    const acct = acctById[p.accountId];
    if (!acct || !isBudgetAccount(acct)) continue; // tracking-account activity never touches the budget
    if (p.categoryId === INFLOW) { tbbIn[p.month] = (tbbIn[p.month] || 0) + p.amountCents; continue; }
    const bucket = isCreditAccount(acct) ? actCredit : actCash;
    bucket[p.month] = bucket[p.month] || {};
    bucket[p.month][p.categoryId] = (bucket[p.month][p.categoryId] || 0) + p.amountCents;
  }

  // Credit-card payments: transfers from a budget non-credit account INTO a credit account.
  // Identified as the inflow-side transaction on the credit account with a transferPairId
  // whose pair lives on a budget account.
  const txById = Object.fromEntries(state.transactions.map(t => [t.id, t]));
  const paymentsToCard = {}; // { month: { creditAcctId: cents (positive) } }
  for (const t of state.transactions) {
    if (!t.transferPairId) continue;
    const acct = acctById[t.accountId];
    if (!acct || !isCreditAccount(acct) || t.amountCents <= 0) continue;
    const pair = txById[t.transferPairId];
    if (!pair) continue;
    const src = acctById[pair.accountId];
    if (!src || !isBudgetAccount(src) || isCreditAccount(src)) continue;
    const m = monthOf(t.date);
    paymentsToCard[m] = paymentsToCard[m] || {};
    paymentsToCard[m][t.accountId] = (paymentsToCard[m][t.accountId] || 0) + t.amountCents;
  }

  // Credit spending per (month, cat, card) for coverage attribution
  const creditByCard = {}; // { month: { catId: { cardId: netCents } } }
  for (const p of posts) {
    const acct = acctById[p.accountId];
    if (!acct || !isCreditAccount(acct) || p.categoryId === INFLOW) continue;
    const m = p.month;
    creditByCard[m] = creditByCard[m] || {};
    creditByCard[m][p.categoryId] = creditByCard[m][p.categoryId] || {};
    creditByCard[m][p.categoryId][p.accountId] = (creditByCard[m][p.categoryId][p.accountId] || 0) + p.amountCents;
  }

  const paymentCatFor = {}; // creditAcctId -> categoryId
  for (const c of state.categories) if (c.paymentForAccountId) paymentCatFor[c.paymentForAccountId] = c.id;

  const result = { months: {}, range: [months[0], months[months.length - 1]] };
  const carry = {}; // catId -> cents carried into next month
  let cumulInflow = 0, cumulAssigned = 0, cumulCashOverspend = 0;
  const totalAssignedAll = months.reduce((s, m) => {
    const a = state.assigned[m] || {};
    return s + Object.values(a).reduce((x, y) => x + y, 0);
  }, 0);

  const regularCats = state.categories.filter(c => !c.paymentForAccountId).map(c => c.id);
  const paymentCats = state.categories.filter(c => c.paymentForAccountId);

  for (const m of months) {
    const mAssigned = state.assigned[m] || {};
    const monthOut = { categories: {}, cashOverspendThisMonth: 0 };
    const coverageIn = {}; // creditAcctId -> cents flowing into its payment category this month

    // Pass 1: regular categories
    for (const cid of regularCats) {
      const a = mAssigned[cid] || 0;
      const cash = (actCash[m] && actCash[m][cid]) || 0;
      const credit = (actCredit[m] && actCredit[m][cid]) || 0;
      const activity = cash + credit;
      const availRaw = (carry[cid] || 0) + a + activity;
      let available = availRaw, cashOver = 0, creditOver = 0;
      if (availRaw < 0) {
        const over = -availRaw;
        const creditSpend = credit < 0 ? -credit : 0;
        creditOver = Math.min(over, creditSpend);
        cashOver = over - creditOver;
        available = availRaw; // display the true negative; carry resets below
      }
      // Coverage: credit spending that IS covered flows to the card's payment category.
      const netCreditSpend = credit < 0 ? -credit : 0;
      const covered = netCreditSpend - creditOver;
      if (credit !== 0) {
        const byCard = (creditByCard[m] && creditByCard[m][cid]) || {};
        const cards = Object.keys(byCard);
        // Attribute proportionally to each card's share of net credit activity (integer-safe).
        let totalNeg = 0;
        for (const k of cards) if (byCard[k] < 0) totalNeg += -byCard[k];
        let remaining = covered;
        cards.forEach((cardId, i) => {
          const spend = byCard[cardId] < 0 ? -byCard[cardId] : 0;
          let share;
          if (totalNeg === 0) share = 0;
          else if (i === cards.length - 1) share = remaining;
          else { share = Math.round(covered * spend / totalNeg); remaining -= share; }
          if (share !== 0) coverageIn[cardId] = (coverageIn[cardId] || 0) + share;
          // Credit refunds (positive credit activity) pull coverage back out naively:
          if (byCard[cardId] > 0) coverageIn[cardId] = (coverageIn[cardId] || 0) - byCard[cardId];
        });
      }
      monthOut.categories[cid] = { assigned: a, activity, available, cashOverspend: cashOver, creditOverspend: creditOver };
      monthOut.cashOverspendThisMonth += cashOver;
      carry[cid] = availRaw >= 0 ? availRaw : 0;
    }

    // Pass 2: payment categories
    for (const pc of paymentCats) {
      const cardId = pc.paymentForAccountId;
      const a = mAssigned[pc.id] || 0;
      const inflow = coverageIn[cardId] || 0;
      const pay = (paymentsToCard[m] && paymentsToCard[m][cardId]) || 0;
      const activity = inflow - pay;
      const availRaw = (carry[pc.id] || 0) + a + activity;
      let cashOver = 0;
      if (availRaw < 0) { cashOver = -availRaw; }
      monthOut.categories[pc.id] = { assigned: a, activity, available: availRaw, cashOverspend: cashOver, creditOverspend: 0 };
      monthOut.cashOverspendThisMonth += cashOver;
      carry[pc.id] = availRaw >= 0 ? availRaw : 0;
    }

    cumulInflow += tbbIn[m] || 0;
    const assignedThisMonth = Object.values(mAssigned).reduce((x, y) => x + y, 0);
    cumulAssigned += assignedThisMonth;
    monthOut.tbb = cumulInflow - cumulAssigned - cumulCashOverspend;
    monthOut.futureAssigned = totalAssignedAll - cumulAssigned;
    monthOut.inflowThisMonth = tbbIn[m] || 0;
    monthOut.assignedThisMonth = assignedThisMonth;
    result.months[m] = monthOut;
    cumulCashOverspend += monthOut.cashOverspendThisMonth;
  }
  return result;
}

/* ---------------- account balances ---------------- */

function accountBalances(state) {
  const out = {};
  for (const a of state.accounts) out[a.id] = { working: 0, cleared: 0, uncleared: 0 };
  for (const t of state.transactions) {
    const b = out[t.accountId];
    if (!b) continue;
    b.working += t.amountCents;
    if (t.cleared) b.cleared += t.amountCents; else b.uncleared += t.amountCents;
  }
  return out;
}

/* ---------------- age of money ----------------
   FIFO approximation, documented in About: income = INFLOW-categorized inflows to budget
   accounts; consumption = outflows from budget accounts (postings with negative amounts,
   cash or credit) in date order. Age of an outflow = days between the income dollars it
   consumed (the last chunk consumed) and the outflow date. AoM = mean of the last 10. */
function ageOfMoney(state) {
  const acctById = Object.fromEntries(state.accounts.map(a => [a.id, a]));
  const events = [];
  for (const p of postings(state)) {
    const acct = acctById[p.accountId];
    if (!acct || !isBudgetAccount(acct)) continue;
    if (p.categoryId === INFLOW) { if (p.amountCents > 0) events.push({ date: p.date, kind: 'in', amt: p.amountCents }); }
    else if (p.amountCents < 0) events.push({ date: p.date, kind: 'out', amt: -p.amountCents });
  }
  events.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.kind === 'in' ? -1 : 1));
  const queue = []; // {date, remaining}
  const ages = [];
  for (const e of events) {
    if (e.kind === 'in') queue.push({ date: e.date, remaining: e.amt });
    else {
      let need = e.amt, lastDate = null;
      while (need > 0 && queue.length) {
        const head = queue[0];
        const take = Math.min(head.remaining, need);
        head.remaining -= take; need -= take; lastDate = head.date;
        if (head.remaining === 0) queue.shift();
      }
      if (lastDate) ages.push(daysBetween(lastDate, e.date));
    }
  }
  const lastN = ages.slice(-10);
  if (!lastN.length) return null;
  return Math.round(lastN.reduce((a, b) => a + b, 0) / lastN.length);
}

/* ---------------- goals ---------------- */

/* goal: {type:'monthly', amountCents} | {type:'byDate', amountCents, dueMonth:'YYYY-MM'}
   Returns {status:'funded'|'underfunded'|'none', neededCents, progress 0..1} for a month. */
function goalStatus(goal, month, assignedThisMonth, available) {
  if (!goal || !goal.type) return { status: 'none', neededCents: 0, progress: 1 };
  if (goal.type === 'monthly') {
    const needed = Math.max(0, goal.amountCents - assignedThisMonth);
    return { status: needed === 0 ? 'funded' : 'underfunded', neededCents: needed,
             progress: goal.amountCents > 0 ? Math.min(1, assignedThisMonth / goal.amountCents) : 1 };
  }
  if (goal.type === 'byDate') {
    const monthsLeft = Math.max(1, (function () {
      const [y1, m1] = month.split('-').map(Number);
      const [y2, m2] = goal.dueMonth.split('-').map(Number);
      return (y2 * 12 + m2) - (y1 * 12 + m1) + 1;
    })());
    if (cmpMonth(month, goal.dueMonth) > 0) {
      const short = Math.max(0, goal.amountCents - Math.max(0, available));
      return { status: short === 0 ? 'funded' : 'underfunded', neededCents: short,
               progress: goal.amountCents > 0 ? Math.min(1, Math.max(0, available) / goal.amountCents) : 1 };
    }
    const stillNeeded = Math.max(0, goal.amountCents - Math.max(0, available));
    const paceThisMonth = Math.ceil(stillNeeded / monthsLeft);
    return { status: stillNeeded === 0 ? 'funded' : (paceThisMonth <= 0 ? 'funded' : 'underfunded'),
             neededCents: paceThisMonth,
             progress: goal.amountCents > 0 ? Math.min(1, Math.max(0, available) / goal.amountCents) : 1 };
  }
  return { status: 'none', neededCents: 0, progress: 1 };
}

/* ---------------- reports helpers ---------------- */

function spendingByCategory(state, month) {
  const acctById = Object.fromEntries(state.accounts.map(a => [a.id, a]));
  const out = {};
  for (const p of postings(state)) {
    if (p.month !== month || p.categoryId === INFLOW) continue;
    const acct = acctById[p.accountId];
    if (!acct || !isBudgetAccount(acct)) continue;
    if (p.amountCents < 0) out[p.categoryId] = (out[p.categoryId] || 0) + (-p.amountCents);
  }
  return out;
}

function incomeVsExpense(state, months) {
  const acctById = Object.fromEntries(state.accounts.map(a => [a.id, a]));
  const out = {};
  for (const m of months) out[m] = { income: 0, expense: 0 };
  for (const p of postings(state)) {
    if (!(p.month in out)) continue;
    const acct = acctById[p.accountId];
    if (!acct || !isBudgetAccount(acct)) continue;
    if (p.categoryId === INFLOW) { if (p.amountCents > 0) out[p.month].income += p.amountCents; }
    else if (p.amountCents < 0) out[p.month].expense += -p.amountCents;
    else out[p.month].income += 0; // category refunds are netted into spending reports elsewhere; keep simple
  }
  return out;
}

/* Net worth at end of each month: cumulative sum of ALL transactions (budget + tracking). */
function netWorthSeries(state, months) {
  const byMonth = {};
  for (const t of state.transactions) {
    const m = monthOf(t.date);
    byMonth[m] = (byMonth[m] || 0) + t.amountCents;
  }
  const allMonths = Object.keys(byMonth).sort();
  let cum = 0;
  const cumAt = {};
  for (const m of allMonths) { cum += byMonth[m]; cumAt[m] = cum; }
  const out = [];
  let running = 0;
  for (const m of months) {
    // net worth at end of month m = sum of everything dated <= m
    let v = 0;
    for (const am of allMonths) if (cmpMonth(am, m) <= 0) v = cumAt[am];
    running = v;
    out.push({ month: m, cents: running });
  }
  return out;
}

return {
  STATE_VERSION, INFLOW, ACCOUNT_TYPES,
  fmtCAD, parseMoneyToCents,
  parseDateStr, monthOf, addMonths, addMonthsToDate, addDays, monthRange, cmpMonth, daysBetween,
  parseCSV, sniffDelimiter,
  normalizePayee, importKey, flagDuplicates,
  advanceRecurrence, occurrencesUntil,
  uid, blankState, validateState, isBudgetAccount, isCreditAccount,
  postings, computeBudget, accountBalances, ageOfMoney, goalStatus,
  spendingByCategory, incomeVsExpense, netWorthSeries,
};
});
