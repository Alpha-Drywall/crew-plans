// Tests for the "All jobs at a glance" per-job math (% complete set by the office, % billed, % man days used, flags). Pulls the functions out of index.html and runs them with stubbed data.
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
  'PCT_SKIP', 'pctGroupName', 'pctCode', 'PCT_KCODE', 'pctRows', 'pctGet', 'pctVal', 'pctWeighted', 'pctForCode',
  'LABOR_CODES', 'codeHrs', 'weekEnd', 'f1', 'fmtWk', 'LABOR_SHOW_TC', 'laborEff', 'laborCost', 'laborCalc', 'laborDone', 'laborAlerts',
  'DASH_UNDERBILL', 'dashBill', 'dashCalc'];
const code = names.map(grab).join('\n') + '\nlet PHASES=DEFAULT_SCOPE;\n;({' + names.concat(['DASH_AHEAD']).join(',') +
  ',getPHASES:()=>PHASES})';
const S = {};
const T = vm.runInNewContext(code, { S, Math, Date, String, Number, Set, Object, Array, isFinite, parseFloat });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ' expected ' + b + ' got ' + a);

const area = pct => ({ pct }); // old area progress: no longer used for % complete
// the office % complete (job_budget.labor.progress), by group name
const prog = groups => ({ set_at: '2026-11-20T12:00:00Z', groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, { pct: v }])) });
const withP = (L, g) => Object.assign({}, L, { progress: prog(g) });
const job = (id, scope) => ({ id, name: id, scope });
const LINES = [{ n: 'Framing', v: 100000 }, { n: 'Hanging', v: 50000 }, { n: 'Finishing', v: 50000 }];

t('% complete: office % weighted by pay app $, scope items without lines, "–" until set', () => {
  // pay app lines: Framing $100k, Hanging $50k, Finishing $50k
  assert.strictEqual(T.dashCalc(job('a', null), withP({ billing: { lines: LINES } }, { Framing: 80, Hanging: 40, Finishing: 0 }), [], false, [], null).done, 50); // (80*100 + 40*50) / 200
  // Labor + Material lines share one group; Mobilization left out
  const LM = [{ n: 'Mobilization', v: 5000 }, { n: 'Framing Labor', v: 60000 }, { n: 'Framing Material', v: 40000 }, { n: 'Insulation Labor', v: 100000 }];
  assert.strictEqual(T.dashCalc(job('a', null), withP({ billing: { lines: LM } }, { Framing: 100, Insulation: 50 }), [], false, [], null).done, 75);
  // no pay app lines: one row per scope item, weighted by SOV $ when set, plain average otherwise
  const sc = [{ k: 'framing', n: 'Framing', w: 60000 }, { k: 'board', n: 'Board', w: 40000 }];
  assert.strictEqual(T.dashCalc(job('a', sc), withP({}, { Framing: 75, Board: 25 }), [], false, [], null).done, 55);
  const un = [{ k: 'framing', n: 'Framing' }, { k: 'board', n: 'Board' }];
  assert.strictEqual(T.dashCalc(job('a', un), withP({}, { Framing: 75, Board: 25 }), [], false, [], null).done, 50);
  const r = T.dashCalc(job('a', sc), withP({}, { Framing: 75 }), [], false, [], null);
  assert.strictEqual(r.done, 45); assert.strictEqual(r.pset, '2026-11-20T12:00:00Z'); // Board never set counts as 0 once set
  // never set: "–", even with old area progress around
  const none = T.dashCalc(job('a', sc), { billing: { lines: LINES } }, [area({ framing: 100 })], true, [], null);
  assert.strictEqual(none.done, null); assert.strictEqual(none.pset, null);
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
  const sc = [{ k: 'framing', w: 60000 }, { k: 'board', w: 40000 }];
  const L = withP({ hpd: 10, hours: { '112': 1000, '122': 500 }, cost: { history: [{ date: '2026-11-20', used: { '112': 700, '122': 100 } }] }, billing: { lines: LINES, history: [{ period: '2026-10', pcts: [80, 40, 10] }] } },
    { Framing: 70, Hanging: 40, Finishing: 0 });
  const r = T.dashCalc(job('a', sc), L, [], true, [], null); // done 45, billed 52.5, used 53
  assert.strictEqual(r.done, 45);
  assert.strictEqual(r.flags, 0); assert.strictEqual(r.under, 0); assert.strictEqual(r.ahead, 0); assert.strictEqual(r.behind, 0); assert.strictEqual(r.tab, 'progress');
});

