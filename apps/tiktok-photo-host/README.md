# tiktok-photo-host

Ephemeral public host for TikTok photo posts. TikTok's API pulls photo bytes
from a URL on a domain **you own and verified** — it never accepts uploads
directly. This service accepts one photo, serves it publicly, and deletes it
after `TTL_HOURS` (default 24h; TikTok fetches within minutes of posting).

## Deploy (Railway, same project as the worker)

1. New service from `apps/tiktok-photo-host`, start command `npm start`
   (set the build command to `npm install --omit=dev` or just `npm install`).
2. Attach a small volume mounted at `/data`, env `DATA_DIR=/data`
   (without a volume, a redeploy wipes in-flight photos younger than the TTL).
3. Env: `BASE_URL=https://<your-verified-domain>`, `UPLOAD_KEY=<long random>`,
   `TTL_HOURS=24`.
4. Give the service your domain (Railway → service → Settings → Networking →
   Custom domain, plus the DNS record at your registrar).

Without `UPLOAD_KEY` or `BASE_URL` the process refuses to start — an open
upload relay would be abused within hours.

## Verify the domain with TikTok

TikTok Developer Portal → your app → photo-posting settings → verify the
`BASE_URL` domain (they give you a verification file to place at the domain
root, or a DNS record — do that on your existing website/hosting, it's a
one-time step independent of this service). Until the domain shows verified,
TikTok answers photo inits with `url_ownership_unverified`.

## Wire the app (no code changes needed)

Paste this into **Connect → TikTok → photo host**:

```text
https://<your-domain>/upload?key=<UPLOAD_KEY>
```

The app and the cloud worker POST multipart field `file` to that exact URL
and read back `{ "url": "…" }` (or a bare URL). The `?key=` rides along
verbatim, so both are authenticated with zero code changes. Closed-app photo
posts work as soon as the host is saved (it syncs into channel metadata on
the next connect toggle).

## Notes

- Auto-converts to JPEG: anything not already JPEG (PNG, HEIC, GIF, WEBP…)
  is flattened onto white, EXIF-rotated, and re-encoded at q90 via `sharp`
  before it's stored, because TikTok rejects those at init. Content type is
  sniffed from magic bytes, never the client's declared `image/jpeg`.
  Without `sharp` installed the service still runs but only JPEG/WEBP pass.
- 10 MB per photo cap; `410 Gone` once expired (TikTok will already have it).
- `GET /healthz` for uptime checks. No database: expiry derives from file
  mtime, so crashes/restarts converge on the next sweep.
