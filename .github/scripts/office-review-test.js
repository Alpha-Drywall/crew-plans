// Tests for: bid In for review state (kept in jobs.bid_notes), the In review bid filter, lookahead job remove / undo / which jobs show,
// and the phone job-tab rows (Field / Office). Pulls the pure functions out of index.html.
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
const names = ['BID_ST', 'dayDiff', 'BID_NOWORD_DAYS', 'bidNoWord', 'bidRes', 'bidStat', 'bidReview', 'BID_REV_TXT', 'bidReviewNote', 'bidInRev', 'bidPlainNotes', 'bidFilt',
  'tcKey', 'lookSet', 'lookClearJob', 'lookRestoreJob', 'lookShownIds', 'JT_LAB', 'JT_OFFICE', 'jobTabRows'];
const T = vm.runInNewContext(names.map(grab).join('\n') + '\n;({' + names.join(',') + '})', { Math, Date, String, Number, Set, Object, Array, JSON, RegExp });
const J = x => JSON.parse(JSON.stringify(x));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };
const TD = '2026-11-28';

t('review state: none, in, done, canceled; newest review entry wins; plain notes ignored', () => {
  assert.strictEqual(T.bidReview(null), null);
  assert.strictEqual(T.bidReview([{ at: TD, by: 'Ken', text: 'Called GC' }]), null);
  const a = T.bidReviewNote('in', 'Ken', TD, '2026-11-28T15:00:00Z');
  assert.deepStrictEqual(J(a), { kind: 'review', state: 'in', by: 'Ken', at: TD, ts: '2026-11-28T15:00:00Z', text: 'In for review' });
  let r = T.bidReview([a, { at: TD, text: 'later plain note' }]);
  assert.deepStrictEqual(J(r), { on: true, state: 'in', by: 'Ken', at: TD, ts: '2026-11-28T15:00:00Z' });
  r = T.bidReview([a, T.bidReviewNote('done', 'Josh', TD, 'x')]);
  assert.strictEqual(r.on, false); assert.strictEqual(r.state, 'done'); assert.strictEqual(r.by, 'Josh');
  r = T.bidReview([a, T.bidReviewNote('cancel', 'Ken', TD, 'y')]);
  assert.strictEqual(r.on, false); assert.strictEqual(r.state, 'cancel');
  r = T.bidReview([T.bidReviewNote('done', 'Josh', TD, 'x'), T.bidReviewNote('in', 'Rob', TD, 'z')]);
  assert.strictEqual(r.on, true); assert.strictEqual(r.by, 'Rob');
  assert.strictEqual(T.bidReview([{ kind: 'review', state: 'bogus' }]), null);
});
t('In review filter and plain notes (review entries stay out of the card’s last note and the tracker)', () => {
  const inr = { id: 'a', bid_date: '2026-12-05', bid_notes: [T.bidReviewNote('in', 'Ken', TD, 't')] };
  const done = { id: 'b', bid_date: '2026-12-05', bid_notes: [T.bidReviewNote('in', 'Ken', TD, 't'), T.bidReviewNote('done', 'Josh', TD, 'u')] };
  const none = { id: 'c', bid_date: '2026-12-05' };
  assert.deepStrictEqual([inr, done, none].filter(j => T.bidFilt(j, 'rev', TD)).map(j => j.id), ['a']);
  assert.deepStrictEqual([inr, done, none].filter(j => T.bidFilt(j, 'open', TD)).map(j => j.id), ['a', 'b', 'c']);
  assert.strictEqual(T.bidInRev(inr), true); assert.strictEqual(T.bidInRev(done), false); assert.strictEqual(T.bidInRev(null), false);
  assert.deepStrictEqual(J(T.bidPlainNotes([{ text: 'a' }, T.bidReviewNote('in', 'K', TD, 't'), { text: 'b' }])).map(x => x.text), ['a', 'b']);
});
t('lookahead remove: clears the job from today on, keeps past days and other jobs; undo puts it back', () => {
  const P = { j1: { '2026-11-25': ['Ana'], '2026-11-30': ['Ana', 'Bo'], '2026-12-01': ['Bo'] }, j2: { '2026-11-30': ['Cy'] } };
  const r = T.lookClearJob(P, 'j1', TD);
  assert.deepStrictEqual(J(r.plans), { j1: { '2026-11-25': ['Ana'] }, j2: { '2026-11-30': ['Cy'] } });
  assert.deepStrictEqual(J(r.gone), { '2026-11-30': ['Ana', 'Bo'], '2026-12-01': ['Bo'] });
  assert.deepStrictEqual(J(P.j1['2026-11-30']), ['Ana', 'Bo']);
  assert.deepStrictEqual(J(T.lookRestoreJob(r.plans, 'j1', r.gone)), J(P));
  const all = T.lookClearJob({ j1: { '2026-12-02': ['Ana'] } }, 'j1', TD);
  assert.deepStrictEqual(J(all.plans), {});
  assert.deepStrictEqual(J(T.lookClearJob(P, 'nope', TD).gone), {});
});
t('lookahead rows: removed active job stays off; planned-ahead or re-added job shows; removed job with only past plans stays off', () => {
  const jobs = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }));
  const days = ['2026-11-24', '2026-11-25', '2026-11-30', '2026-12-01'];
  const plans = { b: { '2026-11-30': ['Ana'] }, c: { '2026-11-24': ['Bo'] }, d: { '2026-11-24': ['Cy'] } };
  const active = new Set(['a', 'e']);
  assert.deepStrictEqual(T.lookShownIds(jobs, plans, days, TD, active, [], []), ['a', 'b', 'c', 'd', 'e']);
  assert.deepStrictEqual(T.lookShownIds(jobs, plans, days, TD, active, [], ['a', 'b', 'c']), ['b', 'd', 'e']);
  assert.deepStrictEqual(T.lookShownIds(jobs, plans, days, TD, active, ['a'], ['a']), ['a', 'b', 'c', 'd', 'e']);
});
t('job tabs: office on a job gets Field / Office rows; foreman’s 5 tabs split Field / More; crew and bids keep one row', () => {
  const rows = ids => J(T.jobTabRows(ids));
  assert.deepStrictEqual(rows(['plans', 'progress', 'takeoff', 'log', 'mat', 'money']), [{ l: 'Field', ids: ['plans', 'progress', 'log'] }, { l: 'Office', ids: ['takeoff', 'mat', 'money'] }]);
  assert.deepStrictEqual(rows(['plans', 'progress', 'log', 'labor', 'mat']), [{ l: 'Field', ids: ['plans', 'progress', 'log'] }, { l: 'More', ids: ['labor', 'mat'] }]);
  assert.deepStrictEqual(rows(['plans', 'progress', 'log', 'mat']), [{ l: '', ids: ['plans', 'progress', 'log', 'mat'] }]);
  assert.deepStrictEqual(rows(['plans', 'progress']), [{ l: '', ids: ['plans', 'progress'] }]);
  assert.deepStrictEqual(rows(['plans', 'takeoff']), [{ l: '', ids: ['plans', 'takeoff'] }]);
  assert.deepStrictEqual(rows(['plans', 'progress', 'takeoff', 'money']), [{ l: 'Field', ids: ['plans', 'progress'] }, { l: 'Office', ids: ['takeoff', 'money'] }]);
  assert.deepStrictEqual(rows(['plans', 'bogus', 'progress']), [{ l: '', ids: ['plans', 'progress'] }]);
});
console.log(n + ' office review / lookahead remove / job tab tests passed');
