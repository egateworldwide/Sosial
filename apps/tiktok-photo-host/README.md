# tiktok-photo-host

Ephemeral public host for TikTok photo posts. TikTok's API pulls photo bytes
from a URL on a domain **you own and verified** — it never accepts uploads
directly. This service accepts one photo, serves it publicly, and deletes it
after `TTL_HOURS` (default 24h; TikTok fetches within minutes of posting).

## Deploy (Railway, same project as the worker)

The `Dockerfile` is the deploy contract (Debian slim — sharp needs glibc).

1. **New service** → Deploy from GitHub repo → same repo as the worker.
2. Service → Settings → **Root Directory** = `apps/tiktok-photo-host`
   (Railway then picks up the `Dockerfile`; no build/start command needed).
3. Settings → **Networking → Custom Domain** = the domain you verified with
   TikTok; add the CNAME at your registrar. Note the target port is `3000`,
   which Railway fills in via `PORT`.
4. **Variables**: `BASE_URL=https://<your-verified-domain>`,
   `UPLOAD_KEY=<long random>`, `TTL_HOURS=24`, `DATA_DIR=/data`.
5. **Volume**: service → Settings → Volumes → new volume mounted at `/data`
   (without it, a redeploy wipes in-flight photos younger than the TTL).
6. Deploy. `GET https://<domain>/healthz` should return `{"ok":true}`.

Generate the key once:
```powershell
-join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
```

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
