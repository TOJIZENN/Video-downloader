const { spawn } = require('child_process');
const config = require('./config');
const { HttpError } = require('./security');

const AUDIO_EXTS = new Set(['m4a', 'mp3', 'aac', 'opus', 'ogg', 'oga', 'wav', 'flac', 'weba', 'mka']);
const DIRECT_PROTOCOLS = new Set(['http', 'https']);

function childEnv() {
  return { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
}

function commonArgs() {
  const a = [
    ...config.ytdlp.baseArgs,
    '--ignore-config',
    '--no-warnings',
    '--no-color',
    '--js-runtimes', config.jsRuntime,
    '--ffmpeg-location', config.ffmpeg,
  ];
  if (config.cookiesFile) a.push('--cookies', config.cookiesFile);
  else if (config.cookiesFromBrowser) a.push('--cookies-from-browser', config.cookiesFromBrowser);
  if (config.proxy) a.push('--proxy', config.proxy);
  return a;
}

// Extra arguments for sites that only answer requests that look like a real browser.
function impersonateArgs() {
  return config.impersonate ? ['--impersonate', config.impersonate] : [];
}

function looksBlocked(err) {
  return Boolean(err && config.impersonate && (err.code === 'blocked' || /Cloudflare|anti-bot|impersonat|HTTP Error 403|Just a moment/i.test(err.detail || '')));
}

function spawnYtDlp(args) {
  return spawn(config.ytdlp.cmd, [...commonArgs(), ...args], { env: childEnv(), windowsHide: true });
}

// yt-dlp error text -> message a visitor can act on.
function mapError(stderr) {
  const lines = String(stderr || '').split(/\r?\n/).filter(Boolean);
  const errLine = [...lines].reverse().find((l) => l.startsWith('ERROR:')) || lines[lines.length - 1] || '';
  const detail = errLine.replace(/^ERROR:\s*/, '').replace(/[A-Z]:\\[^\s]+/g, '[path]').slice(0, 300);
  const t = detail;
  const rules = [
    [/Unsupported URL|is not a valid URL|No suitable extractor/i, 422, 'unsupported', "This link isn't supported. Copy the address of the page that plays the video and try again."],
    [/confirm you.?re not a bot|confirm you are not a bot/i, 503, 'bot_check', 'The website is temporarily blocking requests from this server. Please try again later.'],
    [/Cloudflare|anti-bot|impersonat|Just a moment|HTTP Error 403/i, 403, 'blocked', 'The website refused the request from this server. Please try again later.'],
    [/Private video|video is private|This account is private/i, 403, 'private', 'This video is private. Only public videos can be downloaded.'],
    [/age.?restricted|confirm your age|inappropriate for some users/i, 403, 'age_restricted', 'This video is age-restricted and needs a signed-in account to download.'],
    [/login|log in|sign in|cookies|authentication|registered users|rate-limit reached/i, 403, 'login_required', 'This content requires signing in to the website, so it cannot be downloaded anonymously.'],
    [/not available in your country|geo.?restrict|blocked it in your country/i, 451, 'geo_blocked', 'This video is not available in the region where the server is located.'],
    [/Premieres in|live event will begin|This live event|is_live|Live stream/i, 422, 'live', 'Live streams and upcoming premieres cannot be downloaded until they have finished.'],
    [/DRM|protected by/i, 422, 'drm', 'This video is DRM-protected and cannot be downloaded.'],
    [/HTTP Error 429|Too Many Requests/i, 503, 'upstream_rate_limited', 'The website is limiting requests right now. Please try again in a few minutes.'],
    [/No video formats found|no video|There's no video|does not contain any video|No media found/i, 404, 'no_media', "We couldn't find a video on this page."],
    [/unavailable|removed|deleted|does not exist|HTTP Error 404|Not Found|terminated/i, 404, 'unavailable', 'This video is unavailable. It may have been removed or the link is wrong.'],
    [/timed out|Connection reset|Unable to download webpage|getaddrinfo|Failed to resolve/i, 502, 'network', "We couldn't reach the website. Please check the link and try again."],
  ];
  for (const [re, status, code, msg] of rules) {
    if (re.test(t)) {
      const e = new HttpError(status, msg, code);
      e.detail = detail;
      return e;
    }
  }
  const e = new HttpError(502, "We couldn't get the video from this link. Please make sure the link is correct and the video is public.", 'extract_failed');
  e.detail = detail;
  return e;
}

function runJson(args, timeoutMs = config.limits.infoTimeoutMs) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnYtDlp(args);
    } catch {
      return reject(new HttpError(500, 'The download engine is not installed. Run "npm run setup" on the server.', 'engine_missing'));
    }
    const out = [];
    let err = '';
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      child.kill();
      reject(new HttpError(504, 'The website took too long to respond. Please try again.', 'timeout'));
    }, timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => {
      err += d;
      if (err.length > 50_000) err = err.slice(-50_000);
    });
    child.on('error', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new HttpError(500, 'The download engine is not installed. Run "npm run setup" on the server.', 'engine_missing'));
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf8').trim();
      if (code === 0 && stdout) {
        try {
          return resolve(JSON.parse(stdout));
        } catch {}
      }
      reject(mapError(err));
    });
  });
}

