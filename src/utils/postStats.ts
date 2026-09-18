import { graph, IG_GRAPH, THREADS_API } from './metaConfig';
import { X_API } from './xConfig';
import { YT_API } from './ytConfig';
import { LI_API, LI_VERSION } from './liConfig';
import { getValidLi } from './liAuth';
import { getValidPin } from './pinAuth';
import { pinAnalytics } from './pinPublish';
import { getValidXToken } from './xAuth';
import { getValidBsky } from './bskyAuth';
import { getValidMastodon } from './mastodonAuth';
import { mastodonBase } from './mastodonConfig';
import { getValidYt } from './ytAuth';
import { loadMetaState } from './metaStore';

export interface SentPostStats {
  likes: number;
  comments: number;
  views: number | null;
  shares: number;
  note?: string;
}

const num = (v: any): number => {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : 0;
};

const zero = (note?: string): SentPostStats => ({ likes: 0, comments: 0, views: null, shares: 0, note });

/** pdsHost is stored as a full URL — never prepend a second scheme. */
function bskyApi(pdsHost: string): string {
  const h = pdsHost.replace(/\/+$/, '');
  return (h.startsWith('http://') || h.startsWith('https://') ? h : `https://${h}`) + '/xrpc';
}

/**
 * Live engagement for one published post, looked up by the remote id saved
 * at publish time. Pinterest ids may be comma-joined (one Pin per image) —
 * stats read the first. TikTok has no post-read API and returns zeros with
 * an honest note instead of failing.
 */
export async function fetchPostStats(channel: string, remoteId: string): Promise<SentPostStats> {
  const id = (remoteId ?? '').split(',')[0].trim();
  if (!id) return zero('No post id was saved for this channel.');
  try {
    switch (channel) {
      case 'facebook': {
        const m = await loadMetaState();
        if (!m.pageToken) throw new Error('Facebook not connected');
        const tok = encodeURIComponent(m.pageToken);
        const j: any = await (await fetch(graph(`/${id}?fields=likes.summary(true),comments.summary(true),shares&access_token=${tok}`))).json().catch(() => ({}));
        if (j?.error) throw new Error(j.error.message ?? 'Could not read post.');
        return {
          likes: num(j.likes?.summary?.total_count),
          comments: num(j.comments?.summary?.total_count),
          views: null,
          shares: num(j.shares?.count),
        };
      }
      case 'instagram': {
        const m = await loadMetaState();
        if (!m.igToken) throw new Error('Instagram not connected');
        const tok = encodeURIComponent(m.igToken);
        const j: any = await (await fetch(`${IG_GRAPH}/${id}?fields=like_count,comments_count&access_token=${tok}`)).json().catch(() => ({}));
        if (j?.error) throw new Error(j.error.message ?? 'Could not read post.');
        return { likes: num(j.like_count), comments: num(j.comments_count), views: null, shares: 0 };
      }
      case 'threads': {
        const m = await loadMetaState();
        if (!m.threadsToken) throw new Error('Threads not connected');
        const tok = encodeURIComponent(m.threadsToken);
        const j: any = await (
          await fetch(`${THREADS_API}/v1.0/${id}?fields=like_count,reply_count,repost_count,view_count&access_token=${tok}`, {
            headers: { Authorization: `Bearer ${m.threadsToken}` },
          })
        ).json().catch(() => ({}));
        if (j?.error) throw new Error(j.error.message ?? 'Could not read post.');
        return {
          likes: num(j.like_count),
          comments: num(j.reply_count),
          views: typeof j.view_count === 'number' ? j.view_count : null,
          shares: num(j.repost_count),
        };
      }
      case 'x': {
        const token = await getValidXToken();
        const j: any = await (
          await fetch(`${X_API}/tweets/${id}?tweet.fields=public_metrics`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).json().catch(() => ({}));
        const pm = j?.data?.public_metrics;
        if (!pm) throw new Error(j?.errors?.[0]?.detail ?? 'Could not read post.');
        return {
          likes: num(pm.like_count),
          comments: num(pm.reply_count),
          views: num(pm.impression_count) || null,
          shares: num(pm.retweet_count),
        };
      }
      case 'bluesky': {
        const { token, pdsHost } = await getValidBsky();
        const j: any = await (
          await fetch(`${bskyApi(pdsHost)}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(id)}&depth=0`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).json().catch(() => ({}));
        const p = j?.thread?.post;
        if (!p) throw new Error('Could not read post.');
        return { likes: num(p.likeCount), comments: num(p.replyCount), views: null, shares: num(p.repostCount) };
      }
      case 'mastodon': {
        const { token, instance } = await getValidMastodon();
        const j: any = await (
          await fetch(`${mastodonBase(instance)}/api/v1/statuses/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).json().catch(() => ({}));
        if (!j?.id) throw new Error('Could not read post.');
        return { likes: num(j.favourites_count), comments: num(j.replies_count), views: null, shares: num(j.reblogs_count) };
      }
      case 'youtube': {
        const { token } = await getValidYt();
        const j: any = await (
          await fetch(`${YT_API}/videos?part=statistics&id=${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).json().catch(() => ({}));
        const s = Array.isArray(j?.items) ? j.items[0]?.statistics : undefined;
        if (!s) throw new Error('Could not read video.');
        return {
          likes: num(s.likeCount),
          comments: num(s.commentCount),
          views: num(s.viewCount) || null,
          shares: 0,
        };
      }
      case 'linkedin': {
        // Remote id is the post URN from x-restli-id (urn:li:share:… / urn:li:ugcPost:…).
        if (!id.startsWith('urn:li:')) return zero('No LinkedIn post id was saved — republish to track this post.');
        const { token } = await getValidLi();
        const j: any = await (
          await fetch(`${LI_API}/rest/socialActions/${encodeURIComponent(id)}`, {
            headers: {
              Authorization: `Bearer ${token}`,
              'LinkedIn-Version': LI_VERSION,
              'X-Restli-Protocol-Version': '2.0.0',
            },
          })
        ).json().catch(() => ({}));
        if (typeof j?.status === 'number' && j.status >= 400) {
          if (j.status === 401 || j.status === 403) {
            return zero('LinkedIn read permission not granted — disconnect and reconnect LinkedIn, then retry.');
          }
          throw new Error(j?.message ?? 'Could not read post.');
        }
        return {
          likes: num(j?.likesSummary?.totalLikes),
          comments: num(j?.commentsSummary?.totalComments),
          views: null,
          shares: 0,
        };
      }
      case 'pinterest': {
        const { token } = await getValidPin();
        const end = Date.now();
        const e = await pinAnalytics(token, id, end - 30 * 86400000, end);
        return {
          likes: e.saves,
          comments: 0,
          views: e.impressions || null,
          shares: e.clicks,
          note: 'Saves count as likes — Pinterest exposes no comment API.',
        };
      }
      default:
        return zero('Stats aren’t available for this channel via its API.');
    }
  } catch (e: any) {
    return zero(e?.message ?? 'Could not load stats.');
  }
}
