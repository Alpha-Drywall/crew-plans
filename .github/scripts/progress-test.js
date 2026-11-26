// Tests for the office "% complete" (Progress tab): grouping pay app lines into SOV area + trade, $ weighting,
// labor alerts work done per cost code, billing suggestion from the groups, scope fallback, and the "new markups" reminder.
// Pulls the functions out of index.html and runs them with stubbed data.
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
const names = ['num', 'clamp', 'esc', 'money', 'SCOPE_CATALOG', 'CUSTOM_COLORS', 'DEFAULT_SCOPE', 'normScope', 'isAdminRole', 'canEditLaborRate',
  'PCT_SKIP', 'pctGroupName', 'pctCode', 'PCT_KCODE', 'pctRows', 'pctGet', 'pctVal', 'pctWeighted', 'pctForCode', 'pctNext', 'pctStale', 'pctDay',
  'laborDone', 'billMonth', 'billMonthText', 'billCrewPct', 'billingCard', 'pctCard'];
const code = names.map(grab).join('\n') + '\nlet PHASES=DEFAULT_SCOPE;\n;({' + names.join(',') + ',setPHASES:p=>{PHASES=normScope(p)}})';
const S = { loaded: {}, role: 'admin' };
const T = vm.runInNewContext(code, { S, Math, Date, String, Number, Set, Object, Array, isFinite, parseFloat, who: id => id ? 'User ' + id : 'Someone' });
const deq = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b); // values from the vm are another realm
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };
const P = (g, at) => ({ set_at: at || '2026-11-20T12:00:00Z', groups: Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { pct: v }])) });

// a single-area job (block 1 = frame/hang/finish, block 2 = insulation) and a two-building job
const ONE = [{ n: 'Mobilization', v: 4000 }, { n: 'Submittals', v: 1000 }, { n: 'Framing Labor', v: 40000 }, { n: 'Framing Material', v: 20000 },
  { n: 'Hanging Labor', v: 20000 }, { n: 'Hanging Material', v: 10000 }, { n: 'Finishing Labor', v: 25000 }, { n: 'Finishing Material', v: 5000 },
  { n: 'Insulation Labor', v: 6000 }, { n: 'Insulation Material', v: 4000 }];
const TWO = [{ n: 'Mobilization', v: 5000 }, { n: 'Bldg A Framing Labor', v: 30000 }, { n: 'Bldg A Framing Material', v: 30000 },
  { n: 'Bldg B Framing Labor', v: 10000 }, { n: 'Bldg B Framing Material', v: 10000 }, { n: 'Bldg A Hanging Labor', v: 20000 }, { n: 'Bldg B Hanging - Material', v: 10000 }];

t('group names: trailing Labor / Material stripped, Mobilization and Submittals left out', () => {
  const g = T.pctGroupName;
  assert.strictEqual(g('Framing Labor'), 'Framing'); assert.strictEqual(g('Framing Material'), 'Framing');
  assert.strictEqual(g('Insulation Materials'), 'Insulation'); assert.strictEqual(g('Finishing Labour'), 'Finishing');
  assert.strictEqual(g('Bldg A Framing Labor'), 'Bldg A Framing'); assert.strictEqual(g('Bldg B Hanging - Material'), 'Bldg B Hanging');
  assert.strictEqual(g('Level 2  Finishing (Labor)'), 'Level 2 Finishing'); assert.strictEqual(g('Hanging Mat’l'), 'Hanging');
  assert.strictEqual(g('Framing'), 'Framing'); // a line without Labor/Material is its own group
  assert.strictEqual(g('Mobilization'), null); assert.strictEqual(g('Submittals'), null); assert.strictEqual(g(''), null);
});

t('trade code from the last trade word (area first): 112 / 122 / 132 / 161', () => {
  const c = T.pctCode;
  assert.strictEqual(c('Framing'), '112'); assert.strictEqual(c('Bldg A Framing'), '112'); assert.strictEqual(c('Hanging'), '122'); assert.strictEqual(c('Board'), '122');
  assert.strictEqual(c('Finishing'), '132'); assert.strictEqual(c('Tape'), '132'); assert.strictEqual(c('Insulation'), '161');
  assert.strictEqual(c('Boardroom Wing Framing'), '112'); // area word before the trade does not win
  assert.strictEqual(c('Doors & Frames'), null); assert.strictEqual(c('Frame'), '112'); assert.strictEqual(c('ACT'), null);
});

t('rows: one per area + trade with the group $, Labor and Material combined, in pay app order', () => {
  const r = T.pctRows(ONE, []);
  deq(r.map(x => [x.name, x.v, x.code]), [['Framing', 60000, '112'], ['Hanging', 30000, '122'], ['Finishing', 30000, '132'], ['Insulation', 10000, '161']]);
  deq(r[0].lines, [2, 3]); assert.strictEqual(r[0].src, 'lines');
  const r2 = T.pctRows(TWO, []);
  deq(r2.map(x => [x.name, x.v]), [['Bldg A Framing', 60000], ['Bldg B Framing', 20000], ['Bldg A Hanging', 20000], ['Bldg B Hanging', 10000]]);
  const ci = T.pctRows([{ n: 'framing labor', v: 1 }, { n: 'Framing Material', v: 2 }], []);
  assert.strictEqual(ci.length, 1); assert.strictEqual(ci[0].v, 3); // case does not split a group
});

