import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R, T } from '../theme';
import { AvatarButton } from '../components/ProfileMenu';
import { SocialGlyph } from '../components/ui';
import ChannelDrawer from '../components/ChannelDrawer';
import CommunityScreen from './CommunityScreen';
import { AreaChart, BarsChart } from '../components/charts';
import { SOCIAL_META } from '../constants';
import { loadMetaState, MetaState } from '../utils/metaStore';
import { fetchAnalytics, Analytics, RANGES, RangeKey, ChannelStats, PerPost, rangeBounds } from '../utils/analytics';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type PostRow = PerPost & { channel: ChannelStats['channel'] };

function compact(n: number | null): string {
  if (n === null || n === undefined) return '—';
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

/** likes + comments + shares — the engagement score used for ranking & trends. */
function scoreOf(p: { likes: number; comments: number; shares?: number }): number {
  return p.likes + p.comments + (p.shares ?? 0);
}

/** Same score, for a whole channel's totals. */
function channelScore(c: { reactions: number; comments: number; shares?: number }): number {
  return c.reactions + c.comments + (c.shares ?? 0);
}

function agg(channels: ChannelStats[]) {
  const followers = channels.reduce((a, c) => a + (c.followers ?? 0), 0);
  const hasFollowers = channels.some((c) => c.followers !== null);
  const posts = channels.reduce((a, c) => a + c.posts, 0);
  const reactions = channels.reduce((a, c) => a + c.reactions, 0);
  const comments = channels.reduce((a, c) => a + c.comments, 0);
  const shares = channels.reduce((a, c) => a + (c.shares ?? 0), 0);
  const hasShares = channels.some((c) => (c.shares ?? 0) > 0);
  const views = channels.reduce((a, c) => a + (c.views ?? 0), 0);
  const hasViews = channels.some((c) => c.views !== null);
  const interactions = reactions + comments;
  const engagement = hasFollowers && followers > 0 ? (interactions / followers) * 100 : null;
  const avgPerPost = posts > 0 ? interactions / posts : null;
  return { followers: hasFollowers ? followers : null, posts, reactions, comments, shares, hasShares, views: hasViews ? views : null, hasViews, interactions, engagement, avgPerPost };
}

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 3600000) return `${Math.max(1, Math.round(d / 60000))}m ago`;
  if (d < 86400000) return `${Math.round(d / 3600000)}h ago`;
  return `${Math.round(d / 86400000)}d ago`;
}

function seriesDelta(series?: { ts: number; value: number }[]): number | null {
  if (!series || series.length < 2) return null;
  return series[series.length - 1].value - series[0].value;
}

/** Sum follower histories across channels into one daily total series. */
function combinedFollowers(channels: ChannelStats[]): { ts: number; value: number }[] {
  const map = new Map<number, number>();
  for (const c of channels) {
    for (const p of c.followerSeries ?? []) {
      const day = new Date(p.ts).setHours(0, 0, 0, 0);
      map.set(day, (map.get(day) ?? 0) + p.value);
    }
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([ts, value]) => ({ ts, value }));
}

function allPosts(chans: ChannelStats[]): PostRow[] {
  return chans.flatMap((c) => c.perPost.map((p) => ({ ...p, channel: c.channel })));
}

/**
 * Engagement (likes+comments+shares) over time. One bucket per day for short
 * ranges, per week for long ones — works on every channel since it's derived
 * from post timestamps instead of the follower series only FB/IG expose.
 */
function engagementBins(posts: PostRow[], start: number, end: number): { values: number[]; labels: string[]; bestLabel: string | null; bestValue: number } {
  const DAY = 86400000;
  const spanDays = Math.max(1, Math.round((end - start) / DAY));
  const weekly = spanDays > 31;
  const bucketDays = weekly ? 7 : 1;
  const bins = Math.max(1, Math.min(30, Math.ceil(spanDays / bucketDays)));
  const values = new Array(bins).fill(0);
  for (const p of posts) {
    const idx = Math.floor((p.ts - start) / (bucketDays * DAY));
    if (idx >= 0 && idx < bins) values[idx] += scoreOf(p);
  }
  const labels = values.map((_, i) => {
    const d = new Date(start + i * bucketDays * DAY);
    return weekly ? `${d.getMonth() + 1}/${d.getDate()}` : String(d.getDate());
  });
  let bestIdx = -1;
  values.forEach((v, i) => { if (v > 0 && (bestIdx < 0 || v > values[bestIdx])) bestIdx = i; });
  return { values, labels, bestLabel: bestIdx >= 0 ? labels[bestIdx] : null, bestValue: bestIdx >= 0 ? values[bestIdx] : 0 };
}

