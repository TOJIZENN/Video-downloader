// Background work that can't be streamed straight through: merging separate
// video/audio streams, MP3 extraction, HLS downloads and file conversions.
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');
const yt = require('./ytdlp');
const { HttpError } = require('./security');

const jobs = new Map();
const queue = [];
let running = 0;

fs.rmSync(config.dirs.tmp, { recursive: true, force: true });
fs.mkdirSync(config.dirs.tmp, { recursive: true });

class Job extends EventEmitter {
  constructor(title) {
    super();
    this.setMaxListeners(50);
    this.id = crypto.randomBytes(10).toString('base64url');
    this.title = title;
    this.status = 'queued'; // queued | running | processing | done | error | cancelled
    this.progress = 0;
    this.speed = null;
    this.eta = null;
    this.error = null;
    this.filePath = null;
    this.fileName = null;
    this.size = null;
    this.createdAt = Date.now();
    this.finishedAt = null;
    this.dir = path.join(config.dirs.tmp, this.id);
    this.child = null;
  }

  update(patch) {
    Object.assign(this, patch);
    this.emit('update', this.toJSON());
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      status: this.status,
      progress: Math.max(0, Math.min(100, Math.round(this.progress * 10) / 10)),
      speed: this.speed,
      eta: this.eta,
      error: this.error,
      fileName: this.fileName,
      size: this.size,
      position: this.status === 'queued' ? queue.indexOf(this) + 1 : 0,
      downloadUrl: this.status === 'done' ? `/api/jobs/${this.id}/file` : null,
    };
  }

  get finished() {
    return ['done', 'error', 'cancelled'].includes(this.status);
  }
}

// Prepared files can be gigabytes; keep a safety margin so the disk never fills up.
function assertDiskSpace() {
  try {
    const s = fs.statfsSync(config.dirs.tmp);
    if ((s.bavail * s.bsize) / 1048576 < config.limits.minFreeDiskMb) {
      throw new HttpError(507, 'The server is out of storage space right now. Please try again later.', 'disk_full');
    }
  } catch (e) {
    if (e instanceof HttpError) throw e; // statfs unsupported: don't block downloads
  }
}

function enqueue(job, runner) {
  assertDiskSpace();
  if (queue.length >= config.limits.maxQueuedJobs) {
    throw new HttpError(503, 'The server is busy right now. Please try again in a few minutes.', 'busy');
  }
  job.runner = runner;
  jobs.set(job.id, job);
  queue.push(job);
  pump();
  return job;
}

function pump() {
  while (running < config.limits.maxConcurrentJobs && queue.length) {
    const job = queue.shift();
    if (job.status === 'cancelled') continue;
    running++;
    fs.mkdirSync(job.dir, { recursive: true });
    job.update({ status: 'running' });
    Promise.resolve()
      .then(() => job.runner(job))
      .then(({ filePath, fileName }) => {
        if (job.status === 'cancelled') return;
        const size = fs.statSync(filePath).size;
        job.update({ status: 'done', progress: 100, filePath, fileName, size, speed: null, eta: null, finishedAt: Date.now() });
      })
      .catch((err) => {
        if (job.status === 'cancelled') return;
        console.error(`[job ${job.id}] failed:`, err.detail || err.message);
        job.update({ status: 'error', error: err.message || 'Processing failed.', finishedAt: Date.now() });
      })
      .finally(() => {
        running--;
        job.child = null;
        pump();
      });
    for (const q of queue) q.emit('update', q.toJSON()); // queue positions moved
  }
}

function cancel(job) {
  if (job.finished) return;
  const idx = queue.indexOf(job);
  if (idx >= 0) queue.splice(idx, 1);
  if (job.child) job.child.kill();
  job.update({ status: 'cancelled', finishedAt: Date.now() });
  removeFiles(job);
}

function removeFiles(job) {
  fs.rm(job.dir, { recursive: true, force: true }, () => {});
}

setInterval(() => {
  const now = Date.now();
  for (const job of jobs.values()) {
    const age = now - (job.finishedAt || job.createdAt);
    if ((job.finished && age > config.limits.jobTtlMs) || age > config.limits.jobTtlMs * 4) {
      if (!job.finished) cancel(job);
      removeFiles(job);
      jobs.delete(job.id);
      job.emit('cleanup');
    }
  }
}, 60_000).unref();

