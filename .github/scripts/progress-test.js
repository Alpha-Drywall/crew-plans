// Tests for the Billing tab "% from hours" (office only): each pay app line’s trade from its last trade word,
// % = labor hours used on that cost code / budgeted hours (the Labor tab's laborCalc), Labor and Material and all areas of a trade share it,
// Mobilization / Submittals go to 100 once any line is above 0, never below last month, the job Done % used by All jobs, and time card hours past the job cost sheet date.
// Pulls the functions out of index.html and runs them with stubbed data.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const html = fs.readFileSync('index.html', 'utf8');
const src = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1];

const lines = src.split('\n');
function grab(name) {
  const re = new RegExp('^(?:async )?(?:function ' + name + '\\(|const ' + name + '=)');
  const i = lines.findIndex(l => re.test(l));
  if (i < 0) throw new Error('not found in index.html: ' + name);
  let j = i + 1;
  if (!lines[i].startsWith('const ')) while (j < lines.length && /^(\s|\})/.test(lines[j])) j++;
  return lines.slice(i, j).join('\n');
}
const names = ['num', 'clamp', 'esc', 'money', 'f0', 'isAdminRole', 'canEditLaborRate', 'LABOR_CODES', 'codeHrs', 'weekEnd', 'LABOR_SHOW_TC', 'laborCalc',
  'PCT_SKIP', 'pctGroupName', 'pctCode', 'HRS_CODES', 'lineCode', 'hoursByCode', 'BILL_MAT', 'billHoursPct', 'hoursDone', 'billMonth', 'billAdd', 'billSel', 'billMonthText',
  'r2', 'laborCut', 'billCut', 'billHoursByCode', 'billHrsNote', 'billKey', 'billPcts', 'billingCard',
  'tcKey', 'TC_ANCHOR', 'isoAddD', 'tcHrs', 'tcLineNo', 'tcIsJob', 'tcLabCode', 'tcJobNo', 'tcJobShort', 'tcJobKey', 'tcJobSplit'];
const code = names.map(grab).join('\n') + '\n;({' + names.join(',') + '})';
const S = { loaded: {}, role: 'admin' };
const T = vm.runInNewContext(code, { S, Math, Date, String, Number, Set, Object, Array, isFinite, parseFloat, who: id => id ? 'User ' + id : 'Someone', fmtWhen: v => String(v) });
const deq = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b); // values from the vm are another realm
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };

// the Labor tab's figures for a job: budget hours by code and used hours from the job cost sheet
const labor = (budget, used, extra) => Object.assign({ hpd: 10, hours: budget, cost: { as_of: '2026-11-20', history: [{ date: '2026-11-20', used }] } }, extra || {});
const H = L => { S.labor = L; S.laborLogs = []; return T.hoursByCode(T.laborCalc()); };

const ONE = [{ n: 'Mobilization', v: 4000 }, { n: 'Submittals', v: 1000 }, { n: 'Framing Labor', v: 40000 }, { n: 'Framing Material', v: 20000 },
  { n: 'Hanging Labor', v: 20000 }, { n: 'Hanging Material', v: 10000 }, { n: 'Finishing Labor', v: 25000 }, { n: 'Finishing Material', v: 5000 },
  { n: 'Insulation Labor', v: 6000 }, { n: 'Insulation Material', v: 4000 }];
const TWO = [{ n: 'Mobilization', v: 5000 }, { n: 'Bldg A Framing Labor', v: 30000 }, { n: 'Bldg A Framing Material', v: 30000 },
  { n: 'Bldg B Framing Labor', v: 10000 }, { n: 'Bldg B Framing Material', v: 10000 }, { n: 'Bldg A Hanging Labor', v: 20000 }, { n: 'Bldg B Hanging - Material', v: 10000 }];

t('the % complete panel, its reminders and its reads / writes of labor.progress are gone', () => {
  for (const gone of ['pctCard', 'bindPct', 'pctListNote', 'pctSave', 'data-pr=', '% complete not set yet', 'New markups since % complete', 'Foremen added markups since', 'Save % complete', 'labor->progress', 'S.progress', '{progress:P}', 'L.progress'])
    assert.ok(!html.includes(gone), 'still in index.html: ' + gone);
});

