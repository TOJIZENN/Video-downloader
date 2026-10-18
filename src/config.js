const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const isWin = process.platform === 'win32';

function resolveYtDlp() {
  if (process.env.YTDLP_PATH) return { cmd: process.env.YTDLP_PATH, baseArgs: [] };
  const venvPython = path.join(root, '.venv', isWin ? 'Scripts/python.exe' : 'bin/python');
  if (fs.existsSync(venvPython)) return { cmd: venvPython, baseArgs: ['-m', 'yt_dlp'] };
  return { cmd: 'yt-dlp', baseArgs: [] };
}

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

module.exports = {
  root,
  brand: {
    // Rename the site in one place. Keep it distinct from existing services' trademarks.
    name: process.env.BRAND_NAME || 'Fetchly',
    tagline: 'Download videos from any site',
    year: new Date().getFullYear(),
  },
  production: process.env.NODE_ENV === 'production',
  // Private access: one shared password (same variables as the Yomikata site). See src/auth.js.
  auth: {
    password: process.env.SITE_PASSWORD || '',
    secret: process.env.AUTH_SECRET || '',
  },
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '127.0.0.1',
  publicUrl: process.env.PUBLIC_URL || '', // e.g. https://example.com (used in bookmarklet/extension hints)
  ytdlp: resolveYtDlp(),
  ffmpeg: resolveFfmpeg(),
  // yt-dlp needs a JavaScript runtime for YouTube; Node is always available here.
  jsRuntime: process.env.YTDLP_JS_RUNTIME || 'node',
  cookiesFile: process.env.COOKIES_FILE || '', // Netscape cookies.txt for sites that need a login
  // Use the logins of a browser on this machine, e.g. "firefox", "chrome", "edge", "firefox:Profile Name"
  cookiesFromBrowser: process.env.COOKIES_FROM_BROWSER || '',
  // Retry blocked sites while looking like a real browser (needs curl_cffi). "off" disables it.
  impersonate: process.env.IMPERSONATE === 'off' ? '' : process.env.IMPERSONATE || 'chrome',
  // Scan pages yt-dlp doesn't know for <video> tags and media links. "0" disables it.
  pageScan: process.env.PAGE_SCAN !== '0',
  proxy: process.env.YTDLP_PROXY || '',
  allowPrivateUrls: process.env.ALLOW_PRIVATE_URLS === '1',
  dirs: {
    tmp: path.join(root, 'tmp'),
    data: path.join(root, 'data'),
  },
  limits: {
    infoTimeoutMs: 90_000,
    infoCacheTtlMs: 30 * 60_000, // media URLs from most sites stay valid for a few hours
    jobTtlMs: 60 * 60_000, // finished files are kept for an hour, then deleted
    maxConcurrentJobs: Number(process.env.MAX_JOBS) || 3,
    maxQueuedJobs: 50,
    playlistLimit: 50,
    uploadMaxBytes: (Number(process.env.UPLOAD_MAX_MB) || 1024) * 1024 * 1024,
    gifMaxSeconds: 30,
    // New downloads/uploads are refused when the disk has less free space than this
    minFreeDiskMb: Number(process.env.MIN_FREE_DISK_MB) || 2048,
  },
};
