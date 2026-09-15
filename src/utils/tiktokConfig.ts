/**
 * TikTok Login Kit + Content Posting API config.
 *
 * HOW THIS DIFFERS FROM META (read before touching):
 * 1. TikTok uses `client_key`, NOT `client_id` — every endpoint takes client_key.
 * 2. Access tokens die after 24h. The 365-day refresh token mints new ones
 *    silently, so every call goes through getValidToken() in tiktokAuth.ts.
 * 3. Unaudited apps can only post to PRIVATE accounts — production needs the
 *    TikTok app review. Until then it still works end-to-end, just privately.
 * 4. privacy_level is mandatory and must be one of the creator's OWN options
 *    from /creator_info/query/ — the composer shows a picker, never hardcodes.
 * 5. Local media goes via FILE_UPLOAD (chunked PUT from the device).
 *    PULL_FROM_URL needs a verified domain — our anonymous host won't qualify.
 *
 * Paste your client key/secret from developers.tiktok.com → your app → Basic.
 */
export const TT_CLIENT_KEY = 'sbawibhbkll46bubal';
export const TT_CLIENT_SECRET = '92bBuEtvOM6R2mfZYzdkawx39K7m5E06';

export const TT_AUTH_ENDPOINT = 'https://www.tiktok.com/v2/auth/authorize/';
export const TT_TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';
export const TT_API = 'https://open.tiktokapis.com';

export const TT_SCOPES = ['user.info.basic', 'video.upload', 'video.publish', 'video.list'];

/** Privacy levels TikTok understands — always intersect with creator_info options. */
export const TT_PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Public',
  MUTUAL_FOLLOW_FRIENDS: 'Mutual friends',
  FOLLOWER_OF_CREATOR: 'Followers',
  SELF_ONLY: 'Only me',
};
