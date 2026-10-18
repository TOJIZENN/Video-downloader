// Updates yt-dlp inside .venv. Sites change their players all the time; most
// "this link stopped working" problems are fixed by a newer yt-dlp.
//   npm run update            -> latest stable release
//   npm run update -- nightly -> nightly build (fixes land within days)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';
const venvPython = path.join(__dirname, '..', '.venv', isWin ? 'Scripts/python.exe' : 'bin/python');
if (!fs.existsSync(venvPython)) {
  console.error('No .venv found. Run "npm run setup" first.');
  process.exit(1);
}

const nightly = process.argv.includes('nightly');
const args = ['-m', 'pip', 'install', '--upgrade', ...(nightly ? ['--pre'] : []), 'yt-dlp[default,curl-cffi]'];
console.log(`> python ${args.join(' ')}`);
execFileSync(venvPython, args, { stdio: 'inherit' });
const version = execFileSync(venvPython, ['-m', 'yt_dlp', '--version'], { encoding: 'utf8' }).trim();
console.log(`\nyt-dlp ${version} installed${nightly ? ' (nightly)' : ''}. Restart the server to use it.`);
