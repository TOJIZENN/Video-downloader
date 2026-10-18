# Fetchly — online video downloader

A self-hosted online video downloader: paste a link, get every available
quality, and download MP4/MP3 in one click. It offers the feature set of popular
downloader sites with its own interface, name, logo, copy and code, so you can
run it under your own brand (see [Branding](#branding)).

Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) (1,800+ supported sites)
and FFmpeg.

## Features

| Feature | How it works here |
| --- | --- |
| Paste a link → result card with thumbnail, title, duration | ✅ auto-searches on paste; **Paste** button; recent searches (kept only in the browser) |
| Video / audio intent | ✅ **Video ↔ Audio (MP3)** switch on the search box |
| Format picker | ✅ one-click **Recommended** button + tabs (Video / Audio / Video without sound) with size and a Download button on every format |
| HD formats stored as separate video + audio | ✅ joined on the server; progress shows in a **Downloads dock** (several at once, keep browsing), then auto-saves |
| Instant downloads | ✅ streamed through the server with a proper filename, range requests supported |
| Preview player on the thumbnail | ✅ YouTube (privacy-enhanced) / Vimeo / Dailymotion embeds, or the file itself |
| Playlists and multi-video posts | ✅ up to 50 entries, "Get links" per entry |
| Address-bar shortcut | ✅ `yoursite/https://…` or `yoursite/youtube.com/watch?v=…` |
| Platform landing pages (YouTube, Facebook, Instagram, TikTok…) | ✅ 21 pages, each with its own steps and FAQ |
| YouTube to MP3 / TikTok MP3 | ✅ MP3 192 kbps preselected |
| MP4 Converter, MP4→MP3, MOV→MP4, MP4→GIF, MKV→MP4, WEBM→MP4 | ✅ upload, progress bar, stream-copy when possible |
| YouTube Transcript & YouTube Subtitles | ✅ search, copy, timestamps linking to the video, SRT/VTT/TXT, auto-captions and translations |
| "Install Helper" browser extension | ✅ MV3 extension (Chrome/Edge/Brave/Firefox): page button, toolbar popup, right-click menu, downloadable pre-configured `.zip` |
| Mobile app | ✅ installable PWA with **Share target** (share links from any Android app) + bookmarklet |
| Language selector | ✅ 10 languages for the interface (EN, ES, PT, FR, DE, RU, HI, ID, TR, AR with RTL) |
| Rating stars | ✅ real votes, one per visitor (hashed IP), no fake numbers |
| How-to, FAQ, Terms, Privacy, Feedback, API for webmasters | ✅ |
| Supported sites | ✅ searchable list straight from yt-dlp |
| Themes | ✅ light and dark, following the system, with a toggle |

Deliberately left out: ads, push-notification prompts, third-party trust
badges, partner links, and anonymous Instagram story viewing.

## Quick start

Requirements: Node.js 20+ and Python 3.10+ (used only to run yt-dlp).

```bash
npm install          # also downloads an FFmpeg binary (ffmpeg-static)
npm run setup        # creates .venv with yt-dlp, yt-dlp-ejs (YouTube) and curl_cffi (browser impersonation)
npm start            # http://127.0.0.1:3000
```

`npm test` runs the unit tests. `npm run dev` restarts on file changes.

Keep yt-dlp current; sites change often and most "it stopped working" problems
are fixed by an update (restart the server afterwards):

```bash
npm run update              # latest stable yt-dlp
npm run update -- nightly   # nightly build: site fixes land within days
```

## How a link is resolved

1. **yt-dlp** reads the page with its 1,800+ site-specific extractors.
2. If the site **blocks non-browser clients** (Cloudflare "Just a moment…", HTTP 403),
   the lookup is retried while impersonating Chrome's network fingerprint (curl_cffi).
   Downloads for that link then also go through yt-dlp with impersonation.
3. If yt-dlp **doesn't recognise the page**, the server scans it for video files:
   `<video>`/`<source>` tags, Open Graph/Twitter player tags, JSON-LD, and `.mp4`,
   `.webm`, `.m3u8`, `.mpd` links inside player scripts. Files are requested with the
   page as Referer, which many hosts require.

The API response's `via` field says which step found the video (`browser` or
`page-scan`; absent for a normal yt-dlp result).

