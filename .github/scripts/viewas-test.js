// Tests for "view as a person" (read-only) and practice mode. Pulls the request gate (offlineFetch and helpers) out of index.html and runs it with stubs.
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
const names = ['OFF', 'OFF_TABLES', 'OFF_DEFAULTS', 'PRACTICE_ID', 'PR', 'PR_TABLES', 'RO_RPC', 'isPractice', 'roView', 'roMsg', 'roKind', 'roDeny',
  'prLoad', 'prSave', 'prPush', 'prFile', 'myOps', 'PG_KEYS', 'urlFilters', 'rowHit', 'jsonRes', 'applyOps', 'sortRows', 'overlay', 'offlineFetch',
  'num', 'r2', 'tcKey', 'TC_ANCHOR', 'isoAddD', 'tcPeriodOf', 'tcJobNo', 'tcJobShort', 'tcHrs', 'tcDayIdx', 'tcLineNo', 'tcJobKey', 'tcIsJob', 'tcLabCode', 'tcJobDay'];
const code = names.map(grab).join('\n') + '\n;({' + names.filter(n => n !== 'TC_ANCHOR').join(',') + '})';

const calls = { net: [], fetch: [], toasts: [], ls: {} };
const S = { me: { id: '11111111-1111-4111-8111-111111111111' }, asUser: null, urls: {} };
const ctx = {
  S, Math, Date, String, Number, Set, Object, Array, JSON, isFinite, parseFloat, Promise, URL, Headers, Response, FormData, Blob, decodeURIComponent,
  navigator: { onLine: true }, setTimeout: () => 0, console,
  toast: m => calls.toasts.push(m), debounce: () => {}, roResync: () => {}, netPill: () => {}, noteOnline: () => {}, flushOutbox: () => {},
  lsGet: k => (k in calls.ls ? calls.ls[k] : null), lsSet: (k, v) => { if (v == null) delete calls.ls[k]; else calls.ls[k] = v; },
  idbPut: async () => 1, idbGet: async () => undefined, idbDel: async () => true, idbAll: async () => [],
  uuid: (() => { let n = 0; return () => 'aaaaaaaa-0000-4000-8000-' + String(++n).padStart(12, '0'); })(),
  jwtSub: () => 'anon',
  netFetch: async (url, init) => { calls.net.push([init.method || 'GET', url]); return new Response(ctx._body || '[]', { status: 200, headers: { 'content-type': 'application/json' } }); },
  fetch: async (input, init) => { calls.fetch.push([(init && init.method) || 'GET', typeof input === 'string' ? input : input.url]); return new Response('{}', { status: 200 }); },
};
const T = vm.runInNewContext(code, ctx);
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok - ' + name); };
const B = 'https://x.supabase.co';
const req = (path, method, body, headers) => T.offlineFetch(B + path, { method: method || 'GET', body, headers: headers || {} });
const reset = () => { calls.net = []; calls.fetch = []; calls.toasts = []; };
const PERSON = { id: '22222222-2222-4222-8222-222222222222', name: 'Mike Lopez', role: 'foreman', practice: false };

