/* Service worker для офлайн-режима.
   Кэшируем ТОЛЬКО сам сайт (HTML/manifest) — карта, курс валют и ИИ-чат
   всегда ходят в сеть напрямую и сами решают, что делать без интернета. */

var CACHE_NAME = "cn-hk-trip-v1";
var APP_SHELL = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(APP_SHELL).catch(function(){ /* один из файлов недоступен — не блокируем установку */ });
    })
  );
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE_NAME; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

function isAppShellRequest(url){
  if(url.origin !== self.location.origin) return false;
  if(url.pathname.indexOf("/api/") === 0) return false;
  return true;
}

self.addEventListener("fetch", function(event){
  var req = event.request;
  if(req.method !== "GET") return; // не трогаем POST к /api/ai и т.п.

  var url = new URL(req.url);
  if(!isAppShellRequest(url)) return; // карта/курс/ИИ/внешние ресурсы — напрямую в сеть

  // Сам сайт: сначала кэш (мгновенная загрузка офлайн), в фоне тихо обновляем кэш из сети.
  event.respondWith(
    caches.match(req).then(function(cached){
      var network = fetch(req).then(function(resp){
        if(resp && resp.ok){
          var copy = resp.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); });
        }
        return resp;
      }).catch(function(){ return cached; });
      return cached || network;
    })
  );
});
