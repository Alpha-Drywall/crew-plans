// Tests for Materials vs. the order: Excel paste parsing, matching daily report deliveries to PO lines, received-vs-ordered status and flags.
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
const names = ['num', 'MAT_UNITS', 'MAT_SYN', 'MAT_STOP', 'matUnit', 'matQ', 'matPO', 'MAT_MON', 'matDay', 'matDays', 'matTok', 'matCat', 'matScore',
  'matParseText', 'matParsePaste', 'matCalc', 'matRowText', 'matClean'];
const T = vm.runInNewContext(names.map(grab).join('\n') + '\n;({' + names.join(',') + '})', { Math, Date, String, Number, Set, Object, Array, JSON });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };
const plain = x => JSON.parse(JSON.stringify(x));

t('Excel paste with a header row (Qty / Unit / Description / Length), skips section and total rows', () => {
  const txt = 'QTY\tUNIT\tDESCRIPTION\tLENGTH\tPRICE\n\t\tMETAL\t\t\n400\tPCS\t3-5/8" 20ga stud\t10\'\t$4.10\n120\tPCS\t3-5/8" 20ga track\t10\'\t$3.20\n\t\tBOARD\t\t\n1,200\tSHTS\t5/8" Type X\t12\'\t$14.00\n\t\tTOTAL\t\t$9,999\n';
  assert.deepStrictEqual(plain(T.matParsePaste(txt)), [
    { item: '3-5/8" 20ga stud 10\'', qty: 400, unit: 'PCS' },
    { item: '3-5/8" 20ga track 10\'', qty: 120, unit: 'PCS' },
    { item: '5/8" Type X 12\'', qty: 1200, unit: 'SHTS' }]);
});

t('Excel paste without headers: item / qty / unit in any order, Windows line ends, one-cell lines', () => {
  const txt = '5/8" Type X board 12\'\t240\tsheets\r\n60\tboxes\t1-1/4" fine thread screws\r\nAll purpose mud\t40\tbuckets\r\n\r\n30 rolls paper tape\r\nnotes only\t\t\r\n';
  assert.deepStrictEqual(plain(T.matParsePaste(txt)), [
    { item: '5/8" Type X board 12\'', qty: 240, unit: 'sheets' },
    { item: '1-1/4" fine thread screws', qty: 60, unit: 'boxes' },
    { item: 'All purpose mud', qty: 40, unit: 'buckets' },
    { item: 'paper tape', qty: 30, unit: 'rolls' }]);
  assert.deepStrictEqual(plain(T.matParsePaste('')), []);
});

t('free text from older reports: leading or trailing qty', () => {
  assert.deepStrictEqual(plain(T.matParseText('120 sheets 5/8 Type X')), { item: '5/8 Type X', qty: 120, unit: 'sheets' });
  assert.deepStrictEqual(plain(T.matParseText('40 5/8 type x')), { item: '5/8 type x', qty: 40, unit: '' });
  assert.deepStrictEqual(plain(T.matParseText('200 stud track 3-5/8')), { item: 'stud track 3-5/8', qty: 200, unit: '' });
  assert.deepStrictEqual(plain(T.matParseText('5/8 Type X - 120 sheets')), { item: '5/8 Type X', qty: 120, unit: 'sheets' });
  assert.deepStrictEqual(plain(T.matParseText('3-5/8 studs')), { item: '3-5/8 studs', qty: 0, unit: '' });
});

t('item text is normalized: inch marks, mixed numbers, gauge, Type X, plurals, lengths', () => {
  assert.deepStrictEqual(plain(T.matTok('3 5/8" 20 GA Studs 10\'')), ['3-5/8', '20ga', 'stud', '10ft']);
  assert.deepStrictEqual(plain(T.matTok('3-5/8in 20ga stud 10ft')), ['3-5/8', '20ga', 'stud', '10ft']);
  assert.deepStrictEqual(plain(T.matTok('5/8 TYPE-X Sheetrock')), ['5/8', 'typex', 'board']);
  assert.deepStrictEqual(plain(T.matTok('⅝ type x gyp bd')), ['5/8', 'typex', 'board']);
  assert.strictEqual(T.matUnit('SHTS'), T.matUnit('sheet'));
  assert.strictEqual(T.matUnit('pcs'), T.matUnit('Each'));
});

