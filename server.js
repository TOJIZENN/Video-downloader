const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const auth = require('./src/auth');
const i18n = require('./src/i18n');
const apiRoutes = require('./src/routes/api');
const pageRoutes = require('./src/routes/pages');

const app = express();
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

const assetVersion = Date.now().toString(36);
app.locals.assetVersion = assetVersion;

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=63072000');
  if (auth.enabled) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      'frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.dailymotion.com',
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  next();
});

app.get('/robots.txt', (req, res) => {
  res.type('text').send(auth.enabled ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n');
});

// Everything below needs the shared password (when SITE_PASSWORD is set, and always in production).
app.use(auth.gate);

// Brand icons from the simple-icons package, tinted with the brand colour.
const iconsDir = path.dirname(require.resolve('simple-icons/icons/youtube.svg'));
const iconData = new Map(require('simple-icons/icons.json').map((i) => [i.slug, i.hex]));
const iconCache = new Map();
app.get('/icons/:slug.svg', (req, res) => {
  const slug = req.params.slug.toLowerCase();
  const white = req.query.c === 'white';
  const mono = req.query.c === 'mono';
  if (!/^[a-z0-9]+$/.test(slug) || !iconData.has(slug)) return res.status(404).end();
  const key = slug + (white ? ':w' : mono ? ':m' : '');
  if (!iconCache.has(key)) {
    const svg = fs.readFileSync(path.join(iconsDir, `${slug}.svg`), 'utf8');
    const fill = white ? '#ffffff' : mono ? '#8a8f98' : '#' + iconData.get(slug);
    iconCache.set(key, svg.replace('<svg ', `<svg fill="${fill}" `));
  }
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=604800').send(iconCache.get(key));
});

app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json').json({
    name: `${config.brand.name} - ${config.brand.tagline}`,
    short_name: config.brand.name,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    description: 'Download videos and music from YouTube, Facebook, Instagram, TikTok and more.',
    icons: [
      { src: '/img/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/img/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/img/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/img/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    share_target: { action: '/share', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
  });
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0, index: false }));

app.use('/api', apiRoutes);
app.use(i18n.middleware);
app.use(pageRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[page]', req.method, req.originalUrl, err.stack || err.message);
  if (res.headersSent) return res.destroy();
  res.status(err.status || 500).send('Something went wrong. Please try again.');
});

if (require.main === module) {
  app.listen(config.port, config.host, () => {
    const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
    console.log(`${config.brand.name} running at http://${shown}:${config.port}`);
    console.log(`  yt-dlp: ${config.ytdlp.cmd} ${config.ytdlp.baseArgs.join(' ')}`.trimEnd());
    console.log(`  ffmpeg: ${config.ffmpeg}`);
    if (!auth.enabled) console.warn('  Private access is OFF (no SITE_PASSWORD). Anyone who can reach this server can use it.');
    else if (auth.misconfigured) console.warn('  Private access is ON but not configured: set SITE_PASSWORD and AUTH_SECRET (32+ characters).');
    else console.log('  Private access is ON (password required).');
    if (config.production && !process.env.TRUST_PROXY) console.warn('  TRUST_PROXY is not set: behind a hosting proxy, rate limits and HTTPS detection need it (usually TRUST_PROXY=1).');
    if (config.allowPrivateUrls) console.warn('  ALLOW_PRIVATE_URLS is on: links to local/private network addresses are allowed. Never use this on a public server.');
  });
}

module.exports = app;
