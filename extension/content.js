/* global HELPER_CONFIG */
(function () {
  if (window.__dlHelperLoaded) return;
  window.__dlHelperLoaded = true;
  var ext = typeof browser !== 'undefined' ? browser : chrome;

  // Pages that show a single video/post the downloader can handle.
  var PATTERNS = [
    /youtube\.com\/(watch|shorts\/|live\/)/, /tiktok\.com\/@[^/]+\/(video|photo)\//, /instagram\.com\/(p|reel|reels|tv)\//,
    /facebook\.com\/(watch|reel|.+\/videos\/|share\/v\/|share\/r\/)/, /(x|twitter)\.com\/[^/]+\/status\//, /vimeo\.com\/(\d+|.+\/\d+)/,
    /dailymotion\.com\/video\//, /reddit\.com\/r\/[^/]+\/comments\//, /twitch\.tv\/(videos\/|[^/]+\/clip\/)|clips\.twitch\.tv\//,
    /vk\.com\/(video|clip)/, /pinterest\.[^/]+\/pin\//, /threads\.net\/@[^/]+\/post\//, /soundcloud\.com\/[^/]+\/[^/?#]+/,
    /bilibili\.com\/video\//, /tumblr\.com\/.+\/\d+/,
  ];

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dlhelper-btn';
  btn.title = 'Download with ' + HELPER_CONFIG.brand;
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 4v10m0 0-4-4m4 4 4-4M5 16v2.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Download</span>';
  btn.addEventListener('click', function () {
    ext.runtime.sendMessage({ type: 'download', url: location.href });
  });

  var hidden = false;
  var close = document.createElement('span');
  close.className = 'dlhelper-close';
  close.textContent = '×';
  close.title = 'Hide';
  close.addEventListener('click', function (e) {
    e.stopPropagation();
    hidden = true;
    btn.remove();
  });
  btn.append(close);

  var last = '';
  function check() {
    if (location.href === last) return;
    last = location.href;
    var match = PATTERNS.some(function (re) { return re.test(location.href); });
    if (match && !hidden) { if (!btn.isConnected) document.documentElement.append(btn); }
    else btn.remove();
  }
  check();
  setInterval(check, 1000); // single-page apps change the URL without reloading
})();
