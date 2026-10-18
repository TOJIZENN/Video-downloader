/* global HELPER_CONFIG */
var ext = typeof browser !== 'undefined' ? browser : chrome;
var input = document.getElementById('site');
var status = document.getElementById('status');

ext.storage.sync.get('site').then(function (r) {
  input.value = (r && r.site) || HELPER_CONFIG.site;
});

document.getElementById('save').addEventListener('click', function () {
  var v = input.value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/.+/i.test(v)) {
    status.textContent = 'Enter a full http(s) address.';
    return;
  }
  ext.storage.sync.set({ site: v }).then(function () {
    status.textContent = 'Saved';
  });
});
