/**
 * Mastodon OAuth + publish constants. Mastodon is federated, so there are no
 * portal keys to paste up front: at login the app registers itself on the
 * user's own instance (POST /api/v1/apps) and gets a per-instance client id.
 */
export const MASTODON_CLIENT_NAME = 'Sosial';

/** read: profile + statuses + notifications; write: statuses + media + favourites. */
export const MASTODON_SCOPES = ['read', 'write'];

/** Mastodon accepts up to 4 images OR a single video per status. */
export const MASTODON_MAX_IMAGES = 4;
export const MASTODON_MAX_VIDEOS = 1;

/** Default cap on most servers — many raise it, but this keeps text safe. */
export const MASTODON_MAX_TEXT = 500;

/** Username like "alice" (or "@alice") lands on mastodon.social; a full
 *  server like "fosstodon.org" (or URL) is used as-is. Throws on junk. */
export function normalizeInstance(input: string): string {
  let host = (input ?? '').trim().toLowerCase();
  host = host.replace(/^https?:\/\//, '').replace(/^@/, '').replace(/\/+$/, '');
  host = host.split('/')[0].split('?')[0];
  // Bare word = a username on the flagship server (mirrors the Bluesky UX)
  if (host && !host.includes('.')) return 'mastodon.social';
  if (!host || /\s/.test(host)) {
    throw new Error('Type your username, or a server like fosstodon.org.');
  }
  return host;
}

/** Every Mastodon call is pinned to the account's own server. */
export function mastodonBase(instance: string): string {
  return `https://${instance}`;
}
