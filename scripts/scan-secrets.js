/**
 * Secret scan — fails CI if a hardcoded provider secret lands in source.
 *
 * Flags code assignments of secret-looking literals (e.g. `FOO_SECRET = 'abc…'`)
 * in tracked source, while allowing:
 *  - `process.env.EXPO_PUBLIC_*` reads (the sanctioned pattern)
 *  - `PASTE_*` / `YOUR_*` / `EXAMPLE` placeholders
 *  - comments and docs
 *
 * Run: `npm run scan`. `.env` itself is never scanned (gitignored).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.json', '.html', '.yml', '.yaml']);
const SCAN_DIRS = ['src', 'scripts', '.github'];
const SCAN_FILES = ['App.tsx', 'app.json', 'eas.json', 'auth.html', 'babel.config.js'];

// `NAME_SECRET = 'literal'` or `"literal"`, TS or JSON style.
const SECRET_ASSIGN =
  /((CLIENT_SECRET|APP_SECRET|client_secret|"client_secret")\s*[:=]\s*['"])([^'"]*)(['"])/;
const PLACEHOLDER = /^(PASTE_|YOUR_|EXAMPLE|xxx|test|example|<.*>)?$/i;
// Provider-issued token shapes that must never appear literally.
const ISSUED = [/GOCSPX-[A-Za-z0-9_-]{10,}/, /WPL_AP1\.[A-Za-z0-9_.-]{10,}/];

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (SCAN_EXTS.has(path.extname(e.name))) yield p;
  }
}

const files = [];
for (const d of SCAN_DIRS) {
  const p = path.join(ROOT, d);
  if (fs.existsSync(p)) files.push(...walk(p));
}
for (const f of SCAN_FILES) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) files.push(p);
}

let hits = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const rel = path.relative(ROOT, f);
    const m = line.match(SECRET_ASSIGN);
    if (m && !PLACEHOLDER.test(m[3]) && !line.includes('process.env')) {
      console.error(`HIT ${rel}:${i + 1}: hardcoded secret assignment`);
      hits++;
    }
    for (const re of ISSUED) {
      if (re.test(line)) {
        console.error(`HIT ${rel}:${i + 1}: provider-issued secret literal`);
        hits++;
      }
    }
  });
}

if (hits > 0) {
  console.error(`\nscan-secrets: ${hits} hit(s). Move values to .env (EXPO_PUBLIC_*) — see .env.example.`);
  process.exit(1);
}
console.log('scan-secrets: clean.');
