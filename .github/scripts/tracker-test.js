// Tests for the bid tracker: reading "Alpha Bidding Tracker 2026.xlsx" month tabs (status cleanup, GC column split, follow-ups,
// duplicates, matching app bids), the Pipeline numbers and the one-way Excel export.
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
const names = ['num', 'BID_ST', 'bidStLabel', 'isoD', 'dayDiff', 'MON3', 'BID_NOWORD_DAYS', 'bidNoWord', 'bidLost', 'bidRes', 'bidStat', 'bidFilt', 'bidGcs', 'pipeIn', 'bidYear',
  'TRK_TABS', 'trkMon', 'trkText', 'trkDate', 'trkAmt', 'trkStatus', 'trkKey', 'gcKey', 'trkEst', 'TRK_FU', 'TRK_RES', 'TRK_CTX', 'trkSplit',
  'trkParseSheet', 'trkParseBook', 'trkRow', 'trkPatch', 'trkNameNorm', 'trkNameMatch', 'trkPlan', 'pipeCalc', 'niceMax', 'TRK_AW', 'trkGcText', 'trkExportTabs'];
const T = vm.runInNewContext(names.map(grab).join('\n') + '\n;({' + names.join(',') + '})', { Math, Date, String, Number, Set, Object, Array, JSON, RegExp });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };
const plain = x => JSON.parse(JSON.stringify(x));
const TD = '2026-11-26';
const office = [{ id: 'o1', name: 'Ken' }, { id: 'o2', name: 'Rob' }, { id: 'o3', name: 'Josh' }];
const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

