// Tests for reading plan scales off sheets: printed scale formats, picking the plan's scale, NTS, the auto takeoff scale (paper size), list labels and the dimension check.
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
const names = ['TK_SCALES', 'tkPresetFpp', 'tkFeet', 'tkFtIn', 'tkParseScales', 'tkScaleRead', 'tkAutoScale', 'tkAutoScaleOps', 'tkScaleTag', 'tkScaleCheck'];
const T = vm.runInNewContext(names.map(grab).join('\n') + '\n;({' + names.join(',') + '})', { Math, String, Number, Object, Array, JSON, isFinite, parseFloat, NaN, Infinity });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };
const plain = x => JSON.parse(JSON.stringify(x));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ' expected ' + b + ', got ' + a);
const best = txt => { const r = T.tkScaleRead(txt); assert.ok(r.best, 'nothing found in ' + txt); return r.best; };

t('common printed scale formats', () => {
  const cases = [
    ['1/8" = 1\'-0"', 8, '1/8" = 1\'-0"'],
    ['3/32"=1\'-0"', 32 / 3, '3/32" = 1\'-0"'],
    ['1/4" = 1\'0"', 4, '1/4" = 1\'-0"'],
    ['1/4"=1\'', 4, '1/4" = 1\'-0"'],
    ['1" = 20\'', 20, '1" = 20\'-0"'],
    ['1" = 20\'-0"', 20, '1" = 20\'-0"'],
    ['SCALE: 1/8"=1\'-0"', 8, '1/8" = 1\'-0"'],
    ['SCALE : 3/16" = 1\'-0"', 16 / 3, '3/16" = 1\'-0"'],
    ['1 1/2" = 1\'-0"', 2 / 3, '1 1/2" = 1\'-0"'],
    ['1-1/2" = 1\'-0"', 2 / 3],
    ['⅛" = 1′-0″', 8],
    ['1⁄4″ = 1′–0″'.replace('–', '-'), 4],
    ['1:100', 100 / 12, '1:100'],
    ['SCALE 1:50', 50 / 12, '1:50'],
    ['1:96', 8, '1:96'],
    ['SCALE: 1:7', 7 / 12, '1:7']
  ];
  for (const [txt, f, lbl] of cases) { const b = best(txt); near(b.ftPerIn, f, txt); if (lbl) assert.strictEqual(b.label, lbl, txt); }
});

t('not a scale: times, slopes, NTS, AS NOTED', () => {
  for (const txt of ['10:30 AM', 'SLOPE 1:2', 'ROOF 1:12', 'REV 2 1/8/24', '', null, 'DATE 1/8/2026'])
    assert.deepStrictEqual(plain(T.tkParseScales(txt)), [], String(txt));
  for (const txt of ['NTS', 'N.T.S.', 'NOT TO SCALE', 'SCALE: AS NOTED', 'AS SHOWN']) {
    const r = T.tkScaleRead(txt); assert.strictEqual(r.best, null, txt); assert.strictEqual(r.nts, true, txt);
  }
  assert.strictEqual(T.tkScaleRead('').nts, false);
});

t('several scales on a sheet: the floor plan wins, flagged multiple', () => {
  const r = T.tkScaleRead('5 DETAIL 1 1/2" = 1\'-0"  6 DETAIL 1 1/2" = 1\'-0"  7 DETAIL 1 1/2" = 1\'-0"  1 FLOOR PLAN - LEVEL 1  SCALE: 1/8" = 1\'-0"');
  assert.strictEqual(r.best.label, '1/8" = 1\'-0"', 'floor plan over three details');
  assert.strictEqual(r.multi, true);
  const e = T.tkScaleRead('1 ENLARGED FLOOR PLAN 1/4" = 1\'-0"  2 PARTITION PLAN 3/32" = 1\'-0"');
  assert.strictEqual(e.best.label, '3/32" = 1\'-0"', 'enlarged plan is not the main plan');
  const c = T.tkScaleRead('A 1/4" = 1\'-0"  B 1/8" = 1\'-0"  C 1/8" = 1\'-0"');
  assert.strictEqual(c.best.label, '1/8" = 1\'-0"', 'no titles: most common');
  assert.strictEqual(T.tkScaleRead('1/8" = 1\'-0"').multi, false);
  const st = T.tkScaleRead('3/32" = 1\'-0"; 1/4" = 1\'-0"');
  assert.deepStrictEqual(plain(st.list.map(x => x.label)), ['3/32" = 1\'-0"', '1/4" = 1\'-0"'], 'stored scale_text keeps its order');
  for (const s of T.TK_SCALES) near(best(s[0]).ftPerIn, s[1], 'preset ' + s[0]);
});

