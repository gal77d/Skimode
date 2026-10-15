// install.js — מאפשר להוסיף את המשחק למסך הבית כמו אפליקציה.
// באנדרואיד: כפתור שפותח את חלון ההתקנה של הדפדפן.
// באייפון: כפתור שמראה איך עושים את זה (שיתוף ← "הוסף למסך הבית").
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(function () {});
    });
  }

  var standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) ||
    window.navigator.standalone === true;
  var btn = document.getElementById('installBtn');
  var help = document.getElementById('iosHelp');
  if (!btn || standalone) return;

  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var deferred = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  window.addEventListener('appinstalled', function () {
    btn.hidden = true;
  });

  if (isIOS) btn.hidden = false;

  btn.addEventListener('click', function () {
    if (deferred) {
      deferred.prompt();
      deferred.userChoice.finally(function () {
        deferred = null;
        btn.hidden = true;
      });
    } else if (help) {
      help.hidden = !help.hidden;
    }
  });
})();
