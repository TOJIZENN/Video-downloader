// Creates a project-local Python virtualenv with yt-dlp (plus yt-dlp-ejs, which
// YouTube needs to solve its JS challenges) so nothing is installed globally.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const venv = path.join(root, '.venv');
const isWin = process.platform === 'win32';
const venvPython = path.join(venv, isWin ? 'Scripts/python.exe' : 'bin/python');

function findPython() {
  const candidates = isWin ? ['python', 'py', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const v = execFileSync(cmd, ['--version'], { encoding: 'utf8' }).trim();
      console.log(`Using ${cmd} (${v})`);
      return cmd;
    } catch {}
  }
  throw new Error('Python 3.10+ is required to install yt-dlp. Install it from https://www.python.org/');
}

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit' });
}

if (!fs.existsSync(venvPython)) {
  run(findPython(), ['-m', 'venv', venv]);
}
run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
// curl-cffi lets yt-dlp look like a real browser to sites that block other clients
run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'yt-dlp[default,curl-cffi]']);

for (const dir of ['data', 'tmp']) fs.mkdirSync(path.join(root, dir), { recursive: true });
console.log('\nSetup complete. Start the server with: npm start');
