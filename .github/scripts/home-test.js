// Tests for the Home button: every job screen has it, and goHome finishes the drawing, flushes takeoff ops, then leaves the job for the office homepage.
const fs = require('fs');
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
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok - ' + name); };

function world(over) {
  const log = [];
  const ctx = Object.assign({
    log, S: { view: 'job', tab: 'takeoff', job: { id: 'j' }, role: 'admin', fromDash: true, chan: {} }, V: null, TK: null, TKV: null,
    sb: { removeChannel: () => log.push('removeChannel') }, homeTabs: () => true, dashOk: () => true, toast: m => log.push('toast:' + m),
    lsGet: () => 'tc', lsSet: (k, v) => log.push('ls:' + k + '=' + v), render: () => log.push('render'), closeSheet: () => log.push('closeSheet'),
    window: { scrollTo() {} }, setTimeout, clearTimeout, Promise,
    tkvFinish: async () => { log.push('finish'); ctx.TKV.draft = []; },
    tkClose: x => { log.push('tkClose:' + x); ctx.TKV = null; },
    tkFlush: async T => { log.push('flush'); T.ops.splice(0); },
  }, over);
  vm.runInNewContext(['homeLand', 'closeJob', 'goHome'].map(grab).join('\n') + '\n;globalThis.__f={goHome,closeJob,homeLand}', Object.assign(ctx, { globalThis: ctx }));
  ctx.f = ctx.__f; return ctx;
}

(async () => {
  await t('every job screen has a Home button wired to goHome', () => {
    assert(/id="jhome"[^>]*>/.test(html) && html.includes("$('#jhome').onclick=goHome"), 'job header');
    assert(html.includes('id="tkHomeB"') && html.includes("$('#tkHomeB').onclick=goHome"), 'Takeoff viewer bar');
    assert(html.includes('id="tkHome"') && /\$\('#tkHome',m\)\.onclick=\(\)=>\{tkMenuClose\(\);goHome\(\)\}/.test(html), 'Takeoff menu');
    assert(html.includes('id="vHome"') && html.includes('goHome()}'), 'plans viewer');
  });
  await t('homeLand: only Jobs and Bids are homepages', () => {
    const c = world();
    assert(c.f.homeLand('jobs') && c.f.homeLand('bids'));
    ['tc', 'look', 'dash', null, ''].forEach(s => assert(!c.f.homeLand(s), String(s)));
  });
  await t('goHome from the Takeoff viewer: finishes the drawing, flushes pending ops, then leaves to the jobs page (not the dashboard)', async () => {
    const T = { ops: [1, 2], saving: false, fail: 0, t: 0 };
    const c = world({ TK: T, TKV: { mode: 'draw', draft: [{}, {}] } });
    await c.f.goHome();
    assert.deepStrictEqual(c.log.filter(x => !/^ls:/.test(x)), ['finish', 'tkClose:true', 'flush', 'removeChannel', 'render']);
    assert.strictEqual(T.ops.length, 0);
    assert.strictEqual(c.S.view, 'jobs'); assert.strictEqual(c.S.job, null); assert.strictEqual(c.S.fromDash, false);
    assert(c.log.includes('ls:crewplans.homeSec=jobs'), 'a stale Time cards/Dashboard section falls back to Jobs');
  });
  await t('goHome waits for a save already in flight and gives up (with a note) when the network is down', async () => {
    const T = { ops: [1], saving: true, fail: 0, t: 0 };
    const c = world({ TK: T, TKV: null });
    setTimeout(() => { T.saving = false; T.ops.splice(0) }, 200);
    await c.f.goHome(); assert.strictEqual(c.S.view, 'jobs');
    const T2 = { ops: [1], saving: false, fail: 0, t: 0 };
    const c2 = world({ TK: T2, tkFlush: async T => { T.fail = 1 } });
    await c2.f.goHome(); assert(c2.log.some(x => x.startsWith('toast:Takeoff not saved yet')), 'warns'); assert.strictEqual(c2.S.view, 'jobs'); assert.strictEqual(T2.ops.length, 1, 'ops kept for the background retry');
  });
  await t('goHome from a plain job tab closes the plans viewer and does not double-run', async () => {
    const T = { ops: [1], saving: true, fail: 0, t: 0 }; setTimeout(() => { T.saving = false; T.ops.splice(0) }, 200);
    const c = world({ V: {}, TK: T, S: { view: 'job', tab: 'plans', job: { id: 'j' }, chan: null, fromDash: false } });
    const a = c.f.goHome(), b = c.f.goHome(); await Promise.all([a, b]);
    assert.strictEqual(c.log.filter(x => x === 'render').length, 1);
    assert(c.log.includes('closeSheet'));
  });
  console.log(n + ' tests passed');
})().catch(e => { console.error(e); process.exit(1); });
