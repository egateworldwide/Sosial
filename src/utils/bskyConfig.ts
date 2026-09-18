/**
 * Bluesky (AT Protocol) — handle + app password, no OAuth, no review.
 *
 * HOW THIS DIFFERS FROM THE OAUTH CHANNELS (read before touching):
 * 1. No app keys, no bridge page, no AuthChannel — the user pastes an app
 *    password they mint at bsky.app → Settings → App passwords.
 * 2. Every account lives on its own PDS (server). bsky.social users sit on
 *    one host, self-hosters elsewhere — so we resolve handle → DID →
 *    PDS host on every login (see bskyAuth.ts) and talk to that host.
 * 3. Images go as raw-byte blobs (1 MB hard cap each, max 4 per post), then
 *    the post record references them. Anything bigger must be recompressed
 *    first — see ensureSmallImage() in bskyPublish.ts.
 * 4. Text caps at 300 chars; links only become clickable via explicit facets
 *    (byte offsets — see linkFacets() in bskyPublish.ts).
 * 5. accessJwt lives ~2h; refreshJwt is long-lived. Same silent-refresh
 *    pattern as TikTok/X via getValidBsky() in bskyAuth.ts.
 */

export const BSKY_RESOLVE = 'https://bsky.social/xrpc/com.atproto.identity.resolveHandle';
export const BSKY_PLC = 'https://plc.directory';

export const BSKY_MAX_IMAGES = 4;
export const BSKY_MAX_TEXT = 300;
export const BSKY_BLOB_CAP = 1000000; // 1,000,000 bytes per blob, server-enforced
export const BSKY_MAX_DIM = 2000; // longest side after recompress
