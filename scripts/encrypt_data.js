// Encrypt dashboard data files so only someone with the password can read them.
// Usage: DASH_PASSWORD=... node scripts/encrypt_data.js docs/data/latest.json docs/data/backtest.json
// Each <file>.json becomes <file>.enc (gzip, then AES-256-GCM with a PBKDF2-SHA256 key) and the plain file is deleted.
// Without DASH_PASSWORD the plain files are deleted and nothing readable is published.
const fs = require('fs'), zlib = require('zlib'), crypto = require('crypto');
const SALT = 'ntghimire-cloud/nepse-floorsheet:v1', ITER = 310000;   // must match docs/index.html
const pw = process.env.DASH_PASSWORD || '';
const files = process.argv.slice(2);
if (!pw) {
  for (const f of files) if (fs.existsSync(f)) fs.unlinkSync(f);
  fs.writeFileSync('docs/data/status.json', JSON.stringify({ locked: true, missingPassword: true }));
  console.log('DASH_PASSWORD not set: data removed, nothing readable published');
  process.exit(0);
}
const key = crypto.pbkdf2Sync(pw, SALT, ITER, 32, 'sha256');
for (const f of files) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(zlib.gzipSync(fs.readFileSync(f))), c.final(), c.getAuthTag()]);
  fs.writeFileSync(f.replace(/\.json$/, '.enc'), JSON.stringify({ v: 1, iv: iv.toString('base64'), ct: ct.toString('base64') }));
  fs.unlinkSync(f);
  console.log('encrypted', f);
}
fs.writeFileSync('docs/data/status.json', JSON.stringify({ locked: true }));
