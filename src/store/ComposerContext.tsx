import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import ScheduleSheet from '../components/ScheduleSheet';
import { uid } from '../constants';
import { loadManagedPosts, saveManagedPost, deleteManagedPost, ManagedPost, PostStatus } from '../utils/managed';
import { loadMetaState } from '../utils/metaStore';
import { publishFacebook, publishInstagram, publishThreads } from '../utils/metaPublish';
import { publishTikTokVideo, askTikTokPrivacy } from '../utils/tiktokPublish';
import {
  cancelPostReminder,
  schedulePostReminder, ensureNotifPermission,
  notificationsSupported, NO_NOTIF_MSG,
} from '../utils/reminders';
import { Alert } from 'react-native';

interface ComposerCtx {
  /** bumped on every save/delete/publish so lists refresh */
  refreshedAt: number;
  openComposer: (p: ManagedPost | null) => void;
  openPostById: (id: string) => Promise<void>;
}

const Ctx = createContext<ComposerCtx>({ refreshedAt: 0, openComposer: () => {}, openPostById: async () => {} });

export function useComposer(): ComposerCtx {
  return useContext(Ctx);
}

/**
 * The new-post window, rendered once at app level. Any "New post" entry —
 * bottom-nav +, Post pill, idea cards — opens this sheet in place, with no
 * post page behind it.
 */
