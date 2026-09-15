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

/** Analytics tab: channel drawer + ranges + summary + bars + comments/mentions. */
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
    { id: 'tiktok', label: 'TikTok', sub: meta.ttName ?? ((meta.ttAccessToken || meta.ttRefreshToken) ? 'Connected' : 'Analytics coming soon'), connected: !!(meta.ttAccessToken || meta.ttRefreshToken) },
    { id: 'linkedin', label: 'LinkedIn', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'bluesky', label: 'Bluesky', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'youtube', label: 'YouTube', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'mastodon', label: 'Mastodon', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'pinterest', label: 'Pinterest', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'x', label: 'X', sub: 'Coming soon', connected: false, comingSoon: true },
  ];
  const channelLabel = channel === 'all' ? 'All channels' : channel[0].toUpperCase() + channel.slice(1);

  const chans = (data?.channels ?? []).filter((c) => (channel === 'all' ? true : c.channel === channel));
  const totals = agg(chans);
  const bars = chans
    .flatMap((c) => c.perPost.map((p) => ({ ...p, channel: c.channel })))
    .map((p) => ({ ...p, score: p.likes + p.comments }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  const maxScore = Math.max(1, ...bars.map((b) => b.score));
  const comments = (data?.comments ?? []).filter((c) => (channel === 'all' ? true : c.channel === channel));
  const notes = chans.map((c) => c.note).filter(Boolean) as string[];
  const anyConnected = drawerChannels.some((c) => c.connected);

  const statCard = (label: string, value: string, icon: string) => (
    <View style={s.stat}>
      <Ionicons name={icon as any} size={18} color={C.accent} />
      <Text style={s.statV}>{value}</Text>
      <Text style={s.statL}>{label}</Text>
    </View>
  );

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
              <Text style={s.emptyS}>Connect Facebook, Instagram or Threads to see followers, reactions and comments.</Text>
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
            <View style={s.grid}>
              {statCard('Posts', compact(totals.posts), 'send-outline')}
              {statCard('Followers', compact(totals.followers), 'people-outline')}
              {statCard('Reactions', compact(totals.reactions), 'heart-outline')}
              {statCard('Comments', compact(totals.comments), 'chatbubble-outline')}
              {statCard('Engagement', totals.engagement === null ? '—' : `${totals.engagement.toFixed(1)}%`, 'trending-up-outline')}
              {statCard('Views', compact(totals.views), 'eye-outline')}
            </View>

            {/* performance bars */}
            <View style={{ paddingHorizontal: 24, marginTop: 22 }}>
              <Text style={s.secT}>Top posts</Text>
              {bars.length === 0 ? (
                <Text style={s.hint}>No posts in this range yet.</Text>
              ) : (
                <View style={{ gap: 10, marginTop: 12 }}>
                  {bars.map((b) => (
                    <View key={`${b.channel}-${b.id}`} style={s.barRow}>
                      <View style={[s.dot, { backgroundColor: SOCIAL_META[b.channel]?.bg ?? C.ink }]} />
                      <View style={{ flex: 1, gap: 5 }}>
                        <Text style={s.barT} numberOfLines={1}>{b.title}</Text>
                        <View style={s.track}>
                          <View style={[s.fill, { width: `${Math.max(4, (b.score / maxScore) * 100)}%` }]} />
                        </View>
                      </View>
                      <Text style={s.barV}>{compact(b.score)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* comments & mentions */}
            <View style={{ paddingHorizontal: 24, marginTop: 22 }}>
              <Text style={s.secT}>Comments & mentions</Text>
              {comments.length === 0 ? (
                <Text style={s.hint}>No comments found on recent posts.</Text>
              ) : (
                <View style={{ gap: 10, marginTop: 12 }}>
                  {comments.slice(0, 30).map((c, i) => (
                    <View key={`${c.channel}-${i}`} style={s.comment}>
                      <View style={[s.dot, { backgroundColor: SOCIAL_META[c.channel]?.bg ?? C.ink }]} />
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 24, marginTop: 16 },
  stat: { width: '31%', backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.lineSoft, padding: 12, gap: 4 },
  statV: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 19, letterSpacing: -0.4, color: C.ink, marginTop: 4 },
  statL: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5, color: C.muted },
  secT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 19, letterSpacing: -0.4, color: C.ink },
  hint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 19, color: C.muted, marginTop: 8 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.lineSoft, padding: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  barT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.ink },
  track: { height: 8, borderRadius: 4, backgroundColor: C.surface, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: C.accent },
  barV: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 13, color: C.ink, minWidth: 40, textAlign: 'right' },
  comment: { flexDirection: 'row', gap: 10, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.lineSoft, padding: 12 },
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
