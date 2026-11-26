// Tests for the "All jobs at a glance" per-job math (Done % from hours, % billed, % man days used, flags). Pulls the functions out of index.html and runs them with stubbed data.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const src = (fs.readFileSync('index.html', 'utf8').match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1];

const lines = src.split('\n');
function grab(name) {
  const re = new RegExp('^(?:async )?(?:function ' + name + '\\(|const ' + name + '=)');
  const i = lines.findIndex(l => re.test(l));
  if (i < 0) throw new Error('not found in index.html: ' + name);
  let j = i + 1;
  if (!lines[i].startsWith('const ')) while (j < lines.length && /^(\s|\})/.test(lines[j])) j++;
  return lines.slice(i, j).join('\n');
}
const names = ['num', 'clamp', 'areaPct', 'SCOPE_CATALOG', 'CUSTOM_COLORS', 'DEFAULT_SCOPE', 'normScope',
  'PCT_SKIP', 'pctGroupName', 'pctCode', 'HRS_CODES', 'lineCode', 'hoursByCode', 'BILL_MAT', 'billHoursPct', 'hoursDone',
  'LABOR_CODES', 'codeHrs', 'weekEnd', 'f1', 'fmtWk', 'LABOR_SHOW_TC', 'laborEff', 'laborCost', 'laborCalc', 'LABOR_WARN', 'laborAlerts',
  'DASH_UNDERBILL', 'r2', 'laborCut', 'billCut', 'billHoursByCode', 'billKey', 'billPcts', 'dashBill', 'dashCalc',
  'tcKey', 'TC_ANCHOR', 'isoAddD', 'tcHrs', 'tcLineNo', 'tcIsJob', 'tcLabCode', 'tcJobNo', 'tcJobShort', 'tcJobKey', 'tcJobSplit'];
const code = names.map(grab).join('\n') + '\nlet PHASES=DEFAULT_SCOPE;\n;({' + names.join(',') + ',getPHASES:()=>PHASES})';
const S = {};
const T = vm.runInNewContext(code, { S, Math, Date, String, Number, Set, Object, Array, isFinite, parseFloat });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ' expected ' + b + ' got ' + a);

const area = pct => ({ pct }); // old area progress: not used
const job = (id, scope) => ({ id, name: id, scope });
const LINES = [{ n: 'Framing', v: 100000 }, { n: 'Hanging', v: 50000 }, { n: 'Finishing', v: 50000 }];
// budget hours + used hours (job cost sheet), like the Labor tab
const hrs = (budget, used, extra) => Object.assign({ hpd: 10, hours: budget, cost: { history: [{ date: '2026-11-20', used }] } }, extra || {});
const OLDP = { progress: { set_at: '2026-11-20T12:00:00Z', groups: { Framing: { pct: 99 } } } }; // the retired office % complete: ignored

t('Done %: hours used / budget per trade code, weighted by pay app $; by budget hours with no lines; – without budget', () => {
  // Framing $100k at 112 = 80%, Hanging $50k at 122 = 40%, Finishing $50k at 132 = 0%
  const L = hrs({ '112': 1000, '122': 500, '132': 500 }, { '112': 800, '122': 200 }, Object.assign({ billing: { lines: LINES } }, OLDP));
  assert.strictEqual(T.dashCalc(job('a', null), L, [], false, [], null).done, 50); // (80*100 + 40*50) / 200
  // Labor lines count with their own $; Material lines (no % from hours) and Mobilization left out: (60000*100 + 100000*50) / 160000
  const LM = [{ n: 'Mobilization', v: 5000 }, { n: 'Framing Labor', v: 60000 }, { n: 'Framing Material', v: 40000 }, { n: 'Insulation Labor', v: 100000 }];
  assert.strictEqual(T.dashCalc(job('a', null), hrs({ '112': 100, '161': 100 }, { '112': 150, '161': 50 }, { billing: { lines: LM } }), [], false, [], null).done, 69);
  // a line whose code has no budget is left out of the weighting
  assert.strictEqual(T.dashCalc(job('a', null), hrs({ '112': 100 }, { '112': 30 }, { billing: { lines: LM } }), [], false, [], null).done, 30);
  // no pay app lines: trade codes weighted by budget hours
  assert.strictEqual(T.dashCalc(job('a', null), hrs({ '112': 600, '122': 400, '142s': 500 }, { '112': 450, '122': 100, '142s': 500 }), [], false, [], null).done, 55); // (600*75 + 400*25) / 1000
  // no budget: "–", even with the old % complete or old area progress around
  const none = T.dashCalc(job('a', [{ k: 'framing' }]), Object.assign({ billing: { lines: LINES } }, OLDP), [area({ framing: 100 })], true, [], null);
  assert.strictEqual(none.done, null);
  // no job cost sheet: daily report hours by code
  const logs = [{ date: '2026-11-02', hours: 50, hours_by_code: { '112': 50 } }, { date: '2026-11-03', hours: 50, hours_by_code: { '112': 50 } }];
  assert.strictEqual(T.dashCalc(job('a', null), { hpd: 10, hours: { '112': 400 } }, [], false, logs, null).done, 25);
});

