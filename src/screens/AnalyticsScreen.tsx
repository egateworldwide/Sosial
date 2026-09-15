import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R, T } from '../theme';
import { AvatarButton } from '../components/ProfileMenu';
import { SocialGlyph } from '../components/ui';
import ChannelDrawer from '../components/ChannelDrawer';
import { SOCIAL_META } from '../constants';
import { loadMetaState, MetaState } from '../utils/metaStore';
import { fetchAnalytics, Analytics, RANGES, RangeKey, ChannelStats } from '../utils/analytics';

function compact(n: number | null): string {
  if (n === null || n === undefined) return '—';
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

function agg(channels: ChannelStats[]) {
  const followers = channels.reduce((a, c) => a + (c.followers ?? 0), 0);
  const hasFollowers = channels.some((c) => c.followers !== null);
  const posts = channels.reduce((a, c) => a + c.posts, 0);
  const reactions = channels.reduce((a, c) => a + c.reactions, 0);
  const comments = channels.reduce((a, c) => a + c.comments, 0);
  const views = channels.reduce((a, c) => a + (c.views ?? 0), 0);
  const hasViews = channels.some((c) => c.views !== null);
  const engagement = hasFollowers && followers > 0 ? ((reactions + comments) / followers) * 100 : null;
  return { followers: hasFollowers ? followers : null, posts, reactions, comments, views: hasViews ? views : null, engagement };
}

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 3600000) return `${Math.max(1, Math.round(d / 60000))}m ago`;
  if (d < 86400000) return `${Math.round(d / 3600000)}h ago`;
  return `${Math.round(d / 86400000)}d ago`;
}

