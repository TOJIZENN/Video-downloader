const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { createZip } = require('../zip');
const auth = require('../auth');
const { platforms, bySlug, resourceTiles, tools, converters, converterBySlug } = require('../platforms');
const { homeContent, platformContent } = require('../content');
const { normalizeUserUrl } = require('../security');

const router = express.Router();
const brand = config.brand.name;

router.use((req, res, next) => {
  const origin = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  Object.assign(res.locals, {
    brand: config.brand,
    origin,
    host: origin.replace(/^https?:\/\//, ''),
    currentPath: req.path,
    canonical: origin + req.path,
    platforms,
    resourceTiles,
    tools,
    converters,
    navPlatforms: platforms.filter((p) => p.nav),
    featured: platforms.filter((p) => p.featured),
    uploadMaxMb: Math.round(config.limits.uploadMaxBytes / 1048576),
    gifMaxSeconds: config.limits.gifMaxSeconds,
    pageScripts: [],
    authEnabled: auth.enabled && !auth.misconfigured,
    icon: (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`,
  });
  next();
});

function prefillFrom(req) {
  return normalizeUserUrl(String(req.query.url || req.query.text || '')) || '';
}

function renderDownloader(req, res, p, prefill) {
  const t = res.locals.t;
  if (!p) {
    const c = homeContent(brand, res.locals.host);
    return res.render('home', {
      pageTitle: `${brand} — ${t('hero.title')}`,
      pageDescription: `${brand} downloads videos and music from YouTube, Facebook, Instagram, TikTok and 1,800+ sites in MP4, MP3 and other formats. Free, no app needed.`,
      h1: t('hero.title'),
      heroSub: t('hero.subtitle'),
      placeholder: t('form.placeholder'),
      platform: null,
      prefill,
      content: c,
      faq: c.faq,
    });
  }
  const c = platformContent(p, brand);
  const h1 = p.h1 || (p.audio ? t('hero.audioTitle', { site: p.site }) : t('hero.platformTitle', { site: p.site }));
  res.render('home', {
    pageTitle: `${h1} - ${brand}`,
    pageDescription: `${c.intro.slice(0, 155)}`,
    h1,
    heroSub: p.audio ? t('hero.audioSub', { site: p.site }) : t('hero.platformSub', { site: p.site }),
    placeholder: t('form.platformPlaceholder', { site: p.site }),
    platform: p,
    prefill,
    content: null,
    platformContent: c,
    faq: c.faq,
  });
}

router.get('/', (req, res) => renderDownloader(req, res, null, prefillFrom(req)));

for (const p of platforms) {
  router.get(`/${p.slug}`, (req, res) => renderDownloader(req, res, p, prefillFrom(req)));
}

// Web Share Target (installed app on Android): the shared link arrives in url or text.
router.get('/share', (req, res) => {
  const url = prefillFrom(req);
  res.redirect(url ? `/?url=${encodeURIComponent(url)}` : '/');
});

router.get('/how-to-download', (req, res) =>
  res.render('howto', { pageTitle: `How to download videos - ${brand}`, pageDescription: `Step-by-step guide to downloading videos and music with ${brand} on computers, Android and iPhone.` })
);

router.get('/install', (req, res) =>
  res.render('install', {
    pageTitle: `${brand} Helper - one-click downloads`,
    pageDescription: `Install the ${brand} Helper browser extension, bookmarklet or home-screen app for one-click video downloads.`,
    pageScripts: ['/js/install.js'],
  })
);

router.get('/faq', (req, res) => {
  const c = homeContent(brand, res.locals.host);
  res.render('faq', { pageTitle: `Frequently asked questions - ${brand}`, pageDescription: `Answers to common questions about downloading videos with ${brand}.`, faq: c.faq });
});

router.get('/supported-sites', (req, res) =>
  res.render('sites', {
    pageTitle: `Supported sites - ${brand}`,
    pageDescription: `Searchable list of the websites ${brand} can download videos and audio from.`,
    pageScripts: ['/js/sites.js'],
  })
);

for (const [slug, mode] of [['youtube-transcript', 'transcript'], ['youtube-subtitles', 'subtitles']]) {
  router.get(`/${slug}`, (req, res) => {
    const t = res.locals.t;
    const h1 = mode === 'transcript' ? t('subs.transcriptTitle') : t('subs.title');
    res.render('subtitles', {
      pageTitle: `${h1} - ${brand}`,
      pageDescription:
        mode === 'transcript'
          ? 'Get the full text of any YouTube video with timestamps. Search it, copy it or download it as TXT.'
          : 'Download YouTube subtitles and auto-generated captions in SRT, VTT or TXT, in any available language.',
      h1,
      mode,
      prefill: prefillFrom(req),
      pageScripts: ['/js/subtitles.js'],
    });
  });
}

for (const c of converters) {
  router.get(`/${c.slug}`, (req, res) =>
    res.render('converter', {
      pageTitle: `${c.label} Converter - ${brand}`,
      pageDescription: `Convert ${c.from} to ${c.to} online for free. Upload a file up to ${res.locals.uploadMaxMb} MB, no sign-up.`,
      conv: converterBySlug.get(c.slug),
      pageScripts: ['/js/converter.js'],
    })
  );
}

// The Helper extension, pre-configured with this site's address and name.
router.get('/helper-extension.zip', (req, res) => {
  const dir = path.join(config.root, 'extension');
  const files = [];
  (function walk(rel) {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(name);
      else files.push(name);
    }
  })('');
  const out = files.map((name) => {
    let data = fs.readFileSync(path.join(dir, name));
    if (name === 'config.js') {
      data = Buffer.from(`self.HELPER_CONFIG = ${JSON.stringify({ site: res.locals.origin, brand })};\n`);
    } else if (name === 'manifest.json') {
      data = Buffer.from(data.toString('utf8').replace(/Fetchly/g, brand));
    }
    return { name: `${brand.toLowerCase()}-helper/${name}`, data };
  });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${brand.toLowerCase()}-helper.zip"`);
  res.send(createZip(out));
});

router.get('/api-docs', (req, res) =>
  res.render('api', { pageTitle: `API and tools for webmasters - ${brand}`, pageDescription: `JSON API, link shortcuts and buttons for adding ${brand} downloads to your site.` })
);

router.get('/feedback', (req, res) =>
  res.render('feedback', { pageTitle: `Feedback - ${brand}`, pageDescription: `Report a problem or send a suggestion to the ${brand} team.`, pageScripts: ['/js/feedback.js'] })
);

router.get('/terms', (req, res) => res.render('legal', { pageTitle: `Terms of Service - ${brand}`, pageDescription: `Terms of Service for ${brand}.`, doc: 'terms' }));
router.get('/privacy', (req, res) => res.render('legal', { pageTitle: `Privacy Policy - ${brand}`, pageDescription: `How ${brand} handles your data.`, doc: 'privacy' }));

// "Type before the link" shortcut: /https://www.youtube.com/watch?v=... or /youtube.com/watch?v=...
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const rest = req.originalUrl.slice(1);
  const looksLikeLink = /^(https?:\/\/?|www\.)/i.test(rest) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\/./i.test(rest);
  if (!looksLikeLink) return next();
  let decoded = rest;
  try {
    decoded = decodeURIComponent(rest);
  } catch {}
  const url = normalizeUserUrl(/^https?%3A/i.test(rest) ? decoded : rest);
  if (!url) return next();
  res.locals.canonical = res.locals.origin + '/';
  res.locals.currentPath = '/';
  renderDownloader(req, res, null, url);
});

router.use((req, res) => {
  res.status(404).render('404', { pageTitle: `Page not found - ${brand}`, pageDescription: '' });
});

module.exports = router;
