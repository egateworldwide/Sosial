import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, RefreshControl } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R, T } from '../theme';
import { SocialGlyph } from '../components/ui';
import { AvatarButton } from '../components/ProfileMenu';
import ConnectButton from '../components/ConnectButton';
import ChannelDrawer from '../components/ChannelDrawer';
import { SOCIAL_META } from '../constants';
import { loadManagedPosts, ManagedPost } from '../utils/managed';
import { pullCloudStatus } from '../utils/cloudPosts';
import { loadMetaState, MetaState } from '../utils/metaStore';
import { fmtDateTime, platformsLabel } from '../utils/reminders';
import { useComposer } from '../store/ComposerContext';
import { loadActor, canApprove, canSubmit, Actor } from '../utils/team';

type Tab = 'queued' | 'draft' | 'approval' | 'sent';
type Sort = 'newest' | 'oldest' | 'az';

const TABS: { id: Tab; label: string }[] = [
  { id: 'queued', label: 'Queue' },
  { id: 'draft', label: 'Drafts' },
  { id: 'approval', label: 'Approvals' },
  { id: 'sent', label: 'Sent' },
];

const SORTS: { id: Sort; label: string }[] = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'az', label: 'A–Z' },
];

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (day === today) return 'Today';
  if (day === today + 86400000) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function Cover({ uri, kind }: { uri?: string; kind?: 'image' | 'video' }) {
  const { C } = useTheme();
  const s = makeS(C);
  if (uri && kind !== 'video') return <Image source={{ uri }} style={s.cover} />;
  if (uri) {
    return (
      <View style={[s.cover, { backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }]}>
        <Ionicons name="play" size={20} color={C.onInk} />
      </View>
    );
  }
  return (
    <View style={[s.cover, s.coverEmpty]}>
      <Text style={s.coverT}>Aa</Text>
    </View>
  );
}

/** Post pipeline: channel drawer + queue/drafts/approvals/sent + sorting.
 *  The composer lives at app level — this screen only lists and opens it. */
