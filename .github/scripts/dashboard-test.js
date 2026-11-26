// Tests for the "All jobs at a glance" per-job math (% complete, % billed, % man days used, flags). Pulls the functions out of index.html and runs them with stubbed data.
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
const names = ['num', 'clamp', 'areaPct', 'SCOPE_CATALOG', 'CUSTOM_COLORS', 'DEFAULT_SCOPE', 'normScope', 'weighted', 'overallPct', 'avg',
  'LABOR_CODES', 'codeHrs', 'weekEnd', 'f1', 'fmtWk', 'LABOR_SHOW_TC', 'laborEff', 'laborCost', 'laborCalc', 'laborDone', 'laborAlerts',
  'DASH_UNDERBILL', 'dashBill', 'dashCalc'];
const code = names.map(grab).join('\n') + '\nlet PHASES=DEFAULT_SCOPE;\n;({' + names.concat(['DASH_AHEAD']).join(',') +
  ',getPHASES:()=>PHASES})';
const S = {};
const T = vm.runInNewContext(code, { S, Math, Date, String, Number, Set, Object, Array, isFinite, parseFloat });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ' expected ' + b + ' got ' + a);

const area = pct => ({ pct });
const job = (id, scope) => ({ id, name: id, scope });
const LINES = [{ n: 'Framing', v: 100000 }, { n: 'Hanging', v: 50000 }, { n: 'Finishing', v: 50000 }];

t('% complete: weighted by SOV $ like the Progress tab, "–" without progress sheets or markups', () => {
  const sc = [{ k: 'framing', n: 'Framing', w: 60000 }, { k: 'board', n: 'Board', w: 40000 }];
  const A = [area({ framing: 100, board: 50 }), area({ framing: 50, board: 0 })]; // framing 75, board 25
  assert.strictEqual(T.dashCalc(job('a', sc), {}, A, true, [], null).done, 55); // (75*60 + 25*40) / 100
  const un = [{ k: 'framing', n: 'Framing' }, { k: 'board', n: 'Board' }];
  assert.strictEqual(T.dashCalc(job('a', un), {}, A, true, [], null).done, 50); // plain average of 75 and 25
  assert.strictEqual(T.dashCalc(job('a', null), {}, [area({ framing: 100, board: 100, tape: 0, finish: 0 })], true, [], null).done, 50); // default scope
  assert.strictEqual(T.dashCalc(job('a', sc), {}, A, false, [], null).done, null); // no progress sheets
  assert.strictEqual(T.dashCalc(job('a', sc), {}, [], true, [], null).done, null); // sheets but nothing marked
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
  const A = [area({ framing: 100, board: 50 }), area({ framing: 50, board: 0 })];
  const L = { hpd: 10, hours: { '112': 1000, '122': 500 }, cost: { history: [{ date: '2026-11-20', used: { '112': 700, '122': 100 } }] }, billing: { lines: LINES, history: [{ period: '2026-10', pcts: [80, 40, 10] }] } };
  const r = T.dashCalc(job('a', sc), L, A, true, [], null); // done 55, billed 52.5, used 53
  assert.strictEqual(r.flags, 0); assert.strictEqual(r.under, 0); assert.strictEqual(r.ahead, 0); assert.strictEqual(r.tab, 'progress');
});

t('flags: labor behind + hours ahead of progress -> opens the Labor tab', () => {
  const L = { hpd: 10, hours: { '112': 1000 }, cost: { history: [{ date: '2026-11-20', used: { '112': 600 } }] } };
  const r = T.dashCalc(job('b', [{ k: 'framing' }]), L, [area({ framing: 30 })], true, [], null);
  assert.strictEqual(r.done, 30); near(r.used, 60);
  assert.strictEqual(r.behind, 1); assert.strictEqual(r.over, 0); assert.strictEqual(r.ahead, 30);
  assert.strictEqual(r.flags, 2); assert.strictEqual(r.tab, 'labor');
  const edge = T.dashCalc(job('b', [{ k: 'framing' }]), L, [area({ framing: 46 })], true, [], null); // 60 - 46 = 14: under the line
  assert.strictEqual(edge.ahead, 0);
  const at = T.dashCalc(job('b', [{ k: 'framing' }]), L, [area({ framing: 45 })], true, [], null); // exactly 15 points
  assert.strictEqual(at.ahead, 15);
});

t('flags: over budget counts per cost code', () => {
  const L = { hpd: 10, hours: { '112': 400, '122': 200 }, cost: { history: [{ date: '2026-11-20', used: { '112': 440, '122': 260 } }] } };
  const r = T.dashCalc(job('c', null), L, [], false, [], null);
  assert.strictEqual(r.over, 2); assert.strictEqual(r.flags, 2); assert.ok(r.used > 100); assert.strictEqual(r.tab, 'labor');
});

t('flags: under-billed and progress not marked -> opens the Progress tab', () => {
  const L = { billing: { lines: LINES, history: [{ period: '2026-10', pcts: [40, 0, 0] }] } }; // 20% billed
  const r = T.dashCalc(job('d', [{ k: 'framing' }]), L, [area({ framing: 30 })], true, [], { days: 3 });
  assert.strictEqual(r.under, 10); assert.ok(r.nudge); assert.strictEqual(r.flags, 2); assert.strictEqual(r.tab, 'progress');
  const r9 = T.dashCalc(job('d', [{ k: 'framing' }]), L, [area({ framing: 29 })], true, [], null);
  assert.strictEqual(r9.under, 0); assert.strictEqual(r9.flags, 0);
  // pay app lines but nothing confirmed yet counts as 0% billed; no pay app lines = no billing flag
  const nb = T.dashCalc(job('d', [{ k: 'framing' }]), { billing: { lines: LINES } }, [area({ framing: 30 })], true, [], null);
  assert.strictEqual(nb.billed, null); assert.strictEqual(nb.under, 30);
  const nl = T.dashCalc(job('d', [{ k: 'framing' }]), {}, [area({ framing: 30 })], true, [], null);
  assert.strictEqual(nl.under, 0); assert.strictEqual(nl.contract, 0);
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
