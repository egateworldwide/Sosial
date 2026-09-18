/**
 * YouTube — Google OAuth 2.0 + YouTube Data API v3 (resumable uploads).
 *
 * SETUP (console.cloud.google.com → your project):
 * 1. Enable the "YouTube Data API v3" (APIs & Services → Library).
 * 2. OAuth consent screen → External, fill app name + support email, add
 *    YOUR Google account under Test users (while the app is in Testing,
 *    only test users can sign in and refresh tokens last 7 days).
 * 3. Credentials → Create Credentials → OAuth client ID → Web application →
 *    Authorized redirect URIs → paste the bridge URL exactly:
  *      https://sosial.app/auth.html
 *    (Google accepts https URLs; the static bridge forwards ?code= to the app.)
 * 4. Put the Client ID + Client Secret in `.env` (`EXPO_PUBLIC_YT_*`).
 * 5. First login shows an "unverified app" screen → Advanced → Go to Sosial.
 *
 * NOTES (read before touching):
 * 1. Same on-device-secret posture as the other channels in this app
 *    (personal MVP). Move the exchange server-side before any store release.
 * 2. access_type=offline + prompt=consent on every login so Google always
 *    returns a refresh_token (without it you only get one, once, ever).
 * 3. Uploads are resumable: POST metadata → session URL in the Location
 *    header → PUT raw bytes. Single PUT, no chunking — capped at 128 MB.
 * 4. Uploads cost ~1600 quota units; default project quota is 10,000/day —
 *    fine for personal use, don't loop retries blindly.
 * 5. New videos go up as PUBLIC by default — change per post in the
 *    YouTube post-type row (Listing link).
 */

export const YT_CLIENT_ID = process.env.EXPO_PUBLIC_YT_CLIENT_ID ?? '';
export const YT_CLIENT_SECRET = process.env.EXPO_PUBLIC_YT_CLIENT_SECRET ?? '';

export const YT_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const YT_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const YT_API = 'https://www.googleapis.com/youtube/v3';
export const YT_UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3';

/** upload: publish; readonly: channel stats + video list; force-ssl: comments. */
export const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

/** Single-PUT resumable upload cap — base64 inflates ~33% in memory. */
export const YT_MAX_BYTES = 128 * 1024 * 1024;
export const YT_MAX_TITLE = 100;
export const YT_MAX_DESC = 5000;
