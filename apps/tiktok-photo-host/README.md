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
3. Settings → **Networking → Custom Domain** = `photos.sosial.app`; add the
   CNAME (Name `photos`) at your DNS host. On Cloudflare set it **DNS only**
   (grey cloud) — TikTok rejects 3xx redirects. Port is `3000` via `PORT`.
4. **Variables**: `BASE_URL=https://photos.sosial.app`,
   `UPLOAD_KEY=<long random>`, `TTL_HOURS=24`, `DATA_DIR=/data`.
5. **Volume**: service → Settings → Volumes → new volume mounted at `/data`
   (without it, a redeploy wipes in-flight photos younger than the TTL).
6. Deploy. `GET https://photos.sosial.app/healthz` → `{"ok":true}`.

Generate the key once:
```powershell
-join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
```

Without `UPLOAD_KEY` or `BASE_URL` the process refuses to start — an open
upload relay would be abused within hours.

## Verify the domain with TikTok (required for photo posts)

TikTok only pulls from a domain you've proven you own, or it answers
`url_ownership_unverified` (403). One-time, done in the portal — not on this
service. Verify the **domain** (not a URL prefix), so every `/f/<name>.jpg`
path is covered.

1. developers.tiktok.com → **Manage apps** → your app.
2. Open the **URL properties** widget → **Add** a property.
3. Type = **Domain**; value = `sosial.app` — verifying the apex covers every
   subdomain, so `photos.sosial.app` is included with no separate entry.
4. TikTok shows a signature string. Add it as a **DNS TXT record** at your
   registrar for that host (same place you added the CNAME).
5. Wait for DNS to propagate, then click **Verify** → the domain shows
   verified.

You need DNS control of the domain — register one if you don't have it. Until
then, only video posts work.

## Wire the app (no code changes needed)

Paste this into **Connect → TikTok → photo host**:

```text
https://photos.sosial.app/upload?key=<UPLOAD_KEY>
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
