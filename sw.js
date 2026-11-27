/* Alpha Crew View service worker: lets the app open with no signal. */
const CACHE='acv-v3';
const APP='./';
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll([APP,'manifest.webmanifest','icon-192.png','icon-512.png','icon-maskable-512.png','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js'])).catch(()=>{}));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
function withTimeout(p,ms){return new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('timeout')),ms);p.then(v=>{clearTimeout(t);res(v)},e=>{clearTimeout(t);rej(e)})})}
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url);
  const base=new URL(APP,self.location).pathname;
  const isApp=u.origin===self.location.origin&&(u.pathname===base||u.pathname===base+'index.html');
  if(isApp){
    e.respondWith(withTimeout(fetch(r.url,{cache:'no-cache',credentials:'same-origin'}),8000).then(res=>{
      if(res&&res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(APP,cp))}
      return res;
    }).catch(()=>caches.open(CACHE).then(c=>c.match(APP)).then(m=>m||Response.error())));
    return;
  }
  if(/^(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|tessdata\.projectnaptha\.com)$/.test(u.hostname)){
    e.respondWith(caches.open(CACHE).then(c=>c.match(r).then(m=>m||fetch(r).then(res=>{if(res&&res.ok)c.put(r,res.clone());return res}))));
  }
});
