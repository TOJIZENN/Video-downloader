/* global HELPER_CONFIG */
var ext = typeof browser !== 'undefined' ? browser : chrome;
var tabUrl = '';
document.getElementById('brand').textContent = HELPER_CONFIG.brand + ' Helper';

function site() {
  return ext.storage.sync.get('site').then(function (r) {
    return String((r && r.site) || HELPER_CONFIG.site).replace(/\/+$/, '');
  });
}

ext.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
  tabUrl = (tabs[0] && tabs[0].url) || '';
  var ok = /^https?:/i.test(tabUrl);
  document.getElementById('url').textContent = ok ? tabUrl : 'Open a page with a video, then click here.';
  document.getElementById('go').disabled = !ok;
});

document.getElementById('go').addEventListener('click', function () {
  site().then(function (s) {
    ext.tabs.create({ url: s + '/?url=' + encodeURIComponent(tabUrl) });
    window.close();
  });
});
document.getElementById('open').addEventListener('click', function () {
  site().then(function (s) {
    ext.tabs.create({ url: s + '/' });
    window.close();
  });
});
document.getElementById('settings').addEventListener('click', function () {
  ext.runtime.openOptionsPage();
});