/** Average engagement per weekday — answers "when should I post". */
function weekdayProfile(posts: PostRow[]): { avgs: number[]; counts: number[]; bestIdx: number } {
  const sums = new Array(7).fill(0);
  const counts = new Array(7).fill(0);
  for (const p of posts) {
    const d = new Date(p.ts).getDay();
    sums[d] += scoreOf(p);
    counts[d] += 1;
  }
  const avgs = sums.map((s, i) => (counts[i] ? s / counts[i] : 0));
  let bestIdx = -1;
  for (let i = 0; i < 7; i++) if (counts[i] > 0 && (bestIdx < 0 || avgs[i] > avgs[bestIdx])) bestIdx = i;
  return { avgs, counts, bestIdx };
}

/** Second half of the range vs the first, as a % change in engagement. */
function momentum(posts: PostRow[], start: number, end: number): number | null {
  const mid = start + (end - start) / 2;
  let first = 0, second = 0, firstN = 0, secondN = 0;
  for (const p of posts) {
    if (p.ts < mid) { first += scoreOf(p); firstN++; } else { second += scoreOf(p); secondN++; }
  }
  if (!firstN || !secondN) return null;
  if (!first) return second > 0 ? 100 : null;
  return ((second - first) / first) * 100;
}

/** Channels ranked by average engagement per post (needs no follower count). */
function channelRank(chans: ChannelStats[]): { channel: string; avg: number; posts: number }[] {
  return chans
    .filter((c) => c.posts > 0)
    .map((c) => ({ channel: c.channel, avg: channelScore(c) / c.posts, posts: c.posts }))
    .sort((a, b) => b.avg - a.avg);
}

/** Analytics tab: KPI grid, growth, engagement trend, channel leaderboard,
 *  best-time-to-post, per-channel sections, ranked posts, comment feed. */
