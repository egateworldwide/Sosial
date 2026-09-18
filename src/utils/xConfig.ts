/**
 * X (Twitter) API v2 — OAuth 2.0 Authorization Code with PKCE + media upload.
 *
 * SETUP (developer.x.com → your project → your app):
 * 1. User authentication settings → enable OAuth 2.0.
 * 2. App permissions → "Read and write" (write is what lets us post).
 * 3. Type of App → Native App (public client: PKCE, no secret needed on-device).
 * 4. Callback URI → paste the bridge URL exactly:
  *      https://sosial.app/auth.html
 *    (X rejects custom schemes, so we bounce through the same static bridge
 *    page as Meta/TikTok — it forwards ?code= back into sosial://redirect.)
 * 5. Put the Client ID in `.env` (`EXPO_PUBLIC_X_CLIENT_ID`) — see `.env.example`.
 *
 * NOTES (read before touching):
 * 1. Scopes are baked into the token at consent time — `media.write` MUST be
 *    in the authorize URL or every image upload 403s while text posts work.
 * 2. Media upload is v2 one-shot: POST https://api.x.com/2/media/upload as
 *    multipart with `media` bytes + `media_category` (v1.1 upload.twitter.com
 *    is deprecated; there is no `command` field — sending one 400s).
 *    Responses wrap the id as data.id (string — never parse as a number).
 * 3. Free X tier includes only a small monthly posting cap — sustained 403s
 *    on POST /2/tweets mean the dev account needs Basic or higher.
 * 4. Up to 4 images per post, each <= 5 MB (PNG/JPEG/WEBP). Images finish
 *    synchronously at FINALIZE — no STATUS polling needed for photos.
 * 5. Video needs the v2 CHUNKED flow (INIT/APPEND/FINALIZE/STATUS), not the
 *    one-shot endpoint: POST /2/media/upload/initialize (JSON), then
 *    /2/media/upload/{id}/append per <=5 MB segment, /{id}/finalize, then
 *    GET ?command=STATUS. One video per post; video can't mix with photos.
 */

export const X_CLIENT_ID = process.env.EXPO_PUBLIC_X_CLIENT_ID ?? '';

export const X_AUTH_ENDPOINT = 'https://x.com/i/oauth2/authorize';
export const X_TOKEN_ENDPOINT = 'https://api.x.com/2/oauth2/token';
export const X_API = 'https://api.x.com/2';
export const X_MEDIA_UPLOAD = 'https://api.x.com/2/media/upload';

/** tweet.read rides along with write; offline.access mints the refresh token;
 *  media.write is what lets image uploads through (without it: 403 on files). */
export const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'];

/** X post caps enforced client-side; the composer shows them. */
export const X_MAX_IMAGES = 4;
export const X_MAX_TEXT = 280;
export const X_CHUNK_BYTES = 4 * 1024 * 1024; // APPEND segments must stay under 5 MB
