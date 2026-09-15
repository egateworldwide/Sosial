import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R, T } from '../theme';
import { SocialGlyph } from '../components/ui';
import { AvatarButton } from '../components/ProfileMenu';
import ChannelDrawer from '../components/ChannelDrawer';
import { loadManagedPosts, ManagedPost } from '../utils/managed';
import { loadMetaState, MetaState } from '../utils/metaStore';
import { fmtDateTime, platformsLabel } from '../utils/reminders';
import { useComposer } from '../store/ComposerContext';

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
  const { openComposer, refreshedAt } = useComposer();
  const [posts, setPosts] = useState<ManagedPost[]>([]);
  const [meta, setMeta] = useState<MetaState>({});
  const [channel, setChannel] = useState('all');
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState<Tab>('queued');
  const [sort, setSort] = useState<Sort>('newest');

  const reload = async () => {
    setPosts(await loadManagedPosts());
    setMeta(await loadMetaState());
  };

  useEffect(() => {
    reload();
  }, [refreshedAt]);

  const drawerChannels = [
    { id: 'facebook', label: 'Facebook', sub: meta.pageName ?? 'Not connected', connected: !!meta.pageId },
    { id: 'instagram', label: 'Instagram', sub: meta.igName ?? 'Not connected', connected: !!meta.igId },
    { id: 'threads', label: 'Threads', sub: meta.threadsName ?? 'Not connected', connected: !!meta.threadsId },
    { id: 'linkedin', label: 'LinkedIn', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'bluesky', label: 'Bluesky', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'youtube', label: 'YouTube', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'mastodon', label: 'Mastodon', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'pinterest', label: 'Pinterest', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'x', label: 'X', sub: 'Coming soon', connected: false, comingSoon: true },
    { id: 'tiktok', label: 'TikTok', sub: 'Coming soon', connected: false, comingSoon: true },
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

  const row = (p: ManagedPost) => {
    const plats = p.platforms?.length ? p.platforms : ['any'];
    const lead = plats.includes('any') ? 'any' : plats[0];
    const overdue = tab === 'queued' && !!p.scheduledAt && p.scheduledAt <= Date.now();
    const when =
      tab === 'sent' && p.sentAt ? `Sent · ${fmtDateTime(p.sentAt)}` :
      p.scheduledAt ? `${overdue ? 'Overdue · ' : ''}${fmtDateTime(p.scheduledAt)}` : 'Not scheduled';
    return (
      <TouchableOpacity key={p.id} onPress={() => openComposer(p)} style={st.card} activeOpacity={0.75}>
        <Cover uri={p.imageUri ?? p.videoUri} kind={p.videoUri ? 'video' : 'image'} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={st.t} numberOfLines={1}>{p.title || 'Untitled'}</Text>
          <Text style={st.meta} numberOfLines={1}>{p.body || 'No description'}</Text>
          <Text style={[st.meta, overdue && { color: C.redText }]}>{when} · {platformsLabel(plats)}</Text>
        </View>
        {lead === 'any' ? (
          <Ionicons name="globe-outline" size={18} color={C.muted} />
        ) : (
          <SocialGlyph platform={lead} size={18} color={C.ink} />
        )}
      </TouchableOpacity>
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
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {bare ? null : (
          <View style={st.masthead}>
            <Text style={[T.h1, { color: C.ink, fontSize: 30, lineHeight: 36 }]}>Post</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity onPress={onConnect} activeOpacity={0.8} style={st.queueBtn}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {(meta.pageId || meta.igId || meta.threadsId) ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#22C55E' }} /> : null}
                  <Text style={st.queueBtnT}>Connect</Text>
                </View>
              </TouchableOpacity>
              <AvatarButton email={email} team={team} onPress={onProfile} />
            </View>
          </View>
        )}

        {/* channel drawer trigger */}
        <View style={{ paddingHorizontal: 24, marginTop: bare ? 0 : 14 }}>
          <TouchableOpacity onPress={() => setDrawer(true)} style={st.chanBtn} activeOpacity={0.75}>
            {channel === 'all' ? (
              <Ionicons name="globe-outline" size={18} color={C.accentInk} />
            ) : (
              <SocialGlyph platform={channel} size={18} color={C.ink} />
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
            <Ionicons name="add" size={16} color={C.onInk} />
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
  queueBtn: { backgroundColor: C.card, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1, borderColor: C.lineSoft },
  queueBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.accentInk },
  chanBtn: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.lineSoft, paddingHorizontal: 15, paddingVertical: 13 },
  chanBtnT: { flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14.5, color: C.ink },
  tab: { borderRadius: 999, paddingHorizontal: 15, paddingVertical: 9, backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft },
  tabT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.muted },
  sortT: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.faint },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.onInk },
  day: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 14, letterSpacing: 0.4, textTransform: 'uppercase', color: C.accentInk },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.lg, padding: 12 },
  cover: { width: 56, height: 56, borderRadius: 12 },
  coverEmpty: { backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  coverT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 17, color: C.accentInk },
  t: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, letterSpacing: -0.2, color: C.ink },
  meta: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted },
  empty: { backgroundColor: C.card, borderRadius: R.lg, padding: 28, alignItems: 'center', marginTop: 6 },
  emptyT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.ink },
  emptyS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 },
});
