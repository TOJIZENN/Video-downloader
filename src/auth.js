// One shared password in front of the whole site (same scheme as the Yomikata
// project's Vercel middleware): after the right password the browser gets a
// signed, HttpOnly cookie that lasts a year.
//
//   SITE_PASSWORD  the password you give to people
//   AUTH_SECRET    a long random string (32+ chars) that signs the cookie; never share it
// Changing either one signs everybody out. In production the site refuses to
// serve when they are missing; in development the gate is simply off.
const crypto = require('crypto');
const config = require('./config');

const COOKIE_SECURE = '__Host-fetchly-auth';
const COOKIE_PLAIN = 'fetchly-auth'; // http on a LAN address, where Secure cookies can't be set
const MAX_AGE = 365 * 24 * 60 * 60;
// Needed before signing in (login page, app install, host health checks) and not private.
const PUBLIC = /^\/(?:robots\.txt|manifest\.webmanifest|img\/logo\.svg|img\/icon-[\w-]+\.png|img\/app-icon[\w-]*\.svg|api\/health)$/;

const password = config.auth.password;
const secret = config.auth.secret;
const misconfigured = password ? secret.length < 32 : config.production;
const enabled = Boolean(password) || config.production;

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
const b64url = (buf) => buf.toString('base64url');

/** HMAC of the expiry plus a hash of the current password, so a new password voids old cookies. */
function sign(expires) {
  return b64url(crypto.createHmac('sha256', secret).update(`v1|${expires}|${b64url(hash(password))}`).digest());
}

function equal(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req) {
  const header = req.headers.cookie || '';
  for (const name of [COOKIE_SECURE, COOKIE_PLAIN]) {
    const part = header.split(/;\s*/).find((c) => c.startsWith(`${name}=`));
    if (part) return part.slice(name.length + 1);
  }
  return '';
}

function isSignedIn(req) {
  const [expires, sig] = readCookie(req).split('.');
  if (!expires || !sig || !/^\d+$/.test(expires) || Number(expires) < Date.now() / 1000) return false;
  return equal(sig, sign(expires));
}

/** Same-site path to return to after signing in. Anything else (other sites, //host) becomes "/". */
function safePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 2000) return '/';
  const base = 'https://x.invalid';
  let u;
  try {
    u = new URL(value, base);
  } catch {
    return '/';
  }
  return u.origin === base && !u.pathname.startsWith('/auth/') ? u.pathname + u.search : '/';
}

function isLocalhost(req) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.headers.host || '');
}