/** Analytics tab: hero totals, per-channel sections, ranked posts, comment feed. */
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
    { id: 'linkedin', label: 'LinkedIn', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'bluesky', label: 'Bluesky', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'youtube', label: 'YouTube', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'mastodon', label: 'Mastodon', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'pinterest', label: 'Pinterest', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'x', label: 'X', sub: 'Coming soon', connected: false, comingSoon: true },
  ];
  const channelLabel = channel === 'all' ? 'All channels' : channel[0].toUpperCase() + channel.slice(1);

  const chans = (data?.channels ?? []).filter((c) => (channel === 'all' ? true : c.channel === channel));
  const live = chans.filter((c) => !(c.note ?? '').endsWith('not connected.'));
  const totals = agg(chans);
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? '';
  const bars = chans
    .flatMap((c) => c.perPost.map((p) => ({ ...p, channel: c.channel })))
    .map((p) => ({ ...p, score: p.likes + p.comments }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  const maxScore = Math.max(1, ...bars.map((b) => b.score));
  const comments = (data?.comments ?? []).filter((c) => (channel === 'all' ? true : c.channel === channel));
  const notes = chans.map((c) => c.note).filter(Boolean) as string[];
  const anyConnected = drawerChannels.some((c) => c.connected);

  const hero = totals.followers !== null
    ? { v: compact(totals.followers), l: totals.followers === 1 ? 'follower' : 'followers' }
    : totals.reactions + totals.comments > 0
      ? { v: compact(totals.reactions + totals.comments), l: 'interactions' }
      : { v: compact(totals.posts), l: totals.posts === 1 ? 'post' : 'posts' };
  const heroSub: string[] = [`${totals.posts} post${totals.posts === 1 ? '' : 's'}`];
  if (totals.reactions > 0) heroSub.push(`${compact(totals.reactions)} reactions`);
  if (totals.comments > 0) heroSub.push(`${compact(totals.comments)} comments`);
  if (totals.views !== null) heroSub.push(`${compact(totals.views)} views`);
  if (totals.engagement !== null) heroSub.push(`${totals.engagement.toFixed(1)}% engagement`);

  return (
    <View style={{ flex: 1, backgroundColor: C.bone }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        <View style={s.masthead}>
          <Text style={[T.h1, { color: C.ink, fontSize: 30, lineHeight: 36 }]}>Analytics</Text>
          <AvatarButton email={email} team={team} onPress={onProfile} />
        </View>

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
              <Text style={s.heroNum}>{hero.v}</Text>
              <Text style={s.heroLabel}>{hero.l}</Text>
              <Text style={s.heroSub}>{heroSub.join('  ·  ')}</Text>
            </View>

            {/* per-channel sections */}
            {live.map((c) => {
              const brand = SOCIAL_META[c.channel]?.bg ?? C.ink;
              const name = SOCIAL_META[c.channel]?.label ?? c.channel;
              const scores = c.perPost.map((p) => p.likes + p.comments);
              const max = Math.max(1, ...scores);
              const parts = [`${c.posts} post${c.posts === 1 ? '' : 's'}`];
              if (c.reactions > 0) parts.push(`${compact(c.reactions)} reactions`);
              if (c.comments > 0) parts.push(`${compact(c.comments)} comments`);
              if ((c.shares ?? 0) > 0) parts.push(`${compact(c.shares ?? 0)} shares`);
              if (c.views !== null) parts.push(`${compact(c.views)} views`);
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
                      <Text style={s.chanBig}>{compact(c.followers)}</Text>
                      <Text style={s.chanSmall}>followers</Text>
                    </View>
                  </View>
                  {scores.length > 0 ? (
                    <View style={s.spark}>
                      {c.perPost.slice(0, 14).map((p) => {
                        const sc = p.likes + p.comments;
                        return (
                          <View
                            key={p.id}
                            style={[s.sparkBar, { height: Math.max(3, (sc / max) * 40), backgroundColor: brand, opacity: sc > 0 ? 1 : 0.25 }]}
                          />
                        );
                      })}
                    </View>
                  ) : null}
                  <Text style={s.statStrip}>{parts.join('  ·  ')}</Text>
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
                    return (
                      <View key={`${b.channel}-${b.id}`} style={s.rankRow}>
                        <Text style={s.rankNo}>{String(i + 1).padStart(2, '0')}</Text>
                        <View style={{ flex: 1, gap: 6 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                            <View style={[s.dot, { backgroundColor: brand }]} />
                            <Text style={s.barT} numberOfLines={1}>{b.title}</Text>
                          </View>
                          <View style={s.track}>
                            <View style={[s.trackFill, { width: `${Math.max(4, (b.score / maxScore) * 100)}%`, backgroundColor: brand }]} />
                          </View>
                        </View>
                        <Text style={s.barV}>{compact(b.score)}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* comments & mentions */}
            <View style={{ paddingHorizontal: 24, marginTop: 30 }}>
              <Text style={s.secT}>Comments & mentions</Text>
              {comments.length === 0 ? (
                <Text style={s.hint}>No comments found on recent posts.</Text>
              ) : (
                <View style={{ marginTop: 4 }}>
                  {comments.slice(0, 30).map((c, i) => (
                    <View key={`${c.channel}-${i}`} style={s.feedRow}>
                      <View style={[s.dot, { backgroundColor: SOCIAL_META[c.channel]?.bg ?? C.ink, marginTop: 5 }]} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={s.commentA} numberOfLines={1}>
                          {c.author} <Text style={s.commentOn}>on {c.postTitle}</Text>
                        </Text>
                        <Text style={s.commentX}>{c.text}</Text>
                        <Text style={s.commentT}>{c.ts ? timeAgo(c.ts) : ''}</Text>
                      </View>
                    </View>
                  ))}
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
  heroLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.soft, marginTop: 2 },
  heroSub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 19, color: C.muted, marginTop: 8 },
  tile: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  chanName: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 17, letterSpacing: -0.3, color: C.ink },
  chanHandle: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted, marginTop: 1 },
  chanBig: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 24, letterSpacing: -0.6, color: C.ink },
  chanSmall: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5, color: C.muted },
  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 44, marginTop: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.lineSoft, paddingBottom: 0 },
  sparkBar: { flex: 1, borderRadius: 2 },
  statStrip: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 20, color: C.muted, marginTop: 10 },
  secT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 19, letterSpacing: -0.4, color: C.ink },
  hint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 19, color: C.muted, marginTop: 8 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.lineSoft },
  rankNo: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 13, color: C.accent, width: 22 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  barT: { flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.ink },
  track: { height: 5, borderRadius: 3, backgroundColor: C.surface, overflow: 'hidden' },
  trackFill: { height: 5, borderRadius: 3 },
  barV: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 13, color: C.ink, minWidth: 40, textAlign: 'right' },
  feedRow: { flexDirection: 'row', gap: 10, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.lineSoft },
  commentA: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.ink },
  commentOn: { fontFamily: 'PlusJakartaSans_400Regular', color: C.muted },
  commentX: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13.5, lineHeight: 19, color: C.soft },
  commentT: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5, color: C.faint },
  note: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.faint, marginTop: 4 },
  empty: { backgroundColor: C.card, borderRadius: R.lg, padding: 28, alignItems: 'center' },
  emptyT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.ink },
  emptyS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  connectBtn: { backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12, marginTop: 14 },
  connectBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.onInk },
  loadingT: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 10 },
});