t('month tab names: JAN..DEC incl. APRIL / JUNE / SEPT; other tabs are ignored', () => {
  assert.deepStrictEqual(['JAN', 'FEB', 'MAR', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUG', 'SEPT', 'OCT', 'NOV', 'DEC'].map(T.trkMon), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepStrictEqual(['AWARDED', 'BID SUMMARY', 'OPEN TO BID', 'GC Contacts', 'MA'].map(T.trkMon), [-1, -1, -1, -1, -1]);
  assert.strictEqual(T.trkMon('Oct 2026'), 9);
});

t('status cleanup: YAYESS/YES/Y/AWARDED -> won, NOPE/NO/N/LOST -> lost, REVIEWED/blank/Maybe -> submitted or open by date', () => {
  const s = (r, d) => T.trkStatus(r, d || '2026-10-01', TD);
  assert.deepStrictEqual(['YAYESS', 'yayess', 'Yes!', 'Y', 'AWARDED', 'won'].map(r => s(r)), Array(6).fill('won'));
  assert.deepStrictEqual(['NOPE', 'No', 'N', 'LOST', 'no - went with another sub'].map(r => s(r)), Array(5).fill('lost'));
  assert.deepStrictEqual(['NO BID', 'No bid'].map(r => s(r)), ['nobid', 'nobid']);
  assert.deepStrictEqual(['REVIEWED', '', 'Maybe', '?', 'still a chance', 'N/A', 'NOT YET'].map(r => s(r)), Array(7).fill('submitted'));
  assert.strictEqual(s('REVIEWED', '2026-12-10'), 'open');
  assert.strictEqual(s('', '2026-11-26'), 'open');
});

t('cell values: dates (Date, serial, M/D, M/D/YY), amounts (numbers, $ text, typed formulas, formula results), rich text', () => {
  assert.strictEqual(T.trkDate(D(2026, 3, 4), 2026), '2026-03-04');
  assert.strictEqual(T.trkDate(46115, 2026), '2026-04-03');
  assert.strictEqual(T.trkDate('12/3', 2026), '2026-12-03');
  assert.strictEqual(T.trkDate('6/3/2025', 2026), '2025-06-03');
  assert.strictEqual(T.trkDate('6/3/25', 2026), '2025-06-03');
  assert.strictEqual(T.trkDate('ASAP', 2026), null);
  assert.strictEqual(T.trkAmt(124500), 124500);
  assert.strictEqual(T.trkAmt('$1,234.50'), 1234.5);
  assert.strictEqual(T.trkAmt('=15918+4291'), 20209);
  assert.strictEqual(T.trkAmt({ formula: '15918+4291', result: 20209 }), 20209);
  assert.strictEqual(T.trkAmt('See Kens column'), null);
  assert.strictEqual(T.trkText({ richText: [{ text: 'Okland, Layton' }, { text: '  Asked for results on 10/19', font: { color: { argb: 'FFFF0000' } } }] }), 'Okland, Layton Asked for results on 10/19');
});

t('GC column: GC list, red "Asked for results on M/D" -> dated follow-ups, "3rd of 5" / "10% high" -> result, context -> notes', () => {
  let r = T.trkSplit('Okland, Layton, Big-D  Asked for results on 10/19  Asked for results on 11/2', 2026, '2026-10-01');
  assert.deepStrictEqual(plain(r.gcs), ['Okland', 'Layton', 'Big-D']);
  assert.deepStrictEqual(plain(r.notes), [{ at: '2026-10-19', by: 'Tracker', text: 'Asked for results' }, { at: '2026-11-02', by: 'Tracker', text: 'Asked for results' }]);
  assert.strictEqual(r.result, '');
  r = T.trkSplit('Invited by HHI, came in 3 out of five, 10% higher', 2026, '2026-05-01');
  assert.deepStrictEqual(plain(r.gcs), ['HHI']);
  assert.strictEqual(r.result, 'came in 3 out of five; 10% higher');
  assert.strictEqual(r.notes[0].text, 'Invited by HHI');
  r = T.trkSplit('Big D, BIG-D, Jacobsen; Low bid was 220,000; BID DATE EXTENDED', 2026, '2026-05-01');
  assert.deepStrictEqual(plain(r.gcs), ['Big D', 'Jacobsen']);
  assert.strictEqual(r.result, 'Low bid was 220,000');
  assert.deepStrictEqual(plain(r.notes.map(x => x.text)), ['BID DATE EXTENDED']);
  r = T.trkSplit('Layton 3rd of 5, Okland', 2026, '2026-05-01');
  assert.strictEqual(r.result, 'Layton 3rd of 5');
  r = T.trkSplit('Wadman  Asked Wadman for results on 1/5', 2026, '2026-12-10');
  assert.deepStrictEqual(plain(r.notes), [{ at: '2027-01-05', by: 'Tracker', text: 'Asked for results' }]);
  assert.deepStrictEqual(plain(r.gcs), ['Wadman']);
});

// a month tab laid out like the live tracker: header, Josh block, blank, Ken block (with placeholder rows), blank, Rob block, TOTAL
const OCT = [
  ['JOB NAME', 'ESTIMATOR', 'BID DATE', 'BID AMOUNT', 'AWARDED Y/N', "BIDDING GC's"],
  ['Silo Park East', 'Josh/Tony', D(2026, 10, 2), 412000, 'YAYESS', 'Okland, Layton'],
  ['Josh', null, null, null, null, null],
  [],
  ['Big-O Tires', 'Ken', D(2026, 10, 8), { formula: '15918+4291', result: 20209 }, 'NOPE', 'Big D, Wadman  Asked for results on 10/19'],
  ['WEC Veterans Home', null, '10/20', 'See Kens column', 'Maybe', 'Jacobsen, came in 2nd of 4'],
  ['Dalling Hangar Elko', 'Ken', 'ASAP', 88000, 'REVIEWED', 'Invited by HHI'],
  ['Ken', 'Ken', null, null, null, null],
  [],
  ['POSTINOS', 'Rob', D(2026, 12, 1), 150000, '', 'Okland'],
  ['Big-O Tires', 'Ken', D(2026, 10, 8), 20209, 'NOPE', 'Big D'],
  [null, 'Rob', null, null, null, null],
  [],
  ['TOTAL', null, null, { formula: 'SUM(D2:D12)', result: 690209 }, null, null],
];
const AUG = [['JOB NAME', 'ESTIMATOR', 'BID DATE', 'BID AMOUNT', 'AWARDED Y/N', "BIDDING GC's"], ['Big-O Tires', 'Ken', D(2026, 8, 14), 22000, 'NO', 'Big D']];

t('month tab: blocks, estimator carried down a block, placeholders / blanks / TOTAL skipped, flags for bad dates and amounts', () => {
  const r = T.trkParseSheet('OCT', OCT, 2026, TD);
  assert.deepStrictEqual(plain(r.map(x => x.name)), ['Silo Park East', 'Big-O Tires', 'WEC Veterans Home', 'Dalling Hangar Elko', 'POSTINOS', 'Big-O Tires']);
  assert.deepStrictEqual(plain(r.map(x => x.est)), ['Josh/Tony', 'Ken', 'Ken', 'Ken', 'Rob', 'Ken']);
  assert.deepStrictEqual(plain(r.map(x => x.status)), ['won', 'lost', 'submitted', 'submitted', 'open', 'lost']);
  assert.deepStrictEqual(plain(r.map(x => x.amount)), [412000, 20209, null, 88000, 150000, 20209]);
  assert.strictEqual(r[2].bidDate, '2026-10-20');
  assert.strictEqual(r[2].result, 'came in 2nd of 4');
  assert.ok(r[2].flags.some(f => /See Kens column/.test(f)) && r[2].flags.some(f => /Maybe/.test(f)));
  assert.strictEqual(r[3].bidDate, '2026-10-01');
  assert.ok(r[3].flags[0].startsWith('Bid date "ASAP"'));
  assert.deepStrictEqual(plain(r[3].gcs), ['HHI']);
  assert.strictEqual(r[1].row, 5);
  assert.deepStrictEqual(plain(T.trkParseSheet('AWARDED', OCT, 2026, TD)), []);
});

t('workbook: duplicates (same job+date+estimator) and possible re-bids (same job, other month) are flagged', () => {
  const recs = T.trkParseBook([{ name: 'AUG', rows: AUG }, { name: 'OCT', rows: OCT }, { name: 'BID SUMMARY', rows: OCT }], 2026, TD);
  assert.strictEqual(recs.length, 7);
  const bigO = recs.filter(x => x.name === 'Big-O Tires');
  assert.strictEqual(bigO.length, 3);
  assert.ok(bigO[0].flags.some(f => /re-bid/.test(f)) && !bigO[0].dup);
  assert.ok(!bigO[1].dup);
  assert.ok(bigO[2].dup && bigO[2].flags.some(f => /Same job, date and estimator as OCT row 5/.test(f)));
});

t('import plan: estimator by first name, update matching app bid / job by name, skip already imported and duplicates', () => {
  const recs = T.trkParseBook([{ name: 'AUG', rows: AUG }, { name: 'OCT', rows: OCT }], 2026, TD);
  const existing = [
    { id: 'b1', name: 'POSTINOS', stage: 'bid', pm: 'o2', bid_date: '2026-12-01', gc_name: 'Okland' },
    { id: 'j1', name: '328 - Dalling Hangar Elko', stage: 'job', pm: 'o1' },
    { id: 't1', name: 'Big-O Tires', stage: 'bid', pm: 'o1', bid_date: '2026-08-14', bid_source: 'tracker-2026' },
  ];
  const P = T.trkPlan(recs, existing, office, 2026);
  const by = n => P.filter(x => x.r.name === n);
  assert.strictEqual(by('Silo Park East')[0].pm, 'o3');
  assert.strictEqual(by('Silo Park East')[0].action, 'new');
  assert.strictEqual(by('Big-O Tires')[0].action, 'skip');
  assert.strictEqual(by('Big-O Tires')[0].why, 'Already imported');
  assert.strictEqual(by('Big-O Tires')[1].action, 'new');
  assert.strictEqual(by('Big-O Tires')[2].why, 'Duplicate row');
  const post = by('POSTINOS')[0];
  assert.strictEqual(post.action, 'merge');
  assert.deepStrictEqual(plain(post.patch), { bid_amount: 150000, bid_status: 'open', bid_gcs: [{ name: 'Okland' }], bid_source: 'tracker-2026' });
  const dal = by('Dalling Hangar Elko')[0];
  assert.strictEqual(dal.action, 'merge');
  assert.strictEqual(dal.patch.bid_status, 'won');
  assert.strictEqual(dal.match.id, 'j1');
  const row = T.trkRow(by('WEC Veterans Home')[0].r, 'o1', 'tracker-2026');
  assert.deepStrictEqual(plain(row), { name: 'WEC Veterans Home', stage: 'bid', pm: 'o1', bid_date: '2026-10-20', bid_amount: null, bid_status: 'submitted', bid_result: 'came in 2nd of 4', result_date: null, bid_gcs: [{ name: 'Jacobsen' }], bid_notes: [], bid_source: 'tracker-2026', gc_name: 'Jacobsen', bid_folder: 'WEC Veterans Home' });
  const again = T.trkPlan([by('POSTINOS')[0].r], [Object.assign({}, existing[0], post.patch)], office, 2026);
  assert.strictEqual(again[0].action, 'skip');
  assert.strictEqual(again[0].why, 'Already imported');
  const far = T.trkPlan([by('POSTINOS')[0].r], [Object.assign({}, existing[0], { bid_date: '2026-04-01' })], office, 2026)[0];
  assert.strictEqual(far.action, 'new');
  assert.ok(far.flags.some(f => /Same name as POSTINOS \(bid 2026-04-01\) in the app/.test(f)));
  assert.strictEqual(T.trkEst('Josh/Tony', office), 'o3');
  assert.strictEqual(T.trkEst('Tony', office), null);
});

t('bid list filters: Open = due today or later or still waiting; Results = won / lost / no bid', () => {
  const b = (o) => Object.assign({ stage: 'bid' }, o);
  const list = [b({ id: 1, bid_date: '2026-12-01' }), b({ id: 2, bid_date: '2026-10-01' }), b({ id: 3, bid_date: '2026-10-01', bid_status: 'lost' }), b({ id: 4, bid_status: 'won', bid_date: '2026-12-05' }), b({ id: 5, bid_status: 'nobid' })];
  assert.deepStrictEqual(list.filter(j => T.bidFilt(j, 'open', TD)).map(j => j.id), [1, 2, 4]);
  assert.deepStrictEqual(list.filter(j => T.bidFilt(j, 'res', TD)).map(j => j.id), [3, 4, 5]);
  assert.deepStrictEqual(list.map(j => T.bidStat(j, TD)), ['open', 'submitted', 'lost', 'won', 'nobid']);
  assert.deepStrictEqual(plain(T.bidGcs({ gc_name: 'Okland', gc_email: 'a@o.com' })), [{ name: 'Okland', email: 'a@o.com' }]);
  assert.deepStrictEqual(plain(T.bidGcs({ gc_name: 'Okland, Layton' })).map(g => g.name), ['Okland', 'Layton']);
});

t('pipeline: counts, $ bid, win rate = won / (won + lost), $ won, by month and estimator, GCs merged by spelling, re-bids count once', () => {
  const all = [
    { id: 'a', stage: 'bid', pm: 'o1', bid_date: '2026-03-04', bid_amount: 100000, bid_status: 'lost', bid_gcs: [{ name: 'Big D' }, { name: 'Okland' }] },
    { id: 'b', stage: 'bid', pm: 'o1', bid_date: '2026-03-20', bid_amount: 50000, bid_gcs: [{ name: 'BIG-D' }] },
    { id: 'c', stage: 'job', pm: 'o2', bid_date: '2026-05-01', bid_amount: 200000, bid_status: 'won', bid_gcs: [{ name: 'Big-D Construction' }] },
    { id: 'd', stage: 'bid', pm: 'o3', bid_date: '2026-12-10', bid_amount: 30000, revision_of: 'e' },
    { id: 'e', stage: 'bid', pm: 'o3', bid_date: '2026-11-01', bid_amount: 45000 },
    { id: 'f', stage: 'job', name: 'old job with no bid info' },
    { id: 'g', stage: 'bid', pm: null, bid_date: '2025-06-01', bid_amount: 9 },
  ];
  const P = T.pipeCalc(all, 2026, TD, office);
  assert.strictEqual(P.n, 4);
  assert.strictEqual(P.total, 380000);
  // b (Mar 20, no result) is past 90 days with no answer -> Lost (no word); e (Nov 1) is still waiting
  assert.strictEqual(P.won, 1); assert.strictEqual(P.lost, 2); assert.strictEqual(P.noword, 1); assert.strictEqual(P.unk, 0); assert.strictEqual(P.open, 1);
  assert.strictEqual(P.rate, 1 / 3);
  assert.strictEqual(P.wonAmt, 200000);
  assert.strictEqual(P.avg, 95000);
  assert.deepStrictEqual(plain(P.months[2]), { n: 2, total: 150000, by: { Ken: 150000 } });
  assert.deepStrictEqual(plain(P.names), ['Josh', 'Ken', 'Rob']);
  assert.deepStrictEqual(plain(P.estList.map(e => [e.name, e.n, e.won, e.lost, e.rate])), [['Josh', 1, 0, 0, null], ['Ken', 2, 0, 2, 0], ['Rob', 1, 1, 0, 1]]);
  assert.deepStrictEqual(plain(P.gcList[0]), { name: 'Big D', n: 3, amt: 350000, won: 1, lost: 2, rate: 1 / 3 });
  assert.deepStrictEqual(plain(T.niceMax(8390000)), { max: 10000000, step: 2500000 });
});

t('export: month tabs by bid date, one block per estimator (A-Z), tracker words in AWARDED Y/N, GCs + result + follow-ups', () => {
  const all = [
    { id: 'a', name: 'Riverton Clinic', stage: 'bid', pm: 'o2', bid_date: '2026-10-08', bid_amount: 75000, bid_status: 'lost', bid_result: '10% high', bid_gcs: [{ name: 'Layton' }], bid_notes: [{ at: '2026-10-19', text: 'Asked for results' }] },
    { id: 'b', name: 'Big-O Tires', stage: 'bid', pm: 'o1', bid_date: '2026-10-02', bid_amount: 20209, gc_name: 'Big D' },
    { id: 'c', name: 'Mystery TI', stage: 'bid', created_at: '2026-11-22T10:00:00Z' },
  ];
  const tabs = T.trkExportTabs(all, 2026, TD, office);
  assert.deepStrictEqual(plain(tabs.map(x => x.name)), ['JAN', 'FEB', 'MAR', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUG', 'SEPT', 'OCT', 'NOV', 'DEC', 'NO DATE']);
  assert.deepStrictEqual(plain(tabs[9].blocks), [
    { est: 'Ken', rows: [['Big-O Tires', 'Ken', '2026-10-02', 20209, 'REVIEWED', 'Big D']] },
    { est: 'Rob', rows: [['Riverton Clinic', 'Rob', '2026-10-08', 75000, 'NO', 'Layton  10% high  Asked for results on 10/19']] }]);
  assert.deepStrictEqual(plain(tabs[12].blocks), [{ est: 'No estimator', rows: [['Mystery TI', 'No estimator', '', null, '', '']] }]);
});

t('no answer 90+ days after the bid date counts as Lost (no word); a real status overrides; nothing is saved', () => {
  assert.strictEqual(T.BID_NOWORD_DAYS, 90);
  // pure function: open / submitted -> noword only when the bid date is more than `days` days before td
  assert.strictEqual(T.bidNoWord('submitted', '2026-08-28', TD, 90), 'submitted'); // exactly 90 days
  assert.strictEqual(T.bidNoWord('submitted', '2026-08-27', TD, 90), 'noword');    // 91 days
  assert.strictEqual(T.bidNoWord('open', '2025-12-01', TD, 90), 'noword');
  assert.strictEqual(T.bidNoWord('open', '2026-12-10', TD, 90), 'open');
  assert.strictEqual(T.bidNoWord('submitted', '2026-08-27', TD, 120), 'submitted');
  assert.deepStrictEqual(['won', 'lost', 'nobid', 'rebid'].map(s => T.bidNoWord(s, '2025-01-01', TD, 90)), ['won', 'lost', 'nobid', 'rebid']);
  assert.deepStrictEqual([null, '', 'Oct 2', undefined].map(d => T.bidNoWord('submitted', d, TD, 90)), Array(4).fill('submitted'));
  assert.strictEqual(T.bidNoWord('submitted', '2026-01-05T10:00:00Z', TD, 90), 'noword');
  // bidStat: blank / Open / Submitted saved statuses go to noword; real results and awarded jobs don't
  const old = { stage: 'bid', bid_date: '2026-07-01' };
  assert.strictEqual(T.bidStat(Object.assign({}, old), TD), 'noword');
  assert.strictEqual(T.bidStat(Object.assign({ bid_status: 'open' }, old), TD), 'noword');
  assert.strictEqual(T.bidStat(Object.assign({ bid_status: 'submitted' }, old), TD), 'noword');
  assert.deepStrictEqual(['won', 'lost', 'nobid', 'rebid'].map(s => T.bidStat(Object.assign({ bid_status: s }, old), TD)), ['won', 'lost', 'nobid', 'rebid']);
  assert.strictEqual(T.bidStat({ stage: 'job', bid_date: '2026-01-01' }, TD), 'won');
  assert.strictEqual(T.bidStat({ stage: 'bid', bid_date: '2026-10-01' }, TD), 'submitted');
  assert.strictEqual(T.bidStLabel('noword'), 'Lost (no word)');
  assert.ok(!T.BID_ST.some(x => x[0] === 'noword'), 'noword is derived, never a status you can save');
  assert.ok(T.bidLost('noword') && T.bidLost('lost') && !T.bidLost('submitted'));
  // Results filter lists it, Open doesn't
  assert.strictEqual(T.bidFilt(old, 'res', TD), true);
  assert.strictEqual(T.bidFilt(old, 'open', TD), false);
  assert.strictEqual(T.TRK_AW.noword, 'NO');
  // Pipeline: counts as lost in win rate, estimator win rates and Top GCs
  const all = [
    { id: 'a', stage: 'bid', pm: 'o1', bid_date: '2026-03-02', bid_amount: 50000, bid_gcs: [{ name: 'Okland' }] },
    { id: 'b', stage: 'bid', pm: 'o1', bid_date: '2026-04-02', bid_amount: 60000, bid_status: 'won', bid_gcs: [{ name: 'Okland' }] },
    { id: 'c', stage: 'bid', pm: 'o1', bid_date: '2026-10-20', bid_amount: 70000, bid_status: 'submitted', bid_gcs: [{ name: 'Okland' }] }];
  const P = T.pipeCalc(all, 2026, TD, office);
  assert.deepStrictEqual([P.won, P.lost, P.noword, P.unk, P.rate], [1, 1, 1, 1, 0.5]);
  const K = P.estList.find(e => e.name === 'Ken');
  assert.deepStrictEqual([K.won, K.lost, K.unk, K.rate], [1, 1, 1, 0.5]);
  assert.deepStrictEqual([P.gcList[0].won, P.gcList[0].lost, P.gcList[0].rate], [1, 1, 0.5]);
});

t('didn\'t bid (No bid): out of win rate, $ bid, averages, waiting counts, Top GC $ and the no-word rule', () => {
  const all = [
    { id: 'a', stage: 'bid', pm: 'o1', bid_date: '2026-03-02', bid_amount: 50000, bid_status: 'nobid', bid_gcs: [{ name: 'Okland' }] },
    { id: 'b', stage: 'bid', pm: 'o1', bid_date: '2026-10-02', bid_amount: 80000, bid_status: 'nobid', bid_gcs: [{ name: 'Okland' }] },
    { id: 'c', stage: 'bid', pm: 'o1', bid_date: '2026-04-02', bid_amount: 60000, bid_status: 'won', bid_gcs: [{ name: 'Okland' }] }];
  assert.strictEqual(T.bidStat(all[0], TD), 'nobid');
  const P = T.pipeCalc(all, 2026, TD, office);
  assert.deepStrictEqual([P.n, P.nobid, P.won, P.lost, P.noword, P.unk, P.open, P.rate], [3, 2, 1, 0, 0, 0, 0, 1]);
  assert.deepStrictEqual([P.total, P.priced, P.avg], [60000, 1, 60000]);
  assert.deepStrictEqual([P.months[2].total, P.months[9].total], [0, 0]);
  const K = P.estList.find(e => e.name === 'Ken');
  assert.deepStrictEqual([K.amt, K.won, K.lost, K.unk, K.rate], [60000, 1, 0, 0, 1]);
  assert.deepStrictEqual([P.gcList[0].n, P.gcList[0].amt, P.gcList[0].lost, P.gcList[0].rate], [3, 60000, 0, 1]);
});

t('import match is fuzzy: TownePlace / TownPlace by Marriott is the same bid (dates within 7 days), Hounds Town is not University Town Center', () => {
  assert.strictEqual(T.trkNameNorm('TOWNEPLACE SUITES - IDAHO FALLS'), 'townplace suites idaho falls');
  assert.strictEqual(T.trkNameNorm('TownPlace Suites by Marriott - Idaho Falls'), 'townplace suites idaho falls');
  assert.strictEqual(T.trkNameNorm('331 - The Centre, Inc.'), 'center');
  assert.ok(T.trkNameMatch('TOWNEPLACE SUITES - IDAHO FALLS', 'TownPlace Suites by Marriott - Idaho Falls'));
  assert.ok(!T.trkNameMatch('Hounds Town-Centerville', 'University Town Center Building B'));
  assert.ok(T.trkNameMatch('Logan Public Works', 'Logan Public Works Ph 2'));
  const rec = (name, bidDate, est) => ({ name, bidDate, est, amount: 412000, status: 'submitted', result: '', gcs: ['Okland'], notes: [], flags: [], tab: 'DEC', row: 3 });
  const existing = [
    { id: 'tps', name: 'TOWNEPLACE SUITES - IDAHO FALLS', stage: 'bid', pm: 'o1', bid_date: '2026-12-01' },
    { id: 'ht', name: 'Hounds Town-Centerville', stage: 'bid', pm: 'o1', bid_date: '2026-12-02' }];
  const [a, b, c] = T.trkPlan([rec('TownPlace Suites by Marriott - Idaho Falls', '2026-12-03', 'Ken'), rec('University Town Center Building B', '2026-12-02', 'Ken'), rec('TownPlace Suites by Marriott - Idaho Falls', '2026-12-12', 'Ken')], existing, office, 2026);
  assert.strictEqual(a.action, 'merge');
  assert.strictEqual(a.match.id, 'tps');
  assert.deepStrictEqual(plain(a.patch), { bid_amount: 412000, bid_status: 'submitted', bid_gcs: [{ name: 'Okland' }], gc_name: 'Okland', bid_source: 'tracker-2026' });
  assert.strictEqual(b.action, 'new');
  assert.strictEqual(c.action, 'new', 'same name 11 days later is a re-bid, not the same row');
  // after the update the row carries bid_source, so importing the tracker again skips it
  const again = T.trkPlan([rec('TownPlace Suites by Marriott - Idaho Falls', '2026-12-01', 'Ken')], [Object.assign({}, existing[0], a.patch)], office, 2026)[0];
  assert.strictEqual(again.action, 'skip');
  assert.strictEqual(again.why, 'Already imported');
  // a merged row with another estimator is still "already imported" on the next import (estimator is only a tiebreak)
  const other = T.trkPlan([rec('TownPlace Suites by Marriott - Idaho Falls', '2026-12-01', 'Rob')], [Object.assign({}, existing[0], a.patch)], office, 2026)[0];
  assert.strictEqual(other.why, 'Already imported');
  // more than 7 days apart: no match, flagged as a possible re-bid
  const far = T.trkPlan([rec('TownPlace Suites by Marriott - Idaho Falls', '2026-12-09', 'Ken')], existing, office, 2026)[0];
  assert.strictEqual(far.action, 'new');
  assert.ok(far.flags.some(f => /Same name as TOWNEPLACE SUITES/.test(f)));
  // estimator breaks a tie between two close matches
  const two = [Object.assign({}, existing[0], { id: 'x2', pm: 'o2' }), existing[0]];
  assert.strictEqual(T.trkPlan([rec('TownPlace Suites by Marriott - Idaho Falls', '2026-12-01', 'Ken')], two, office, 2026)[0].match.id, 'tps');
});

console.log(n + ' tracker tests passed');
