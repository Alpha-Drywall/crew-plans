// Tests for the billing suggestion from hours (Progress tab, office only): each pay app line's trade from its last trade word,
// % = labor hours used on that cost code / budgeted hours (the Labor tab's laborCalc), Labor and Material and all areas of a trade share it,
// Mobilization / Submittals go to 100 once any line is above 0, never below last month, and the job Done % used by All jobs.
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
  'PCT_SKIP', 'pctGroupName', 'pctCode', 'HRS_CODES', 'lineCode', 'hoursByCode', 'billHoursPct', 'hoursDone', 'billMonth', 'billMonthText', 'billingCard'];
const code = names.map(grab).join('\n') + '\n;({' + names.join(',') + '})';
const S = { loaded: {}, role: 'admin' };
const T = vm.runInNewContext(code, { S, Math, Date, String, Number, Set, Object, Array, isFinite, parseFloat, who: id => id ? 'User ' + id : 'Someone' });
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

t('billing %: Labor and Material and every area of a trade get the same %, no code or budget = no suggestion', () => {
  const h = H(labor({ '112': 1000, '122': 500, '132': 800 }, { '112': 600, '122': 125 }));
  deq(ONE.map(l => T.billHoursPct(l, h, ONE)), [100, 100, 60, 60, 25, 25, 0, 0, null, null]); // 161 has no budget: keep last month
  deq(TWO.map(l => T.billHoursPct(l, h, TWO)), [100, 60, 60, 60, 60, 25, 25]);
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
  assert.strictEqual(T.hoursDone(ONE, h), 36); // (36000 + 7500) / 120000 = 36.25
  assert.strictEqual(T.hoursDone(ONE, {}), null);
  assert.strictEqual(T.hoursDone([{ n: 'Framing', v: 0 }, { n: 'Hanging', v: 0 }], h), 43); // no $: plain average of 60 and 25
  // no pay app lines: each trade code weighted by its budgeted hours (142 / 172 not counted)
  const h2 = H(labor({ '112': 1000, '122': 500, '142c': 300 }, { '112': 500, '122': 500, '142c': 300 }));
  assert.strictEqual(T.hoursDone([], h2), 67); // (1000*50 + 500*100) / 1500
  assert.strictEqual(T.hoursDone([{ n: 'Mobilization', v: 1 }], h2), 67); // only Mob: same as no lines
  assert.strictEqual(T.hoursDone([], {}), null);
});

t('billing card: "% from hours" column, help line, never below last month, hours shown per line', () => {
  const cur = T.billMonth(); const [y, m] = cur.split('-').map(Number); const prevP = (m === 1 ? y - 1 : y) + '-' + String(m === 1 ? 12 : m - 1).padStart(2, '0');
  S.loaded = { billing: true, labor: true }; S.job = { id: 'j', pm: null }; S.role = 'admin'; S.laborLogs = [];
  S.labor = labor({ '112': 1000, '122': 500, '132': 800 }, { '112': 600, '122': 125 });
  S.billing = { lines: ONE, history: [{ period: prevP, pcts: [100, 100, 70, 70, 10, 10, 0, 0, 30, 30] }] };
  const h = T.billingCard();
  assert.ok(h.includes('% from hours')); assert.ok(!h.includes('% complete (office)')); assert.ok(!h.includes('Crew progress'));
  assert.ok(h.includes('Suggested from time card hours on each cost code vs. the job’s budgeted hours. Check it against the field before confirming.'));
  assert.ok(h.includes('112: 600 of 1,000 hrs')); assert.ok(h.includes('122: 125 of 500 hrs')); assert.ok(h.includes('id="billCard"'));
  const vals = [...h.matchAll(/data-bp="(\d+)"[^>]*value="(\d+)"/g)].map(x => +x[2]);
  deq(vals, [100, 100, 70, 70, 25, 25, 0, 0, 30, 30]); // Framing 60 < last 70 -> stays 70; Insulation no budget -> keeps 30
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

console.log(n + ' tests passed');
