// Subtitle tracks -> SRT / VTT / TXT, plus the cue list used by the transcript tool.
const fs = require('fs');
const path = require('path');
const yt = require('./ytdlp');
const { HttpError } = require('./security');
const { safeFetch } = require('./net');

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

function listTracks(record) {
  const tracks = [];
  for (const [lang, list] of Object.entries(record.subtitles || {})) {
    if (lang === 'live_chat' || !Array.isArray(list) || !list.length) continue;
    tracks.push({ lang, name: (list[0].name || lang).toString(), auto: false, original: true });
  }
  const auto = Object.entries(record.autoCaptions || {}).filter(([, l]) => Array.isArray(l) && l.length);
  for (const [lang, list] of auto) {
    const name = (list[0].name || lang).toString();
    // YouTube marks the spoken-language track "(auto-generated)" or with an "-orig" key; the rest are machine translations.
    const original = /-orig$/.test(lang) || /auto-generated|original/i.test(name) || auto.length === 1;
    tracks.push({ lang, name, auto: true, original });
  }
  tracks.sort((a, b) => Number(a.auto) - Number(b.auto) || Number(b.original) - Number(a.original) || a.name.localeCompare(b.name));
  return tracks;
}

function pickTrack(record, lang, auto) {
  const list = (auto ? record.autoCaptions : record.subtitles)[lang];
  if (!Array.isArray(list) || !list.length) throw new HttpError(404, 'This subtitle language is not available.', 'no_track');
  for (const ext of ['json3', 'vtt', 'srv1', 'srv3', 'ttml']) {
    const t = list.find((x) => x.ext === ext && x.url);
    if (t) return t;
  }
  return list.find((x) => x.url);
}

// ---------- parsers ----------
function parseJson3(text) {
  const data = JSON.parse(text);
  const cues = [];
  for (const ev of data.events || []) {
    if (!ev.segs) continue;
    const t = ev.segs.map((s) => s.utf8 || '').join('').replace(/\s*\n\s*/g, ' ').trim();
    if (!t) continue;
    const start = (ev.tStartMs || 0) / 1000;
    cues.push({ start, end: start + (ev.dDurationMs || 0) / 1000, text: decode(t) });
  }
  return cues;
}

function parseTimestamp(s) {
  const p = s.trim().replace(',', '.').split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}

function parseVtt(text) {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  const cues = [];
  let prevLines = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = parseTimestamp(a);
    const end = parseTimestamp(b.trim().split(/\s+/)[0]);
    const textLines = lines
      .slice(i + 1)
      .map((l) => decode(l.replace(/<[^>]+>/g, '')).trim())
      .filter(Boolean);
    // Auto captions "roll": each cue repeats the previous line. Keep only new lines.
    const fresh = textLines.filter((l) => !prevLines.includes(l));
    if (textLines.length) prevLines = textLines;
    if (!fresh.length) {
      if (cues.length) cues[cues.length - 1].end = Math.max(cues[cues.length - 1].end, end);
      continue;
    }
    cues.push({ start, end, text: fresh.join(' ') });
  }
  return cues;
}

function parseXmlTimedText(text) {
  // srv1/srv3/ttml: <text start="1.2" dur="3"> or <p t="1200" d="3000"> or <p begin="00:00:01.200" end="...">
  const cues = [];
  const re = /<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(text))) {
    const attrs = m[2];
    const attr = (n) => (new RegExp(`\\b${n}="([^"]*)"`).exec(attrs) || [])[1];
    let start;
    let end;
    if (attr('start') !== undefined) {
      start = Number(attr('start'));
      end = start + Number(attr('dur') || 0);
    } else if (attr('t') !== undefined) {
      start = Number(attr('t')) / 1000;
      end = start + Number(attr('d') || 0) / 1000;
    } else if (attr('begin') !== undefined) {
      start = parseTimestamp(attr('begin'));
      end = attr('end') ? parseTimestamp(attr('end')) : start;
    } else continue;
    const t = decode(m[3].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (t) cues.push({ start, end, text: t });
  }
  return cues;
}

function parseAny(text, ext) {
  const trimmed = text.trimStart();
  if (ext === 'json3' || trimmed.startsWith('{')) return parseJson3(text);
  if (ext === 'vtt' || trimmed.startsWith('WEBVTT')) return parseVtt(text);
  if (/-->/.test(text) && /^\d+\s*$/m.test(text)) return parseVtt(text); // SRT is close enough to VTT for parsing
  return parseXmlTimedText(text);
}

function tidy(cues) {
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    if (next && cues[i].end > next.start) cues[i].end = next.start;
    if (cues[i].end <= cues[i].start) cues[i].end = cues[i].start + 2;
  }
  return cues;
}

// ---------- formatters ----------
function stamp(sec, sep) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}

function shortStamp(sec) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
}

const toSrt = (cues) => cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`).join('\n');
const toVtt = (cues) => 'WEBVTT\n\n' + cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`).join('\n');
const toTxt = (cues, timestamps) => cues.map((c) => (timestamps ? `[${shortStamp(c.start)}] ${c.text}` : c.text)).join('\n') + '\n';

// ---------- fetching ----------
async function fetchViaYtDlp(record, lang, auto) {
  const dir = fs.mkdtempSync(path.join(require('./config').dirs.tmp, 'sub-'));
  try {
    await new Promise((resolve, reject) => {
      const child = yt.spawnYtDlp([
        '--skip-download', '--no-playlist',
        auto ? '--write-auto-subs' : '--write-subs',
        '--sub-langs', lang,
        '--sub-format', 'json3/vtt/srv3/best',
        '-o', path.join(dir, 'sub.%(ext)s'),
        '--',
        record.url,
      ]);
      let err = '';
      child.stderr.on('data', (d) => (err += d));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(yt.mapError(err))));
    });
    const file = fs.readdirSync(dir).find((f) => f.startsWith('sub.'));
    if (!file) throw new HttpError(404, 'No subtitles were found for this language.', 'no_track');
    return { text: fs.readFileSync(path.join(dir, file), 'utf8'), ext: file.split('.').pop() };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function getCues(record, lang, auto) {
  record.cueCache = record.cueCache || new Map();
  const cacheKey = `${auto ? 'a' : 's'}:${lang}`;
  if (record.cueCache.has(cacheKey)) return record.cueCache.get(cacheKey);
  const track = pickTrack(record, lang, auto);
  let cues = [];
  try {
    const r = await safeFetch(track.url, { headers: { 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(20_000) });
    if (r.ok) cues = parseAny(await r.text(), track.ext);
  } catch {}
  if (!cues.length) {
    const { text, ext } = await fetchViaYtDlp(record, lang, auto);
    cues = parseAny(text, ext);
  }
  if (!cues.length) throw new HttpError(404, 'These subtitles are empty.', 'empty_track');
  tidy(cues);
  record.cueCache.set(cacheKey, cues);
  return cues;
}

module.exports = { listTracks, getCues, parseJson3, parseVtt, parseXmlTimedText, parseAny, tidy, toSrt, toVtt, toTxt, shortStamp };