t('matching: sizes and gauges must agree, words can be loose', () => {
  const s = (a, b) => T.matScore(T.matTok(a), T.matTok(b));
  assert.ok(s('3 5/8 studs', '3-5/8" 20ga stud 10\'') >= 0.5);
  assert.strictEqual(s('3-5/8 20ga stud', '3-5/8" 25ga stud'), 0, 'gauge differs');
  assert.strictEqual(s('5/8 type x', '1/2" regular board'), 0, 'size differs');
  assert.strictEqual(s('5/8 type x', '3-5/8 20ga stud'), 0, '5/8 is not 3-5/8');
  assert.ok(s('5/8 Type X sheetrock', '5/8" Type X board 12\'') >= 0.5);
  assert.strictEqual(s('paper tape', '3-5/8 track'), 0);
});

const ORDER = { lines: [
  { id: 'st', po: '4512', sup: 'FBM', item: '3-5/8" 20ga stud 10\'', unit: 'pcs', qty: 400, exp: '2026-11-18' },
  { id: 'tr', po: '4512', sup: 'FBM', item: '3-5/8" 20ga track 10\'', unit: 'pcs', qty: 120, exp: '2026-11-18' },
  { id: 'bx', po: '4513', sup: 'LKL', item: '5/8" Type X board 12\'', unit: 'sheets', qty: 400, exp: '2026-11-20' },
  { id: 'mu', po: '4513', sup: 'LKL', item: 'All purpose mud', unit: 'buckets', qty: 40, exp: '2026-11-22' },
  { id: 'ta', po: '4513', sup: 'LKL', item: 'Paper tape', unit: 'rolls', qty: 30, exp: '2026-12-15' },
  { id: 'in', po: '4514', sup: 'FBM', item: 'R-19 batt insulation', unit: 'bags', qty: 50, exp: '2026-12-01' }] };
const LOGS = [
  { date: '2026-11-17', name: 'Mike', materials: [{ text: '3-5/8" 20ga stud 10\'', qty: 400, unit: 'pcs', po: '4512', line: 'st' }, { text: '3 5/8 track', qty: 100, unit: 'pcs' }] },
  { date: '2026-11-19', name: 'Mike', materials: [{ text: '5/8 type x', qty: 360, unit: 'sheets', short: true, note: 'backordered, rest Tue' }] },
  { date: '2026-11-20', name: 'Mike', deliveries: '20 track 3-5/8 20ga' },
  { date: '2026-11-21', name: 'Juan', materials: [{ text: 'corner bead', qty: 50, unit: 'pcs' }] },
];

t('received vs ordered: totals across reports, explicit line, fuzzy text and old free-text deliveries', () => {
  const C = T.matCalc(ORDER, LOGS, '2026-11-25');
  const L = id => C.lines.find(l => l.id === id);
  assert.strictEqual(L('st').got, 400); assert.strictEqual(L('st').st, 'complete');
  assert.strictEqual(L('tr').got, 120); assert.strictEqual(L('tr').st, 'complete');
  assert.strictEqual(L('bx').got, 360); assert.strictEqual(L('bx').st, 'partial'); assert.strictEqual(L('bx').pct, 90);
  assert.strictEqual(L('mu').st, 'none'); assert.strictEqual(L('ta').st, 'none');
  assert.strictEqual(L('tr').last, '2026-11-20');
  assert.strictEqual(C.extra.length, 1); assert.strictEqual(C.extra[0].item, 'corner bead');
});