function extractInfo(url, { impersonate = false } = {}) {
  return runJson([
    '-J',
    '--no-playlist', // a watch URL with &list= means the video, not the whole list
    '--flat-playlist', // real playlists/channels: list entries, resolve each on demand
    '--playlist-end', String(config.limits.playlistLimit),
    ...(impersonate ? impersonateArgs() : []),
    '--', // nothing after this is read as an option
    url,
  ]);
}

let extractorListPromise = null;
function listExtractors() {
  if (!extractorListPromise) {
    extractorListPromise = new Promise((resolve) => {
      const child = spawnYtDlp(['--list-extractors']);
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('error', () => resolve([]));
      child.on('close', () => {
        const names = out
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s && !/\(CURRENTLY BROKEN\)/.test(s) && !/^generic$/i.test(s));
        resolve(names);
      });
    }).then((names) => {
      if (!names.length) extractorListPromise = null; // retry next time
      return names;
    });
  }
  return extractorListPromise;
}

// ---------- format -> download option normalization ----------

function isUsable(f) {
  if (!f || !f.url) return false;
  if (f.has_drm) return false;
  if (f.ext === 'mhtml' || f.protocol === 'mhtml' || /storyboard/i.test(f.format_note || '')) return false;
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(f.ext)) return false;
  return true;
}

// Only an explicit codec of "none" means a stream is missing. Unknown codecs
// (common with generic/direct files) usually mean both are present; yt-dlp's
// derived audio_ext/video_ext fields say "none" in that case, so ignore them.
function classify(f) {
  const hasVideo = f.vcodec ? f.vcodec !== 'none' : !(AUDIO_EXTS.has(f.ext) || f.resolution === 'audio only');
  const hasAudio = f.acodec ? f.acodec !== 'none' : true;
  return { hasVideo, hasAudio };
}

function heightOf(f) {
  if (f.height) return Math.round(f.height);
  const m = /(\d{3,4})p/.exec(f.format_note || f.format || '') || /x(\d{3,4})$/.exec(f.resolution || '');
  return m ? Number(m[1]) : 0;
}

function isDirect(f) {
  const proto = String(f.protocol || (/^https?:/i.test(f.url) ? 'https' : '')).split('+')[0];
  return DIRECT_PROTOCOLS.has(proto) && !f.fragments && !f.manifest_url;
}

function codecScore(f) {
  const v = String(f.vcodec || '').toLowerCase();
  if (v.startsWith('avc') || v.startsWith('h264')) return 4; // plays everywhere
  if (v.startsWith('av01')) return 3;
  if (v.startsWith('hev') || v.startsWith('hvc') || v.startsWith('h265')) return 2;
  if (!v || v === 'unknown') return 2;
  return 1; // vp9 / vp8 / others
}

function videoScore(f) {
  return (isDirect(f) ? 1e9 : 0) + codecScore(f) * 1e7 + (f.ext === 'mp4' ? 1e6 : 0) + (f.fps || 0) * 1e3 + (f.tbr || 0);
}