function noStore(res) {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function loginPage(res, nextPath, wrong, status) {
  noStore(res);
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.status(status).type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#4f46e5">
<title>${escapeHtml(config.brand.name)} — sign in</title>
<link rel="icon" href="/img/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="/auth/login.css">
</head>
<body>
<main>
  <div class="brand"><img src="/img/logo.svg" alt=""><h1>${escapeHtml(config.brand.name)}</h1></div>
  <p>This site is private. Enter the password you were given.</p>
  <form method="post" action="/auth/login">
    <input type="hidden" name="next" value="${escapeHtml(nextPath)}">
    <input type="text" name="username" value="${escapeHtml(config.brand.name.toLowerCase())}" autocomplete="username" hidden>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus maxlength="256"${wrong ? ' aria-describedby="error"' : ''}>
    ${wrong ? '<p class="error" id="error" role="alert">That password isn\'t right.</p>' : ''}
    <button type="submit">Enter</button>
  </form>
</main>
</body>
</html>`);
}

const LOGIN_CSS = `:root { --bg: #f7f7f9; --card: #ffffff; --ink: #111318; --muted: #6b6f78; --line: #e3e3e8; --accent: #4f46e5; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg: #0e0f12; --card: #16171b; --ink: #ececef; --muted: #9a9ea8; --line: #2a2b31; --accent: #7c83ff; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--ink);
       font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: 100%; max-width: 360px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 28px 24px; }
.brand { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.brand img { width: 36px; height: 36px; border-radius: 9px; }
h1 { font-size: 18px; margin: 0; }
p { margin: 0 0 18px; color: var(--muted); font-size: 14px; }
label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
input[type=password] { width: 100%; height: 44px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line);
       background: var(--bg); color: var(--ink); font-size: 16px; outline: none; }
input[type=password]:focus { border-color: var(--accent); }
button { margin-top: 14px; width: 100%; height: 44px; border: 0; border-radius: 10px; background: var(--accent); color: #fff;
       font-size: 15px; font-weight: 600; cursor: pointer; }
.error { color: #dc2626; font-size: 13px; margin: 8px 0 0; }
`;

// Slows down password guessing: a fixed number of attempts per IP per window.
const attempts = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
}, 60_000).unref();
function tooManyAttempts(ip) {
  const now = Date.now();
  let e = attempts.get(ip);
  if (!e || e.reset < now) attempts.set(ip, (e = { count: 0, reset: now + 15 * 60_000 }));
  e.count++;
  return e.count > 10;
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (d) => {
      body += d;
      if (body.length > 4096) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(new URLSearchParams(body)));
    req.on('error', reject);
  });
}

async function login(req, res) {
  // Only accept the form from this site
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).type('text').send('Forbidden');
  if (tooManyAttempts(req.ip)) {
    noStore(res);
    return res.status(429).type('text').send('Too many attempts. Try again in 15 minutes.');
  }
  let form;
  try {
    form = await readForm(req);
  } catch {
    return res.status(400).type('text').send('Bad request');
  }
  const given = String(form.get('password') || '').slice(0, 256);
  const nextPath = safePath(form.get('next'));
  // Compare fixed-length hashes so timing doesn't reveal where the strings differ
  if (!equal(hash(given).toString('hex'), hash(password).toString('hex'))) {
    await new Promise((r) => setTimeout(r, 1000));
    return loginPage(res, nextPath, true, 401);
  }
  attempts.delete(req.ip);
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE;
  const secure = req.secure || isLocalhost(req);
  const name = secure ? COOKIE_SECURE : COOKIE_PLAIN;
  res.append('Set-Cookie', `${name}=${expires}.${sign(expires)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
  noStore(res);
  res.redirect(303, nextPath);
}

function logout(req, res) {
  for (const name of [COOKIE_SECURE, COOKIE_PLAIN]) {
    res.append('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${name === COOKIE_SECURE ? '; Secure' : ''}`);
  }
  noStore(res);
  res.redirect(303, '/auth/login');
}

function isPageRequest(req) {
  return req.method === 'GET' && (req.headers['sec-fetch-mode'] === 'navigate' || (req.headers.accept || '').includes('text/html'));
}

function gate(req, res, next) {
  if (!enabled) return next();
  if (PUBLIC.test(req.path)) return next();
  if (misconfigured) {
    noStore(res);
    return res.status(500).type('text').send('This site is private, but its password is not set up yet (SITE_PASSWORD and AUTH_SECRET of 32+ characters).');
  }
  if (req.path === '/auth/login.css') return res.set('Cache-Control', 'no-store').type('css').send(LOGIN_CSS);

  const signedIn = isSignedIn(req);
  if (req.path === '/auth/login') {
    if (req.method === 'POST') return login(req, res).catch(next);
    if (signedIn) return res.redirect(303, safePath(req.query.next));
    return loginPage(res, safePath(req.query.next), false, 200);
  }
  if (req.path === '/auth/logout' && req.method === 'POST') return logout(req, res);
  if (req.path === '/auth/check') {
    noStore(res);
    return res.status(signedIn ? 204 : 401).end();
  }

  if (signedIn) return next();
  // Pages get the login form (401, so nothing caches it); files and API calls just get 401.
  if (isPageRequest(req)) return loginPage(res, safePath(req.originalUrl), false, 401);
  noStore(res);
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sign in required', code: 'auth_required' });
  return res.status(401).type('text').send('Sign in required');
}

module.exports = { gate, enabled, misconfigured, safePath, sign, isSignedIn };
