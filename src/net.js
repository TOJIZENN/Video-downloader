// fetch() for everything the server downloads itself (media, thumbnails,
// scanned pages, subtitles). Private and internal addresses are refused when
// the connection is made, so redirects and DNS tricks can't reach the
// server's own network either.
const dns = require('dns');
const net = require('net');
const { Agent, buildConnector, fetch } = require('undici');
const config = require('./config');
const { isPrivateIp } = require('./security');

function blocked() {
  const e = new Error('Blocked address');
  e.code = 'EBLOCKED';
  return e;
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return callback(err);
    const ok = config.allowPrivateUrls ? addrs : addrs.filter((a) => !isPrivateIp(a.address));
    if (!ok.length) return callback(blocked());
    if (options && options.all) return callback(null, ok);
    callback(null, ok[0].address, ok[0].family);
  });
}

const connectSafely = buildConnector({ lookup: safeLookup, timeout: 15_000 });

const agent = new Agent({
  connect(opts, callback) {
    const host = String(opts.hostname || '').replace(/^\[|\]$/g, '');
    // IP literals skip DNS, so check them here
    if (net.isIP(host) && !config.allowPrivateUrls && isPrivateIp(host)) return callback(blocked(), null);
    connectSafely(opts, callback);
  },
  headersTimeout: 30_000,
  bodyTimeout: 60_000,
});

function safeFetch(url, init = {}) {
  return fetch(url, { ...init, dispatcher: agent });
}

module.exports = { safeFetch };
