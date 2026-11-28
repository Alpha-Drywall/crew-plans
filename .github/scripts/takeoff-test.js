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
const names = ['tkOffsetLine', 'tkSideOff', 'TK_SECS', 'TK_PAPER', 'TK_SCALES', 'tkFeet', 'tkFtIn', 'tkLenPx', 'tkAreaPx', 'tkShapeQty', 'tkPresetFpp', 'tkGuessPaper', 'tkEvenUp', 'tkCodeHeight', 'tkCodeWidth', 'tkItemWidthIn', 'tkInches', 'tkInStr', 'tkParseScales',
  'tkApply', 'tkTotals', 'tkSheetQty', 'tkHeightSplits', 'tkRows', 'tkCopyShapes', 'tkSplitLine', 'tkInsertCorner', 'tkMoveCorner', 'tkDeleteCorner', 'tkOffsetShapes',
  'tkSnapVerts', 'tkNearVertex', 'tkOrtho', 'tkSnapPick', 'tkEnds', 'tkEndMark', 'tkReadout',
  'TK_FR_DEF', 'tkFrRot', 'tkFrUn', 'tkFrIv', 'tkFrUnion', 'tkFrClip', 'tkFrSwap', 'tkFrExt', 'tkFrAuto', 'tkFrAngle', 'tkFrPc', 'tkFrame', 'tkFrSum', 'tkFrameOf', 'tkFrRows', 'tkFrItem',
  'TK_LAY_DEF', 'TK_LAY_NAME', 'tkLayPre', 'tkLayF', 'tkLayArea', 'tkLayPos', 'tkLayCut', 'tkLayWires', 'tkLayAct', 'tkLayCrc', 'tkLayRc', 'tkLayAt', 'tkLayOrg', 'tkEdNear', 'tkEdRuns', 'tkEdAt',
  'tkInPoly', 'tkMemFlangeIn', 'tkBulkLayOps', 'tkEndCol', 'tkTabOpen', 'tkTabClose', 'tkTabMove', 'tkTabStep', 'tkTabsClean', 'tkHideBulk', 'tkHideAnyOn', 'TK_PAL', 'TK_COLORS', 'tkNextColor', 'tkColorName', 'tkColorOpts'];
const T = vm.runInNewContext(names.map(grab).join('\n') + '\n;({' + names.join(',') + '})', { Math, Date, String, Number, Set, Object, Array, JSON, isFinite, parseFloat, NaN, Infinity });
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
  const sq = { k: 'poly', p: [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2] };
  near(T.tkShapeQty(sq, sheet, { fpp: 0.08 }), 360 * 240 * 0.0064, 'area');
  near(T.tkShapeQty({ ...sq, deduct: true }, sheet, { fpp: 0.08 }), -360 * 240 * 0.0064, 'deduct area is negative');
  assert.strictEqual(T.tkShapeQty({ ...sq, deduct: true }, sheet, null), null, 'deduct with no scale');
});