t('auto takeoff scale from scale_text and the real paper size', () => {
  const sh = { id: 's1', w: 3600, h: 2400, pw: 36, ph: 24, scale_text: '1/8" = 1\'-0"' };
  const v = T.tkAutoScale(sh);
  near(v.fpp, 8 * 36 / 3600); assert.strictEqual(v.src, 'auto'); assert.strictEqual(v.how, 'preset'); assert.strictEqual(v.label, '1/8" = 1\'-0"');
  assert.deepStrictEqual(plain(v.paper), [36, 24]); assert.strictEqual(v.multi, false);
  near(T.tkAutoScale({ ...sh, w: 2400, h: 3600 }).fpp, 8 * 24 / 2400, 'portrait image of a landscape page: fits the short side');
  near(T.tkAutoScale({ ...sh, pw: 24, ph: 36 }).fpp, 8 * 36 / 3600, 'paper given portrait');
  near(T.tkAutoScale({ ...sh, pw: 42, ph: 30, scale_text: '3/32" = 1\'-0"' }).fpp, (32 / 3) * 42 / 3600);
  assert.strictEqual(T.tkAutoScale({ ...sh, pw: null }), null, 'no paper size: not guessed');
  assert.strictEqual(T.tkAutoScale({ ...sh, scale_text: 'NTS' }), null);
  assert.strictEqual(T.tkAutoScale({ ...sh, scale_text: null }), null);
  assert.strictEqual(T.tkAutoScale({ ...sh, scale_text: '1/4" = 1\'-0"; 1/8" = 1\'-0"' }).multi, true);
  // 1/8" = 1'-0" on a 36" sheet at 3600 px: a 30' wall is 30/0.08 = 375 px
  near(375 * v.fpp, 30);
});

t('auto scale ops: only sheets with no scale yet', () => {
  const sheets = [
    { id: 'a', w: 3600, h: 2400, pw: 36, ph: 24, scale_text: '1/8" = 1\'-0"' },
    { id: 'b', w: 3600, h: 2400, pw: 36, ph: 24, scale_text: '1/4" = 1\'-0"' },
    { id: 'c', w: 3600, h: 2400, scale_text: '1/4" = 1\'-0"' },
    { id: 'd', w: 3600, h: 2400, pw: 36, ph: 24, scale_text: '' }
  ];
  const ops = T.tkAutoScaleOps(sheets, { b: { fpp: 0.1, how: 'cal', label: 'measured 20\'-0"' } });
  assert.deepStrictEqual(plain(ops.map(o => [o.t, o.sheet, o.v.label, o.v.src])), [['scale', 'a', '1/8" = 1\'-0"', 'auto']]);
  assert.deepStrictEqual(plain(T.tkAutoScaleOps([], {})), []);
  assert.deepStrictEqual(plain(T.tkAutoScaleOps(null, null)), []);
});

t('list labels', () => {
  assert.strictEqual(T.tkScaleTag({ label: '1/8" = 1\'-0"', src: 'auto' }), '1/8" = 1\'-0" (read from sheet)');
  assert.strictEqual(T.tkScaleTag({ label: '1/8" = 1\'-0"', src: 'auto', ok: true }), '1/8" = 1\'-0" (read from sheet, checked)');
  assert.strictEqual(T.tkScaleTag({ label: 'measured 24\'-0"', how: 'cal' }), 'measured 24\'-0"');
  assert.strictEqual(T.tkScaleTag(null, '1/4" = 1\'-0"'), 'no scale (sheet says 1/4" = 1\'-0", paper size unknown)');
  assert.strictEqual(T.tkScaleTag(null, 'AS NOTED'), 'no scale (sheet says NTS / AS NOTED)');
  assert.strictEqual(T.tkScaleTag(null, null), 'no scale');
});

t('check with a dimension: warns past 2%', () => {
  const fpp = 0.08; // 1/8" on 36" at 3600 px
  const ok = T.tkScaleCheck(300, fpp, T.tkFeet('24\'-0"'));
  near(ok.meas, 24); near(ok.err, 0); assert.strictEqual(ok.ok, true); near(ok.fpp, 0.08);
  assert.strictEqual(T.tkScaleCheck(300, fpp, 24 * 1.019).ok, true, '1.9% is fine');
  const bad = T.tkScaleCheck(300, fpp, 32); // real scale 3/32: printed 32' measures 24' at 1/8
  assert.strictEqual(bad.ok, false); near(bad.err, -0.25); near(bad.fpp, 32 / 300, 'fix = the measured scale');
  assert.strictEqual(T.tkScaleCheck(300, fpp, 24 * 1.03).ok, false, '3% warns');
  assert.strictEqual(T.tkScaleCheck(0, fpp, 24), null); assert.strictEqual(T.tkScaleCheck(300, 0, 24), null); assert.strictEqual(T.tkScaleCheck(300, fpp, NaN), null);
});

console.log(n + ' scale tests passed');
