// Tests for the Takeoff math: feet parsing, LF/SF from normalized points, printed scales, totals, bid sheet rows, saving edits.
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
const names = ['TK_SECS', 'TK_PAPER', 'TK_SCALES', 'tkFeet', 'tkFtIn', 'tkLenPx', 'tkAreaPx', 'tkShapeQty', 'tkPresetFpp', 'tkGuessPaper', 'tkEvenUp', 'tkCodeHeight', 'tkCodeWidth', 'tkItemWidthIn', 'tkInches', 'tkInStr',
  'tkApply', 'tkTotals', 'tkRows', 'tkCopyShapes'];
const T = vm.runInNewContext(names.map(grab).join('\n') + '\n;({' + names.join(',') + '})', { Math, Date, String, Number, Set, Object, Array, JSON, isFinite, parseFloat, NaN });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };
const plain = x => JSON.parse(JSON.stringify(x));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ' expected ' + b + ', got ' + a);

t('tkFeet: feet-inches in the ways estimators type them', () => {
  near(T.tkFeet('12\'-6"'), 12.5);
  near(T.tkFeet('12\' 6"'), 12.5);
  near(T.tkFeet('12\'6'), 12.5);
  near(T.tkFeet('12.5'), 12.5);
  near(T.tkFeet('150"'), 12.5);
  near(T.tkFeet('10\'-0 1/2"'), 10 + 0.5 / 12);
  near(T.tkFeet('12 6'), 12.5);
  near(T.tkFeet('12’-6”'), 12.5, 'curly quotes');
  near(T.tkFeet('12′ 6″'), 12.5, 'prime marks');
  near(T.tkFeet('  9\'  '), 9);
  near(T.tkFeet(8), 8);
  assert.ok(Number.isNaN(T.tkFeet('abc')));
  assert.ok(Number.isNaN(T.tkFeet('12 ft 6 in')));
  assert.ok(Number.isNaN(T.tkFeet('')));
  assert.ok(Number.isNaN(T.tkFeet(null)));
});

t('tkFtIn: feet back to feet-inches, inches rounded', () => {
  assert.strictEqual(T.tkFtIn(12.5), '12\'-6"');
  assert.strictEqual(T.tkFtIn(11.999), '12\'-0"');
  assert.strictEqual(T.tkFtIn(0), '0\'-0"');
  assert.strictEqual(T.tkFtIn(10 + 1 / 12), '10\'-1"');
  assert.strictEqual(T.tkFtIn(NaN), '');
});

t('tkLenPx / tkAreaPx: normalized points on a non-square image', () => {
  const W = 3600, H = 2400;
  near(T.tkLenPx([0.25, 0.5, 0.75, 0.5], W, H), 1800, 'horizontal half');
  near(T.tkLenPx([0.5, 0.25, 0.5, 0.75], W, H), 1200, 'vertical half');
  near(T.tkLenPx([0, 0, 0.5, 0, 0.5, 0.5], W, H), 1800 + 1200, 'polyline adds segments');
  near(T.tkLenPx([0, 0, 0.1, 0.1], W, H), Math.hypot(360, 240), 'diagonal');
  near(T.tkLenPx([0.5, 0.5], W, H), 0, 'one point');
  near(T.tkAreaPx([0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2], W, H), 360 * 240);
  near(T.tkAreaPx([0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.2, 0.1], W, H), 360 * 240, 'other winding');
  near(T.tkAreaPx([0, 0, 1, 1], W, H), 0, 'fewer than 3 points');
});

t('scale end to end: 36x24 sheet at 1/8" = 1\'-0" drawn 3600 px wide', () => {
  const eighth = T.TK_SCALES.find(s => s[0] === '1/8" = 1\'-0"');
  assert.strictEqual(eighth[1], 8);
  const fpp = T.tkPresetFpp(eighth[1], 36, 3600);
  near(fpp, 0.08);
  const sheet = { id: 's1', w: 3600, h: 2400 };
  near(T.tkShapeQty({ k: 'line', p: [0.25, 0.5, 0.75, 0.5] }, sheet, { fpp }), 144, 'half the sheet width = 18 in = 144 ft');
  near(T.tkShapeQty({ k: 'line', p: [0.5, 0, 0.5, 0.5] }, sheet, { fpp }), 96, 'half the height = 12 in = 96 ft');
  near(T.tkShapeQty({ k: 'poly', p: [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2] }, sheet, { fpp }), 360 * 240 * 0.08 * 0.08, 'SF');
  assert.strictEqual(T.tkPresetFpp(8, 36, 0), 0); assert.strictEqual(T.tkPresetFpp(0, 36, 3600), 0);
  const q = T.TK_SCALES.find(s => s[0] === '1/4" = 1\'-0"'); assert.strictEqual(q[1], 4);
  near(T.TK_SCALES.find(s => s[0] === '3/16" = 1\'-0"')[1], 16 / 3);
});

