(function () {
  'use strict';
  var A = window.App;
  var list = document.querySelector('[data-sites-list]');
  var filter = document.querySelector('#site-filter');
  var count = document.querySelector('[data-site-count]');
  if (!A || !list) return;
  var all = [];

  function render() {
    var q = filter.value.trim().toLowerCase();
    var shown = q ? all.filter(function (s) { return s.toLowerCase().indexOf(q) >= 0; }) : all;
    var frag = document.createDocumentFragment();
    shown.slice(0, 3000).forEach(function (s) { frag.append(A.el('li', { text: s })); });
    list.replaceChildren(frag);
    count.textContent = shown.length.toLocaleString() + ' / ' + all.length.toLocaleString();
  }

  A.api('/api/sites')
    .then(function (d) {
      all = d.sites;
      render();
    })
    .catch(function (e) { list.replaceChildren(A.el('li', { text: e.message })); });
  filter.addEventListener('input', render);
})();