t('trade code per line: Labor / Material stripped, last trade word wins, 112 / 122 / 132 / 161', () => {
  const c = T.lineCode;
  assert.strictEqual(c('Framing Labor'), '112'); assert.strictEqual(c('Framing Material'), '112'); assert.strictEqual(c('Bldg A Framing Labor'), '112');
  assert.strictEqual(c('Hanging Labor'), '122'); assert.strictEqual(c('Bldg B Hanging - Material'), '122'); assert.strictEqual(c('Board'), '122');
  assert.strictEqual(c('Finishing Labour'), '132'); assert.strictEqual(c('Tape Material'), '132'); assert.strictEqual(c('Insulation Materials'), '161');
  assert.strictEqual(c('Boardroom Wing Framing Labor'), '112'); // an area word before the trade does not win
  assert.strictEqual(c('Doors & Frames'), null); assert.strictEqual(c('ACT Labor'), null); assert.strictEqual(c('Mobilization'), null); assert.strictEqual(c(''), null);
});

t('hours by code: used / budget from laborCalc, whole %, capped at 100, no budget = left out', () => {
  deq(H(labor({ '112': 1000, '122': 400, '132': 0, '161': 200, '142c': 100 }, { '112': 625, '122': 500, '132': 80, '142c': 90 })),
    { '112': { pct: 63, used: 625, bh: 1000 }, '122': { pct: 100, used: 500, bh: 400 }, '161': { pct: 0, used: 0, bh: 200 } });
  deq(H({}), {});
  // no job cost sheet yet: daily report hours by code (filled from time cards), like the Labor tab
  S.labor = { hpd: 10, hours: { '112': 400 } }; S.laborLogs = [{ date: '2026-11-02', hours: 50, hours_by_code: { '112': 50 } }, { date: '2026-11-03', hours: 30, hours_by_code: { '112': 30 } }];
  deq(T.hoursByCode(T.laborCalc()), { '112': { pct: 20, used: 80, bh: 400 } });
  deq(T.hoursByCode(null), {});
});

t('billing %: every area of a trade gets the labor %; Material lines get none (typed by the office); no code or budget = no suggestion', () => {
  const h = H(labor({ '112': 1000, '122': 500, '132': 800 }, { '112': 600, '122': 125 }));
  deq(ONE.map(l => T.billHoursPct(l, h, ONE)), [100, 100, 60, null, 25, null, 0, null, null, null]); // material lines: none (office types them) // 161 has no budget: keep last month
  deq(TWO.map(l => T.billHoursPct(l, h, TWO)), [100, 60, null, 60, null, 25, null]);
  assert.strictEqual(T.billHoursPct({ n: 'Framing Mat\'l' }, h, ONE), null); assert.strictEqual(T.billHoursPct({ n: 'Insulation Materials' }, h, ONE), null);
  assert.strictEqual(T.billHoursPct({ n: 'ACT Labor' }, h, ONE), null);
});

t('billing %: Mobilization / Submittals 100 once any trade line is above 0, otherwise no suggestion', () => {
  const zero = H(labor({ '112': 1000 }, {}));
  assert.strictEqual(T.billHoursPct(ONE[0], zero, ONE), null); assert.strictEqual(T.billHoursPct(ONE[2], zero, ONE), 0);
  assert.strictEqual(T.billHoursPct(ONE[1], {}, ONE), null);
  const some = H(labor({ '161': 100 }, { '161': 4 }));
  assert.strictEqual(T.billHoursPct(ONE[0], some, ONE), 100); assert.strictEqual(T.billHoursPct(ONE[8], some, ONE), 4);
});

t('job Done %: line %s weighted by pay app $, Mob / Submittals and lines without a suggestion left out', () => {
  const h = H(labor({ '112': 1000, '122': 500, '132': 800 }, { '112': 600, '122': 125 }));
  // Framing $60k at 60, Hanging $30k at 25, Finishing $30k at 0; Insulation (no budget) left out
  assert.strictEqual(T.hoursDone(ONE, h), 34); // labor lines only: (40000*60 + 20000*25 + 25000*0) / 85000 = 34.1
  assert.strictEqual(T.hoursDone(ONE, {}), null);
  assert.strictEqual(T.hoursDone([{ n: 'Framing', v: 0 }, { n: 'Hanging', v: 0 }], h), 43); // no $: plain average of 60 and 25
  // no pay app lines: each trade code weighted by its budgeted hours (142 / 172 not counted)
  const h2 = H(labor({ '112': 1000, '122': 500, '142c': 300 }, { '112': 500, '122': 500, '142c': 300 }));
  assert.strictEqual(T.hoursDone([], h2), 67); // (1000*50 + 500*100) / 1500
  assert.strictEqual(T.hoursDone([{ n: 'Mobilization', v: 1 }], h2), 67); // only Mob: same as no lines
  assert.strictEqual(T.hoursDone([], {}), null);
});