t('tkGuessPaper: picks the paper from the image shape', () => {
  assert.deepStrictEqual(plain(T.tkGuessPaper(3600, 2400)), [36, 24]);
  assert.deepStrictEqual(plain(T.tkGuessPaper(3400, 2200)), [34, 22]);
  assert.deepStrictEqual(plain(T.tkGuessPaper(2400, 3600)), [24, 36]);
  assert.deepStrictEqual(plain(T.tkGuessPaper(4200, 3000)), [42, 30]);
});

t('tkEvenUp: heights up to the next even foot', () => {
  assert.strictEqual(T.tkEvenUp(13.5), 14);
  assert.strictEqual(T.tkEvenUp(14), 14);
  assert.strictEqual(T.tkEvenUp(15), 16);
  assert.strictEqual(T.tkEvenUp(0), 0);
  assert.strictEqual(T.tkEvenUp(-3), 0);
  assert.strictEqual(T.tkEvenUp('9'), 10);
  assert.strictEqual(T.tkEvenUp(''), 0);
});

t('tkShapeQty: counts never need a scale; lines and areas do', () => {
  const sheet = { id: 's1', w: 3600, h: 2400 };
  assert.strictEqual(T.tkShapeQty({ k: 'count', p: [0.5, 0.5] }, sheet, null), 1);
  assert.strictEqual(T.tkShapeQty({ k: 'count', p: [0.5, 0.5] }, null, null), 1);
  assert.strictEqual(T.tkShapeQty({ k: 'line', p: [0, 0, 1, 0] }, sheet, null), null);
  assert.strictEqual(T.tkShapeQty({ k: 'poly', p: [0, 0, 1, 0, 1, 1] }, sheet, { fpp: 0 }), null);
  assert.strictEqual(T.tkShapeQty({ k: 'line', p: [0, 0, 1, 0] }, { id: 's1' }, { fpp: 0.08 }), null, 'sheet size unknown');
  assert.strictEqual(T.tkShapeQty(null, sheet, { fpp: 1 }), 0);
});

