// Long-form page text. Platform pages are generated from templates so every
// downloader page has its own steps and FAQ.
function homeContent(brand, host) {
  return {
    steps: [
      { icon: 'link', title: 'Copy the link', text: 'Open the video in your browser or app and copy its address. In apps, tap Share → Copy link.' },
      { icon: 'clipboard', title: 'Paste it here', text: `Paste the link above (or press Paste). ${brand} finds the video and lists every format right away.` },
      { icon: 'download', title: 'Pick and save', text: 'Press Download for the recommended quality, or open the Video, Audio and No-sound tabs to choose another.' },
    ],
    features: [
      { icon: 'hd', title: 'Every quality, up to 4K', text: 'You see exactly what the source offers, from 144p for small phones to 4K for big screens.' },
      { icon: 'music', title: 'MP3 in one click', text: 'Switch to Audio to get a 192 kbps MP3, or keep the original M4A/WEBM stream untouched.' },
      { icon: 'list', title: 'Playlists and carousels', text: 'Paste a playlist, channel or multi-video post and pick the items you want, one by one.' },
      { icon: 'bolt', title: 'Downloads keep running', text: 'HD files are prepared in the background. Start several at once and keep browsing while they finish.' },
      { icon: 'shield', title: 'Private by design', text: 'No account, no tracking cookies. Prepared files are deleted automatically within an hour.' },
      { icon: 'globe', title: 'Works everywhere', text: 'Any modern browser on Windows, macOS, Linux, Android and iOS, in 10 languages, with a dark mode.' },
    ],
    shortcuts: [
      { icon: 'link', title: 'Type before the link', text: `Add <code>${host}/</code> in front of any video address in the address bar and press Enter.` },
      { icon: 'puzzle', title: `${brand} Helper`, text: 'A small browser extension that adds a Download button to video pages. <a href="/install">Install it</a>.' },
      { icon: 'phone', title: 'Share from your phone', text: `Add ${brand} to your home screen, then share links to it from any Android app.` },
    ],
    faq: [
      ['Is it free?', `Yes. ${brand} is free to use, with no sign-up and no limit on the number of downloads.`],
      ['Which websites are supported?', 'Most popular video and social sites are supported, plus many smaller ones. See the full, searchable list on the <a href="/supported-sites">supported sites</a> page. If a site is not listed, try the link anyway: many pages with a standard video player still work.'],
      ['Why does HD sometimes take a moment longer?', 'Many sites store high-resolution video and its sound as two separate streams. When you pick such a format, the server joins them into a single MP4 file for you. You can follow it in the Downloads panel, and the file is saved on its own when it is ready.'],
      ['Can I download a whole playlist?', 'Yes. Paste the playlist or channel link and every video is listed (up to 50 at a time). Press "Get links" next to any video to see its formats.'],
      ['Where are my files saved?', 'In your browser’s download folder. On a computer that is usually "Downloads". On iPhone open the Files app → Downloads; on Android open the Files or Downloads app.'],
      ['Do you keep copies of the videos?', 'No. Files that the server has to prepare are deleted automatically within an hour. Instant downloads are passed straight through and are never stored.'],
      ['Can I download private videos?', 'No. Only content that is publicly viewable without signing in can be downloaded.'],
      ['Is downloading videos legal?', 'Download only videos you own, that are in the public domain or under a licence that allows it, or for which you have the creator’s permission. Respect copyright and the terms of the websites you use.'],
    ],
  };
}

function platformContent(p, brand) {
  const { site, what } = p;
  if (p.audio) {
    return {
      intro: `Convert ${site} links to MP3 in a few seconds. ${brand} extracts ${what} at 192 kbps, so it plays on any phone, car stereo or music app.`,
      steps: [
        { icon: 'link', title: 'Copy the link', text: `Open the ${site} page and copy its link (Share → Copy link, or copy the address bar).` },
        { icon: 'clipboard', title: 'Paste it above', text: 'Audio mode is already selected, so MP3 is recommended as soon as the result appears.' },
        { icon: 'download', title: 'Save the MP3', text: 'Press Download. Prefer the original stream? Pick Audio M4A or WEBM from the Audio tab.' },
      ],
      features: [
        'Clean 192 kbps MP3 that works everywhere',
        'Original audio streams (M4A/WEBM) without re-encoding',
        'Video formats are one tab away',
        'No app, no sign-up, works on phones',
      ],
      faq: [
        [`Which quality will the ${site} MP3 have?`, 'MP3 files are encoded at 192 kbps from the best audio stream available. The original streams are listed too if you want them untouched.'],
        ['Can I convert long videos?', 'Yes. Longer videos simply take a little longer to prepare. The Downloads panel shows how much is left.'],
        [`Does it work for every ${site} link?`, 'It works for public content. Private, members-only or region-locked items cannot be downloaded.'],
      ],
    };
  }
  return {
    intro: `Download ${what} from ${site} to your computer or phone. Paste a link above, choose the resolution you want, or save just the audio.`,
    steps: [
      { icon: 'link', title: 'Copy the link', text: `Open the ${site} video and copy its link. In the ${site} app use Share → Copy link.` },
      { icon: 'clipboard', title: 'Paste it above', text: 'The search starts as soon as you paste, or press Download.' },
      { icon: 'download', title: 'Choose and save', text: 'Use the recommended button, or pick another resolution or audio format from the tabs.' },
    ],
    features: [
      'All available resolutions, up to 4K when the source has it',
      'MP4 with sound, plus MP3 and the original audio streams',
      'Posts with several videos and playlists are listed item by item',
      'Free, unlimited and no software to install',
    ],
    faq: [
      [`How do I download ${site} videos on my phone?`, `Copy the link with the Share button in the ${site} app, open ${brand} in your mobile browser, paste the link and tap Download. On Android you can add ${brand} to your home screen and share links to it directly.`],
      [`Can I download private ${site} videos?`, 'No. Only videos that anyone can watch without signing in can be downloaded.'],
      ['What quality will I get?', 'The same quality the source offers. The Video tab lists every resolution that is available, from the smallest to the original.'],
      ['What is the "Video without sound" tab?', 'Some sites store picture and sound separately. Those streams are listed for people who need them, for example for video editing. For a normal video with sound, use the Video tab.'],
    ],
  };
}

module.exports = { homeContent, platformContent };