t('% billed: last confirmed month, $ to date over the contract', () => {
  const b = T.dashBill({ billing: { lines: LINES, history: [{ period: '2026-10', pcts: [80, 40, 10] }, { period: '2026-09', pcts: [50, 0, 0] }] } });
  assert.strictEqual(b.contract, 200000); assert.strictEqual(b.billed, 105000); near(b.pct, 52.5); assert.strictEqual(b.period, '2026-10');
  const none = T.dashBill({ billing: { lines: LINES, history: [] } });
  assert.strictEqual(none.contract, 200000); assert.strictEqual(none.pct, null); assert.strictEqual(none.period, null);
  const empty = T.dashBill({});
  assert.strictEqual(empty.contract, 0); assert.strictEqual(empty.pct, null);
  const capped = T.dashBill({ billing: { lines: LINES, history: [{ period: '2026-11', pcts: [120, '50'] }] } });
  assert.strictEqual(capped.billed, 125000); // % over 100 capped, missing line = 0, text % read as a number
});

t('% man days used: job cost sheet used / budget, same as the Labor tab', () => {
  const L = { hpd: 10, hours: { '112': 1000, '122': 500 }, cost: { as_of: '2026-11-20', history: [{ date: '2026-11-20', used: { '112': 700, '122': 100 } }, { date: '2026-11-06', used: { '112': 300 } }] } };
  const r = T.dashCalc(job('a', [{ k: 'framing' }]), L, [], false, [], null);
  assert.strictEqual(r.md, 150); assert.strictEqual(r.usedMd, 80); near(r.used, 80 / 150 * 100); assert.ok(r.cost);
  const hpd8 = T.dashCalc(job('a', null), Object.assign({}, L, { hpd: 8 }), [], false, [], null);
  near(hpd8.used, 80 / 150 * 100, 'hrs/day cancels out');
  const nob = T.dashCalc(job('a', null), {}, [], false, [], null);
  assert.strictEqual(nob.used, null); assert.strictEqual(nob.md, 0);
  // no job cost sheet yet: the Labor tab counts daily report hours by cost code
  const logs = [{ date: '2026-11-02', hours: 50, hours_by_code: { '112': 50 } }, { date: '2026-11-03', hours: 50, hours_by_code: { '112': 50 } }];
  const lg = T.dashCalc(job('a', null), { hpd: 10, hours: { '112': 400 } }, [], false, logs, null);
  assert.strictEqual(lg.usedMd, 10); near(lg.used, 25); assert.ok(!lg.cost);
});

t('flags: a healthy job has none', () => {
  const L = hrs({ '112': 1000, '122': 500 }, { '112': 700, '122': 100 }, { billing: { lines: LINES, history: [{ period: '2026-10', pcts: [80, 40, 10] }] } });
  const r = T.dashCalc(job('a', null), L, [], true, [], null); // done (70*100 + 20*50) / 150 = 53, billed 52.5, used 53
  assert.strictEqual(r.done, 53);
  assert.strictEqual(r.flags, 0); assert.strictEqual(r.under, 0); assert.strictEqual(r.near, 0); assert.strictEqual(r.over, 0); assert.strictEqual(r.tab, 'progress');
  assert.strictEqual(r.ahead, undefined); assert.strictEqual(T.DASH_AHEAD, undefined); // hours vs hours: no "hours ahead" flag any more
});

t('flags: near budget at 90%+ of a code’s hours -> opens the Labor tab', () => {
  const L = hrs({ '112': 1000 }, { '112': 900 });
  const r = T.dashCalc(job('b', null), L, [], true, [], null);
  assert.strictEqual(r.done, 90); near(r.used, 90);
  assert.strictEqual(r.near, 1); assert.strictEqual(r.over, 0); assert.strictEqual(r.flags, 1); assert.strictEqual(r.tab, 'labor');
  const under = T.dashCalc(job('b', null), hrs({ '112': 1000 }, { '112': 890 }), [], true, [], null);
  assert.strictEqual(under.near, 0); assert.strictEqual(under.flags, 0);
});

t('flags: over budget counts per cost code; Done caps at 100', () => {
  const L = hrs({ '112': 400, '122': 200 }, { '112': 440, '122': 260 });
  const r = T.dashCalc(job('c', null), L, [], false, [], null);
  assert.strictEqual(r.over, 2); assert.strictEqual(r.near, 0); assert.strictEqual(r.flags, 2); assert.ok(r.used > 100); assert.strictEqual(r.tab, 'labor');
  assert.strictEqual(r.done, 100);
});

