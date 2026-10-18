(function () {
  'use strict';

  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };

  var S = {};
  try { S = JSON.parse($('#i18n-data').textContent); } catch (e) {}
  function tr(key, vars) {
    vars = vars || {};
    return String(S[key] || key).replace(/\{(\w+)\}/g, function (m, n) { return n in vars ? vars[n] : m; });
  }

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    remove: function (k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  function el(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(e, arguments[i]);
    return e;
  }
  function append(parent, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) return c.forEach(function (x) { append(parent, x); });
    parent.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function icon(name, cls) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.append(use);
    return svg;
  }

  function fmtBytes(n) {
    if (!n) return '';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
  }
  function fmtEta(s) {
    if (s == null || !isFinite(s)) return '';
    s = Math.round(s);
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m ? m + ':' + String(r).padStart(2, '0') : r + 's';
  }

  function normalizeUrl(input) {
    var s = String(input || '').trim();
    if (!s) return null;
    var m = s.match(/https?:\/\/[^\s"'<>]+/i);
    if (m) s = m[0];
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
      if (!/^[^\s/]+\.[^\s/]+/.test(s)) return null;
      s = 'https://' + s;
    }
    try {
      var u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.toString();
    } catch (e) {
      return null;
    }
  }

  // The private-access cookie expired or was revoked: back to the password page.
  function signIn() {
    location.href = '/auth/login?next=' + encodeURIComponent(location.pathname + location.search);
  }

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', signal: opts.signal, headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (res.status === 401 && data && data.code === 'auth_required') signIn();
        if (!res.ok) {
          var e = new Error((data && data.error) || tr('res.error'));
          e.code = data && data.code;
          e.status = res.status;
          throw e;
        }
        return data;
      });
    });
  }

  // Known site keys (yt-dlp extractor names) -> brand icons served at /icons/<slug>.svg
  var SITE_ICONS = [
    ['youtube', 'youtube'], ['tiktok', 'tiktok'], ['instagram', 'instagram'], ['facebook', 'facebook'], ['twitter', 'x'],
    ['vimeo', 'vimeo'], ['dailymotion', 'dailymotion'], ['vk', 'vk'], ['reddit', 'reddit'], ['pinterest', 'pinterest'],
    ['threads', 'threads'], ['xiaohongshu', 'xiaohongshu'], ['twitch', 'twitch'], ['soundcloud', 'soundcloud'],
    ['bilibili', 'bilibili'], ['tumblr', 'tumblr'],
  ];
  function siteIcon(site) {
    var k = String(site || '').toLowerCase();
    for (var i = 0; i < SITE_ICONS.length; i++) if (k.indexOf(SITE_ICONS[i][0]) === 0) return SITE_ICONS[i][1];
    return null;
  }

  // ---------- small UI pieces ----------
  function loader(text) {
    return el('div', { class: 'loader', role: 'status' }, el('span', { class: 'spinner' }), el('span', { text: text }));
  }

  function skeleton() {
    return el('div', { class: 'media-card', role: 'status' },
      el('div', { class: 'skeleton' },
        el('div', { class: 'sk sk-thumb' }),
        el('div', { class: 'sk-lines' },
          el('div', { class: 'sk sk-line', style: 'width:30%' }),
          el('div', { class: 'sk sk-line', style: 'width:90%;height:20px' }),
          el('div', { class: 'sk sk-line', style: 'width:60%' }),
          el('div', { class: 'sk sk-line', style: 'width:45%;height:44px;margin-top:18px;border-radius:12px' }))),
      el('div', { class: 'sk-status' }, el('span', { class: 'spinner' }), tr('res.searching')));
  }

  function errorBox(message, retry, retryLabel) {
    var actions = el('div', { class: 'alert-actions' });
    if (retry) actions.append(el('button', { type: 'button', text: retryLabel || tr('res.retry'), onclick: retry }));
    return el('div', { class: 'alert', role: 'alert' }, icon('alert'), el('div', {}, el('div', { text: message }), actions.children.length ? actions : null));
  }

  function toast(text, sub, action, ms) {
    var root = $('#toast-root');
    if (!root) return;
    var t = el('div', { class: 'toast' },
      icon('check'),
      el('span', { class: 'toast-text' }, text, sub ? el('span', { class: 'toast-sub', text: sub }) : null),
      action ? el('a', { href: action.href, text: action.label }) : null,
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': tr('job.close'), onclick: function () { t.remove(); } }, icon('x', 'ic-sm')));
    root.append(t);
    setTimeout(function () { t.remove(); }, ms || 6000);
  }

  function modal(content, opts) {
    opts = opts || {};
    var lastFocus = document.activeElement;
    var closeBtn = el('button', { class: 'icon-btn modal-close', type: 'button', 'aria-label': tr('job.close') }, icon('x'));
    var box = el('div', { class: 'modal' + (opts.video ? ' modal-video' : ''), role: 'dialog', 'aria-modal': 'true' }, closeBtn, content);
    var backdrop = el('div', { class: 'modal-backdrop' }, box);
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      if (opts.onClose) opts.onClose();
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    closeBtn.focus();
    return { close: close, box: box };
  }

  function triggerDownload(url) {
    var a = el('a', { href: url, download: '' });
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
  }

  function afterDownload() {
    var tipShown = false;
    try { tipShown = sessionStorage.getItem('helperTip') === '1'; sessionStorage.setItem('helperTip', '1'); } catch (e) {}
    if (tipShown) toast(tr('toast.started'), null, null, 3500);
    else toast(tr('toast.started'), tr('toast.tip'), { href: '/install', label: tr('toast.install') }, 9000);
  }

  // ---------- ratings ----------
  function mountRating(root, opts) {
    opts = opts || {};
    var stars = $$('.star', root);
    var text = $('[data-rating-text]', root);
    function paint(r) {
      var lit = r.mine || Math.round(r.average);
      stars.forEach(function (s, i) {
        s.classList.toggle('on', i < lit);
        s.setAttribute('aria-checked', String(r.mine === i + 1));
      });
      if (!text) return;
      text.replaceChildren();
      if (r.count) text.append(el('b', { text: r.average.toFixed(1) }), ' / 5 · ', tr('rate.reviews', { n: r.count.toLocaleString() }));
      else text.textContent = tr('rate.first');
    }
    if (opts.summary) paint(opts.summary);
    else api('/api/rating').then(paint).catch(function () {});
    stars.forEach(function (s) {
      s.addEventListener('click', function () {
        api('/api/rating', { method: 'POST', body: { stars: Number(s.dataset.star) } })
          .then(function (r) {
            paint(r);
            toast(tr('rate.thanks'), null, null, 2500);
            if (opts.onRated) opts.onRated(r);
          })
          .catch(function (e) { toast(e.message, null, null, 3000); });
      });
    });
  }

  function starButtons() {
    var wrap = el('div', { class: 'stars', role: 'radiogroup', 'aria-label': tr('rate.title') });
    for (var i = 1; i <= 5; i++) wrap.append(el('button', { type: 'button', class: 'star', role: 'radio', 'aria-checked': 'false', 'data-star': String(i), 'aria-label': i + ' / 5' }, icon('star')));
    return wrap;
  }

  // ---------- server-side jobs (HD merges, MP3, conversions) ----------
  function renderJob(container, job, opts) {
    opts = opts || {};
    var finished = false;
    var autoDownloaded = false;
    var es = null;
    var poll = null;
    var msg = el('span');
    var stats = el('span', { class: 'muted' });
    var fill = el('i');
    var bar = el('div', { class: 'bar' }, fill);
    var actions = el('div', { class: 'progress-actions' });
    var cancelBtn = el('button', {
      class: 'btn btn-ghost', type: 'button', text: tr('job.cancel'),
      onclick: function () {
        stop();
        finished = true;
        fetch('/api/jobs/' + job.id, { method: 'DELETE' }).catch(function () {});
        if (opts.onCancel) opts.onCancel();
      },
    });
    actions.append(cancelBtn);
    container.replaceChildren(
      el('div', { class: 'progress-card' },
        el('div', { class: 'progress-title', title: opts.title || job.title || '', text: opts.title || job.title || '' }),
        el('div', { class: 'progress-msg' }, msg, stats),
        bar,
        actions,
        opts.note ? el('p', { class: 'progress-note', text: opts.note }) : null)
    );

    function stop() {
      if (es) es.close();
      clearInterval(poll);
    }
    function update(j) {
      if (finished) return;
      if (j.status === 'queued') {
        msg.textContent = tr('job.queued', { n: Math.max(0, (j.position || 1) - 1) });
        bar.classList.add('indeterminate');
      } else if (j.status === 'running') {
        msg.textContent = tr('job.running');
        bar.classList.toggle('indeterminate', !j.progress);
        fill.style.width = (j.progress || 0) + '%';
        stats.textContent = [j.progress ? Math.floor(j.progress) + '%' : '', j.speed ? fmtBytes(j.speed) + '/s' : '', j.eta ? fmtEta(j.eta) : '']
          .filter(Boolean).join(' · ');
      } else if (j.status === 'processing') {
        msg.textContent = tr('job.processing');
        bar.classList.add('indeterminate');
        stats.textContent = '';
      } else if (j.status === 'done') {
        finished = true;
        stop();
        bar.classList.remove('indeterminate');
        fill.style.width = '100%';
        msg.textContent = tr('job.done');
        stats.textContent = fmtBytes(j.size);
        actions.replaceChildren(el('a', { class: 'btn btn-primary', href: j.downloadUrl, download: '' }, icon('download', 'ic-sm'), tr('job.save')));
        if (opts.extraDoneAction) actions.append(opts.extraDoneAction);
        if (!autoDownloaded) {
          autoDownloaded = true;
          triggerDownload(j.downloadUrl);
          afterDownload();
        }
        if (opts.onDone) opts.onDone(j);
      } else if (j.status === 'error' || j.status === 'cancelled') {
        finished = true;
        stop();
        container.replaceChildren(errorBox(j.error || tr('job.error'), opts.onRetry));
      }
    }
    function startPolling() {
      poll = setInterval(function () {
        api('/api/jobs/' + job.id).then(update).catch(function (e) {
          stop();
          finished = true;
          container.replaceChildren(errorBox(e.message, opts.onRetry));
        });
      }, 1500);
    }
    update(job);
    if (!finished) {
      if ('EventSource' in window) {
        es = new EventSource('/api/jobs/' + job.id + '/events');
        es.onmessage = function (ev) { try { update(JSON.parse(ev.data)); } catch (e) {} };
        es.onerror = function () { if (!finished) { es.close(); startPolling(); } };
      } else startPolling();
    }
    return { stop: stop, isFinished: function () { return finished; }, cancel: function () { if (!finished) cancelBtn.click(); } };
  }

  // Corner panel listing prepared downloads; several can run at once.
  var Dock = (function () {
    var dock = $('#dock');
    if (!dock) return { add: function () {} };
    var body = $('[data-dock-body]', dock);
    var count = $('[data-dock-count]', dock);
    var toggleBtn = $('[data-dock-toggle]', dock);
    var askedRating = false;

    function refresh() {
      var n = $$('.dock-item', body).length;
      count.textContent = String(n);
      dock.hidden = !body.children.length;
    }
    toggleBtn.addEventListener('click', function () {
      var collapsed = dock.classList.toggle('collapsed');
      toggleBtn.setAttribute('aria-expanded', String(!collapsed));
    });

    function askRating() {
      if (askedRating) return;
      askedRating = true;
      api('/api/rating').then(function (r) {
        if (r.mine) return;
        var stars = starButtons();
        var row = el('div', { class: 'dock-rate' }, el('span', { text: tr('rate.prompt') }), stars);
        body.append(row);
        refresh();
        mountRating(row, { summary: r, onRated: function () { setTimeout(function () { row.remove(); refresh(); }, 1200); } });
      }).catch(function () {});
    }

    function add(jobPromise, opts) {
      var content = el('div', {}, el('div', { class: 'progress-title', text: opts.title || '' }), loader(tr('job.running')));
      var item = el('div', { class: 'dock-item' });
      var view = null;
      var remove = function () { item.remove(); refresh(); };
      var close = el('button', { class: 'icon-btn dock-close', type: 'button', 'aria-label': tr('dock.dismiss'), title: tr('dock.dismiss') }, icon('x', 'ic-sm'));
      close.addEventListener('click', function () {
        if (view && !view.isFinished()) view.cancel();
        remove();
      });
      item.append(close, content);
      body.prepend(item);
      dock.classList.remove('collapsed');
      toggleBtn.setAttribute('aria-expanded', 'true');
      refresh();
      jobPromise
        .then(function (job) {
          view = renderJob(content, job, {
            title: opts.title,
            note: opts.note,
            onCancel: remove,
            onRetry: opts.onRetry ? function () { remove(); opts.onRetry(); } : null,
            onDone: askRating,
          });
        })
        .catch(function (e) {
          content.replaceChildren(errorBox(e.message, opts.onError ? function () { remove(); opts.onError(e); } : null));
        });
    }
    return { add: add };
  })();

  // ---------- downloader ----------
  var form = $('#dl-form');
  var input = $('#dl-url');
  var statusEl = $('#dl-status');
  var resultEl = $('#dl-result');
  var current = null;
  var mode = form && form.dataset.defaultAudio === '1' ? 'audio' : 'video';
  var cards = []; // result cards that react to the Video/MP3 switch

  function qualityLabel(o) {
    if (o.group === 'audio') return o.label.replace(/^Audio\s+/, '');
    var h = parseInt(o.quality, 10);
    return h ? h + 'p' : o.quality || o.label;
  }
  function qualityTag(o) {
    if (o.group === 'audio') return null;
    var h = parseInt(o.quality, 10);
    if (!h) return null;
    if (h >= 2160) return ['4K', 't-4k'];
    if (h >= 1440) return ['2K', 't-2k'];
    if (h >= 1080) return ['Full HD', 't-fhd'];
    if (h >= 720) return ['HD', 't-hd'];
    return ['SD', ''];
  }
  function bitrate(o) {
    if (!o.quality) return '';
    return /k$/i.test(o.quality) ? o.quality.replace(/k$/i, ' kbps') : o.quality + ' kbps';
  }
  function sizeText(o) {
    return o.size ? (o.mode === 'job' ? '≈ ' : '') + fmtBytes(o.size) : '';
  }
  function shortName(o) {
    return o.group === 'audio' ? qualityLabel(o) : o.label + ' ' + qualityLabel(o);
  }

  function recommended(data, m) {
    var find = function (fn) { return data.options.filter(fn)[0]; };
    if (m === 'audio') return find(function (o) { return o.key === 'mp3'; }) || find(function (o) { return o.group === 'audio'; }) || data.options[0];
    return find(function (o) { return o.key === data.defaultKey; }) || data.options[0];
  }

  function openPreview(data) {
    if (data.embed) {
      modal(el('iframe', { src: data.embed, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, title: data.title }), { video: true });
    } else if (data.previewUrl) {
      modal(el('video', { src: data.previewUrl, controls: true, autoplay: true, playsinline: true }), { video: true });
    } else if (data.webpageUrl) {
      window.open(data.webpageUrl, '_blank', 'noopener');
    }
  }

  function startDownload(data, o) {
    if (o.mode === 'direct') {
      triggerDownload('/api/download/' + data.token + '/' + encodeURIComponent(o.key));
      afterDownload();
      return;
    }
    Dock.add(api('/api/jobs', { method: 'POST', body: { token: data.token, key: o.key } }), {
      title: data.title + ' · ' + shortName(o),
      note: o.group === 'video' ? tr('job.note') : null,
      onRetry: function () { startDownload(data, o); },
      onError: function (e) {
        if (e.code === 'expired' && data.webpageUrl) search(data.webpageUrl);
        else startDownload(data, o);
      },
    });
  }

  function copyLink(data, o) {
    var link = location.origin + '/api/download/' + data.token + '/' + encodeURIComponent(o.key);
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(
      function () { toast(tr('res.copied'), null, null, 2500); },
      function () { window.prompt(tr('res.copyLink'), link); }
    );
  }

  function formatRow(data, o, isRec) {
    var tag = qualityTag(o);
    var name = el('span', { class: 'fmt-name' });
    if (o.group === 'audio') name.append(el('b', { text: bitrate(o) || o.label }), o.note ? ' · ' + o.note : '');
    else name.append(el('b', { text: o.label }), o.note ? ' · ' + o.note : '');
    if (!o.hasAudio) name.append(el('span', { class: 'noaudio' }, icon('mute', 'ic-sm'), tr('res.noAudio')));
    if (isRec) name.append(el('span', { class: 'rec', text: tr('res.recommended') }));
    var actions = el('span', { class: 'fmt-actions' });
    if (o.mode === 'direct') {
      actions.append(el('button', { class: 'icon-btn', type: 'button', title: tr('res.copyLink'), 'aria-label': tr('res.copyLink'), onclick: function () { copyLink(data, o); } }, icon('copy', 'ic-sm')));
    }
    actions.append(el('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: function () { startDownload(data, o); } }, icon('download', 'ic-sm'), tr('res.download')));
    return el('li', { class: 'fmt-row' + (isRec ? ' is-rec' : '') },
      el('span', { class: 'fmt-q' }, el('span', { class: 'q-badge', text: qualityLabel(o) }), tag ? el('span', { class: 'q-tag ' + tag[1], text: tag[0] }) : null),
      name,
      el('span', { class: 'fmt-size', text: sizeText(o) }),
      actions);
  }

  function renderVideo(data) {
    var card = el('article', { class: 'media-card' });
    var thumb = el('button', { class: 'thumb', type: 'button', 'aria-label': tr('res.preview') });
    if (data.thumbnail) thumb.append(el('img', { src: data.thumbnail, alt: '', loading: 'lazy' }));
    if (data.embed || data.previewUrl) thumb.append(el('span', { class: 'play-btn' }, icon('play')));
    if (data.durationText) thumb.append(el('span', { class: 'dur-badge', text: data.durationText }));
    thumb.addEventListener('click', function () { openPreview(data); });

    var slug = siteIcon(data.site);
    var quick = el('div', { class: 'media-quick' });
    var body = el('div', { class: 'media-body' },
      data.site ? el('span', { class: 'media-site' }, slug ? el('img', { src: '/icons/' + slug + '.svg', alt: '' }) : icon('globe', 'ic-sm'), data.site) : null,
      el('h2', { class: 'media-title', title: data.title, text: data.title }),
      el('div', { class: 'media-meta' },
        data.uploader ? el('span', {}, icon('film', 'ic-sm'), data.uploader) : null,
        data.durationText ? el('span', {}, icon('clock', 'ic-sm'), data.durationText) : null),
      quick);
    card.append(el('div', { class: 'media-top' }, thumb, body));

    if (!data.options || !data.options.length) {
      quick.append(el('span', { class: 'muted', text: tr('res.error') }));
      return card;
    }

    var groups = [['video', 'res.groupVideo', 'film'], ['audio', 'res.groupAudio', 'music'], ['videoOnly', 'res.groupVideoOnly', 'mute']]
      .map(function (g) { return { id: g[0], label: tr(g[1]), icon: g[2], items: data.options.filter(function (o) { return o.group === g[0]; }) }; })
      .filter(function (g) { return g.items.length; });
    var tabs = el('div', { class: 'tabs', role: 'tablist' });
    var list = el('ul', { class: 'fmt-list', role: 'tabpanel' });
    var active = null;
    var rec = null;

    function showTab(id) {
      active = id;
      $$('.tab', tabs).forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.tab === id)); t.tabIndex = t.dataset.tab === id ? 0 : -1; });
      var g = groups.filter(function (x) { return x.id === id; })[0];
      list.replaceChildren();
      g.items.forEach(function (o) { list.append(formatRow(data, o, rec && o.key === rec.key)); });
    }
    groups.forEach(function (g) {
      tabs.append(el('button', { class: 'tab', type: 'button', role: 'tab', 'data-tab': g.id, onclick: function () { showTab(g.id); } },
        icon(g.icon, 'ic-sm'), g.label, el('span', { class: 'tab-count', text: String(g.items.length) })));
    });
    tabs.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var ids = groups.map(function (g) { return g.id; });
      var i = ids.indexOf(active) + (e.key === 'ArrowRight' ? 1 : -1);
      showTab(ids[(i + ids.length) % ids.length]);
      $('.tab[aria-selected="true"]', tabs).focus();
    });

    function applyMode(m) {
      rec = recommended(data, m);
      var alt = m === 'audio' ? recommended(data, 'video') : data.options.filter(function (o) { return o.key === 'mp3'; })[0];
      quick.replaceChildren(
        el('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: function () { startDownload(data, rec); } },
          icon('download'), tr('res.download') + ' ' + shortName(rec), rec.size ? el('small', { text: sizeText(rec) }) : null),
        alt && alt.key !== rec.key
          ? el('button', { class: 'btn btn-soft btn-lg', type: 'button', onclick: function () { startDownload(data, alt); } }, icon(alt.group === 'audio' ? 'music' : 'film'), shortName(alt))
          : null);
      var want = rec.group;
      showTab(groups.some(function (g) { return g.id === want; }) ? want : groups[0].id);
    }
    applyMode(mode);
    cards.push({ applyMode: applyMode });

    card.append(tabs, list);
    var foot = el('div', { class: 'media-foot' });
    if (data.hasSubtitles) {
      foot.append(el('a', { href: '/youtube-subtitles?url=' + encodeURIComponent(data.webpageUrl) }, icon('captions', 'ic-sm'), tr('res.subtitles')));
      foot.append(el('a', { href: '/youtube-transcript?url=' + encodeURIComponent(data.webpageUrl) }, icon('text', 'ic-sm'), 'Transcript'));
    }
    if (data.webpageUrl) foot.append(el('a', { href: data.webpageUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 'ic-sm'), tr('res.source')));
    if (foot.children.length) card.append(foot);
    return card;
  }

  function renderPlaylist(data) {
    var wrap = el('div', { class: 'playlist-card' });
    wrap.append(el('div', { class: 'playlist-head' },
      el('span', { class: 'feature-ic' }, icon('list')),
      el('div', {}, el('h2', { text: data.title }),
        el('p', {}, [data.site, tr('res.playlist', { n: data.total }), data.total > data.shown ? tr('res.playlistMore', { n: data.shown }) : ''].filter(Boolean).join(' · ')))));
    data.entries.forEach(function (e, i) {
      if (e.type === 'video') {
        wrap.append(el('div', { class: 'entry-slot' }, renderVideo(e)));
        return;
      }
      var slot = el('div', { class: 'entry-slot' });
      var btn = el('button', { class: 'btn btn-soft btn-sm', type: 'button' }, icon('download', 'ic-sm'), tr('res.getLinks'));
      var thumb = el('div', { class: 'entry-thumb' });
      if (e.thumbnail) thumb.append(el('img', { src: e.thumbnail, alt: '', loading: 'lazy' }));
      var row = el('div', { class: 'entry' },
        el('span', { class: 'entry-n', text: String(i + 1) }),
        thumb,
        el('div', { class: 'entry-title', title: e.title, text: e.title }),
        el('span', { class: 'entry-dur', text: e.durationText || '' }),
        btn);
      var loaded = false;
      btn.addEventListener('click', function () {
        if (loaded) { slot.hidden = !slot.hidden; return; }
        btn.disabled = true;
        slot.replaceChildren(el('div', { style: 'padding:14px 4px' }, loader(tr('res.searching'))));
        api('/api/info', { method: 'POST', body: { url: e.url } })
          .then(function (d) {
            loaded = true;
            slot.replaceChildren(d.type === 'playlist' ? renderPlaylist(d) : renderVideo(d));
          })
          .catch(function (err) { slot.replaceChildren(errorBox(err.message)); })
          .then(function () { btn.disabled = false; });
      });
      wrap.append(row, slot);
    });
    return wrap;
  }

  // ---------- recent searches (stored only in this browser) ----------
  var recentBox = form && $('[data-recent]', form);
  function renderRecent() {
    if (!recentBox) return;
    var items = store.get('recent', []);
    var list = $('[data-recent-list]', recentBox);
    list.replaceChildren();
    items.forEach(function (r) {
      var slug = siteIcon(r.site);
      list.append(el('button', { class: 'recent-chip', type: 'button', title: r.url, onclick: function () { search(r.url); } },
        slug ? el('img', { src: '/icons/' + slug + '.svg', alt: '' }) : icon(r.playlist ? 'list' : 'link', 'ic-sm'),
        el('span', { text: r.title || r.url })));
    });
    recentBox.hidden = !items.length;
  }
  function remember(url, data) {
    var items = store.get('recent', []).filter(function (r) { return r.url !== url; });
    items.unshift({ url: url, title: (data.title || '').slice(0, 120), site: data.site || '', playlist: data.type === 'playlist' });
    store.set('recent', items.slice(0, 8));
    renderRecent();
  }

  function basePath() {
    return form.getAttribute('action') || '/';
  }

  function search(raw) {
    var url = normalizeUrl(raw);
    if (!url) {
      statusEl.replaceChildren(errorBox(tr('form.invalid')));
      resultEl.replaceChildren();
      return;
    }
    if (input.value !== url) input.value = url;
    updateFieldButtons();
    try { history.replaceState(null, '', basePath() + '?url=' + encodeURIComponent(url)); } catch (e) {}
    if (current) current.abort();
    var ctrl = new AbortController();
    current = ctrl;
    cards = [];
    var sites = $('.hero-sites');
    if (sites) sites.hidden = true; // keep the result right under the search box
    statusEl.replaceChildren();
    resultEl.replaceChildren(skeleton());
    var submit = $('.dl-submit', form);
    submit.disabled = true;
    if (window.innerWidth < 860) resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    api('/api/info', { method: 'POST', body: { url: url }, signal: ctrl.signal })
      .then(function (data) {
        if (ctrl !== current) return;
        resultEl.replaceChildren(data.type === 'playlist' ? renderPlaylist(data) : renderVideo(data));
        remember(url, data);
      })
      .catch(function (e) {
        if (e.name === 'AbortError' || ctrl !== current) return;
        resultEl.replaceChildren();
        statusEl.replaceChildren(errorBox(e.message, function () { search(url); }));
      })
      .then(function () { if (ctrl === current) submit.disabled = false; });
  }

  function updateFieldButtons() {
    if (!form) return;
    var clear = $('.dl-clear', form);
    var paste = $('[data-paste]', form);
    if (clear) clear.hidden = !input.value;
    if (paste) paste.hidden = !!input.value;
  }

  function setMode(m) {
    mode = m;
    $$('[data-mode]', form).forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.mode === m)); });
    cards.forEach(function (c) { c.applyMode(m); });
  }

  if (form && input) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      search(input.value);
    });
    input.addEventListener('input', updateFieldButtons);
    input.addEventListener('paste', function () {
      setTimeout(function () { if (normalizeUrl(input.value)) search(input.value); }, 30);
    });
    $('.dl-clear', form).addEventListener('click', function () {
      input.value = '';
      updateFieldButtons();
      statusEl.replaceChildren();
      resultEl.replaceChildren();
      cards = [];
      if (current) current.abort();
      try { history.replaceState(null, '', basePath()); } catch (e) {}
      input.focus();
    });
    $('[data-paste]', form).addEventListener('click', function () {
      var fallback = function () { input.focus(); toast(tr('form.pasteHint'), null, null, 3500); };
      if (!navigator.clipboard || !navigator.clipboard.readText) return fallback();
      navigator.clipboard.readText().then(function (txt) {
        if (normalizeUrl(txt)) {
          input.value = txt.trim();
          search(input.value);
        } else {
          input.focus();
          toast(tr('form.invalid'), null, null, 3500);
        }
      }, fallback);
    });
    $$('[data-mode]', form).forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.mode); }); });
    $('[data-recent-clear]', form).addEventListener('click', function () { store.remove('recent'); renderRecent(); });
    renderRecent();
    updateFieldButtons();
    if (form.dataset.autostart === '1' && input.value) search(input.value);
  }

  // ---------- page rating widget ----------
  $$('[data-rating]').forEach(function (r) { mountRating(r); });

  // ---------- header: menus, drawer, theme ----------
  function closeMenus(except) {
    $$('.nav-item.open').forEach(function (it) {
      if (it === except) return;
      it.classList.remove('open');
      $('[data-menu-btn]', it).setAttribute('aria-expanded', 'false');
    });
  }
  $$('[data-menu-btn]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var item = btn.parentElement;
      var open = !item.classList.contains('open');
      closeMenus(item);
      item.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.nav-item')) closeMenus(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenus(); });

  var navToggle = $('.nav-toggle');
  if (navToggle) {
    navToggle.addEventListener('click', function () {
      var open = $('#site-nav').classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
  }

  var themeBtn = $('[data-theme-toggle]');
  function effectiveTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  if (themeBtn) {
    themeBtn.setAttribute('aria-pressed', String(effectiveTheme() === 'dark'));
    themeBtn.addEventListener('click', function () {
      var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
      themeBtn.setAttribute('aria-pressed', String(next === 'dark'));
    });
  }

  var langSelect = $('[data-lang-select]');
  if (langSelect) {
    langSelect.addEventListener('change', function () {
      var u = new URL(location.href);
      u.searchParams.set('lang', langSelect.value);
      location.href = u.toString();
    });
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }

  window.App = {
    $: $, $$: $$, el: el, icon: icon, tr: tr, api: api, store: store, toast: toast, modal: modal, loader: loader, errorBox: errorBox,
    renderJob: renderJob, triggerDownload: triggerDownload, afterDownload: afterDownload, fmtBytes: fmtBytes, normalizeUrl: normalizeUrl, signIn: signIn,
  };
})();
