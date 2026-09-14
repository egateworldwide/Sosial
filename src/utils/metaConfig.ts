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

export const GRAPH_VERSION = 'v21.0';

export const FB_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
];

export const THREADS_SCOPES = ['threads_basic', 'threads_content_publish'];

export const FB_AUTH_ENDPOINT = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
export const THREADS_AUTH_ENDPOINT = 'https://www.threads.net/oauth/authorize';
export const THREADS_API = 'https://graph.threads.net';

export const graph = (path: string) => `https://graph.facebook.com/${GRAPH_VERSION}${path}`;