function sanitizeFilename(name, fallback = 'video') {
  const clean = String(name || '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 150)
    .trim();
  return clean || fallback;
}

function largestFile(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => !/\.(part|ytdl|temp|tmp)$/i.test(f) && !f.includes('.part-Frag'))
    .map((f) => ({ f, size: fs.statSync(path.join(dir, f)).size }))
    .sort((a, b) => b.size - a.size);
  return files[0] ? path.join(dir, files[0].f) : null;
}

const num = (s) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// ---- yt-dlp download job ----
function ytdlpRunner({ url, option, title, referer, impersonate }) {
  return (job, { forceImpersonate = false } = {}) =>
    new Promise((resolve, reject) => {
      const args = [
        '--no-playlist',
        '--newline',
        '--no-mtime',
        '--concurrent-fragments', '4',
        '-f', option.selector,
        '-o', path.join(job.dir, 'media.%(ext)s'),
        '--progress-template',
        'download:PROG %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s %(info.format_id)s',
      ];
      if (option.kind === 'merge') args.push('--merge-output-format', 'mp4');
      if (option.kind === 'single' && option.group === 'video') args.push('--remux-video', 'mp4');
      if (option.kind === 'mp3') args.push('-x', '--audio-format', 'mp3', '--audio-quality', '192K');
      if (referer) args.push('--referer', referer);
      if (impersonate || forceImpersonate) args.push(...yt.impersonateArgs());
      args.push('--', url); // '--': nothing after this is read as an option

      const child = yt.spawnYtDlp(args);
      job.child = child;
      const streams = option.selector.split('+');
      const weights = option.weights || streams.map(() => 1 / streams.length);
      const stageOf = new Map();
      let stderr = '';
      let buf = '';

      child.stdout.on('data', (d) => {
        buf += d;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('PROG ')) {
            const [, done, total, est, speed, eta, fid] = line.split(' ');
            if (!stageOf.has(fid)) stageOf.set(fid, Math.min(stageOf.size, streams.length - 1));
            const stage = stageOf.get(fid);
            const t = num(total) || num(est);
            const frac = t ? Math.min(1, (num(done) || 0) / t) : 0;
            const before = weights.slice(0, stage).reduce((a, b) => a + b, 0);
            job.update({ progress: (before + weights[stage] * frac) * 95, speed: num(speed), eta: num(eta) });
          } else if (/^\[(Merger|ExtractAudio|VideoRemuxer|FixupM3u8|FixupM4a|FixupStretched|ffmpeg)\]/.test(line)) {
            job.update({ status: 'processing', progress: Math.max(job.progress, 96), speed: null, eta: null });
          }
        }
      });
      child.stderr.on('data', (d) => {
        stderr += d;
        if (stderr.length > 50_000) stderr = stderr.slice(-50_000);
      });
      child.on('error', () => reject(new Error('The download engine is not installed on the server.')));
      child.on('close', (code) => {
        if (job.status === 'cancelled') return reject(new Error('Cancelled'));
        if (code !== 0) return reject(yt.mapError(stderr));
        const file = largestFile(job.dir);
        if (!file) return reject(new Error('The download finished but no file was produced.'));
        const ext = path.extname(file).slice(1) || option.ext;
        const suffix = option.group === 'video' && /^\d+$/.test(option.quality) ? ` (${option.quality}p)` : '';
        resolve({ filePath: file, fileName: `${sanitizeFilename(title)}${suffix}.${ext}` });
      });
    });
}

