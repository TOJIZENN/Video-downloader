// Streams a media file from the source site to the visitor with a proper
// "Save as" filename. Media URLs are often bound to the IP that extracted them,
// so going through the server is what makes the links work at all.
const { Readable } = require('stream');
const { once } = require('events');
const { assertPublicUrl, HttpError } = require('./security');
const { safeFetch } = require('./net');

const MIME = {
  mp4: 'video/mp4', m4a: 'audio/mp4', webm: 'video/webm', mp3: 'audio/mpeg', opus: 'audio/ogg', ogg: 'audio/ogg',
  '3gp': 'video/3gpp', mov: 'video/quicktime', flv: 'video/x-flv', mkv: 'video/x-matroska', wav: 'audio/wav',
  aac: 'audio/aac', flac: 'audio/flac', gif: 'image/gif', srt: 'application/x-subrip', vtt: 'text/vtt', txt: 'text/plain',
};
const DROP_HEADERS = new Set(['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'accept-encoding']);

function contentDisposition(filename, inline) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function upstreamHeaders(fmtHeaders) {
  const h = {};
  for (const [k, v] of Object.entries(fmtHeaders || {})) if (!DROP_HEADERS.has(k.toLowerCase())) h[k] = v;
  h['Accept-Encoding'] = 'identity';
  if (!Object.keys(h).some((k) => k.toLowerCase() === 'user-agent')) {
    h['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  }
  return h;
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m || !size) return null;
  let start = m[1] === '' ? null : Number(m[1]);
  let end = m[2] === '' ? null : Number(m[2]);
  if (start === null) {
    start = Math.max(0, size - (end || 0));
    end = size - 1;
  } else if (end === null || end >= size) end = size - 1;
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

async function pipeBody(body, res) {
  for await (const chunk of Readable.fromWeb(body)) {
    if (!res.write(chunk)) await once(res, 'drain');
  }
}

async function streamFormat(req, res, { format, filename, inline }) {
  await assertPublicUrl(format.url);
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const headers = upstreamHeaders(format.http_headers);
  const type = MIME[format.ext] || 'application/octet-stream';
  const size = format.filesize || null;
  const chunkSize = format.downloader_options && format.downloader_options.http_chunk_size;

  res.setHeader('Content-Disposition', contentDisposition(filename, inline));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Sites like YouTube throttle long single requests; fetch in ranged chunks instead.
  if (chunkSize && size) {
    const range = parseRange(req.headers.range, size);
    if (range === 'invalid') {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    const { start, end } = range || { start: 0, end: size - 1 };
    let first = true;
    for (let pos = start; pos <= end; pos += chunkSize) {
      const to = Math.min(pos + chunkSize - 1, end);
      const r = await safeFetch(format.url, { headers: { ...headers, Range: `bytes=${pos}-${to}` }, signal: controller.signal });
      if (!r.ok) {
        if (first) throw new HttpError(502, 'The website refused the download. Please search the link again.', 'upstream_refused');
        return res.destroy();
      }
      if (first) {
        res.status(range ? 206 : 200);
        res.setHeader('Content-Type', type);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', end - start + 1);
        if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        first = false;
      }
      await pipeBody(r.body, res);
    }
    return res.end();
  }

  if (req.headers.range) headers.Range = req.headers.range;
  const r = await safeFetch(format.url, { headers, signal: controller.signal, redirect: 'follow' });
  if (!r.ok) throw new HttpError(502, 'The website refused the download. Please search the link again.', 'upstream_refused');
  res.status(r.status === 206 ? 206 : 200);
  const upstreamType = r.headers.get('content-type') || '';
  res.setHeader('Content-Type', /^(video|audio)\//.test(upstreamType) ? upstreamType : type);
  for (const h of ['content-length', 'content-range', 'accept-ranges']) {
    const v = r.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  await pipeBody(r.body, res);
  res.end();
}

async function streamImage(res, url) {
  await assertPublicUrl(url);
  const r = await safeFetch(url, {
    headers: { 'User-Agent': upstreamHeaders({})['User-Agent'], Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  const type = (r.headers.get('content-type') || '').toLowerCase();
  // Raster images only: an SVG from another site served from this origin could carry script.
  if (!r.ok || !/^image\/(jpeg|png|webp|gif|avif)\b/.test(type)) throw new HttpError(404, 'Thumbnail not available', 'no_thumb');
  const max = 10 * 1024 * 1024;
  const len = Number(r.headers.get('content-length') || 0);
  if (len > max) throw new HttpError(413, 'Thumbnail too large', 'thumb_too_large');
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  if (len) res.setHeader('Content-Length', len);
  let sent = 0;
  for await (const chunk of Readable.fromWeb(r.body)) {
    sent += chunk.length;
    if (sent > max) return res.destroy(); // no Content-Length promised it was small
    if (!res.write(chunk)) await once(res, 'drain');
  }
  res.end();
}

module.exports = { streamFormat, streamImage, contentDisposition, MIME };
