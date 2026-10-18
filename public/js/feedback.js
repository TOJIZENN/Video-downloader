(function () {
  'use strict';
  var A = window.App;
  var form = document.querySelector('#feedback-form');
  var status = document.querySelector('[data-feedback-status]');
  if (!A || !form) return;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var body = {};
    ['topic', 'link', 'email', 'message'].forEach(function (n) { body[n] = form.elements[n].value; });
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    status.className = 'form-status';
    status.textContent = '';
    A.api('/api/feedback', { method: 'POST', body: body })
      .then(function () {
        form.reset();
        status.className = 'form-status ok';
        status.textContent = 'Thank you! Your message has been sent.';
      })
      .catch(function (err) {
        status.className = 'form-status err';
        status.textContent = err.message;
      })
      .then(function () { btn.disabled = false; });
  });
})();