t('tkApply: items, shapes, moves, deletes, scales; input is not changed', () => {
  const base = { v: 1, items: [{ id: 'a', n: 1, code: '111', desc: 'Partition', sec: 'INTERIOR', unit: 'LF', h: 10 }], shapes: [{ id: 'x1', item: 'a', sheet: 's1', k: 'line', p: [0, 0, 1, 0] }], scales: { s1: { fpp: 0.08 } }, sent: {} };
  const snap = JSON.stringify(base);
  const d = T.tkApply(base, [
    { t: 'item', v: { id: 'b', code: '211', desc: 'Ceiling', sec: 'CEILINGS', unit: 'SF' } },
    { t: 'shape', v: { id: 'x2', item: 'b', sheet: 's1', k: 'poly', p: [0, 0, 1, 0, 1, 1] } },
    { t: 'shape', v: { id: 'x3', item: 'nope', sheet: 's1', k: 'line', p: [0, 0, 1, 1] } },
    { t: 'shape', v: { id: 'x1', item: 'b' } },
    { t: 'item', v: { id: 'a', desc: 'Partition 3-5/8' } },
    { t: 'scale', sheet: 's2', v: { fpp: 0.1, label: '1/4" = 1\'-0"', how: 'preset' } },
    { t: 'scale', sheet: 's1', v: null },
  ]);
  assert.strictEqual(JSON.stringify(base), snap, 'input not mutated');
  assert.deepStrictEqual(plain(d.items.map(x => [x.id, x.n])), [['a', 1], ['b', 2]], 'items get n numbers');
  assert.strictEqual(d.items[0].desc, 'Partition 3-5/8'); assert.strictEqual(d.items[0].code, '111', 'partial item edit keeps other fields');
  assert.deepStrictEqual(plain(d.shapes.map(s => s.id)), ['x1', 'x2'], 'shape for unknown item ignored');
  assert.strictEqual(d.shapes[0].item, 'b', 'moved to another item'); assert.deepStrictEqual(plain(d.shapes[0].p), [0, 0, 1, 0], 'move keeps points'); assert.strictEqual(d.shapes[0].sheet, 's1');
  assert.deepStrictEqual(plain(d.scales), { s2: { fpp: 0.1, label: '1/4" = 1\'-0"', how: 'preset' } });
  const d2 = T.tkApply(d, [{ t: 'del_shape', id: 'x2' }]);
  assert.deepStrictEqual(plain(d2.shapes.map(s => s.id)), ['x1']); assert.strictEqual(d.shapes.length, 2, 'previous doc untouched');
  const d3 = T.tkApply(d, [{ t: 'del_item', id: 'b' }]);
  assert.deepStrictEqual(plain(d3.items.map(x => x.id)), ['a']); assert.deepStrictEqual(plain(d3.shapes), [], 'deleting an item deletes its shapes');
  const e = T.tkApply(null, []);
  assert.deepStrictEqual(plain(e), { v: 1, items: [], shapes: [], scales: {}, sent: {} });
  assert.deepStrictEqual(plain(T.tkApply({}, [{ t: 'sent', v: { at: '2026-11-26' } }]).sent), { at: '2026-11-26' });
});

const SHEETS = [{ id: 's1', w: 3600, h: 2400 }, { id: 's2', w: 3600, h: 2400 }];
const DOC = T.tkApply({}, [
  { t: 'item', v: { id: 'door', code: '511', desc: 'HM frame', sec: 'HMDFS', unit: 'EA', h: 7 } },
  { t: 'item', v: { id: 'wall', code: '111', desc: ' 3-5/8 partition ', sec: 'INTERIOR', unit: 'LF', h: 13.5 } },
  { t: 'item', v: { id: 'clg', code: '211', desc: 'Lid', sec: 'CEILINGS', unit: 'SF' } },
  { t: 'item', v: { id: 'wall2', code: '112', desc: 'Chase', sec: 'INTERIOR', unit: 'LF', h: 9 } },
  { t: 'item', v: { id: 'empty', code: '999', desc: 'Nothing drawn', sec: 'EXTERIOR', unit: 'LF', h: 10 } },
  { t: 'item', v: { id: 'odd', code: '300', desc: 'No section', unit: 'LF' } },
  { t: 'scale', sheet: 's1', v: { fpp: 0.08 } },
  { t: 'shape', v: { id: 'w1', item: 'wall', sheet: 's1', k: 'line', p: [0.25, 0.5, 0.75, 0.5] } },
  { t: 'shape', v: { id: 'w2', item: 'wall', sheet: 's1', k: 'line', p: [0.1, 0.1, 0.1, 0.1 + 1.5 / 96 * 0.5] } },
  { t: 'shape', v: { id: 'w3', item: 'wall', sheet: 's2', k: 'line', p: [0, 0, 1, 0] } },
  { t: 'shape', v: { id: 'c1', item: 'clg', sheet: 's1', k: 'poly', p: [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2] } },
  { t: 'shape', v: { id: 'd1', item: 'door', sheet: 's1', k: 'count', p: [0.3, 0.3] } },
  { t: 'shape', v: { id: 'd2', item: 'door', sheet: 's2', k: 'count', p: [0.4, 0.4] } },
  { t: 'shape', v: { id: 'd3', item: 'door', sheet: 's2', k: 'count', p: [0.5, 0.4] } },
  { t: 'shape', v: { id: 'z1', item: 'wall2', sheet: 's1', k: 'line', p: [0, 0.9, 0.5, 0.9] } },
  { t: 'shape', v: { id: 'q1', item: 'odd', sheet: 's1', k: 'line', p: [0, 0.8, 0.01, 0.8] } },
  { t: 'shape', v: { id: 'gone', item: 'wall', sheet: 'deleted-sheet', k: 'line', p: [0, 0, 1, 0] } },
]);

