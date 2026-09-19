import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, T } from '../theme';
import { SocialGlyph } from '../components/ui';
import { AvatarButton } from '../components/ProfileMenu';
import ChannelDrawer from '../components/ChannelDrawer';
import { SOCIAL_META } from '../constants';
import { loadMetaState, MetaState } from '../utils/metaStore';
import { fetchAnalytics, FeedComment } from '../utils/analytics';

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 0) return '';
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  try {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/** Community: replies, comments and mentions across connected channels.
 *  `bare` embeds the feed inside another page (no masthead, no own scroll). */
export default function CommunityScreen({ email, team, onProfile, onConnect, bare }: {
  email: string;
  team: string;
  onProfile: () => void;
  onConnect: () => void;
  bare?: boolean;
}) {
  const { C } = useTheme();
  const s = makeS(C);
  const [meta, setMeta] = useState<MetaState>({});
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [channel, setChannel] = useState('all');
  const [drawer, setDrawer] = useState(false);

  const load = async () => {
    const mm = await loadMetaState();
    setMeta(mm);
    setLoading(true);
    try {
      const data = await fetchAnalytics(mm, 'last30');
      setComments(data?.comments ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const data = await fetchAnalytics(await loadMetaState(), 'last30');
      setComments(data?.comments ?? []);
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
  const shown = comments
    .filter((c) => (channel === 'all' ? true : c.channel === channel))
    .slice(0, 50);

  const content = (
    <>
      {bare ? null : (
        <View style={s.masthead}>
          <View>
            <Text style={[T.h1, { color: C.ink, fontSize: 30, lineHeight: 36 }]}>Community</Text>
            <Text style={s.sub}>Replies, comments and mentions.</Text>
          </View>
          <AvatarButton email={email} team={team} onPress={onProfile} />
        </View>
      )}

        <View style={{ paddingHorizontal: 24, marginTop: bare ? 0 : 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity onPress={() => setDrawer(true)} style={[s.chanBtn, { flex: 1 }]} activeOpacity={0.75}>
              {channel === 'all' ? (
                <Ionicons name="globe" size={18} color={C.accentInk} />
              ) : (
                <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: SOCIAL_META[channel]?.bg ?? C.ink, alignItems: 'center', justifyContent: 'center' }}>
                  <SocialGlyph platform={channel} size={14} color="#fff" />
                </View>
              )}
              <Text style={s.chanBtnT}>{channelLabel}</Text>
              <Ionicons name="chevron-down" size={18} color={C.faint} />
            </TouchableOpacity>
            {bare ? (
              <TouchableOpacity onPress={() => { void onRefresh(); }} style={s.iconBtn} activeOpacity={0.75}>
                <Ionicons name="refresh" size={15} color={refreshing ? C.faint : C.muted} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={{ paddingHorizontal: 24, marginTop: 16 }}>
          {loading ? (
            <View style={s.empty}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={s.emptyS}>Loading conversations…</Text>
            </View>
          ) : shown.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="chatbubbles" size={20} color={C.faint} />
              </View>
              <Text style={s.emptyT}>Nothing yet</Text>
              <Text style={s.emptyS}>Replies, comments and mentions on recent posts land here.</Text>
            </View>
          ) : (
            <View style={s.feed}>
              {shown.map((c, i) => (
                <View key={`${c.channel}-${c.ts}-${i}`} style={s.feedRow}>
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
    </>
  );

  const drawerModal = (
    <ChannelDrawer
      visible={drawer}
      channels={drawerChannels}
      value={channel}
      onPick={setChannel}
      onAddChannel={onConnect}
      onSettings={onConnect}
      onClose={() => setDrawer(false)}
    />
  );

  if (bare) {
    return (
      <View>
        {content}
        {drawerModal}
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: C.bone }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={C.accent} />}
      >
        {content}
      </ScrollView>
      {drawerModal}
    </View>
  );
}

const makeS = (C: Palette) => StyleSheet.create({
  masthead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 20 },
  sub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6 },
  chanBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 999, borderWidth: 1, borderColor: C.lineSoft, paddingHorizontal: 14, paddingVertical: 9 },
  chanBtnT: { flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.ink },
  feed: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.lineSoft, paddingHorizontal: 15 },
  feedRow: { flexDirection: 'row', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.lineSoft },
  dot: { width: 9, height: 9, borderRadius: 5 },
  commentA: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.ink },
  commentOn: { fontFamily: 'PlusJakartaSans_400Regular', color: C.muted },
  commentX: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13.5, lineHeight: 19, color: C.soft },
  commentT: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5, color: C.faint },
  empty: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.lineSoft, paddingVertical: 32, paddingHorizontal: 24, alignItems: 'center', gap: 10 },
  emptyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.bone, alignItems: 'center', justifyContent: 'center' },
  emptyT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15.5, color: C.ink },
  emptyS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 19 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft, alignItems: 'center', justifyContent: 'center' },
});
