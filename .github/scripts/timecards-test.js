// Tests for the time card -> daily report / Labor tab math. Pulls the pure functions out of index.html and runs them with stubs.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const src = (fs.readFileSync('index.html', 'utf8').match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1];

// Find a top-level declaration and return its text: the declaration line plus any indented continuation lines.
const lines = src.split('\n');
function grab(name) {
  const re = new RegExp('^(?:async )?(?:function ' + name + '\\(|const ' + name + '=)');
  const i = lines.findIndex(l => re.test(l));
  if (i < 0) throw new Error('not found in index.html: ' + name);
  let j = i + 1;
  if (!lines[i].startsWith('const ')) while (j < lines.length && /^(\s|\})/.test(lines[j])) j++;
  return lines.slice(i, j).join('\n');
}
const names = ['num', 'r2', 'tcKey', 'TC_ANCHOR', 'isoAddD', 'tcPeriodOf', 'tcJobNo', 'tcJobShort', 'tcHrs', 'LABOR_CODES', 'codeHrs', 'f1', 'fmtWk',
  'tcDayIdx', 'tcLineNo', 'tcJobKey', 'tcIsJob', 'tcLabCode', 'tcJobDay', 'tcJobLive', 'sameBy', 'labK', 'laborCost', 'laborCut', 'laborEff', 'LABOR_WARN', 'laborAlerts',
  'nameKey', 'isOfficeName', 'isOfficeUser', 'tcOfficeCode', 'tcAllOffice', 'tcSkipRoster', 'crewOnly'];
const code = names.map(grab).join('\n') + '\n;({' + names.filter(n => n !== 'TC_ANCHOR').concat(['TC_OFF']).join(',') + '})';
const ctx = { S: {}, PHASES: [], Math, Date, String, Number, Set, Object, Array, isFinite, parseFloat };
const T = vm.runInNewContext(code, ctx);
const J = x => JSON.parse(JSON.stringify(x));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };

const P = '2026-11-25'; // a pay period start (Wednesday)
t('pay period and day index', () => {
  assert.strictEqual(T.tcPeriodOf('2026-11-25'), P);
  assert.strictEqual(T.tcPeriodOf('2026-12-08'), P);
  assert.strictEqual(T.tcPeriodOf('2026-12-09'), '2026-12-09');
  assert.strictEqual(T.tcDayIdx(P, '2026-11-25'), 0);
  assert.strictEqual(T.tcDayIdx(P, '2026-11-28'), 3); // Saturday
  assert.strictEqual(T.tcDayIdx(P, '2026-11-29'), -1); // Sunday: not on the card
  assert.strictEqual(T.tcDayIdx(P, '2026-11-30'), 4); // Monday
  assert.strictEqual(T.tcDayIdx(P, '2026-12-08'), 11);
  assert.strictEqual(T.tcDayIdx(P, '2026-12-09'), -1);
  for (let d = 0; d < 12; d++) assert.strictEqual(T.tcDayIdx(P, T.isoAddD(P, T.TC_OFF[d])), d);
});
t('cost code mapping', () => {
  const m = (c, s) => T.tcLabCode(c, s);
  assert.strictEqual(m('112'), '112'); assert.strictEqual(m('112-Framing'), '112'); assert.strictEqual(m(' 122 Hanging'), '122');
  assert.strictEqual(m('132'), '132'); assert.strictEqual(m('161'), '161'); assert.strictEqual(m('162'), '161'); assert.strictEqual(m('172'), '172');
  assert.strictEqual(m('142'), '142c'); assert.strictEqual(m('142', true), '142s');
  assert.strictEqual(m('142-Supervision'), '142s'); assert.strictEqual(m('142-Cleanup', true), '142c'); assert.strictEqual(m('142s'), '142s'); assert.strictEqual(m('142c', true), '142c');
  assert.strictEqual(m('142 Clean/Sup/Layout'), '142c'); assert.strictEqual(m('142 Clean/Sup/Layout', true), '142s');
  assert.strictEqual(m('152'), '172'); assert.strictEqual(m('999'), '172'); assert.strictEqual(m('framing'), '112'); assert.strictEqual(m('tape'), '132');
  assert.strictEqual(m(''), ''); assert.strictEqual(m(null), '');
});
t('job matching', () => {
  const [no, nm] = T.tcJobKey({ name: '330-U OF U OR5 HYBRID ROOM UPGRADE' });
  assert.strictEqual(no, '330');
  assert.ok(T.tcIsJob({ kind: 'job', job: '330', name: 'U OF U OR5' }, no, nm));
  assert.ok(T.tcIsJob({ job: '330-U of U', hrs: 8 }, no, nm));
  assert.ok(T.tcIsJob({ job: ' 0330 ' }, no, nm));
  assert.ok(!T.tcIsJob({ job: '3301' }, no, nm));
  assert.ok(!T.tcIsJob({ job: '331' }, no, nm));
  assert.ok(!T.tcIsJob({ kind: 'vac', job: '330' }, no, nm));
  assert.ok(!T.tcIsJob({ kind: 'off' }, no, nm));
  const [no2, nm2] = T.tcJobKey({ name: 'Smith Remodel' });
  assert.strictEqual(no2, '');
  assert.ok(T.tcIsJob({ job: '', name: 'smith remodel' }, no2, nm2));
  assert.ok(!T.tcIsJob({ job: '1', name: 'Office' }, no2, nm2));
});