t('flags: labor behind + hours ahead of progress -> opens the Labor tab', () => {
  const L = { hpd: 10, hours: { '112': 1000 }, cost: { history: [{ date: '2026-11-20', used: { '112': 600 } }] } };
  const fr = [{ k: 'framing' }];
  const r = T.dashCalc(job('b', fr), withP(L, { Framing: 30 }), [], true, [], null);
  assert.strictEqual(r.done, 30); near(r.used, 60);
  assert.strictEqual(r.behind, 1); assert.strictEqual(r.over, 0); assert.strictEqual(r.ahead, 30);
  assert.strictEqual(r.flags, 2); assert.strictEqual(r.tab, 'labor');
  const edge = T.dashCalc(job('b', fr), withP(L, { Framing: 46 }), [], true, [], null); // 60 - 46 = 14: under the line
  assert.strictEqual(edge.ahead, 0);
  const at = T.dashCalc(job('b', fr), withP(L, { Framing: 45 }), [], true, [], null); // exactly 15 points
  assert.strictEqual(at.ahead, 15);
  const unset = T.dashCalc(job('b', fr), L, [area({ framing: 100 })], true, [], null); // % complete never set: only the 80%-used rule could flag
  assert.strictEqual(unset.done, null); assert.strictEqual(unset.ahead, 0); assert.strictEqual(unset.behind, 0);
});

t('flags: over budget counts per cost code', () => {
  const L = { hpd: 10, hours: { '112': 400, '122': 200 }, cost: { history: [{ date: '2026-11-20', used: { '112': 440, '122': 260 } }] } };
  const r = T.dashCalc(job('c', null), L, [], false, [], null);
  assert.strictEqual(r.over, 2); assert.strictEqual(r.flags, 2); assert.ok(r.used > 100); assert.strictEqual(r.tab, 'labor');
});

t('flags: under-billed and progress not marked -> opens the Progress tab', () => {
  const L = { billing: { lines: LINES, history: [{ period: '2026-10', pcts: [40, 0, 0] }] } }; // 20% billed
  const all = p => ({ Framing: p, Hanging: p, Finishing: p });
  const r = T.dashCalc(job('d', [{ k: 'framing' }]), withP(L, all(30)), [], true, [], { days: 3 });
  assert.strictEqual(r.under, 10); assert.ok(r.nudge); assert.strictEqual(r.flags, 2); assert.strictEqual(r.tab, 'progress');
  const r9 = T.dashCalc(job('d', [{ k: 'framing' }]), withP(L, all(29)), [], true, [], null);
  assert.strictEqual(r9.under, 0); assert.strictEqual(r9.flags, 0);
  // pay app lines but nothing confirmed yet counts as 0% billed; no pay app lines = no billing flag
  const nb = T.dashCalc(job('d', [{ k: 'framing' }]), withP({ billing: { lines: LINES } }, all(30)), [], true, [], null);
  assert.strictEqual(nb.billed, null); assert.strictEqual(nb.under, 30);
  const nl = T.dashCalc(job('d', [{ k: 'framing' }]), withP({}, { Framing: 30 }), [], true, [], null);
  assert.strictEqual(nl.done, 30); assert.strictEqual(nl.under, 0); assert.strictEqual(nl.contract, 0);
});

t('the open job is left alone (globals restored)', () => {
  const sc = [{ k: 'framing', n: 'Framing', c: '#2563eb', w: 0 }];
  S.labor = { tag: 'open' }; S.laborLogs = ['x']; S.laborTc = { y: 1 }; S.areas = ['z'];
  const before = T.getPHASES();
  T.dashCalc(job('e', sc), withP({ hours: { '112': 10 } }, { Framing: 5 }), [area({ framing: 5 })], true, [], null);
  assert.deepStrictEqual(S.labor, { tag: 'open' }); assert.deepStrictEqual(S.laborLogs, ['x']); assert.deepStrictEqual(S.laborTc, { y: 1 }); assert.deepStrictEqual(S.areas, ['z']);
  assert.strictEqual(T.getPHASES(), before);
});

console.log(n + ' tests passed');