t('tkTotals: scaled and unscaled sheets, counts, sheets used, wall SF', () => {
  const tot = T.tkTotals(DOC, SHEETS);
  near(tot.wall.qty, 144 + 1.5, 'scaled lines only'); assert.strictEqual(tot.wall.unscaled, 1, 'the line on the sheet with no scale');
  assert.strictEqual(tot.wall.shapes, 3, 'shape on a sheet that is gone is skipped'); assert.strictEqual(tot.wall.sheets, 2);
  near(tot.wall.wallSf, (144 + 1.5) * 14, 'LF x even-up height');
  assert.strictEqual(tot.door.qty, 3); assert.strictEqual(tot.door.unscaled, 0, 'counts on an unscaled sheet still count'); assert.strictEqual(tot.door.sheets, 2); assert.strictEqual(tot.door.wallSf, 0);
  near(tot.clg.qty, 360 * 240 * 0.0064); assert.strictEqual(tot.clg.wallSf, 0);
  assert.strictEqual(tot.empty.qty, 0); assert.strictEqual(tot.empty.shapes, 0);
  near(tot.wall2.wallSf, 144 * 10);
});

t('tkRows: section order then n, qty rounded up, EA rows have no height, empty items left out', () => {
  const R = plain(T.tkRows(DOC, SHEETS));
  // 'odd' has no section: indexOf = -1 sorts first, but the row is filed under INTERIOR
  assert.deepStrictEqual(R.map(r => r.id), ['odd', 'wall', 'wall2', 'clg', 'door']);
  const W = R.find(r => r.id === 'wall');
  assert.deepStrictEqual(W, { id: 'wall', sec: 'INTERIOR', code: '111', desc: '3-5/8 partition', qty: 146, unit: 'LF', h: 14, unscaled: 1 });
  assert.deepStrictEqual(R.find(r => r.id === 'wall2'), { id: 'wall2', sec: 'INTERIOR', code: '112', desc: 'Chase', qty: 144, unit: 'LF', h: 10, unscaled: 0 }, 'exact 144 stays 144');
  assert.deepStrictEqual(R.find(r => r.id === 'clg'), { id: 'clg', sec: 'CEILINGS', code: '211', desc: 'Lid', qty: 553, unit: 'SF', h: null, unscaled: 0 });
  assert.deepStrictEqual(R.find(r => r.id === 'door'), { id: 'door', sec: 'HMDFS', code: '511', desc: 'HM frame', qty: 3, unit: 'EA', h: null, unscaled: 0 });
  const O = R.find(r => r.id === 'odd'); assert.strictEqual(O.sec, 'INTERIOR'); assert.strictEqual(O.qty, 3, '2.88 LF rounds up'); assert.strictEqual(O.h, null);
  assert.ok(!R.some(r => r.id === 'empty'));
  const S = T.tkApply(DOC, [{ t: 'item', v: { id: 'wall2', n: 0.5 } }]);
  assert.deepStrictEqual(plain(T.tkRows(S, SHEETS).map(r => r.id).slice(0, 3)), ['odd', 'wall2', 'wall'], 'n decides order inside a section');
  assert.deepStrictEqual(plain(T.tkRows(T.tkApply({}, []), SHEETS)), []);
});

t('tkCopyShapes: one sheet\'s shapes onto another with new ids, originals untouched', () => {
  const snap = JSON.stringify(DOC);
  let k = 0; const mk = () => 'new' + (++k);
  const C = T.tkCopyShapes(DOC, 's2', 's3', mk);
  assert.deepStrictEqual(plain(C), [
    { id: 'new1', item: 'wall', sheet: 's3', k: 'line', p: [0, 0, 1, 0] },
    { id: 'new2', item: 'door', sheet: 's3', k: 'count', p: [0.4, 0.4] },
    { id: 'new3', item: 'door', sheet: 's3', k: 'count', p: [0.5, 0.4] }]);
  C[0].p[0] = 0.9;
  assert.strictEqual(JSON.stringify(DOC), snap, 'originals not mutated (points copied)');
  assert.deepStrictEqual(plain(T.tkCopyShapes(DOC, 's2', 's3', mk, ['door']).map(s => s.item)), ['door', 'door'], 'item filter');
  assert.deepStrictEqual(plain(T.tkCopyShapes(DOC, 'none', 's3', mk)), []);
  const D = T.tkApply(DOC, T.tkCopyShapes(DOC, 's1', 's2', mk).map(v => ({ t: 'shape', v })));
  assert.strictEqual(D.shapes.length, DOC.shapes.length + 6, 'copied shapes save through tkApply');
});

