// Last-resort extractor for pages yt-dlp doesn't recognise: read the page and
// collect video files from <video>/<source> tags, Open Graph / Twitter player
// tags, JSON-LD, and media links inside inline player configs.
const { assertPublicUrl } = require('./security');
const { safeFetch } = require('./net');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const MAX_HTML = 5 * 1024 * 1024;
const MAX_FORMATS = 12;
const MEDIA_EXT = /\.(mp4|m4v|webm|mov|mkv|m3u8|mpd|mp3|m4a|ogg|oga|opus|flv)(?:$|[?#])/i;
const NOT_MEDIA = /\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|html?|php|json|xml)(?:$|[?#])/i;
const AUDIO = new Set(['mp3', 'm4a', 'ogg', 'oga', 'opus']);
const MIME_EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'application/vnd.apple.mpegurl': 'm3u8', 'application/x-mpegurl': 'm3u8', 'application/dash+xml': 'mpd' };

const unescape = (s) =>
  s
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/g, '"');

function extOf(url) {
  try {
    const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
    return m ? m[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

function heightOf(url, label) {
  const m = /(?:^|[^\d])(4320|2160|1440|1080|720|540|480|360|240|144)p?(?:[^\d]|$)/i.exec(`${label || ''} ${url}`);
  return m ? Number(m[1]) : null;
}

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag);
  return m ? unescape(m[2]) : null;
}

function meta(html, key) {
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const k = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    if (k === key) return attr(tag, 'content');
  }
  return null;
}

function parsePage(html, pageUrl) {
  const found = new Map(); // absolute url -> { label, type }
  const add = (raw, { label = '', type = '', fromTag = false } = {}) => {
    if (!raw || found.size >= 60) return;
    let u = unescape(String(raw).trim());
    if (!u || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('javascript:')) return;
    try {
      u = new URL(u, pageUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:/i.test(u) || NOT_MEDIA.test(u)) return;
    const typeExt = MIME_EXT[String(type).toLowerCase().split(';')[0]];
    if (!fromTag && !MEDIA_EXT.test(u) && !typeExt) return;
    if (!found.has(u)) found.set(u, { label, typeExt });
  };

  // <video src> / <audio src> / <source src type label>
  const tagRe = /<(video|audio|source)\b[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    for (const a of ['src', 'data-src', 'data-video-src', 'data-hls', 'data-mp4']) {
      const v = attr(tag, a);
      if (v) add(v, { label: attr(tag, 'label') || attr(tag, 'title') || attr(tag, 'size') || attr(tag, 'res') || '', type: attr(tag, 'type') || '', fromTag: true });
    }
  }
  // Open Graph / Twitter player streams
  for (const k of ['og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream']) {
    const v = meta(html, k);
    if (v) add(v, { type: meta(html, 'og:video:type') || '' });
  }
  // JSON-LD VideoObject
  for (const k of ['contentUrl', 'embedUrl']) {
    const re = new RegExp(`"${k}"\\s*:\\s*"([^"]+)"`, 'g');
    while ((m = re.exec(html))) add(m[1]);
  }
  // Any media URL in scripts / player configs (JSON-escaped slashes are undone first)
  const plain = unescape(html);
  const anyRe = /https?:\/\/[^\s"'<>()\\]+?\.(?:mp4|m4v|webm|mov|m3u8|mpd|mp3|m4a)(?:\?[^\s"'<>\\]*)?(?=["'\s<>\\),]|$)/gi;
  while ((m = anyRe.exec(plain))) add(m[0]);
  // Relative media paths in player configs: file: "/media/clip.mp4"
  const relRe = /["'](\/[^"'\s<>]+\.(?:mp4|m4v|webm|m3u8|mpd)(?:\?[^"'\s<>]*)?)["']/gi;
  while ((m = relRe.exec(plain))) add(m[1]);

  const title =
    meta(html, 'og:title') || meta(html, 'twitter:title') || ((/<title[^>]*>([^<]{1,300})<\/title>/i.exec(html) || [])[1] || '').trim() || null;
  const thumbnail = meta(html, 'og:image') || meta(html, 'twitter:image') || null;

  const formats = [];
  let i = 0;
  for (const [url, { label, typeExt }] of found) {
    const ext = typeExt || extOf(url) || 'mp4';
    const isHls = ext === 'm3u8';
    const isDash = ext === 'mpd';
    const audioOnly = AUDIO.has(ext);
    formats.push({
      format_id: `page${i++}`,
      url,
      ext: isHls || isDash ? 'mp4' : ext,
      protocol: isHls ? 'm3u8_native' : isDash ? 'http_dash_segments' : url.startsWith('https') ? 'https' : 'http',
      vcodec: audioOnly ? 'none' : null,
      acodec: null,
      height: audioOnly ? null : heightOf(url, label),
      format_note: label || (isHls ? 'HLS' : isDash ? 'DASH' : ''),
      http_headers: { 'User-Agent': UA, Referer: pageUrl },
    });
    if (formats.length >= MAX_FORMATS) break;
  }
  return { title: title ? unescape(title) : null, thumbnail: thumbnail ? new URL(thumbnail, pageUrl).toString() : null, formats };
}

async function readLimited(res, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > limit) break;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Returns a yt-dlp-shaped info dict, or null when the page has no media.
async function sniff(pageUrl) {
  await assertPublicUrl(pageUrl);
  const res = await safeFetch(pageUrl, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const finalUrl = res.url || pageUrl;
  await assertPublicUrl(finalUrl);
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (/^(video|audio)\//.test(type) || MIME_EXT[type.split(';')[0]]) {
    res.body.cancel().catch(() => {});
    const page = parsePage(`<video src="${finalUrl.replace(/"/g, '&quot;')}" type="${type.split(';')[0]}"></video>`, finalUrl);
    let name = new URL(finalUrl).pathname.split('/').pop() || 'video';
    try {
      name = decodeURIComponent(name);
    } catch {}
    return { ...page, title: name, page: finalUrl };
  }
  if (!/html|xml|text|json|javascript/.test(type)) {
    res.body.cancel().catch(() => {});
    return null;
  }
  const html = await readLimited(res, MAX_HTML);
  const page = parsePage(html, finalUrl);
  if (!page.formats.length) return null;
  return { ...page, page: finalUrl };
}

// Shape the scan result like yt-dlp's -J output so the rest of the app can use it.
function toInfo(result, pageUrl) {
  return {
    id: null,
    title: result.title || new URL(pageUrl).hostname,
    thumbnail: result.thumbnail,
    webpage_url: pageUrl,
    extractor_key: 'Generic',
    formats: result.formats,
  };
}

module.exports = { sniff, parsePage, toInfo, UA };
