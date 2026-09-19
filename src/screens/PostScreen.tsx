import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, RefreshControl } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R, T } from '../theme';
import { SocialGlyph } from '../components/ui';
import { AvatarButton } from '../components/ProfileMenu';
import ConnectButton from '../components/ConnectButton';
import ChannelDrawer from '../components/ChannelDrawer';
import { SOCIAL_META } from '../constants';
import { loadManagedPosts, ManagedPost, MAX_AUTO_TRIES } from '../utils/managed';
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

const EMPTY_COPY: Record<Tab, { title: string; sub: string }> = {
  queued: { title: 'Queue is clear', sub: 'Scheduled posts land here with their time and channels.' },
  draft: { title: 'No drafts', sub: 'Save a post without a schedule and it waits here.' },
  approval: { title: 'Nothing to approve', sub: 'Posts your team submits for review land here.' },
  sent: { title: 'Nothing sent yet', sub: 'Published posts land here with a timestamp.' },
};

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (day === today) return 'Today';
  if (day === today + 86400000) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function Cover({ uri, kind, size = 46 }: { uri?: string; kind?: 'image' | 'video'; size?: number }) {
  const { C } = useTheme();
  const s = makeS(C);
  const box = [s.cover, { width: size, height: size }];
  if (uri && kind !== 'video') return <Image source={{ uri }} style={box} />;
  if (uri) {
    return (
      <View style={[box, { backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }]}>
        <Ionicons name="play" size={16} color={C.onInk} />
      </View>
    );
  }
  return (
    <View style={[box, s.coverEmpty]}>
      <Text style={s.coverT}>Aa</Text>
    </View>
  );
}

