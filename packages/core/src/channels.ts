/**
 * Canonical channel ids — the 10 postable providers.
 * Mirrors `ChannelKey` in the mobile app (`src/utils/managed.ts`).
 * `whatsapp` / `snapchat` are presentation-only (cards/share sheets) and are
 * deliberately NOT members of this union.
 */
export type ChannelKey =
  | 'facebook'
  | 'instagram'
  | 'threads'
  | 'tiktok'
  | 'x'
  | 'bluesky'
  | 'linkedin'
  | 'mastodon'
  | 'pinterest'
  | 'youtube';

export const CHANNELS: readonly ChannelKey[] = [
  'facebook',
  'instagram',
  'threads',
  'tiktok',
  'x',
  'bluesky',
  'linkedin',
  'mastodon',
  'pinterest',
  'youtube',
];

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
  tiktok: 'TikTok',
  x: 'X',
  bluesky: 'Bluesky',
  linkedin: 'LinkedIn',
  mastodon: 'Mastodon',
  pinterest: 'Pinterest',
  youtube: 'YouTube',
};

/** `'any'` is a composer pseudo-channel ("post everywhere connected"). It is
 *  never stored — the server resolves it to concrete connected channels. */
export const ANY_CHANNEL = 'any' as const;

export function isChannelKey(v: string): v is ChannelKey {
  return (CHANNELS as readonly string[]).includes(v);
}