t('flags: under-billed (hours % vs billed %) and progress not marked -> opens the Billing tab', () => {
  const B = { billing: { lines: LINES, history: [{ period: '2026-10', pcts: [40, 0, 0] }] } }; // 20% billed
  const all = p => hrs({ '112': 1000, '122': 1000, '132': 1000 }, { '112': p * 10, '122': p * 10, '132': p * 10 }, B);
  const r = T.dashCalc(job('d', null), all(30), [], true, [], { days: 3 });
  assert.strictEqual(r.done, 30); assert.strictEqual(r.under, 10); assert.ok(r.nudge); assert.strictEqual(r.flags, 2); assert.strictEqual(r.tab, 'billing');
  assert.strictEqual(T.dashCalc(job('d', null), all(30), [], true, [], { days: 3 }).tab, 'billing');
  const r9 = T.dashCalc(job('d', null), all(29), [], true, [], null);
  assert.strictEqual(r9.under, 0); assert.strictEqual(r9.flags, 0);
  // pay app lines but nothing confirmed yet counts as 0% billed; no pay app lines = no billing flag
  const nb = T.dashCalc(job('d', null), hrs({ '112': 1000 }, { '112': 300 }, { billing: { lines: LINES } }), [], true, [], null);
  assert.strictEqual(nb.billed, null); assert.strictEqual(nb.done, 30); assert.strictEqual(nb.under, 30);
  const nl = T.dashCalc(job('d', null), hrs({ '112': 1000 }, { '112': 300 }), [], true, [], null);
  assert.strictEqual(nl.done, 30); assert.strictEqual(nl.under, 0); assert.strictEqual(nl.contract, 0);
});

t('Done % counts time cards past the job cost sheet: max(job cost, time cards to its date) + time cards after (Dalling: 54 hrs on 112)', () => {
  // job cost as of 2026-11-24 shows 0 used on 112 of 262 budget; two workers 9 hrs/day on 328 code 112 on Nov 23, 24 and 25 (Nov 23-24 on the 11-11 card, Nov 25 on the 11-25 card)
  const day = (ps, iso) => [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 13].indexOf(Math.round((Date.parse(iso) - Date.parse(ps)) / 864e5));
  const wk = (name, ps, dates) => { const days = {}; dates.forEach(d => { days[day(ps, d)] = [{ job: '328 - Dalling Hangar', code: '112 Framing', hrs: 9 }] }); return { name, days }; };
  const cards = [{ owner: 'f', foreman: 'Juan romero', period_start: '2026-11-11', workers: [wk('Juan romero', '2026-11-11', ['2026-11-23', '2026-11-24']), wk('Luis Duarte', '2026-11-11', ['2026-11-23', '2026-11-24'])] },
    { owner: 'f', foreman: 'Juan romero', period_start: '2026-11-25', workers: [wk('Juan romero', '2026-11-25', ['2026-11-25']), wk('Luis Duarte', '2026-11-25', ['2026-11-25'])] }];
  const L = { hpd: 10, hours: { '112': 262 }, cost: { as_of: '2026-11-24', history: [{ date: '2026-11-24', used: {} }] }, billing: { lines: [{ n: 'Framing Labor', v: 14781 }] } };
  const j = { id: 'dal', name: '328 - Dalling Hangar' };
  const tc = T.tcJobSplit(cards, ...T.tcJobKey(j), T.billCut(L.cost));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(tc)), { pre: { '112': 36 }, post: { '112': 18 }, cut: '2026-11-24' });
  assert.strictEqual(T.dashCalc(j, L, [], false, [], null, tc).done, 21); // 54 / 262
  assert.strictEqual(T.dashCalc(j, L, [], false, [], null).done, 0); // without time cards: job cost only
  assert.strictEqual(T.dashCalc(j, L, [], false, [], null, tc).used, 0); // Man days used stays the official job cost number
});

t('% billed reads a history entry by line name when it has names', () => {
  const b = T.dashBill({ billing: { lines: LINES, history: [{ period: '2026-11', pcts: [100, 50], names: ['Hanging', 'Framing'] }] } });
  assert.strictEqual(b.billed, 100000); // Framing 50% of 100k + Hanging 100% of 50k
});

t('the open job is left alone (globals restored)', () => {
  const sc = [{ k: 'framing', n: 'Framing', c: '#2563eb', w: 0 }];
  S.labor = { tag: 'open' }; S.laborLogs = ['x']; S.laborTc = { y: 1 }; S.areas = ['z'];
  const before = T.getPHASES();
  T.dashCalc(job('e', sc), { hours: { '112': 10 } }, [area({ framing: 5 })], true, [], null);
  assert.deepStrictEqual(S.labor, { tag: 'open' }); assert.deepStrictEqual(S.laborLogs, ['x']); assert.deepStrictEqual(S.laborTc, { y: 1 }); assert.deepStrictEqual(S.areas, ['z']);
  assert.strictEqual(T.getPHASES(), before);
});

console.log(n + ' tests passed');
