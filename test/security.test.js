const test = require('node:test');
const assert = require('node:assert');
const { normalizeUserUrl, isPrivateIp, assertPublicUrl } = require('../src/security');

test('normalizes what people paste', () => {
  assert.equal(normalizeUserUrl('youtube.com/watch?v=abc'), 'https://youtube.com/watch?v=abc');
  assert.equal(normalizeUserUrl('  Check this https://youtu.be/abc?si=1 cool '), 'https://youtu.be/abc?si=1');
  assert.equal(normalizeUserUrl('https:/www.tiktok.com/@a/video/1'), 'https://www.tiktok.com/@a/video/1');
  assert.equal(normalizeUserUrl('hello'), null);
  assert.equal(normalizeUserUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUserUrl('ftp://example.com/x'), null);
  assert.equal(normalizeUserUrl(''), null);
  assert.equal(normalizeUserUrl(42), null);
});

test('private address detection', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0']) {
    assert.ok(isPrivateIp(ip), ip);
  }
  for (const ip of ['8.8.8.8', '142.250.1.1', '2606:4700::1111', '172.32.0.1']) {
    assert.ok(!isPrivateIp(ip), ip);
  }
});

test('blocks links to the server network', async () => {
  await assert.rejects(assertPublicUrl('http://127.0.0.1:3000/'), { code: 'blocked_host' });
  await assert.rejects(assertPublicUrl('http://localhost/'), { code: 'blocked_host' });
  await assert.rejects(assertPublicUrl('http://[::1]/'), { code: 'blocked_host' });
  await assert.rejects(assertPublicUrl('http://169.254.169.254/latest/meta-data'), { code: 'blocked_host' });
});
