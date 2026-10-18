(function () {
  'use strict';
  var A = window.App;
  if (!A) return;
  var $ = A.$, el = A.el, tr = A.tr;

  var form = $('#conv-form');
  if (!form) return;
  var fileInput = $('[data-file]', form);
  var drop = $('[data-dropzone]', form);
  var label = $('[data-drop-label]', form);
  var btn = $('[data-convert]', form);
  var statusEl = $('#conv-status');
  var maxBytes = Number(form.dataset.max) * 1024 * 1024;
  var file = null;
  var xhr = null;

  function setFile(f) {
    file = null;
    btn.disabled = true;
    statusEl.replaceChildren();
    if (!f) { label.textContent = tr('conv.drop'); return; }
    if (f.size > maxBytes) {
      label.textContent = tr('conv.drop');
      statusEl.replaceChildren(A.errorBox(tr('conv.tooLarge', { n: form.dataset.max })));
      return;
    }
    file = f;
    label.textContent = f.name + ' (' + A.fmtBytes(f.size) + ')';
    btn.disabled = false;
  }

  fileInput.addEventListener('change', function () { setFile(fileInput.files[0]); });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); });
  });
  drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  });

  function reset() {
    fileInput.value = '';
    setFile(null);
    form.hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!file) return;
    var params = new URLSearchParams({ target: form.dataset.target });
    ['start', 'duration', 'width', 'fps'].forEach(function (n) {
      var f = form.elements[n];
      if (f) params.set(n, f.value);
    });
    var data = new FormData();
    data.append('file', file, file.name);

    var msg = el('span', { text: tr('conv.uploading', { p: 0 }) });
    var fill = el('i');
    var cancel = el('button', { class: 'btn btn-ghost', type: 'button', text: tr('job.cancel'), onclick: function () { if (xhr) xhr.abort(); } });
    statusEl.replaceChildren(el('div', { class: 'progress-card' },
      el('div', { class: 'progress-title', text: file.name }),
      el('div', { class: 'progress-msg' }, msg),
      el('div', { class: 'bar' }, fill),
      el('div', { class: 'progress-actions' }, cancel)));
    form.hidden = true;

    xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/convert?' + params.toString());
    xhr.upload.onprogress = function (ev) {
      if (!ev.lengthComputable) return;
      var p = Math.round((ev.loaded / ev.total) * 100);
      msg.textContent = tr('conv.uploading', { p: p });
      fill.style.width = p + '%';
    };
    xhr.onload = function () {
      var res = null;
      try { res = JSON.parse(xhr.responseText); } catch (err) {}
      if (xhr.status === 401) return A.signIn();
      if (xhr.status >= 400 || !res) {
        statusEl.replaceChildren(A.errorBox((res && res.error) || tr('res.error'), reset));
        return;
      }
      var again = el('button', { class: 'btn btn-ghost', type: 'button', text: tr('conv.another'), onclick: function () { statusEl.replaceChildren(); reset(); } });
      A.renderJob(statusEl, res, { onCancel: function () { statusEl.replaceChildren(); reset(); }, onRetry: reset, extraDoneAction: again });
    };
    xhr.onerror = function () { statusEl.replaceChildren(A.errorBox(tr('res.error'), reset)); };
    xhr.onabort = function () { statusEl.replaceChildren(); reset(); };
    xhr.send(data);
  });
})();
