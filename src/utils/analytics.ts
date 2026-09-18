import { graph, IG_GRAPH, THREADS_API } from './metaConfig';
import { TT_API } from './tiktokConfig';
import { getValidToken } from './tiktokAuth';
import { MetaState } from './metaStore';
import { mastodonBase } from './mastodonConfig';
import { PIN_API } from './pinConfig';
import { getValidPin } from './pinAuth';
import { pinAnalytics } from './pinPublish';
import { LI_API, LI_VERSION } from './liConfig';
import { getValidLi, liAuthorUrn } from './liAuth';
import { YT_API } from './ytConfig';
import { getValidYt } from './ytAuth';
import { X_API } from './xConfig';
import { getValidXToken } from './xAuth';
import { getValidBsky } from './bskyAuth';

export type RangeKey = 'today' | 'yesterday' | 'last7' | 'last30' | 'last90' | 'last180' | 'last365';

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last month' },
  { key: 'last90', label: 'Last 3 months' },
  { key: 'last180', label: '6 months' },
  { key: 'last365', label: '1 year' },
];

/** [start, end) timestamps for a range key. */
export function rangeBounds(key: RangeKey): { start: number; end: number } {
  const now = new Date();
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86400000;
  switch (key) {
    case 'today': return { start: sod, end: sod + DAY };
    case 'yesterday': return { start: sod - DAY, end: sod };
    case 'last7': return { start: sod - 6 * DAY, end: sod + DAY };
    case 'last30': return { start: sod - 29 * DAY, end: sod + DAY };
    case 'last90': return { start: sod - 89 * DAY, end: sod + DAY };
    case 'last180': return { start: sod - 179 * DAY, end: sod + DAY };
    case 'last365': return { start: sod - 364 * DAY, end: sod + DAY };
  }
}

export interface PerPost {
  id: string;
  title: string;
  likes: number;
  comments: number;
  views: number | null;
  shares?: number;
  ts: number;
}

export interface ChannelStats {
  channel: 'facebook' | 'instagram' | 'threads' | 'tiktok' | 'x' | 'bluesky' | 'mastodon' | 'pinterest' | 'linkedin' | 'youtube';
  label: string;
  followers: number | null;
  posts: number;
  reactions: number;
  comments: number;
  views: number | null;
  shares?: number;
  engagementRate: number | null;
  perPost: PerPost[];
  followerSeries?: { ts: number; value: number }[];
  note?: string;
}

export interface FeedComment {
  channel: string;
  author: string;
  text: string;
  ts: number;
  postTitle: string;
}

// YouTube's Data API returns statistics as numeric strings ("1234"), so coerce.
const num = (v: any): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && isFinite(n) ? n : 0;
};
const tsOf = (v: any): number => {
  const t = Date.parse(v);
  return isNaN(t) ? 0 : t;
};