function ChannelStack({ plats, C }: { plats: string[]; C: Palette }) {
  const s = makeS(C);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {plats.slice(0, 4).map((c, i) => (
        c === 'any' ? (
          <View key={`${c}-${i}`} style={[s.stackTile, { backgroundColor: C.card, borderColor: C.lineSoft, marginLeft: i === 0 ? 0 : -7 }]}>
            <Ionicons name="globe-outline" size={11} color={C.muted} />
          </View>
        ) : (
          <View key={`${c}-${i}`} style={[s.stackTile, { backgroundColor: SOCIAL_META[c]?.bg ?? C.ink, marginLeft: i === 0 ? 0 : -7 }]}>
            <SocialGlyph platform={c} size={10} color="#fff" />
          </View>
        )
      ))}
      {plats.length > 4 ? <Text style={s.moreN}>+{plats.length - 4}</Text> : null}
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

  const pad = bare ? 0 : 24;

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

  const cycleSort = () => {
    const i = SORTS.findIndex((x) => x.id === sort);
    setSort(SORTS[(i + 1) % SORTS.length].id);
  };
  const sortLabel = SORTS.find((x) => x.id === sort)?.label ?? 'Newest';

  const row = (p: ManagedPost) => {
    const plats = p.platforms?.length ? p.platforms : ['any'];
    const overdue = tab === 'queued' && !!p.scheduledAt && p.scheduledAt <= Date.now();
    const when =
      tab === 'sent' && p.sentAt ? `Sent ${fmtDateTime(p.sentAt)}` :
      p.scheduledAt ? `${overdue ? 'Overdue · ' : ''}${fmtDateTime(p.scheduledAt)}` : 'Not scheduled';
    const legErr = Object.values(p.channelErr ?? {})[0] as string | undefined;
    const parked = tab === 'queued' && (p.autoTries ?? 0) >= MAX_AUTO_TRIES;
    return (
      <View key={p.id}>
        <TouchableOpacity onPress={() => openComposer(p)} style={st.card} activeOpacity={0.75}>
          <View style={st.cardTop}>
            <Cover uri={p.imageUri ?? p.videoUri} kind={p.videoUri ? 'video' : 'image'} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={st.t} numberOfLines={1}>{p.title || 'Untitled'}</Text>
              <Text style={st.body} numberOfLines={2}>{p.body || platformsLabel(plats)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.faint} />
          </View>
          <View style={st.cardFoot}>
            <View style={[st.whenDot, { backgroundColor: overdue ? C.redText : C.faint }]} />
            <Text style={[st.when, overdue && { color: C.redText }]} numberOfLines={1}>{when}</Text>
            <View style={{ flex: 1 }} />
            <ChannelStack plats={plats} C={C} />
          </View>
          {tab === 'queued' && legErr ? (
            <View style={st.errBar}>
              <Ionicons name="alert-circle" size={13} color={C.redText} />
              <Text style={st.errT} numberOfLines={2}>{legErr}</Text>
            </View>
          ) : null}
          {tab === 'queued' && !legErr && parked ? (
            <View style={st.errBar}>
              <Ionicons name="pause-circle" size={13} color={C.redText} />
              <Text style={st.errT} numberOfLines={2}>Auto-retry stopped — open to retry manually</Text>
            </View>
          ) : null}
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

  const body = (
    <>
      {/* pipeline tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: pad, marginTop: bare ? 0 : 14 }}>
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <TouchableOpacity key={t.id} onPress={() => setTab(t.id)} style={[st.tab, on && st.tabOn]} activeOpacity={0.75}>
              <Text style={[st.tabT, on && { color: C.onInk }]}>{t.label}</Text>
              <View style={[st.tabCount, on && { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                <Text style={[st.tabCountT, on && { color: C.onInk }]}>{counts[t.id]}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* toolbar — channel filter, sort, refresh */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: pad, marginTop: 12 }}>
        <TouchableOpacity onPress={() => setDrawer(true)} style={st.tool} activeOpacity={0.75}>
          {channel === 'all' ? (
            <Ionicons name="globe-outline" size={15} color={C.accentInk} />
          ) : (
            <View style={[st.toolGlyph, { backgroundColor: SOCIAL_META[channel]?.bg ?? C.ink }]}>
              <SocialGlyph platform={channel} size={10} color="#fff" />
            </View>
          )}
          <Text style={st.toolT} numberOfLines={1}>{channelLabel}</Text>
          <Ionicons name="chevron-down" size={14} color={C.faint} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={cycleSort} style={st.tool} activeOpacity={0.75}>
          <Ionicons name="swap-vertical-outline" size={15} color={C.accentInk} />
          <Text style={st.toolT}>{sortLabel}</Text>
        </TouchableOpacity>
        {bare ? (
          <TouchableOpacity onPress={() => { void onRefresh(); }} style={st.iconBtn} activeOpacity={0.75}>
            <Ionicons name="refresh" size={15} color={refreshing ? C.faint : C.muted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: pad, marginTop: 14 }}>
        {tab === 'queued' ? (
          groups.length === 0 ? (
            <Empty C={C} title={EMPTY_COPY.queued.title} sub={EMPTY_COPY.queued.sub} />
          ) : (
            groups.map((g) => (
              <View key={g.day} style={{ marginTop: 16 }}>
                <Text style={st.day}>{g.day}</Text>
                <View style={{ gap: 10, marginTop: 10 }}>{g.rows.map(row)}</View>
              </View>
            ))
          )
        ) : sorted.length === 0 ? (
          <Empty C={C} title={EMPTY_COPY[tab].title} sub={EMPTY_COPY[tab].sub} />
        ) : (
          <View style={{ gap: 10 }}>{sorted.map(row)}</View>
        )}
      </View>

      {bare ? null : (
        <View style={{ paddingHorizontal: pad, marginTop: 16 }}>
          <TouchableOpacity onPress={() => openComposer(null)} style={st.newBtn} activeOpacity={0.85}>
            <Ionicons name="add" size={17} color={C.onInk} />
            <Text style={st.newBtnT}>New post</Text>
          </TouchableOpacity>
        </View>
      )}
    </>
  );

  return (
    <View style={{ flex: bare ? undefined : 1, backgroundColor: bare ? 'transparent' : C.bone }}>
      {bare ? (
        <View>{body}</View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={C.accent} />}
        >
          <View style={st.masthead}>
            <Text style={[T.h1, { color: C.ink, fontSize: 30, lineHeight: 36 }]}>Post</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ConnectButton onPress={onConnect} />
              <AvatarButton email={email} team={team} onPress={onProfile} />
            </View>
          </View>
          {body}
        </ScrollView>
      )}

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

function Empty({ C, title, sub }: { C: Palette; title: string; sub: string }) {
  const s = makeS(C);
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Ionicons name="file-tray-outline" size={20} color={C.faint} />
      </View>
      <Text style={s.emptyT}>{title}</Text>
      <Text style={s.emptyS}>{sub}</Text>
    </View>
  );
}

const makeS = (C: Palette) => StyleSheet.create({
  masthead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 20, marginBottom: 14 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 999, paddingLeft: 14, paddingRight: 10, paddingVertical: 9, backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft },
  tabOn: { backgroundColor: C.ink, borderColor: C.ink },
  tabT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.muted },
  tabCount: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: C.bone, alignItems: 'center', justifyContent: 'center' },
  tabCountT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.muted },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card, borderRadius: 999, borderWidth: 1, borderColor: C.lineSoft, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '55%' },
  toolGlyph: { width: 18, height: 18, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  toolT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.ink },
  iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft, alignItems: 'center', justifyContent: 'center' },
  newBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accent, borderRadius: R.lg, paddingVertical: 14 },
  newBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.onInk },
  day: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 12.5, letterSpacing: 0.6, textTransform: 'uppercase', color: C.accentInk },
  card: { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.lineSoft, padding: 12, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 7, borderTopWidth: 1, borderTopColor: C.lineSoft, paddingTop: 9 },
  whenDot: { width: 6, height: 6, borderRadius: 3 },
  when: { flexShrink: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5, color: C.muted },
  stackTile: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.card },
  moreN: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.muted, marginLeft: 3 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6, marginBottom: 4 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  actionBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.lineSoft },
  actionBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.onInk },
  errBar: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: C.paleRed, borderRadius: R.md, paddingHorizontal: 9, paddingVertical: 7 },
  cover: { borderRadius: 11, backgroundColor: C.lineSoft },
  coverEmpty: { backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  coverT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 14, color: C.accentInk },
  t: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14.5, letterSpacing: -0.2, color: C.ink },
  body: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 17, color: C.muted },
  errT: { flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11.5, lineHeight: 16, color: C.redText },
  empty: { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.lineSoft, paddingVertical: 30, paddingHorizontal: 24, alignItems: 'center', marginTop: 4 },
  emptyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.bone, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15.5, color: C.ink },
  emptyS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 },
});
