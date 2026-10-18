const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { createZip } = require('../src/zip');

// Reads entries back using the central directory, like an unzip tool would.
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26);
    const data = zlib.inflateRawSync(buf.subarray(local + 30 + lNameLen, local + 30 + lNameLen + compSize));
    assert.equal(zlib.crc32(data) >>> 0, crc, `crc of ${name}`);
    out[name] = data.toString('utf8');
    p += 46 + nameLen;
  }
  return out;
}

test('round-trips files', () => {
  const zip = createZip([
    { name: 'helper/manifest.json', data: Buffer.from('{"a":1}') },
    { name: 'helper/icons/ü.txt', data: Buffer.from('x'.repeat(5000)) },
  ]);
  assert.deepEqual(readZip(zip), { 'helper/manifest.json': '{"a":1}', 'helper/icons/ü.txt': 'x'.repeat(5000) });
});
