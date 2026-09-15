import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, Palette, R, T } from '../theme';
import { SocialGlyph, PrimaryBtn } from '../components/ui';
import { AvatarButton } from '../components/ProfileMenu';
import ChannelDrawer from '../components/ChannelDrawer';
import { uid } from '../constants';
import ScheduleSheet from '../components/ScheduleSheet';
import { loadManagedPosts, saveManagedPost, deleteManagedPost, ManagedPost, PostStatus } from '../utils/managed';
import { loadMetaState, MetaState } from '../utils/metaStore';
import { publishFacebook, publishInstagram, publishThreads } from '../utils/metaPublish';
import {
  cancelPostReminder, fmtDateTime, platformsLabel,
  schedulePostReminder, ensureNotifPermission,
  notificationsSupported, NO_NOTIF_MSG,
} from '../utils/reminders';

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
        <Ionicons name="play" size={20} color="#fff" />
      </View>
    );
  }
  return (
    <View style={[s.cover, s.coverEmpty]}>
      <Text style={s.coverT}>Aa</Text>
    </View>
  );
}

/** Post pipeline: channel drawer + queue/drafts/approvals/sent + sorting. */
export default function PostScreen({ email, team, onProfile, onConnect, composeSignal }: {
  email: string;
  team: string;
  onProfile: () => void;
  onConnect: () => void;
  composeSignal: number;
}) {
  const { C } = useTheme();
  const s = makeS(C);
  const [posts, setPosts] = useState<ManagedPost[]>([]);
  const [meta, setMeta] = useState<MetaState>({});
  const [publishing, setPublishing] = useState(false);
  const [sheet, setSheet] = useState<{ post: ManagedPost | null } | null>(null);
  const [channel, setChannel] = useState('all');
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState<Tab>('queued');
  const [sort, setSort] = useState<Sort>('newest');
  const [tTitle, setTTitle] = useState('');
  const [tBody, setTBody] = useState('');
  const [tUri, setTUri] = useState<string | undefined>(undefined);
  const [tKind, setTKind] = useState<'image' | 'video'>('image');

  const reload = async () => {
    setPosts(await loadManagedPosts());
    setMeta(await loadMetaState());
  };

  useEffect(() => {
    reload();
    (async () => {
      try {
        const id = await AsyncStorage.getItem('quickpost_open_post');
        if (id) {
          await AsyncStorage.removeItem('quickpost_open_post');
          const all = await loadManagedPosts();
          const t = all.find((x) => x.id === id);
          if (t) openSheet(t);
          return;
        }
        const compose = await AsyncStorage.getItem('quickpost_compose');
        if (compose) {
          await AsyncStorage.removeItem('quickpost_compose');
          openSheet(null);
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // bottom-nav + button asks for a fresh composer
  useEffect(() => {
    if (composeSignal > 0) openSheet(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeSignal]);

  const openSheet = (p: ManagedPost | null) => {
    setTTitle(p?.title ?? '');
    setTBody(p?.body ?? '');
    setTUri(p?.imageUri ?? p?.videoUri);
    setTKind(p?.videoUri ? 'video' : 'image');
    setSheet({ post: p });
  };

  const pickMedia = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.9 });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    setTUri(a.uri);
    setTKind(a.type === 'video' ? 'video' : 'image');
  };

  const buildRec = (at: number | undefined, plats: string[], status: PostStatus): ManagedPost => ({
    id: sheet?.post?.id || uid('post'),
    title: tTitle.trim() || 'Untitled',
    body: tBody,
    imageUri: tKind === 'image' ? tUri : undefined,
    videoUri: tKind === 'video' ? tUri : undefined,
    platforms: plats,
    scheduledAt: at,
    createdAt: sheet?.post?.createdAt ?? Date.now(),
    status,
  });

  const save = async (at: number, plats: string[]) => {
    if (!sheet) return;
    if (plats.some((p) => p === 'tiktok' || p === 'instagram') && !tUri) {
      Alert.alert('TikTok & Instagram need media', 'Attach a photo or video — text-only posts can’t go to those channels.');
      return;
    }
    if (!(await notificationsSupported())) {
      Alert.alert('Needs the installed app', NO_NOTIF_MSG);
      return;
    }
    const perm = await ensureNotifPermission();
    if (!perm) {
      Alert.alert('Notifications off', 'Allow notifications to get reminded at post time.');
      return;
    }
    const keepApproval = sheet.post?.status === 'approval';
    const rec = buildRec(at, plats, keepApproval ? 'approval' : 'queued');
    await saveManagedPost(rec);
    await schedulePostReminder({ id: rec.id, title: rec.title, platforms: plats, at });
    setSheet(null);
    reload();
  };

  const saveDraft = async () => {
    if (!sheet) return;
    const plats = sheet.post?.platforms?.length ? sheet.post.platforms : ['any'];
    const rec = buildRec(undefined, plats, 'draft');
    await saveManagedPost(rec);
    await cancelPostReminder(rec.id);
    setSheet(null);
    setTab('draft');
    reload();
  };

  const moveTo = async (status: PostStatus) => {
    if (!sheet?.post) return;
    const rec: ManagedPost = { ...sheet.post, status };
    if (status !== 'queued') await cancelPostReminder(rec.id);
    await saveManagedPost(rec);
    setSheet(null);
    reload();
  };

  const remove = async () => {
    if (!sheet?.post) {
      setSheet(null);
      return;
    }
    await cancelPostReminder(sheet.post.id);
    await deleteManagedPost(sheet.post.id);
    setSheet(null);
    reload();
  };

  const markSent = async () => {
    if (!sheet?.post) return;
    await cancelPostReminder(sheet.post.id);
    await saveManagedPost({ ...sheet.post, status: 'sent', sentAt: Date.now() });
    setSheet(null);
    setTab('sent');
    reload();
  };

  const publish = async () => {
    const p = sheet?.post;
    if (!p || publishing) return;
    const plats = p.platforms?.length ? p.platforms : ['any'];
    const m = await loadMetaState();
    const caption = [p.title, p.body].filter((x) => x && x.trim()).join('\n\n');
    const done: string[] = [];
    const errs: string[] = [];
    const manual: string[] = [];
    setPublishing(true);
    try {
      for (const ch of plats) {
        try {
          if (ch === 'facebook') {
            if (!m.pageId || !m.pageToken) throw new Error('Facebook not connected');
            await publishFacebook({ pageId: m.pageId, pageToken: m.pageToken, message: caption, imageUri: p.imageUri, videoUri: p.videoUri });
            done.push('Facebook');
          } else if (ch === 'instagram') {
            if (!meta.igId || !meta.igToken) throw new Error('Instagram not connected');
            await publishInstagram({ igId: meta.igId, igToken: meta.igToken, caption, imageUri: p.imageUri, videoUri: p.videoUri });
            done.push('Instagram');
          } else if (ch === 'threads') {
            if (!m.threadsId || !m.threadsToken) throw new Error('Threads not connected');
            await publishThreads({ threadsId: m.threadsId, token: m.threadsToken, text: caption, imageUri: p.imageUri, videoUri: p.videoUri });
            done.push('Threads');
          } else {
            manual.push(ch === 'any' ? 'manual post' : ch);
          }
        } catch (e: any) {
          errs.push(`${ch}: ${e?.message ?? 'failed'}`);
        }
      }
    } finally {
      setPublishing(false);
    }
    const lines = [
      done.length ? `Posted: ${done.join(', ')}` : '',
      manual.length ? `Post yourself: ${manual.join(', ')}` : '',
      errs.length ? `Failed:\n${errs.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    Alert.alert(done.length > 0 && errs.length === 0 && manual.length === 0 ? 'Published ✓' : 'Publish result', lines || 'Nothing to publish.');
    if (done.length > 0 && errs.length === 0 && manual.length === 0) {
      await cancelPostReminder(p.id);
      await saveManagedPost({ ...p, status: 'sent', sentAt: Date.now() });
      setSheet(null);
      setTab('sent');
      reload();
    }
  };

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
      <TouchableOpacity key={p.id} onPress={() => openSheet(p)} style={s.card} activeOpacity={0.75}>
        <Cover uri={p.imageUri ?? p.videoUri} kind={p.videoUri ? 'video' : 'image'} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.t} numberOfLines={1}>{p.title || 'Untitled'}</Text>
          <Text style={s.meta} numberOfLines={1}>{p.body || 'No description'}</Text>
          <Text style={[s.meta, overdue && { color: C.redText }]}>{when} · {platformsLabel(plats)}</Text>
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
        <View style={s.masthead}>
          <Text style={[T.h1, { color: C.ink, fontSize: 30, lineHeight: 36 }]}>Post</Text>
          <AvatarButton email={email} team={team} onPress={onProfile} />
        </View>

        {/* channel drawer trigger */}
        <View style={{ paddingHorizontal: 24, marginTop: 14 }}>
          <TouchableOpacity onPress={() => setDrawer(true)} style={s.chanBtn} activeOpacity={0.75}>
            {channel === 'all' ? (
              <Ionicons name="globe-outline" size={18} color={C.accentInk} />
            ) : (
              <SocialGlyph platform={channel} size={18} color={C.ink} />
            )}
            <Text style={s.chanBtnT}>{channelLabel}</Text>
            <Ionicons name="chevron-down" size={18} color={C.faint} />
          </TouchableOpacity>
        </View>

        {/* pipeline tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 24, marginTop: 12 }}>
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <TouchableOpacity key={t.id} onPress={() => setTab(t.id)} style={[s.tab, on && { backgroundColor: C.ink, borderColor: C.ink }]} activeOpacity={0.75}>
                <Text style={[s.tabT, on && { color: C.onInk }]}>{t.label} · {counts[t.id]}</Text>
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
                  <Text style={[s.sortT, on && { color: C.accentInk }]}>{o.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity onPress={() => openSheet(null)} activeOpacity={0.85} style={s.addBtn}>
            <Ionicons name="add" size={16} color={C.onInk} />
            <Text style={s.addBtnT}>Post</Text>
          </TouchableOpacity>
        </View>

        <View style={{ paddingHorizontal: 24, marginTop: 12 }}>
          {tab === 'queued' ? (
            groups.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyT}>Queue is clear</Text>
                <Text style={s.emptyS}>Scheduled posts land here with time + channels.</Text>
              </View>
            ) : (
              groups.map((g) => (
                <View key={g.day} style={{ marginTop: 14 }}>
                  <Text style={s.day}>{g.day}</Text>
                  <View style={{ gap: 10, marginTop: 10 }}>{g.rows.map(row)}</View>
                </View>
              ))
            )
          ) : sorted.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyT}>Nothing here</Text>
              <Text style={s.emptyS}>
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

      <ScheduleSheet
        visible={sheet !== null}
        title={sheet?.post ? 'Edit post' : 'New post'}
        initialAt={sheet?.post?.scheduledAt}
        initialPlatforms={sheet?.post?.platforms}
        composer={{ title: tTitle, caption: tBody, onCaption: setTBody, onTitle: setTTitle }}
        media={{ uri: tUri, kind: tKind, onPick: pickMedia, onRemove: () => setTUri(undefined) }}
        onSave={save}
        draftLabel="Save as draft"
        onDraft={saveDraft}
        onPublish={sheet?.post ? publish : undefined}
        publishBusy={publishing}
        approveLabel={sheet?.post?.status === 'approval' ? 'Approve & queue' : sheet?.post ? 'Send to approvals' : undefined}
        onApprove={
          sheet?.post
            ? () => {
                if (sheet.post?.status === 'approval') {
                  // approving needs a time — re-queue keeps existing time or asks via save
                  if (sheet.post.scheduledAt) void moveTo('queued');
                  else Alert.alert('No time set', 'Queue it with a time first — tap the Queue button below.');
                } else {
                  void moveTo('approval');
                }
              }
            : undefined
        }
        onDelete={sheet?.post ? remove : undefined}
        onPosted={sheet?.post ? markSent : undefined}
        onClose={() => setSheet(null)}
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
  cover: { width: 56, height: 56, borderRadius: 12 },
  coverEmpty: { backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  coverT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 17, color: C.accentInk },
  t: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, letterSpacing: -0.2, color: C.ink },
  meta: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted },
  empty: { backgroundColor: C.card, borderRadius: R.lg, padding: 28, alignItems: 'center', marginTop: 6 },
  emptyT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.ink },
  emptyS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 },
});