// A foreman's card: Mike (foreman) + 3 crew. Wed: Jose split 4 hrs job 330 / 4 hrs job 331.
const card = () => ({
  owner: 'u1', foreman: 'Mike Lopez', period_start: P, workers: [
    { name: 'Mike Lopez', days: { 0: [{ kind: 'job', job: '330', name: 'U of U', code: '142', hrs: '10' }] } },
    { name: 'Ana', days: { 0: [{ kind: 'job', job: '330', code: '112', hrs: '10' }], 1: [{ kind: 'off' }] } },
    { name: 'Jose', days: { 0: [{ kind: 'job', job: '330', code: '122', hrs: '4' }, { kind: 'job', job: '331', code: '122', hrs: '4' }] } },
    { name: 'Luis', days: { 0: [{ kind: 'job', job: '330', code: '', hrs: '2' }, { kind: 'job', job: '330', code: '152', hrs: '6' }] } },
  ]
});
t('one day on one job, worker split across two jobs', () => {
  const r = T.tcJobDay([card()], '2026-11-25', '330', 'U of U');
  assert.strictEqual(r.hours, 32);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.by)), { '142s': 10, '112': 10, '122': 4, '172': 6 });
  assert.strictEqual(r.unc, 2); assert.strictEqual(r.other, 6); assert.strictEqual(r.workers, 4); assert.ok(r.filled);
  const r2 = T.tcJobDay([card()], '2026-11-25', '331', 'Nordic');
  assert.strictEqual(r2.hours, 4); assert.strictEqual(r2.workers, 1); assert.deepStrictEqual(JSON.parse(JSON.stringify(r2.by)), { '122': 4 });
});
t('workforce by trade from the time card', () => {
  const r = T.tcJobDay([card()], '2026-11-25', '330', 'U of U');
  // Mike is the foreman; Ana framed; Jose hung; Luis mostly 152 acoustical -> Carpenter
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.trades)), { Foreman: 1, Framer: 1, Drywall: 1, Carpenter: 1 });
  const r2 = T.tcJobDay([card()], '2026-11-25', '331', 'Nordic');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r2.trades)), { Drywall: 1 });
});
t('no time card / day not filled / Off day / Sunday', () => {
  const none = T.tcJobDay([], '2026-11-25', '330', '');
  assert.strictEqual(none.hours, 0); assert.ok(!none.filled); assert.strictEqual(none.cards, 0);
  const empty = T.tcJobDay([card()], '2026-11-27', '330', ''); // Friday: nothing entered
  assert.ok(!empty.filled); assert.strictEqual(empty.hours, 0); assert.strictEqual(empty.cards, 1);
  const off = T.tcJobDay([card()], '2026-11-26', '330', ''); // Thursday: Ana marked Off
  assert.ok(off.filled); assert.strictEqual(off.hours, 0);
  const sun = T.tcJobDay([card()], '2026-11-29', '330', '');
  assert.strictEqual(sun.cards, 0); assert.strictEqual(sun.hours, 0);
  const other = T.tcJobDay([card()], '2026-12-10', '330', ''); // date in the next period
  assert.strictEqual(other.cards, 0);
});
t('correction flows through (recompute after the card changes)', () => {
  const c = card();
  const before = T.tcJobDay([c], '2026-11-25', '330', '');
  c.workers[1].days[0][0].hrs = '8'; c.workers[1].days[0][0].code = '122'; // Ana: 10 hrs framing -> 8 hrs hanging
  c.workers[2].days[0].splice(0, 1); // Jose's 330 line removed
  const after = T.tcJobDay([c], '2026-11-25', '330', '');
  assert.strictEqual(before.hours, 32); assert.strictEqual(after.hours, 26);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(after.by)), { '142s': 10, '122': 8, '172': 6 });
  assert.strictEqual(after.workers, 3);
  assert.ok(!T.sameBy(before.by, after.by)); assert.ok(T.sameBy(after.by, { '142s': 10, '122': 8, '172': 6, '112': 0 }));
});
t('live hours since the last job cost update', () => {
  const c = card(); c.workers[1].days[4] = [{ job: '330', code: '112', hrs: 10 }]; // Mon 11/30
  const all = T.tcJobLive([c], '330', '', '');
  assert.strictEqual(all.hours, 42); assert.strictEqual(all.by['112'], 20); assert.strictEqual(all.by.unc, 2); assert.strictEqual(all.days.size, 2);
  const since = T.tcJobLive([c], '330', '', '2026-11-28');
  assert.strictEqual(since.hours, 10); assert.deepStrictEqual([...since.days], ['2026-11-30']);
  const cost = { history: [{ date: '2026-11-14' }, { date: '2026-11-28' }], as_of: '2026-11-29' };
  assert.strictEqual(T.laborCut(cost), '2026-11-28'); assert.strictEqual(T.laborCut(null), '');
});
t('alert merge: higher of official vs official + time cards', () => {
  assert.deepStrictEqual(J(T.laborEff({ used: 5, live: 2 }, {})), { v: 7, tc: true });
  assert.deepStrictEqual(J(T.laborEff({ used: 5, live: 0 }, {})), { v: 5, tc: false });
  assert.deepStrictEqual(J(T.laborEff({ used: 5, live: null }, {})), { v: 5, tc: false });
  assert.deepStrictEqual(J(T.laborEff({ used: 5, live: 4 }, null)), { v: 5, tc: false }); // no job cost: used already from reports
  assert.deepStrictEqual(J(T.laborEff({ used: 5, live: 6 }, null)), { v: 6, tc: true });
  const C = { cost: { history: [{}] }, tc: { after: '2026-11-28' }, rows: [
    { c: { k: '112', n: '112-Framing' }, md: 10, used: 9, live: 2 },
    { c: { k: '122', n: '122-Hanging' }, md: 10, used: 5, live: 0 },
    { c: { k: '132', n: '132-Finishing' }, md: 10, used: 9.2, live: 0 },
    { c: { k: '161', n: '161-Batts & Caulk' }, md: 10, used: 8.9, live: 0 }] };
  const A = T.laborAlerts(C);
  assert.strictEqual(A.length, 2); // 112 over (110%), 132 near (92%); 122 at 50% and 161 at 89% are fine
  assert.ok(/over budget: 11 of 10 man days used \(110% of the budgeted hours\) \(incl\. time cards since /.test(A[0].t), A[0].t);
  assert.strictEqual(A[0].lvl, 'over'); assert.strictEqual(A[1].lvl, 'near');
  assert.ok(/^132-Finishing: 92% of the budgeted hours used, 0\.8 man days left\.$/.test(A[1].t), A[1].t);
  assert.ok(A[0].tc); assert.ok(!A[1].tc); assert.ok(!/time cards/.test(A[1].t));
  assert.ok(!/complete|work done/i.test(A.map(a => a.t).join(' '))); // hours only now
  const edge = T.laborAlerts({ rows: [{ c: { k: '112', n: '112-Framing' }, md: 10, used: 9, live: null }, { c: { k: '122', n: '122-Hanging' }, md: 10, used: 10, live: null }] });
  assert.deepStrictEqual(J(edge.map(a => a.lvl)), ['near', 'near']); // exactly 90% warns; exactly 100% is not over yet
});
t('report form and report list text', () => {
  const H = vm.runInNewContext(['tcFmt', 'tcFeedHtml', 'logHrsHtml'].map(grab).join('\n') + ';({tcFeedHtml,logHrsHtml})',
    Object.assign(ctx, T, { esc: s => String(s), today: () => '2026-11-25', fmtDay: s => s, isAdminRole: () => true }));
  const c = card(), r = T.tcJobDay([c], '2026-11-25', '330', '');
  const ok = H.tcFeedHtml({ d: '2026-11-25', card: c, r });
  assert.ok(ok.includes('From time cards: 32 hrs') && ok.includes('112: 10') && ok.includes('142 Sup: 10') && ok.includes('4 workers'), ok);
  const none = H.tcFeedHtml({ d: '2026-11-25', card: null, r: null });
  assert.ok(none.includes('Fill out today\u2019s time card first') && none.includes('data-tcopen'), none);
  assert.ok(H.tcFeedHtml({ d: '2026-11-27', card: c, r: T.tcJobDay([c], '2026-11-27', '330', '') }).includes('Fill out the time card for 2026-11-27 first'));
  assert.ok(H.tcFeedHtml({ d: '2026-11-29', card: c, r: T.tcJobDay([c], '2026-11-29', '330', '') }).includes('Sundays'));
  assert.ok(H.tcFeedHtml({ d: '2026-11-25', card: undefined }).includes('check the time card'));
  assert.ok(H.tcFeedHtml({ d: '2026-11-29', card: null, r: null }).includes('Sundays'));
  ctx.S.logTc = {};
  assert.ok(H.logHrsHtml({ id: 'a', hours: 0 }).includes('No hours'));
  assert.ok(H.logHrsHtml({ id: 'b', hours: 20, hours_by_code: { '112': 20 } }).includes('Hours:</b> 20 \u00b7 112: 20'));
  ctx.S.logTc = { c: r };
  assert.ok(H.logHrsHtml({ id: 'c', hours: 0 }).includes('32'));
});
t('office people: matched by name ignoring case, accents and punctuation', () => {
  ctx.S.office = [{ id: 'o1', user_id: 'u-ken', name: 'Ken VanSickle' }, { id: 'o2', user_id: 'u-jo', name: 'José Ramírez' }, { id: 'o3', user_id: null, name: 'Shayla Hunter' }];
  assert.ok(T.isOfficeName('Ken VanSickle')); assert.ok(T.isOfficeName('  ken vansickle ')); assert.ok(T.isOfficeName('KEN VANSICKLE'));
  assert.ok(T.isOfficeName('Jose Ramirez')); assert.ok(T.isOfficeName('josé ramírez')); assert.ok(T.isOfficeName('Shayla  Hunter'));
  assert.ok(!T.isOfficeName('Ken')); assert.ok(!T.isOfficeName('Javier Mena')); assert.ok(!T.isOfficeName('')); assert.ok(!T.isOfficeName(null));
  assert.ok(T.isOfficeUser('u-ken')); assert.ok(!T.isOfficeUser('u-foreman')); assert.ok(!T.isOfficeUser(null));
  assert.deepStrictEqual(J(T.crewOnly([{ name: 'Javier Mena' }, { name: 'ken vansickle' }, { name: 'Luis Ortiz' }])).map(r => r.name), ['Javier Mena', 'Luis Ortiz']);
  assert.deepStrictEqual(J(T.crewOnly(['Javier Mena', 'Jose Ramirez'])), ['Javier Mena']); // lookahead roster rows can be plain names
  assert.deepStrictEqual(J(T.crewOnly(null)), []);
});
t('office people: a worker whose hours are all 001 Office, and the office user on his own card', () => {
  ctx.S.office = [{ id: 'o1', user_id: 'u-ken', name: 'Ken VanSickle' }];
  const w = days => ({ name: 'Kenny V', days });
  assert.ok(T.tcAllOffice(w({ 0: [{ job: '1 - Office', code: '001', hrs: '8' }], 1: [{ code: '001 Office', hrs: '4' }, { kind: 'vac', hrs: '4' }] })));
  assert.ok(!T.tcAllOffice(w({ 0: [{ code: '001', hrs: '4' }, { job: '330', code: '112', hrs: '4' }] })));
  assert.ok(!T.tcAllOffice(w({}))); assert.ok(!T.tcAllOffice(w({ 0: [{ code: '001', hrs: '' }] }))); // no hours yet: not decided
  assert.ok(!T.tcAllOffice(w({ 0: [{ code: '', hrs: '8' }] }))); // no code is not office
  assert.ok(T.tcOfficeCode('001')); assert.ok(T.tcOfficeCode('Office')); assert.ok(!T.tcOfficeCode('112')); assert.ok(!T.tcOfficeCode('010'));
  const kenCard = { owner: 'u-ken', foreman: 'Kenneth V' }, fmCard = { owner: 'u-fm', foreman: 'Luis Ortiz' };
  assert.ok(T.tcSkipRoster('Ken VanSickle', null, fmCard)); // office name, even on a foreman card
  assert.ok(T.tcSkipRoster('kenneth v', null, kenCard)); // office user's own card: his own line
  assert.ok(!T.tcSkipRoster('Javier Mena', null, kenCard)); // a crew member on the office user's card still goes on
  assert.ok(!T.tcSkipRoster('Luis Ortiz', null, fmCard)); // a foreman on his own card is crew
  assert.ok(T.tcSkipRoster('Javier Mena', w({ 0: [{ code: '001', hrs: '8' }] }), fmCard));
  assert.ok(!T.tcSkipRoster('Javier Mena', w({ 0: [{ code: '112', hrs: '8' }] }), fmCard));
});
(async () => {
  const calls = [];
  const chain = (tbl) => { const o = { op: null, tbl }; const p = new Proxy(o, { get: (x, k) => k === 'then' ? undefined : (k === 'insert' || k === 'update' || k === 'select') ? (...a) => { if (k !== 'select' || !x.op) x.op = k; calls.push(tbl + '.' + k); return p; } : () => p }); return p; };
  const TC = { roster: [{ id: 'r1', name: 'Javier Mena', rate: 30 }], card: { owner: 'u-ken', foreman: 'Ken VanSickle' } };
  const R = vm.runInNewContext(grab('tcRosterSave') + ';tcRosterSave', Object.assign({}, ctx, T, { TC, tcRoster: n => TC.roster.find(r => T.tcKey(r.name) === T.tcKey(n)),
    sb: { from: chain }, q: async () => [], run: async () => null, Object, String, isFinite }));
  ctx.S.office = [{ id: 'o1', user_id: 'u-ken', name: 'Ken VanSickle' }];
  await R('Ken VanSickle', '45'); await R('ken  vansickle'); // office name
  await R('Ken V', '', { name: 'Ken V', days: { 0: [{ code: '001', hrs: '8' }] } }); // all 001 Office
  assert.deepStrictEqual(calls, []); assert.strictEqual(TC.roster.length, 1);
  await R('Luis Ortiz', '32', { name: 'Luis Ortiz', days: { 0: [{ code: '112', hrs: '8' }] } }); // crew: added
  assert.ok(calls.includes('crew_roster.insert'), calls.join()); assert.deepStrictEqual(J(TC.roster.map(r => r.name)), ['Javier Mena', 'Luis Ortiz']);
  calls.length = 0; await R('Javier Mena', '31', { name: 'Javier Mena', days: { 0: [{ code: '001', hrs: '8' }] } }); // already crew: rate still updates
  assert.ok(calls.includes('crew_roster.update')); assert.strictEqual(TC.roster[0].rate, 31);
  console.log('ok - crew list save: office names and all-001 workers are not added; crew still is');
  console.log(n + ' tests passed');
})().catch(e => { console.error(e); process.exit(1); });
