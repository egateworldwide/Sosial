import { X_MAX_TEXT } from './xConfig';
import { BSKY_MAX_TEXT } from './bskyConfig';
import { MASTODON_MAX_TEXT } from './mastodonConfig';

/**
 * Thread chains: one long idea published as a series of replies. Only these
 * four platforms support a native reply-to id; the rest get the joined text.
 */
export const THREAD_CAPS: Record<string, number> = {
  x: X_MAX_TEXT, // 280
  bluesky: BSKY_MAX_TEXT, // 300
  mastodon: MASTODON_MAX_TEXT, // instance default 500
  threads: 500, // Threads API hard cap
};

export function isChainPlatform(ch: string): boolean {
  return Object.prototype.hasOwnProperty.call(THREAD_CAPS, ch);
}

/**
 * Lowest cap across the SELECTED chain-capable channels — every segment has to
 * fit each one, so the strictest wins. Null when none are selected.
 */
export function chainLimit(platforms: string[]): number | null {
  const caps = (platforms ?? []).filter(isChainPlatform).map((p) => THREAD_CAPS[p]);
  if (!caps.length) return null;
  return Math.min(...caps);
}

/** The stored body for non-chain platforms is just the segments re-joined. */
export function joinThread(segments: string[]): string {
  return (segments ?? []).map((s) => (s ?? '').trim()).filter(Boolean).join('\n\n');
}

/** Index just after the last sentence-ending punctuation within `window`. */
function lastSentenceBreak(window: string): number {
  const re = /[.!?…](?=\s|$)/g;
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(window)) !== null) idx = m.index + 1;
  return idx;
}

/**
 * Split `text` into segments each ≤ `limit` chars. Breaks on the strongest
 * boundary available near the limit — paragraph gap, then sentence end, then
 * word gap — and only hard-cuts when a single unbroken run exceeds the limit.
 * Per-segment whitespace is trimmed. Returns [] for empty input.
 */
export function splitThread(text: string, limit: number): string[] {
  const max = Math.max(20, Math.floor(limit));
  const clean = (text ?? '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];

  const out: string[] = [];
  let rest = clean;
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = Math.max(
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('\n'),
      lastSentenceBreak(window),
      window.lastIndexOf(' '),
    );
    if (cut <= 0) cut = max; // one long unbreakable token — hard cut it
    cut = Math.min(cut, max);
    const piece = rest.slice(0, cut).trim();
    if (piece) out.push(piece);
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

/**
 * Best-effort split that also drops numbering. Auto-split keeps the user's
 * words intact; we never append "1/4" because that would push a segment over
 * the platform cap it was just fitted to.
 */
export function autoSplit(text: string, limit: number): string[] {
  return splitThread(text, limit);
}
