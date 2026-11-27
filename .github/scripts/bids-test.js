// Tests for the bid list: Coming up (Due today / This week / Later, everyone's, by bid date), Waiting on results and Results
// grouped by estimator, the estimator chips, and which sections start collapsed.
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
const names = ['BID_ST', 'dayDiff', 'MON3', 'BID_NOWORD_DAYS', 'bidNoWord', 'bidRes', 'bidStat', 'bidPh', 'bidComingGroups', 'bidEstSort', 'bidEstNames', 'bidSecs', 'bidCollOn', 'DOW3', 'wkDay', 'bidWeekDays'];
const T = vm.runInNewContext(names.map(grab).join('\n') + '\n;({' + names.join(',') + '})', { Math, Date, String, Number, Set, Object, Array, JSON, RegExp });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };
const TD = '2026-11-26';
const PM = { o1: 'Ken', o2: 'Rob', o3: 'Josh' };
const nm = j => PM[j.pm] || '';
const B = [
  { id: 'a', name: 'ZEBRA', pm: 'o3', bid_date: '2026-11-26' },
  { id: 'b', name: 'TOWNEPLACE SUITES - IDAHO FALLS', pm: 'o1', bid_date: '2026-12-01' },
  { id: 'c', name: 'ALPHA', pm: 'o3', bid_date: '2026-12-01' },
  { id: 'd', name: 'LATER JOB', pm: 'o2', bid_date: '2026-12-04' },
  { id: 'e', name: 'WAY LATER', pm: 'o3', bid_date: '2027-01-15' },
  { id: 'f', name: 'WON ONE', pm: 'o1', bid_date: '2026-12-02', bid_status: 'won' },
  { id: 'g', name: 'NO BID', pm: 'o3', bid_date: '2026-11-28', bid_status: 'nobid' },
  { id: 'h', name: 'WAITING KEN', pm: 'o1', bid_date: '2026-11-20' },
  { id: 'i', name: 'WAITING JOSH', pm: 'o3', bid_date: '2026-11-10', bid_status: 'submitted' },
  { id: 'j', name: 'NO DATE', pm: 'o2' },
  { id: 'k', name: 'OLD NO WORD', pm: 'o3', bid_date: '2026-05-01' },
  { id: 'l', name: 'LOST', pm: null, bid_date: '2026-10-01', bid_status: 'lost', result_date: '2026-10-20' },
  { id: 'm', name: 'TODAY REBID', pm: 'o2', bid_date: '2026-11-26', bid_status: 'rebid' }];
const plain = x => JSON.parse(JSON.stringify(x));
const ids = a => plain(a.map(j => j.id));

t('Coming up: everyone\'s bids due today or later, no won / lost / no bid; Due today, This week (rest of Mon-Sun week), Next week, Later; by date then name', () => {
  const g = T.bidComingGroups(B, TD);
  assert.deepStrictEqual(plain(g.map(x => [x[0], x[1], ids(x[2])])), [['today', 'Due today', ['m', 'a']], ['next', 'Next week', ['c', 'b', 'd']], ['later', 'Later', ['e']]]);
});

t('calendar week Mon-Sun: Thu 11/26 -> This week thru Sun 11/29, Next week Mon 11/30 - Sun 12/6, then Later; empty groups dropped', () => {
  const g = T.bidComingGroups([{ id: 'w', bid_date: '2026-11-29' }, { id: 'x', bid_date: '2026-11-30' }, { id: 'y', bid_date: '2026-12-06' }, { id: 'z', bid_date: '2026-12-07' }], TD);
  assert.deepStrictEqual(plain(g.map(x => [x[0], ids(x[2])])), [['week', ['w']], ['next', ['x', 'y']], ['later', ['z']]]);
  const s = T.bidComingGroups([{ id: 'u', bid_date: '2026-11-29' }, { id: 'v', bid_date: '2026-11-30' }], '2026-11-29');
  assert.deepStrictEqual(plain(s.map(x => [x[0], ids(x[2])])), [['today', ['u']], ['next', ['v']]], 'on Sunday, Monday is Next week');
  const mo = T.bidComingGroups([{ id: 'v', bid_date: '2026-12-06' }], '2026-11-30');
  assert.deepStrictEqual(plain(mo.map(x => [x[0], ids(x[2])])), [['week', ['v']]], 'on Monday, Sunday is This week');
  assert.deepStrictEqual(plain(T.bidComingGroups([], TD)), []);
  assert.deepStrictEqual(plain(T.bidComingGroups([{ id: 'p', bid_date: '2026-11-25' }], TD)), []);
});