t('fallback without pay app lines: one row per job scope item, SOV $ from the scope', () => {
  const sc = T.normScope([{ k: 'framing', w: 50000 }, { k: 'board', w: 20000 }, { k: 'tape' }, { k: 'finish' }, { k: 'insulation' }, { k: 'soffits', n: 'Soffits' }]);
  const r = T.pctRows([], sc);
  deq(r.map(x => [x.name, x.v, x.code, x.src]), [['Framing', 50000, '112', 'scope'], ['Board', 20000, '122', 'scope'], ['Tape', 0, '132', 'scope'],
    ['Finish', 0, '132', 'scope'], ['Insulation', 0, '161', 'scope'], ['Soffits', 0, null, 'scope']]);
  assert.strictEqual(T.pctRows([{ n: 'Mobilization', v: 1 }], sc).length, 6); // only Mob / Submittals: still the scope rows
});

t('weighting: $-weighted, plain average without $, null until set, unset group = 0 once set', () => {
  const r = T.pctRows(ONE, []);
  assert.strictEqual(T.pctWeighted(r, null), null);
  assert.strictEqual(T.pctWeighted(r, { groups: { Framing: { pct: 100 } } }), null); // no set_at: never saved
  assert.strictEqual(T.pctWeighted(r, P({ Framing: 100, Hanging: 50, Finishing: 0, Insulation: 100 })), 65); // (60k + 15k + 0 + 10k) / 130k
  assert.strictEqual(T.pctWeighted(r, P({ framing: 100 })), 46); // name match ignores case; others 0: 60k / 130k
  assert.strictEqual(T.pctWeighted([{ name: 'A', v: 0 }, { name: 'B', v: 0 }], P({ A: 80, B: 20 })), 50);
  assert.strictEqual(T.pctVal(P({ Framing: 140 }), 'Framing'), 100); // capped
});

t('labor alerts work done: per cost code, $-weighted across areas, null when no group or not set', () => {
  T.setPHASES(null);
  S.labor = { billing: { lines: TWO }, progress: P({ 'Bldg A Framing': 50, 'Bldg B Framing': 100, 'Bldg A Hanging': 30, 'Bldg B Hanging': 0 }) };
  assert.strictEqual(T.laborDone('112'), 63); // (60k*50 + 20k*100) / 80k = 62.5
  assert.strictEqual(T.laborDone('122'), 20); // (20k*30 + 10k*0) / 30k
  assert.strictEqual(T.laborDone('132'), null); assert.strictEqual(T.laborDone('161'), null); assert.strictEqual(T.laborDone('142'), null);
  S.labor = { billing: { lines: TWO } }; assert.strictEqual(T.laborDone('112'), null); // never set
  // foremen do not get the pay app lines: they use the per-code numbers saved with the % complete
  const rows = T.pctRows(TWO, []);
  const saved = T.pctNext(null, rows, [50, 100, 30, 0], '2026-11-25T15:00:00Z', 'ken');
  deq(saved.codes, { '112': 63, '122': 20 });
  S.labor = { progress: saved }; assert.strictEqual(T.laborDone('112'), 63); assert.strictEqual(T.laborDone('161'), null);
  // no pay app lines on the job at all: scope rows (Tape and Finish both feed 132)
  T.setPHASES([{ k: 'framing' }, { k: 'board' }, { k: 'tape' }, { k: 'finish' }]);
  S.labor = { progress: P({ Framing: 90, Board: 60, Tape: 40, Finish: 20 }) };
  assert.strictEqual(T.laborDone('112'), 90); assert.strictEqual(T.laborDone('122'), 60); assert.strictEqual(T.laborDone('132'), 30);
  T.setPHASES(null);
});

t('billing: each line uses its group %, Labor and Material share it, Mob / Submittals 100 once work is done', () => {
  const rows = T.pctRows(ONE, []);
  const pp = P({ Framing: 60, Hanging: 25 });
  deq(ONE.map(l => T.billCrewPct(l, pp, rows)), [100, 100, 60, 60, 25, 25, 0, 0, 0, 0]);
  const zero = P({});
  assert.strictEqual(T.billCrewPct(ONE[0], zero, rows), 0); assert.strictEqual(T.billCrewPct(ONE[2], zero, rows), 0);
  assert.strictEqual(T.billCrewPct(ONE[2], null, rows), null); assert.strictEqual(T.billCrewPct(ONE[0], null, rows), null);
  assert.strictEqual(T.billCrewPct({ n: 'Bldg B Framing Material' }, P({ 'Bldg B Framing': 35 }), T.pctRows(TWO, [])), 35);
});

