/**
 * Meta (Facebook / Instagram / Threads) API config.
 *
 * 1. Create the app at developers.facebook.com → copy the App ID below.
 * 2. SECURITY NOTE (personal MVP): the app secret lives here on-device so the
 *    app can swap short tokens for 60-day tokens without a server. That is
 *    fine for your own dev-mode use. Move the exchange server-side before any
 *    store release — never ship a secret you care about.
 */
export const META_APP_ID = '3602598746546300';
export const META_APP_SECRET = '4ec89a1a6bcc3fcaf59786128e46dd5c';

// Threads lives in its own Meta app — separate keys, same redirect URI.
export const THREADS_APP_ID = '1745955523308050';
export const THREADS_APP_SECRET = '13ed5a25a88190b55497ace83f30d4d2';

export const GRAPH_VERSION = 'v21.0';

export const FB_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
];

// Instagram Business Login is its own OAuth flow (instagram.com) with its own
// app credentials — these scopes are INVALID on Facebook's dialog.
export const IG_APP_ID = '1066751359454704';
export const IG_APP_SECRET = 'c8becffeb02794aac2d803fd6df0e8d0';
export const IG_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];
export const IG_AUTH_ENDPOINT = 'https://www.instagram.com/oauth/authorize';
export const IG_TOKEN_ENDPOINT = 'https://api.instagram.com/oauth/access_token';
export const IG_GRAPH = 'https://graph.instagram.com';

export const THREADS_SCOPES = ['threads_basic', 'threads_content_publish'];

export const FB_AUTH_ENDPOINT = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
export const THREADS_AUTH_ENDPOINT = 'https://www.threads.com/oauth/authorize';
export const THREADS_API = 'https://graph.threads.net';

export const graph = (path: string) => `https://graph.facebook.com/${GRAPH_VERSION}${path}`;