export default function AnalyticsScreen({ email, team, onProfile, onConnect }: {
  email: string;
  team: string;
  onProfile: () => void;
  onConnect: () => void;
}) {
  const { C } = useTheme();
  const s = makeS(C);
  const [meta, setMeta] = useState<MetaState>({});
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [channel, setChannel] = useState('all');
  const [drawer, setDrawer] = useState(false);
  const [range, setRange] = useState<RangeKey>('last30');
  const [view, setView] = useState<'analytics' | 'community'>('analytics');

  const load = async (m?: MetaState, r?: RangeKey) => {
    const mm = m ?? (await loadMetaState());
    setMeta(mm);
    setLoading(true);
    try {
      setData(await fetchAnalytics(mm, r ?? range));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRange = (k: RangeKey) => {
    setRange(k);
    setLoading(true);
    fetchAnalytics(meta, k).then(setData).finally(() => setLoading(false));
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      setData(await fetchAnalytics(await loadMetaState(), range));
    } finally {
      setRefreshing(false);
    }
  };

  const drawerChannels = [
    { id: 'facebook', label: 'Facebook', sub: meta.pageName ?? 'Not connected', connected: !!meta.pageId },
    { id: 'instagram', label: 'Instagram', sub: meta.igName ?? 'Not connected', connected: !!meta.igId },
    { id: 'threads', label: 'Threads', sub: meta.threadsName ?? 'Not connected', connected: !!meta.threadsId },
    { id: 'tiktok', label: 'TikTok', sub: meta.ttName ?? ((meta.ttAccessToken || meta.ttRefreshToken) ? 'Connected' : 'Not connected'), connected: !!(meta.ttAccessToken || meta.ttRefreshToken) },
    { id: 'x', label: 'X', sub: meta.xName ?? ((meta.xAccessToken || meta.xRefreshToken) ? 'Connected' : 'Not connected'), connected: !!(meta.xAccessToken || meta.xRefreshToken) },
    { id: 'bluesky', label: 'Bluesky', sub: meta.bskyName ?? ((meta.bskyAccessJwt || meta.bskyRefreshJwt) ? 'Connected' : 'Not connected'), connected: !!(meta.bskyAccessJwt || meta.bskyRefreshJwt) },
    { id: 'linkedin', label: 'LinkedIn', sub: meta.liName ?? ((meta.liPersonUrn ? 'Connected' : 'Not connected')), connected: !!meta.liPersonUrn },
    { id: 'youtube', label: 'YouTube', sub: meta.ytChannelName ?? ((meta.ytRefreshToken || meta.ytAccessToken) ? 'Connected' : 'Not connected'), connected: !!(meta.ytRefreshToken || meta.ytAccessToken) },
    { id: 'mastodon', label: 'Mastodon', sub: meta.mastodonName ?? ((meta.mastodonAccessToken && meta.mastodonInstance) ? 'Connected' : 'Not connected'), connected: !!(meta.mastodonAccessToken && meta.mastodonInstance) },
    { id: 'pinterest', label: 'Pinterest', sub: 'Coming soon', connected: false, comingSoon: true },
  ];
  const channelLabel = channel === 'all' ? 'All channels' : channel[0].toUpperCase() + channel.slice(1);

  const chans = (data?.channels ?? []).filter((c) => (channel === 'all' ? true : c.channel === channel));
  const live = chans.filter((c) => !(c.note ?? '').endsWith('not connected.'));
  const totals = agg(chans);
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? '';
  const posts = allPosts(chans);
  const bars = posts
    .map((p) => ({ ...p, score: scoreOf(p) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  const maxScore = Math.max(1, ...bars.map((b) => b.score));
  const notes = chans.map((c) => c.note).filter(Boolean) as string[];
  const anyConnected = drawerChannels.some((c) => c.connected);

  const followerDelta = chans.reduce<number>((a, c) => a + (seriesDelta(c.followerSeries) ?? 0), 0);
  const hasDelta = chans.some((c) => (c.followerSeries?.length ?? 0) >= 2);
  const combined = combinedFollowers(chans);
  const { start: rbStart, end: rbEnd } = rangeBounds(range);
  const eng = engagementBins(posts, rbStart, rbEnd);
  const week = weekdayProfile(posts);
  const trend = momentum(posts, rbStart, rbEnd);
  const rank = channelRank(live);
  const maxAvg = Math.max(1, ...rank.map((r) => r.avg));

  const kpis: { label: string; value: string; sub: string; tone?: 'up' | 'down' }[] = [
    { label: 'Followers', value: compact(totals.followers), sub: hasDelta ? `${followerDelta >= 0 ? '+' : ''}${compact(followerDelta)} in range` : 'connected channels', tone: hasDelta ? (followerDelta >= 0 ? 'up' : 'down') : undefined },
    { label: 'Engagement', value: totals.engagement !== null ? `${totals.engagement.toFixed(1)}%` : '—', sub: 'of followers in range' },
    { label: 'Interactions', value: compact(totals.interactions), sub: trend !== null ? `${trend >= 0 ? '+' : ''}${trend.toFixed(0)}% vs first half` : 'likes + comments', tone: trend !== null ? (trend >= 0 ? 'up' : 'down') : undefined },
    { label: 'Avg / post', value: totals.avgPerPost !== null ? compact(Math.round(totals.avgPerPost * 10) / 10) : '—', sub: 'interactions per post' },
    { label: 'Views', value: compact(totals.views), sub: totals.hasViews ? 'where the API exposes it' : 'not exposed by these APIs' },
    { label: 'Shares', value: compact(totals.shares), sub: totals.hasShares ? 'reposts, retweets & saves' : 'not exposed by these APIs' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bone }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        <View style={s.masthead}>
          <View>
            <Text style={[T.h1, { color: C.ink, fontSize: 30, lineHeight: 36 }]}>{view === 'community' ? 'Community' : 'Analytics'}</Text>
            {view === 'community' ? <Text style={s.heroSub}>Replies, comments and mentions.</Text> : null}
          </View>
          <AvatarButton email={email} team={team} onPress={onProfile} />
        </View>

        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 24, marginTop: 14 }}>
          {(['analytics', 'community'] as const).map((v) => {
            const on = view === v;
            return (
              <TouchableOpacity key={v} onPress={() => setView(v)} style={[s.range, on && { backgroundColor: C.ink, borderColor: C.ink }]} activeOpacity={0.75}>
                <Text style={[s.rangeT, on && { color: C.onInk }]}>{v === 'analytics' ? 'Analytics' : 'Community'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {view === 'analytics' ? (
        <>
        <View style={{ paddingHorizontal: 24, marginTop: 14 }}>
          <TouchableOpacity onPress={() => setDrawer(true)} style={s.chanBtn} activeOpacity={0.75}>
            {channel === 'all' ? (
              <Ionicons name="globe-outline" size={18} color={C.accentInk} />
            ) : (
              <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: SOCIAL_META[channel]?.bg ?? C.ink, alignItems: 'center', justifyContent: 'center' }}>
                <SocialGlyph platform={channel} size={14} color="#fff" />
              </View>
            )}
            <Text style={s.chanBtnT}>{channelLabel}</Text>
            <Ionicons name="chevron-down" size={18} color={C.faint} />
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 24, marginTop: 12 }}>
          {RANGES.map((r) => {
            const on = range === r.key;
            return (
              <TouchableOpacity key={r.key} onPress={() => onRange(r.key)} style={[s.range, on && { backgroundColor: C.ink, borderColor: C.ink }]} activeOpacity={0.75}>
                <Text style={[s.rangeT, on && { color: C.onInk }]}>{r.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {!anyConnected ? (
          <View style={{ paddingHorizontal: 24, marginTop: 16 }}>
            <View style={s.empty}>
              <Text style={s.emptyT}>No channels connected</Text>
              <Text style={s.emptyS}>Connect Facebook, Instagram, Threads or TikTok to see followers, reactions and comments.</Text>
              <TouchableOpacity onPress={onConnect} style={s.connectBtn} activeOpacity={0.8}>
                <Text style={s.connectBtnT}>Connect a channel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : loading && !data ? (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <ActivityIndicator color={C.accent} />
            <Text style={s.loadingT}>Crunching numbers…</Text>
          </View>
        ) : (
          <>
            {/* hero */}
            <View style={{ paddingHorizontal: 24, marginTop: 22 }}>
              <Text style={s.eyebrow}>{rangeLabel} · {live.length} channel{live.length === 1 ? '' : 's'}</Text>
              <Text style={s.heroLabel}>
                {totals.interactions > 0 ? `${compact(totals.interactions)} interactions from ${totals.posts} post${totals.posts === 1 ? '' : 's'}` : `${totals.posts} post${totals.posts === 1 ? '' : 's'} in range`}
              </Text>
            </View>

            {/* KPI grid */}
            <View style={[s.kpiWrap, { paddingHorizontal: 24 }]}>
              {kpis.map((k) => (
                <View key={k.label} style={s.kpi}>
                  <Text style={s.kpiLabel}>{k.label}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                    <Text style={s.kpiVal}>{k.value}</Text>
                    {k.tone ? (
                      <Ionicons name={k.tone === 'up' ? 'arrow-up' : 'arrow-down'} size={13} color={k.tone === 'up' ? C.greenText : C.redText} />
                    ) : null}
                  </View>
                  <Text style={[s.kpiSub, k.tone === 'up' && { color: C.greenText }, k.tone === 'down' && { color: C.redText }]} numberOfLines={2}>{k.sub}</Text>
                </View>
              ))}
            </View>

            {/* follower growth */}
            {combined.length >= 2 ? (
              <View style={{ paddingHorizontal: 24, marginTop: 24 }}>
                <View style={s.card}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={s.cardT}>Follower growth</Text>
                    {hasDelta ? (
                      <Text style={[s.deltaT, { color: followerDelta >= 0 ? C.greenText : C.redText }]}>
                        {followerDelta >= 0 ? '+' : ''}{compact(followerDelta)}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ marginTop: 14 }}>
                    <AreaChart data={combined.map((p) => p.value)} color={C.accent} height={96} />
                  </View>
                  <Text style={s.cardS}>{rangeLabel} · total across connected channels</Text>
                </View>
              </View>
            ) : null}

            {/* engagement over time */}
            <View style={{ paddingHorizontal: 24, marginTop: 16 }}>
              <View style={s.card}>
                <Text style={s.cardT}>Engagement over time</Text>
                <View style={{ marginTop: 14 }}>
                  <BarsChart data={eng.values} color={C.accent} height={84} />
                </View>
                <Text style={s.cardS}>
                  Likes, comments & shares per {rbEnd - rbStart > 31 * 86400000 ? 'week' : 'day'} · {compact(eng.values.reduce((a, b) => a + b, 0))} total
                  {eng.bestLabel ? ` · peak ${eng.bestLabel} (${compact(eng.bestValue)})` : ''}
                </Text>
              </View>
            </View>

            {/* channel leaderboard */}
            {rank.length >= 2 ? (
              <View style={{ paddingHorizontal: 24, marginTop: 16 }}>
                <View style={s.card}>
                  <Text style={s.cardT}>Channel leaderboard</Text>
                  <Text style={[s.cardS, { marginTop: 2, marginBottom: 10 }]}>Average interactions per post</Text>
                  {rank.map((r, i) => {
                    const brand = SOCIAL_META[r.channel]?.bg ?? C.ink;
                    const name = SOCIAL_META[r.channel]?.label ?? r.channel;
                    return (
                      <View key={r.channel} style={s.rankRow}>
                        <Text style={s.rankNo}>{String(i + 1).padStart(2, '0')}</Text>
                        <View style={{ flex: 1, gap: 6 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <View style={[s.leadTile, { backgroundColor: brand }]}>
                              <SocialGlyph platform={r.channel} size={11} color="#fff" />
                            </View>
                            <Text style={s.barT} numberOfLines={1}>{name}</Text>
                            <Text style={s.microT}>{r.posts} post{r.posts === 1 ? '' : 's'}</Text>
                          </View>
                          <View style={s.track}>
                            <View style={[s.trackFill, { width: `${Math.max(4, (r.avg / maxAvg) * 100)}%`, backgroundColor: brand }]} />
                          </View>
                        </View>
                        <Text style={s.barV}>{compact(Math.round(r.avg * 10) / 10)}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {/* best time to post */}
            {posts.length >= 3 ? (
              <View style={{ paddingHorizontal: 24, marginTop: 16 }}>
                <View style={s.card}>
                  <Text style={s.cardT}>Best time to post</Text>
                  <Text style={[s.cardS, { marginTop: 2 }]}>
                    {week.bestIdx >= 0
                      ? `Posts land best on ${DAY_FULL[week.bestIdx]}s — ${compact(Math.round(week.avgs[week.bestIdx] * 10) / 10)} avg interactions`
                      : 'No posted days in this range.'}
                  </Text>
                  <View style={{ marginTop: 14 }}>
                    <BarsChart data={week.avgs} color={C.soft} height={64} barGap={10} />
                  </View>
                  <View style={{ flexDirection: 'row', marginTop: 6 }}>
                    {DAY_NAMES.map((d, i) => (
                      <Text key={d} style={[s.dayLab, i === week.bestIdx && { color: C.accent, fontFamily: 'PlusJakartaSans_700Bold' }]}>{d[0]}</Text>
                    ))}
                  </View>
                </View>
              </View>
            ) : null}

            {/* per-channel sections */}
            {live.map((c) => {
              const brand = SOCIAL_META[c.channel]?.bg ?? C.ink;
              const name = SOCIAL_META[c.channel]?.label ?? c.channel;
              const scores = c.perPost.map((p) => p.likes + p.comments);
              const delta = seriesDelta(c.followerSeries);
              const bits: string[] = [];
              if ((c.shares ?? 0) > 0) bits.push(`${compact(c.shares ?? 0)} shares`);
              if (c.views !== null) bits.push(`${compact(c.views)} views`);
              if (c.posts > 0) bits.push(`${compact(Math.round((channelScore(c) / c.posts) * 10) / 10)} avg/post`);
              return (
                <View key={c.channel} style={{ paddingHorizontal: 24, marginTop: 30 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[s.tile, { backgroundColor: brand }]}>
                      <SocialGlyph platform={c.channel} size={17} color="#fff" />
                    </View>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={s.chanName}>{name}</Text>
                      <Text style={s.chanHandle} numberOfLines={1}>{c.label}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                        <Text style={s.chanBig}>{compact(c.followers)}</Text>
                        {delta !== null ? (
                          <Text style={[s.chanDelta, { color: delta >= 0 ? C.greenText : C.redText }]}>
                            {delta >= 0 ? '+' : ''}{compact(delta)}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={s.chanSmall}>followers</Text>
                    </View>
                  </View>

                  <View style={s.chanStatsRow}>
                    <View style={s.chanStat}>
                      <Text style={s.chanStatV}>{c.engagementRate !== null ? `${c.engagementRate.toFixed(1)}%` : '—'}</Text>
                      <Text style={s.chanStatL}>engagement</Text>
                    </View>
                    <View style={s.chanStatDiv} />
                    <View style={s.chanStat}>
                      <Text style={s.chanStatV}>{c.posts}</Text>
                      <Text style={s.chanStatL}>posts</Text>
                    </View>
                    <View style={s.chanStatDiv} />
                    <View style={s.chanStat}>
                      <Text style={s.chanStatV}>{compact(c.reactions + c.comments)}</Text>
                      <Text style={s.chanStatL}>interactions</Text>
                    </View>
                  </View>

                  {c.followerSeries && c.followerSeries.length >= 2 ? (
                    <View style={{ marginTop: 14 }}>
                      <AreaChart data={c.followerSeries.map((p) => p.value)} color={brand} height={60} />
                    </View>
                  ) : scores.length > 0 ? (
                    <View style={{ marginTop: 14 }}>
                      <BarsChart data={scores.slice(0, 14)} color={brand} height={48} />
                    </View>
                  ) : null}
                  {bits.length ? <Text style={s.statStrip}>{bits.join('  ·  ')}</Text> : null}
                  {c.note ? <Text style={s.note}>{c.note}</Text> : null}
                </View>
              );
            })}

            {/* top posts */}
            <View style={{ paddingHorizontal: 24, marginTop: 30 }}>
              <Text style={s.secT}>Top posts</Text>
              {bars.length === 0 ? (
                <Text style={s.hint}>No posts in this range yet.</Text>
              ) : (
                <View style={{ marginTop: 4 }}>
                  {bars.map((b, i) => {
                    const brand = SOCIAL_META[b.channel]?.bg ?? C.ink;
                    const metaBits = [`${compact(b.likes)} likes`, `${compact(b.comments)} comments`];
                    if ((b.shares ?? 0) > 0) metaBits.push(`${compact(b.shares ?? 0)} shares`);
                    if (b.views !== null) metaBits.push(`${compact(b.views)} views`);
                    return (
                      <View key={`${b.channel}-${b.id}`} style={s.rankRow}>
                        <Text style={s.rankNo}>{String(i + 1).padStart(2, '0')}</Text>
                        <View style={{ flex: 1, gap: 5 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                            <View style={[s.dot, { backgroundColor: brand }]} />
                            <Text style={s.barT} numberOfLines={1}>{b.title}</Text>
                          </View>
                          <View style={s.track}>
                            <View style={[s.trackFill, { width: `${Math.max(4, (b.score / maxScore) * 100)}%`, backgroundColor: brand }]} />
                          </View>
                          <Text style={s.metaLine} numberOfLines={1}>
                            {metaBits.join(' · ')} · {b.ts ? timeAgo(b.ts) : ''}
                          </Text>
                        </View>
                        <Text style={s.barV}>{compact(b.score)}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {notes.length > 0 ? (
              <View style={{ paddingHorizontal: 24, marginTop: 16 }}>
                {notes.map((n, i) => (
                  <Text key={i} style={s.note}>• {n}</Text>
                ))}
              </View>
            ) : null}
          </>
        )}
        </>
        ) : (
          <View style={{ marginTop: 14 }}>
            <CommunityScreen bare email={email} team={team} onProfile={onProfile} onConnect={onConnect} />
          </View>
        )}
      </ScrollView>

      <ChannelDrawer
        visible={drawer}
        channels={drawerChannels}
        value={channel}
        onPick={setChannel}
        onAddChannel={onConnect}
        onSettings={onConnect}
        onClose={() => setDrawer(false)}
      />
    </View>
  );
}

const makeS = (C: Palette) => StyleSheet.create({
  masthead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 20 },
  chanBtn: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.lineSoft, paddingHorizontal: 15, paddingVertical: 13 },
  chanBtnT: { flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14.5, color: C.ink },
  range: { borderRadius: 999, paddingHorizontal: 15, paddingVertical: 9, backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft },
  rangeT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.muted },
  eyebrow: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11.5, letterSpacing: 1.6, textTransform: 'uppercase', color: C.accent },
  heroNum: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 52, letterSpacing: -2, lineHeight: 56, color: C.ink, marginTop: 6 },
  heroLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, lineHeight: 21, color: C.soft, marginTop: 6 },
  heroSub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 19, color: C.muted, marginTop: 8 },
  deltaChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 8 },
  deltaT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 13, letterSpacing: -0.2 },
  kpiWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  kpi: { flexGrow: 1, flexBasis: '46%', backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.lineSoft, padding: 14, gap: 3 },
  kpiLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11.5, letterSpacing: 0.6, textTransform: 'uppercase', color: C.muted },
  kpiVal: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 26, letterSpacing: -0.6, color: C.ink, marginTop: 2 },
  kpiSub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5, lineHeight: 15, color: C.faint, marginTop: 2 },
  card: { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.lineSoft, padding: 16 },
  cardT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.ink },
  cardS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, lineHeight: 17, color: C.muted, marginTop: 8 },
  tile: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  chanName: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 17, letterSpacing: -0.3, color: C.ink },
  chanHandle: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted, marginTop: 1 },
  chanBig: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 24, letterSpacing: -0.6, color: C.ink },
  chanDelta: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 13, letterSpacing: -0.2 },
  chanSmall: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5, color: C.muted },
  chanStatsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.paper, borderRadius: R.md, borderWidth: 1, borderColor: C.lineSoft, paddingVertical: 11, marginTop: 14 },
  chanStat: { flex: 1, alignItems: 'center', gap: 1 },
  chanStatV: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 16, letterSpacing: -0.3, color: C.ink },
  chanStatL: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10.5, color: C.muted },
  chanStatDiv: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: C.line },
  statStrip: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 20, color: C.muted, marginTop: 10 },
  secT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 19, letterSpacing: -0.4, color: C.ink },
  hint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 19, color: C.muted, marginTop: 8 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.lineSoft },
  rankNo: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 13, color: C.accent, width: 22 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  leadTile: { width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  barT: { flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.ink },
  microT: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.faint },
  track: { height: 5, borderRadius: 3, backgroundColor: C.surface, overflow: 'hidden' },
  trackFill: { height: 5, borderRadius: 3 },
  barV: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 13, color: C.ink, minWidth: 40, textAlign: 'right' },
  metaLine: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5, color: C.faint, marginTop: 1 },
  dayLab: { flex: 1, textAlign: 'center', fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.faint },
  note: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.faint, marginTop: 4 },
  empty: { backgroundColor: C.card, borderRadius: R.lg, padding: 28, alignItems: 'center' },
  emptyT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.ink },
  emptyS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  connectBtn: { backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12, marginTop: 14 },
  connectBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.onInk },
  loadingT: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 10 },
});