export default function PostScreen({ email, team, onProfile, onConnect, bare }: {
  email: string;
  team: string;
  onProfile: () => void;
  onConnect: () => void;
  bare?: boolean;
}) {
  const { C } = useTheme();
  const st = makeS(C);
  const { openComposer, refreshedAt, submitForApproval, approvePost, rejectPost } = useComposer();
  const [posts, setPosts] = useState<ManagedPost[]>([]);
  const [meta, setMeta] = useState<MetaState>({});
  const [actor, setActor] = useState<Actor>({ id: null, role: 'owner' });
  const [channel, setChannel] = useState('all');
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState<Tab>('queued');
  const [sort, setSort] = useState<Sort>('newest');
  const [refreshing, setRefreshing] = useState(false);

  const reload = async () => {
    setPosts(await loadManagedPosts());
    setMeta(await loadMetaState());
    setActor(await loadActor());
  };

  /** Pull-to-refresh: back-sync cloud verdicts first, then reload the pipeline. */
  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await pullCloudStatus();
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    reload();
  }, [refreshedAt]);

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

  const matchChannel = (p: ManagedPost) =>
    channel === 'all' ? true : (p.platforms?.length ? p.platforms : ['any']).includes(channel);

  const inTab = posts.filter((p) => (p.status ?? 'draft') === (tab === 'queued' ? 'queued' : tab) && matchChannel(p));

  const sorted = [...inTab].sort((a, b) => {
    if (sort === 'az') return (a.title || '').localeCompare(b.title || '');
    const at = a.scheduledAt ?? a.sentAt ?? a.createdAt;
    const bt = b.scheduledAt ?? b.sentAt ?? b.createdAt;
    return sort === 'newest' ? bt - at : at - bt;
  });

  const groups: { day: string; rows: ManagedPost[] }[] = [];
  if (tab === 'queued') {
    for (const p of sorted) {
      const day = p.scheduledAt ? dayLabel(p.scheduledAt) : 'Unscheduled';
      const g = groups.find((x) => x.day === day);
      if (g) g.rows.push(p);
      else groups.push({ day, rows: [p] });
    }
  }

  const showSubmit = tab === 'draft' && canSubmit(actor);
  const showApprove = tab === 'approval' && canApprove(actor);

  const row = (p: ManagedPost) => {
    const plats = p.platforms?.length ? p.platforms : ['any'];
    const overdue = tab === 'queued' && !!p.scheduledAt && p.scheduledAt <= Date.now();
    const when =
      tab === 'sent' && p.sentAt ? `Sent · ${fmtDateTime(p.sentAt)}` :
      p.scheduledAt ? `${overdue ? 'Overdue · ' : ''}${fmtDateTime(p.scheduledAt)}` : 'Not scheduled';
    return (
      <View key={p.id}>
        <TouchableOpacity onPress={() => openComposer(p)} style={st.card} activeOpacity={0.75}>
          <Cover uri={p.imageUri ?? p.videoUri} kind={p.videoUri ? 'video' : 'image'} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={st.t} numberOfLines={1}>{p.title || 'Untitled'}</Text>
            <Text style={st.meta} numberOfLines={1}>{p.body || 'No description'}</Text>
            <Text style={[st.meta, overdue && { color: C.redText }]}>{when} · {platformsLabel(plats)}</Text>
          </View>
          {/* overlapping channel stack, like the Connect button */}
          <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
            {plats.slice(0, 4).map((c, i) => (
              c === 'any' ? (
                <View key={`${c}-${i}`} style={[st.stackTile, { backgroundColor: C.card, borderColor: C.lineSoft, marginLeft: i === 0 ? 0 : -8 }]}>
                  <Ionicons name="globe-outline" size={14} color={C.muted} />
                </View>
              ) : (
                <View key={`${c}-${i}`} style={[st.stackTile, { backgroundColor: SOCIAL_META[c]?.bg ?? C.ink, marginLeft: i === 0 ? 0 : -8 }]}>
                  <SocialGlyph platform={c} size={12} color="#fff" />
                </View>
              )
            ))}
            {plats.length > 4 ? <Text style={st.moreN}>+{plats.length - 4}</Text> : null}
          </View>
        </TouchableOpacity>
        {showSubmit || showApprove ? (
          <View style={st.actions}>
            {showSubmit ? (
              <TouchableOpacity onPress={() => submitForApproval(p.id)} style={st.actionBtn} activeOpacity={0.8}>
                <Ionicons name="send-outline" size={13} color={C.onInk} />
                <Text style={st.actionBtnT}>Submit for approval</Text>
              </TouchableOpacity>
            ) : null}
            {showApprove ? (
              <>
                <TouchableOpacity onPress={() => approvePost(p.id)} style={st.actionBtn} activeOpacity={0.8}>
                  <Ionicons name="checkmark" size={14} color={C.onInk} />
                  <Text style={st.actionBtnT}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => rejectPost(p.id)} style={[st.actionBtn, st.actionBtnGhost]} activeOpacity={0.8}>
                  <Ionicons name="close" size={14} color={C.redText} />
                  <Text style={[st.actionBtnT, { color: C.redText }]}>Reject</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  const counts: Record<Tab, number> = {
    queued: posts.filter((p) => (p.status ?? 'draft') === 'queued').length,
    draft: posts.filter((p) => (p.status ?? 'draft') === 'draft').length,
    approval: posts.filter((p) => p.status === 'approval').length,
    sent: posts.filter((p) => p.status === 'sent').length,
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bone }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={C.accent} />}
      >
        {bare ? null : (
          <View style={st.masthead}>
            <Text style={[T.h1, { color: C.ink, fontSize: 30, lineHeight: 36 }]}>Post</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ConnectButton onPress={onConnect} />
              <AvatarButton email={email} team={team} onPress={onProfile} />
            </View>
          </View>
        )}

        {/* channel drawer trigger */}
        <View style={{ paddingHorizontal: 24, marginTop: 14 }}>
          <TouchableOpacity onPress={() => setDrawer(true)} style={st.chanBtn} activeOpacity={0.75}>
            {channel === 'all' ? (
              <Ionicons name="globe-outline" size={18} color={C.accentInk} />
            ) : (
              <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: SOCIAL_META[channel]?.bg ?? C.ink, alignItems: 'center', justifyContent: 'center' }}>
                <SocialGlyph platform={channel} size={14} color="#fff" />
              </View>
            )}
            <Text style={st.chanBtnT}>{channelLabel}</Text>
            <Ionicons name="chevron-down" size={18} color={C.faint} />
          </TouchableOpacity>
        </View>

        {/* pipeline tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 24, marginTop: 12 }}>
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <TouchableOpacity key={t.id} onPress={() => setTab(t.id)} style={[st.tab, on && { backgroundColor: C.ink, borderColor: C.ink }]} activeOpacity={0.75}>
                <Text style={[st.tabT, on && { color: C.onInk }]}>{t.label} · {counts[t.id]}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* sorting — sorters scroll, Post stays pinned on the right */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, marginTop: 12 }}>
          <Ionicons name="swap-vertical-outline" size={15} color={C.faint} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 4 }} style={{ flex: 1 }}>
            {SORTS.map((o) => {
              const on = sort === o.id;
              return (
                <TouchableOpacity key={o.id} onPress={() => setSort(o.id)} activeOpacity={0.7}>
                  <Text style={[st.sortT, on && { color: C.accentInk }]}>{o.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity onPress={() => openComposer(null)} activeOpacity={0.85} style={st.addBtn}>
            <Ionicons name="send" size={15} color={C.onInk} />
            <Text style={st.addBtnT}>Post</Text>
          </TouchableOpacity>
        </View>

        <View style={{ paddingHorizontal: 24, marginTop: 12 }}>
          {tab === 'queued' ? (
            groups.length === 0 ? (
              <View style={st.empty}>
                <Text style={st.emptyT}>Queue is clear</Text>
                <Text style={st.emptyS}>Scheduled posts land here with time + channels.</Text>
              </View>
            ) : (
              groups.map((g) => (
                <View key={g.day} style={{ marginTop: 14 }}>
                  <Text style={st.day}>{g.day}</Text>
                  <View style={{ gap: 10, marginTop: 10 }}>{g.rows.map(row)}</View>
                </View>
              ))
            )
          ) : sorted.length === 0 ? (
            <View style={st.empty}>
              <Text style={st.emptyT}>Nothing here</Text>
              <Text style={st.emptyS}>
                {tab === 'draft' ? 'Drafts you save land here.' : tab === 'approval' ? 'Posts waiting for approval land here.' : 'Published posts land here.'}
              </Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>{sorted.map(row)}</View>
          )}
        </View>
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
  tab: { borderRadius: 999, paddingHorizontal: 15, paddingVertical: 9, backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft },
  tabT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.muted },
  sortT: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.faint },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.onInk },
  day: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 14, letterSpacing: 0.4, textTransform: 'uppercase', color: C.accentInk },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.lg, padding: 12 },
  stackTile: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.paper },
  moreN: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11.5, color: C.muted, marginLeft: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6, marginBottom: 4 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  actionBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.lineSoft },
  actionBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.onInk },
  cover: { width: 56, height: 56, borderRadius: 12 },
  coverEmpty: { backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  coverT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 17, color: C.accentInk },
  t: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, letterSpacing: -0.2, color: C.ink },
  meta: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted },
  empty: { backgroundColor: C.card, borderRadius: R.lg, padding: 28, alignItems: 'center', marginTop: 6 },
  emptyT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.ink },
  emptyS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 },
});
