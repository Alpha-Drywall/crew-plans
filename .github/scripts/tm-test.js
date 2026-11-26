// Tests for T&M tickets (extra work on the daily report). Pulls the pure functions out of index.html and runs them with stubs.
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
const names = ['num', 'r2', 'TC_ANCHOR', 'isoAddD', 'tcKey', 'tcHrs', 'tcDayIdx', 'tcLineNo', 'tcJobNo', 'tcJobShort', 'tcJobKey', 'tcIsJob',
  'TM_ST', 'TM_OFFICE', 'TM_REASONS', 'tmIs', 'tmNo', 'tmSt', 'tmHrs', 'tmIs172', 'tmBody', 'tmOld', 'tmNext', 'tmAll', 'tmCrew172', 'tmLeft', 'tmSign', 'tmUnsign',
  'tmSetStatus', 'tmMerge', 'tmText', 'tmCells', 'tmWhenTxt', 'tmCsv', 'csvCell', 'toCsv'];
const code = names.map(grab).join('\n') + '\n;({' + names.filter(n => n !== 'TC_ANCHOR').concat(['TC_OFF']).join(',') + '})';
const ctx = { S: {}, Math, Date, String, Number, Set, Object, Array, JSON, isFinite, parseFloat, Error };
const T = vm.runInNewContext(code, ctx);
const J = x => JSON.parse(JSON.stringify(x));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };

const tk = (no, o) => Object.assign({ tm: 1, id: 't' + no, no, work: 'Extra wall ' + no, crew: [], mats: [], photos: [] }, o || {});

t('ticket numbering per job', () => {
  assert.strictEqual(T.tmNo(1), 'T&M-001');
  assert.strictEqual(T.tmNo(42), 'T&M-042');
  assert.strictEqual(T.tmNo(1234), 'T&M-1234');
  assert.strictEqual(T.tmNext([], []), 1);
  const logs = [
    { date: '2026-11-20', extra_work: [tk(1), { work: 'old plain row', by: 'Bob' }] },
    { date: '2026-11-23', extra_work: [tk(4), tk(2)] },
    { date: '2026-11-24', extra_work: null },
  ];
  assert.strictEqual(T.tmNext(logs), 5); // highest number on the job + 1, plain rows ignored
  assert.strictEqual(T.tmNext(logs, [tk(7)]), 8); // tickets in the open form count too
  assert.deepStrictEqual(J(T.tmAll(logs).map(x => x.t.no)), [4, 2, 1]);
});

t('time card 172 prefill by worker', () => {
  const P = '2026-11-25', D = '2026-11-30'; // Monday = day 4 of the card
  const di = T.tcDayIdx(P, D);
  assert.strictEqual(di, 4);
  const card = { owner: 'u1', foreman: 'Juan Perez', period_start: P, workers: [
    { name: 'Juan Perez', days: { [di]: [{ job: '330-U of U', code: '172', hrs: '3' }, { job: '330', code: '142', hrs: 5 }] } },
    { name: 'Luis Garcia', days: { [di]: [{ job: '330', code: '172-Extra', hrs: 4 }, { job: '330', code: '172', hrs: 2.5 }, { job: '331', code: '172', hrs: 2 }] } },
    { name: 'Pedro', days: { [di]: [{ job: '330', code: '122', hrs: 8 }] } }, // no 172: left off
    { name: 'Off guy', days: { [di]: [{ kind: 'off', job: '330', code: '172', hrs: 8 }] } },
    { name: 'Other day', days: { 3: [{ job: '330', code: '172', hrs: 8 }] } },
  ] };
  const [no, nm] = T.tcJobKey({ name: '330-U OF U OR5 HYBRID ROOM UPGRADE' });
  assert.deepStrictEqual(J(T.tmCrew172(card, D, no, nm)), [{ name: 'Juan Perez', hrs: 3 }, { name: 'Luis Garcia', hrs: 6.5 }]);
  assert.deepStrictEqual(J(T.tmCrew172(card, '2026-11-29', no, nm)), []); // Sunday is not on the card
  assert.deepStrictEqual(J(T.tmCrew172(null, D, no, nm)), []);
  // a second ticket the same day only gets the hours not already on the first
  const first = [{ tm: 1, id: 'a', crew: [{ name: 'Juan Perez', hrs: 3 }, { name: 'luis garcia ', hrs: 2 }] }];
  assert.deepStrictEqual(J(T.tmLeft(T.tmCrew172(card, D, no, nm), first)), [{ name: 'Luis Garcia', hrs: 4.5 }]);
  assert.deepStrictEqual(J(T.tmLeft([{ name: 'A', hrs: 4 }], [])), [{ name: 'A', hrs: 4 }]);
  assert.ok(T.tmIs172('172') && T.tmIs172(' 172 Extra') && T.tmIs172('T&M') && !T.tmIs172('1720') && !T.tmIs172('112'));
});

