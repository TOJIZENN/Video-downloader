/* global HELPER_CONFIG */
if (typeof importScripts === 'function' && !self.HELPER_CONFIG) importScripts('config.js');
var ext = typeof browser !== 'undefined' ? browser : chrome;

function siteUrl() {
  return ext.storage.sync.get('site').then(function (r) {
    return String((r && r.site) || HELPER_CONFIG.site).replace(/\/+$/, '');
  });
}

function openDownloader(url, openerTab) {
  if (!url || !/^https?:/i.test(url)) return;
  siteUrl().then(function (site) {
    var opts = { url: site + '/?url=' + encodeURIComponent(url) };
    if (openerTab && openerTab.index != null) opts.index = openerTab.index + 1;
    ext.tabs.create(opts);
  });
}

ext.runtime.onInstalled.addListener(function () {
  ext.contextMenus.removeAll(function () {
    ext.contextMenus.create({ id: 'dl-page', title: 'Download video from this page', contexts: ['page', 'video', 'audio'] });
    ext.contextMenus.create({ id: 'dl-link', title: 'Download linked video', contexts: ['link'] });
  });
});

ext.contextMenus.onClicked.addListener(function (info, tab) {
  openDownloader(info.menuItemId === 'dl-link' ? info.linkUrl : info.pageUrl, tab);
});

ext.runtime.onMessage.addListener(function (msg, sender) {
  if (msg && msg.type === 'download') openDownloader(msg.url, sender.tab);
});