What is **not** downloaded, by design: DRM-protected streams (Netflix, Prime Video,
Disney+, Spotify…), content behind a login or paywall that the configured account
can't see, CAPTCHA-protected pages, and live streams that are still running.

## Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `BRAND_NAME` | `Fetchly` | Site name used everywhere, including the extension download |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Use `HOST=0.0.0.0` to reach it from your phone on the LAN |
| `PUBLIC_URL` | (from the request) | Public origin, e.g. `https://dl.example.com` |
| `TRUST_PROXY` | (off) | Set to `1` behind nginx/Cloudflare so rate limits see real IPs |
| `COOKIES_FILE` | | Netscape `cookies.txt` for sites that require login (Vimeo, Instagram, age-restricted YouTube) |
| `COOKIES_FROM_BROWSER` | | Use your own browser's logins instead, e.g. `firefox`, `edge`, `chrome`, `firefox:ProfileName`. Firefox is the most reliable on Windows (Chrome locks/encrypts its cookie store while running) |
| `IMPERSONATE` | `chrome` | Browser to imitate for sites that block other clients (`chrome`, `safari`, …); `off` disables the retry |
| `PAGE_SCAN` | on | `0` disables scanning unknown pages for video files |
| `ALLOW_PRIVATE_URLS` | off | `1` allows links to local/private network addresses (testing only) |
| `YTDLP_PROXY` | | Proxy for yt-dlp (helps when a site blocks the server's IP) |
| `YTDLP_PATH` / `FFMPEG_PATH` | `.venv` / ffmpeg-static | Use your own binaries |
| `MAX_JOBS` | `3` | Parallel merge/convert jobs |
| `UPLOAD_MAX_MB` | `1024` | Converter upload limit |
| `MIN_FREE_DISK_MB` | `2048` | New downloads/uploads are refused below this much free disk |
| `SITE_PASSWORD` | | Shared password for private access (see below) |
| `AUTH_SECRET` | | 32+ random characters that sign the login cookie |
| `NODE_ENV=production` | | Requires the password, hides internal error details, enables caching |

## Private access (password)

The whole site sits behind one shared password, the same scheme as the Yomikata
site (same variable names). Nothing is served before sign-in: pages show a
password form, API calls and files get `401`. Only the login page, the logo/app
icons, `manifest.webmanifest`, `robots.txt` and `/api/health` (for host health
checks) are public.

- `SITE_PASSWORD` is what you give people. You can use the same value as Yomikata.
- `AUTH_SECRET` signs the cookie. Use a **new** random value for this site:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

After the right password the browser keeps a signed, HttpOnly, `SameSite=Lax`
cookie for a year (`__Host-` prefixed and `Secure` over HTTPS). Changing either
variable signs everybody out. Wrong passwords are answered after a one-second
delay and limited to 10 attempts per 15 minutes per IP; login forms posted from
other sites are rejected. There is a **Sign out** link in the footer.

With `NODE_ENV=production` the site refuses to serve at all until both variables
are set. In development (no `NODE_ENV`), the gate is off unless `SITE_PASSWORD`
is set.

## Hosting

This app needs a long-running server: Node.js, Python (yt-dlp), FFmpeg,
background jobs, temporary disk space and server-sent events. **It cannot run on
Vercel** or other serverless hosts. Good fits are a container host (Render,
Railway, Fly.io) or any small VPS, with HTTPS in front.

Set at least:

```bash
NODE_ENV=production
SITE_PASSWORD=...        # the shared password
AUTH_SECRET=...          # new random value (see above)
TRUST_PROXY=1            # behind the host's HTTPS proxy: real visitor IPs + HTTPS detection
HOST=0.0.0.0
PUBLIC_URL=https://your-domain.example
```

Give the server enough disk for prepared files (a 4K video can be over 1 GB; files
are deleted after an hour) and run `npm run update` regularly.

## Security notes

- **Private access** as described above; `X-Robots-Tag: noindex` and a
  disallow-all `robots.txt` keep the site out of search engines.
- **Headers:** strict Content-Security-Policy (no inline scripts), no framing
  (`X-Frame-Options: DENY`, `frame-ancestors 'none'`), HSTS on HTTPS,
  `Cross-Origin-Opener/Resource-Policy: same-origin`, `nosniff`.
- **No requests into your network:** links to private, loopback, link-local and
  cloud-metadata addresses are refused, and every request the server makes itself
  (media, thumbnails, page scans, subtitles) is checked again when the connection
  opens, so redirects and DNS tricks can't get around it. yt-dlp's own requests
  are only covered by the first check; for full isolation run the container
  without access to your private network.
- **No command injection:** yt-dlp and FFmpeg run without a shell, and links are
  passed after `--` so they can never be read as options.
- **Downloads and uploads:** results live under random tokens, files are deleted
  after an hour, uploads are size-limited, new work is refused when the disk is
  nearly full, and third-party thumbnails are limited to 10 MB raster images.
- **Rate limits** on lookups, downloads, uploads, feedback and login.
- Production errors never include yt-dlp output or server paths.
- `ALLOW_PRIVATE_URLS` is for local testing only. Never set it on a public server.

## How it works

```
browser ──POST /api/info──▶ yt-dlp -J ──▶ formats → options (MP4 720, Audio M4A, MP3…)
        ◀─ token + options ─┘                      kept server-side under a random token
"direct" option ─GET /api/download/:token/:key─▶ streamed from the source (chunked ranges for YouTube)
"job" option ───POST /api/jobs──▶ yt-dlp downloads + FFmpeg merges/extracts ─SSE progress─▶ /api/jobs/:id/file
```

- `src/ytdlp.js` turns yt-dlp's format list into download options.
- `src/media.js` runs the lookup chain (yt-dlp → browser impersonation → page scan);
  `src/sniff.js` is the page scanner.
- `src/jobs.js` is the merge/MP3/convert queue; files are deleted after an hour.
- `src/proxy.js` streams files and thumbnails; `src/security.js` blocks
  requests to private/internal addresses and rate-limits the API.
- `src/subtitles.js` parses json3/VTT/XML captions into SRT/VTT/TXT.
- `views/` (EJS) and `public/` hold the pages; `extension/` is the Helper.
- The JSON API is documented on `/api-docs`.

## Branding

Change `BRAND_NAME` and replace `public/img/logo.svg` and `app-icon*.svg`
(run `node scripts/make-icons.js` after editing the geometry for PNG icons).
Don't use other services' names or logos: they are trademarks of their owners.

## Known limitations

- Some sites only serve logged-in users (Vimeo's web client, many Instagram
  posts, private Facebook videos). Provide `COOKIES_FILE` or `COOKIES_FROM_BROWSER`
  from an account you own.
- Datacenter IPs are sometimes challenged by YouTube ("confirm you're not a
  bot"); a residential connection, `YTDLP_PROXY` or cookies help.
- Live streams can be downloaded only after they end.

## Legal

Only download content you own, that is in the public domain or under a licence
that allows it, or that you have permission to save. Respect copyright and each
website's terms. The Terms and Privacy pages are templates; review them before
running a public service.

## How the reference site was studied

A reference downloader site was inspected with [REA](https://github.com/morluto/rea)
(`npx rea-agents analyze-web-bundle` against a Chrome DevTools session) to
understand its feature set and general flow: a backend resolves media, results
render in the page, and HD formats need a server-side merge. This project
reimplements that functionality independently on yt-dlp/FFmpeg, with its own
interface design. It does not call any other service's servers.
