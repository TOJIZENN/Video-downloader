// Resolves pasted links into result cards and remembers them server-side under
// an opaque token, so download links never carry raw upstream URLs.
const crypto = require('crypto');
const config = require('./config');
const yt = require('./ytdlp');
const sniffer = require('./sniff');

const MAX_RECORDS = 1000;
const MAX_PARALLEL_EXTRACTIONS = 6;

const records = new Map(); // token -> record
const urlCache = new Map(); // normalized url -> { promise, expires }

let activeExtractions = 0;
const waiting = [];
async function withExtractionSlot(fn) {
  if (activeExtractions >= MAX_PARALLEL_EXTRACTIONS) await new Promise((r) => waiting.push(r));
  activeExtractions++;
  try {
    return await fn();
  } finally {
    activeExtractions--;
    const next = waiting.shift();
    if (next) next();
  }
}

function put(record) {
  const token = crypto.randomBytes(12).toString('base64url');
  record.expires = Date.now() + config.limits.infoCacheTtlMs;
  records.set(token, record);
  while (records.size > MAX_RECORDS) records.delete(records.keys().next().value);
  return token;
}

function get(token) {
  const r = records.get(token);
  if (!r) return null;
  if (r.expires < Date.now()) {
    records.delete(token);
    return null;
  }
  return r;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of records) if (v.expires < now) records.delete(k);
  for (const [k, v] of urlCache) if (v.expires < now) urlCache.delete(k);
}, 60_000).unref();

const publicOption = ({ key, group, ext, label, quality, note, hasAudio, size, mode }) => ({
  key, group, ext, label, quality, note, hasAudio, size, mode,
});

function siteName(info) {
  return info.extractor_key === 'Generic' ? new URL(info.webpage_url || 'https://x.invalid').hostname : info.extractor_key || info.extractor || '';
}

function normalizeVideo(info, sourceUrl, flags = {}) {
  const { options, defaultKey, formatsById } = yt.buildOptions(info);
  const thumbnail = yt.bestThumbnail(info);
  const title = (info.title || info.fulltitle || info.id || 'video').toString();
  const pageUrl = info.webpage_url || info.original_url || sourceUrl;
  if (flags.sniffed) {
    // Found by the page scanner: yt-dlp can't re-read the page, so prepared
    // downloads work on the media file itself (sent with the page as Referer).
    const fallback = formatsById.get((options.find((o) => o.group === 'video') || options[0] || {}).formatId) || [...formatsById.values()][0];
    for (const o of options) {
      if (o.mode !== 'job') continue;
      const f = formatsById.get(o.formatId) || fallback;
      o.mediaUrl = f.url;
      o.selector = 'best';
      o.referer = pageUrl;
    }
  }
  if (flags.impersonate) {
    // The site only talks to real browsers, which the plain proxy isn't: let yt-dlp fetch everything.
    for (const o of options) {
      if (o.mode === 'direct') Object.assign(o, { mode: 'job', kind: 'single' });
    }
  }
  const token = put({
    kind: 'video',
    url: pageUrl,
    id: info.id,
    title,
    duration: info.duration || null,
    extractor: info.extractor_key || '',
    options: new Map(options.map((o) => [o.key, o])),
    formatsById,
    thumbnail,
    subtitles: info.subtitles || {},
    autoCaptions: info.automatic_captions || {},
    impersonate: Boolean(flags.impersonate),
  });
  const preview = options.find((o) => o.group === 'video' && o.mode === 'direct');
  return {
    type: 'video',
    token,
    title,
    duration: info.duration || null,
    durationText: yt.formatDuration(info.duration),
    uploader: info.uploader || info.channel || info.creator || info.uploader_id || '',
    site: siteName(info),
    webpageUrl: pageUrl,
    thumbnail: thumbnail ? `/api/thumb/${token}` : null,
    embed: yt.embedUrl(info),
    previewUrl: preview ? `/api/download/${token}/${encodeURIComponent(preview.key)}?inline=1` : null,
    options: options.map(publicOption),
    defaultKey,
    hasSubtitles: Object.keys(info.subtitles || {}).length + Object.keys(info.automatic_captions || {}).length > 0,
    via: flags.sniffed ? 'page-scan' : flags.impersonate ? 'browser' : undefined,
  };
}

function entryUrl(e) {
  for (const u of [e.url, e.webpage_url, e.original_url]) if (u && /^https?:\/\//i.test(u)) return u;
  return null;
}

function normalize(info, sourceUrl, flags = {}) {
  if (info._type === 'playlist' || info._type === 'multi_video') {
    const entries = (info.entries || []).filter(Boolean).slice(0, config.limits.playlistLimit);
    const full = (e) => Array.isArray(e.formats) || (e.url && e._type !== 'url' && e._type !== 'url_transparent' && e.ext);
    if (entries.length === 1 && full(entries[0])) return normalizeVideo(entries[0], sourceUrl, flags);
    const thumbs = entries.map((e) => yt.bestThumbnail(e));
    const listToken = put({ kind: 'playlist', thumbs });
    const items = [];
    entries.forEach((e, i) => {
      if (full(e)) {
        items.push(normalizeVideo(e, sourceUrl, flags));
        return;
      }
      const url = entryUrl(e);
      if (!url) return;
      items.push({
        type: 'link',
        url,
        title: e.title || url,
        duration: e.duration || null,
        durationText: yt.formatDuration(e.duration),
        thumbnail: thumbs[i] ? `/api/thumb/${listToken}/${i}` : null,
      });
    });
    if (!items.length) {
      const err = new Error("We couldn't find any videos at this link.");
      err.status = 404;
      err.code = 'no_media';
      throw err;
    }
    return {
      type: 'playlist',
      title: info.title || 'Playlist',
      uploader: info.uploader || info.channel || '',
      site: siteName(info),
      total: info.playlist_count || entries.length,
      shown: items.length,
      entries: items,
    };
  }
  return normalizeVideo(info, sourceUrl, flags);
}

// Errors that a different way of asking will not fix.
const FINAL_ERRORS = new Set(['private', 'age_restricted', 'login_required', 'geo_blocked', 'live', 'drm', 'engine_missing', 'timeout']);

// yt-dlp first; then yt-dlp looking like a real browser (for sites that block
// other clients); then our own scan of the page for video files.
async function extract(url) {
  let err;
  try {
    return { info: await yt.extractInfo(url) };
  } catch (e) {
    err = e;
  }
  if (FINAL_ERRORS.has(err.code)) throw err;
  if (yt.looksBlocked(err)) {
    try {
      return { info: await yt.extractInfo(url, { impersonate: true }), flags: { impersonate: true } };
    } catch (e) {
      if (FINAL_ERRORS.has(e.code)) throw e;
      err = e;
    }
  }
  if (config.pageScan) {
    const found = await sniffer.sniff(url).catch(() => null);
    if (found) return { info: sniffer.toInfo(found, found.page || url), flags: { sniffed: true } };
  }
  throw err;
}

function lookup(url) {
  const cached = urlCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = withExtractionSlot(() => extract(url)).then(({ info, flags }) => normalize(info, url, flags));
  // Result tokens live for infoCacheTtlMs; reuse the response a little less than that.
  urlCache.set(url, { promise, expires: Date.now() + config.limits.infoCacheTtlMs - 5 * 60_000 });
  promise.catch(() => urlCache.delete(url));
  return promise;
}

module.exports = { lookup, get };
