/**
 * Ephemeral TikTok photo host.
 *
 * Why this exists: TikTok's API won't take photo bytes directly — it pulls
 * them from a public URL on a domain YOU own and verified. The app (and the
 * cloud worker) POST each photo here; this replies with a public URL; TikTok
 * fetches it within minutes; the file self-destructs after TTL_HOURS.
 *
 * Contract (matches the app's uploadTikTokPhoto + worker hostPhoto):
 *   POST /upload?key=SECRET  (multipart field "file") → 200 { "url": "https://host/f/<name>" }
 *   GET  /f/<name>           → the bytes with the stored content type
 *   GET  /healthz            → 200 { "ok": true }
 *
 * Security: UPLOAD_KEY is mandatory — without ?key= uploads 400. Paste the
 * full URL *including* ?key= into Connect → TikTok; both app and worker send
 * it verbatim, so no code changes are needed to authenticate.
 *
 * Storage: local disk (DATA_DIR). No database — expiry is derived from file
 * mtime, so even a crashed-then-restarted process converges on the next sweep.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

// Optional: only needed to convert PNG/HEIC/etc → JPEG. If the native binary
// is missing the service still runs, passing JPEG/WEBP through untouched.
let sharp = null;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

const PORT = Number(process.env.PORT || 3000);
const UPLOAD_KEY = String(process.env.UPLOAD_KEY || '');
const TTL_HOURS = Number(process.env.TTL_HOURS || 24);
const BASE_URL = String(process.env.BASE_URL || '').replace(/\/+$/, '');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAX_BYTES = 10 * 1024 * 1024; // TikTok photos are small; 10 MB is generous

if (!UPLOAD_KEY) {
  console.error('FATAL: UPLOAD_KEY env is required (refusing to run an open relay).');
  process.exit(1);
}
if (!BASE_URL) {
  console.error('FATAL: BASE_URL env is required (the public https origin, no trailing slash).');
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MIME_FOR = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

const app = express();
app.disable('x-powered-by');

function safeName(ext) {
  const safeExt = IMAGE_EXT.has(String(ext || '').toLowerCase()) ? String(ext).toLowerCase() : '.jpg';
  return `${Date.now().toString(36)}${crypto.randomBytes(8).toString('hex')}${safeExt}`;
}

/** Identify by magic bytes — the client always claims image/jpeg, so never trust that. */
function sniff(buf) {
  if (!buf || buf.length < 12) return 'unknown';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  if (buf.toString('ascii', 4, 8) === 'ftyp' && /heic|heix|hevc|mif1|msf1|heif|avif/.test(buf.toString('ascii', 8, 16))) return 'heic';
  return 'unknown';
}

/**
 * TikTok pulls photos only as JPEG/WEBP; PNG (and HEIC) are rejected at init.
 * Normalize anything else to JPEG here, once, so app and worker both benefit.
 * Returns { buf, ext, mime, note }.
 */
async function normalize(buf) {
  const kind = sniff(buf);
  if (kind === 'jpeg') return { buf, ext: '.jpg', mime: 'image/jpeg', note: 'jpeg' };
  if (!sharp) {
    if (kind === 'webp') return { buf, ext: '.webp', mime: 'image/webp', note: 'webp' };
    const e = new Error(`host cannot accept ${kind} without sharp installed — send JPEG/WEBP or add the sharp dependency`);
    e.status = 415;
    throw e;
  }
  try {
    const out = await sharp(buf, { failOn: 'none' })
      .rotate() // apply EXIF orientation before we drop it
      .flatten({ background: '#ffffff' }) // JPEG has no alpha; don't let transparency go black
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    return { buf: out, ext: '.jpg', mime: 'image/jpeg', note: `${kind}->jpeg` };
  } catch {
    const e = new Error(`could not convert ${kind} image to JPEG`);
    e.status = 415;
    throw e;
  }
}

/** Delete files older than the TTL. Returns counts for the log line. */
function sweep() {
  const cutoff = Date.now() - TTL_HOURS * 3600 * 1000;
  let gone = 0;
  let kept = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
  } catch {
    return { gone, kept };
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    const full = path.join(DATA_DIR, e.name);
    let stat = null;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.mtimeMs < cutoff) {
      try {
        fs.unlinkSync(full);
        gone += 1;
      } catch {}
    } else {
      kept += 1;
    }
  }
  return { gone, kept };
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.post('/upload', upload.single('file'), async (req, res) => {
  if (req.query.key !== UPLOAD_KEY) {
    return res.status(401).json({ error: 'bad key' });
  }
  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    return res.status(400).json({ error: 'field "file" is required' });
  }
  let norm;
  try {
    norm = await normalize(req.file.buffer);
  } catch (e) {
    return res.status(e.status || 415).json({ error: e.message });
  }
  const name = safeName(norm.ext);
  try {
    fs.writeFileSync(path.join(DATA_DIR, name), norm.buf);
  } catch {
    return res.status(500).json({ error: 'store failed' });
  }
  // Expire roughly on schedule even with zero traffic until then.
  setTimeout(() => {
    fs.unlink(path.join(DATA_DIR, name), () => {});
  }, TTL_HOURS * 3600 * 1000).unref();
  if (norm.note !== 'jpeg') console.log(`tiktok-photo-host: stored ${norm.note} (${norm.buf.length}b)`);
  res.json({ url: `${BASE_URL}/f/${name}` });
});

app.get('/f/:name', (req, res) => {
  const name = String(req.params.name || '');
  if (!/^[a-z0-9]{4,64}\.(jpg|jpeg|png|webp|gif)$/i.test(name)) {
    return res.status(400).end();
  }
  // path.resolve normalizes separators, so the guard holds on Windows too.
  const full = path.resolve(DATA_DIR, name);
  const root = path.resolve(DATA_DIR);
  // No path traversal: resolved path must stay inside DATA_DIR.
  if (full !== path.join(root, name) || !full.startsWith(root + path.sep)) return res.status(400).end();
  fs.stat(full, (err, stat) => {
    if (err || !stat.isFile()) return res.status(404).end();
    if (Date.now() - stat.mtimeMs > TTL_HOURS * 3600 * 1000) {
      fs.unlink(full, () => {});
      return res.status(410).end();
    }
    const ext = path.extname(name).toLowerCase();
    res.setHeader('Content-Type', MIME_FOR[ext] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(full).pipe(res);
  });
});

// Multer size errors (and friends) as JSON, not an HTML stack.
app.use((err, _req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'file over 10 MB' });
  }
  return res.status(400).json({ error: 'upload failed' });
});

const first = sweep();
console.log(`tiktok-photo-host: data=${DATA_DIR} ttl=${TTL_HOURS}h kept=${first.kept} swept=${first.gone}`);
setInterval(() => {
  const r = sweep();
  if (r.gone > 0) console.log(`tiktok-photo-host: sweep swept=${r.gone} kept=${r.kept}`);
}, 60 * 60 * 1000).unref();

app.listen(PORT, () => console.log(`tiktok-photo-host listening on :${PORT}`));
