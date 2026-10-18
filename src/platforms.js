// One entry per landing page. Each page reuses the same downloader; the text
// and the default format change. Brand icons come from the simple-icons package.
const P = (o) => ({ audio: false, nav: false, featured: false, ...o });

const platforms = [
  P({ slug: 'youtube-downloader', site: 'YouTube', icon: 'youtube', domain: 'youtube.com', nav: true, featured: true, example: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', what: 'videos, Shorts and music videos' }),
  P({ slug: 'youtube-to-mp4', site: 'YouTube', icon: 'youtube', domain: 'youtube.com', h1: 'YouTube to MP4 Converter', what: 'videos as MP4 files', short: 'YouTube to MP4' }),
  P({ slug: 'youtube-shorts-downloader', site: 'YouTube Shorts', icon: 'youtube', domain: 'youtube.com/shorts', h1: 'YouTube Shorts Downloader', what: 'Shorts in full quality', short: 'YouTube Shorts' }),
  P({ slug: 'youtube-to-mp3', site: 'YouTube', icon: 'youtube', domain: 'youtube.com', audio: true, h1: 'YouTube to MP3 Converter', what: 'the audio of any video as MP3', short: 'YouTube MP3' }),
  P({ slug: 'facebook-video-downloader', site: 'Facebook', icon: 'facebook', domain: 'facebook.com', nav: true, featured: true, what: 'public videos, reels and watch clips' }),
  P({ slug: 'instagram-downloader', site: 'Instagram', icon: 'instagram', domain: 'instagram.com', nav: true, featured: true, what: 'public reels, videos and carousel posts' }),
  P({ slug: 'instagram-reels-downloader', site: 'Instagram Reels', icon: 'instagram', domain: 'instagram.com/reels', h1: 'Instagram Reels Downloader', what: 'public reels with their original sound', short: 'Instagram Reels' }),
  P({ slug: 'tiktok-downloader', site: 'TikTok', icon: 'tiktok', domain: 'tiktok.com', nav: true, featured: true, what: 'public TikTok videos' }),
  P({ slug: 'tiktok-to-mp3', site: 'TikTok', icon: 'tiktok', domain: 'tiktok.com', audio: true, h1: 'TikTok to MP3', what: 'the sound from TikTok videos as MP3', short: 'TikTok MP3' }),
  P({ slug: 'twitter-video-downloader', site: 'X (Twitter)', icon: 'x', domain: 'x.com', what: 'videos and GIFs from posts' }),
  P({ slug: 'dailymotion-downloader', site: 'Dailymotion', icon: 'dailymotion', domain: 'dailymotion.com', what: 'Dailymotion videos' }),
  P({ slug: 'vimeo-downloader', site: 'Vimeo', icon: 'vimeo', domain: 'vimeo.com', what: 'public Vimeo videos' }),
  P({ slug: 'vk-video-downloader', site: 'VK', icon: 'vk', domain: 'vk.com', what: 'public VK videos and clips' }),
  P({ slug: 'reddit-video-downloader', site: 'Reddit', icon: 'reddit', domain: 'reddit.com', what: 'Reddit videos with sound' }),
  P({ slug: 'pinterest-video-downloader', site: 'Pinterest', icon: 'pinterest', domain: 'pinterest.com', what: 'video pins' }),
  P({ slug: 'threads-video-downloader', site: 'Threads', icon: 'threads', domain: 'threads.net', what: 'videos from public Threads posts' }),
  P({ slug: 'xiaohongshu-downloader', site: 'Xiaohongshu', icon: 'xiaohongshu', domain: 'xiaohongshu.com', what: 'RedNote (Xiaohongshu) videos' }),
  P({ slug: 'twitch-clip-downloader', site: 'Twitch', icon: 'twitch', domain: 'twitch.tv', what: 'clips and past broadcasts' }),
  P({ slug: 'soundcloud-downloader', site: 'SoundCloud', icon: 'soundcloud', domain: 'soundcloud.com', audio: true, what: 'tracks that are free to stream' }),
  P({ slug: 'bilibili-downloader', site: 'Bilibili', icon: 'bilibili', domain: 'bilibili.com', what: 'Bilibili videos' }),
  P({ slug: 'tumblr-video-downloader', site: 'Tumblr', icon: 'tumblr', domain: 'tumblr.com', what: 'videos from Tumblr posts' }),
];

const bySlug = new Map(platforms.map((p) => [p.slug, p]));

// "All resources" grid on the home page: one tile per site (first page per icon wins).
const resourceTiles = [];
const seen = new Set();
for (const p of platforms) {
  if (p.audio || seen.has(p.icon)) continue;
  seen.add(p.icon);
  resourceTiles.push(p);
}

const tools = [
  { slug: 'youtube-to-mp3', label: 'YouTube to MP3', icon: 'tool-mp3' },
  { slug: 'youtube-transcript', label: 'YouTube Transcript', icon: 'tool-transcript' },
  { slug: 'youtube-subtitles', label: 'YouTube Subtitles', icon: 'tool-subtitles' },
  { slug: 'tiktok-to-mp3', label: 'TikTok to MP3', icon: 'tool-mp3' },
];

const converters = [
  { slug: 'mp4-converter', label: 'MP4 Converter', from: 'Any video', to: 'MP4', target: 'mp4', accept: 'video/*,.mkv,.mov,.webm,.avi,.flv,.wmv,.m4v,.3gp,.ts', icon: 'tool-convert' },
  { slug: 'mp4-to-mp3', label: 'MP4 to MP3', from: 'MP4', to: 'MP3', target: 'mp3', accept: 'video/*,audio/*,.mkv,.mov,.webm,.m4a', icon: 'tool-mp3' },
  { slug: 'mov-to-mp4', label: 'MOV to MP4', from: 'MOV', to: 'MP4', target: 'mp4', accept: '.mov,video/quicktime', icon: 'tool-convert' },
  { slug: 'mp4-to-gif', label: 'MP4 to GIF', from: 'MP4', to: 'GIF', target: 'gif', accept: 'video/*,.mkv,.mov,.webm', icon: 'tool-gif' },
  { slug: 'mkv-to-mp4', label: 'MKV to MP4', from: 'MKV', to: 'MP4', target: 'mp4', accept: '.mkv,video/x-matroska', icon: 'tool-convert' },
  { slug: 'webm-to-mp4', label: 'WEBM to MP4', from: 'WEBM', to: 'MP4', target: 'mp4', accept: '.webm,video/webm', icon: 'tool-convert' },
];
const converterBySlug = new Map(converters.map((c) => [c.slug, c]));

module.exports = { platforms, bySlug, resourceTiles, tools, converters, converterBySlug };