function audioScore(f) {
  const drc = /drc/i.test(f.format_id || '') || /DRC/.test(f.format_note || '');
  return (drc ? 0 : 1e9) + (isDirect(f) ? 1e8 : 0) + (f.ext === 'm4a' ? 1e6 : 0) + (f.abr || f.tbr || 0);
}

function best(list, score) {
  let top = null;
  for (const x of list) if (!top || score(x) > score(top)) top = x;
  return top;
}

const sizeOf = (f) => f.filesize || f.filesize_approx || null;

function videoNote(f) {
  const notes = [];
  if (f.fps && f.fps > 30) notes.push(`${Math.round(f.fps)}fps`);
  if (f.dynamic_range && f.dynamic_range !== 'SDR') notes.push(f.dynamic_range);
  return notes.join(' ');
}

function qualityText(h, f) {
  if (h) return String(h);
  return (f.format_note && !/^(default|unknown)$/i.test(f.format_note) ? f.format_note : '').slice(0, 20);
}

function buildOptions(info) {
  const raw = info.formats && info.formats.length ? info.formats : info.url ? [info] : [];
  const formats = raw.filter(isUsable).map((f) => ({ ...f, ...classify(f), _h: heightOf(f) }));

  const combined = formats.filter((f) => f.hasVideo && f.hasAudio);
  const videoOnly = formats.filter((f) => f.hasVideo && !f.hasAudio);
  let audioOnly = formats.filter((f) => !f.hasVideo && f.hasAudio);
  const nonDrc = audioOnly.filter((f) => !/drc/i.test(f.format_id || ''));
  if (nonDrc.length) audioOnly = nonDrc;
  const bestAudio = best(audioOnly, audioScore);

  const options = [];
  const add = (o) => {
    if (!options.some((x) => x.key === o.key)) options.push(o);
  };

  // Video with sound, one per resolution (highest first)
  const heights = [...new Set([...combined, ...videoOnly].map((f) => f._h))].sort((a, b) => b - a);
  const combinedOption = (comb, h) => {
    const direct = isDirect(comb);
    const ext = direct ? comb.ext || 'mp4' : 'mp4';
    return {
      key: `v-${comb.format_id}`,
      group: 'video',
      ext,
      label: ext.toUpperCase(),
      quality: qualityText(h, comb),
      note: videoNote(comb),
      hasAudio: true,
      size: sizeOf(comb),
      mode: direct ? 'direct' : 'job',
      formatId: comb.format_id,
      selector: comb.format_id,
      kind: direct ? 'direct' : 'single',
      height: h,
    };
  };
  for (const h of heights) {
    if (h === 0) {
      // Resolution unknown (common on generic pages): files can't be ranked, so list each one.
      combined
        .filter((f) => f._h === 0)
        .sort((a, b) => videoScore(b) - videoScore(a))
        .slice(0, 8)
        .forEach((f) => add(combinedOption(f, 0)));
      continue;
    }
    const comb = best(combined.filter((f) => f._h === h), videoScore);
    const vo = best(videoOnly.filter((f) => f._h === h), videoScore);
    if (comb && (isDirect(comb) || !(vo && bestAudio))) {
      add(combinedOption(comb, h));
    } else if (vo && bestAudio) {
      const vs = sizeOf(vo);
      const as = sizeOf(bestAudio);
      add({
        key: `m-${vo.format_id}+${bestAudio.format_id}`,
        group: 'video',
        ext: 'mp4',
        label: 'MP4',
        quality: qualityText(h, vo),
        note: videoNote(vo),
        hasAudio: true,
        size: vs && as ? vs + as : null,
        mode: 'job',
        selector: `${vo.format_id}+${bestAudio.format_id}`,
        kind: 'merge',
        weights: vs && as ? [vs / (vs + as), as / (vs + as)] : [0.85, 0.15],
        height: h,
      });
    }
  }

  // Audio
  if (bestAudio || combined.length) {
    const dur = info.duration || 0;
    add({
      key: 'mp3',
      group: 'audio',
      ext: 'mp3',
      label: 'MP3',
      quality: '192k',
      note: '',
      hasAudio: true,
      size: dur ? Math.round((dur * 192_000) / 8) : null,
      mode: 'job',
      selector: bestAudio ? `${bestAudio.format_id}` : 'bestaudio/best',
      kind: 'mp3',
    });
  }
  const audioByExt = new Map();
  // Manifest-only audio (HLS/DASH) is only worth listing when no plain file exists.
  const directAudio = audioOnly.filter(isDirect);
  for (const f of directAudio.length ? directAudio : audioOnly) {
    const cur = audioByExt.get(f.ext);
    if (!cur || audioScore(f) > audioScore(cur)) audioByExt.set(f.ext, f);
  }
  for (const f of [...audioByExt.values()].sort((a, b) => audioScore(b) - audioScore(a))) {
    const direct = isDirect(f);
    const abr = Math.round(f.abr || f.tbr || 0);
    add({
      key: `a-${f.format_id}`,
      group: 'audio',
      ext: f.ext,
      label: `Audio ${f.ext === 'webm' ? 'WEBM' : f.ext.toUpperCase()}`,
      quality: abr ? String(abr) : '',
      note: f.acodec && f.acodec !== 'none' ? String(f.acodec).split('.')[0] : '',
      hasAudio: true,
      size: sizeOf(f),
      mode: direct ? 'direct' : 'job',
      formatId: f.format_id,
      selector: f.format_id,
      kind: direct ? 'direct' : 'single',
    });
  }

  // Video without sound: one direct stream per resolution (most compatible codec)
  const voHeights = [...new Set(videoOnly.map((f) => f._h))].sort((a, b) => b - a);
  for (const h of voHeights) {
    const f = best(videoOnly.filter((x) => x._h === h && isDirect(x)), videoScore);
    if (f) {
      add({
        key: `n-${f.format_id}`,
        group: 'videoOnly',
        ext: f.ext,
        label: f.ext.toUpperCase(),
        quality: qualityText(h, f),
        note: videoNote(f),
        hasAudio: false,
        size: sizeOf(f),
        mode: 'direct',
        formatId: f.format_id,
        selector: f.format_id,
        kind: 'direct',
      });
    }
  }

  return { options, defaultKey: pickDefault(options), formatsById: new Map(formats.map((f) => [f.format_id, f])) };
}

