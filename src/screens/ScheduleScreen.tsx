import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { C, R, T } from '../theme';
import { SocialGlyph, PrimaryBtn, GhostBtn } from '../components/ui';
import { uid } from '../constants';
import ScheduleSheet from '../components/ScheduleSheet';
import { loadManagedPosts, saveManagedPost, deleteManagedPost, ManagedPost } from '../utils/managed';
import { loadMetaState, MetaState } from '../utils/metaStore';
import { publishFacebook, publishInstagram, publishThreads } from '../utils/metaPublish';
import {
  cancelPostReminder, fmtDateTime, platformsLabel,
  schedulePostReminder, ensureNotifPermission,
  notificationsSupported, NO_NOTIF_MSG,
} from '../utils/reminders';

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (day === today) return 'Today';
  if (day === today + 86400000) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function Cover({ uri, kind }: { uri?: string; kind?: 'image' | 'video' }) {
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

/** Post manager: every post — title + photo + description + channels + time. */
export default function ScheduleScreen({ onBack, onConnect }: { onBack: () => void; onConnect: () => void }) {
  const [posts, setPosts] = useState<ManagedPost[]>([]);
  const [meta, setMeta] = useState<MetaState>({});
  const [publishing, setPublishing] = useState(false);
  const [sheet, setSheet] = useState<{ post: ManagedPost | null } | null>(null);
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
    // reminder tap lands here with the post id stashed
    (async () => {
      try {
        const id = await AsyncStorage.getItem('quickpost_open_post');
        if (!id) return;
        await AsyncStorage.removeItem('quickpost_open_post');
        const all = await loadManagedPosts();
        const t = all.find((x) => x.id === id);
        if (t) openSheet(t);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const id = sheet.post?.id || uid('post');
    const rec: ManagedPost = {
      id,
      title: tTitle.trim() || 'Untitled',
      body: tBody,
      imageUri: tKind === 'image' ? tUri : undefined,
      videoUri: tKind === 'video' ? tUri : undefined,
      platforms: plats,
      scheduledAt: at,
      createdAt: sheet.post?.createdAt ?? Date.now(),
    };
    await saveManagedPost(rec);
    await schedulePostReminder({ id, title: rec.title, platforms: plats, at });
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

  const markPosted = async () => {
    if (!sheet?.post) return;
    await cancelPostReminder(sheet.post.id);
    await deleteManagedPost(sheet.post.id);
    setSheet(null);
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
      await deleteManagedPost(p.id);
      setSheet(null);
      reload();
    }
  };

  const connectedLabel = [
    meta.pageName ? `FB: ${meta.pageName}` : '',
    meta.igName ? `IG ${meta.igName}` : '',
    meta.threadsName ? `Threads ${meta.threadsName}` : '',
  ].filter(Boolean).join(' · ') || 'No accounts connected';

  const scheduled = posts.filter((p) => !!p.scheduledAt).sort((a, b) => (a.scheduledAt as number) - (b.scheduledAt as number));

  const groups: { day: string; rows: ManagedPost[] }[] = [];
  for (const p of scheduled) {
    const day = dayLabel(p.scheduledAt as number);
    const g = groups.find((x) => x.day === day);
    if (g) g.rows.push(p);
    else groups.push({ day, rows: [p] });
  }

  const row = (p: ManagedPost) => {
    const plats = p.platforms?.length ? p.platforms : ['any'];
    const lead = plats.includes('any') ? 'any' : plats[0];
    const overdue = !!p.scheduledAt && p.scheduledAt <= Date.now();
    return (
      <TouchableOpacity key={p.id} onPress={() => openSheet(p)} style={s.card} activeOpacity={0.75}>
        <Cover uri={p.imageUri ?? p.videoUri} kind={p.videoUri ? 'video' : 'image'} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.t} numberOfLines={1}>{p.title || 'Untitled'}</Text>
          <Text style={s.meta} numberOfLines={1}>{p.body || 'No description'}</Text>
          {p.scheduledAt ? (
            <Text style={[s.meta, overdue && { color: C.redText }]}>
              {overdue ? 'Overdue · ' : ''}{fmtDateTime(p.scheduledAt)} · {platformsLabel(plats)}
            </Text>
          ) : (
            <Text style={s.meta}>Not scheduled · {platformsLabel(plats)}</Text>
          )}
        </View>
        {lead === 'any' ? (
          <Ionicons name="globe-outline" size={18} color={C.muted} />
        ) : (
          <SocialGlyph platform={lead} size={18} color="#fff" />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bone }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={onBack} activeOpacity={0.7} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color={C.ink} />
        </TouchableOpacity>
        <Text style={s.kicker}>Post manager</Text>
        <Text style={[T.h1, { color: C.ink, marginTop: 8, fontSize: 30, lineHeight: 36 }]}>Posts</Text>
        <Text style={s.sub}>
          {scheduled.length === 0
            ? 'Nothing scheduled yet — create your first post below.'
            : `${scheduled.length} post${scheduled.length === 1 ? '' : 's'} queued.`}{' '}
          Tap the alert when it fires to jump back here.
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <Text style={[s.meta, { flex: 1 }]} numberOfLines={1}>{connectedLabel}</Text>
          <TouchableOpacity onPress={onConnect} style={s.qBtn} activeOpacity={0.8}>
            <Text style={s.qBtnT}>Connect</Text>
          </TouchableOpacity>
        </View>
        <View style={{ marginTop: 16 }}>
          <PrimaryBtn label="+ New post" onPress={() => openSheet(null)} />
        </View>

        {groups.map((g) => (
          <View key={g.day} style={{ marginTop: 22 }}>
            <Text style={s.day}>{g.day}</Text>
            <View style={{ gap: 10, marginTop: 10 }}>{g.rows.map(row)}</View>
          </View>
        ))}

        {scheduled.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyT}>Queue is clear</Text>
            <Text style={s.emptyS}>New posts land here with their time and channels.</Text>
          </View>
        ) : null}
      </ScrollView>

      <ScheduleSheet
        visible={sheet !== null}
        title={sheet?.post ? 'Edit post' : 'New post'}
        initialAt={sheet?.post?.scheduledAt}
        initialPlatforms={sheet?.post?.platforms}
        composer={{ title: tTitle, caption: tBody, onCaption: setTBody, onTitle: setTTitle }}
        media={{ uri: tUri, kind: tKind, onPick: pickMedia, onRemove: () => setTUri(undefined) }}
        onSave={save}
        onPublish={sheet?.post ? publish : undefined}
        publishBusy={publishing}
        onDelete={sheet?.post ? remove : undefined}
        onPosted={sheet?.post ? markPosted : undefined}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  kicker: { ...T.tag, color: C.accent, marginTop: 24 },
  sub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6 },
  day: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 14, letterSpacing: 0.4, textTransform: 'uppercase', color: C.accentInk },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.lg, padding: 12 },
  cover: { width: 56, height: 56, borderRadius: 12 },
  coverEmpty: { backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  coverT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 17, color: C.accentInk },
  t: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, letterSpacing: -0.2, color: C.ink },
  meta: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted },
  qBtn: { backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 9 },
  qBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: '#fff' },
  empty: { backgroundColor: C.card, borderRadius: R.lg, padding: 28, alignItems: 'center', marginTop: 22 },
  emptyT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.ink },
  emptyS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 },
});