export function ComposerProvider({ children }: { children: React.ReactNode }) {
  const [sheet, setSheet] = useState<{ post: ManagedPost | null } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(0);
  const [tTitle, setTTitle] = useState('');
  const [tBody, setTBody] = useState('');
  const [tUri, setTUri] = useState<string | undefined>(undefined);
  const [tKind, setTKind] = useState<'image' | 'video'>('image');
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;

  const openComposer = useCallback((p: ManagedPost | null) => {
    setTTitle(p?.title ?? '');
    setTBody(p?.body ?? '');
    setTUri(p?.imageUri ?? p?.videoUri);
    setTKind(p?.videoUri ? 'video' : 'image');
    setSheet({ post: p });
  }, []);

  const openPostById = useCallback(
    async (id: string) => {
      try {
        await AsyncStorage.removeItem('quickpost_open_post');
      } catch {}
      const all = await loadManagedPosts();
      const t = all.find((x) => x.id === id);
      if (t) openComposer(t);
    },
    [openComposer],
  );

  // cold start: reminder tap stashed the post id before we mounted
  useEffect(() => {
    (async () => {
      try {
        const id = await AsyncStorage.getItem('quickpost_open_post');
        if (id) {
          await AsyncStorage.removeItem('quickpost_open_post');
          const all = await loadManagedPosts();
          const t = all.find((x) => x.id === id);
          if (t) openComposer(t);
        }
      } catch {}
    })();
  }, [openComposer]);

  const pickMedia = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.9 });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    setTUri(a.uri);
    setTKind(a.type === 'video' ? 'video' : 'image');
  };

  const buildRec = (at: number | undefined, plats: string[], status: PostStatus): ManagedPost => ({
    id: sheetRef.current?.post?.id || uid('post'),
    title: tTitle.trim() || 'Untitled',
    body: tBody,
    imageUri: tKind === 'image' ? tUri : undefined,
    videoUri: tKind === 'video' ? tUri : undefined,
    platforms: plats,
    scheduledAt: at,
    createdAt: sheetRef.current?.post?.createdAt ?? Date.now(),
    status,
  });

  const bump = () => setRefreshedAt(Date.now());

  const save = async (at: number, plats: string[]) => {
    if (!sheetRef.current) return;
    if (plats.some((p) => p === 'tiktok' || p === 'instagram') && !tUri) {
      Alert.alert('TikTok & Instagram need media', 'Attach a photo or video — text-only posts can’t go to those channels.');
      return;
    }
    const keepApproval = sheetRef.current.post?.status === 'approval';
    const rec = buildRec(at, plats, keepApproval ? 'approval' : 'queued');
    await saveManagedPost(rec);
    // Reminders are best-effort: the post queues regardless, then we try to arm one.
    let reminded = false;
    if (await notificationsSupported()) {
      if (await ensureNotifPermission()) {
        reminded = await schedulePostReminder({ id: rec.id, title: rec.title, platforms: plats, at });
      }
    }
    setSheet(null);
    bump();
    if (!reminded) {
      Alert.alert('Queued without reminder', NO_NOTIF_MSG);
    }
  };

  const saveDraft = async () => {
    if (!sheetRef.current) return;
    const plats = sheetRef.current.post?.platforms?.length ? sheetRef.current.post.platforms : ['any'];
    const rec = buildRec(undefined, plats, 'draft');
    await saveManagedPost(rec);
    await cancelPostReminder(rec.id);
    setSheet(null);
    bump();
  };

  const moveTo = async (status: PostStatus) => {
    const cur = sheetRef.current?.post;
    if (!cur) return;
    const rec: ManagedPost = { ...cur, status };
    if (status !== 'queued') await cancelPostReminder(rec.id);
    await saveManagedPost(rec);
    setSheet(null);
    bump();
  };

  const remove = async () => {
    const cur = sheetRef.current?.post;
    if (!cur) {
      setSheet(null);
      return;
    }
    await cancelPostReminder(cur.id);
    await deleteManagedPost(cur.id);
    setSheet(null);
    bump();
  };

  const markSent = async () => {
    const cur = sheetRef.current?.post;
    if (!cur) return;
    await cancelPostReminder(cur.id);
    await saveManagedPost({ ...cur, status: 'sent', sentAt: Date.now() });
    setSheet(null);
    bump();
  };

  const publish = async () => {
    const p = sheetRef.current?.post;
    if (!p || publishing) return;
    const r = await runPublish(p);
    if (!r) return;
    await finishPublish(p, r.done, r.errs, r.manual);
  };

  /** "Post now": save the new post, then publish it immediately through the same loop. */
  const postNow = async (plats: string[]) => {
    if (!sheetRef.current || publishing) return;
    if (plats.some((p) => p === 'tiktok' || p === 'instagram') && !tUri) {
      Alert.alert('TikTok & Instagram need media', 'Attach a photo or video — text-only posts can’t go to those channels.');
      return;
    }
    let rec = buildRec(Date.now(), plats, 'queued');
    await saveManagedPost(rec);
    setSheet({ post: rec });
    const r = await runPublish(rec);
    if (!r) return;
    if (!(r.done.length > 0 && r.errs.length === 0 && r.manual.length === 0)) {
      // failed — leave it queued to retry in a minute, reminder armed silently
      const retryAt = Date.now() + 60000;
      rec = { ...rec, scheduledAt: retryAt };
      await saveManagedPost(rec);
      setSheet({ post: rec });
      try {
        if ((await notificationsSupported()) && (await ensureNotifPermission())) {
          await schedulePostReminder({ id: rec.id, title: rec.title, platforms: plats, at: retryAt });
        }
      } catch {}
    }
    await finishPublish(rec, r.done, r.errs, r.manual);
  };

  const runPublish = async (p: ManagedPost): Promise<{ done: string[]; errs: string[]; manual: string[] } | null> => {
    const plats = p.platforms?.length ? p.platforms : ['any'];
    const m = await loadMetaState();
    const caption = [p.title, p.body].filter((x) => x && x.trim()).join('\n\n');
    const done: string[] = [];
    const errs: string[] = [];
    const manual: string[] = [];
    setPublishing(true);
    try {
      // TikTok won't accept a hardcoded audience — ask once, use for the post
      let ttPrivacy: string | null = null;
      if (plats.includes('tiktok')) {
        try {
          ttPrivacy = await askTikTokPrivacy();
        } catch (e: any) {
          if (String(e?.message ?? '') === 'Login was cancelled.') return null; // backed out, stay silent
          throw e;
        }
      }
      for (const ch of plats) {
        try {
          if (ch === 'facebook') {
            if (!m.pageId || !m.pageToken) throw new Error('Facebook not connected');
            await publishFacebook({ pageId: m.pageId, pageToken: m.pageToken, message: caption, imageUri: p.imageUri, videoUri: p.videoUri });
            done.push('Facebook');
          } else if (ch === 'instagram') {
            if (!m.igId || !m.igToken) throw new Error('Instagram not connected');
            await publishInstagram({ igId: m.igId, igToken: m.igToken, caption, imageUri: p.imageUri, videoUri: p.videoUri });
            done.push('Instagram');
          } else if (ch === 'threads') {
            if (!m.threadsId || !m.threadsToken) throw new Error('Threads not connected');
            await publishThreads({ threadsId: m.threadsId, token: m.threadsToken, text: caption, imageUri: p.imageUri, videoUri: p.videoUri });
            done.push('Threads');
          } else if (ch === 'tiktok') {
            if (!m.ttRefreshToken && !m.ttAccessToken) throw new Error('TikTok not connected');
            if (!p.videoUri) throw new Error('TikTok needs a video — photos publish manually for now');
            await publishTikTokVideo({
              title: caption.slice(0, 150) || 'Sosial post',
              privacyLevel: ttPrivacy as string,
              videoUri: p.videoUri,
            });
            done.push('TikTok');
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
    return { done, errs, manual };
  };

  const finishPublish = async (p: ManagedPost, done: string[], errs: string[], manual: string[]) => {
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
      bump();
    }
  };

  const approveAction = sheet?.post
    ? () => {
        const cur = sheetRef.current?.post;
        if (!cur) return;
        if (cur.status === 'approval') {
          if (cur.scheduledAt) void moveTo('queued');
          else Alert.alert('No time set', 'Queue it with a time first — tap the Queue button below.');
        } else {
          void moveTo('approval');
        }
      }
    : undefined;

  return (
    <Ctx.Provider value={{ refreshedAt, openComposer, openPostById }}>
      {children}
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
        onPostNow={postNow}
        onPublish={sheet?.post ? publish : undefined}
        publishBusy={publishing}
        approveLabel={sheet?.post?.status === 'approval' ? 'Approve & queue' : sheet?.post ? 'Send to approvals' : undefined}
        onApprove={approveAction}
        onDelete={sheet?.post ? remove : undefined}
        onPosted={sheet?.post ? markSent : undefined}
        onClose={() => setSheet(null)}
      />
    </Ctx.Provider>
  );
}