function pickDefault(options) {
  const videos = options.filter((o) => o.group === 'video');
  if (videos.length) {
    const atMost720 = videos.filter((o) => o.height && o.height <= 720);
    if (atMost720.length) {
      // Best quality up to 720p; between equal heights the instant (direct) file wins.
      return best(atMost720, (o) => o.height * 2 + (o.mode === 'direct' ? 1 : 0)).key;
    }
    return videos[videos.length - 1].key;
  }
  return options[0] ? options[0].key : null;
}

function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function bestThumbnail(info) {
  if (info.thumbnail) return info.thumbnail;
  const list = (info.thumbnails || []).filter((t) => t.url);
  if (!list.length) return null;
  const sized = list.filter((t) => t.width && t.width <= 1280).sort((a, b) => b.width - a.width);
  return (sized[0] || list[list.length - 1]).url;
}

function embedUrl(info) {
  const ex = String(info.extractor_key || info.extractor || '').toLowerCase();
  if (!info.id) return null;
  if (ex === 'youtube') return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(info.id)}?autoplay=1`;
  if (ex === 'vimeo') return `https://player.vimeo.com/video/${encodeURIComponent(info.id)}?autoplay=1`;
  if (ex === 'dailymotion') return `https://www.dailymotion.com/embed/video/${encodeURIComponent(info.id)}?autoplay=1`;
  return null;
}

module.exports = {
  spawnYtDlp,
  runJson,
  extractInfo,
  impersonateArgs,
  looksBlocked,
  listExtractors,
  mapError,
  buildOptions,
  formatDuration,
  bestThumbnail,
  embedUrl,
  isDirect,
  classify,
};