(async () => {
  await t('gate: which requests count as reads', () => {
    S.asUser = PERSON;
    const k = (p, m) => T.roKind(new URL(B + p), m);
    assert.strictEqual(k('/rest/v1/timecards?owner=eq.x', 'GET'), 'read');
    assert.strictEqual(k('/rest/v1/rpc/office_names', 'POST'), 'read');
    assert.strictEqual(k('/rest/v1/rpc/foreman_accounts', 'POST'), 'read');
    assert.strictEqual(k('/storage/v1/object/sign/files', 'POST'), 'read');
    assert.strictEqual(k('/storage/v1/object/list/files', 'POST'), 'read');
    assert.strictEqual(k('/auth/v1/token', 'POST'), 'read');
    assert.strictEqual(k('/auth/v1/user', 'GET'), 'read');
    for (const [p, m] of [['/rest/v1/marks', 'POST'], ['/rest/v1/logs', 'PATCH'], ['/rest/v1/pins', 'DELETE'], ['/rest/v1/timecards', 'POST'], ['/rest/v1/crew_roster', 'POST'],
      ['/rest/v1/rpc/add_foreman', 'POST'], ['/rest/v1/rpc/set_area_pct', 'POST'], ['/rest/v1/rpc/claim_office', 'POST'], ['/storage/v1/object/files/j/photos/a.jpg', 'POST'],
      ['/storage/v1/object/files', 'DELETE'], ['/functions/v1/crew-sync', 'POST'], ['/functions/v1/crew-sync', 'GET'], ['/auth/v1/user', 'PUT'], ['/auth/v1/logout', 'POST']])
      assert.strictEqual(k(p, m), 'block', m + ' ' + p);
    S.asUser = { id: T.PRACTICE_ID, name: 'Test Foreman', role: 'foreman', practice: true };
    assert.strictEqual(k('/rest/v1/marks', 'POST'), 'practice');
    assert.strictEqual(k('/rest/v1/timecards', 'PATCH'), 'practice');
    assert.strictEqual(k('/rest/v1/rpc/set_area_pct', 'POST'), 'practice');
    assert.strictEqual(k('/storage/v1/object/files/j/reports/a.pdf', 'POST'), 'practice');
    assert.strictEqual(k('/rest/v1/members', 'PATCH'), 'block');
    assert.strictEqual(k('/rest/v1/sheets', 'POST'), 'block');
    assert.strictEqual(k('/functions/v1/crew-sync', 'POST'), 'block');
    assert.strictEqual(k('/storage/v1/object/files/u/timecards/a.pdf', 'POST'), 'block');
    S.asUser = null;
  });

  await t('normal office use: writes go through', async () => {
    reset(); S.asUser = null; T.OFF.ops.length = 0;
    const r = await req('/rest/v1/marks', 'POST', JSON.stringify({ job_id: 'j', sheet_id: 's' }), { 'content-type': 'application/json' });
    assert.ok(r.ok);
    assert.strictEqual(T.OFF.ops.length, 1, 'queued for the database');
    await req('/functions/v1/crew-sync', 'POST', '{"action":"timecards"}');
    await req('/rest/v1/members?id=eq.1', 'PATCH', '{"name":"x"}');
    assert.strictEqual(calls.fetch.length, 2, 'function call and members update sent');
    assert.strictEqual(calls.toasts.length, 0);
    T.OFF.ops.length = 0;
  });

  await t('view as a person: every write is refused, reads still work', async () => {
    reset(); S.asUser = PERSON; S.me = { id: PERSON.id };
    const blocked = [['/rest/v1/marks', 'POST', '{"job_id":"j"}'], ['/rest/v1/logs?on_conflict=job_id,user_id,date', 'POST', '{"job_id":"j"}'], ['/rest/v1/timecards?id=eq.1', 'PATCH', '{}'],
      ['/rest/v1/pins?id=eq.1', 'DELETE'], ['/rest/v1/crew_roster', 'POST', '{"name":"A"}'], ['/rest/v1/rpc/set_progress_sheets', 'POST', '{}'],
      ['/storage/v1/object/files/j/photos/a.jpg', 'POST', 'x'], ['/storage/v1/object/files', 'DELETE', '{}'], ['/functions/v1/crew-sync', 'POST', '{"action":"labor"}'], ['/auth/v1/user', 'PUT', '{}']];
    for (const [p, m, b] of blocked) {
      const r = await req(p, m, b);
      assert.strictEqual(r.status, 400, p);
      const j = await r.json();
      assert.strictEqual(j.message, 'Viewing as Mike Lopez — read-only.');
    }
    assert.strictEqual(calls.fetch.length + calls.net.length, 0, 'nothing reached the server');
    assert.strictEqual(T.OFF.ops.length, 0, 'nothing queued for later either');
    assert.strictEqual(calls.toasts.length, blocked.length);
    assert.ok(calls.toasts.every(m => m === 'Viewing as Mike Lopez — read-only.'));
    const g = await req('/rest/v1/timecards?select=*&owner=eq.' + PERSON.id, 'GET');
    assert.ok(g.ok); assert.strictEqual(calls.net.length, 1, 'read sent');
    await req('/storage/v1/object/sign/files', 'POST', '{"paths":["a"]}');
    assert.strictEqual(calls.fetch.length, 1, 'signed photo links still load');
    S.asUser = null;
  });

  await t('practice: time card fills the daily report; nothing reaches the server', async () => {
    reset(); T.PR.ops.length = 0; T.PR.files.length = 0;
    S.asUser = { id: T.PRACTICE_ID, name: 'Test Foreman', role: 'foreman', practice: true }; S.me = { id: T.PRACTICE_ID };
    const P = '2026-11-25', job = { name: '330-U OF U OR5 HYBRID ROOM UPGRADE' };
    const card = { id: 'cccccccc-0000-4000-8000-000000000001', period_start: P, foreman: 'Test Foreman', folder: 'Test', workers: [
      { name: 'Test Foreman', days: { 0: [{ kind: 'job', job: '330', name: 'U OF U', code: '142', hrs: '8' }] } },
      { name: 'Sample Framer', days: { 0: [{ kind: 'job', job: '330', name: 'U OF U', code: '112', hrs: '10' }] } },
      { name: 'Sample Hanger', days: {} }] };
    let r = await req('/rest/v1/timecards', 'POST', JSON.stringify(card), { 'content-type': 'application/json' });
    assert.ok(r.ok);
    card.workers[2].days = { 0: [{ kind: 'job', job: '330', name: 'U OF U', code: '122', hrs: '6' }] };
    await req('/rest/v1/timecards?id=eq.' + card.id, 'PATCH', JSON.stringify({ workers: card.workers }));
    await req('/rest/v1/timecards?id=eq.' + card.id, 'PATCH', JSON.stringify({ foreman: 'Test Foreman', workers: card.workers }));
    assert.strictEqual(T.PR.ops.length, 2, 'insert + one merged update');
    assert.ok(calls.ls['acv.practice'], 'kept in this browser');
    r = await req('/rest/v1/timecards?select=*&owner=eq.' + T.PRACTICE_ID + '&period_start=eq.' + P, 'GET');
    const got = await r.json();
    assert.strictEqual(got.length, 1);
    assert.strictEqual(got[0].owner, T.PRACTICE_ID);
    const K = T.tcJobKey(job);
    const x = T.tcJobDay(got, P, K[0], K[1]);
    assert.strictEqual(x.hours, 24);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(x.by)), { '142s': 8, '112': 10, '122': 6 });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(x.trades)), { Foreman: 1, Framer: 1, Drywall: 1 });
    // report saves (upsert), then shows in the list, then can be edited and deleted
    const log = { job_id: 'j1', user_id: T.PRACTICE_ID, date: P, hours: x.hours, hours_by_code: x.by, workforce: x.trades, work: 'Framed corridor' };
    const up = { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates' };
    await req('/rest/v1/logs?on_conflict=job_id,user_id,date', 'POST', JSON.stringify(log), up);
    await req('/rest/v1/logs?on_conflict=job_id,user_id,date', 'POST', JSON.stringify(Object.assign({}, log, { work: 'Framed corridor and 201' })), up);
    await req('/storage/v1/object/files/j1/reports/r.pdf', 'POST', new Blob(['pdf']));
    assert.strictEqual(JSON.stringify(T.PR.files), '["j1/reports/r.pdf"]');
    r = await req('/rest/v1/logs?select=*&job_id=eq.j1&order=date.desc', 'GET');
    let logs = await r.json();
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].work, 'Framed corridor and 201');
    assert.strictEqual(logs[0].hours, 24);
    assert.ok(String(logs[0].id).startsWith('local-'));
    await req('/rest/v1/logs?id=eq.' + logs[0].id, 'DELETE');
    logs = await (await req('/rest/v1/logs?select=*&job_id=eq.j1', 'GET')).json();
    assert.strictEqual(logs.length, 0);
    // progress marks stay local
    await req('/rest/v1/marks', 'POST', JSON.stringify({ id: 'm1', job_id: 'j1', sheet_id: 's1', layer: 'progress', phase: 'framing', pts: [0, 0, 1, 1] }), { 'content-type': 'application/json' });
    const mk = await (await req('/rest/v1/marks?select=*&sheet_id=eq.s1&layer=eq.progress', 'GET')).json();
    assert.strictEqual(mk.length, 1);
    // server-only features say so
    r = await req('/functions/v1/crew-sync', 'POST', '{"action":"timecards"}');
    assert.strictEqual((await r.json()).message, 'Not available in practice mode.');
    r = await req('/rest/v1/members?id=eq.1', 'PATCH', '{}');
    assert.strictEqual(r.status, 400);
    assert.strictEqual(calls.fetch.length, 0, 'no write reached the server');
    assert.ok(calls.net.every(([m]) => m === 'GET'), 'only reads reached the server');
    assert.strictEqual(T.OFF.ops.length, 0, 'nothing in the real upload queue');
  });

  await t('practice data does not show outside practice mode', async () => {
    S.asUser = null; S.me = { id: '11111111-1111-4111-8111-111111111111' };
    const got = await (await req('/rest/v1/timecards?select=*&period_start=eq.2026-11-25', 'GET')).json();
    assert.strictEqual(got.length, 0);
  });

  console.log(n + ' tests passed');
})().catch(e => { console.error(e); process.exit(1); });
