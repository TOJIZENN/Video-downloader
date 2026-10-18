const express = require('express');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');
const config = require('../config');
const media = require('../media');
const jobs = require('../jobs');
const proxy = require('../proxy');
const subs = require('../subtitles');
const store = require('../store');
const yt = require('../ytdlp');
const { HttpError, normalizeUserUrl, assertPublicUrl, rateLimit } = require('../security');

const router = express.Router();
router.use(express.json({ limit: '20kb' }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const infoLimit = rateLimit({ windowMs: 60_000, max: 30, name: 'info' });
const jobLimit = rateLimit({ windowMs: 60_000, max: 20, name: 'job' });
const uploadLimit = rateLimit({ windowMs: 60_000, max: 6, name: 'upload' });
const smallLimit = rateLimit({ windowMs: 60_000, max: 10, name: 'small' });

function requireRecord(token) {
  const record = media.get(token);
  if (!record || record.kind !== 'video') throw new HttpError(410, 'These links have expired. Search the video again.', 'expired');
  return record;
}

function optionFilename(record, option) {
  const suffix = option.group === 'video' && /^\d+$/.test(option.quality) ? ` (${option.quality}p)` : '';
  return `${jobs.sanitizeFilename(record.title)}${suffix}.${option.ext}`;
}

async function resolveUrl(raw) {
  const url = normalizeUserUrl(raw);
  if (!url) throw new HttpError(400, 'Please paste a valid link, for example https://www.youtube.com/watch?v=…', 'invalid_url');
  await assertPublicUrl(url);
  return url;
}

// ---- lookup ----
const info = wrap(async (req, res) => {
  const url = await resolveUrl(req.body && req.body.url !== undefined ? req.body.url : req.query.url);
  res.json(await media.lookup(url));
});
router.post('/info', infoLimit, info);
router.get('/info', infoLimit, info);

// ---- instant download (stream through) ----
router.get(
  '/download/:token/:key',
  wrap(async (req, res) => {
    const record = requireRecord(req.params.token);
    const option = record.options.get(req.params.key);
    if (!option) throw new HttpError(404, 'This format is no longer available.', 'no_format');
    if (option.mode !== 'direct') throw new HttpError(409, 'This format has to be prepared first.', 'needs_job');
    const format = record.formatsById.get(option.formatId);
    await proxy.streamFormat(req, res, { format, filename: optionFilename(record, option), inline: req.query.inline === '1' });
  })
);

router.get(
  '/thumb/:token/:index?',
  wrap(async (req, res) => {
    const record = media.get(req.params.token);
    if (!record) throw new HttpError(404, 'Not found', 'no_thumb');
    const url = record.kind === 'playlist' ? record.thumbs[Number(req.params.index)] : record.thumbnail;
    if (!url) throw new HttpError(404, 'Not found', 'no_thumb');
    await proxy.streamImage(res, url);
  })
);

// ---- prepared downloads (merge / mp3 / HLS) and conversions ----
const shared = new Map(); // same file requested twice -> same job

router.post(
  '/jobs',
  jobLimit,
  wrap(async (req, res) => {
    const { token, key } = req.body || {};
    const record = requireRecord(String(token || ''));
    const option = record.options.get(String(key || ''));
    if (!option) throw new HttpError(404, 'This format is no longer available.', 'no_format');
    const dedupeKey = `${option.mediaUrl || record.url}|${option.kind}|${option.selector}`;
    const existing = jobs.jobs.get(shared.get(dedupeKey));
    if (existing && !['error', 'cancelled'].includes(existing.status)) return res.json(existing.toJSON());
    const job = jobs.startDownloadJob(record, option);
    shared.set(dedupeKey, job.id);
    job.once('cleanup', () => shared.delete(dedupeKey));
    res.status(202).json(job.toJSON());
  })
);

function requireJob(id) {
  const job = jobs.jobs.get(id);
  if (!job) throw new HttpError(404, 'This file has expired. Please start again.', 'no_job');
  return job;
}

router.get('/jobs/:id', wrap(async (req, res) => res.json(requireJob(req.params.id).toJSON())));

router.get('/jobs/:id/events', (req, res, next) => {
  let job;
  try {
    job = requireJob(req.params.id);
  } catch (e) {
    return next(e);
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  let last = 0;
  const onUpdate = (data) => {
    const now = Date.now();
    if (now - last < 250 && data.status === 'running') return; // progress lines arrive very fast
    last = now;
    send(data);
    if (['done', 'error', 'cancelled'].includes(data.status)) res.end();
  };
  send(job.toJSON());
  if (job.finished) return res.end();
  job.on('update', onUpdate);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(ping);
    job.off('update', onUpdate);
  });
});

router.delete(
  '/jobs/:id',
  wrap(async (req, res) => {
    const job = requireJob(req.params.id);
    // Shared jobs keep running for the other visitors who requested the same file.
    if (job.listenerCount('update') <= 1) jobs.cancel(job);
    res.json({ ok: true });
  })
);

router.get(
  '/jobs/:id/file',
  wrap(async (req, res) => {
    const job = requireJob(req.params.id);
    if (job.status !== 'done' || !job.filePath || !fs.existsSync(job.filePath)) throw new HttpError(409, 'The file is not ready yet.', 'not_ready');
    const ext = path.extname(job.filePath).slice(1);
    res.setHeader('Content-Disposition', proxy.contentDisposition(job.fileName, req.query.inline === '1'));
    res.setHeader('Content-Type', proxy.MIME[ext] || 'application/octet-stream');
    res.sendFile(job.filePath, { headers: { 'Cache-Control': 'no-store' } });
  })
);

router.post('/convert', uploadLimit, (req, res, next) => {
  const target = String(req.query.target || '');
  if (!jobs.PRESETS[target]) return next(new HttpError(400, 'Unknown conversion.', 'bad_target'));
  const clamp = (v, lo, hi, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const gif = target === 'gif'
    ? {
        fps: clamp(req.query.fps, 5, 30, 12),
        width: Math.round(clamp(req.query.width, 120, 1280, 480) / 2) * 2,
        start: clamp(req.query.start, 0, 86_400, 0),
        duration: clamp(req.query.duration, 1, config.limits.gifMaxSeconds, 10),
      }
    : null;

  let bb;
  try {
    jobs.assertDiskSpace();
    bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: config.limits.uploadMaxBytes, fields: 5 } });
  } catch (e) {
    return next(e instanceof HttpError ? e : new HttpError(400, 'Please choose a file to convert.', 'no_file'));
  }
  const dir = jobs.newUploadDir();
  let saved = null;
  let failed = null;
  let writing = null;

  bb.on('file', (_name, stream, info) => {
    const safe = jobs.sanitizeFilename(info.filename || 'upload', 'upload');
    const dest = path.join(dir, 'input' + (path.extname(safe).slice(0, 10) || ''));
    const out = fs.createWriteStream(dest);
    writing = new Promise((resolve) => out.on('close', resolve));
    stream.on('limit', () => {
      failed = new HttpError(413, `This file is too large. The limit is ${Math.round(config.limits.uploadMaxBytes / 1048576)} MB.`, 'too_large');
      stream.unpipe(out);
      out.destroy();
      stream.resume();
    });
    stream.pipe(out);
    saved = { dest, originalName: info.filename || 'file' };
  });
  bb.on('error', () => {
    failed = failed || new HttpError(400, 'The upload was interrupted.', 'upload_failed');
  });
  bb.on('close', async () => {
    if (writing) await writing;
    if (failed || !saved) {
      fs.rm(dir, { recursive: true, force: true }, () => {});
      return next(failed || new HttpError(400, 'Please choose a file to convert.', 'no_file'));
    }
    try {
      const job = jobs.startConvertJob({ input: saved.dest, target, originalName: saved.originalName, gif });
      res.status(202).json(job.toJSON());
    } catch (e) {
      fs.rm(dir, { recursive: true, force: true }, () => {});
      next(e);
    }
  });
  req.pipe(bb);
});

