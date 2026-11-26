// Tests for the Billing tab's Load pay app (.xlsx): the Continuation Sheet (G703) lines and the Payment sheet (G702) application #, period and
// contract sum, read from cached cell values; the preview's total check; and the billing save (lines, source, history entry for that month,
// other months kept and matched by line name). Reads the synthetic fixture fixtures/payapp-sample-01.xlsx (laid out like Ken's pay app 01)
// with a small zip/XML reader here (the app reads it with ExcelJS in the browser; payXlsSheets is tested with an ExcelJS-shaped stub).
const fs = require('fs');
const zlib = require('zlib');
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
const names = ['num', 'r2', 'billMonth', 'billKey', 'billPcts', 'payTxt', 'payNum', 'PAY_TOT', 'PAY_MON', 'payDate', 'payHeadRow', 'payAppLines', 'payAppG702', 'payAppParse', 'payAppBilling', 'payCell', 'payXlsSheets'];
const code = names.map(grab).join('\n') + '\n;({' + names.join(',') + '})';
const T = vm.runInNewContext(code, { Math, Date, String, Number, Set, Object, Array, isFinite, parseFloat, Error });
const deq = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };

// --- minimal .xlsx reader: zip central directory + inflate, workbook sheet names, shared / inline strings, cached <v> values ---
function unzip(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  const cnt = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = {};
  for (let i = 0; i < cnt; i++) {
    const meth = buf.readUInt16LE(p + 10), csz = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + xl + cl;
    const ln = buf.readUInt16LE(off + 26), lx = buf.readUInt16LE(off + 28); const d = buf.subarray(off + 30 + ln + lx, off + 30 + ln + lx + csz);
    out[name] = (meth === 8 ? zlib.inflateRawSync(d) : d).toString('utf8');
  }
  return out;
}
const unx = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const txt = x => unx((x.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''));
function readXlsx(file) {
  const z = unzip(fs.readFileSync(file));
  const ss = z['xl/sharedStrings.xml'] ? (z['xl/sharedStrings.xml'].match(/<si>[\s\S]*?<\/si>/g) || []).map(txt) : [];
  const rels = {}; (z['xl/_rels/workbook.xml.rels'].match(/<Relationship [^>]*>/g) || []).forEach(r => { rels[r.match(/Id="([^"]+)"/)[1]] = r.match(/Target="([^"]+)"/)[1].replace(/^\/?(xl\/)?/, 'xl/'); });
  return (z['xl/workbook.xml'].match(/<sheet [^>]*>/g) || []).map(s => {
    const name = unx(s.match(/name="([^"]+)"/)[1]); const x = z[rels[s.match(/r:id="([^"]+)"/)[1]]]; const rows = [];
    (x.match(/<c [^>]*?(\/>|>[\s\S]*?<\/c>)/g) || []).forEach(c => {
      const ref = c.match(/r="([A-Z]+)(\d+)"/); const col = ref[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1, row = +ref[2] - 1;
      const ty = (c.match(/ t="([^"]+)"/) || [])[1]; const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = null;
      if (ty === 's') val = ss[+v]; else if (ty === 'inlineStr') val = txt(c); else if (ty === 'str') val = v == null ? null : unx(v); else if (ty === 'b') val = v === '1'; else if (v != null) val = Number(v);
      (rows[row] = rows[row] || [])[col] = val;
    });
    return { name, rows };
  });
}
const FIX = __dirname + '/fixtures/payapp-sample-01.xlsx';
const sheets = readXlsx(FIX);

t('fixture: Payment + Continuation Sheet, formulas carry cached values', () => {
  deq(sheets.map(s => s.name), ['Payment', 'Continuation Sheet']);
  assert.strictEqual(sheets[1].rows[19][2], 100637); // C20 =SUM(C10:C19), cached
  assert.strictEqual(sheets[0].rows[3][13], 46356); // N4 2026-11-30 as an Excel serial
});

t('continuation sheet: header row 9, 10 lines up to ORIGINAL CONTRACT TOTALS, $0 change orders and total rows left out', () => {
  const P = T.payAppLines(sheets);
  assert.strictEqual(P.sheet, 'Continuation Sheet'); assert.strictEqual(P.headRow, 9);
  deq(P.lines.map(l => [l.n, l.v]), [['Mobilization', 2013], ['Framing Labor', 14781], ['Framing Material', 17252], ['Hanging Labor', 20958], ['Hanging Material', 15667],
    ['Finishing Labor', 11859], ['Finishing Material', 2724], ['Insulation Labor', 1970], ['Insulation Material', 7397], ['Misc / Cleanup Labor', 6016]]);
  deq(P.lines.map(l => l.pct), [100, 6.77, 50, 0, 0, 0, 0, 0, 0, 33.24]); // G / C * 100, 2 decimals
  deq(P.lines.map(l => l.row), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.strictEqual(P.origTot, 100637); assert.strictEqual(P.revTot, 100637); assert.strictEqual(P.coTot, 0);
});

t('payment sheet (G702): application #, FOR WORK THROUGH, contract sum to date; source and total check', () => {
  deq(T.payAppG702(sheets), { sheet: 'Payment', no: '1', thru: '2026-11-30', sum: 100637 });
  const P = T.payAppParse(sheets);
  assert.strictEqual(P.total, 100637); assert.strictEqual(P.sum, 100637); assert.strictEqual(P.match, true);
  assert.strictEqual(P.period, '2026-11'); assert.strictEqual(P.source, 'Pay App 1 November 2026');
});

t('change orders with a scheduled value are included; a line total off from the contract sum is flagged', () => {
  const s2 = JSON.parse(JSON.stringify(sheets));
  const cs = s2[1].rows; cs[21][2] = 2500; cs[21][6] = 500; cs[21][0] = 'CO # 2'; cs[21][1] = 'Added soffit';
  const P = T.payAppParse(s2);
  assert.strictEqual(P.lines.length, 11); deq(P.lines[10], { n: 'CO # 2 Added soffit', v: 2500, to: 500, pct: 20, row: 22, co: true });
  assert.strictEqual(P.total, 103137); assert.strictEqual(P.match, false);
  cs[20][1] = 'CO # 1'; cs[20][2] = 100; cs[20][6] = null; cs[20][4] = 30; cs[20][3] = 20; // no G: D + E + F
  const P2 = T.payAppLines(s2); deq(P2.lines[10], { n: 'CO # 1', v: 100, to: 50, pct: 50, row: 21, co: true });
});

t('finding the sheet and the Payment values without the usual names / cells', () => {
  const s3 = JSON.parse(JSON.stringify(sheets)); s3[1].name = 'G703'; s3.reverse();
  assert.strictEqual(T.payAppLines(s3).lines.length, 10);
  assert.throws(() => T.payAppLines([{ name: 'Sheet1', rows: [['hello']] }]), /No Continuation Sheet/);
  // label text with the value further right, text dates and $ text
  const g = T.payAppG702([{ name: 'G702 Application', rows: [[], ['APPLICATION NO.', null, '#', '03'], ['PERIOD TO:', '', '12/31/2026'], ['3. CONTRACT SUM TO DATE', null, '$101,000.00']] }]);
  deq(g, { sheet: 'G702 Application', no: '3', thru: '2026-12-31', sum: 101000 });
  assert.strictEqual(T.payAppG702([{ name: 'Continuation Sheet', rows: [] }]), null);
  assert.strictEqual(T.payDate(new Date(Date.UTC(2026, 10, 30))), '2026-11-30'); assert.strictEqual(T.payDate('2026-11-30T00:00:00'), '2026-11-30');
  assert.strictEqual(T.payNum('(1,250.50)'), -1250.5); assert.strictEqual(T.payNum('-'), null); assert.strictEqual(T.payNum(''), null);
});

t('billing save: lines, source, loaded_at; that month’s history entry set or replaced; other months kept and matched by name', () => {
  const P = T.payAppParse(sheets);
  const old = { lines: [{ n: 'Framing Labor', v: 1 }, { n: 'Mobilization', v: 1 }], source: 'BILLING', extra: 1,
    history: [{ period: '2026-10', pcts: [5, 100], at: 'x', by: 'u0' }, { period: '2026-11', pcts: [9, 9], by: 'u0' }] };
  const B = T.payAppBilling(old, P, 'me', '2026-11-26T10:00:00.000Z');
  deq(Object.keys(B).sort(), ['history', 'lines', 'loaded_at', 'source']);
  deq(B.lines.slice(0, 2), [{ n: 'Mobilization', v: 2013 }, { n: 'Framing Labor', v: 14781 }]);
  assert.strictEqual(B.source, 'Pay App 1 November 2026'); assert.strictEqual(B.loaded_at, '2026-11-26T10:00:00.000Z');
  deq(B.history.map(h => h.period), ['2026-10', '2026-11']);
  deq(B.history[0].pcts, [100, 5, 0, 0, 0, 0, 0, 0, 0, 0]); assert.strictEqual(B.history[0].by, 'u0'); // re-matched by name to the new lines
  deq(B.history[1], { period: '2026-11', pcts: [100, 6.77, 50, 0, 0, 0, 0, 0, 0, 33.24], names: JSON.parse(JSON.stringify(B.lines)).map(l => l.n), at: '2026-11-26T10:00:00.000Z', by: 'me', from: 'Pay App 1 November 2026' });
  // loading the same pay app again replaces its month only
  const B2 = T.payAppBilling(B, P, 'me2', 'later');
  assert.strictEqual(B2.history.length, 2); assert.strictEqual(B2.history[1].by, 'me2'); deq(B2.history[0].pcts, [100, 5, 0, 0, 0, 0, 0, 0, 0, 0]);
  // no earlier billing at all
  deq(T.payAppBilling(null, P, 'me', 'now').history.map(h => h.period), ['2026-11']);
});

t('ExcelJS cells -> cached values (formula results, shared formulas, rich text, errors), and the workbook adapter', () => {
  assert.strictEqual(T.payCell({ formula: 'SUM(C10:C19)', result: 100637 }), 100637);
  assert.strictEqual(T.payCell({ sharedFormula: 'C10', result: 5 }), 5);
  assert.strictEqual(T.payCell({ formula: 'X' }), null);
  assert.strictEqual(T.payCell({ richText: [{ text: 'DESCRIPTION ' }, { text: 'OF WORK' }] }), 'DESCRIPTION OF WORK');
  assert.strictEqual(T.payCell({ error: '#REF!' }), null); assert.strictEqual(T.payCell('x'), 'x');
  const ws = (name, rows) => ({ name, eachRow: (o, f) => rows.forEach((r, i) => r && f({ eachCell: (o2, g) => r.forEach((v, j) => v != null && g({ value: v }, j + 1)) }, i + 1)) });
  const S = T.payXlsSheets({ worksheets: [ws('Continuation Sheet', [null, ['LINE ITEM', 'DESCRIPTION OF WORK', 'SCHEDULED VALUE', 'TOTAL COMPLETED AND STORED TO DATE'], [1, 'Framing', 1000, { formula: 'A1', result: 250 }], [null, 'ORIGINAL CONTRACT TOTALS', { formula: 'S', result: 1000 }]])] });
  deq(T.payAppLines(S).lines, [{ n: 'Framing', v: 1000, to: 250, pct: 25, row: 3, co: false }]);
});

t('Billing tab, button and automation hook are in the app', () => {
  for (const s of ['data-tab="money"', 'data-money="billing"', 'data-money="labor"', 'id="payAppFile"', 'Load pay app (.xlsx)', 'window.billLoadPayApp=billLoadPayApp', 'billTabOk()'])
    assert.ok(html.includes(s), 'missing: ' + s);
  assert.ok(!/Billing suggestion/.test(html), 'still says Billing suggestion');
});

console.log(n + ' tests passed');