t('billing card: column renamed, suggestion from the groups and never below last month', () => {
  const cur = T.billMonth(); const [y, m] = cur.split('-').map(Number); const prevP = (m === 1 ? y - 1 : y) + '-' + String(m === 1 ? 12 : m - 1).padStart(2, '0');
  S.loaded = { billing: true }; S.job = { id: 'j', pm: null }; S.role = 'admin';
  S.billing = { lines: ONE, history: [{ period: prevP, pcts: [100, 100, 70, 70, 10, 10, 0, 0, 0, 0] }] };
  S.progress = P({ Framing: 60, Hanging: 25 });
  const h = T.billingCard();
  assert.ok(h.includes('% complete (office)')); assert.ok(!h.includes('Crew progress'));
  const vals = [...h.matchAll(/data-bp="(\d+)"[^>]*value="(\d+)"/g)].map(x => +x[2]);
  deq(vals, [100, 100, 70, 70, 25, 25, 0, 0, 0, 0]); // Framing 60 < last 70 -> stays 70
  assert.ok(h.includes('(below last)'));
});

t('saving: only changed groups get a new date, history kept, codes + overall saved', () => {
  const rows = T.pctRows(ONE, []);
  const a = T.pctNext(null, rows, [20, 0, 0, 0], '2026-11-01T10:00:00Z', 'ken');
  assert.strictEqual(a.src, 'lines'); assert.strictEqual(a.set_at, '2026-11-01T10:00:00Z'); assert.strictEqual(a.by, 'ken'); assert.strictEqual(a.history.length, 1);
  deq(a.history[0].pcts, { Framing: 20, Hanging: 0, Finishing: 0, Insulation: 0 });
  const b = T.pctNext(a, rows, [20, 15.4, 0, 0], '2026-11-25T10:00:00Z', 'josh');
  assert.strictEqual(b.groups.Framing.at, '2026-11-01T10:00:00Z'); assert.strictEqual(b.groups.Framing.by, 'ken');
  assert.strictEqual(b.groups.Hanging.pct, 15); assert.strictEqual(b.groups.Hanging.at, '2026-11-25T10:00:00Z'); assert.strictEqual(b.groups.Hanging.by, 'josh');
  assert.strictEqual(b.history.length, 2); assert.strictEqual(b.overall, T.pctWeighted(rows, b));
  const c = T.pctNext({ groups: { framing: { pct: 5 } }, set_at: 'x' }, rows, [5, 0, 0, 0], 'n', 'k');
  deq(Object.keys(c.groups), ['Framing', 'Hanging', 'Finishing', 'Insulation']); // old key in other case replaced
  assert.strictEqual(T.pctNext(null, T.pctRows([], T.normScope(null)), [10, 10, 10, 10], 'n', 'k').src, 'scope');
});

t('reminder: not set yet / new markups since last set / up to date', () => {
  assert.strictEqual(T.pctStale(null, '2026-11-20T00:00:00Z'), 'none'); assert.strictEqual(T.pctStale({}, null), 'none');
  const p = { set_at: '2026-11-25T15:00:00.000Z' };
  assert.strictEqual(T.pctStale(p, '2026-11-25T16:00:00.123456+00:00'), 'stale');
  assert.strictEqual(T.pctStale(p, '2026-11-25T14:59:00+00:00'), '');
  assert.strictEqual(T.pctStale(p, null), '');
});

t('panel: PM edits, other office read-only, Mob / Submittals not listed, reminder shown', () => {
  S.loaded = { billing: true }; S.role = 'admin'; S.billing = { lines: TWO }; S.myOfficeId = 'o-ken'; S.job = { id: 'j', pm: 'o-ken' };
  S.progress = Object.assign(P({ 'Bldg A Framing': 40 }, '2026-11-20T12:00:00Z'), { by: 'u1' }); S.progMarkAt = '2026-11-22T12:00:00Z';
  let h = T.pctCard();
  assert.ok(h.includes('Bldg A Framing') && h.includes('Bldg B Hanging') && !h.includes('Mobilization'));
  assert.strictEqual((h.match(/data-pn=/g) || []).length, 4); assert.ok(h.includes('pctSave')); assert.ok(h.includes('$60,000'));
  assert.ok(h.includes('Foremen added markups since this was last set'));
  S.myOfficeId = 'o-josh'; h = T.pctCard();
  assert.ok(!h.includes('data-pn=') && !h.includes('pctSave') && h.includes('Only this job’s PM'));
  S.progMarkAt = null; assert.ok(T.pctCard().includes('No new markups since'));
  S.progress = null; assert.ok(T.pctCard().includes('Not set yet'));
  S.billing = { lines: [] }; assert.ok(T.pctCard().includes('by scope item for the whole job'));
});

console.log(n + ' tests passed');
