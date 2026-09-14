import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { C, R, T } from '../theme';
import { SocialGlyph, PrimaryBtn } from '../components/ui';
import { uid } from '../constants';
import ScheduleSheet from '../components/ScheduleSheet';
import { loadManagedPosts, saveManagedPost, deleteManagedPost, ManagedPost } from '../utils/managed';
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
export default function ScheduleScreen({ onBack }: { onBack: () => void }) {
  const [posts, setPosts] = useState<ManagedPost[]>([]);
  const [sheet, setSheet] = useState<{ post: ManagedPost | null } | null>(null);
  const [tTitle, setTTitle] = useState('');
  const [tBody, setTBody] = useState('');
  const [tUri, setTUri] = useState<string | undefined>(undefined);
  const [tKind, setTKind] = useState<'image' | 'video'>('image');

  const reload = async () => setPosts(await loadManagedPosts());

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
  empty: { backgroundColor: C.card, borderRadius: R.lg, padding: 28, alignItems: 'center', marginTop: 22 },
  emptyT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.ink },
  emptyS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 },
});
