(function () {
  'use strict';
  var origin = location.origin;
  var code = "javascript:(function(){location.href='" + origin + "/?url='+encodeURIComponent(location.href)})()";
  var link = document.querySelector('[data-bookmarklet]');
  var area = document.querySelector('[data-bookmarklet-code]');
  if (link) {
    link.setAttribute('href', code);
    link.addEventListener('click', function (e) {
      e.preventDefault();
      if (window.App) window.App.toast('Drag the button to your bookmarks bar.', null, null, 3500);
    });
  }
  if (area) {
    area.value = code;
    area.addEventListener('focus', function () { area.select(); });
  }

  var installBtn = document.querySelector('[data-install-pwa]');
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    if (installBtn) installBtn.hidden = false;
  });
  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function () { deferred = null; installBtn.hidden = true; });
    });
  }
})();
