const dns = require('dns').promises;
const net = require('net');
const config = require('./config');

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'error';
  }
}

// Accepts what people paste: bare domains, text around a link, "sfrom.net/https://..."-style prefixes.
function normalizeUserUrl(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  const embedded = s.match(/https?:\/\/[^\s"'<>]+/i);
  if (embedded) s = embedded[0];
  s = s.replace(/^(https?):\/(?!\/)/i, '$1://'); // proxies sometimes collapse "//"
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || (!host.includes('.') && !net.isIP(host) && host !== 'localhost')) return null;
  if (s.length > 4096) return null;
  return u.toString();
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb)/.test(v6);
}

// Blocks requests aimed at the server's own network (SSRF). yt-dlp's generic
// extractor and the media proxy will fetch whatever URL they are given.
async function assertPublicUrl(rawUrl) {
  if (config.allowPrivateUrls) return;
  const { hostname } = new URL(rawUrl);
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new HttpError(400, 'This address cannot be downloaded from.', 'blocked_host');
  }
  let addrs;
  try {
    addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  } catch {
    throw new HttpError(400, "We couldn't reach that website. Check the link and try again.", 'dns_failed');
  }
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new HttpError(400, 'This address cannot be downloaded from.', 'blocked_host');
  }
}

// Small fixed-window limiter; enough for a single-instance deployment.
function rateLimit({ windowMs, max, name }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.set('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.', code: 'rate_limited' });
    }
    next();
  };
}

module.exports = { HttpError, normalizeUserUrl, isPrivateIp, assertPublicUrl, rateLimit };