t('tkTotals / tkRows: a deduct (cut-out) subtracts from its SF item', () => {
  const sh = [{ id: 's1', w: 3600, h: 2400 }];
  const D = T.tkApply({}, [
    { t: 'item', v: { id: 'clg', code: 'GYP CLG', sec: 'CEILINGS', unit: 'SF' } },
    { t: 'scale', sheet: 's1', v: { fpp: 0.08 } },
    { t: 'shape', v: { id: 'a', item: 'clg', sheet: 's1', k: 'poly', p: [0.1, 0.1, 0.3, 0.1, 0.3, 0.3, 0.1, 0.3] } },
    { t: 'shape', v: { id: 'h', item: 'clg', sheet: 's1', k: 'poly', deduct: true, p: [0.15, 0.15, 0.2, 0.15, 0.2, 0.2, 0.15, 0.2] } },
  ]);
  const full = 720 * 480 * 0.0064, hole = 180 * 120 * 0.0064;
  near(T.tkTotals(D, sh).clg.qty, full - hole);
  assert.strictEqual(T.tkTotals(D, sh).clg.shapes, 2);
  assert.strictEqual(T.tkRows(D, sh)[0].qty, Math.ceil(full - hole));
  assert.strictEqual(D.shapes[1].deduct, true, 'deduct flag saved');
  const only = T.tkApply(D, [{ t: 'del_shape', id: 'a' }]);
  assert.deepStrictEqual(plain(T.tkRows(only, sh)), [], 'a deduct alone gives no row');
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

t('tkCodeWidth / tkItemWidthIn: full wall thickness (stud + 5/8" per board layer), item override wins', () => {
  const close = (a, b, m) => assert.ok(Math.abs(a - b) <= 0.01, (m || '') + ' expected ' + b + ', got ' + a);
  close(T.tkCodeWidth('362S162-25 FF14 G28 FR4'), 3.625 + 1.25, 'G28 on a 14 ft wall = 2 layers (one each side)');
  close(T.tkCodeWidth('362S162-25 FF14 G2'), 3.625 + 1.25, 'G2 = 2 layers');
  close(T.tkCodeWidth('362S162-25 FF14 G4'), 3.625 + 2.5, 'G4 = 4 layers (two each side)');
  close(T.tkCodeWidth('P 250CH-25 FH12 GYP12 LINER12'), 2.5 + 0.625 + 1, 'shaft wall: CH stud, one layer, 1" liner');
  close(T.tkCodeWidth('M GYP30'), 5.5 + 1.25, 'board only: 2x6 wood + one layer each side');
  close(T.tkCodeWidth('H GYP10', 10), 1, 'one layer, framing by others: one face, 1" line');
  close(T.tkCodeWidth('H GYP9', 9), 1, 'one layer at 9 ft');
  close(T.tkCodeWidth('C GYP20', 10), 5.5 + 1.25, 'two layers: both faces, full wall');
  close(T.tkCodeWidth('DG12'), 1, 'sheathing only');
  close(T.tkCodeWidth('SOUNDBOARD 1/2'), 1, 'sound board only');
  close(T.tkCodeWidth('600S162-33 PH8'), 6 + 1.25, 'no board code: one layer each side');
  close(T.tkCodeWidth('9A4 362S125-18 BR12 GYP24 FR3'), 3.625 + 1.25, 'stud part not first');
  close(T.tkCodeWidth('9A4 362S125-18 BR12 GYP48 FR3'), 3.625 + 2.5, 'GYP48 on 12 ft = 4 layers');
  close(T.tkCodeWidth('362S162-33 GYP32'), 3.625 + 1.25, 'GYP with no height: one layer each side');
  close(T.tkCodeWidth('362S162-33 FH12 GYP24 RC'), 3.625 + 1.25 + 0.5, 'RC one side');
  close(T.tkCodeWidth('362S162-33 FH12 GYP24 RC2'), 3.625 + 1.25 + 1, 'RC both sides');
  close(T.tkCodeWidth('2X4 GYP16 PH8'), 3.5 + 1.25, 'wood 2x4');
  close(T.tkCodeWidth('162S125-18 FF10 G10'), 1.625 + 0.625, 'furring, one face');
  close(T.tkCodeWidth(''), 6.75);
  close(T.tkCodeWidth('362S162-33 GYP24', 12), 3.625 + 1.25, 'height from the item');
  close(T.tkItemWidthIn({ code: 'M GYP30', unit: 'LF' }), 6.75);
  close(T.tkItemWidthIn({ code: '362S162-25 FF14', unit: 'LF', w: 8 }), 8, 'override');
  close(T.tkItemWidthIn({ code: '362S162-25 FF14 G28', unit: 'LF', w: null }), 4.875, 'blank override');
  close(T.tkItemWidthIn({ code: '362S162-25 FF14 G28', unit: 'LF', w: 0 }), 4.875, 'zero override');
  close(T.tkItemWidthIn({ code: '362S162-25 GYP56', unit: 'LF', h: 14 }), 3.625 + 2.5, 'item height used for GYP layers');
});

t('tkParseScales: printed plan scales from sheet text', () => {
  const one = (txt, f, label) => { const r = T.tkParseScales(txt); assert.ok(r.length >= 1, 'nothing found in ' + txt); assert.ok(Math.abs(r[0].ftPerIn - f) < 1e-3, txt + ' -> ' + r[0].ftPerIn); if (label) assert.strictEqual(r[0].label, label); };
  one('SCALE: 3/32" = 1\'-0"', 32 / 3, '3/32" = 1\'-0"');
  one('1/8"=1\'-0"', 8, '1/8" = 1\'-0"');
  one('1 1/2" = 1\'-0"', 2 / 3, '1 1/2" = 1\'-0"');
  one('1-1/2" = 1\'-0"', 2 / 3);
  one('1" = 20\'-0"', 20, '1" = 20\'-0"');
  one('1" = 20\'', 20);
  one('SCALE: 1/4” = 1’-0”', 4, '1/4" = 1\'-0"');
  one('1⁄8″ = 1′-0″', 8);
  one('1/8 = 1\'-0"', 8); // OCR dropped the inch mark
  one('A-101 FLOOR PLAN 1/8" = 1\'-0"', 8);
  const many = T.tkParseScales('1 ENLARGED PLAN SCALE: 1/4" = 1\'-0"  2 FLOOR PLAN 3/32" = 1\'-0"  3 FLOOR PLAN 3/32" = 1\'-0"  4 DETAIL 1 1/2" = 1\'-0"');
  assert.deepStrictEqual(plain(many.map(x => [x.label, x.count])), [['3/32" = 1\'-0"', 2], ['1/4" = 1\'-0"', 1], ['1 1/2" = 1\'-0"', 1]], 'most frequent first, then labeled SCALE');
  assert.deepStrictEqual(plain(T.tkParseScales('NOT TO SCALE')), []);
  assert.deepStrictEqual(plain(T.tkParseScales('DETAIL A  NTS')), []);
  assert.deepStrictEqual(plain(T.tkParseScales('')), []);
  assert.deepStrictEqual(plain(T.tkParseScales(null)), []);
  const stored = T.tkParseScales('3/32" = 1\'-0"; 1/4" = 1\'-0"');
  assert.deepStrictEqual(plain(stored.map(x => x.label)), ['3/32" = 1\'-0"', '1/4" = 1\'-0"'], 'stored scale_text keeps its order');
  for (const s of T.TK_SCALES) { const r = T.tkParseScales(s[0]); assert.ok(r.length && Math.abs(r[0].ftPerIn - s[1]) < 1e-6, 'preset ' + s[0]); }
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

t('tkSplitLine: cut a run at a point on one leg into two marks', () => {
  const p = [0, 0, 0.5, 0, 0.5, 0.5, 1, 0.5];
  assert.deepStrictEqual(plain(T.tkSplitLine(p, 1, 0.5, 0.2)), [[0, 0, 0.5, 0, 0.5, 0.2], [0.5, 0.2, 0.5, 0.5, 1, 0.5]]);
  assert.deepStrictEqual(plain(T.tkSplitLine([0, 0, 1, 0], 0, 0.25, 0)), [[0, 0, 0.25, 0], [0.25, 0, 1, 0]]);
  const W = 3600, H = 2400, A = T.tkSplitLine(p, 0, 0.2, 0);
  near(T.tkLenPx(A[0], W, H) + T.tkLenPx(A[1], W, H), T.tkLenPx(p, W, H), 'the two halves add up to the whole');
  assert.strictEqual(T.tkSplitLine(p, 3, 0, 0), null, 'no leg 3 on a 4-point run');
  assert.strictEqual(T.tkSplitLine(p, -1, 0, 0), null);
  assert.strictEqual(T.tkSplitLine([0, 0], 0, 0, 0), null);
  assert.deepStrictEqual(p, [0, 0, 0.5, 0, 0.5, 0.5, 1, 0.5], 'input untouched');
});

t('tkInsertCorner / tkMoveCorner / tkDeleteCorner: editing corners', () => {
  const p = [0, 0, 1, 0, 1, 1];
  assert.deepStrictEqual(plain(T.tkInsertCorner(p, 0, 0.5, 0)), [0, 0, 0.5, 0, 1, 0, 1, 1]);
  assert.deepStrictEqual(plain(T.tkInsertCorner(p, 2, 0.5, 0.5)), [0, 0, 1, 0, 1, 1, 0.5, 0.5], 'closing edge of an area adds at the end');
  assert.deepStrictEqual(plain(T.tkInsertCorner(p, 5, 9, 9)), p, 'bad edge: unchanged copy');
  assert.deepStrictEqual(plain(T.tkMoveCorner(p, 1, 0.8, 0.1)), [0, 0, 0.8, 0.1, 1, 1]);
  assert.deepStrictEqual(plain(T.tkMoveCorner(p, 7, 0.8, 0.1)), p, 'no corner 7');
  assert.deepStrictEqual(plain(T.tkDeleteCorner(p, 1, 2)), [0, 0, 1, 1]);
  assert.strictEqual(T.tkDeleteCorner(p, 1, 3), null, 'an area keeps 3 corners');
  assert.strictEqual(T.tkDeleteCorner([0, 0, 1, 1], 0, 2), null, 'a line keeps 2 ends');
  assert.deepStrictEqual(p, [0, 0, 1, 0, 1, 1], 'input untouched');
  const W = 1000, H = 1000;
  near(T.tkLenPx(T.tkInsertCorner([0, 0, 1, 0], 0, 0.3, 0), W, H), 1000, 'a corner on the line keeps the length');
});

t('tkOffsetShapes: pasted copies move together with new ids', () => {
  let k = 0; const mk = () => 'p' + (++k);
  const src = [{ id: 'a', item: 'w', sheet: 's1', k: 'line', p: [0.1, 0.2, 0.3, 0.2], h: 12, note: 'x' }, { id: 'b', item: 'd', sheet: 's1', k: 'count', p: [0.5, 0.5] }];
  const C = plain(T.tkOffsetShapes(src, 0.1, -0.05, mk));
  assert.deepStrictEqual(C.map(s => s.id), ['p1', 'p2']);
  assert.deepStrictEqual(C[0].p, [0.2, 0.15, 0.4, 0.15]);
  assert.deepStrictEqual(C[1].p, [0.6, 0.45]);
  assert.strictEqual(C[0].h, 12); assert.strictEqual(C[0].note, 'x'); assert.strictEqual(C[0].item, 'w');
  assert.deepStrictEqual(src[0].p, [0.1, 0.2, 0.3, 0.2], 'originals untouched');
  assert.deepStrictEqual(plain(T.tkOffsetShapes([], 1, 1, mk)), []);
});

t('tkApply: a shape update can leave out the item; a bad item is still refused', () => {
  const D = T.tkApply({ items: [{ id: 'w', unit: 'LF' }], shapes: [{ id: 'a', item: 'w', sheet: 's1', k: 'line', p: [0, 0, 1, 0] }] }, [
    { t: 'shape', v: { id: 'a', p: [0, 0, 0.5, 0], h: 12 } }, { t: 'shape', v: { id: 'a', item: 'nope' } }, { t: 'shape', v: { id: 'new', sheet: 's1', k: 'line', p: [0, 0, 1, 1] } }]);
  assert.deepStrictEqual(plain(D.shapes), [{ id: 'a', item: 'w', sheet: 's1', k: 'line', p: [0, 0, 0.5, 0], h: 12 }]);
  const E = T.tkApply(D, [{ t: 'shape', v: { id: 'a', h: null, note: 'soffit' } }]);
  assert.strictEqual(E.shapes[0].h, null); assert.strictEqual(E.shapes[0].note, 'soffit');
});

t('tkRows: a mark with its own height gets its own row (same code, "@ h" in the description)', () => {
  const sh = [{ id: 's1', w: 1000, h: 1000 }];
  const D = T.tkApply({}, [
    { t: 'item', v: { id: 'w', n: 1, code: 'H GYP10', desc: 'Partition', sec: 'INTERIOR', unit: 'LF', h: 10 } },
    { t: 'scale', sheet: 's1', v: { fpp: 0.1 } },
    { t: 'shape', v: { id: 'a', item: 'w', sheet: 's1', k: 'line', p: [0, 0, 1, 0] } },
    { t: 'shape', v: { id: 'b', item: 'w', sheet: 's1', k: 'line', p: [0, 0.1, 0.5, 0.1], h: 12 } },
    { t: 'shape', v: { id: 'c', item: 'w', sheet: 's1', k: 'line', p: [0, 0.2, 0.25, 0.2], h: 11.5 } },
    { t: 'shape', v: { id: 'e', item: 'w', sheet: 's1', k: 'line', p: [0, 0.3, 0.2, 0.3], h: 9.5 } },
    { t: 'shape', v: { id: 'f', item: 'w', sheet: 's1', k: 'line', p: [0, 0.4, 0.3, 0.4], h: 16 } },
  ]);
  const tot = T.tkTotals(D, sh);
  near(tot.w.qty, 100 + 50 + 25 + 20 + 30, 'LF stays LF: every mark counts on the item');
  near(tot.w.wallSf, 100 * 10 + 50 * 12 + 25 * 12 + 20 * 10 + 30 * 16, 'wall SF uses each mark\'s height');
  const R = plain(T.tkRows(D, sh));
  assert.deepStrictEqual(R.map(r => [r.id, r.code, r.desc, r.qty, r.h]), [
    ['w', 'H GYP10', 'Partition', 120, 10],
    ['w@12', 'H GYP10', 'Partition @12\'', 75, 12],
    ['w@16', 'H GYP10', 'Partition @16\'', 30, 16]], '9.5 evens up to the item\'s 10, 11.5 and 12 share the 12 row; codes never rewritten');
  assert.strictEqual(R[1].note, '2 marks at 12\' (item 10\')');
  assert.strictEqual(R[0].note, undefined, 'plain rows unchanged');
  const only = T.tkApply(D, [{ t: 'del_shape', id: 'a' }, { t: 'del_shape', id: 'e' }]);
  assert.deepStrictEqual(plain(T.tkRows(only, sh)).map(r => r.id), ['w@12', 'w@16'], 'no base row when every mark has its own height');
  const noH = T.tkApply(D, [{ t: 'item', v: { id: 'w', h: null, desc: '' } }]);
  const R2 = plain(T.tkRows(noH, sh));
  assert.strictEqual(R2.find(r => r.id === 'w@12').desc, '@12\'');
  const ea = T.tkApply({}, [{ t: 'item', v: { id: 'd', unit: 'EA', code: 'DOOR' } }, { t: 'shape', v: { id: 'x', item: 'd', sheet: 's1', k: 'count', p: [0.1, 0.1], h: 12 } }]);
  assert.deepStrictEqual(plain(T.tkRows(ea, sh)).map(r => r.id), ['d'], 'height on a count is ignored');
});

t('tkSnapVerts / tkNearVertex: corners of marks on this sheet, nearest within the radius', () => {
  const W = 3600, H = 2400;
  const shapes = [
    { id: 'a', item: 'w', sheet: 's1', k: 'line', p: [0.1, 0.25, 0.5, 0.25, 0.5, 0.75] },
    { id: 'b', item: 'c', sheet: 's1', k: 'poly', p: [0.6, 0.1, 0.7, 0.1, 0.7, 0.2] },
    { id: 'c', item: 'd', sheet: 's1', k: 'count', p: [0.3, 0.3] },
    { id: 'd', item: 'w', sheet: 's2', k: 'line', p: [0.1, 0.1, 0.2, 0.1] },
    { id: 'e', item: 'h', sheet: 's1', k: 'line', p: [0.9, 0.9, 0.95, 0.9] }];
  const vs = plain(T.tkSnapVerts(shapes, 's1', W, H, { h: true }, null));
  assert.deepStrictEqual(vs.map(v => v.id + v.i), ['a0', 'a1', 'a2', 'b0', 'b1', 'b2'], 'other sheets, counts and hidden items are not targets');
  near(vs[1].x, 1800); near(vs[1].y, 600);
  const skip = plain(T.tkSnapVerts(shapes, 's1', W, H, null, { id: 'a', i: 1 }));
  assert.ok(!skip.some(v => v.id === 'a' && v.i === 1), 'the corner being dragged is skipped');
  assert.ok(skip.some(v => v.id === 'e'), 'no hide list = all items');
  const v = T.tkNearVertex(vs, { x: 1806, y: 595 }, 10);
  assert.strictEqual(v.id + v.i, 'a1');
  assert.strictEqual(T.tkNearVertex(vs, { x: 1815, y: 600 }, 10), null, '15 px away with a 10 px radius');
  const two = [{ x: 0, y: 0, id: 'p' }, { x: 8, y: 0, id: 'q' }];
  assert.strictEqual(T.tkNearVertex(two, { x: 5, y: 0 }, 10).id, 'q', 'the nearest one wins');
  assert.strictEqual(T.tkNearVertex([], { x: 0, y: 0 }, 10), null);
});

t('tkOrtho: level / plumb by projection, 45° when asked', () => {
  const a = { x: 100, y: 100 };
  assert.deepStrictEqual(plain(T.tkOrtho(a, { x: 300, y: 130 })), { x: 300, y: 100 }, 'mostly across = level');
  assert.deepStrictEqual(plain(T.tkOrtho(a, { x: 120, y: -200 })), { x: 100, y: -200 }, 'mostly up = plumb');
  assert.deepStrictEqual(plain(T.tkOrtho(a, { x: 300, y: 130 }, true)), { x: 300, y: 100 }, '45 option still levels a nearly level line');
  const d = T.tkOrtho(a, { x: 200, y: 210 }, true);
  near(d.x - a.x, d.y - a.y, '45° line'); near(d.x, 100 + 105);
  const v = T.tkOrtho(a, { x: 104, y: 400 }, true);
  assert.strictEqual(v.x, 100, 'plumb with the 45 option is exactly plumb'); near(v.y, 400);
  assert.deepStrictEqual(plain(T.tkOrtho(a, { x: 100, y: 100 })), { x: 100, y: 100 });
  assert.deepStrictEqual(plain(T.tkOrtho(null, { x: 5, y: 6 })), { x: 5, y: 6 }, 'no previous point = unchanged');
});

t('tkSnapPick: a snapped point is the existing corner exactly; ortho; soft snap; Ctrl = off', () => {
  const corner = { x: 1234.5678, y: 987.6543, id: 'a', i: 2 };
  const o = { verts: [corner], tol: 10, soft: true };
  const r = T.tkSnapPick({ x: 1230, y: 990 }, null, o);
  assert.strictEqual(r.how, 'vertex');
  assert.strictEqual(r.p.x, corner.x); assert.strictEqual(r.p.y, corner.y);
  const n = 0.3429, W = 3600; assert.strictEqual(Math.round(n * W / W * 10000) / 10000, n, 'stored 0-1 value comes back identical');
  const a = { x: 0, y: 0 };
  assert.strictEqual(T.tkSnapPick({ x: 1230, y: 990 }, a, Object.assign({ ortho: true }, o)).how, 'vertex', 'a corner beats ortho');
  const ort = T.tkSnapPick({ x: 500, y: 60 }, a, { verts: [corner], tol: 10, ortho: true });
  assert.strictEqual(ort.how, 'ortho'); assert.deepStrictEqual(plain(ort.p), { x: 500, y: 0 });
  const soft = T.tkSnapPick({ x: 500, y: 30 }, a, { soft: true });
  assert.strictEqual(soft.how, 'angle'); near(soft.p.y, 0); near(soft.p.x, Math.hypot(500, 30), 'soft snap keeps the length');
  assert.strictEqual(T.tkSnapPick({ x: 500, y: 100 }, a, { soft: true }).how, '', '11° off: left alone');
  const off = T.tkSnapPick({ x: 1230, y: 990 }, a, { verts: [corner], tol: 10, soft: true, off: true });
  assert.strictEqual(off.how, ''); assert.deepStrictEqual(plain(off.p), { x: 1230, y: 990 }, 'Ctrl held: no corner, no soft snap');
  const offOrtho = T.tkSnapPick({ x: 1230, y: 990 }, a, { verts: [corner], tol: 10, off: true, ortho: true });
  assert.deepStrictEqual(plain(offOrtho.p), { x: 1230, y: 0 }, 'Ctrl + Shift: ortho still works');
  assert.strictEqual(T.tkSnapPick({ x: 5, y: 5 }, null, {}).how, '', 'nothing to snap to');
});

t('tkEnds / tkEndMark: ticks square across the ends, arrows point out', () => {
  const W = 1000, H = 1000;
  const e = plain(T.tkEnds([0.1, 0.5, 0.4, 0.5, 0.4, 0.8], W, H));
  assert.strictEqual(e.length, 2);
  assert.deepStrictEqual(e[0], { x: 100, y: 500, ux: -1, uy: 0 }, 'start points back along the first leg');
  near(e[1].x, 400); near(e[1].y, 800); near(e[1].ux, 0); near(e[1].uy, 1);
  assert.deepStrictEqual(plain(T.tkEnds([0.1, 0.1], W, H)), [], 'one point: no ends');
  const tk = T.tkEndMark(e[0], 'ticks', 10);
  assert.strictEqual(tk.k, 'tick'); near(tk.pts[0], 100); near(tk.pts[2], 100); near(Math.abs(tk.pts[1] - tk.pts[3]), 20, 'tick is square across a level line');
  const tv = T.tkEndMark(e[1], 'ticks', 10);
  near(tv.pts[1], 800); near(tv.pts[3], 800); near(Math.abs(tv.pts[0] - tv.pts[2]), 20, 'and level across a plumb one');
  const ar = T.tkEndMark(e[0], 'arrows', 10);
  assert.strictEqual(ar.k, 'poly'); near(ar.pts[0], 100); near(ar.pts[1], 500); assert.ok(ar.pts[2] > 100 && ar.pts[4] > 100, 'arrowhead sits inside the line, tip on the end');
  const dt = T.tkEndMark(e[0], 'dots', 10); assert.strictEqual(dt.k, 'dot'); near(dt.x, 100); assert.ok(dt.r > 0 && dt.r < 10);
  const z = plain(T.tkEnds([0.2, 0.2, 0.2, 0.2], W, H)); assert.deepStrictEqual(z[0], { x: 200, y: 200, ux: 1, uy: 0 }, 'zero length does not divide by zero');
});

t('tkReadout: leg and run in feet-inches, SF for areas, px while setting the scale', () => {
  const W = 3600, H = 2400, fpp = 0.08;
  assert.strictEqual(T.tkReadout('line', [{ x: 0, y: 0 }], W, H, fpp), null, 'one point: nothing yet');
  assert.deepStrictEqual(plain(T.tkReadout('line', [{ x: 600, y: 600 }, { x: 2400, y: 600 }], W, H, fpp)), { main: '144\'-0"', sub: '' });
  assert.deepStrictEqual(plain(T.tkReadout('line', [{ x: 600, y: 600 }, { x: 2400, y: 600 }, { x: 2400, y: 1500 }], W, H, fpp)), { main: '72\'-0"', sub: 'linear 216\'-0"' }, 'this leg, then the run so far');
  assert.deepStrictEqual(plain(T.tkReadout('line', [{ x: 0, y: 0 }, { x: 100, y: 0 }], W, H, 0)), { main: 'No scale yet', sub: 'set the scale to see feet' });
  const sq = [{ x: 1000, y: 1000 }, { x: 2000, y: 1000 }, { x: 2000, y: 1800 }, { x: 1000, y: 1800 }];
  assert.deepStrictEqual(plain(T.tkReadout('area', sq, W, H, fpp)), { main: '5,120 SF', sub: 'side 80\'-0"' });
  assert.strictEqual(T.tkReadout('area', sq, W, H, fpp, { deduct: true }).main, '−5,120 SF');
  assert.deepStrictEqual(plain(T.tkReadout('area', sq.slice(0, 2), W, H, fpp)), { main: '80\'-0"', sub: 'side' });
  assert.deepStrictEqual(plain(T.tkReadout('scale', [{ x: 0, y: 0 }, { x: 1200, y: 0 }], W, H, 0)), { main: '1,200 px', sub: 'click the other end, then type its length' });
  assert.strictEqual(T.tkReadout('scale', [{ x: 0, y: 0 }, { x: 1200, y: 0 }], W, H, fpp).sub, 'now 96\'-0" · click the other end');
  assert.strictEqual(T.tkReadout('line', [{ x: 0, y: 0 }, { x: 77, y: 0 }], W, H, fpp).main, '6\'-2"', 'inches rounded');
});

// ---- Framing layout ----
const frSum = (poly, holes, o) => { const s = T.tkFrSum(T.tkFrame(poly, holes, o), o && o.waste); const r = {}; for (const k in s) r[k] = { n: s[k].n, lf: Math.round(s[k].lf * 1000) / 1000, cuts: s[k].cuts }; return plain(r); };
const RECT = [0, 0, 30, 0, 30, 20, 0, 20]; // 30' x 20'
t('framing: auto direction spans the short way (20\' joists on a 30x20 room), also when the room is turned', () => {
  near(T.tkFrAuto(RECT), Math.PI / 2);
  near(T.tkFrAuto([0, 0, 20, 0, 20, 30, 0, 30]), 0);
  const c = Math.cos(0.5), s = Math.sin(0.5), rot = [];
  for (let i = 0; i < 8; i += 2) rot.push(RECT[i] * c - RECT[i + 1] * s + 5, RECT[i] * s + RECT[i + 1] * c + 7);
  near(T.tkFrAuto(rot), 0.5 + Math.PI / 2);
});
t('framing: 20x30 rectangle at 16" OC = 24 joists x 20\' = 480 LF, track on the 2 bearing ends, bridging 4\' max = 4 rows', () => {
  const r = frSum(RECT, [], { sp: 16, ang: T.tkFrAuto(RECT), brMax: 4 });
  assert.deepStrictEqual(r.joist, { n: 24, lf: 480, cuts: [[240, 24]] }, '30\' / 16" = 22.5 spaces -> 23 + the far edge');
  assert.deepStrictEqual(r.track, { n: 2, lf: 60, cuts: [[360, 2]] });
  assert.deepStrictEqual(r.br, { n: 4, lf: 120, cuts: [[360, 4]] }, '20\' span / 4\' max = 5 bays, 4 rows');
  assert.ok(!r.king && !r.hdr);
});
t('framing: 24" OC, track on all sides, double end joists, no bridging', () => {
  const a = T.tkFrAuto(RECT);
  assert.deepStrictEqual(frSum(RECT, [], { sp: 24, ang: a }).joist, { n: 16, lf: 320, cuts: [[240, 16]] }, '30/2 = 15 spaces, 16 joists');
  const r = frSum(RECT, [], { sp: 24, ang: a, trkAll: true, endJ: true });
  assert.deepStrictEqual(r.joist, { n: 18, lf: 360, cuts: [[240, 18]] });
  assert.deepStrictEqual(r.track, { n: 4, lf: 100, cuts: [[360, 2], [240, 2]] });
  assert.ok(!r.br);
});
t('framing: the room turned 30 degrees gives the same counts and LF', () => {
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6), rot = [];
  for (let i = 0; i < 8; i += 2) rot.push(RECT[i] * c - RECT[i + 1] * s + 40, RECT[i] * s + RECT[i + 1] * c + 3);
  const r = frSum(rot, [], { sp: 16, ang: T.tkFrAuto(rot), brMax: 4 });
  assert.strictEqual(r.joist.n, 24); near(r.joist.lf, 480); near(r.track.lf, 60); assert.strictEqual(r.br.n, 4); near(r.br.lf, 120);
  const segs = T.tkFrame(rot, [], { sp: 16, ang: T.tkFrAuto(rot) }).filter(g => g.r === 'joist');
  segs.forEach(g => near(Math.atan2(g.b[1] - g.a[1], g.b[0] - g.a[0]) % Math.PI, (Math.PI / 6 + Math.PI / 2) % Math.PI, 'joists run the short way'));
});
t('framing: joists turned the long way (angle 0) on the same room', () => {
  const r = frSum(RECT, [], { sp: 16, ang: 0, brMax: 4 });
  assert.deepStrictEqual(r.joist, { n: 16, lf: 480, cuts: [[360, 16]] }, '20/1.333 = 15 spaces');
  assert.strictEqual(r.br.n, 7, '30\' / 4\' = 7.5 -> 8 bays, 7 rows'); near(r.br.lf, 140);
});
t('framing: concave L-shape clips joists at the inside corner and adds an edge joist there', () => {
  const L = [0, 0, 30, 0, 30, 10, 15, 10, 15, 20, 0, 20];
  const r = frSum(L, [], { sp: 16, ang: 0 });
  assert.deepStrictEqual(r.joist, { n: 17, lf: 390, cuts: [[360, 9], [180, 8]] }, '8 full joists + the edge joist at 10\' run 30\', 8 run 15\'');
  assert.deepStrictEqual(r.track, { n: 3, lf: 40, cuts: [[240, 1], [120, 2]] }, 'track on the 3 edges the joists land on');
  const segs = T.tkFrame(L, [], { sp: 16, ang: 0 });
  segs.filter(g => g.r === 'joist').forEach(g => { const mx = (g.a[0] + g.b[0]) / 2, my = (g.a[1] + g.b[1]) / 2; assert.ok(!(mx > 15.01 && my > 10.01), 'nothing in the notch'); });
});
t('framing: an opening in the middle cuts the joists, adds headers both sides and king joists', () => {
  const hole = [12, 8, 18, 8, 18, 12, 12, 12], a = T.tkFrAuto(RECT);
  const r = frSum(RECT, [hole], { sp: 16, ang: a, king: true });
  assert.deepStrictEqual(r.joist, { n: 28, lf: 464, cuts: [[240, 20], [96, 8]] }, '4 joists cut into 8\' pieces each side of the 4\' opening');
  assert.deepStrictEqual(r.king, { n: 2, lf: 40, cuts: [[240, 2]] });
  assert.deepStrictEqual(r.hdr, { n: 2, lf: 12, cuts: [[72, 2]] });
  const nk = frSum(RECT, [hole], { sp: 16, ang: a, king: false });
  assert.ok(!nk.king); assert.deepStrictEqual(nk.hdr.cuts, [[80, 2]], 'without kings the headers run to the next joists: 12\' to 18\'-8"');
  const segs = T.tkFrame(RECT, [hole], { sp: 16, ang: a, brMax: 4 });
  segs.filter(g => g.r === 'joist' || g.r === 'br').forEach(g => { const mx = (g.a[0] + g.b[0]) / 2, my = (g.a[1] + g.b[1]) / 2; assert.ok(!(mx > 12.01 && mx < 17.99 && my > 8.01 && my < 11.99), 'nothing runs through the opening'); });
});
t('framing: pieces round up to the inch, waste % on top', () => {
  near(T.tkFrPc(10), 10); near(T.tkFrPc(10.02), 10 + 1 / 12); near(T.tkFrPc(10.005), 10, 'within 1/8" of the inch'); near(T.tkFrPc(10 + 1e-7), 10);
  const r = T.tkFrSum(T.tkFrame([0, 0, 10.02, 0, 10.02, 4, 0, 4], [], { sp: 24, ang: Math.PI / 2 }), 10);
  assert.strictEqual(r.track.n, 2); near(r.track.lf, 2 * (10 + 1 / 12) * 1.1); assert.deepStrictEqual(plain(r.track.cuts), [[121, 2]]);
});
t('framing: clipping helpers (even-odd with holes, edges count once, union)', () => {
  assert.deepStrictEqual(plain(T.tkFrIv([[0, 0, 10, 0, 10, 10, 0, 10], [4, 4, 6, 4, 6, 6, 4, 6]], 5)), [[0, 4], [6, 10]]);
  assert.deepStrictEqual(plain(T.tkFrClip([[0, 0, 10, 0, 10, 10, 0, 10]], 10)), [[0, 10]], 'top edge');
  assert.deepStrictEqual(plain(T.tkFrUnion([[0, 2], [5, 6]], [[1, 3]])), [[0, 3], [5, 6]]);
  near(T.tkFrAngle(RECT, 'edge', 1), Math.PI / 2); near(T.tkFrAngle(RECT, 'ang', 0, 45), Math.PI / 4); near(T.tkFrAngle(RECT, 'auto'), Math.PI / 2);
  assert.deepStrictEqual(plain(T.tkFrame([0, 0, 1, 1], [], { sp: 16 })), [], 'not an area');
});
t('framing: frame marks on a sheet -> totals and one bid row per member (joists, track, bridging)', () => {
  const sheet = { id: 's1', w: 3000, h: 2000 }, fpp = 0.05; // 150' x 100'
  const fr = { mem: '600S162-43', sp: 16, trk: '600T150-43', brc: '150U50-54 CRC', brMax: 4, king: true };
  const data = T.tkApply({}, [{ t: 'item', v: { id: 'f', code: 'Ceiling framing', desc: 'Ceiling joists', sec: 'CEILINGS', unit: 'LF', color: '#e53935', fr } },
    { t: 'item', v: { id: 'w', code: '362S162-25 FF14', sec: 'INTERIOR', unit: 'LF' } },
    { t: 'scale', sheet: 's1', v: { fpp } },
    { t: 'shape', v: { id: 'a', item: 'f', sheet: 's1', k: 'frame', p: [0.1, 0.1, 0.3, 0.1, 0.3, 0.3, 0.1, 0.3], dir: 'auto' } }]); // 30' x 20'
  const r = T.tkFrameOf(data.shapes[0], sheet, data.scales.s1, fr);
  assert.strictEqual(r.sum.joist.n, 24); near(r.lf, 480 + 60 + 120);
  const tot = T.tkTotals(data, [sheet]); near(tot.f.qty, 660); assert.strictEqual(tot.f.wallSf, 0);
  const rows = T.tkRows(data, [sheet]);
  assert.deepStrictEqual(plain(rows.map(x => [x.id, x.sec, x.code, x.desc, x.qty, x.unit])), [
    ['f:j', 'CEILINGS', '600S162-43', 'Ceiling joists 600S162-43 @16" OC – 24 pcs', 480, 'LF'],
    ['f:t', 'CEILINGS', '600T150-43', 'Track 600T150-43 – 2 pcs', 60, 'LF'],
    ['f:b', 'CEILINGS', '150U50-54 CRC', 'Bridging 150U50-54 CRC @4\' max – 4 pcs', 120, 'LF']]);
  const d2 = T.tkApply(data, [{ t: 'shape', v: { id: 'a', o: [[0.18, 0.18, 0.22, 0.18, 0.22, 0.22, 0.18, 0.22]], dir: 'ang', ang: 0 } }]);
  const rows2 = T.tkRows(d2, [sheet]);
  assert.ok(/incl\. 2 king/.test(rows2[0].desc) && /incl\. 2 headers/.test(rows2[1].desc), rows2.map(x => x.desc).join(' | '));
  const un = T.tkRows(T.tkApply(data, [{ t: 'scale', sheet: 's1', v: null }]), [sheet]);
  assert.deepStrictEqual(plain(un), [], 'no scale, no rows');
  assert.strictEqual(T.tkFrItem(T.tkApply(data, [{ t: 'scale', sheet: 's1', v: null }]), [sheet], data.items[0]).un, 1);
  const d3 = T.tkApply(data, [{ t: 'item', v: { id: 'f', fr: { ...fr, sp: 24 } } }]);
  assert.strictEqual(T.tkRows(d3, [sheet])[0].qty, 320, 'changing the spacing recalculates');
});
const laySum = (L, waste) => { const s = T.tkFrSum(L.segs, waste); const r = {}; for (const k in s) r[k] = { n: s[k].n, lf: Math.round(s[k].lf * 1000) / 1000, st: s[k].st || 0 }; return r; };
t('layout: grid positions (balanced ACT borders, centered CRC / furring)', () => {
  assert.deepStrictEqual(plain(T.tkLayPos(0, 30, 4, 1)), [3, 7, 11, 15, 19, 23, 27], '2\' left over -> 3\' borders');
  assert.deepStrictEqual(plain(T.tkLayPos(0, 20, 2, 1)), [2, 4, 6, 8, 10, 12, 14, 16, 18], 'fits: full border modules');
  assert.deepStrictEqual(plain(T.tkLayPos(0, 30, 4, 0)), [1, 5, 9, 13, 17, 21, 25, 29]);
  assert.strictEqual(T.tkLayPos(0, 20, 16 / 12, 0).length, 15);
  assert.strictEqual(T.tkLayWires(20, 4), 6); assert.strictEqual(T.tkLayWires(30, 4), 9); assert.strictEqual(T.tkLayWires(2, 4), 2);
  near(T.tkLayArea(RECT, [[0, 0, 2, 0, 2, 4, 0, 4]]), 592);
  assert.strictEqual(T.tkLayPos(0, 20.02, 2, 1).length, 9, 'a hair over still fits'); assert.strictEqual(T.tkLayPos(0, 19.98, 2, 1).length, 9);
  assert.strictEqual(T.tkLayPos(0, 20.02, 16 / 12, 0).length, 15); assert.strictEqual(T.tkLayWires(20.02, 4), 6);
  const big = T.tkLayAct([0, 0, 30.02, 0, 30.02, 20.02, 0, 20.02], [], { ang: Math.PI / 2 }); assert.strictEqual(T.tkFrSum(big.segs).t4.n, 72); assert.strictEqual(big.cnt.wire, 42);
});
t('layout ACT 2x4: 20\' x 30\' room -> mains, 4\' tees, wire, wall angle, tiles', () => {
  const L = T.tkLayAct(RECT, [], { tile: '2x4', ang: T.tkFrAuto(RECT), mainLen: 12, waLen: 12, wireSp: 4 }), r = laySum(L);
  assert.deepStrictEqual(r.main, { n: 7, lf: 140, st: 14 }, 'mains run the 20\' way, 4\' OC');
  assert.strictEqual(r.t4.n, 72, '9 tee lines x 8 bays'); assert.strictEqual(r.t2, undefined);
  assert.deepStrictEqual(r.wa, { n: 4, lf: 100, st: 10 }, 'wall angle = full perimeter');
  assert.strictEqual(L.cnt.wire, 42, '6 wires on each 20\' main');
  const F = T.tkLayF({ preset: 'act', tile: '2x4' });
  const rows = T.tkFrRows({ id: 'a', code: 'ACT', sec: 'CEILINGS', fr: F }, T.tkFrSum(L.segs), 0, { ...L.cnt, area: 600 });
  assert.deepStrictEqual(plain(rows.map(x => [x.id, x.qty, x.unit, x.pcs])), [['a:m', 140, 'LF', 14], ['a:t4', 72, 'EA', null], ['a:wa', 100, 'LF', 10], ['a:w', 42, 'EA', null], ['a:tile', 600, 'SF', null]]);
  assert.ok(/75 tiles/.test(rows[4].desc), rows[4].desc);
});
t('layout ACT 2x2: adds 2\' cross tees halfway between mains, twice the tiles', () => {
  const L = T.tkLayAct(RECT, [], { tile: '2x2', ang: T.tkFrAuto(RECT) }), r = laySum(L);
  assert.deepStrictEqual(r.main, { n: 7, lf: 140, st: 14 }); assert.strictEqual(r.t4.n, 72); assert.strictEqual(r.t2.n, 70, '7 lines x 10 pieces'); near(r.t2.lf, 140);
  assert.strictEqual(L.cnt.wire, 42); assert.strictEqual(r.wa.lf, 100);
  const rows = T.tkFrRows({ id: 'a', code: 'ACT', fr: { preset: 'act', tile: '2x2', waste: 10 } }, T.tkFrSum(L.segs, 10), 0, { ...L.cnt, area: 600 });
  const by = {}; rows.forEach(x => by[x.id] = x);
  assert.strictEqual(by['a:t2'].qty, 77, '+10% waste'); assert.strictEqual(by['a:tile'].qty, 660); assert.ok(/165 tiles/.test(by['a:tile'].desc), by['a:tile'].desc);
});
t('layout CRC & furring: 20\' x 30\' @4\' with FC @16" -> LF, pieces, wires, clips, perimeter', () => {
  const L = T.tkLayCrc(RECT, [], { ang: T.tkFrAuto(RECT), crcSp: 4, fcSp: 16, crcLen: 16, fcLen: 12, perLen: 10, wireSp: 4 }), r = laySum(L);
  assert.deepStrictEqual(r.crc, { n: 8, lf: 160, st: 16 }); assert.deepStrictEqual(r.fc, { n: 15, lf: 450, st: 45 }); assert.deepStrictEqual(r.per, { n: 4, lf: 100, st: 10 });
  assert.strictEqual(L.cnt.wire, 48); assert.strictEqual(L.cnt.clip, 120); assert.strictEqual(r.per2, undefined);
  const F = { preset: 'crc', clip: 'Clip', per2: 'Wall angle' }, L2 = T.tkLayCrc(RECT, [], { ...T.tkLayF(F), ang: T.tkFrAuto(RECT), per2: true });
  const rows = T.tkFrRows({ id: 'c', code: 'CRC', fr: F }, T.tkFrSum(L2.segs), 0, { ...L2.cnt, area: 600 });
  assert.deepStrictEqual(plain(rows.map(x => [x.id, x.code, x.qty, x.unit])), [['c:c', '150U50-54 CRC', 160, 'LF'], ['c:fc', '7/8" FC 25ga', 450, 'LF'], ['c:p', '200T125-20', 100, 'LF'], ['c:p2', 'Wall angle', 100, 'LF'], ['c:w', 'Hanger wire 12ga', 48, 'EA'], ['c:cl', 'Clip', 120, 'EA']]);
  const H = T.tkLayCrc(RECT, [[10, 8, 14, 8, 14, 12, 10, 12]], { ang: T.tkFrAuto(RECT) }), h = laySum(H);
  near(h.trim.lf, 16, 'furring trim = opening perimeter'); assert.ok(h.crc.lf < 160 && h.fc.lf < 450, 'members cut at the opening');
});
t('layout grid start point (org): ACT / CRC / joists line up through it; at the auto start or the center = same as auto', () => {
  assert.deepStrictEqual(plain(T.tkLayAt(0, 30, 4, 1)), [1, 5, 9, 13, 17, 21, 25, 29]); assert.deepStrictEqual(plain(T.tkLayAt(0, 20, 2, 10)), [2, 4, 6, 8, 10, 12, 14, 16, 18], 'no line on the edges');
  assert.deepStrictEqual(plain(T.tkLayAt(0, 10, 4, 0.02)), [4.02, 8.02], 'a line within 1/2" of an edge is left out');
  const a = T.tkFrAuto(RECT), base = { tile: '2x4', ang: a, mainLen: 12, waLen: 12, wireSp: 4 }, auto = laySum(T.tkLayAct(RECT, [], base));
  const L = T.tkLayAct(RECT, [], { ...base, org: [1, 1] }), r = laySum(L);
  assert.deepStrictEqual(r.main, { n: 8, lf: 160, st: 16 }, 'mains at x = 1, 5 ... 29 (1\' and 1\' borders)'); assert.strictEqual(r.t4.n, 90, '10 tee lines (y = 1, 3 ... 19) x 9 bays'); assert.strictEqual(L.cnt.wire, 48);
  assert.ok(L.segs.some(g => g.r === 'main' && Math.abs(g.a[0] - 1) < 1e-9 && Math.abs(g.b[0] - 1) < 1e-9), 'a main passes through the start point');
  assert.ok(L.segs.some(g => g.r === 't4' && Math.abs(g.a[1] - 1) < 1e-9 && Math.abs(g.b[1] - 1) < 1e-9), 'a cross tee passes through it');
  assert.deepStrictEqual(laySum(T.tkLayAct(RECT, [], { ...base, org: [15, 10] })), auto, 'start at the center = centered grid');
  const o = T.tkLayOrg('act', T.tkLayF({ preset: 'act' }), RECT, a, null); near(o[0], 27); near(o[1], 2);
  assert.deepStrictEqual(laySum(T.tkLayAct(RECT, [], { ...base, org: o })), auto, 'auto start point reproduces the auto grid');
  assert.deepStrictEqual(plain(T.tkLayOrg('act', {}, RECT, a, [3, 4])), [3, 4]);
  const t2 = laySum(T.tkLayAct(RECT, [], { ...base, tile: '2x2', org: [1, 1] })); assert.strictEqual(t2.main.n, 8); assert.strictEqual(t2.t2.n, 77, '7 half lines between 8 mains x 11 pieces');
  const cb = { ang: a, crcSp: 4, fcSp: 16, crcLen: 16, fcLen: 12, perLen: 10, wireSp: 4 }, ca = laySum(T.tkLayCrc(RECT, [], cb)), co = T.tkLayOrg('crc', T.tkLayF({ preset: 'crc' }), RECT, a, null);
  assert.deepStrictEqual(laySum(T.tkLayCrc(RECT, [], { ...cb, org: co })), ca, 'CRC: auto start point = auto');
  const C = T.tkLayCrc(RECT, [], { ...cb, org: [0.5, 0.5] }); assert.strictEqual(laySum(C).crc.n, 8); assert.ok(C.segs.some(g => g.r === 'crc' && Math.abs(g.a[0] - 0.5) < 1e-9), 'a CRC through it');
  const J = T.tkFrame(RECT, [], { sp: 16, ang: a, org: [5, 0] }).filter(g => g.r === 'joist');
  assert.ok(J.some(g => Math.abs(g.a[0] - 5) < 1e-9 && Math.abs(g.b[0] - 5) < 1e-9), 'a joist through the start point'); assert.ok(J.some(g => Math.abs(g.a[0]) < 1e-9) && J.some(g => Math.abs(g.a[0] - 30) < 1e-9), 'joists at both bearing edges');
});
t('layout RC channel: 20\' x 30\' @16" -> runs, LF, 12\' pieces; perimeter optional; openings cut; start point and edits', () => {
  const a = T.tkFrAuto(RECT), L = T.tkLayRc(RECT, [], { ang: a, rcSp: 16, rcLen: 12 }), r = laySum(L);
  assert.deepStrictEqual(r.rc, { n: 23, lf: 460, st: 46 }); assert.strictEqual(r.per, undefined, 'no perimeter unless asked');
  assert.deepStrictEqual(laySum(T.tkLayRc(RECT, [], { ang: a, rcSp: 24, per: true, perLen: 10 })).rc, { n: 15, lf: 300, st: 30 });
  assert.deepStrictEqual(laySum(T.tkLayRc(RECT, [], { ang: a, rcSp: 24, per: true, perLen: 10 })).per, { n: 4, lf: 100, st: 10 });
  assert.strictEqual(laySum(T.tkLayRc(RECT, [], { ang: a, rcSp: 12 })).rc.n, 30);
  const H = laySum(T.tkLayRc(RECT, [[10, 8, 14, 8, 14, 12, 10, 12]], { ang: a, rcSp: 16 })); assert.ok(H.rc.lf < 460 && H.rc.n > 23, 'runs cut at the opening ' + JSON.stringify(H.rc));
  const o = T.tkLayOrg('rc', T.tkLayF({ preset: 'rc' }), RECT, a, null); assert.deepStrictEqual(laySum(T.tkLayRc(RECT, [], { ang: a, rcSp: 16, org: o })), r, 'auto start point = auto');
  const E = T.tkLayRc(RECT, [], { ang: a, rcSp: 16, ed: { rm: [0] } }); assert.strictEqual(laySum(E).rc.n, 22, 'removed run');
  const F = { preset: 'rc', per: 'J-mold' }, rows = T.tkFrRows({ id: 'r', code: 'RC', fr: F }, T.tkFrSum(T.tkLayRc(RECT, [], { ...T.tkLayF(F), ang: a, per: true }).segs), 0, { area: 600 });
  assert.deepStrictEqual(plain(rows.map(x => [x.id, x.code, x.qty, x.unit, x.pcs])), [['r:rc', 'RC-1 25ga', 460, 'LF', 46], ['r:p', 'J-mold', 100, 'LF', 10]]);
  assert.ok(/@16" OC – 46 pcs @12'/.test(rows[0].desc), rows[0].desc); assert.strictEqual(T.tkLayPre({ preset: 'rc' }), 'rc');
});
t('layout RC on a sheet -> rows through tkRows', () => {
  const sheet = { id: 's1', w: 3000, h: 2000 }, d = T.tkApply({}, [{ t: 'item', v: { id: 'f', code: 'RC', sec: 'CEILINGS', unit: 'LF', fr: { preset: 'rc', sfc: '5/8 GWB' } } }, { t: 'scale', sheet: 's1', v: { fpp: 0.05 } },
    { t: 'shape', v: { id: 'a', item: 'f', sheet: 's1', k: 'frame', p: [0.1, 0.1, 0.3, 0.1, 0.3, 0.3, 0.1, 0.3], dir: 'auto' } }]);
  assert.deepStrictEqual(plain(T.tkRows(d, [sheet]).map(x => [x.id, x.qty, x.unit])), [['f:rc', 460, 'LF'], ['f:sf', 600, 'SF']]);
});
t('bulk layout: one frame per area of the item on every sheet, deducts inside become openings, re-run skips done areas', () => {
  const sq = (x, y, w) => [x, y, x + w, y, x + w, y + w, x, y + w];
  const d = { items: [], shapes: [
    { id: 'a1', item: 'g', sheet: 's1', k: 'poly', p: sq(0.1, 0.1, 0.3) }, { id: 'a2', item: 'g', sheet: 's1', k: 'poly', p: sq(0.6, 0.6, 0.2) },
    { id: 'a3', item: 'g', sheet: 's2', k: 'poly', p: sq(0.2, 0.2, 0.4) }, { id: 'd1', item: 'g', sheet: 's1', k: 'poly', deduct: true, p: sq(0.2, 0.2, 0.05) },
    { id: 'd2', item: 'g', sheet: 's1', k: 'poly', deduct: true, p: sq(0.25, 0.3, 0.02) }, { id: 'd3', item: 'g', sheet: 's2', k: 'poly', deduct: true, p: sq(0.21, 0.21, 0.03) },
    { id: 'x', item: 'h', sheet: 's1', k: 'poly', p: sq(0, 0, 0.5) }, { id: 'dx', item: 'h', sheet: 's1', k: 'poly', deduct: true, p: sq(0.65, 0.65, 0.02) }] };
  let k = 0; const ops = T.tkBulkLayOps(d, 'g', 'L', 'now', () => 'n' + (++k));
  assert.strictEqual(ops.length, 3, '3 areas -> 3 layouts');
  assert.deepStrictEqual(plain(ops.map(o => [o.t, o.v.item, o.v.sheet, o.v.k, o.v.o.length, o.v.dir])), [['shape', 'L', 's1', 'frame', 2, 'auto'], ['shape', 'L', 's1', 'frame', 0, 'auto'], ['shape', 'L', 's2', 'frame', 1, 'auto']]);
  assert.deepStrictEqual(plain(ops[0].v.p), sq(0.1, 0.1, 0.3)); assert.deepStrictEqual(plain(ops[0].v.o[0]), sq(0.2, 0.2, 0.05));
  const d2 = { items: [], shapes: d.shapes.concat([ops[0].v]) };
  assert.strictEqual(T.tkBulkLayOps(d2, 'g', 'L', 'now', () => 'z').length, 2, 'area that already has the layout is skipped');
  assert.strictEqual(T.tkBulkLayOps(d2, 'g', 'L2', 'now', () => 'z').length, 3, 'another layout item still goes on all');
  assert.strictEqual(T.tkBulkLayOps(d, 'none', 'L', 'now', () => 'z').length, 0);
});
t('tkEndMark squares / tkEndCol: white square centered on the end, crosshair color with white edge', () => {
  const m = T.tkEndMark({ x: 10, y: 20, ux: 1, uy: 0 }, 'squares', 10); assert.strictEqual(m.k, 'sq'); near(m.x, 10); near(m.y, 20); near(m.a, 4.5);
  assert.deepStrictEqual(plain(T.tkEndCol('auto')), { c: '#16191d', e: '#fff' }); assert.strictEqual(T.tkEndCol('red').c, '#e53935'); assert.strictEqual(T.tkEndCol('blue').c, '#1e88e5'); assert.strictEqual(T.tkEndCol('black').c, '#000');
});
t('layout: preset marks on a sheet -> rows; older framing items (no preset) stay joists', () => {
  const sheet = { id: 's1', w: 3000, h: 2000 };
  const mk = fr => T.tkApply({}, [{ t: 'item', v: { id: 'f', code: 'L', sec: 'CEILINGS', unit: 'LF', fr } }, { t: 'scale', sheet: 's1', v: { fpp: 0.05 } },
    { t: 'shape', v: { id: 'a', item: 'f', sheet: 's1', k: 'frame', p: [0.1, 0.1, 0.3, 0.1, 0.3, 0.3, 0.1, 0.3], dir: 'auto' } }]);
  const old = T.tkRows(mk({ mem: '600S162-43', sp: 16, trk: '600T150-43', brc: '150U50-54 CRC', brMax: 4 }), [sheet]);
  assert.deepStrictEqual(plain(old.map(x => x.qty)), [480, 60, 120]); assert.strictEqual(T.tkLayPre({ mem: 'x' }), 'joists');
  const j2 = T.tkRows(mk({ preset: 'joists', sfc: '5/8 X GWB' }), [sheet]); assert.deepStrictEqual(plain(j2.map(x => [x.id, x.qty, x.unit])), [['f:j', 480, 'LF'], ['f:t', 60, 'LF'], ['f:b', 120, 'LF'], ['f:sf', 600, 'SF']]);
  const act = T.tkRows(mk({ preset: 'act' }), [sheet]); assert.deepStrictEqual(plain(act.map(x => x.qty)), [140, 72, 100, 42, 600]);
  const crc = T.tkRows(mk({ preset: 'crc' }), [sheet]); assert.deepStrictEqual(plain(crc.map(x => x.qty)), [160, 450, 100, 48]);
  const it = T.tkFrItem(mk({ preset: 'crc' }), [sheet], { id: 'f', fr: { preset: 'crc' } }); assert.strictEqual(it.cnt.clip, 120); near(it.cnt.area, 600);
});
t('framing: copy / offset carry the openings with the area', () => {
  const s = [{ id: 'a', item: 'f', sheet: 's1', k: 'frame', p: [0.1, 0.1, 0.3, 0.1, 0.3, 0.2], o: [[0.15, 0.15, 0.16, 0.15, 0.16, 0.16]] }];
  const o = T.tkOffsetShapes(s, 0.1, 0.2, () => 'x');
  assert.deepStrictEqual(plain(o[0].o), [[0.25, 0.35, 0.26, 0.35, 0.26, 0.36]]);
  const c = T.tkCopyShapes({ shapes: s }, 's1', 's2', () => 'y');
  assert.deepStrictEqual(plain(c[0].o), plain(s[0].o)); assert.notStrictEqual(c[0].o[0], s[0].o[0]);
});

t('tkSheetQty: each item\'s quantity per sheet, in plan order, adding up to the job total', () => {
  const sh = [{ id: 's1', w: 3600, h: 2400 }, { id: 's2', w: 3600, h: 2400 }, { id: 's3', w: 3600, h: 2400 }];
  const D = T.tkApply({}, [
    { t: 'item', v: { id: 'w', code: 'WALL', unit: 'LF' } },
    { t: 'item', v: { id: 'd', code: 'DOOR', unit: 'EA' } },
    { t: 'item', v: { id: 'z', code: 'UNUSED', unit: 'LF' } },
    { t: 'scale', sheet: 's1', v: { fpp: 0.05 } },
    { t: 'scale', sheet: 's2', v: { fpp: 0.1 } },
    { t: 'shape', v: { id: 'a', item: 'w', sheet: 's2', k: 'line', p: [0, 0, 0.5, 0] } },
    { t: 'shape', v: { id: 'b', item: 'w', sheet: 's1', k: 'line', p: [0, 0, 0.5, 0] } },
    { t: 'shape', v: { id: 'c', item: 'w', sheet: 's1', k: 'line', p: [0, 0, 0, 0.5] } },
    { t: 'shape', v: { id: 'e', item: 'w', sheet: 's3', k: 'line', p: [0, 0, 0.5, 0] } },
    { t: 'shape', v: { id: 'f', item: 'd', sheet: 's3', k: 'count', p: [0.5, 0.5] } },
    { t: 'shape', v: { id: 'g', item: 'd', sheet: 's3', k: 'count', p: [0.6, 0.5] } },
    { t: 'shape', v: { id: 'x', item: 'w', sheet: 'gone', k: 'line', p: [0, 0, 1, 0] } },
  ]);
  const Q = T.tkSheetQty(D, sh);
  near(Q.sheets.s1.w.qty, 1800 * 0.05 + 1200 * 0.05); assert.strictEqual(Q.sheets.s1.w.marks, 2);
  near(Q.sheets.s2.w.qty, 1800 * 0.1);
  assert.deepStrictEqual(plain(Q.sheets.s3.w), { qty: 0, marks: 1, unscaled: 1 }, 'no scale: counted as a mark, not a quantity');
  assert.deepStrictEqual(plain(Q.sheets.s3.d), { qty: 2, marks: 2, unscaled: 0 }, 'counts need no scale');
  assert.deepStrictEqual(plain(Q.items.w.map(x => x.id)), ['s1', 's2', 's3'], 'plan order, not mark order; sheets not in the list are left out');
  assert.deepStrictEqual(plain(Q.items.z), [], 'an item with no marks has no sheets');
  assert.ok(!Q.sheets.s2.d, 'items not on a sheet are not listed under it');
  const tot = T.tkTotals(D, sh);
  ['w', 'd'].forEach(k => near(Q.items[k].reduce((a, x) => a + x.qty, 0), tot[k].qty, k + ' sheets add up to the total'));
  assert.deepStrictEqual(plain(T.tkSheetQty({}, sh)), { sheets: {}, items: {} });
});

t('tkFrame edits: add / double / remove joists, beam lines, blocking rows (20x30 @16")', () => {
  const R = [0, 0, 20, 0, 20, 30, 0, 30], o = { sp: 16, ang: 0 }, S = ed => T.tkFrSum(T.tkFrame(R, [], { ...o, ed }), 0);
  const base = S(), J = base.joist;
  near(J.lf, J.n * 20, 'joists span 20');
  assert.deepStrictEqual(plain(S({})), plain(base), 'empty edits change nothing');
  assert.deepStrictEqual(plain(T.tkFrame(R, [], o)), plain(T.tkFrame(R, [], { ...o, ed: null })), 'old shapes without ed unchanged');
  const a = S({ add: [0.5] }).joist; assert.strictEqual(a.n, J.n + 1); near(a.lf, J.lf + 20, 'add joist +20 LF');
  const d = S({ dbl: { '4': 2 } }).joist; assert.strictEqual(d.n, J.n + 1, 'double +1 piece'); near(d.lf, J.lf + 20);
  assert.strictEqual(S({ dbl: { '4.2': 3 } }).joist.n, J.n + 2, 'triple matches the nearest joist (within half a space)');
  assert.strictEqual(S({ dbl: { '40': 2 } }).joist.n, J.n, 'no joist within half a space: nothing doubled');
  const r = S({ rm: [4] }).joist; assert.strictEqual(r.n, J.n - 1, 'remove -1'); near(r.lf, J.lf - 20);
  const b = S({ beam: [0] }); assert.strictEqual(b.joist.n, J.n * 2, 'beam at mid-span: joist pieces double'); near(b.joist.lf, J.lf, 'same LF');
  assert.deepStrictEqual(plain(b.joist.cuts), [[120, J.n * 2]], 'each half 10\'');
  near(b.beam.lf, 30, 'beam LF = width'); assert.strictEqual(b.beam.n, 1);
  near(b.track.lf, base.track.lf, 'track unchanged');
  const k = S({ blk: [-5] }); near(k.br.lf, 30, 'blocking row +30 LF'); assert.strictEqual(k.joist.n, J.n, 'blocking does not cut joists');
  const g = T.tkFrame(R, [], { ...o, ed: { add: [0.5] } }); assert.deepStrictEqual([g.ref.u, g.ref.v], [10, 0], 'ref = mid-span, first edge'); assert.ok(g.jv.some(v => Math.abs(v - 0.5) < 1e-9)); near(g.sp, 16 / 12);
  const m = T.tkFrame(R.map((x, i) => x + (i % 2 ? 7 : 3)), [], { ...o, ed: { rm: [4], beam: [0] } });
  const m0 = T.tkFrame(R, [], { ...o, ed: { rm: [4], beam: [0] } });
  assert.strictEqual(m.length, m0.length, 'moved area keeps its edits');
});
t('tkFrRows: beam on the track row (or its own code), blocking on bridging; ACT / CRC added mains', () => {
  const it = { id: 'j', code: 'CJ', sec: 'CEILINGS', fr: { preset: 'joists', mem: 'J', sp: 16, trk: 'TR', brc: '', brMax: 0 } }, R = [0, 0, 20, 0, 20, 30, 0, 30];
  const rows = (fr, ed) => { const i = { ...it, fr: { ...it.fr, ...fr } }; return plain(T.tkFrRows(i, T.tkFrSum(T.tkFrame(R, [], { sp: 16, ang: 0, ed }), 0), 0, {})); };
  const t0 = rows({}).find(r => r.code === 'TR').qty;
  assert.strictEqual(rows({}, { beam: [0] }).find(r => r.code === 'TR').qty, t0 + 30, 'beam LF on track row');
  const own = rows({ beam: 'BX' }, { beam: [0] }); assert.strictEqual(own.find(r => r.code === 'BX').qty, 30); assert.strictEqual(own.find(r => r.code === 'TR').qty, t0);
  assert.strictEqual(rows({}, { blk: [0] }).find(r => r.id === 'j:b').qty, 30, 'blocking with no bridging member: track code');
  assert.ok(!rows({}).some(r => r.id === 'j:b'), 'no blocking, no bridging: no row');
  const A = T.tkLayAct([0, 0, 20, 0, 20, 12, 0, 12], [], { tile: '2x4' }), A1 = T.tkLayAct([0, 0, 20, 0, 20, 12, 0, 12], [], { tile: '2x4', ed: { add: [2] } });
  assert.strictEqual(A1.segs.filter(g => g.r === 'main').length, A.segs.filter(g => g.r === 'main').length + 1, 'add main');
  assert.strictEqual(T.tkLayAct([0, 0, 20, 0, 20, 12, 0, 12], [], { tile: '2x4', ed: { rm: [0] } }).segs.filter(g => g.r === 'main').length, A.segs.filter(g => g.r === 'main').length - 1, 'remove main');
  const C = T.tkLayCrc([0, 0, 20, 0, 20, 12, 0, 12], [], {}), C1 = T.tkLayCrc([0, 0, 20, 0, 20, 12, 0, 12], [], { ed: { add: [1] } });
  assert.strictEqual(C1.segs.filter(g => g.r === 'crc').length, C.segs.filter(g => g.r === 'crc').length + 1, 'add CRC');
  assert.ok(C1.cnt.clip > C.cnt.clip, 'added CRC gets clips');
});

t('sheet tabs: open adds once, focus keeps order', () => {
  assert.deepStrictEqual(plain(T.tkTabOpen([], 'a')), ['a']);
  assert.deepStrictEqual(plain(T.tkTabOpen(['a', 'b'], 'c')), ['a', 'b', 'c']);
  assert.deepStrictEqual(plain(T.tkTabOpen(['a', 'b', 'c'], 'b')), ['a', 'b', 'c'], 'existing tab is focused, not added');
  assert.deepStrictEqual(plain(T.tkTabOpen(null, 'a')), ['a']);
});
t('sheet tabs: close middle / active / last', () => {
  assert.deepStrictEqual(plain(T.tkTabClose(['a', 'b', 'c'], 'b', 'a')), { ids: ['a', 'c'], act: 'a' }, 'closing another tab keeps the active one');
  assert.deepStrictEqual(plain(T.tkTabClose(['a', 'b', 'c'], 'b', 'b')), { ids: ['a', 'c'], act: 'c' }, 'closing the active one goes to the right neighbor');
  assert.deepStrictEqual(plain(T.tkTabClose(['a', 'b', 'c'], 'c', 'c')), { ids: ['a', 'b'], act: 'b' }, 'last in the row goes left');
  assert.deepStrictEqual(plain(T.tkTabClose(['a'], 'a', 'a')), { ids: [], act: null }, 'closing the only tab closes the viewer');
  assert.deepStrictEqual(plain(T.tkTabClose(['a'], 'x', 'a')), { ids: ['a'], act: 'a' });
});
t('sheet tabs: reorder and cycle', () => {
  assert.deepStrictEqual(plain(T.tkTabMove(['a', 'b', 'c'], 'a', 2)), ['b', 'c', 'a']);
  assert.deepStrictEqual(plain(T.tkTabMove(['a', 'b', 'c'], 'c', 0)), ['c', 'a', 'b']);
  assert.deepStrictEqual(plain(T.tkTabMove(['a', 'b', 'c'], 'b', 9)), ['a', 'c', 'b']);
  assert.deepStrictEqual(plain(T.tkTabMove(['a', 'b'], 'x', 0)), ['a', 'b']);
  assert.strictEqual(T.tkTabStep(['a', 'b', 'c'], 'c', 1), 'a', 'wraps forward');
  assert.strictEqual(T.tkTabStep(['a', 'b', 'c'], 'a', -1), 'c', 'wraps back');
  assert.strictEqual(T.tkTabStep(['a', 'b', 'c'], 'b', 1), 'c');
  assert.strictEqual(T.tkTabStep([], 'a', 1), null);
});
t('sheet tabs: restore drops sheets no longer there, duplicates and junk', () => {
  const v = new Set(['a', 'b', 'c']);
  assert.deepStrictEqual(plain(T.tkTabsClean({ ids: ['a', 'gone', 'c', 'a', 5], act: 'c' }, v)), { ids: ['a', 'c'], act: 'c' });
  assert.deepStrictEqual(plain(T.tkTabsClean({ ids: ['a', 'gone'], act: 'gone' }, v)), { ids: ['a'], act: 'a' }, 'active sheet deleted: first tab');
  assert.deepStrictEqual(plain(T.tkTabsClean({}, v)), { ids: [], act: null });
  assert.deepStrictEqual(plain(T.tkTabsClean(null, ['b'])), { ids: [], act: null });
  assert.deepStrictEqual(plain(T.tkTabsClean({ ids: ['b'], act: 'b' }, ['b'])), { ids: ['b'], act: 'b' }, 'array of ids works too');
});

t('light bulbs in bulk: all off / all on / some', () => {
  assert.deepStrictEqual(plain(T.tkHideBulk({}, ['a', 'b'], false)), { a: true, b: true });
  assert.deepStrictEqual(plain(T.tkHideBulk({ a: true, c: true }, ['a', 'b'], true)), { c: true }, 'on only touches the given ids');
  assert.deepStrictEqual(plain(T.tkHideBulk({ a: false }, [], true)), {}, 'drops false entries');
  const h = { a: true };
  T.tkHideBulk(h, ['b'], false); assert.deepStrictEqual(h, { a: true }, 'does not change the input');
  assert.strictEqual(T.tkHideAnyOn({ a: true }, ['a', 'b']), true);
  assert.strictEqual(T.tkHideAnyOn({ a: true, b: true }, ['a', 'b']), false);
  assert.strictEqual(T.tkHideAnyOn(null, ['a']), true);
  assert.strictEqual(T.tkHideAnyOn({}, []), false);
});

t('wall side: offset line to the right of travel by half the width; corners mitered', () => {
  const close = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, (m || '') + ' expected ' + b + ', got ' + a);
  const o = T.tkOffsetLine([0, 0, 1, 0], 100, 100, 5);
  close(o[1] * 100, 5, 'going east, right is +y'); close(o[0], 0); close(o[3] * 100, 5);
  const l = T.tkOffsetLine([0.1, 0.1, 0.5, 0.1, 0.5, 0.5], 100, 100, 2);
  close(l[2] * 100, 48, 'corner x pulled in'); close(l[3] * 100, 12, 'corner y pushed down');
  close(T.tkSideOff('L', 4), 2); close(T.tkSideOff('R', 4), -2); close(T.tkSideOff(undefined, 4), 0);
  assert.deepStrictEqual(T.tkOffsetLine([0, 0, 1, 1], 10, 10, 0), [0, 0, 1, 1]);
});

t('color palette: 30 distinct takeoff colors (true red, magenta, clear pinks), new items get the first unused color', () => {
  assert.strictEqual(T.TK_PAL.length, 30);
  assert.strictEqual(new Set(T.TK_COLORS).size, 30, 'no repeats');
  T.TK_COLORS.forEach(c => assert.match(c, /^#[0-9a-f]{6}$/, 'lower-case hex ' + c));
  assert.ok(!T.TK_COLORS.includes('#d81b60'), 'the old muddy red-pink is gone');
  ['Red', 'Magenta', 'Hot pink', 'Light pink'].forEach(n => assert.ok(T.TK_PAL.some(x => x[1] === n), n + ' is in the palette'));
  assert.strictEqual(T.tkNextColor([]), T.TK_COLORS[0]);
  assert.strictEqual(T.tkNextColor([{ color: T.TK_COLORS[0] }, { color: '#123456' }]), T.TK_COLORS[1], 'skips used colors');
  assert.strictEqual(T.tkNextColor([{ color: T.TK_COLORS[0].toUpperCase() }]), T.TK_COLORS[1], 'case-insensitive');
  const all = T.TK_COLORS.map(color => ({ color }));
  assert.strictEqual(T.tkNextColor(all), T.TK_COLORS[0], 'all used: cycles');
  assert.strictEqual(T.tkColorName('#E53935'), 'Red');
  assert.strictEqual(T.tkColorName('#123456'), 'Custom #123456');
  assert.strictEqual(T.tkColorOpts('#123456').length, 31, 'a custom color stays pickable in the item form');
  assert.strictEqual(T.tkColorOpts('#1e88e5').length, 30);
});

t('joist flange width from the member name (to scale), null when unreadable', () => {
  near(T.tkMemFlangeIn('800S162-43'), 1.62); near(T.tkMemFlangeIn('600S162-43'), 1.62); near(T.tkMemFlangeIn('362S125-33'), 1.25);
  near(T.tkMemFlangeIn('200'), 2); near(T.tkMemFlangeIn('125'), 1.25); near(T.tkMemFlangeIn(' 1000S200-54 '), 2);
  assert.strictEqual(T.tkMemFlangeIn(''), null); assert.strictEqual(T.tkMemFlangeIn('joist'), null); assert.strictEqual(T.tkMemFlangeIn(null), null);
});

console.log(n + ' takeoff tests passed.');
