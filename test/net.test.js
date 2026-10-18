const test = require('node:test');
const assert = require('node:assert');
const { safeFetch } = require('../src/net');

const blocked = async (url) => {
  try {
    await safeFetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (e) {
    return (e.cause && e.cause.code) || e.code;
  }
  return 'not blocked';
};

test('server-side requests cannot reach the local network', async () => {
  assert.equal(await blocked('http://127.0.0.1:8081/'), 'EBLOCKED');
  assert.equal(await blocked('http://[::1]:8081/'), 'EBLOCKED');
  assert.equal(await blocked('http://169.254.169.254/latest/meta-data/'), 'EBLOCKED', 'cloud metadata service');
  assert.equal(await blocked('http://10.0.0.1/'), 'EBLOCKED');
  assert.equal(await blocked('http://localhost:8081/'), 'EBLOCKED', 'names that resolve to private addresses');
});