t('tkCodeWidth / tkItemWidthIn: line width in inches from the stud size, item override wins', () => {
  const close = (a, b, m) => assert.ok(Math.abs(a - b) <= 0.01, (m || '') + ' expected ' + b + ', got ' + a);
  close(T.tkCodeWidth('362S162-25 FF14 G28 FR4'), 3.625);
  close(T.tkCodeWidth('600S162-33 PH8'), 6);
  close(T.tkCodeWidth('162S125-18 FF10'), 1.625);
  close(T.tkCodeWidth('250S125-18'), 2.5);
  close(T.tkCodeWidth('9A4 362S125-18 BR12 GYP24 FR3'), 3.625, 'stud part not first');
  close(T.tkCodeWidth('800S200-54'), 8);
  close(T.tkCodeWidth('550S162-43 SW12'), 5.5);
  close(T.tkCodeWidth('GYP CLG'), 4.5, 'no stud part');
  close(T.tkCodeWidth(''), 4.5);
  close(T.tkItemWidthIn({ code: 'GYP CLG', unit: 'LF' }), 4.5);
  close(T.tkItemWidthIn({ code: '362S162-25 FF14', unit: 'LF', w: 8 }), 8, 'override');
  close(T.tkItemWidthIn({ code: '362S162-25 FF14', unit: 'LF', w: null }), 3.625, 'blank override');
  close(T.tkItemWidthIn({ code: '362S162-25 FF14', unit: 'LF', w: 0 }), 3.625, 'zero override');
});

t('tkInches / tkInStr: inches typed and shown as fractions', () => {
  near(T.tkInches('3-5/8'), 3.625);
  near(T.tkInches('3 5/8"'), 3.625);
  near(T.tkInches('3.625'), 3.625);
  near(T.tkInches('5/8'), 0.625);
  near(T.tkInches('6"'), 6);
  assert.ok(Number.isNaN(T.tkInches('abc')));
  assert.ok(Number.isNaN(T.tkInches('')));
  assert.strictEqual(T.tkInStr(3.625), '3-5/8"');
  assert.strictEqual(T.tkInStr(6), '6"');
  assert.strictEqual(T.tkInStr(0.625), '5/8"');
  assert.strictEqual(T.tkInStr(4.5), '4-1/2"');
  assert.strictEqual(T.tkInStr(0), '');
});

t('tkCodeHeight: wall height from the code\'s height tag', () => {
  assert.strictEqual(T.tkCodeHeight('362S162-25 FF14 G28 FR4'), 14);
  assert.strictEqual(T.tkCodeHeight('600S162-33 PH8.5 G17'), 8.5);
  assert.strictEqual(T.tkCodeHeight('9A4 362S125-18 BR12 GYP24 FR3'), 12);
  assert.strictEqual(T.tkCodeHeight('HM DOOR FRAME A'), 0);
  assert.strictEqual(T.tkCodeHeight('OFFICE14 G2'), 0, 'tag must be its own word');
  assert.strictEqual(T.tkCodeHeight(''), 0);
});
t('tkApply: new items number after the highest n, inputs untouched', () => {
  const base = { items: [{ id: 'a', n: 1 }, { id: 'c', n: 3 }] };
  const op = { t: 'item', v: { id: 'd' } };
  const D = T.tkApply(base, [op]);
  assert.strictEqual(D.items.find(x => x.id === 'd').n, 4);
  assert.strictEqual(op.v.n, undefined, 'op not changed');
  const E = T.tkApply({ items: [{ id: 'x' }] }, []);
  assert.strictEqual(E.items[0].n, 1);
});

console.log(n + ' takeoff tests passed.');
