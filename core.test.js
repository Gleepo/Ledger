'use strict';
const LL = require('./core.js');

let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`); }
}
function ok(cond, name) { if (cond) pass++; else { fail++; console.error(`FAIL ${name}`); } }

/* ---------- money ---------- */
eq(LL.parseMoneyToCents('1,234.56'), 123456, 'money: 1,234.56');
eq(LL.parseMoneyToCents('$1,234.56'), 123456, 'money: $ prefix');
eq(LL.parseMoneyToCents('(45.00)'), -4500, 'money: parens negative');
eq(LL.parseMoneyToCents('-12.30'), -1230, 'money: minus');
eq(LL.parseMoneyToCents('1 234,56'), 123456, 'money: French space+comma');
eq(LL.parseMoneyToCents('12,30'), 1230, 'money: comma decimal');
eq(LL.parseMoneyToCents('1.234,56'), 123456, 'money: European dots');
eq(LL.parseMoneyToCents('7'), 700, 'money: bare integer');
eq(LL.parseMoneyToCents(''), null, 'money: empty is null');
eq(LL.parseMoneyToCents('abc'), null, 'money: garbage is null');
eq(LL.fmtCAD(123456), '$1,234.56', 'fmt: thousands');
eq(LL.fmtCAD(-4500), '\u2212$45.00', 'fmt: negative uses minus sign');
eq(LL.fmtCAD(0), '$0.00', 'fmt: zero');

/* ---------- dates ---------- */
eq(LL.parseDateStr('2026-07-04', 'DMY'), '2026-07-04', 'date: ISO always wins');
eq(LL.parseDateStr('04/07/2026', 'DMY'), '2026-07-04', 'date: DMY');
eq(LL.parseDateStr('07/04/2026', 'MDY'), '2026-07-04', 'date: MDY');
eq(LL.parseDateStr('31/02/2026', 'DMY'), null, 'date: rejects Feb 31');
eq(LL.parseDateStr('4 Jul 2026', 'DMY'), '2026-07-04', 'date: month name');
eq(LL.parseDateStr('juil 4, 2026', 'DMY'), '2026-07-04', 'date: French month name');
eq(LL.addMonths('2026-01', 1), '2026-02', 'month: add');
eq(LL.addMonths('2026-12', 1), '2027-01', 'month: year wrap');
eq(LL.addMonthsToDate('2026-01-31', 1), '2026-02-28', 'date: day clamp');
eq(LL.advanceRecurrence('2026-07-04', 'biweekly'), '2026-07-18', 'recur: biweekly');
eq(LL.advanceRecurrence('2026-01-31', 'monthly'), '2026-02-28', 'recur: monthly clamps');

/* ---------- CSV ---------- */
const csv1 = LL.parseCSV('a,b,c\n1,"two, two",3\r\n4,"say ""hi""",6\n');
eq(csv1.rows, [['a','b','c'],['1','two, two','3'],['4','say "hi"','6']], 'csv: quotes, CRLF, escaped quotes');
const csv2 = LL.parseCSV('\uFEFFDate;Montant\n2026-01-01;"1 234,56"');
eq(csv2.delimiter, ';', 'csv: sniffs semicolon');
eq(csv2.rows[1][1], '1 234,56', 'csv: BOM stripped, quoted field kept');
const csv3 = LL.parseCSV('a,b\n"unclosed,oops');
ok(csv3.errors.length === 1 && csv3.rows.length === 2, 'csv: unclosed quote tolerated + reported');
const csv4 = LL.parseCSV('a,b\n1,"line\nbreak"\n2,3');
eq(csv4.rows[1][1], 'line\nbreak', 'csv: embedded newline in quotes');
eq(LL.parseCSV('a,b\n\n\n1,2').rows.length, 2, 'csv: blank lines skipped');

/* ---------- payees + dedup ---------- */
eq(LL.normalizePayee('TIM HORTONS #4821 MONTREAL'), 'tim hortons montreal', 'payee: digits stripped');
eq(LL.normalizePayee('  METRO   INC.  9917 '), 'metro inc', 'payee: punctuation + spaces collapsed');
{
  const k = (p) => LL.importKey('a1', '2026-07-01', -450, p);
  // Ledger has ONE coffee; CSV has TWO identical rows → flag one, admit one.
  const flags = LL.flagDuplicates([k('TIM HORTONS #4821')], [k('TIM HORTONS #9999'), k('TIM HORTONS #0001')]);
  eq(flags, [true, false], 'dedup: occurrence counting, mutable ref numbers ignored');
  const none = LL.flagDuplicates([], [k('TIM HORTONS')]);
  eq(none, [false], 'dedup: nothing existing, nothing flagged');
}

/* ---------- state scaffolding for budget tests ---------- */
function fixture() {
  const s = LL.blankState('2026-01-01');
  s.accounts = [
    { id: 'chq', name: 'RBC Chequing', type: 'chequing' },
    { id: 'visa', name: 'RBC Visa', type: 'credit' },
    { id: 'rrsp', name: 'WS Invest', type: 'tracking' },
  ];
  s.groups = [{ id: 'g1', name: 'Everyday' }];
  s.categories = [
    { id: 'groc', groupId: 'g1', name: 'Groceries' },
    { id: 'rent', groupId: 'g1', name: 'Rent' },
    { id: 'payvisa', groupId: 'g1', name: 'RBC Visa Payment', paymentForAccountId: 'visa' },
  ];
  return s;
}
function tx(o) { return Object.assign({ id: LL.uid(), cleared: false, memo: '' }, o); }

/* 1. Income lands in TBB */
{
  const s = fixture();
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-03', payee: 'Employer', categoryId: LL.INFLOW, amountCents: 200000 }));
  const b = LL.computeBudget(s, '2026-01');
  eq(b.months['2026-01'].tbb, 200000, 'engine: income → TBB');
}

/* 2+3. Assign decreases TBB; spend updates Activity and Available */
{
  const s = fixture();
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-03', payee: 'Employer', categoryId: LL.INFLOW, amountCents: 200000 }));
  s.assigned['2026-01'] = { groc: 50000 };
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-10', payee: 'Metro', categoryId: 'groc', amountCents: -12345 }));
  const b = LL.computeBudget(s, '2026-01');
  const g = b.months['2026-01'].categories.groc;
  eq(b.months['2026-01'].tbb, 150000, 'engine: assign reduces TBB');
  eq(g.activity, -12345, 'engine: activity');
  eq(g.available, 37655, 'engine: available = assigned + activity');
}

/* 4. Rollover: leftover carries; cash overspend resets to 0 and hits NEXT month TBB */
{
  const s = fixture();
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-03', payee: 'Employer', categoryId: LL.INFLOW, amountCents: 100000 }));
  s.assigned['2026-01'] = { groc: 20000, rent: 30000 };
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-10', payee: 'Metro', categoryId: 'groc', amountCents: -25000 })); // overspend 50
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-11', payee: 'Landlord', categoryId: 'rent', amountCents: -10000 })); // leftover 200
  const b = LL.computeBudget(s, '2026-02');
  const jan = b.months['2026-01'], feb = b.months['2026-02'];
  eq(jan.categories.groc.available, -5000, 'rollover: overspent shows negative in its month');
  eq(jan.categories.groc.cashOverspend, 5000, 'rollover: cash overspend recorded');
  eq(feb.categories.groc.available, 0, 'rollover: overspent category resets to 0, not negative');
  eq(feb.categories.rent.available, 20000, 'rollover: leftover carries');
  // Jan TBB = 1000 - 500 assigned = 500. Feb TBB = 500 - 50 cash overspend = 450.
  eq(jan.tbb, 50000, 'rollover: Jan TBB unaffected by same-month overspend');
  eq(feb.tbb, 45000, 'rollover: cash overspend reduces NEXT month TBB');
}

/* 5. Credit coverage: budgeted credit spend moves coverage to the payment category */
{
  const s = fixture();
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-03', payee: 'Employer', categoryId: LL.INFLOW, amountCents: 100000 }));
  s.assigned['2026-01'] = { groc: 40000 };
  s.transactions.push(tx({ accountId: 'visa', date: '2026-01-10', payee: 'Metro', categoryId: 'groc', amountCents: -15000 }));
  const b = LL.computeBudget(s, '2026-01');
  eq(b.months['2026-01'].categories.groc.available, 25000, 'credit: category reduced by credit spend');
  eq(b.months['2026-01'].categories.payvisa.available, 15000, 'credit: coverage lands in payment category');
  eq(b.months['2026-01'].tbb, 60000, 'credit: TBB untouched by covered credit spend');
}

/* 6. Credit overspend becomes card debt: no coverage for the uncovered part, no TBB hit */
{
  const s = fixture();
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-03', payee: 'Employer', categoryId: LL.INFLOW, amountCents: 100000 }));
  s.assigned['2026-01'] = { groc: 10000 };
  s.transactions.push(tx({ accountId: 'visa', date: '2026-01-10', payee: 'Metro', categoryId: 'groc', amountCents: -15000 }));
  const b = LL.computeBudget(s, '2026-02');
  eq(b.months['2026-01'].categories.groc.creditOverspend, 5000, 'credit overspend: recorded');
  eq(b.months['2026-01'].categories.payvisa.available, 10000, 'credit overspend: only covered portion flows');
  eq(b.months['2026-02'].tbb, 90000, 'credit overspend: does NOT reduce next TBB');
}

/* 7. Card payment (transfer chq→visa) reduces payment category, is not spending */
{
  const s = fixture();
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-03', payee: 'Employer', categoryId: LL.INFLOW, amountCents: 100000 }));
  s.assigned['2026-01'] = { groc: 40000 };
  s.transactions.push(tx({ accountId: 'visa', date: '2026-01-10', payee: 'Metro', categoryId: 'groc', amountCents: -15000 }));
  const out = tx({ id: 'pOut', accountId: 'chq', date: '2026-01-20', payee: 'Transfer: RBC Visa', categoryId: null, amountCents: -15000, transferPairId: 'pIn' });
  const inn = tx({ id: 'pIn', accountId: 'visa', date: '2026-01-20', payee: 'Transfer: RBC Chequing', categoryId: null, amountCents: 15000, transferPairId: 'pOut' });
  s.transactions.push(out, inn);
  const b = LL.computeBudget(s, '2026-01');
  eq(b.months['2026-01'].categories.payvisa.available, 0, 'payment: transfer drains payment category');
  eq(b.months['2026-01'].tbb, 60000, 'payment: transfer does not touch TBB');
  const bals = LL.accountBalances(s);
  eq(bals.visa.working, 0, 'payment: card balance cleared');
  eq(bals.chq.working, 85000, 'payment: chequing reduced');
  const spend = LL.spendingByCategory(s, '2026-01');
  eq(spend.groc, 15000, 'payment: transfer not counted as spending');
  ok(!('null' in spend), 'payment: no phantom category from transfer');
}

/* 8. Budget→tracking transfer counts as outflow from the budget */
{
  const s = fixture();
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-03', payee: 'Employer', categoryId: LL.INFLOW, amountCents: 100000 }));
  s.categories.push({ id: 'invest', groupId: 'g1', name: 'Investing' });
  s.assigned['2026-01'] = { invest: 30000 };
  const out = tx({ id: 'tOut', accountId: 'chq', date: '2026-01-15', payee: 'Transfer: WS Invest', categoryId: 'invest', amountCents: -30000, transferPairId: 'tIn' });
  const inn = tx({ id: 'tIn', accountId: 'rrsp', date: '2026-01-15', payee: 'Transfer: RBC Chequing', categoryId: null, amountCents: 30000, transferPairId: 'tOut' });
  s.transactions.push(out, inn);
  const b = LL.computeBudget(s, '2026-01');
  eq(b.months['2026-01'].categories.invest.available, 0, 'tracking transfer: spends the envelope');
  const bals = LL.accountBalances(s);
  eq(bals.rrsp.working, 30000, 'tracking transfer: tracking account received');
}

/* 9. Starting balance is a real INFLOW transaction */
{
  const s = fixture();
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-01', payee: 'Starting balance', categoryId: LL.INFLOW, amountCents: 52350 }));
  const b = LL.computeBudget(s, '2026-01');
  eq(b.months['2026-01'].tbb, 52350, 'starting balance: lands in TBB');
}

/* 10. Splits post per-category */
{
  const s = fixture();
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-03', payee: 'Employer', categoryId: LL.INFLOW, amountCents: 100000 }));
  s.assigned['2026-01'] = { groc: 30000, rent: 30000 };
  s.transactions.push(tx({
    accountId: 'chq', date: '2026-01-12', payee: 'Costco', categoryId: null, amountCents: -25000,
    splits: [{ categoryId: 'groc', amountCents: -18000 }, { categoryId: 'rent', amountCents: -7000 }],
  }));
  const b = LL.computeBudget(s, '2026-01');
  eq(b.months['2026-01'].categories.groc.activity, -18000, 'splits: first leg');
  eq(b.months['2026-01'].categories.rent.activity, -7000, 'splits: second leg');
  eq(LL.accountBalances(s).chq.working, 75000, 'splits: account balance uses parent amount');
}

/* 11. Future assigned reported separately, not silently folded into TBB */
{
  const s = fixture();
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-03', payee: 'Employer', categoryId: LL.INFLOW, amountCents: 100000 }));
  s.assigned['2026-02'] = { groc: 40000 };
  const b = LL.computeBudget(s, '2026-02');
  eq(b.months['2026-01'].tbb, 100000, 'future assign: Jan TBB shown gross');
  eq(b.months['2026-01'].futureAssigned, 40000, 'future assign: reported as its own line');
  eq(b.months['2026-02'].tbb, 60000, 'future assign: Feb TBB reflects it');
}

/* 12. JSON round-trip is lossless and validates */
{
  const s = fixture();
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-03', payee: 'Employer', categoryId: LL.INFLOW, amountCents: 100000 }));
  s.assigned['2026-01'] = { groc: 1 };
  const back = JSON.parse(JSON.stringify(s));
  eq(LL.validateState(back).ok, true, 'roundtrip: validates');
  eq(back, s, 'roundtrip: identical');
  const badVersion = Object.assign({}, back, { version: 1 });
  eq(LL.validateState(badVersion).ok, false, 'roundtrip: wrong version rejected');
  const badTx = JSON.parse(JSON.stringify(s));
  badTx.transactions[0].amountCents = 12.5;
  eq(LL.validateState(badTx).ok, false, 'roundtrip: float cents rejected');
}

/* 13. Age of money sane */
{
  const s = fixture();
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-01', payee: 'Pay', categoryId: LL.INFLOW, amountCents: 10000 }));
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-31', payee: 'Metro', categoryId: 'groc', amountCents: -10000 }));
  eq(LL.ageOfMoney(s), 30, 'aom: 30 days for one in/out pair');
  eq(LL.ageOfMoney(fixture()), null, 'aom: null with no data');
}

/* 14. Goals */
{
  const g1 = LL.goalStatus({ type: 'monthly', amountCents: 20000 }, '2026-01', 5000, 5000);
  eq(g1.status, 'underfunded', 'goal monthly: underfunded');
  eq(g1.neededCents, 15000, 'goal monthly: shortfall');
  const g2 = LL.goalStatus({ type: 'byDate', amountCents: 60000, dueMonth: '2026-03' }, '2026-01', 0, 0);
  eq(g2.neededCents, 20000, 'goal byDate: pace over 3 months incl. current');
  const g3 = LL.goalStatus({ type: 'byDate', amountCents: 60000, dueMonth: '2026-03' }, '2026-01', 0, 60000);
  eq(g3.status, 'funded', 'goal byDate: funded via available');
}

/* 15. Net worth includes tracking accounts */
{
  const s = fixture();
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-01', payee: 'Start', categoryId: LL.INFLOW, amountCents: 50000 }));
  s.transactions.push(tx({ accountId: 'rrsp', date: '2026-01-01', payee: 'Start', categoryId: null, amountCents: 200000 }));
  const nw = LL.netWorthSeries(s, ['2026-01', '2026-02']);
  eq(nw[0].cents, 250000, 'networth: budget + tracking');
  eq(nw[1].cents, 250000, 'networth: carries when no activity');
}

/* 16. Credit refund pulls coverage back out */
{
  const s = fixture();
  s.transactions.push(tx({ accountId: 'chq', date: '2026-01-03', payee: 'Employer', categoryId: LL.INFLOW, amountCents: 100000 }));
  s.assigned['2026-01'] = { groc: 40000 };
  s.transactions.push(tx({ accountId: 'visa', date: '2026-01-10', payee: 'Metro', categoryId: 'groc', amountCents: -15000 }));
  s.transactions.push(tx({ accountId: 'visa', date: '2026-01-12', payee: 'Metro refund', categoryId: 'groc', amountCents: 4000 }));
  const b = LL.computeBudget(s, '2026-01');
  eq(b.months['2026-01'].categories.groc.available, 29000, 'refund: category restored');
  eq(b.months['2026-01'].categories.payvisa.available, 11000, 'refund: coverage net of refund');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
