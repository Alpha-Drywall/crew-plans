// Fails if the app's JavaScript has a syntax error that would stop it from loading.
const fs = require('fs');
const { execFileSync } = require('child_process');
const html = fs.readFileSync('index.html', 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, bad = 0;
while ((m = re.exec(html))) {
  const f = `/tmp/inline-${i++}.js`;
  fs.writeFileSync(f, m[1]);
  try { execFileSync('node', ['--check', f], { stdio: 'pipe' }); }
  catch (e) { bad++; console.error(`Syntax error in index.html <script> #${i}:\n` + e.stderr.toString()); }
}
for (const f of ['sw.js']) {
  if (!fs.existsSync(f)) continue;
  try { execFileSync('node', ['--check', f], { stdio: 'pipe' }); }
  catch (e) { bad++; console.error(`Syntax error in ${f}:\n` + e.stderr.toString()); }
}
if (!i) { console.error('No inline <script> found in index.html'); process.exit(1); }
if (bad) process.exit(1);
console.log(`OK: ${i} inline script(s) and sw.js passed the syntax check.`);
