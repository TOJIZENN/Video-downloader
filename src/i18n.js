const fs = require('fs');
const path = require('path');
const config = require('./config');

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ru', name: 'Русский' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'ar', name: 'العربية', rtl: true },
];
const CODES = new Set(LANGUAGES.map((l) => l.code));
const dicts = {};
for (const { code } of LANGUAGES) {
  dicts[code] = JSON.parse(fs.readFileSync(path.join(config.root, 'locales', `${code}.json`), 'utf8'));
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function translator(lang) {
  const d = dicts[lang] || dicts.en;
  const t = (key, vars = {}) =>
    String(d[key] ?? dicts.en[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : k === 'brand' ? config.brand.name : m));
  // Same as t(), but vars are trusted HTML (links inside a sentence).
  t.html = (key, htmlVars = {}) =>
    escapeHtml(t(key, Object.fromEntries(Object.keys(htmlVars).map((k) => [k, `\u0000${k}\u0000`])))).replace(/\u0000(\w+)\u0000/g, (_, k) => htmlVars[k]);
  return t;
}

// Strings the browser scripts need, sent as a JSON <script> block.
function clientStrings(lang) {
  const d = { ...dicts.en, ...(dicts[lang] || {}) };
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (/^(res|job|toast|rate|conv|subs|recent|dock|mode)\./.test(k) || k === 'form.invalid' || k === 'form.download' || k === 'form.pasteHint' || k === 'form.paste') {
      out[k] = v.replace(/\{brand\}/g, config.brand.name);
    }
  }
  return out;
}

function negotiate(header) {
  for (const part of String(header || '').split(',')) {
    const code = part.split(';')[0].trim().toLowerCase().split('-')[0];
    if (CODES.has(code)) return code;
  }
  return 'en';
}

function middleware(req, res, next) {
  let lang = null;
  const q = String(req.query.lang || '').toLowerCase();
  if (CODES.has(q)) {
    lang = q;
    res.cookie('lang', q, { maxAge: 365 * 864e5, sameSite: 'lax', httpOnly: false });
  } else {
    const c = /(?:^|;\s*)lang=([a-z]{2})/.exec(req.headers.cookie || '');
    lang = c && CODES.has(c[1]) ? c[1] : negotiate(req.headers['accept-language']);
  }
  const info = LANGUAGES.find((l) => l.code === lang);
  res.locals.lang = lang;
  res.locals.dir = info.rtl ? 'rtl' : 'ltr';
  res.locals.t = translator(lang);
  res.locals.languages = LANGUAGES;
  res.locals.langName = info.name;
  res.locals.clientStrings = clientStrings(lang);
  next();
}

module.exports = { middleware, LANGUAGES, translator, escapeHtml };
