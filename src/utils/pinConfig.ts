/**
 * Pinterest — OAuth 2.0 Authorization Code + Pins API v5.
 *
 * SETUP (developers.pinterest.com → your app):
 * 1. Create an app (any platform) and open its settings.
 * 2. Redirect URIs → paste the bridge URL exactly:
  *      https://sosial.app/auth.html
 *    (Pinterest rejects custom schemes, so we bounce through the same static
 *    bridge page as the other OAuth channels — it forwards ?code= back to the app.)
 * 3. On the app, request these scopes:
 *      boards:read, boards:write, pins:read, pins:write, user_accounts:read
 *    Trial apps work for your own account; wider/user-facing access needs
 *    Pinterest's production review.
 * 4. Put the App ID + App secret in `.env` (`EXPO_PUBLIC_PIN_*`).
 *
 * NOTES (read before touching):
 * 1. Same on-device-secret posture as the other channels in this app
 *    (personal MVP). Move the exchange server-side before any store release.
 * 2. The token endpoint authenticates with HTTP Basic (base64 app_id:secret),
 *    NOT client_id/client_secret in the body.
 * 3. Scopes are comma-separated in the authorize URL.
 * 4. Access tokens expire (~30 days) — refresh tokens don't, so getValidPin()
 *    refreshes proactively and persists the new pair.
 * 5. A Pin must live on a board → the user picks a default board after
 *    connecting (stored as pinBoardId). Publish throws until one is set.
 * 6. Images upload inline as base64 in POST /v5/pins — no separate upload
 *    step. Video uses the /v5/media register → PUT → poll → create flow
 *    (createVideoPin in pinPublish.ts).
 */

export const PIN_CLIENT_ID = process.env.EXPO_PUBLIC_PIN_CLIENT_ID ?? '';
export const PIN_CLIENT_SECRET = process.env.EXPO_PUBLIC_PIN_CLIENT_SECRET ?? '';

export const PIN_AUTH_ENDPOINT = 'https://www.pinterest.com/oauth/';
export const PIN_TOKEN_ENDPOINT = 'https://api.pinterest.com/v5/oauth/token';
export const PIN_API = 'https://api.pinterest.com/v5';

/** Boards are needed for listing + creating; user_accounts:read for the profile. */
export const PIN_SCOPES = ['boards:read', 'boards:write', 'pins:read', 'pins:write', 'user_accounts:read'];

/** One API call per image — a Pin holds a single photo. */
export const PIN_MAX_IMAGES = 4;
export const PIN_MAX_TITLE = 100;
export const PIN_MAX_DESC = 800;
/** Base64 inflates ~33% — keep raw files under this so uploads stay sane. */
export const PIN_MAX_BYTES = 10 * 1024 * 1024;
/** Video goes up as raw bytes over XHR (no base64) — cap for device sanity. */
export const PIN_MAX_VIDEO_BYTES = 200 * 1024 * 1024;
