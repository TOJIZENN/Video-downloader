(function () {
  'use strict';
  var A = window.App;
  if (!A) return;
  var $ = A.$, el = A.el, tr = A.tr;

  var form = $('#subs-form');
  if (!form) return;
  var input = $('#subs-url');
  var statusEl = $('#subs-status');
  var box = $('#subs-result');
  var select = $('[data-subs-lang]');
  var list = $('[data-subs-transcript]');
  var searchBox = $('[data-subs-search]');
  var tsBox = $('[data-subs-ts]');
  var clear = $('.dl-clear', form);
  var info = null;
  var cues = [];
  var reqId = 0;

  function current() {
    var v = (select.value || '').split('|');
    return { auto: v[0] === '1', lang: v.slice(1).join('|') };
  }

  function stamp(sec) {
    var s = Math.floor(sec);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return h ? h + ':' + p(m) + ':' + p(s % 60) : m + ':' + p(s % 60);
  }

  function timeLink(sec) {
    if (info.videoId && /youtube/i.test(info.site)) return 'https://www.youtube.com/watch?v=' + encodeURIComponent(info.videoId) + '&t=' + Math.floor(sec) + 's';
    return info.webpageUrl;
  }

  function highlight(text, q) {
    if (!q) return [text];
    var out = [];
    var lower = text.toLowerCase();
    var i = 0;
    var j;
    while ((j = lower.indexOf(q, i)) >= 0) {
      if (j > i) out.push(text.slice(i, j));
      out.push(el('mark', { text: text.slice(j, j + q.length) }));
      i = j + q.length;
    }
    out.push(text.slice(i));
    return out;
  }

  function renderCues() {
    var q = (searchBox.value || '').trim().toLowerCase();
    var frag = document.createDocumentFragment();
    var shown = 0;
    cues.forEach(function (c) {
      if (q && c.text.toLowerCase().indexOf(q) < 0) return;
      shown++;
      frag.append(el('li', {},
        el('a', { class: 'ts', href: timeLink(c.start), target: '_blank', rel: 'noopener noreferrer', text: stamp(c.start) }),
        el('span', {}, highlight(c.text, q))));
    });
    if (!shown) frag.append(el('li', { class: 'muted', text: q ? '—' : tr('subs.none') }));
    list.replaceChildren(frag);
  }

  function loadCues() {
    var c = current();
    if (!c.lang) return;
    var id = ++reqId;
    list.replaceChildren(el('li', {}, A.loader(tr('res.searching'))));
    A.api('/api/subtitles/' + info.token + '/' + encodeURIComponent(c.lang) + '?auto=' + (c.auto ? 1 : 0) + '&format=json')
      .then(function (d) {
        if (id !== reqId) return;
        cues = d.cues;
        renderCues();
      })
      .catch(function (e) {
        if (id !== reqId) return;
        cues = [];
        list.replaceChildren(el('li', {}, A.errorBox(e.message, loadCues)));
      });
  }

  function fillLanguages(tracks) {
    select.replaceChildren();
    var groups = [
      [tr('res.subtitles'), tracks.filter(function (t) { return !t.auto; })],
      [tr('subs.auto'), tracks.filter(function (t) { return t.auto && t.original; })],
      [tr('subs.translated'), tracks.filter(function (t) { return t.auto && !t.original; })],
    ];
    groups.forEach(function (g) {
      if (!g[1].length) return;
      var og = el('optgroup', { label: g[0] });
      g[1].forEach(function (t) {
        og.append(el('option', { value: (t.auto ? '1|' : '0|') + t.lang, text: t.name + (t.auto && t.original && !/auto/i.test(t.name) ? ' (' + tr('subs.auto') + ')' : '') }));
      });
      select.append(og);
    });
    // Prefer the page language, then English, then the first manual track
    var lang = (document.documentElement.lang || 'en').toLowerCase();
    var opts = Array.prototype.slice.call(select.options);
    var pick = opts.filter(function (o) { return o.value.split('|')[1].toLowerCase().split('-')[0] === lang && o.value[0] === '0'; })[0] ||
      opts.filter(function (o) { return o.value[0] === '0'; })[0] ||
      opts.filter(function (o) { var t = o.value.split('|')[1]; return o.parentNode.label === tr('subs.auto') || /-orig$/.test(t); })[0] ||
      opts[0];
    if (pick) select.value = pick.value;
  }

  function search(raw) {
    var url = A.normalizeUrl(raw);
    if (!url) {
      statusEl.replaceChildren(A.errorBox(tr('form.invalid')));
      return;
    }
    input.value = url;
    clear.hidden = false;
    try { history.replaceState(null, '', location.pathname + '?url=' + encodeURIComponent(url)); } catch (e) {}
    box.hidden = true;
    statusEl.replaceChildren(A.loader(tr('res.searching')));
    A.api('/api/subtitles', { method: 'POST', body: { url: url } })
      .then(function (d) {
        info = d;
        statusEl.replaceChildren();
        if (!d.tracks.length) {
          statusEl.replaceChildren(A.errorBox(tr('subs.none')));
          return;
        }
        var img = $('[data-subs-thumb]');
        if (d.thumbnail) { img.src = d.thumbnail; img.hidden = false; } else img.hidden = true;
        $('[data-subs-title]').textContent = d.title;
        $('[data-subs-meta]').textContent = [d.durationText, d.uploader].filter(Boolean).join(' · ');
        fillLanguages(d.tracks);
        box.hidden = false;
        searchBox.value = '';
        loadCues();
      })
      .catch(function (e) { statusEl.replaceChildren(A.errorBox(e.message, function () { search(url); })); });
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); search(input.value); });
  input.addEventListener('input', function () { clear.hidden = !input.value; });
  input.addEventListener('paste', function () { setTimeout(function () { if (A.normalizeUrl(input.value)) search(input.value); }, 30); });
  clear.addEventListener('click', function () { input.value = ''; clear.hidden = true; box.hidden = true; statusEl.replaceChildren(); input.focus(); });
  select.addEventListener('change', loadCues);
  searchBox.addEventListener('input', renderCues);
  if (tsBox) tsBox.addEventListener('change', function () { list.classList.toggle('no-ts', !tsBox.checked); });

  document.querySelectorAll('[data-subs-dl]').forEach(function (b) {
    b.addEventListener('click', function () {
      var c = current();
      if (!info || !c.lang) return;
      var ts = tsBox && tsBox.checked ? 1 : 0;
      A.triggerDownload('/api/subtitles/' + info.token + '/' + encodeURIComponent(c.lang) + '?auto=' + (c.auto ? 1 : 0) + '&format=' + b.dataset.subsDl + '&timestamps=' + ts);
    });
  });
  var copyBtn = $('[data-subs-copy]');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var withTs = !tsBox || tsBox.checked;
      var text = cues.map(function (c) { return (withTs ? '[' + stamp(c.start) + '] ' : '') + c.text; }).join('\n');
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
        function () { A.toast(tr('subs.copied'), null, null, 2500); },
        function () { A.toast(tr('res.error'), null, null, 2500); }
      );
    });
  }

  if (form.dataset.autostart === '1' && input.value) search(input.value);
  clear.hidden = !input.value;
})();
