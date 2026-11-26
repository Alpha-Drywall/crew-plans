// Tests for the office Crew lookahead board: work days, double-booked/idle warnings, copy last week, fill from time cards. Pulls the pure functions out of index.html.
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
const names = ['tcKey', 'TC_ANCHOR', 'isoAddD', 'tcPeriodOf', 'tcJobNo', 'tcJobShort', 'tcHrs', 'tcDayIdx', 'tcLineNo', 'tcJobKey', 'tcIsJob',
  'lookDow', 'lookMonday', 'lookDays', 'lookWeekRest', 'lookByPerson', 'lookSet', 'lookDrop', 'lookCopyWeek', 'lookLastWorked', 'lookPrefill', 'lookActual', 'lookWarn', 'lookGroups', 'lookDiff', 'lookClean', 'tcFmt', 'lookRanges'];
const code = names.map(grab).join('\n') + '\n;({' + names.filter(n => n !== 'TC_ANCHOR').concat(['TC_OFF']).join(',') + '})';
const T = vm.runInNewContext(code, { Math, Date, String, Number, Set, Object, Array, JSON, isFinite, parseFloat });
const J = x => JSON.parse(JSON.stringify(x));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };

const JOBS = [{ id: 'j330', name: '330-U OF U OR5 HYBRID ROOM UPGRADE' }, { id: 'j331', name: '331-Nordic Valley WWTP' }, { id: 'jx', name: 'Smith Remodel' }];

