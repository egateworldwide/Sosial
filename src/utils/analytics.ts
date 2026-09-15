import { graph, IG_GRAPH, THREADS_API } from './metaConfig';
import { TT_API } from './tiktokConfig';
import { getValidToken } from './tiktokAuth';
import { MetaState } from './metaStore';

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
  ts: number;
}

export interface ChannelStats {
  channel: 'facebook' | 'instagram' | 'threads' | 'tiktok';
  label: string;
  followers: number | null;
  posts: number;
  reactions: number;
  comments: number;
  views: number | null;
  engagementRate: number | null;
  perPost: PerPost[];
  note?: string;
}

export interface FeedComment {
  channel: string;
  author: string;
  text: string;
  ts: number;
  postTitle: string;
}

const num = (v: any): number => (typeof v === 'number' && isFinite(v) ? v : 0);
const tsOf = (v: any): number => {
  const t = Date.parse(v);
  return isNaN(t) ? 0 : t;
};

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
    const feed: any = await jget(
      graph(`/${m.pageId}/posts?fields=id,message,created_time,likes.summary(true),comments.summary(true)&limit=25&access_token=${tok}`),
    );
    if (feed.error) throw new Error(feed.error.message || 'Could not read Page posts.');
    const inRange = ((feed.data ?? []) as any[]).filter((p) => {
      const t = tsOf(p.created_time);
      return t >= start && t < end;
    });
    base.perPost = inRange.map((p) => ({
      id: String(p.id),
      title: String(p.message ?? '').split('\n')[0].slice(0, 60) || 'Page post',
      likes: num(p.likes?.summary?.total_count),
      comments: num(p.comments?.summary?.total_count),
      views: null,
      ts: tsOf(p.created_time),
    }));
    base.posts = base.perPost.length;
    base.reactions = base.perPost.reduce((a, p) => a + p.likes, 0);
    base.comments = base.perPost.reduce((a, p) => a + p.comments, 0);
    if (base.followers) base.engagementRate = ((base.reactions + base.comments) / base.followers) * 100;
  } catch (e: any) {
    base.note = e?.message ?? 'Facebook request failed.';
  }
  return base;
}

async function fbComments(m: MetaState, stats: PerPost[]): Promise<FeedComment[]> {
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

async function igComments(m: MetaState, stats: PerPost[]): Promise<FeedComment[]> {
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
      const f: any = await jget(`${THREADS_API}/me?fields=followers_count&access_token=${tok}`, tth);
      if (!f.error && typeof f.followers_count === 'number') base.followers = f.followers_count;
    } catch {}
    // followers live behind the insights permission — try it, stay null otherwise
    if (base.followers === null) {
      try {
        const since = Math.floor((Date.now() - 30 * 86400000) / 1000);
        const until = Math.floor(Date.now() / 1000);
        const ins: any = await jget(
          `${THREADS_API}/${m.threadsId}/threads_insights?metric=followers_count&since=${since}&until=${until}&access_token=${tok}`,
          tth,
        );
        const arr = Array.isArray(ins?.data) ? ins.data : [];
        const entry = arr.find((v: any) => /follower/i.test(String(v?.name ?? ''))) ?? arr[0];
        const points = Array.isArray(entry?.values) ? entry.values : [];
        const last = points.length ? points[points.length - 1] : entry;
        const n = Number(last?.value);
        if (isFinite(n) && n > 0) base.followers = n;
      } catch {}
    }
    const list: any = await jget(
      `${THREADS_API}/${m.threadsId}/threads?fields=id,text,timestamp,like_count,reply_count,repost_count,view_count&limit=25&access_token=${tok}`,
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
    const extras: string[] = [];
    if (base.followers === null) extras.push('Threads doesn’t expose follower counts to this app yet.');
    if (base.posts === 0) extras.push(`No threads found for ${base.label} in this range — try a wider range.`);
    if (extras.length) base.note = extras.join(' ');
  } catch (e: any) {
    base.note = e?.message ?? 'Threads request failed.';
  }
  return base;
}

async function thComments(m: MetaState, stats: PerPost[]): Promise<FeedComment[]> {
  if (!m.threadsToken) return [];
  const tok = encodeURIComponent(m.threadsToken);
  const tth = { Authorization: `Bearer ${m.threadsToken}` };
  const out: FeedComment[] = [];
  for (const p of stats.slice(0, 5)) {
    try {
      const c: any = await jget(`${THREADS_API}/${p.id}/conversation?fields=username,text,timestamp&limit=10&access_token=${tok}`, tth);
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
    } catch {
      if (!base.note) base.note = 'Reconnect TikTok to include per-video stats.';
    }
  }
  return base;
}

/* ---------------- combined ---------------- */

export interface Analytics {
  channels: ChannelStats[];
  comments: FeedComment[];
}

export async function fetchAnalytics(m: MetaState, range: RangeKey): Promise<Analytics> {
  const { start, end } = rangeBounds(range);
  const [fb, ig, th, tt] = await Promise.all([fbStats(m, start, end), igStats(m, start, end), thStats(m, start, end), ttStats(m, start, end)]);
  const [fc, ic, tc] = await Promise.all([fbComments(m, fb.perPost), igComments(m, ig.perPost), thComments(m, th.perPost)]);
  const comments = [...fc, ...ic, ...tc].sort((a, b) => b.ts - a.ts);
  return { channels: [fb, ig, th, tt], comments };
}