t('flags: short with qty left, late with nothing delivered, early, over; short clears when complete or resolved', () => {
  const C = T.matCalc(ORDER, LOGS, '2026-11-25');
  const short = C.flags.filter(f => f.lvl === 'short');
  assert.strictEqual(short.length, 1);
  assert.strictEqual(short[0].t, '5/8" Type X board 12\' short 40 sheets (backordered, rest Tue)');
  assert.deepStrictEqual(plain(C.flags.filter(f => f.lvl === 'late').map(f => f.id)), ['mu'], 'mud expected Nov 22, nothing came; tape and insulation not due yet');
  assert.strictEqual(C.flags[0].lvl, 'short', 'short first');
  const early = T.matCalc(ORDER, [{ date: '2026-11-10', materials: [{ text: 'paper tape', qty: 30, unit: 'rolls' }] }], '2026-11-25');
  assert.ok(early.lines.find(l => l.id === 'ta').early);
  assert.ok(early.flags.some(f => f.lvl === 'early' && f.id === 'ta'));
  const over = T.matCalc(ORDER, LOGS.concat([{ date: '2026-11-24', materials: [{ text: 'All purpose mud', qty: 45, unit: 'buckets', line: 'mu' }] }]), '2026-11-25');
  assert.strictEqual(over.lines.find(l => l.id === 'mu').st, 'over');
  assert.ok(!over.flags.some(f => f.lvl === 'late'));
  const done = T.matCalc(ORDER, LOGS.concat([{ date: '2026-11-24', materials: [{ text: '5/8 type x', qty: 40, unit: 'shts' }] }]), '2026-11-25');
  assert.strictEqual(done.lines.find(l => l.id === 'bx').st, 'complete');
  assert.ok(!done.flags.some(f => f.lvl === 'short'), 'short clears once the rest arrives');
  const ok = T.matCalc({ lines: ORDER.lines.map(l => l.id === 'bx' ? Object.assign({}, l, { short_ok: '2026-11-21' }) : l) }, LOGS, '2026-11-25');
  assert.ok(!ok.flags.some(f => f.lvl === 'short'), 'office cleared it');
  assert.ok(!done.flags.some(f => f.lvl === 'unit'), 'shts and sheets are the same unit');
});

t('ties between lengths go to the line still needing the most; PO # narrows the match', () => {
  const M = { lines: [{ id: 'a', po: '1', item: '5/8 Type X 10\'', unit: 'sheets', qty: 100 }, { id: 'b', po: '2', item: '5/8 Type X 12\'', unit: 'sheets', qty: 300 }] };
  const C = T.matCalc(M, [{ date: '2026-11-01', materials: [{ text: '5/8 type x', qty: 250 }, { text: '5/8 type x', qty: 100 }] }], '2026-11-02');
  assert.strictEqual(C.lines[1].got, 250); assert.strictEqual(C.lines[0].got, 100);
  const P = T.matCalc(M, [{ date: '2026-11-01', materials: [{ text: '5/8 type x', qty: 20, po: 'PO-1' }] }], '2026-11-02');
  assert.strictEqual(P.lines[0].got, 20);
});

t('short rows that match no order line still flag for two weeks', () => {
  const lg = [{ date: '2026-11-20', materials: [{ text: 'corner bead', qty: 10, short: true, note: '40 more on order' }] }];
  assert.strictEqual(T.matCalc({ lines: [] }, lg, '2026-11-25').flags[0].t, 'corner bead short (40 more on order)');
  assert.strictEqual(T.matCalc({ lines: [] }, lg, '2026-12-20').flags.length, 0);
});

t('report text and clean order', () => {
  assert.strictEqual(T.matRowText({ text: '5/8 Type X', qty: 360, unit: 'sheets', po: '4513', short: true, note: 'rest Tue' }), '360 sheets 5/8 Type X (PO 4513) – SHORT/BACKORDERED: rest Tue');
  assert.strictEqual(T.matRowText({ text: '120 sheets 5/8 Type X' }), '120 sheets 5/8 Type X');
  assert.deepStrictEqual(plain(T.matClean(null)), { lines: [], updated_at: null, by: null });
  assert.strictEqual(T.matClean({ lines: [{ item: 'x' }, null, { qty: 2 }] }).lines.length, 1);
});

console.log(n + ' materials tests passed.');