t('work days: Monday start, two weeks Mon-Fri, Saturday only when planned', () => {
  assert.strictEqual(T.lookMonday('2026-11-25'), '2026-11-23'); // Wednesday
  assert.strictEqual(T.lookMonday('2026-11-23'), '2026-11-23'); // Monday
  assert.strictEqual(T.lookMonday('2026-11-28'), '2026-11-30'); // Saturday -> coming Monday
  assert.strictEqual(T.lookMonday('2026-11-29'), '2026-11-30'); // Sunday -> coming Monday
  const d = T.lookDays('2026-11-30');
  assert.strictEqual(d.length, 10);
  assert.deepStrictEqual(J(d.slice(0, 6)), ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-07']);
  assert.strictEqual(d[9], '2026-12-11');
  assert.ok(d.every(x => T.lookDow(x) >= 1 && T.lookDow(x) <= 5));
  const s = T.lookDays('2026-11-30', iso => iso === '2026-12-12');
  assert.strictEqual(s.length, 11); assert.strictEqual(s[10], '2026-12-12');
  assert.deepStrictEqual(J(T.lookWeekRest('2026-12-02', '2026-11-25')), ['2026-12-02', '2026-12-03', '2026-12-04']);
  assert.strictEqual(T.lookRanges(['2026-12-04', '2026-11-30', '2026-12-01', '2026-12-02'], d), '11/30–12/2, 12/4');
  assert.strictEqual(T.lookRanges(['2026-12-04', '2026-12-07'], d), '12/4–12/7'); // Fri and Mon are next to each other on the board
  assert.deepStrictEqual(J(T.lookWeekRest('2026-12-04', '2026-11-25')), ['2026-12-04']);
  assert.deepStrictEqual(J(T.lookWeekRest('2026-11-23', '2026-11-25')), ['2026-11-23', '2026-11-25', '2026-11-26', '2026-11-27']); // past days skipped
});

t('assigning moves a person off other jobs unless split day; clear and drop', () => {
  let P = T.lookSet({}, 'j330', ['Ana', 'Jose'], ['2026-12-01', '2026-12-02'], false);
  assert.deepStrictEqual(J(P), { j330: { '2026-12-01': ['Ana', 'Jose'], '2026-12-02': ['Ana', 'Jose'] } });
  P = T.lookSet(P, 'j331', ['ana '], ['2026-12-01'], false);
  assert.deepStrictEqual(J(P.j330['2026-12-01']), ['Jose']); assert.deepStrictEqual(J(P.j331['2026-12-01']), ['ana']);
  P = T.lookSet(P, 'j331', ['Jose'], ['2026-12-02'], true); // split day
  assert.deepStrictEqual(J(P.j330['2026-12-02']), ['Ana', 'Jose']); assert.deepStrictEqual(J(P.j331['2026-12-02']), ['Jose']);
  P = T.lookSet(P, null, ['Jose'], ['2026-12-02'], false); // nothing planned
  assert.deepStrictEqual(J(P.j330['2026-12-02']), ['Ana']); assert.ok(!P.j331['2026-12-02']);
  P = T.lookDrop(P, 'j330', ['Ana'], ['2026-12-02']);
  assert.ok(!P.j330['2026-12-02']);
  const D = T.lookDiff({ j330: { a: ['x'] } }, { j330: { a: ['x'], b: ['y'] }, j331: {} });
  assert.deepStrictEqual(J(D), { j330: { b: ['y'] } });
  assert.deepStrictEqual(J(T.lookDiff({ j330: { a: ['x'] } }, { j330: {} })), { j330: { a: null } });
  assert.deepStrictEqual(J(T.lookClean({ '2026-12-01': ['Ana', '', 3], bad: ['x'], '2026-12-02': 'Ana' })), { '2026-12-01': ['Ana'] });
  assert.deepStrictEqual(J(T.lookClean(null)), {});
});

t('double-booked and idle detection, active job with nobody planned', () => {
  const td = '2026-11-25', days = T.lookDays('2026-11-23');
  const plans = { j330: { '2026-11-25': ['Ana', 'Jose'], '2026-11-26': ['Ana'] }, j331: { '2026-11-25': ['jose'] } };
  const W = T.lookWarn(plans, ['Ana', 'Jose', 'Luis'], days, td, new Set(['j330', 'jx']), {});
  assert.deepStrictEqual(J(W.dbl), [{ name: 'Jose', date: '2026-11-25', jobs: ['j330', 'j331'] }]);
  const idle = W.idle.map(x => x.name + ' ' + x.date.slice(5));
  assert.ok(!idle.includes('Ana 11-25') && !idle.includes('Ana 11-26') && idle.includes('Ana 11-27'));
  assert.ok(!idle.some(x => x.endsWith('11-23') || x.endsWith('11-24'))); // past days are not idle
  assert.strictEqual(W.idle.filter(x => x.name === 'Luis').length, 8); // Wed 11/25 .. Fri 12/4
  assert.deepStrictEqual(J(W.empty), ['jx']); // active, nobody planned
  const W2 = T.lookWarn(plans, ['Ana'], days, '2026-12-20', new Set(['jx']), {}); // whole board in the past
  assert.deepStrictEqual(J(W2.empty), []); assert.strictEqual(W2.idle.length, 0);
});

// Pay periods start 11/11 and 11/25. In the 11/11 period, day 10 = Mon 11/23 and day 11 = Tue 11/24.
const P1 = '2026-11-11', P2 = '2026-11-25';
const cards = [
  { owner: 'u1', foreman: 'Mike Lopez', period_start: P1, workers: [
    { name: 'Mike Lopez', days: { 10: [{ kind: 'job', job: '330', code: '142', hrs: '10' }] } }, // Mon 11/23
    { name: 'Ana', days: { 10: [{ kind: 'job', job: '331', code: '112', hrs: '8' }], 11: [{ kind: 'job', job: '330', code: '112', hrs: '2' }, { kind: 'job', job: '331', code: '112', hrs: '6' }] } },
    { name: 'Jose', days: { 10: [{ kind: 'vac', hrs: '8' }], 11: [{ kind: 'job', job: '1', name: 'Office', hrs: '8' }] } },
  ] },
  { owner: 'u2', foreman: 'Raul', period_start: P1, workers: [{ name: 'Raul', days: {} }, { name: 'Pedro', days: { 0: [{ kind: 'job', job: '', name: 'smith remodel', hrs: '8' }] } }] },
  { owner: 'u1', foreman: 'Mike Lopez', period_start: P2, workers: [{ name: 'Mike Lopez', days: {} }, { name: 'Ana', days: { 0: [{ kind: 'job', job: '330', hrs: '0' }] } }] },
  { owner: 'off1', foreman: 'Ken', period_start: P2, workers: [{ name: 'Ken', days: { 0: [{ kind: 'job', job: '1', hrs: '8' }] } }] },
];

t('last worked from time cards and Same as time card prefill', () => {
  const L = T.lookLastWorked(cards, JOBS, '2026-11-26');
  assert.strictEqual(L['mike lopez'].job, 'j330'); assert.strictEqual(L['mike lopez'].date, '2026-11-23');
  assert.strictEqual(L.ana.job, 'j331'); assert.strictEqual(L.ana.date, '2026-11-24'); // 6 hrs on 331 beats 2 on 330; 0-hour line on 11/25 ignored
  assert.ok(!L.jose); // vacation and office only
  assert.strictEqual(L.pedro.job, 'jx'); // matched by name, no job number
  const days = T.lookDays('2026-11-23');
  const plans = { j330: { '2026-11-26': ['Ana'] } };
  const P = T.lookPrefill(plans, ['Mike Lopez', 'Ana', 'Jose'], days, L, '2026-11-25');
  assert.deepStrictEqual(J(P.j330['2026-11-26']), ['Ana', 'Mike Lopez']); // Ana already planned: kept
  assert.deepStrictEqual(J(P.j331['2026-11-25']), ['Ana']); assert.deepStrictEqual(J(P.j331['2026-11-27']), ['Ana']);
  assert.ok(!P.j331['2026-11-24'] && !P.j330['2026-11-24']); // past days not filled
  assert.deepStrictEqual(J(P.j330['2026-11-25']), ['Mike Lopez']);
  assert.ok(!JSON.stringify(P).includes('Jose'));
  assert.strictEqual(Object.keys(P.j330).length, 8); // Mike on the 8 work days 11/25 .. 12/4
});

t('copy last week', () => {
  const plans = { j330: { '2026-11-23': ['Ana', 'Jose'], '2026-11-24': ['Ana'], '2026-11-27': ['Jose'] }, j331: { '2026-11-24': ['Jose'], '2026-12-01': ['Luis'], '2026-11-30': ['Ana'] } };
  const P = T.lookCopyWeek(plans, '2026-11-23', '2026-11-30', '2026-11-25');
  assert.deepStrictEqual(J(P.j330['2026-11-30']), ['Ana', 'Jose']); // Ana moved off 331 on Monday
  assert.ok(!(P.j331['2026-11-30'] || []).length);
  assert.deepStrictEqual(J(P.j330['2026-12-01']), ['Ana']); assert.deepStrictEqual(J(P.j331['2026-12-01']), ['Luis', 'Jose']); // Luis kept
  assert.deepStrictEqual(J(P.j330['2026-12-04']), ['Jose']);
  assert.deepStrictEqual(J(P.j330['2026-11-23']), ['Ana', 'Jose']); // source untouched
  const P2 = T.lookCopyWeek(plans, '2026-11-16', '2026-11-23', '2026-11-25'); // empty source week: nothing changes
  assert.deepStrictEqual(J(T.lookDiff(plans, P2)), {});
  const P3 = T.lookCopyWeek({ j330: { '2026-11-16': ['Ana'], '2026-11-20': ['Ana'] } }, '2026-11-16', '2026-11-23', '2026-11-25');
  assert.ok(!P3.j330['2026-11-23']); assert.deepStrictEqual(J(P3.j330['2026-11-27']), ['Ana']); // past target days skipped
});

t('planned vs actual on past days', () => {
  const A23 = T.lookActual(cards, JOBS, '2026-11-23');
  assert.deepStrictEqual(J(A23), { 'mike lopez': ['j330'], ana: ['j331'], jose: ['other'] });
  assert.strictEqual(T.lookActual(cards, JOBS, '2026-10-01'), null);
  const plans = { j330: { '2026-11-23': ['Ana', 'Mike Lopez', 'Jose'] } };
  const W = T.lookWarn(plans, ['Mike Lopez', 'Ana', 'Jose', 'Pedro'], ['2026-11-23'], '2026-11-25', new Set(), { '2026-11-23': A23 });
  const m = W.miss.map(x => x.name);
  assert.deepStrictEqual(J(m), ['Ana', 'Jose']); // Mike matches; Ana worked 331; Jose on vacation; Pedro had no hours and no plan
  const W2 = T.lookWarn({}, ['Ana'], ['2026-11-23'], '2026-11-25', new Set(), { '2026-11-23': A23 });
  assert.deepStrictEqual(J(W2.miss), [{ name: 'Ana', date: '2026-11-23', plan: [], act: ['j331'] }]); // worked, not planned
});

t('rows grouped by foreman, office cards left out', () => {
  const G = T.lookGroups(cards, [{ name: 'Ana' }, { name: 'Luis' }, { name: 'Pedro' }], [{ user_id: 'u3', name: 'Tony Foreman' }], ['off1'], ['Zed']);
  assert.deepStrictEqual(J(G), [
    { fm: 'Mike Lopez', names: ['Mike Lopez', 'Ana', 'Jose'] },
    { fm: 'Raul', names: ['Raul', 'Pedro'] },
    { fm: 'Tony Foreman', names: ['Tony Foreman'] },
    { fm: '', names: ['Luis', 'Zed'] },
  ]);
  assert.ok(!JSON.stringify(G).includes('Ken'));
  const byP = T.lookByPerson({ j330: { d1: ['Ana'] }, j331: { d1: ['ANA'] } });
  assert.deepStrictEqual(J(byP), { ana: { n: 'Ana', d: { d1: ['j330', 'j331'] } } });
});

console.log(n + ' tests passed');