t('billing card: "Billing" title, "% from hours" column, help line, never below last month, hours shown per line', () => {
  const cur = T.billMonth(); const [y, m] = cur.split('-').map(Number); const prevP = (m === 1 ? y - 1 : y) + '-' + String(m === 1 ? 12 : m - 1).padStart(2, '0');
  S.loaded = { billing: true, labor: true }; S.job = { id: 'j', pm: null }; S.role = 'admin'; S.laborLogs = [];
  S.labor = labor({ '112': 1000, '122': 500, '132': 800 }, { '112': 600, '122': 125 });
  S.billing = { lines: ONE, history: [{ period: prevP, pcts: [100, 100, 70, 70, 10, 10, 0, 0, 30, 30] }] };
  S.billTc = { pre: {}, post: {} }; // time cards read, none on this job
  const h = T.billingCard(); S.billTc = null;
  assert.ok(h.includes('% from hours')); assert.ok(!h.includes('% complete (office)')); assert.ok(!h.includes('Crew progress'));
  assert.ok(h.includes('% from hours = time card hours on each cost code vs. the job’s budgeted hours, for reference (labor lines only; type the material %s yourself). Type this month’s % for each line, then Confirm.'));
  assert.ok(h.includes('>Billing · ')); assert.ok(!/suggest/i.test(h), 'no “suggestion” wording on the card');
  assert.ok(h.includes('600 of 1,000 hrs (job cost)')); assert.ok(h.includes('125 of 500 hrs (job cost)')); assert.ok(h.includes('id="billCard"'));
  const vals = [...h.matchAll(/data-bp="(\d+)"[^>]*value="(\d+)"/g)].map(x => +x[2]);
  deq(vals, [100, 100, 70, 70, 25, 10, 0, 0, 30, 30]); // Framing 60 < last 70 -> stays 70; Hanging Material has no % from hours -> keeps last 10; Insulation no budget -> keeps 30
  assert.ok(h.includes('(below last)'));
});

