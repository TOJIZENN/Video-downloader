// Renders the logo (same geometry as public/img/logo.svg, in its 32-unit grid)
// to PNG without an image library: distance fields, 4x4 supersampling, zlib.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const FROM = [0x4f, 0x46, 0xe5];
const TO = [0x4f, 0x46, 0xe5];
// Downward "play" triangle with rounded corners, and the bar under it.
const TRI = [[10.4, 9.2], [21.6, 9.2], [16, 19.3]];
const TRI_ROUND = 1.1;
const BAR = { a: [11.1, 23.6], b: [20.9, 23.6], r: 1.6 };

function distSeg(px, py, [x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function insideTri(px, py, [a, b, c]) {
  const s = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = s(a, b, [px, py]);
  const d2 = s(b, c, [px, py]);
  const d3 = s(c, a, [px, py]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

// Shrink the triangle towards its incenter, then grow back with round corners.
function roundedTriangle(tri, r) {
  const [A, B, C] = tri;
  const len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const a = len(B, C);
  const b = len(C, A);
  const c = len(A, B);
  const per = a + b + c;
  const I = [(a * A[0] + b * B[0] + c * C[0]) / per, (a * A[1] + b * B[1] + c * C[1]) / per];
  const s = per / 2;
  const area = Math.sqrt(s * (s - a) * (s - b) * (s - c));
  const k = (area / s - r) / (area / s);
  const inner = tri.map((p) => [I[0] + (p[0] - I[0]) * k, I[1] + (p[1] - I[1]) * k]);
  return (x, y) =>
    insideTri(x, y, inner) || Math.min(distSeg(x, y, inner[0], inner[1]), distSeg(x, y, inner[1], inner[2]), distSeg(x, y, inner[2], inner[0])) <= r;
}
const inTri = roundedTriangle(TRI, TRI_ROUND);

function inRoundRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 32 - r);
  const cy = Math.min(Math.max(y, r), 32 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

function render(size, { maskable = false, radius = 7 } = {}) {
  const ss = 4;
  const px = Buffer.alloc(size * size * 4);
  const scale = maskable ? 0.72 : 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = ((x + (sx + 0.5) / ss) / size) * 32;
          const v = ((y + (sy + 0.5) / ss) / size) * 32;
          if (!(maskable || inRoundRect(u, v, radius))) continue;
          bg++;
          const du = (u - 16) / scale + 16;
          const dv = (v - 16) / scale + 16;
          if (inTri(du, dv) || distSeg(du, dv, BAR.a, BAR.b) <= BAR.r) fg++;
        }
      }
      const n = ss * ss;
      const t = (x + y) / (2 * (size - 1)); // diagonal gradient
      const i = (y * size + x) * 4;
      const f = bg ? fg / bg : 0;
      for (let c = 0; c < 3; c++) {
        const g = FROM[c] + (TO[c] - FROM[c]) * t;
        px[i + c] = Math.round(g * (1 - f) + 255 * f);
      }
      px[i + 3] = Math.round((bg / n) * 255);
    }
  }
  return encodePng(size, size, px);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outputs = [
  ...[16, 32, 48, 128].map((s) => [`extension/icons/icon${s}.png`, s, {}]),
  ['public/img/icon-192.png', 192, {}],
  ['public/img/icon-512.png', 512, {}],
  ['public/img/icon-maskable-512.png', 512, { maskable: true }],
];
for (const [file, size, opts] of outputs) {
  const dest = path.join(root, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, render(size, opts));
  console.log('wrote', file);
}