t('All bids sections: Coming up, Waiting on results by estimator, No bid date, Results by estimator (No estimator last)', () => {
  const s = T.bidSecs(B, TD, nm, true);
  assert.deepStrictEqual(plain(s.map(x => x.k)), ['up', 'wait', 'nodate', 'res']);
  assert.deepStrictEqual(ids(s[0].items), ['m', 'a', 'c', 'b', 'd', 'e']);
  assert.deepStrictEqual(plain(s[1].groups.map(g => [g[0], ids(g[1])])), [['Josh', ['i']], ['Ken', ['h']]]);
  assert.deepStrictEqual(ids(s[2].items), ['j']);
  assert.strictEqual(s[2].groups, undefined);
  assert.deepStrictEqual(plain(s[3].groups.map(g => [g[0], ids(g[1])])), [['Josh', ['g', 'k']], ['Ken', ['f']], ['No estimator', ['l']]]);
});

t('My bids sections: same phases, not grouped by estimator; empty sections dropped', () => {
  const mine = B.filter(j => j.pm === 'o1');
  const s = T.bidSecs(mine, TD, nm, false);
  assert.deepStrictEqual(plain(s.map(x => [x.k, ids(x.items), !!x.groups])), [['up', ['b'], false], ['wait', ['h'], false], ['res', ['f'], false]]);
  assert.deepStrictEqual(plain(s[0].subs.map(x => x[0])), ['next']);
});

t('estimator chips: names with bids, A-Z, no blanks', () => {
  assert.deepStrictEqual(plain(T.bidEstNames(B, nm)), ['Josh', 'Ken', 'Rob']);
  assert.deepStrictEqual(['No estimator', 'Rob', 'Ken'].sort(T.bidEstSort), ['Ken', 'Rob', 'No estimator']);
});

t('collapsed: Results start collapsed, everything else open; a saved choice wins', () => {
  assert.strictEqual(T.bidCollOn({}, 'all:res'), true);
  assert.strictEqual(T.bidCollOn({}, 'mine:res'), true);
  assert.strictEqual(T.bidCollOn({}, 'all:res:Ken'), false);
  assert.strictEqual(T.bidCollOn({}, 'all:up'), false);
  assert.strictEqual(T.bidCollOn({}, 'all:wait:Josh'), false);
  assert.strictEqual(T.bidCollOn({ 'all:res': false, 'all:wait:Josh': true }, 'all:res'), false);
  assert.strictEqual(T.bidCollOn({ 'all:wait:Josh': true }, 'all:wait:Josh'), true);
  assert.strictEqual(T.bidCollOn(null, 'all:up'), false);
});

