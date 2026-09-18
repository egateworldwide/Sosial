/**
 * Meta (Facebook / Instagram / Threads) API config.
 *
 * 1. Create the app at developers.facebook.com → put the App ID in `.env`
 *    (see `.env.example`). Values are inlined at build time via
 *    `EXPO_PUBLIC_*` — nothing secret may live in this file.
 * 2. SECURITY NOTE: the app secret is still exchanged on-device in this
 *    personal-MVP build. That moves server-side in P2 (Supabase Edge
 *    Functions) before any store release — and the secrets below are in git
 *    history, so they must be ROTATED in the provider dashboards regardless.
 */
export const META_APP_ID = process.env.EXPO_PUBLIC_META_APP_ID ?? '';
export const META_APP_SECRET = process.env.EXPO_PUBLIC_META_APP_SECRET ?? '';

// Threads lives in its own Meta app — separate keys, same redirect URI.
export const THREADS_APP_ID = process.env.EXPO_PUBLIC_THREADS_APP_ID ?? '';
export const THREADS_APP_SECRET = process.env.EXPO_PUBLIC_THREADS_APP_SECRET ?? '';

export const GRAPH_VERSION = 'v21.0';

export const FB_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_posts',
];

// Instagram Business Login is its own OAuth flow (instagram.com) with its own
// app credentials — these scopes are INVALID on Facebook's dialog.
export const IG_APP_ID = process.env.EXPO_PUBLIC_IG_APP_ID ?? '';
export const IG_APP_SECRET = process.env.EXPO_PUBLIC_IG_APP_SECRET ?? '';
// instagram_manage_insights is deliberately NOT requested: asking for it makes
// Meta reject the entire login ("Invalid platform app") until/unless the app
// passes review for it. Follower history stays off; follower count still works.
export const IG_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];
export const IG_AUTH_ENDPOINT = 'https://www.instagram.com/oauth/authorize';
export const IG_TOKEN_ENDPOINT = 'https://api.instagram.com/oauth/access_token';
export const IG_GRAPH = 'https://graph.instagram.com';

export const THREADS_SCOPES = ['threads_basic', 'threads_content_publish', 'threads_read_replies', 'threads_manage_insights'];

export const FB_AUTH_ENDPOINT = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
export const THREADS_AUTH_ENDPOINT = 'https://www.threads.com/oauth/authorize';
export const THREADS_API = 'https://graph.threads.net';

export const graph = (path: string) => `https://graph.facebook.com/${GRAPH_VERSION}${path}`;
