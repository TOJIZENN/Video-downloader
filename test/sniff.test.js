const test = require('node:test');
const assert = require('node:assert');
const { parsePage, toInfo } = require('../src/sniff');
const { buildOptions } = require('../src/ytdlp');

const PAGE = 'https://videos.example.com/watch/123';

test('finds <video>/<source> files, resolving relative paths and labels', () => {
  const html = `
    <title>Clip &amp; more</title>
    <video poster="/p.jpg"><source src="/media/clip_720.mp4" type="video/mp4" label="720p"><source src="clip-low.webm" type="video/webm"></video>
    <img src="/logo.png">`;
  const r = parsePage(html, PAGE);
  assert.equal(r.title, 'Clip & more');
  assert.deepEqual(r.formats.map((f) => [f.url, f.ext, f.height]), [
    ['https://videos.example.com/media/clip_720.mp4', 'mp4', 720],
    ['https://videos.example.com/watch/clip-low.webm', 'webm', null],
  ]);
  assert.equal(r.formats[0].http_headers.Referer, PAGE, 'media is requested with the page as Referer');
});

test('reads Open Graph video and image', () => {
  const html = `<meta property="og:title" content="OG title"><meta property="og:image" content="https://cdn.example.com/t.jpg">
    <meta property="og:video:secure_url" content="https://cdn.example.com/v/1080/clip.mp4?token=a&amp;e=1">`;
  const r = parsePage(html, PAGE);
  assert.equal(r.title, 'OG title');
  assert.equal(r.thumbnail, 'https://cdn.example.com/t.jpg');
  assert.equal(r.formats[0].url, 'https://cdn.example.com/v/1080/clip.mp4?token=a&e=1');
  assert.equal(r.formats[0].height, 1080);
});

test('extracts JSON-escaped links from player configs, HLS included', () => {
  const html = `<script>var player = {"sources":[{"file":"https:\\/\\/cdn.example.com\\/hls\\/master.m3u8"},{"src":"https:\\u002F\\u002Fcdn.example.com\\u002F480\\u002Fv.mp4"}]};</script>`;
  const r = parsePage(html, PAGE);
  const byExt = Object.fromEntries(r.formats.map((f) => [f.url, f]));
  assert.equal(byExt['https://cdn.example.com/hls/master.m3u8'].protocol, 'm3u8_native');
  assert.equal(byExt['https://cdn.example.com/480/v.mp4'].height, 480);
});

test('ignores scripts, images and pages', () => {
  const html = `<script src="https://cdn.example.com/player.min.js"></script><a href="https://example.com/video.html">x</a>
    <link href="https://cdn.example.com/style.css"><img src="https://cdn.example.com/poster.mp4.jpg">`;
  assert.equal(parsePage(html, PAGE).formats.length, 0);
});

test('scan results become normal download options', () => {
  const html = `<video src="https://cdn.example.com/a/720p.mp4"></video><script>x="https://cdn.example.com/a/index.m3u8"</script>`;
  const info = toInfo(parsePage(html, PAGE), PAGE);
  const { options } = buildOptions(info);
  const video = options.filter((o) => o.group === 'video');
  assert.equal(video[0].mode, 'direct', 'the plain MP4 downloads instantly');
  assert.ok(options.some((o) => o.key === 'mp3'), 'MP3 is offered too');
});