t('weekday dates for the This week strip', () => {
  assert.strictEqual(T.wkDay('2026-12-01'), 'Tue Dec 1');
  assert.strictEqual(T.wkDay('2026-11-26'), 'Thu Nov 26');
  assert.strictEqual(T.wkDay(''), '');
});
const W = (list, td, pm) => { const w = T.bidWeekDays(list, td, pm); return w && plain({ label: w.label, days: w.days.map(x => [x.d, x.iso, ids(x.items)]), total: w.total, amt: w.amt }); };
t('This week: Thu with bids Thu / Fri / Sun -> This week, Mon-Sun cells, total and $ from today on', () => {
  const L = [{ id: 'th', name: 'THU', bid_date: '2026-11-26', bid_amount: 100000 }, { id: 'fr', name: 'FRI', bid_date: '2026-11-27', bid_amount: '50000' }, { id: 'su', name: 'SUN', bid_date: '2026-11-29' },
    { id: 'nx', name: 'NEXT MON', bid_date: '2026-11-30', bid_amount: 9 }, { id: 'mo', name: 'WAITING MON', bid_date: '2026-11-23', bid_amount: 7 }, { id: 'nb', name: 'NO BID TUE', bid_date: '2026-11-24', bid_status: 'nobid' }];
  const w = W(L, TD);
  assert.strictEqual(w.label, 'This week');
  assert.deepStrictEqual(w.days.map(x => x[0] + ' ' + x[1]), ['Mon 2026-11-23', 'Tue 2026-11-24', 'Wed 2026-11-25', 'Thu 2026-11-26', 'Fri 2026-11-27', 'Sat 2026-11-28', 'Sun 2026-11-29']);
  assert.deepStrictEqual(w.days.map(x => x[2]), [['mo'], [], [], ['th'], ['fr'], [], ['su']]);
  assert.strictEqual(w.total, 3);
  assert.strictEqual(w.amt, 150000);
});
t('This week: Sat with nothing left -> Next week (Mon-Sun after); nothing in either -> null', () => {
  const L = [{ id: 'th', bid_date: '2026-11-26' }, { id: 'tu', bid_date: '2026-12-01', bid_amount: 20 }, { id: 'su', bid_date: '2026-12-06' }, { id: 'far', bid_date: '2026-12-07' }];
  const w = W(L, '2026-11-28');
  assert.strictEqual(w.label, 'Next week');
  assert.deepStrictEqual(w.days.map(x => x[1]), ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06']);
  assert.deepStrictEqual(w.days.map(x => x[2].join()), ['', 'tu', '', '', '', '', 'su']);
  assert.strictEqual(w.total, 2);
  assert.strictEqual(w.amt, 20);
  assert.strictEqual(T.bidWeekDays([{ id: 'far', bid_date: '2026-12-07' }], '2026-11-28'), null);
  assert.strictEqual(T.bidWeekDays([], TD), null);
  assert.strictEqual(T.bidWeekDays([{ id: 'won', bid_date: '2026-11-27', bid_status: 'won' }], TD), null);
});
t('This week: Sunday is the last day of its week (not the first of the next)', () => {
  const w = W([{ id: 'su', bid_date: '2026-11-29' }, { id: 'mo', bid_date: '2026-11-30' }], '2026-11-29');
  assert.strictEqual(w.label, 'This week');
  assert.strictEqual(w.days[0][1], '2026-11-23');
  assert.deepStrictEqual(w.days[6], ['Sun', '2026-11-29', ['su']]);
  assert.strictEqual(w.total, 1);
  const n = W([{ id: 'mo', bid_date: '2026-11-30' }], '2026-11-29');
  assert.strictEqual(n.label, 'Next week');
  assert.deepStrictEqual(n.days[0], ['Mon', '2026-11-30', ['mo']]);
  const m = W([{ id: 'mo', bid_date: '2026-11-30' }], '2026-11-30');
  assert.strictEqual(m.label, 'This week');
  assert.deepStrictEqual(m.days[0], ['Mon', '2026-11-30', ['mo']]);
});
t('This week: several bids the same day sorted by name, all counted', () => {
  const L = [{ id: 'z', name: 'ZULU', bid_date: '2026-11-27', bid_amount: 1 }, { id: 'a', name: 'ALPHA', bid_date: '2026-11-27', bid_amount: 2 }, { id: 'm', name: 'MIKE', bid_date: '2026-11-27' }, { id: 't', name: 'TODAY', bid_date: '2026-11-26' }];
  const w = W(L, TD);
  assert.deepStrictEqual(w.days[4], ['Fri', '2026-11-27', ['a', 'm', 'z']]);
  assert.strictEqual(w.total, 4);
  assert.strictEqual(w.amt, 3);
});
t('This week: mine -> only that estimator, falls to Next week on their own bids', () => {
  const w = W(B, TD, 'o1');
  assert.strictEqual(w.label, 'Next week');
  assert.deepStrictEqual(w.days.map(x => x[2].join()).filter(Boolean), ['b']);
  const all = W(B, TD);
  assert.strictEqual(all.label, 'This week');
  assert.deepStrictEqual(all.days.map(x => x[2]), [[], [], [], ['m', 'a'], [], [], []]);
  assert.strictEqual(W(B, TD, 'o2').label, 'This week');
  assert.deepStrictEqual(W(B, TD, 'o2').days[3][2], ['m']);
  assert.strictEqual(T.bidWeekDays(B, TD, 'nobody'), null);
});
console.log(n + ' tests passed');
