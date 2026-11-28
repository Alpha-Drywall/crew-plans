// Tests for the tips (short pointers on real buttons): every step is [selector, English, Spanish], and every tipsFor('key') has tips.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const src = (fs.readFileSync('index.html', 'utf8').match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1];
const lines = src.split('\n');
const i = lines.findIndex(l => l.startsWith('const TIPS={'));
if (i < 0) throw new Error('const TIPS not found in index.html');
const j = lines.findIndex((l, k) => k > i && l === '};');
const TIPS = vm.runInNewContext(lines.slice(i, j + 1).join('\n').replace(/^const TIPS=/, '(').replace(/;$/, ')'));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok - ' + name); };

t('every step has a selector, English and Spanish', () => {
  Object.keys(TIPS).forEach(k => {
    assert(Array.isArray(TIPS[k]) && TIPS[k].length, k + ': no steps');
    TIPS[k].forEach((s, x) => {
      const at = k + '[' + x + ']';
      assert.strictEqual(s.length, 3, at + ': needs [selector, English, Spanish]');
      s.forEach(v => assert(typeof v === 'string' && v.trim(), at + ': empty string'));
      assert.notStrictEqual(s[1], s[2], at + ': Spanish is the same as English');
      const sel = s[0];
      assert.strictEqual((sel.match(/\[/g) || []).length, (sel.match(/\]/g) || []).length, at + ': unbalanced [] in ' + sel);
      assert.strictEqual((sel.match(/\(/g) || []).length, (sel.match(/\)/g) || []).length, at + ': unbalanced () in ' + sel);
      assert.strictEqual((sel.match(/"/g) || []).length % 2, 0, at + ': unbalanced quotes in ' + sel);
    });
  });
});

t('no selector repeats within a key', () => {
  Object.keys(TIPS).forEach(k => {
    const sels = TIPS[k].map(s => s[0]);
    assert.strictEqual(new Set(sels).size, sels.length, k + ': repeated selector');
  });
});

t('every tipsFor(\'key\') in the app has tips', () => {
  const used = new Set();
  src.replace(/tipsFor\('([A-Za-z]+)'\)/g, (m, k) => used.add(k));
  used.forEach(k => assert(TIPS[k], 'tipsFor(\'' + k + '\') has no TIPS entry'));
  const rest = lines.slice(0, i).concat(lines.slice(j + 1)).join('\n');
  ['takeoff', 'takeoffLayout', 'bids', 'lookahead', 'lookaheadJobs'].forEach(k => assert(rest.includes("'" + k + "'"), k + ' is never shown'));
});

t('new screens have their tips', () => {
  const has = (k, sel) => assert(TIPS[k].some(s => s[0] === sel), k + ' missing ' + sel);
  ['#tkExitB', '#tkBack', '#tkQ', '#tkSide [data-rec]', '#tkSide [data-col]', '#tkSide [data-eye]', '#tkXAll', '#tkPop', '#tkScBan', '#tkViewB', '#tkStage'].forEach(s => has('takeoff', s));
  ['#tkLay', '#tkStage'].forEach(s => has('takeoffLayout', s));
  ['[data-bview="mine"]', '.bests', '.bwk', '#bidList .bsh', '[data-bfilt="rev"]', '#bidList [data-bm]', '#bidSelBtn', '[data-bpane="pipe"]'].forEach(s => has('bids', s));
  has('lookaheadJobs', '#lkGrid [data-rmx]');
  has('job', '.tabs2 .tg:first-child');
});

console.log(n + ' tests passed');
