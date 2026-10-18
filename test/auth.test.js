// Runs the real app with a password set and checks the private-access gate.
process.env.SITE_PASSWORD = 'correct horse battery staple';
process.env.AUTH_SECRET = 'x'.repeat(48);

const test = require('node:test');
const assert = require('node:assert');
const app = require('../server');
const { safePath } = require('../src/auth');

let base;
let server;
test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const page = (path, headers = {}) => fetch(base + path, { headers: { Accept: 'text/html', ...headers }, redirect: 'manual' });
const login = (password, next = '/', headers = {}) =>
  fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': 'same-origin', ...headers },
    body: new URLSearchParams({ password, next }).toString(),
    redirect: 'manual',
  });
const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

test('pages, API, scripts and styles are locked until signed in', async () => {
  const home = await page('/');
  assert.equal(home.status, 401);
  const html = await home.text();
  assert.match(html, /<form method="post" action="\/auth\/login">/);
  assert.match(html, /name="next" value="\/"/);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal(home.headers.get('cache-control'), 'no-store');

  const apiRes = await fetch(`${base}/api/rating`);
  assert.equal(apiRes.status, 401);
  assert.equal((await apiRes.json()).code, 'auth_required');

  for (const p of ['/css/style.css', '/js/app.js', '/helper-extension.zip', '/icons/youtube.svg']) {
    assert.equal((await fetch(base + p)).status, 401, p);
  }
});

test('the login page, app icons and health check stay public', async () => {
  for (const p of ['/auth/login', '/auth/login.css', '/img/logo.svg', '/img/icon-192.png', '/manifest.webmanifest', '/robots.txt', '/api/health']) {
    assert.equal((await fetch(base + p)).status, 200, p);
  }
  assert.match(await (await fetch(`${base}/robots.txt`)).text(), /Disallow: \//);
});

test('a wrong password is refused, slowly', async () => {
  const t = Date.now();
  const res = await login('nope');
  assert.equal(res.status, 401);
  assert.ok(Date.now() - t >= 900, 'answers are delayed to slow guessing');
  assert.equal(res.headers.get('set-cookie'), null);
  assert.match(await res.text(), /isn&#39;t right|isn't right/);
});

test('logins posted from other sites are rejected', async () => {
  const res = await login(process.env.SITE_PASSWORD, '/', { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(res.status, 403);
});

test('the right password signs in with a signed HttpOnly cookie and returns to the page', async () => {
  const res = await login(process.env.SITE_PASSWORD, '/youtube-downloader?url=https%3A%2F%2Fyoutu.be%2Fx');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/youtube-downloader?url=https%3A%2F%2Fyoutu.be%2Fx');
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /^__Host-fetchly-auth=\d+\.[\w-]+;/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Secure/);

  const cookie = cookieOf(res);
  assert.equal((await page('/', { Cookie: cookie })).status, 200);
  assert.equal((await fetch(`${base}/api/rating`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(`${base}/css/style.css`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(`${base}/auth/check`, { headers: { Cookie: cookie } })).status, 204);
});

test('tampered or expired cookies do not work', async () => {
  const cookie = cookieOf(await login(process.env.SITE_PASSWORD));
  const [name, value] = cookie.split('=');
  const [expires, sig] = value.split('.');
  const forged = `${name}=${Number(expires) + 1000}.${sig}`;
  assert.equal((await page('/', { Cookie: forged })).status, 401);
  assert.equal((await page('/', { Cookie: `${name}=1.${sig}` })).status, 401);
  assert.equal((await page('/', { Cookie: `${name}=garbage` })).status, 401);
});

test('signing out clears the cookie', async () => {
  const cookie = cookieOf(await login(process.env.SITE_PASSWORD));
  const res = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
});

test('the return address after login can only be a page on this site', () => {
  assert.equal(safePath('/faq'), '/faq');
  assert.equal(safePath('/?url=https%3A%2F%2Fexample.com'), '/?url=https%3A%2F%2Fexample.com');
  for (const bad of ['//evil.example', 'https://evil.example/', '/\\evil.example', '/auth/login', 'javascript:alert(1)', '', null]) {
    assert.equal(safePath(bad), '/', String(bad));
  }
});