/** Mastodon returns status content as HTML — collapse to plain text. */
function stripHtml(html: string): string {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function jget(url: string, headers?: Record<string, string>): Promise<any> {
  const r = await fetch(url, headers ? { headers } : undefined);
  return r.json().catch(() => ({}));
}

/* ---------------- Facebook Page ---------------- */

async function fbStats(m: MetaState, start: number, end: number): Promise<ChannelStats> {
  const base: ChannelStats = {
    channel: 'facebook', label: m.pageName ?? 'Facebook page',
    followers: null, posts: 0, reactions: 0, comments: 0, views: null,
    engagementRate: null, perPost: [],
  };
  if (!m.pageId || !m.pageToken) return { ...base, note: 'Facebook not connected.' };
  const tok = encodeURIComponent(m.pageToken);
  try {
    const prof: any = await jget(graph(`/${m.pageId}?fields=fan_count,followers_count&access_token=${tok}`));
    if (!prof.error) base.followers = num(prof.followers_count) || num(prof.fan_count) || null;
    try {
      const ins: any = await jget(
        graph(`/${m.pageId}/insights?metric=page_fans&period=day&since=${Math.floor(start / 1000)}&until=${Math.floor(end / 1000)}&access_token=${tok}`),
      );
      const vals = ins?.data?.[0]?.values;
      if (Array.isArray(vals) && vals.length) {
        base.followerSeries = (vals as any[])
          .map((v) => ({ ts: tsOf(v.end_time), value: num(v.value) }))
          .filter((p) => p.ts > 0 && p.value > 0);
      }
    } catch {}
    // base list uses only fields that work with pages_read_engagement alone —
    // likes/comments .summary() aggregations throw (#10) on some apps even
    // WITH the permission granted (documented Meta platform quirk, Feb 2026).
    const feed: any = await jget(
      graph(`/${m.pageId}/posts?fields=id,message,created_time,shares&limit=25&access_token=${tok}`),
    );
    if (feed.error) throw new Error(feed.error.message || 'Could not read Page posts.');
    const inRange = ((feed.data ?? []) as any[]).filter((p) => {
      const t = tsOf(p.created_time);
      return t >= start && t < end;
    });
    base.perPost = inRange.map((p) => ({
      id: String(p.id),
      title: String(p.message ?? '').split('\n')[0].slice(0, 60) || 'Page post',
      likes: 0,
      comments: 0,
      views: null,
      shares: num(p.shares?.count),
      ts: tsOf(p.created_time),
    }));
    base.posts = base.perPost.length;
    base.shares = base.perPost.reduce((a, p) => a + (p.shares ?? 0), 0);
    // enrichment: like/comment totals need pages_read_user_content on the token.
    // Kept separate so a refusal here can never nuke the (working) list above.
    try {
      const enrich: any = await jget(
        graph(`/${m.pageId}/posts?fields=id,likes.summary(true),comments.summary(true)&limit=25&access_token=${tok}`),
      );
      if (enrich.error) throw new Error(enrich.error.message);
      const byId = new Map<string, any>(((enrich.data ?? []) as any[]).map((p) => [String(p.id), p]));
      for (const p of base.perPost) {
        const e = byId.get(p.id);
        if (!e) continue;
        p.likes = num(e.likes?.summary?.total_count);
        p.comments = num(e.comments?.summary?.total_count);
      }
      base.reactions = base.perPost.reduce((a, p) => a + p.likes, 0);
      base.comments = base.perPost.reduce((a, p) => a + p.comments, 0);
      if (base.followers) base.engagementRate = ((base.reactions + base.comments) / base.followers) * 100;
    } catch {
      base.note = 'Like/comment counts need the pages_read_user_content permission on this login.';
    }
  } catch (e: any) {
    base.note = e?.message ?? 'Facebook request failed.';
  }
  return base;
}

export async function fbComments(m: MetaState, stats: PerPost[]): Promise<FeedComment[]> {
  if (!m.pageToken) return [];
  const tok = encodeURIComponent(m.pageToken);
  const out: FeedComment[] = [];
  for (const p of stats.slice(0, 5)) {
    try {
      const c: any = await jget(graph(`/${p.id}/comments?fields=from,message,created_time&limit=10&access_token=${tok}`));
      for (const x of (c.data ?? []) as any[]) {
        out.push({
          channel: 'facebook',
          author: x.from?.name ?? 'Someone',
          text: String(x.message ?? ''),
          ts: tsOf(x.created_time),
          postTitle: p.title,
        });
      }
    } catch {}
  }
  return out;
}

/* ---------------- Instagram ---------------- */

async function igStats(m: MetaState, start: number, end: number): Promise<ChannelStats> {
  const base: ChannelStats = {
    channel: 'instagram', label: m.igName ?? 'Instagram',
    followers: null, posts: 0, reactions: 0, comments: 0, views: null,
    engagementRate: null, perPost: [],
  };
  if (!m.igId || !m.igToken) return { ...base, note: 'Instagram not connected.' };
  const tok = encodeURIComponent(m.igToken);
  try {
    const prof: any = await jget(`${IG_GRAPH}/me?fields=followers_count,media_count&access_token=${tok}`);
    if (!prof.error) base.followers = num(prof.followers_count) || null;
    try {
      const ins: any = await jget(
        `${IG_GRAPH}/me/insights?metric=follower_count&period=day&since=${Math.floor(start / 1000)}&until=${Math.floor(end / 1000)}&access_token=${tok}`,
      );
      const vals = ins?.data?.[0]?.values;
      if (Array.isArray(vals) && vals.length) {
        base.followerSeries = (vals as any[])
          .map((v) => ({ ts: tsOf(v.end_time), value: num(v.value) }))
          .filter((p) => p.ts > 0 && p.value > 0);
      }
    } catch {}
    const media: any = await jget(`${IG_GRAPH}/me/media?fields=id,caption,timestamp,like_count,comments_count&limit=25&access_token=${tok}`);
    if (media.error) throw new Error(media.error.message || 'Could not read Instagram media.');
    const inRange = ((media.data ?? []) as any[]).filter((x) => {
      const t = tsOf(x.timestamp);
      return t >= start && t < end;
    });
    base.perPost = inRange.map((x) => ({
      id: String(x.id),
      title: String(x.caption ?? '').split('\n')[0].slice(0, 60) || 'Instagram post',
      likes: num(x.like_count),
      comments: num(x.comments_count),
      views: null,
      ts: tsOf(x.timestamp),
    }));
    base.posts = base.perPost.length;
    base.reactions = base.perPost.reduce((a, p) => a + p.likes, 0);
    base.comments = base.perPost.reduce((a, p) => a + p.comments, 0);
    if (base.followers) base.engagementRate = ((base.reactions + base.comments) / base.followers) * 100;
  } catch (e: any) {
    base.note = e?.message ?? 'Instagram request failed.';
  }
  return base;
}

export async function igComments(m: MetaState, stats: PerPost[]): Promise<FeedComment[]> {
  if (!m.igToken) return [];
  const tok = encodeURIComponent(m.igToken);
  const out: FeedComment[] = [];
  for (const p of stats.slice(0, 5)) {
    try {
      const c: any = await jget(`${IG_GRAPH}/${p.id}/comments?fields=username,text,timestamp&limit=10&access_token=${tok}`);
      for (const x of (c.data ?? []) as any[]) {
        out.push({
          channel: 'instagram',
          author: x.username ? `@${x.username}` : 'Someone',
          text: String(x.text ?? ''),
          ts: tsOf(x.timestamp),
          postTitle: p.title,
        });
      }
    } catch {}
  }
  return out;
}

/* ---------------- Threads ---------------- */

async function thStats(m: MetaState, start: number, end: number): Promise<ChannelStats> {
  const base: ChannelStats = {
    channel: 'threads', label: m.threadsName ?? 'Threads',
    followers: null, posts: 0, reactions: 0, comments: 0, views: null,
    engagementRate: null, perPost: [],
  };
  if (!m.threadsId || !m.threadsToken) return { ...base, note: 'Threads not connected.' };
  const tok = encodeURIComponent(m.threadsToken);
  const tth = { Authorization: `Bearer ${m.threadsToken}` };
  try {
    // follower counts aren't in the documented profile fields — best-effort only
    try {
      const f: any = await jget(`${THREADS_API}/v1.0/me?fields=followers_count&access_token=${tok}`, tth);
      if (!f.error && typeof f.followers_count === 'number') base.followers = f.followers_count;
    } catch {}
    // followers_count is a Total Value metric: { total_value: { value } } —
    // no values[] array, and per docs it rejects since/until params.
    if (base.followers === null) {
      try {
        const ins: any = await jget(
          `${THREADS_API}/v1.0/${m.threadsId}/threads_insights?metric=followers_count&access_token=${tok}`,
          tth,
        );
        const arr = Array.isArray(ins?.data) ? ins.data : [];
        const entry = arr.find((v: any) => /follower/i.test(String(v?.name ?? ''))) ?? arr[0];
        const n = Number(entry?.total_value?.value ?? entry?.value);
        if (isFinite(n) && n > 0) base.followers = n;
      } catch {}
    }
    const list: any = await jget(
      `${THREADS_API}/v1.0/${m.threadsId}/threads?fields=id,text,timestamp,like_count,reply_count,repost_count,view_count&limit=25&access_token=${tok}`,
      tth,
    );
    if (list.error) throw new Error(list.error.message || 'Could not read Threads posts.');
    const inRange = ((list.data ?? []) as any[]).filter((x) => {
      const t = tsOf(x.timestamp);
      return t >= start && t < end;
    });
    base.perPost = inRange.map((x) => ({
      id: String(x.id),
      title: String(x.text ?? '').split('\n')[0].slice(0, 60) || 'Thread',
      likes: num(x.like_count),
      comments: num(x.reply_count),
      views: typeof x.view_count === 'number' ? x.view_count : null,
      ts: tsOf(x.timestamp),
    }));
    base.posts = base.perPost.length;
    base.reactions = base.perPost.reduce((a, p) => a + p.likes, 0);
    base.comments = base.perPost.reduce((a, p) => a + p.comments, 0);
    const v = base.perPost.reduce((a, p) => a + (p.views ?? 0), 0);
    base.views = v > 0 ? v : null;
    if (base.followers === null) base.note = 'Threads doesn’t expose follower counts to this app yet.';
  } catch (e: any) {
    base.note = e?.message ?? 'Threads request failed.';
  }
  return base;
}

export async function thComments(m: MetaState, stats: PerPost[]): Promise<FeedComment[]> {
  if (!m.threadsToken) return [];
  const tok = encodeURIComponent(m.threadsToken);
  const tth = { Authorization: `Bearer ${m.threadsToken}` };
  const out: FeedComment[] = [];
  for (const p of stats.slice(0, 5)) {
    try {
      const c: any = await jget(`${THREADS_API}/v1.0/${p.id}/conversation?fields=username,text,timestamp&limit=10&access_token=${tok}`, tth);
      for (const x of (c.data ?? []) as any[]) {
        out.push({
          channel: 'threads',
          author: x.username ? `@${x.username}` : 'Someone',
          text: String(x.text ?? ''),
          ts: tsOf(x.timestamp),
          postTitle: p.title,
        });
      }
    } catch {}
  }
  return out;
}

/* ---------------- TikTok (Display API — counts only, no reply threads) ---------------- */

async function ttGet(path: string, token: string): Promise<{ status: number; body: any }> {
  let r: Response;
  try {
    r = await fetch(`${TT_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('Could not reach TikTok — check your connection and retry.');
  }
  const body: any = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

function ttDetail(resp: { status: number; body: any }): string {
  const code = resp.body?.error?.code;
  const msg = resp.body?.error?.message;
  if (code && code !== 'ok') return `${msg || 'request failed'} [${code}]`;
  return `HTTP ${resp.status}`;
}

async function ttStats(m: MetaState, start: number, end: number): Promise<ChannelStats> {
  const base: ChannelStats = {
    channel: 'tiktok', label: m.ttName ?? 'TikTok',
    followers: null, posts: 0, reactions: 0, comments: 0, views: null,
    engagementRate: null, perPost: [],
  };
  if (!m.ttRefreshToken && !m.ttAccessToken) return { ...base, note: 'TikTok not connected.' };
  let token: string;
  try {
    token = await getValidToken();
  } catch (e: any) {
    return { ...base, note: e?.message ?? 'TikTok session expired — reconnect TikTok.' };
  }
  // 1) basic identity — same minimal fields login uses, must succeed
  let openId = '';
  try {
    const r = await ttGet(`/v2/user/info/?fields=open_id,display_name,avatar_url`, token);
    const u = r.body?.data?.user;
    if (!u?.open_id) throw new Error(`Could not read your TikTok profile (${ttDetail(r)}).`);
    openId = String(u.open_id);
    if (u.display_name) base.label = `@${u.display_name}`;
  } catch (e: any) {
    return { ...base, note: e?.message ?? 'TikTok request failed.' };
  }
  // 2) follower counts — may exceed granted scopes; never fatal
  try {
    const r = await ttGet(`/v2/user/info/?fields=follower_count,following_count,likes_count,video_count`, token);
    const u = r.body?.data?.user;
    if (u) base.followers = num(u.follower_count) || null;
    else base.note = `TikTok counts unavailable (${ttDetail(r)}).`;
  } catch (e: any) {
    base.note = e?.message ?? 'TikTok follower counts unavailable.';
  }
  // per-video stats need the video.list scope — tokens granted before it existed skip this
  if (openId) {
    try {
      const r = await fetch(`${TT_API}/v2/video/list/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({
          open_id: openId, cursor: 0, max_count: 20,
          fields: ['id', 'title', 'create_time', 'view_count', 'like_count', 'comment_count', 'share_count'],
        }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (j?.error?.code !== 'ok') throw new Error('video.list not granted');
      const inRange = ((j?.data?.videos ?? []) as any[]).filter((x) => {
        const t = num(x.create_time) * 1000;
        return t >= start && t < end;
      });
      base.perPost = inRange.map((x) => ({
        id: String(x.id),
        title: String(x.title ?? '').split('\n')[0].slice(0, 60) || 'TikTok video',
        likes: num(x.like_count),
        comments: num(x.comment_count),
        views: typeof x.view_count === 'number' ? x.view_count : null,
        ts: num(x.create_time) * 1000,
      }));
      base.posts = base.perPost.length;
      base.reactions = base.perPost.reduce((a, p) => a + p.likes, 0);
      base.comments = base.perPost.reduce((a, p) => a + p.comments, 0);
      const v = base.perPost.reduce((a, p) => a + (p.views ?? 0), 0);
      base.views = v > 0 ? v : null;
      if (base.followers) base.engagementRate = ((base.reactions + base.comments) / base.followers) * 100;
    } catch {}
  }
  return base;
}

/* ---------------- Mastodon (per-instance account API) ---------------- */

async function mastodonStats(m: MetaState, start: number, end: number): Promise<ChannelStats> {
  const base: ChannelStats = {
    channel: 'mastodon', label: m.mastodonName ?? 'Mastodon',
    followers: null, posts: 0, reactions: 0, comments: 0, views: null,
    engagementRate: null, perPost: [],
  };
  if (!m.mastodonAccessToken || !m.mastodonInstance) return { ...base, note: 'Mastodon not connected.' };
  const token = m.mastodonAccessToken;
  const baseUrl = mastodonBase(m.mastodonInstance);
  const h = { Authorization: `Bearer ${token}` };
  try {
    // verify_credentials doubles as the profile (followers + own id)
    const prof: any = await jget(`${baseUrl}/api/v1/accounts/verify_credentials`, h);
    if (!prof.id) throw new Error('Could not read your Mastodon profile.');
    base.followers = num(prof.followers_count) || null;
    const accountId = m.mastodonAccountId || String(prof.id);
    const list: any = await jget(`${baseUrl}/api/v1/accounts/${accountId}/statuses?limit=40`, h);
    const arr = Array.isArray(list) ? list : [];
    if (!Array.isArray(list)) throw new Error('Could not read Mastodon posts.');
    const inRange = arr.filter((x: any) => {
      const t = tsOf(x.created_at);
      return t >= start && t < end;
    });
    base.perPost = inRange.map((x: any) => ({
      id: String(x.id),
      title: stripHtml(x.content ?? '').split('\n')[0].slice(0, 60) || 'Toot',
      likes: num(x.favourites_count),
      comments: num(x.replies_count),
      views: null,
      shares: num(x.reblogs_count),
      ts: tsOf(x.created_at),
    }));
    base.posts = base.perPost.length;
    base.reactions = base.perPost.reduce((a, p) => a + p.likes, 0);
    base.comments = base.perPost.reduce((a, p) => a + p.comments, 0);
    base.shares = base.perPost.reduce((a, p) => a + (p.shares ?? 0), 0);
    if (base.followers) base.engagementRate = ((base.reactions + base.comments) / base.followers) * 100;
  } catch (e: any) {
    base.note = e?.message ?? 'Mastodon request failed.';
  }
  return base;
}

export async function mastodonComments(m: MetaState, stats: PerPost[]): Promise<FeedComment[]> {
  if (!m.mastodonAccessToken || !m.mastodonInstance) return [];
  const token = m.mastodonAccessToken;
  const baseUrl = mastodonBase(m.mastodonInstance);
  const h = { Authorization: `Bearer ${token}` };
  const out: FeedComment[] = [];
  for (const p of stats.slice(0, 5)) {
    try {
      const ctx: any = await jget(`${baseUrl}/api/v1/statuses/${p.id}/context`, h);
      for (const x of (ctx.descendants ?? []) as any[]) {
        out.push({
          channel: 'mastodon',
          author: x.account?.acct ? `@${x.account.acct}` : 'Someone',
          text: stripHtml(x.content ?? ''),
          ts: tsOf(x.created_at),
          postTitle: p.title,
        });
      }
    } catch {}
  }
  return out;
}

/* ---------------- Pinterest (Pins API v5) ---------------- */

/**
 * Followers from /user_account, recent Pins from /pins, per-Pin engagement
 * (impressions/saves/clicks) from /pins/{id}/analytics. Analytics 403s on
 * apps without production access — then titles still rank with an honest
 * note. Pinterest exposes no comment-read API, so comments stay empty.
 */
async function pinStats(m: MetaState, start: number, end: number): Promise<ChannelStats> {
  const base: ChannelStats = {
    channel: 'pinterest', label: m.pinUsername ?? 'Pinterest',
    followers: null, posts: 0, reactions: 0, comments: 0, views: null,
    engagementRate: null, perPost: [],
  };
  if (!m.pinAccessToken) return { ...base, note: 'Pinterest not connected.' };
  try {
    const { token } = await getValidPin();
    const h = { Authorization: `Bearer ${token}` };
    try {
      const acct: any = await jget(`${PIN_API}/user_account`, h);
      base.followers = num(acct.follower_count) || null;
      if (acct.username && !m.pinUsername) base.label = `@${acct.username}`;
    } catch {}
    let pins: any[] = [];
    try {
      const pl: any = await jget(`${PIN_API}/pins?page_size=50`, h);
      pins = Array.isArray(pl?.items) ? pl.items : (Array.isArray(pl) ? pl : []);
    } catch {}
    const inRange = pins.filter((x: any) => {
      const t = tsOf(x.created_at);
      return t >= start && t < end;
    });
    // One analytics call per Pin — cap so a big range can't hammer it.
    const capped = inRange.slice(0, 15);
    let denied = false;
    const eng = await Promise.all(
      capped.map(async (x: any) => {
        try {
          const e = await pinAnalytics(token, String(x.id), start, end);
          return { views: e.impressions, likes: e.saves, shares: e.clicks };
        } catch (e: any) {
          if (/401|403|need.*access|production/i.test(String(e?.message ?? ''))) denied = true;
          return { views: 0, likes: 0, shares: 0 };
        }
      }),
    );
    base.perPost = capped.map((x: any, i: number) => ({
      id: String(x.id),
      title: String(x.title ?? x.description ?? 'Pin').split('\n')[0].slice(0, 60),
      likes: eng[i].likes,
      comments: 0,
      views: eng[i].views || null,
      shares: eng[i].shares,
      ts: tsOf(x.created_at),
    }));
    base.posts = base.perPost.length;
    base.reactions = eng.reduce((a, e) => a + e.likes, 0);
    base.views = eng.reduce((a, e) => a + e.views, 0) || null;
    base.shares = eng.reduce((a, e) => a + e.shares, 0);
    if (denied) {
      base.note = 'Pinterest shows Pins only — Pin-level engagement needs production access on developers.pinterest.com.';
    } else if (inRange.length > capped.length) {
      base.note = `Showing engagement for the ${capped.length} most recent of ${inRange.length} Pins in range. Saves count as likes — Pinterest exposes no comment API.`;
    } else {
      base.note = 'Saves count as likes — Pinterest exposes no comment API.';
    }
  } catch (e: any) {
    base.note = e?.message ?? 'Pinterest request failed.';
  }
  return base;
}

/* ---------------- LinkedIn (member Posts API) ---------------- */

/**
 * Post listing + per-post likes/comments via Social Actions. Needs the
 * r_member_social scope (LI_SCOPES) — connections made before it was added
 * must disconnect + reconnect to grant it, otherwise the finder/social calls
 * 403 and the channel degrades to the honest note below.
 * Follower counts are intentionally null: LinkedIn exposes no member
 * follower-count API to third parties (only Company Page followers, which is
 * a different product + org admin flow).
 */
/** One Social Actions call per post (capped) → likes/comments + channel totals.
 *  Sets denied=true when LinkedIn 403/401s so callers can show the reconnect
 *  note instead of silently reporting zeros. */
async function liPostEngagement(
  h: Record<string, string>,
  inRange: any[],
): Promise<{ perPost: PerPost[]; reactions: number; comments: number; denied: boolean; truncated: boolean }> {
  // Social Actions is one call per post — cap so a big range can't hammer it.
  const capped = inRange.slice(0, 15);
  let denied = false;
  const eng = await Promise.all(
    capped.map(async (x: any) => {
      const urn = String(x.id ?? '');
      if (!urn.startsWith('urn:li:')) return { likes: 0, comments: 0 };
      try {
        const s: any = await jget(`${LI_API}/rest/socialActions/${encodeURIComponent(urn)}`, h);
        if (typeof s?.status === 'number' && s.status >= 400) {
          if (s.status === 401 || s.status === 403) denied = true;
          return { likes: 0, comments: 0 };
        }
        return { likes: num(s?.likesSummary?.totalLikes), comments: num(s?.commentsSummary?.totalComments) };
      } catch {
        return { likes: 0, comments: 0 };
      }
    }),
  );
  return {
    perPost: capped.map((x: any, i: number) => ({
      id: String(x.id ?? ''),
      title: String(x.commentary ?? 'Post').split('\n')[0].slice(0, 60) || 'Post',
      likes: eng[i].likes,
      comments: eng[i].comments,
      views: null,
      ts: tsOf(x.createdAt ?? x.publishedAt ?? x.lastModifiedAt),
    })),
    reactions: eng.reduce((a, e) => a + e.likes, 0),
    comments: eng.reduce((a, e) => a + e.comments, 0),
    denied,
    truncated: inRange.length > capped.length,
  };
}

/** Page follower count. Members have no follower API — orgs do (networkSizes). */
async function liOrgFollowers(h: Record<string, string>, orgId: string): Promise<number | null> {
  try {
    const j: any = await jget(
      `${LI_API}/rest/networkSizes/urn:li:organization:${orgId}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`,
      h,
    );
    return typeof j?.firstDegreeSize === 'number' ? j.firstDegreeSize : null;
  } catch {
    return null;
  }
}

/**
 * Member posts + engagement via Social Actions (needs r_member_social), or —
 * when a Company Page is picked — the Page's posts + its follower count
 * (needs r_organization_social). Connections made before the scopes were added
 * must disconnect + reconnect to grant them; otherwise the finder/social calls
 * 403 and the channel degrades to the honest note below.
 */
async function liStats(m: MetaState, start: number, end: number): Promise<ChannelStats> {
  const base: ChannelStats = {
    channel: 'linkedin', label: m.liName ?? 'LinkedIn',
    followers: null, posts: 0, reactions: 0, comments: 0, views: null,
    engagementRate: null, perPost: [],
  };
  if (!m.liPersonUrn) return { ...base, note: 'LinkedIn not connected.' };
  try {
    const { token } = await getValidLi();
    const h = {
      Authorization: `Bearer ${token}`,
      'LinkedIn-Version': LI_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
      'X-RestLi-Method': 'FINDER',
    };
    const orgMode = !!m.liOrgId;
    const author = liAuthorUrn(m);
    if (orgMode) base.label = m.liOrgName ?? 'Company Page';
    const list: any = await jget(
      `${LI_API}/rest/posts?author=${encodeURIComponent(author)}&q=author&count=25&sortBy=LAST_MODIFIED`,
      h,
    );
    if (typeof list?.status === 'number' && list.status >= 400) {
      throw new Error(list?.message ?? `LinkedIn error ${list.status}`);
    }
    const arr = Array.isArray(list?.elements) ? list.elements : [];
    const inRange = arr.filter((x: any) => {
      const t = tsOf(x.createdAt ?? x.publishedAt ?? x.lastModifiedAt);
      return t >= start && t < end;
    });
    const e = await liPostEngagement(h, inRange);
    base.perPost = e.perPost;
    base.posts = e.perPost.length;
    base.reactions = e.reactions;
    base.comments = e.comments;
    if (orgMode && m.liOrgId) base.followers = await liOrgFollowers(h, m.liOrgId);
    if (e.denied) {
      base.note = 'LinkedIn shows posts only — disconnect and reconnect LinkedIn to grant the read permission for likes & comments.';
    } else if (e.truncated) {
      base.note = `Showing engagement for the ${e.perPost.length} most recent of ${inRange.length} posts in range.`;
    } else if (!orgMode) {
      base.note = 'LinkedIn exposes no follower count for personal profiles — pick a Company Page to see followers.';
    }
  } catch (e: any) {
    base.note = /403|not.*permis|denied|restrict/i.test(e?.message ?? '')
      ? 'LinkedIn shows your profile only — post & engagement reads need an approved API permission (r_member_social). Posting works fine.'
      : (e?.message ?? 'LinkedIn request failed.');
  }
  return base;
}

/* ---------------- YouTube (Data API v3) ---------------- */

/**
 * Channel stats + uploads playlist + one batched statistics call + top-level
 * comments per recent video. All cheap quota-wise (1 unit per list call).
 * Videos with disabled comments just contribute no comments.
 */
async function ytStats(m: MetaState, start: number, end: number): Promise<ChannelStats> {
  const base: ChannelStats = {
    channel: 'youtube', label: m.ytChannelName ?? 'YouTube',
    followers: null, posts: 0, reactions: 0, comments: 0, views: null,
    engagementRate: null, perPost: [],
  };
  if (!m.ytRefreshToken && !m.ytAccessToken) return { ...base, note: 'YouTube not connected.' };
  try {
    const { token } = await getValidYt();
    const h = { Authorization: `Bearer ${token}` };
    const ch: any = await jget(`${YT_API}/channels?part=statistics,contentDetails,snippet&mine=true`, h);
    const item = ch?.items?.[0];
    if (!item) throw new Error('Could not read your YouTube channel.');
    base.followers = num(item.statistics?.subscriberCount) || null;
    if (!m.ytChannelName && item.snippet?.title) base.label = String(item.snippet.title);
    const uploads: string | undefined = item.contentDetails?.relatedPlaylists?.uploads;
    let vids: { id: string; title: string; ts: number }[] = [];
    if (uploads) {
      try {
        const pl: any = await jget(`${YT_API}/playlistItems?part=snippet,contentDetails&playlistId=${uploads}&maxResults=25`, h);
        const arr = Array.isArray(pl?.items) ? pl.items : [];
        vids = arr
          .map((x: any) => ({
            id: String(x?.contentDetails?.videoId ?? ''),
            title: String(x?.snippet?.title ?? 'Video'),
            ts: tsOf(x?.snippet?.publishedAt),
          }))
          .filter((v: any) => v.id && v.ts >= start && v.ts < end);
      } catch {}
    }
    let statsById: Record<string, any> = {};
    if (vids.length) {
      try {
        const ids = [...new Set(vids.map((v) => v.id))].slice(0, 50).join(',');
        const vs: any = await jget(`${YT_API}/videos?part=statistics&id=${encodeURIComponent(ids)}`, h);
        for (const x of (Array.isArray(vs?.items) ? vs.items : []) as any[]) {
          if (x?.id) statsById[String(x.id)] = x.statistics ?? {};
        }
      } catch {}
    }
    base.perPost = vids.map((v) => {
      const s = statsById[v.id] ?? {};
      return {
        id: v.id,
        title: v.title.split('\n')[0].slice(0, 60),
        likes: num(s.likeCount),
        comments: num(s.commentCount),
        views: num(s.viewCount) || null,
        ts: v.ts,
      };
    });
    base.posts = base.perPost.length;
    base.reactions = base.perPost.reduce((a, p) => a + p.likes, 0);
    base.comments = base.perPost.reduce((a, p) => a + p.comments, 0);
    const views = base.perPost.reduce((a, p) => a + (p.views ?? 0), 0);
    base.views = views || null;
    if (base.followers) base.engagementRate = ((base.reactions + base.comments) / base.followers) * 100;
  } catch (e: any) {
    base.note = e?.message ?? 'YouTube request failed.';
  }
  return base;
}

export async function ytComments(m: MetaState, stats: PerPost[]): Promise<FeedComment[]> {
  if (!m.ytRefreshToken && !m.ytAccessToken) return [];
  let token = '';
  try {
    ({ token } = await getValidYt());
  } catch {
    return [];
  }
  const h = { Authorization: `Bearer ${token}` };
  const out: FeedComment[] = [];
  for (const p of stats.slice(0, 5)) {
    try {
      const ct: any = await jget(`${YT_API}/commentThreads?part=snippet&videoId=${encodeURIComponent(p.id)}&maxResults=20&order=time`, h);
      for (const x of (Array.isArray(ct?.items) ? ct.items : []) as any[]) {
        const s = x?.snippet?.topLevelComment?.snippet;
        if (!s) continue;
        out.push({
          channel: 'youtube',
          author: String(s.authorDisplayName ?? 'Someone'),
          text: String(s.textDisplay ?? ''),
          ts: tsOf(s.publishedAt),
          postTitle: p.title,
        });
      }
    } catch {}
  }
  return out;
}

/* ---------------- X (API v2) ---------------- */

/**
 * Profile + recent posts with public metrics. Reply COUNTS come through;
 * reply TEXT needs conversation search (paid tier), so the comment feed
 * stays empty for X — counts still drive engagement.
 */
async function xStats(m: MetaState, start: number, end: number): Promise<ChannelStats> {
  const base: ChannelStats = {
    channel: 'x', label: m.xName ?? 'X',
    followers: null, posts: 0, reactions: 0, comments: 0, views: null,
    engagementRate: null, perPost: [],
  };
  if (!m.xUserId && !m.xAccessToken && !m.xRefreshToken) return { ...base, note: 'X not connected.' };
  try {
    const token = await getValidXToken();
    const h = { Authorization: `Bearer ${token}` };
    const me: any = await jget(`${X_API}/users/me?user.fields=public_metrics,username`, h);
    if (!me?.data?.id) throw new Error('Could not read your X profile.');
    base.followers = num(me.data.public_metrics?.followers_count) || null;
    if (!m.xName && me.data.username) base.label = `@${me.data.username}`;
    const uid = m.xUserId || String(me.data.id);
    const tl: any = await jget(
      `${X_API}/users/${uid}/tweets?max_results=20&exclude=replies,retweets&tweet.fields=created_at,public_metrics`,
      h,
    );
    if (tl?.errors && !Array.isArray(tl?.data)) {
      throw new Error(String(tl.errors[0]?.detail ?? 'Could not read your posts.'));
    }
    const arr = Array.isArray(tl?.data) ? tl.data : [];
    const inRange = arr.filter((x: any) => {
      const t = tsOf(x.created_at);
      return t >= start && t < end;
    });
    base.perPost = inRange.map((x: any) => {
      const pm = x.public_metrics ?? {};
      return {
        id: String(x.id),
        title: String(x.text ?? '').split('\n')[0].slice(0, 60) || 'Post',
        likes: num(pm.like_count),
        comments: num(pm.reply_count),
        views: num(pm.impression_count) || null,
        shares: num(pm.retweet_count),
        ts: tsOf(x.created_at),
      };
    });
    base.posts = base.perPost.length;
    base.reactions = base.perPost.reduce((a, p) => a + p.likes, 0);
    base.comments = base.perPost.reduce((a, p) => a + p.comments, 0);
    base.shares = base.perPost.reduce((a, p) => a + (p.shares ?? 0), 0);
    if (base.followers) base.engagementRate = ((base.reactions + base.comments) / base.followers) * 100;
  } catch (e: any) {
    base.note = e?.message ?? 'X request failed.';
  }
  return base;
}

/* ---------------- Bluesky (PDS appview, fully open) ---------------- */

/** pdsHost is stored as a full URL — never prepend a second scheme. */
function bskyApi(pdsHost: string): string {
  const h = pdsHost.replace(/\/+$/, '');
  return (h.startsWith('http://') || h.startsWith('https://') ? h : `https://${h}`) + '/xrpc';
}

async function bskyStats(m: MetaState, start: number, end: number): Promise<ChannelStats> {
  const base: ChannelStats = {
    channel: 'bluesky', label: m.bskyName ?? 'Bluesky',
    followers: null, posts: 0, reactions: 0, comments: 0, views: null,
    engagementRate: null, perPost: [],
  };
  if (!m.bskyDid || !m.bskyPdsHost) return { ...base, note: 'Bluesky not connected.' };
  try {
    const { token, did, pdsHost } = await getValidBsky();
    const h = { Authorization: `Bearer ${token}` };
    const api = bskyApi(pdsHost);
    try {
      const prof: any = await jget(`${api}/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`, h);
      base.followers = num(prof.followersCount) || null;
      if (!m.bskyName && prof.handle) base.label = `@${prof.handle}`;
    } catch {}
    const feed: any = await jget(`${api}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(did)}&limit=30`, h);
    if (!Array.isArray(feed?.feed)) throw new Error('Could not read Bluesky posts.');
    const inRange = (feed.feed as any[]).filter((it: any) => {
      if (!it?.post || it.reason || it.reply) return false;
      const t = tsOf(it.post?.record?.createdAt);
      return t >= start && t < end;
    });
    base.perPost = inRange.map((it: any) => {
      const p = it.post;
      return {
        id: String(p.uri),
        title: String(p.record?.text ?? '').split('\n')[0].slice(0, 60) || 'Post',
        likes: num(p.likeCount),
        comments: num(p.replyCount),
        views: null,
        shares: num(p.repostCount),
        ts: tsOf(p.record?.createdAt),
      };
    });
    base.posts = base.perPost.length;
    base.reactions = base.perPost.reduce((a, p) => a + p.likes, 0);
    base.comments = base.perPost.reduce((a, p) => a + p.comments, 0);
    base.shares = base.perPost.reduce((a, p) => a + (p.shares ?? 0), 0);
    if (base.followers) base.engagementRate = ((base.reactions + base.comments) / base.followers) * 100;
  } catch (e: any) {
    base.note = e?.message ?? 'Bluesky request failed.';
  }
  return base;
}

export async function bskyComments(m: MetaState, stats: PerPost[]): Promise<FeedComment[]> {
  if (!m.bskyDid || !m.bskyPdsHost) return [];
  let creds: { token: string; pdsHost: string };
  try {
    creds = await getValidBsky();
  } catch {
    return [];
  }
  const h = { Authorization: `Bearer ${creds.token}` };
  const api = bskyApi(creds.pdsHost);
  const out: FeedComment[] = [];
  for (const p of stats.slice(0, 5)) {
    try {
      const th: any = await jget(`${api}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(p.id)}&depth=1`, h);
      for (const r of (Array.isArray(th?.thread?.replies) ? th.thread.replies : []) as any[]) {
        const rp = r?.reply?.post ?? r?.post;
        if (!rp) continue;
        out.push({
          channel: 'bluesky',
          author: rp.author?.handle ? `@${rp.author.handle}` : 'Someone',
          text: String(rp.record?.text ?? ''),
          ts: tsOf(rp.indexedAt ?? rp.record?.createdAt),
          postTitle: p.title,
        });
      }
    } catch {}
  }
  return out;
}

/* ---------------- combined ---------------- */

export interface Analytics {
  channels: ChannelStats[];
  comments: FeedComment[];
}

export async function fetchAnalytics(m: MetaState, range: RangeKey): Promise<Analytics> {
  const { start, end } = rangeBounds(range);
  const [fb, ig, th, tt, xx, bs, mt, pn, li, yt] = await Promise.all([fbStats(m, start, end), igStats(m, start, end), thStats(m, start, end), ttStats(m, start, end), xStats(m, start, end), bskyStats(m, start, end), mastodonStats(m, start, end), pinStats(m, start, end), liStats(m, start, end), ytStats(m, start, end)]);
  const [fc, ic, tc, mc, bc, yc] = await Promise.all([fbComments(m, fb.perPost), igComments(m, ig.perPost), thComments(m, th.perPost), mastodonComments(m, mt.perPost), bskyComments(m, bs.perPost), ytComments(m, yt.perPost)]);
  const comments = [...fc, ...ic, ...tc, ...mc, ...bc, ...yc].sort((a, b) => b.ts - a.ts);
  return { channels: [fb, ig, th, tt, xx, bs, mt, pn, li, yt], comments };
}
