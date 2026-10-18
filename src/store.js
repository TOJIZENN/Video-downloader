// Tiny JSON-file persistence for the rating widget and the feedback form.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

fs.mkdirSync(config.dirs.data, { recursive: true });
const ratingsFile = path.join(config.dirs.data, 'ratings.json');
const feedbackFile = path.join(config.dirs.data, 'feedback.jsonl');
const secretFile = path.join(config.dirs.data, '.secret');

if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'));
const secret = fs.readFileSync(secretFile, 'utf8').trim();

let ratings = { votes: {} };
try {
  ratings = JSON.parse(fs.readFileSync(ratingsFile, 'utf8'));
} catch {}

let saveTimer = null;
function saveRatings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = ratingsFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(ratings));
    fs.renameSync(tmp, ratingsFile);
  }, 500);
}

// Visitors are identified only by a keyed hash of their IP: one vote each, no raw IPs stored.
const visitorId = (ip) => crypto.createHmac('sha256', secret).update(String(ip)).digest('hex').slice(0, 20);

function ratingSummary() {
  const votes = Object.values(ratings.votes);
  const sum = votes.reduce((a, b) => a + b, 0);
  return { average: votes.length ? Math.round((sum / votes.length) * 10) / 10 : 0, count: votes.length };
}

function rate(ip, stars) {
  ratings.votes[visitorId(ip)] = stars;
  saveRatings();
  return ratingSummary();
}

function myRating(ip) {
  return ratings.votes[visitorId(ip)] || 0;
}

function addFeedback(entry) {
  fs.appendFileSync(feedbackFile, JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n');
}

module.exports = { ratingSummary, rate, myRating, addFeedback };
