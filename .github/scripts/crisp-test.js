// Static guards for crisp takeoff marks: marks live in a screen-sized SVG with the pan/zoom transform applied inside it (never a CSS-scaled bitmap).
const fs=require('fs'),path=require('path');
const h=fs.readFileSync(path.join(__dirname,'..','..','index.html'),'utf8');
let bad=0;const ok=(c,m)=>{if(!c){bad++;console.error('FAIL '+m)}else console.log('ok   '+m)};
ok(!/<div id="tkBoard">[^]*?<svg id="tkInk"[^]*?<\/svg><\/div><svg id="tkSel"/.test(h)&&/<div id="tkBoard"><img id="tkImg"[^>]*><\/div><svg id="tkInk"/.test(h),'#tkInk is outside the CSS-scaled #tkBoard');
ok(/#tkInk\{[^}]*width:100%;height:100%/.test(h)&&!/#tkInk\{[^}]*will-change/.test(h),'#tkInk is stage-sized with no will-change');
ok(/getElementById\('tkXf'\)|\$\('#tkXf'\)/.test(h)&&/setAttribute\('transform','translate\('/.test(h),'zoom transform set on #tkXf inside the svg');
ok(!/\$\('#tkInk'\)\.setAttribute\('viewBox'/.test(h),'no viewBox scaling of the marks layer');
ok(/edge:vpick\(o\.edge,\['none','dark'\],'none'\)/.test(h)&&/label:'Mark edge'/.test(h),'Mark edge setting (none/dark, default none)');
process.exit(bad?1:0);