t('status transitions', () => {
  const a = tk(3);
  assert.strictEqual(T.tmSt(a), 'unsigned');
  assert.throws(() => T.tmSign(a, '', 'data:image/png;base64,x', 'now'));
  const s = T.tmSign(Object.assign({}, a, { no_sig: 'GC not on site' }), ' Mark GC ', 'data:image/png;base64,x', '2026-11-25T18:00:00Z');
  assert.strictEqual(T.tmSt(s), 'signed');
  assert.strictEqual(s.by, 'Mark GC');
  assert.strictEqual(s.no_sig, null);
  const sent = T.tmSetStatus(s, 'sent', { co: ' 7 ', by: 'Ken', at: 'x' });
  assert.strictEqual(T.tmSt(sent), 'sent'); assert.strictEqual(sent.co, '7'); assert.strictEqual(sent.upd_by, 'Ken');
  const ap = T.tmSetStatus(sent, 'approved', { amt: '$1,250.50' });
  assert.strictEqual(T.tmSt(ap), 'approved'); assert.strictEqual(ap.amt, 1250.5); assert.strictEqual(ap.co, '7');
  assert.strictEqual(T.tmSt(T.tmSign(ap, 'Mark', 'sig2', 'later')), 'approved'); // re-signing keeps the office status
  assert.strictEqual(T.tmSt(T.tmSetStatus(ap, 'open')), 'signed'); // back to the signature-based status
  assert.strictEqual(T.tmSt(T.tmSetStatus(a, 'open')), 'unsigned');
  assert.strictEqual(T.tmSt(T.tmSetStatus(a, 'rejected')), 'rejected');
  assert.strictEqual(T.tmSetStatus(ap, 'approved', { amt: '' }).amt, null);
  assert.throws(() => T.tmSetStatus(a, 'paid'));
  assert.strictEqual(T.tmSt(T.tmUnsign(s)), 'unsigned');
  assert.strictEqual(T.tmSt(T.tmUnsign(ap)), 'approved');
  // unsigned for more than 2 days gets flagged
  assert.ok(T.tmOld(a, '2026-11-20', '2026-11-25'));
  assert.ok(!T.tmOld(a, '2026-11-23', '2026-11-25'));
  assert.ok(!T.tmOld(s, '2026-11-01', '2026-11-25'));
});

t('foreman re-save keeps office fields and signatures', () => {
  const saved = [T.tmSetStatus(T.tmSign(tk(1), 'GC', 'sig', 'w'), 'approved', { co: 'CO-3', amt: 900, notes: 'ok' }), tk(2, { status: 'rejected' }), { work: 'plain' }];
  const form = [Object.assign(tk(1), { status: 'unsigned' }), { work: 'plain' }]; // stale form copy, ticket 2 missing
  const out = T.tmMerge(form, saved);
  assert.strictEqual(out.length, 3);
  assert.strictEqual(T.tmSt(out[0]), 'approved'); assert.strictEqual(out[0].co, 'CO-3'); assert.strictEqual(out[0].amt, 900); assert.strictEqual(out[0].sig, 'sig');
  assert.strictEqual(out[1].work, 'plain');
  assert.strictEqual(out[2].id, 't2'); // office-handled ticket can't be dropped
  const changed = T.tmMerge([Object.assign(tk(1), { work: 'different' })], [T.tmSign(tk(1), 'GC', 'sig', 'w')]);
  assert.ok(!changed[0].sig); // a changed ticket does not pick up the old signature
});