// ---- subtitles & transcripts ----
router.post(
  '/subtitles',
  infoLimit,
  wrap(async (req, res) => {
    const url = await resolveUrl(req.body && req.body.url);
    const result = await media.lookup(url);
    if (result.type !== 'video') throw new HttpError(400, 'Please paste a link to a single video, not a playlist.', 'playlist');
    const record = requireRecord(result.token);
    res.json({
      token: result.token,
      title: result.title,
      thumbnail: result.thumbnail,
      durationText: result.durationText,
      uploader: result.uploader,
      webpageUrl: result.webpageUrl,
      videoId: record.id,
      site: record.extractor,
      tracks: subs.listTracks(record),
    });
  })
);

router.get(
  '/subtitles/:token/:lang',
  wrap(async (req, res) => {
    const record = requireRecord(req.params.token);
    const auto = req.query.auto === '1';
    const format = String(req.query.format || 'srt');
    const cues = await subs.getCues(record, req.params.lang, auto);
    if (format === 'json') return res.json({ cues });
    const body =
      format === 'vtt' ? subs.toVtt(cues) : format === 'txt' ? subs.toTxt(cues, req.query.timestamps === '1') : subs.toSrt(cues);
    const ext = ['vtt', 'txt'].includes(format) ? format : 'srt';
    res.setHeader('Content-Type', `${proxy.MIME[ext]}; charset=utf-8`);
    res.setHeader('Content-Disposition', proxy.contentDisposition(`${jobs.sanitizeFilename(record.title)}.${req.params.lang}.${ext}`, false));
    res.send(body);
  })
);

// ---- rating & feedback ----
router.get('/rating', (req, res) => res.json({ ...store.ratingSummary(), mine: store.myRating(req.ip) }));
router.post('/rating', smallLimit, (req, res, next) => {
  const stars = Number(req.body && req.body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return next(new HttpError(400, 'Rating must be 1 to 5 stars.', 'bad_rating'));
  res.json({ ...store.rate(req.ip, stars), mine: stars });
});

router.post('/feedback', smallLimit, (req, res, next) => {
  const b = req.body || {};
  const message = String(b.message || '').trim();
  if (message.length < 5) return next(new HttpError(400, 'Please write a little more so we can help.', 'too_short'));
  store.addFeedback({
    topic: String(b.topic || 'other').slice(0, 30),
    email: String(b.email || '').trim().slice(0, 200),
    link: String(b.link || '').trim().slice(0, 1000),
    message: message.slice(0, 5000),
  });
  res.json({ ok: true });
});

// ---- misc ----
router.get(
  '/sites',
  wrap(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.json({ sites: await yt.listExtractors() });
  })
);

router.get('/health', (req, res) => res.json({ ok: true, brand: config.brand.name }));

router.use((req, res) => res.status(404).json({ error: 'Not found', code: 'not_found' }));

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500 && err.code !== 'extract_failed') console.error('[api]', req.method, req.originalUrl, err.detail || err.stack || err.message);
  if (res.headersSent) return res.destroy();
  res.status(status).json({
    error: status >= 500 && !err.code ? 'Something went wrong. Please try again.' : err.message,
    code: err.code || 'error',
    // Raw yt-dlp output can mention server paths and internals; only show it while developing.
    detail: config.production ? undefined : err.detail,
  });
});

module.exports = router;
