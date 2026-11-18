const shell='kapron-shell-BUILD_REVISION';
const assets=['/','/app.js','/app.css','/icon.svg','/icon-192.png','/icon-512.png','/manifest.webmanifest',...BUILD_CHUNKS];
self.addEventListener('install',event=>event.waitUntil(caches.open(shell).then(cache=>cache.addAll(assets))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(x=>x.startsWith('kapron-shell-')&&x!==shell).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||!assets.includes(url.pathname))return;
 event.respondWith(fetch(request).catch(()=>caches.match(request).then(x=>x||new Response('Offline',{status:503}))));
});
