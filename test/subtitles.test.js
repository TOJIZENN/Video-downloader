const test = require('node:test');
const assert = require('node:assert');
const subs = require('../src/subtitles');

test('json3 events become cues', () => {
  const json = JSON.stringify({
    events: [
      { tStartMs: 0, dDurationMs: 1000 },
      { tStartMs: 1200, dDurationMs: 2000, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
      { tStartMs: 3300, dDurationMs: 1500, segs: [{ utf8: '\n' }] },
      { tStartMs: 5000, dDurationMs: 1000, segs: [{ utf8: 'Tom &amp; Jerry' }] },
    ],
  });
  assert.deepEqual(subs.parseJson3(json), [
    { start: 1.2, end: 3.2, text: 'Hello world' },
    { start: 5, end: 6, text: 'Tom & Jerry' },
  ]);
});

test('rolling auto-caption VTT keeps only new lines', () => {
  const vtt = [
    'WEBVTT',
    '',
    '00:00:01.000 --> 00:00:03.000 align:start position:0%',
    'first<00:00:01.500><c> line</c>',
    '',
    '00:00:03.000 --> 00:00:03.010',
    'first line',
    '',
    '00:00:03.010 --> 00:00:05.000',
    'first line',
    'second line',
  ].join('\n');
  const cues = subs.parseVtt(vtt);
  assert.deepEqual(cues.map((c) => c.text), ['first line', 'second line']);
});

test('srv/ttml-style XML', () => {
  const xml = '<transcript><text start="1.5" dur="2">Hi &amp;amp; bye</text><p t="4000" d="1000">Next<br/>line</p></transcript>';
  const cues = subs.parseXmlTimedText(xml);
  assert.equal(cues.length, 2);
  assert.equal(cues[1].text, 'Next line');
  assert.equal(cues[1].start, 4);
});

test('SRT, VTT and TXT output', () => {
  const cues = subs.tidy([
    { start: 61.5, end: 70, text: 'B' },
    { start: 1, end: 65, text: 'A' },
  ]);
  assert.equal(cues[0].end, 61.5, 'overlaps are trimmed');
  assert.equal(subs.toSrt(cues), '1\n00:00:01,000 --> 00:01:01,500\nA\n\n2\n00:01:01,500 --> 00:01:10,000\nB\n');
  assert.ok(subs.toVtt(cues).startsWith('WEBVTT\n\n00:00:01.000 --> 00:01:01.500\nA\n'));
  assert.equal(subs.toTxt(cues, true), '[0:01] A\n[1:01] B\n');
  assert.equal(subs.toTxt(cues, false), 'A\nB\n');
});

test('track list puts manual subtitles first, then the original auto track', () => {
  const tracks = subs.listTracks({
    subtitles: { en: [{ ext: 'vtt', url: 'u', name: 'English' }], live_chat: [{ url: 'x' }] },
    autoCaptions: {
      fr: [{ ext: 'vtt', url: 'u', name: 'French' }],
      'en-orig': [{ ext: 'vtt', url: 'u', name: 'English (Original)' }],
    },
  });
  assert.deepEqual(tracks.map((t) => [t.lang, t.auto, t.original]), [
    ['en', false, true],
    ['en-orig', true, true],
    ['fr', true, false],
  ]);
});