t('billing card: no budget hours -> note, last month kept; hours still loading -> note', () => {
  S.labor = {}; S.billing = { lines: ONE, history: [] };
  let h = T.billingCard();
  assert.ok(h.includes('No budget hours on the Labor tab yet'));
  deq([...h.matchAll(/data-bp="(\d+)"[^>]*value="(\d+)"/g)].map(x => +x[2]), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  S.loaded = { billing: true, labor: false }; h = T.billingCard();
  assert.ok(h.includes('Loading hours')); assert.ok(!h.includes('No budget hours'));
  S.loaded = { billing: true, labor: true }; S.billing = { lines: [] };
  assert.ok(T.billingCard().includes('No pay app lines for this job yet'));
});

// Dalling Hangar: job cost sheet as of 2026-11-24 shows 0 used on 112 (262 budget); app time cards have Juan romero and Luis Duarte 9 hrs/day on 328 code 112 on Nov 23, 24, 25
const TC_OFF = [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 13];
const day = (ps, iso) => TC_OFF.indexOf(Math.round((Date.parse(iso) - Date.parse(ps)) / 864e5));
const card = (ps, dates, extra) => ({ owner: 'f', foreman: 'Juan romero', period_start: ps, workers: ['Juan romero', 'Luis Duarte'].map(name => {
  const days = {}; dates.forEach(d => { days[day(ps, d)] = [{ job: '328 - Dalling Hangar', code: '112 Framing', hrs: 9 }].concat(extra || []) }); return { name, days }; }) });
const DAL = [card('2026-11-11', ['2026-11-23', '2026-11-24'], [{ job: '328 - Dalling Hangar', code: '001 Office', hrs: 1 }, { job: '329 - Other', code: '112', hrs: 4 }]), card('2026-11-25', ['2026-11-25'])];
const dalJob = { id: 'dal', name: '328 - Dalling Hangar', pm: null };
const dalLabor = used => ({ hpd: 10, hours: { '112': 262, '122': 300 }, cost: { as_of: '2026-11-24', history: [{ date: '2026-11-24', used }] } });

t('hours rule: used = max(job cost to its date, time cards to that date) + time cards after; 001 Office and other jobs never count', () => {
  const sp = T.tcJobSplit(DAL, ...T.tcJobKey(dalJob), '2026-11-24');
  deq(sp, { pre: { '112': 36 }, post: { '112': 18 }, cut: '2026-11-24' });
  const C = L => { S.labor = L; S.laborLogs = []; return T.laborCalc(); };
  deq(T.billHoursByCode(C(dalLabor({})), sp)['112'], { pct: 21, used: 54, bh: 262, cost: 0, tcAll: true, tc: 54 });
  // job cost ahead of the time cards up to its date: job cost + time cards after
  deq(T.billHoursByCode(C(dalLabor({ '112': 100 })), sp)['112'], { pct: 45, used: 118, bh: 262, cost: 100, tcAll: false, tc: 18 });
  assert.strictEqual(T.billHrsNote('112', T.billHoursByCode(C(dalLabor({ '112': 100 })), sp)['112']), '118 of 262 hrs (100 job cost + 18 time cards)');
  // no time cards read: job cost only; no job cost sheet: daily reports as before
  deq(T.billHoursByCode(C(dalLabor({})), null)['112'], { pct: 0, used: 0, bh: 262 });
  S.labor = { hpd: 10, hours: { '112': 400 } }; S.laborLogs = [{ date: '2026-11-02', hours: 40, hours_by_code: { '112': 40 } }];
  deq(T.billHoursByCode(T.laborCalc(), sp)['112'], { pct: 10, used: 40, bh: 400 });
  assert.strictEqual(T.billCut({ as_of: '2026-11-24', history: [{ date: '2026-11-20' }] }), '2026-11-24');
  assert.strictEqual(T.billCut({ history: [{ date: '2026-11-20' }, { date: '2026-11-13' }] }), '2026-11-20');
});

t('billing card on Dalling: 112 shows 54 of 262 hrs (54 time cards), not 0', () => {
  S.loaded = { billing: true, labor: true }; S.job = dalJob; S.role = 'admin'; S.laborLogs = [];
  S.labor = dalLabor({}); S.billTc = T.tcJobSplit(DAL, ...T.tcJobKey(dalJob), T.billCut(S.labor.cost));
  S.billing = { lines: [{ n: 'Mobilization', v: 2013 }, { n: 'Framing Labor', v: 14781 }, { n: 'Framing Material', v: 17252 }, { n: 'Hanging Labor', v: 20958 }], history: [] };
  const h = T.billingCard();
  assert.ok(h.includes('54 of 262 hrs (54 time cards)'), h.slice(0, 200)); assert.ok(!h.includes('0 of 262'));
  assert.ok(h.includes('0 of 300 hrs (job cost)'));
  deq([...h.matchAll(/data-bp="(\d+)"[^>]*value="([\d.]+)"/g)].map(x => +x[2]), [100, 21, 0, 0]);
  S.billTc = null;
});

t('billing card: last billed matched by line name when an older month has other lines', () => {
  const cur = T.billMonth(); const [y, m] = cur.split('-').map(Number); const prevP = (m === 1 ? y - 1 : y) + '-' + String(m === 1 ? 12 : m - 1).padStart(2, '0');
  S.labor = {}; S.billing = { lines: [{ n: 'Mobilization', v: 1 }, { n: 'Framing Labor', v: 1 }, { n: 'CO # 1', v: 1 }],
    history: [{ period: prevP, pcts: [40, 100], names: ['Framing Labor', 'Mobilization'] }] };
  const h = T.billingCard();
  deq([...h.matchAll(/data-bp="(\d+)"[^>]*value="([\d.]+)"/g)].map(x => +x[2]), [100, 40, 0]);
  // no names and fewer %s: by position, missing = 0
  deq(T.billPcts({ pcts: [10, 20] }, [{ n: 'A' }, { n: 'B' }, { n: 'C' }]), [10, 20, 0]);
  // old names given (pay app reload): re-matched by name, renamed line at the same spot keeps its %
  deq(T.billPcts({ pcts: [10, 20, 30] }, [{ n: 'Hanging' }, { n: 'Framing (rev)' }, { n: 'Mob' }], ['Mob', 'Framing', 'Hanging']), [30, 20, 10]);
});


t('billing month: ‹ › steps months, limited to 24 back and next month, per job', () => {
  assert.strictEqual(T.billAdd('2026-11', 1), '2026-12'); assert.strictEqual(T.billAdd('2026-01', -1), '2025-12');
});
console.log(n + ' tests passed');