// ---- ffmpeg conversion job ----
function probe(input) {
  return new Promise((resolve) => {
    const child = spawn(config.ffmpeg, ['-hide_banner', '-i', input], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', () => resolve({ duration: null, vcodec: null, acodec: null }));
    child.on('close', () => {
      const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      const v = /Stream #[^\n]*Video:\s*([a-z0-9_]+)/i.exec(err);
      const a = /Stream #[^\n]*Audio:\s*([a-z0-9_]+)/i.exec(err);
      resolve({
        duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null,
        vcodec: v ? v[1].toLowerCase() : null,
        acodec: a ? a[1].toLowerCase() : null,
      });
    });
  });
}

const PRESETS = {
  mp3: {
    ext: 'mp3',
    needs: 'audio',
    args: () => ['-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '192k'],
  },
  mp4: {
    ext: 'mp4',
    needs: 'video',
    args: (p) => {
      const copyVideo = ['h264', 'hevc'].includes(p.vcodec);
      const copyAudio = !p.acodec || ['aac', 'mp3'].includes(p.acodec);
      return [
        '-map', '0:v:0', '-map', '0:a:0?',
        ...(copyVideo ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p']),
        ...(copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k']),
        '-movflags', '+faststart',
      ];
    },
  },
  gif: {
    ext: 'gif',
    needs: 'video',
    args: (p, o) => [
      '-filter_complex',
      `[0:v]fps=${o.fps},scale=${o.width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`,
      '-loop', '0',
    ],
  },
};

function convertRunner(opts) {
  return async (job) => {
    try {
      return await convert(job, opts);
    } finally {
      fs.rm(path.dirname(opts.input), { recursive: true, force: true }, () => {});
    }
  };
}

async function convert(job, { input, target, originalName, gif }) {
  const preset = PRESETS[target];
  const p = await probe(input);
  if (preset.needs === 'video' && !p.vcodec) throw new Error("This file doesn't contain a video stream.");
  if (preset.needs === 'audio' && !p.acodec) throw new Error("This file doesn't contain an audio track.");
  const out = path.join(job.dir, `output.${preset.ext}`);
  const pre = [];
  let duration = p.duration;
  if (target === 'gif') {
    pre.push('-ss', String(gif.start));
    pre.push('-t', String(gif.duration));
    duration = Math.min(gif.duration, Math.max(0, (p.duration || gif.duration) - gif.start));
  }
  const args = ['-hide_banner', '-y', ...pre, '-i', input, ...preset.args(p, gif || {}), '-progress', 'pipe:1', '-nostats', out];
  await new Promise((resolve, reject) => {
    const child = spawn(config.ffmpeg, args, { windowsHide: true });
    job.child = child;
    let err = '';
    let buf = '';
    const started = Date.now();
    child.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && duration) {
          const frac = Math.min(1, Number(m[1]) / 1e6 / duration);
          const elapsed = (Date.now() - started) / 1000;
          job.update({ progress: frac * 99, eta: frac > 0.02 ? Math.round((elapsed / frac) * (1 - frac)) : null });
        }
      }
    });
    child.stderr.on('data', (d) => {
      err += d;
      if (err.length > 20_000) err = err.slice(-20_000);
    });
    child.on('error', () => reject(new Error('ffmpeg is not available on the server.')));
    child.on('close', (code) => {
      if (job.status === 'cancelled') return reject(new Error('Cancelled'));
      if (code !== 0) {
        const last = err.trim().split(/\r?\n/).pop() || '';
        return reject(new Error(/Invalid data|could not find codec|moov atom/i.test(err) ? 'This file is damaged or is not a supported media file.' : `Conversion failed. ${last.slice(0, 160)}`));
      }
      resolve();
    });
  });
  const base = sanitizeFilename(path.parse(originalName || 'file').name, 'converted');
  return { filePath: out, fileName: `${base}.${preset.ext}` };
}

const PERMANENT_ERRORS = new Set(['unsupported', 'private', 'age_restricted', 'login_required', 'geo_blocked', 'live', 'drm', 'no_media', 'unavailable']);

function startDownloadJob(record, option) {
  const job = new Job(record.title);
  const run = ytdlpRunner({
    url: option.mediaUrl || record.url, // files found by the page scanner are downloaded directly
    option,
    title: record.title,
    referer: option.referer,
    impersonate: record.impersonate,
  });
  // Media hosts occasionally reject a stream mid-download (expired or throttled
  // URL). A second run re-extracts fresh links, which almost always succeeds;
  // if the host blocked us outright, the retry also looks like a real browser.
  return enqueue(job, async (j) => {
    try {
      return await run(j);
    } catch (err) {
      if (j.status === 'cancelled' || PERMANENT_ERRORS.has(err.code)) throw err;
      console.warn(`[job ${j.id}] retrying after:`, err.detail || err.message);
      fs.rmSync(j.dir, { recursive: true, force: true });
      fs.mkdirSync(j.dir, { recursive: true });
      j.update({ status: 'running', progress: 0, speed: null, eta: null });
      return run(j, { forceImpersonate: yt.looksBlocked(err) });
    }
  });
}

function startConvertJob({ input, target, originalName, gif }) {
  if (!PRESETS[target]) throw new HttpError(400, 'Unknown conversion.', 'bad_target');
  const job = new Job(originalName);
  return enqueue(job, convertRunner({ input, target, originalName, gif }));
}

function newUploadDir() {
  const dir = path.join(config.dirs.tmp, 'up-' + crypto.randomBytes(8).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = {
  jobs,
  cancel,
  startDownloadJob,
  startConvertJob,
  newUploadDir,
  assertDiskSpace,
  sanitizeFilename,
  PRESETS,
};
