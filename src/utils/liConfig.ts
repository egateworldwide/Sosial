/**
 * LinkedIn — OAuth 2.0 Authorization Code + Posts API (member posts).
 *
 * SETUP (developer.linkedin.com → your app):
 * 1. Products tab → add "Sign In with LinkedIn using OpenID Connect"
 *    AND "Share on LinkedIn". Both are self-serve.
 * 2. Auth tab → Authorized redirect URLs → paste the bridge URL exactly:
  *      https://sosial.app/auth.html
 *    (LinkedIn rejects custom schemes, so we bounce through the same static
 *    bridge page as Meta/TikTok/X — it forwards ?code= back to the app.)
 * 3. Put the Client ID + Client Secret in `.env` (`EXPO_PUBLIC_LI_*`).
 *
 * NOTES (read before touching):
 * 1. Same on-device-secret posture as Meta/TikTok in this app (personal MVP).
 *    Move the exchange server-side before any store release.
 * 2. Every versioned call needs BOTH headers: Linkedin-Version (YYYYMM) and
 *    X-Restli-Protocol-Version: 2.0.0 — miss one and calls 400/401.
 * 3. Images are a 3-step dance per file: initializeUpload → PUT raw bytes to
 *    the uploadUrl → reference the urn:li:image:… in the post. No public host
 *    needed (unlike IG/Threads/TikTok) — bytes go direct.
 * 4. Post create returns 201 with the id in the `x-restli-id` RESPONSE HEADER,
 *    not the body (which is empty).
 * 5. Single image → content.media; 2–9 images → content.multiImage.
 */

export const LI_CLIENT_ID = process.env.EXPO_PUBLIC_LI_CLIENT_ID ?? '';
export const LI_CLIENT_SECRET = process.env.EXPO_PUBLIC_LI_CLIENT_SECRET ?? '';

export const LI_AUTH_ENDPOINT = 'https://www.linkedin.com/oauth/v2/authorization';
export const LI_TOKEN_ENDPOINT = 'https://www.linkedin.com/oauth/v2/accessToken';
export const LI_API = 'https://api.linkedin.com';

/** openid+profile identify the member (userinfo → sub); w_member_social posts.
 *  r_member_social reads the member's own posts + their likes/comments
 *  (analytics + per-post stats). It is part of the "Share on LinkedIn"
 *  product — after adding this scope, DISCONNECT + RECONNECT LinkedIn in the
 *  app so the new permission is granted (old tokens don't gain it).
 *  r_organization_social / w_organization_social do the same for Company
 *  Pages you admin (org picker, org followers, post-as-Page). They need the
 *  "Marketing Developer Platform" product in the portal — without it LinkedIn
 *  403s and the app falls back to member-only with an honest note. */
export const LI_SCOPES = [
  'openid', 'profile',
  'w_member_social', 'r_member_social',
  'w_organization_social', 'r_organization_social',
];

/** Pinned API version (YYYYMM) — keep within LinkedIn's support window. */
export const LI_VERSION = '202601';

export const LI_MAX_IMAGES = 9;
export const LI_MAX_TEXT = 3000;
export const LI_MAX_BYTES = 10 * 1024 * 1024; // images must stay under 10 MB
