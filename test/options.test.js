const test = require('node:test');
const assert = require('node:assert');
const { buildOptions, classify, formatDuration } = require('../src/ytdlp');

const yt = {
  duration: 635,
  formats: [
    { format_id: 'sb0', ext: 'mhtml', protocol: 'mhtml', url: 'https://x/sb', vcodec: 'none', acodec: 'none' },
    { format_id: '140', ext: 'm4a', protocol: 'https', url: 'https://x/140', vcodec: 'none', acodec: 'mp4a.40.2', abr: 129, filesize: 10_000_000 },
    { format_id: '140-drc', ext: 'm4a', protocol: 'https', url: 'https://x/140d', vcodec: 'none', acodec: 'mp4a.40.2', abr: 129 },
    { format_id: '251', ext: 'webm', protocol: 'https', url: 'https://x/251', vcodec: 'none', acodec: 'opus', abr: 128 },
    { format_id: '233', ext: 'mp4', protocol: 'm3u8_native', url: 'https://x/233.m3u8', vcodec: 'none' },
    { format_id: '136', ext: 'mp4', protocol: 'https', url: 'https://x/136', vcodec: 'avc1.4d401f', acodec: 'none', height: 720, fps: 30, tbr: 1000, filesize: 50_000_000 },
    { format_id: '247', ext: 'webm', protocol: 'https', url: 'https://x/247', vcodec: 'vp9', acodec: 'none', height: 720, fps: 30, tbr: 900 },
    { format_id: '137', ext: 'mp4', protocol: 'https', url: 'https://x/137', vcodec: 'avc1.640028', acodec: 'none', height: 1080, fps: 30, tbr: 2500 },
    { format_id: '18', ext: 'mp4', protocol: 'https', url: 'https://x/18', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', height: 360, tbr: 500 },
  ],
};

test('progressive formats download directly, higher qualities are merged', () => {
  const { options, defaultKey } = buildOptions(yt);
  const byKey = Object.fromEntries(options.map((o) => [o.key, o]));
  assert.equal(byKey['v-18'].mode, 'direct');
  assert.equal(byKey['m-136+140'].mode, 'job');
  assert.equal(byKey['m-136+140'].kind, 'merge');
  assert.equal(byKey['m-136+140'].size, 60_000_000);
  assert.equal(byKey['m-137+140'].quality, '1080');
  assert.equal(defaultKey, 'm-136+140', 'defaults to the best quality up to 720p');
});

test('audio: MP3 conversion plus one direct stream per container, no DRC or manifest duplicates', () => {
  const { options } = buildOptions(yt);
  const audio = options.filter((o) => o.group === 'audio').map((o) => o.key);
  assert.deepEqual(audio, ['mp3', 'a-140', 'a-251']);
});

test('video without sound: one entry per resolution preferring H.264 MP4', () => {
  const { options } = buildOptions(yt);
  const vo = options.filter((o) => o.group === 'videoOnly');
  assert.deepEqual(vo.map((o) => o.key), ['n-137', 'n-136']);
  assert.ok(vo.every((o) => o.hasAudio === false));
});

test('storyboards are never offered', () => {
  const { options } = buildOptions(yt);
  assert.ok(!options.some((o) => o.key.includes('sb0')));
});

test('a plain file with unknown codecs counts as video with sound', () => {
  const info = { url: 'https://cdn/x.mp4', ext: 'mp4', format_id: 'mp4', protocol: 'https', vcodec: null, audio_ext: 'none', video_ext: 'mp4' };
  assert.deepEqual(classify(info), { hasVideo: true, hasAudio: true });
  const { options, defaultKey } = buildOptions(info);
  assert.equal(options[0].group, 'video');
  assert.equal(options[0].mode, 'direct');
  assert.equal(defaultKey, options[0].key);
});

test('HLS-only sites get prepared downloads', () => {
  const info = {
    formats: [
      { format_id: 'hls-720', ext: 'mp4', protocol: 'm3u8_native', url: 'https://x/720.m3u8', vcodec: 'avc1', acodec: 'mp4a', height: 720 },
      { format_id: 'hls-480', ext: 'mp4', protocol: 'm3u8_native', url: 'https://x/480.m3u8', vcodec: 'avc1', acodec: 'mp4a', height: 480 },
    ],
  };
  const { options } = buildOptions(info);
  assert.deepEqual(options.filter((o) => o.group === 'video').map((o) => [o.quality, o.mode, o.kind]), [
    ['720', 'job', 'single'],
    ['480', 'job', 'single'],
  ]);
});

test('formatDuration', () => {
  assert.equal(formatDuration(635), '10:35');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(null), '');
});