t('CSV export of the T&M log', () => {
  const l1 = { date: '2026-11-23', name: 'Juan Perez' };
  const t1 = T.tmSetStatus(T.tmSign(tk(2, { loc: 'Lvl 2, "Rm 204"', crew: [{ name: 'Juan', hrs: 3 }, { name: 'Luis', hrs: 6.5 }], mats: [{ item: '5/8 Type X', qty: 12, unit: 'sht' }] }), 'Mark', 'sig', '2026-11-23T20:05:00Z'), 'approved', { co: '7', amt: '1250' });
  const t2 = tk(1, { no_sig: 'GC not on site', work: 'Patch, then paint' });
  const rows = T.tmCsv([{ t: t1, l: l1 }, { t: t2, l: { date: '2026-11-20', name: 'Juan Perez' } }], { name: '330-U OF U OR5' });
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0][1], 'Ticket #');
  assert.deepStrictEqual(J(rows.slice(1).map(r => r[1])), ['T&M-001', 'T&M-002']); // sorted by ticket #
  const r2 = rows[2];
  assert.strictEqual(r2[6], 9.5); assert.strictEqual(r2[7], 'Juan 3; Luis 6.5'); assert.strictEqual(r2[8], '12 sht 5/8 Type X');
  assert.strictEqual(r2[10], 'Yes'); assert.ok(/^2026-11-2\d \d\d:\d\d$/.test(r2[11])); assert.strictEqual(r2[13], 'Approved'); assert.strictEqual(r2[14], '7'); assert.strictEqual(r2[15], 1250);
  assert.strictEqual(rows[1][10], 'No'); assert.strictEqual(rows[1][12], 'GC not on site'); assert.strictEqual(rows[1][15], '');
  const csv = T.toCsv(rows);
  assert.ok(csv.startsWith('\ufeffJob,Ticket #'));
  assert.ok(csv.includes('"Lvl 2, ""Rm 204"""'));
  assert.ok(csv.includes('"Patch, then paint"'));
});

t('old plain extra_work rows still render', () => {
  const plain = { work: 'Added backing', by: 'Steve (GC)', awa: '12' };
  assert.strictEqual(T.tmText(plain), 'Added backing – auth. Steve (GC) – AWA 12');
  assert.deepStrictEqual(J(T.tmCells(plain)), ['Added backing', 'Steve (GC)', '12']);
  assert.deepStrictEqual(J(T.tmCells({})), ['', '', '']);
  assert.strictEqual(T.tmText({ work: 'Just work' }), 'Just work');
  assert.deepStrictEqual(J(T.tmAll([{ date: 'd', extra_work: [plain] }])), []);
  const s = T.tmSign(tk(5, { loc: 'Rm 1', crew: [{ name: 'A', hrs: 2 }] }), 'Mark', 'sig', 'w');
  assert.strictEqual(T.tmText(s), 'T&M-005 Extra wall 5 @ Rm 1 – 2 hrs – GC signed (Mark)');
  assert.deepStrictEqual(J(T.tmCells(s)), ['T&M-005 Extra wall 5', 'Mark (signed)', '']);
  assert.strictEqual(T.tmText(tk(6, { no_sig: 'GC not on site' })), 'T&M-006 Extra wall 6 – not signed (GC not on site)');
});

console.log(n + ' T&M tests passed.');
