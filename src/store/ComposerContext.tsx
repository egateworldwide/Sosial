import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { AppState, Platform } from 'react-native';
import ScheduleSheet from '../components/ScheduleSheet';
import { uid } from '../constants';
import { loadManagedPosts, saveManagedPost, saveManagedPostLocal, deleteManagedPost, ManagedPost, PostStatus, MediaAttachment, postAttachments, postSegments, PlatformTypes, defaultPlatformType, ChannelKey, queueTooSoon, minQueueLabel, isEmptyPost, LEG_COOLDOWN_MS, MAX_AUTO_TRIES, VIDEO_CHANNEL_MS, PHOTO_CHANNEL_MS } from '../utils/managed';
import { joinThread, isChainPlatform } from '../utils/thread';
import { loadMetaState, saveMetaState, MetaState, connectedChannelIds } from '../utils/metaStore';
import { publishFacebook, publishFacebookReel, publishFacebookStory, publishInstagram, publishInstagramStory, publishThreads, uploadTikTokPhoto, MAX_ATTACHMENTS, ATTACH_LIMITS } from '../utils/metaPublish';
import { publishTikTokVideo, publishTikTokPhotos } from '../utils/tiktokPublish';
import { publishX } from '../utils/xPublish';
import { publishBsky, BskyRef } from '../utils/bskyPublish';
import { publishMastodon } from '../utils/mastodonPublish';
import { publishPinterest } from '../utils/pinPublish';
import { publishLinkedIn } from '../utils/liPublish';
import { publishYouTube } from '../utils/ytPublish';
import { getValidToken, fetchCreatorInfo } from '../utils/tiktokAuth';
import { TT_PRIVACY_LABELS } from '../utils/tiktokConfig';
import { loadActor, canSubmit } from '../utils/team';
import {
  cancelPostReminder,
  schedulePostReminder, ensureNotifPermission,
  notificationsSupported, NO_NOTIF_MSG, fmtDateTime,
} from '../utils/reminders';
import PublishNotice, { PubRow } from '../components/PublishNotice';
import { pullCloudStatus, markCloudLegSent, markCloudPostSent } from '../utils/cloudPosts';

/** Minimum gap between automatic retries of a failed/overdue queued post. */
const RETRY_MS = 5 * 60 * 1000;

/** Hard ceiling on any single channel's publish. Without it one stalled
 *  network call keeps Promise.allSettled pending forever — the publish lock
 *  stays held and the loading overlay never clears, so the app looks frozen. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: any;
  const guard = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} took too long and was given up on — it may still finish, check the app.`)), ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}

/**
 * Publish ordered text segments as a reply chain: segment 0 (with media) is the
 * head, each later segment replies to the one before it. `post` receives the
 * previous ref (null for the head) so callers can build platform-specific reply
 * structures; `idOf` extracts the remote id. Returns the HEAD's id — the head
 * is the canonical post for analytics, and recording it is what stops retries
 * from re-chaining.
 */
async function publishChain<T>(
  segments: string[],
  post: (text: string, parent: T | null) => Promise<T>,
  idOf: (ref: T) => string,
): Promise<string> {
  let ref: T | null = null;
  let head = '';
  for (let i = 0; i < segments.length; i++) {
    ref = await post(segments[i], ref);
    if (i === 0) head = idOf(ref);
  }
  return head;
}

interface ComposerCtx {
  /** bumped on every save/delete/publish so lists refresh */
  refreshedAt: number;
  openComposer: (p: ManagedPost | null) => void;
  openPostById: (id: string) => Promise<void>;
  /** publish a queued post by id (used when a scheduled reminder is tapped) */
  publishPostById: (id: string) => Promise<void>;
  /** member: draft → approval */
  submitForApproval: (id: string) => Promise<void>;
  /** owner/admin: approval → queued */
  approvePost: (id: string) => Promise<void>;
  /** owner/admin: approval → draft */
  rejectPost: (id: string) => Promise<void>;
}

const Ctx = createContext<ComposerCtx>({ refreshedAt: 0, openComposer: () => {}, openPostById: async () => {}, publishPostById: async () => {}, submitForApproval: async () => {}, approvePost: async () => {}, rejectPost: async () => {} });

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
  const [tBody, setTBody] = useState('');
  // Thread chain (null = normal single post). Segments double as the editable
  // source of truth while chain mode is on; `tBody` mirrors them joined so the
  // rest of the pipeline (title, guards, body) never needs to know.
  const [tThread, setTThread] = useState<string[] | null>(null);
  const [tMedia, setTMedia] = useState<MediaAttachment[]>([]);
  const [notice, setNotice] = useState<{ mode: 'loading' | 'result' | 'info'; title: string; message?: string; rows?: PubRow[]; channels?: string[] } | null>(null);
  const [privacyAsk, setPrivacyAsk] = useState<{ options: { value: string; label: string }[]; resolve: (v: string) => void } | null>(null);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const publishingRef = useRef(false);
  const attemptTimesRef = useRef<Record<string, number>>({});

  const showInfo = useCallback((title: string, message?: string, channels?: string[]) => {
    setNotice({ mode: 'info', title, message, channels });
  }, []);

  const setRow = (id: string, patch: Partial<PubRow>) => {
    setNotice((prev) =>
      prev && prev.rows ? { ...prev, rows: prev.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : prev,
    );
  };

  const openComposer = useCallback((p: ManagedPost | null) => {
    setNotice(null);
    setTBody(p?.body ?? '');
    setTThread(p?.thread && p.thread.length > 1 ? [...p.thread] : null);
    setTMedia(p ? postAttachments(p) : []);
    setSheet({ post: p });
  }, []);

  /** Chain-mode editor bridge: keeps the joined body in lockstep with segments. */
  const onThread = useCallback((segs: string[] | null) => {
    setTThread(segs);
    if (segs) setTBody(joinThread(segs));
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
    const remaining = MAX_ATTACHMENTS - tMedia.length;
    if (remaining <= 0) {
      showInfo(`${MAX_ATTACHMENTS} items max`, 'Remove one to add another.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: remaining, orderedSelection: true, quality: 0.9 });
    if (res.canceled || !res.assets?.length) return;
    const picked: MediaAttachment[] = res.assets.map((a) => ({
      uri: a.uri,
      kind: a.type === 'video' ? 'video' : 'image',
    }));
    const next = [...tMedia, ...picked].slice(0, MAX_ATTACHMENTS);
    setTMedia(next);
    if (res.assets.length > remaining) {
      showInfo(`${MAX_ATTACHMENTS} items max`, `Kept the first ${MAX_ATTACHMENTS}.`);
    }
  };

  const removeMedia = (index: number) => {
    setTMedia((prev) => prev.filter((_, i) => i !== index));
  };

  /** Title is no longer typed — it's the first line of the post text, kept for lists + reminders. */
  const buildRec = (at: number | undefined, plats: string[], status: PostStatus, types?: PlatformTypes, sourceUrl?: string, threadsTopic?: string, ttPrivacy?: string, ytPrivacy?: string): ManagedPost => {
    const firstImage = tMedia.find((m) => m.kind === 'image')?.uri;
    const firstVideo = tMedia.find((m) => m.kind === 'video')?.uri;
    const segs = tThread ? tThread.map((s) => (s ?? '').trim()).filter(Boolean) : [];
    // A chain only survives when some selected channel can actually thread —
    // otherwise the (possibly edited) single body is the post, not stale segments.
    const chainAllowed = plats.includes('any') || plats.some(isChainPlatform);
    const chain = chainAllowed && segs.length > 1 ? segs : undefined;
    const body = chain ? joinThread(chain) : tBody;
    const firstLine = body.trim().split('\n')[0] ?? '';
    return {
      id: sheetRef.current?.post?.id || uid('post'),
      title: firstLine.slice(0, 80),
      body,
      thread: chain,
      imageUri: firstImage,
      videoUri: firstVideo,
      attachments: [...tMedia],
      platforms: plats,
      platformTypes: types,
      threadsTopic: threadsTopic?.trim() || undefined,
      ttPrivacy: ttPrivacy || undefined,
      ytPrivacy: ytPrivacy || undefined,
      sourceUrl: sourceUrl || undefined,
      scheduledAt: at,
      createdAt: sheetRef.current?.post?.createdAt ?? Date.now(),
      status,
    };
  };

  const bump = () => setRefreshedAt(Date.now());

  /**
   * Serialize progress writes. Channel legs run concurrently (Promise.allSettled)
   * and late-finishing promises outlive their run — without this, concurrent
   * read-modify-writes drop each other's remoteIds on the floor.
   */
  const serRef = useRef<Promise<void>>(Promise.resolve());
  const serialize = <T,>(fn: () => Promise<T>): Promise<T> => {
    const nxt: Promise<T> = serRef.current.then(fn);
    serRef.current = nxt.then(
      () => undefined,
      () => undefined,
    );
    return nxt;
  };

  /** Load-fresh, patch, local-save (no mirror — progress writes must not
   *  re-upload media or clobber worker verdicts). Returns the fresh record. */
  const mergePost = async (postId: string, patch: (f: ManagedPost) => ManagedPost): Promise<ManagedPost | null> =>
    serialize(async () => {
      const all = await loadManagedPosts();
      const f = all.find((x) => x.id === postId);
      if (!f) return null;
      const next = patch(f);
      await saveManagedPostLocal(next);
      return next;
    });

  /** Every channel with live credentials right now. */
  const connectedChannels = (m: MetaState): string[] => connectedChannelIds(m);

  /** "Anywhere" means every connected channel — resolve to a concrete list at publish time. */
  const resolvePlats = (plats: string[], m: MetaState): string[] => {
    if (!plats || plats.length === 0 || plats.includes('any')) {
      const c = connectedChannels(m);
      return c.length > 0 ? c : ['any'];
    }
    return plats;
  };

  /** Channels that need media — and YouTube additionally needs it to be video.
   *  Returns the offending channels (for brand tiles) plus the message. */
  const mediaBlock = (resolved: string[]): { channels: string[]; message: string } | null => {
    const flagged = [...new Set(resolved.filter((p) => p === 'tiktok' || p === 'instagram' || p === 'pinterest' || p === 'youtube'))];
    const missing = flagged.filter((p) => (p === 'youtube' ? !tMedia.some((a) => a.kind === 'video') : tMedia.length === 0));
    if (missing.length === 0) return null;
    const onlyYt = missing.length === 1 && missing[0] === 'youtube';
    return {
      channels: missing,
      message: onlyYt
        ? 'YouTube needs a video — photos or text alone can’t go there.'
        : 'Attach a photo or video — text-only posts can’t go to those channels.',
    };
  };

  const save = async (at: number, plats: string[], types?: PlatformTypes, sourceUrl?: string, threadsTopic?: string, ttPrivacy?: string, ytPrivacy?: string) => {
    if (!sheetRef.current) return;
    if (queueTooSoon(at)) {
      showInfo('Too soon', `Earliest is ${minQueueLabel()} — scheduled posts need at least 5 minutes lead time.`);
      return;
    }
    if (isEmptyPost({ body: tBody, attachments: tMedia })) {
      showInfo('Nothing to post', 'Write something or attach a photo/video first.');
      return;
    }
    const resolved = resolvePlats(plats, await loadMetaState());
    const blocked = mediaBlock(resolved);
    if (blocked) {
      showInfo('That channel needs media', blocked.message, blocked.channels);
      return;
    }
    const keepApproval = sheetRef.current.post?.status === 'approval';
    const isMember = canSubmit(await loadActor());
    const status: PostStatus = keepApproval || isMember ? 'approval' : 'queued';
    const rec = buildRec(at, plats, status, types, sourceUrl, threadsTopic, ttPrivacy, ytPrivacy);
    await saveManagedPost(rec);
    // Reminders are best-effort: only armed for posts that actually queue.
    let reminded = false;
    if (status === 'queued' && await notificationsSupported()) {
      if (await ensureNotifPermission()) {
        reminded = await schedulePostReminder({ id: rec.id, title: rec.title, platforms: plats, at });
      }
    }
    setSheet(null);
    bump();
    if (status === 'approval') {
      showInfo('Sent for approval', 'An owner or admin will review it before it goes out.');
    } else if (!reminded) {
      showInfo('Queued without reminder', NO_NOTIF_MSG);
    }
  };

  const saveDraft = async (types?: PlatformTypes, sourceUrl?: string, threadsTopic?: string, ttPrivacy?: string, ytPrivacy?: string) => {
    if (!sheetRef.current) return;
    const plats = sheetRef.current.post?.platforms?.length ? sheetRef.current.post.platforms : ['any'];
    const rec = buildRec(undefined, plats, 'draft', types, sourceUrl, threadsTopic, ttPrivacy, ytPrivacy);
    await saveManagedPost(rec);
    await cancelPostReminder(rec.id);
    setSheet(null);
    bump();
  };

  /** Status transitions driven from the Post pipeline (by id, not the open sheet). */
  const setPostStatus = async (id: string, status: PostStatus) => {
    const all = await loadManagedPosts();
    const p = all.find((x) => x.id === id);
    if (!p) return;
    await saveManagedPost({ ...p, status });
    if (status !== 'queued') await cancelPostReminder(id);
    bump();
  };

  const submitForApproval = useCallback((id: string) => setPostStatus(id, 'approval'), []);
  const approvePost = useCallback((id: string) => setPostStatus(id, 'queued'), []);
  const rejectPost = useCallback((id: string) => setPostStatus(id, 'draft'), []);

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
    if (!p) return;
    if (publishing || publishingRef.current) {
      showInfo('Already publishing', 'Wait for the current publish to finish before posting again.');
      return;
    }
    try {
      const r = await runPublish(p);
      if (!r) return;
      await finishPublish(p, r);
    } catch (e: any) {
      // runPublish rethrows only for pre-blast failures — never reset silently
      setNotice({ mode: 'result', title: 'Publish failed', rows: [{ id: 'post', label: 'Post', state: 'fail' as const, note: e?.message ?? 'Try again.' }] });
    }
  };

  /** "Post now": publish immediately — no queueing, no scheduledAt. */
  const postNow = async (plats: string[], types?: PlatformTypes, sourceUrl?: string, threadsTopic?: string, ttPrivacy?: string, ytPrivacy?: string) => {
    if (!sheetRef.current) return;
    // A stuck or background publish used to swallow taps silently here —
    // say so, so a held lock is diagnosable instead of invisible.
    if (publishing || publishingRef.current) {
      showInfo('Already publishing', 'Wait for the current publish to finish before posting again.');
      return;
    }
    if (isEmptyPost({ body: tBody, attachments: tMedia })) {
      showInfo('Nothing to post', 'Write something or attach a photo/video first.');
      return;
    }
    try {
      const resolved = resolvePlats(plats, await loadMetaState());
      const blocked = mediaBlock(resolved);
      if (blocked) {
        showInfo('That channel needs media', blocked.message, blocked.channels);
        return;
      }
      // Members can't publish directly — their "post now" becomes a pending approval.
      if (canSubmit(await loadActor())) {
        const rec = buildRec(undefined, plats, 'approval', types, sourceUrl, threadsTopic, ttPrivacy, ytPrivacy);
        await saveManagedPost(rec);
        await cancelPostReminder(rec.id);
        setSheet(null);
        bump();
        showInfo('Sent for approval', 'An owner or admin will review it before it goes out.');
        return;
      }
      // no scheduledAt → the auto-publish sweep ignores it, so it can't double-post
      const rec = buildRec(undefined, plats, 'queued', types, sourceUrl, threadsTopic, ttPrivacy, ytPrivacy);
      const r = await runPublish(rec);
      if (!r) return;
      const ok = r.done.length > 0 && r.errs.length === 0 && r.manual.length === 0;
      if (!ok) {
        // failed — keep it as a draft so nothing is lost; user can retry from Drafts
        const draft = { ...rec, status: 'draft' as PostStatus, scheduledAt: undefined };
        await saveManagedPost(draft);
        setSheet({ post: draft });
        bump();
      }
      await finishPublish(rec, r);
    } catch (e: any) {
      setNotice({ mode: 'result', title: 'Publish failed', rows: [{ id: 'post', label: 'Post', state: 'fail' as const, note: e?.message ?? 'Try again.' }] });
    }
  };

  const labelFor = (id: string) => (id === 'any' ? 'Manual post' : id === 'tiktok' ? 'TikTok' : id[0].toUpperCase() + id.slice(1));

  // cancel hook for a pending privacy ask (ref survives re-renders, unlike a fn property)
  const privacyCancelRef = React.useRef<(() => void) | null>(null);

  /** In-app TikTok audience picker — replaces the native Alert. Resolves one option. */
  const askPrivacy = (options: string[]): Promise<string> =>
    new Promise((resolve, reject) => {
      setPrivacyAsk({
        options: options.map((o) => ({ value: o, label: TT_PRIVACY_LABELS[o] ?? o })),
        resolve: (v: string) => {
          setPrivacyAsk(null);
          resolve(v);
        },
      });
      // hoist reject so cancel can bail the whole publish
      privacyCancelRef.current = () => {
        setPrivacyAsk(null);
        reject(new Error('Login was cancelled.'));
      };
    });

  interface RunResult {
    done: string[];
    errs: string[];
    manual: string[];
    remoteIds: Record<string, string>;
    /** resolved plats this run covered (TikTok pre-flight may narrow it) */
    resolved: string[];
  }

  const runPublish = async (p: ManagedPost, opts?: { silent?: boolean }): Promise<RunResult | null> => {
    const m = await loadMetaState();
    let plats = resolvePlats(p.platforms, m);
    // buildRec derives title from the body's first line — posting title + body
    // would print that line twice. Independent titles (e.g. design names from
    // Export) still prefix the body.
    const bodyText = (p.body ?? '').trim();
    const titleText = (p.title ?? '').trim();
    const caption = titleText && bodyText.split('\n')[0].startsWith(titleText)
      ? bodyText
      : [titleText, bodyText].filter((x) => x).join('\n\n');
    const atts = postAttachments(p);
    const firstVideo = atts.find((a) => a.kind === 'video');
    // Chain mode: when the post carries >1 segment, the four chain-capable
    // channels publish them as replies; every other channel keeps `caption`.
    const segList = postSegments(p);
    const chain = segList.length > 1 ? segList : null;
    const done: string[] = [];
    const errs: string[] = [];
    const manual: string[] = [];
    /** per-channel remote ids for the Sent analytics view */
    const remoteIds: Record<string, string> = {};
    const keep = (ch: string, v: unknown) => {
      const s = Array.isArray(v) ? v.map((x) => String(x)).join(',') : String(v ?? '');
      if (s) remoteIds[ch] = s;
    };
    const silent = !!opts?.silent;
    // Seed from already-recorded legs: a channel with a remote id already
    // posted — never repost it (the duplicate guard). Foreground retries and
    // sweep passes alike skip done legs; timed-out legs park in cooldown.
    const prevIds: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.remoteIds ?? {})) if (v) prevIds[k] = String(v);
    for (const ch of plats) {
      if (prevIds[ch] && ch !== 'any') {
        if (remoteIds[ch] === undefined) remoteIds[ch] = prevIds[ch];
        const l = labelFor(ch);
        if (!done.includes(l)) done.push(l);
      }
    }
    const honorCooldown = silent; // foreground taps always attempt now
    let pending = plats.filter((ch) => {
      if (ch === 'any' || !prevIds[ch]) {
        if (ch !== 'any' && honorCooldown && (p.retryAfter?.[ch] ?? 0) > Date.now()) return false;
        return true;
      }
      return false;
    });
    /** A leg landed (possibly late, after its run timed out): record it now so
     *  the row heals instead of reposting. Never throws. */
    const recordLegDone = async (ch: string): Promise<void> => {
      const ids = remoteIds[ch];
      if (!ids) return;
      try {
        await mergePost(p.id, (f) => {
          const ce = { ...(f.channelErr ?? {}) };
          delete ce[ch];
          const ra = { ...(f.retryAfter ?? {}) };
          delete ra[ch];
          return { ...f, remoteIds: { ...(f.remoteIds ?? {}), [ch]: ids }, channelErr: ce, retryAfter: ra };
        });
        bump();
      } catch {}
      void markCloudLegSent(p.id, ch, ids);
    };
    /** Persist a leg failure note for the loud queue row. Never throws. */
    const noteLegErr = async (ch: string, note: string): Promise<void> => {
      try {
        await mergePost(p.id, (f) => ({ ...f, channelErr: { ...(f.channelErr ?? {}), [ch]: note } }));
      } catch {}
    };
    // silent background runs must not touch the visible flag — it was set
    // unconditionally but only cleared for foreground runs, sticking the UI
    // in "Posting…" and silently killing every later tap at the entry guard.
    if (!silent) setPublishing(true);
    publishingRef.current = true;
    if (!silent) {
      setNotice({
        mode: 'loading',
        title: 'Publishing…',
        rows: plats.map((id) => ({ id, label: labelFor(id), state: (prevIds[id] ? 'done' : 'pending') as 'done' | 'pending' })),
      });
    }
    try {
      // TikTok won't accept a hardcoded audience — prefer the upfront pick,
      // fall back to asking once at publish time
      let ttPrivacy: string | null = p.ttPrivacy ?? null;
      if (pending.includes('tiktok') && plats.includes('tiktok') && !ttPrivacy && silent) {
        // Background runs must never prompt — without a saved audience the
        // post needs the user, so skip TikTok quietly this pass instead of
        // hanging on a modal no one asked for.
        errs.push('TikTok: audience not chosen — TikTok skipped');
        void noteLegErr('tiktok', 'audience not chosen — TikTok skipped');
        plats = plats.filter((p) => p !== 'tiktok');
      }
      if (pending.includes('tiktok') && plats.includes('tiktok') && !ttPrivacy) {
        try {
          const token = await getValidToken();
          const ci = await fetchCreatorInfo(token);
          const options = ci.privacyOptions.length > 0 ? ci.privacyOptions : ['SELF_ONLY'];
          // NEVER wait on a modal here. A prompt that can't present over the
          // composer sheet leaves this await pending forever, which holds the
          // publish lock: the tap does nothing and every later tap is stuck.
          // The sheet's Audience picker is the explicit control; this is just
          // a safe default (remembered audience first, then the widest offered).
          ttPrivacy =
            options.find((o) => o === m.ttLastPrivacy) ??
            options.find((o) => o === 'SELF_ONLY') ??
            options.find((o) => o === 'PUBLIC_TO_EVERYONE') ??
            options[0] ??
            'SELF_ONLY';
        } catch (e: any) {
          // Backing out of the audience pick (or any pre-flight failure) must
          // never kill the whole publish silently — fail TikTok alone with a
          // visible row and keep blasting the rest.
          const note =
            String(e?.message ?? '') === 'Login was cancelled.'
              ? 'audience not chosen — TikTok skipped'
              : (e?.message ?? 'failed');
          errs.push(`TikTok: ${note}`);
          void noteLegErr('tiktok', note);
          setRow('tiktok', { state: 'fail', note });
          plats = plats.filter((p) => p !== 'tiktok');
        }
      }
      // TikTok pre-flight above may narrow plats — keep the blast in sync.
      pending = pending.filter((c) => plats.includes(c));
      if (silent && pending.length > 0) {
        // Count the attempt first (local-only write): unbounded silent retries
        // of a slow video is how duplicate tweets happen. No pending legs (all
        // done or cooling) burns no attempt.
        await mergePost(p.id, (f) => ({ ...f, autoTries: (f.autoTries ?? 0) + 1 }));
      }
      // blast: every channel publishes concurrently, rows flip independently.
      // Each channel is capped so one stalled call can't hold the whole blast
      // (and its loading overlay) open forever. Video uploads + processing
      // polls run an order of magnitude longer than photos — an 8-minute cap
      // turned every slow video into a false failure (the post still landed,
      // the row stuck overdue, the retry duplicated it).
      const perChannelMs = atts.some((a) => a.kind === 'video') ? VIDEO_CHANNEL_MS : PHOTO_CHANNEL_MS;
      await Promise.allSettled(pending.map((ch) => withTimeout(
        (async () => {
        setRow(ch, { state: 'working' });
        try {
          const type = (p.platformTypes?.[ch as ChannelKey] as string | undefined) ?? defaultPlatformType(ch as ChannelKey, atts);
          if (ch === 'facebook') {
            if (!m.pageId || !m.pageToken) throw new Error('Facebook not connected');
            if (type === 'story') {
              keep(ch, await publishFacebookStory({ pageId: m.pageId, pageToken: m.pageToken, imageUri: p.imageUri, videoUri: p.videoUri, attachments: atts }));
            } else if (type === 'reel') {
              keep(ch, await publishFacebookReel({ pageId: m.pageId, pageToken: m.pageToken, message: caption, videoUri: p.videoUri, attachments: atts }));
            } else {
              keep(ch, await publishFacebook({ pageId: m.pageId, pageToken: m.pageToken, message: caption, imageUri: p.imageUri, videoUri: p.videoUri, attachments: atts }));
            }
            done.push('Facebook');
          } else if (ch === 'instagram') {
            if (!m.igId || !m.igToken) throw new Error('Instagram not connected');
            if (type === 'story') {
              keep(ch, await publishInstagramStory({ igId: m.igId, igToken: m.igToken, caption, imageUri: p.imageUri, videoUri: p.videoUri, attachments: atts, mirrorClientId: p.id }));
            } else if (type === 'reel' && !atts.some((a) => a.kind === 'video')) {
              throw new Error('Instagram Reels need a video.');
            } else {
              keep(ch, await publishInstagram({ igId: m.igId, igToken: m.igToken, caption, imageUri: p.imageUri, videoUri: p.videoUri, attachments: atts, mirrorClientId: p.id }));
            }
            done.push('Instagram');
          } else if (ch === 'threads') {
            // Narrow into consts — TS drops property narrowing inside callbacks.
            const thId = m.threadsId;
            const thToken = m.threadsToken;
            if (!thId || !thToken) throw new Error('Threads not connected');
            if (type === 'ghost') {
              // real ghost post: text-only container flagged to auto-archive in 24h
              keep(ch, await publishThreads({ threadsId: thId, token: thToken, text: caption, ghost: true, topicTag: p.threadsTopic }));
            } else {
              keep(ch, chain
                ? await publishChain<string>(chain, (text, parent) => publishThreads({
                    threadsId: thId, token: thToken, text,
                    // media rides the head only; replies are text-only
                    imageUri: parent ? undefined : p.imageUri,
                    videoUri: parent ? undefined : p.videoUri,
                    attachments: parent ? [] : atts,
                    topicTag: p.threadsTopic,
                    mirrorClientId: parent ? undefined : p.id,
                    replyToId: parent ?? undefined,
                  }), (id) => id)
                : await publishThreads({ threadsId: thId, token: thToken, text: caption, imageUri: p.imageUri, videoUri: p.videoUri, attachments: atts, topicTag: p.threadsTopic, mirrorClientId: p.id }));
            }
            done.push('Threads');
          } else if (ch === 'tiktok') {
            if (!m.ttRefreshToken && !m.ttAccessToken) throw new Error('TikTok not connected');
            const imgs = atts.filter((a) => a.kind === 'image').slice(0, ATTACH_LIMITS.tiktok.images);
            if (type === 'photo' || !firstVideo) {
              // photo carousel — TikTok pulls from public URLs
              if (!imgs.length) throw new Error(type === 'photo' ? 'Attach at least one photo for a TikTok photo post.' : 'TikTok needs a photo or video');
              const urls: string[] = [];
              for (const img of imgs) {
                urls.push(img.uri.startsWith('http') ? img.uri : await uploadTikTokPhoto(img.uri));
              }
              keep(ch, await publishTikTokPhotos({
                title: caption || 'Sosial post',
                privacyLevel: ttPrivacy as string,
                imageUrls: urls,
              }));
            } else {
              keep(ch, await publishTikTokVideo({
                title: caption.slice(0, 150) || 'Sosial post',
                privacyLevel: ttPrivacy as string,
                videoUri: firstVideo.uri,
              }));
            }
            done.push('TikTok');
            // remember the audience that actually published — an unaudited app
            // can only post SELF_ONLY, and re-defaulting to Public would fail
            // every future post the same way
            if (ttPrivacy) saveMetaState({ ttLastPrivacy: ttPrivacy });
          } else if (ch === 'x') {
            if (!m.xUserId || (!m.xAccessToken && !m.xRefreshToken)) throw new Error('X not connected');
            if (firstVideo && atts.some((a) => a.kind === 'image')) {
              throw new Error('X can’t mix photos and video — send one or the other.');
            }
            const imgs = atts.filter((a) => a.kind === 'image').slice(0, ATTACH_LIMITS.x.images);
            const imgUris = imgs.map((a) => a.uri);
            keep(ch, chain
              ? await publishChain<string>(chain, (text, parent) => publishX({
                  text,
                  imageUris: parent ? [] : imgUris,
                  videoUri: parent ? undefined : firstVideo?.uri,
                  replyTo: parent ?? undefined,
                }), (id) => id)
              : await publishX({ text: caption, imageUris: imgUris, videoUri: firstVideo?.uri }));
            done.push('X');
          } else if (ch === 'bluesky') {
            if (!m.bskyDid || (!m.bskyAccessJwt && !m.bskyRefreshJwt)) throw new Error('Bluesky not connected');
            if (firstVideo && atts.some((a) => a.kind === 'image')) {
              throw new Error('Bluesky can’t mix photos and video — send one or the other.');
            }
            const imgs = atts.filter((a) => a.kind === 'image').slice(0, ATTACH_LIMITS.bluesky.images);
            const bsImgUris = imgs.map((a) => a.uri);
            let rootRef: BskyRef | null = null;
            keep(ch, chain
              ? await publishChain<BskyRef>(chain, async (text, parent) => {
                  const ref = await publishBsky({
                    text,
                    imageUris: parent ? [] : bsImgUris,
                    videoUri: parent ? undefined : firstVideo?.uri,
                    // every reply points at the head as root, the one above as parent
                    replyTo: parent && rootRef ? { root: rootRef, parent } : undefined,
                  });
                  if (!rootRef) rootRef = ref;
                  return ref;
                }, (r) => r.uri)
              : (await publishBsky({ text: caption, imageUris: bsImgUris, videoUri: firstVideo?.uri })).uri);
            done.push('Bluesky');
          } else if (ch === 'mastodon') {
            if (!m.mastodonAccessToken || !m.mastodonInstance) throw new Error('Mastodon not connected');
            // Mastodon takes either a single video or up to 4 images — never both
            const imgs = atts.filter((a) => a.kind === 'image').slice(0, ATTACH_LIMITS.mastodon.images);
            const mImgUris = imgs.map((a) => a.uri);
            keep(ch, chain
              ? await publishChain<string>(chain, (text, parent) => publishMastodon({
                  text,
                  imageUris: parent ? [] : mImgUris,
                  videoUri: parent ? undefined : firstVideo?.uri,
                  replyToId: parent ?? undefined,
                }), (id) => id)
              : await publishMastodon({ text: caption, imageUris: mImgUris, videoUri: firstVideo?.uri }));
            done.push('Mastodon');
          } else if (ch === 'pinterest') {
            if (!m.pinAccessToken) throw new Error('Pinterest not connected');
            // One Pin per image on the default board, plus a video Pin when attached
            const imgs = atts.filter((a) => a.kind === 'image').slice(0, ATTACH_LIMITS.pinterest.images);
            keep(ch, await publishPinterest({ text: caption, imageUris: imgs.map((a) => a.uri), videoUri: firstVideo?.uri }));
            done.push('Pinterest');
          } else if (ch === 'linkedin') {
            if (!m.liPersonUrn) throw new Error('LinkedIn not connected');
            // Text and/or up to 9 photos as a member post
            const imgs = atts.filter((a) => a.kind === 'image').slice(0, ATTACH_LIMITS.linkedin.images);
            keep(ch, await publishLinkedIn({ text: caption, imageUris: imgs.map((a) => a.uri) }));
            done.push('LinkedIn');
          } else if (ch === 'youtube') {
            if (!m.ytRefreshToken && !m.ytAccessToken) throw new Error('YouTube not connected');
            // Video-only — photos/text alone throw a clear error
            keep(ch, await publishYouTube({ text: caption, videoUri: firstVideo?.uri, kind: (type as 'video' | 'short' | undefined) ?? 'video', privacy: (p.ytPrivacy as 'public' | 'unlisted' | 'private' | undefined) ?? 'public' }));
            done.push('YouTube');
          } else {
            manual.push(ch === 'any' ? 'manual post' : ch);
            setRow(ch, { state: 'manual', note: 'Open the app and post it yourself' });
            return;
          }
          await recordLegDone(ch);
          setRow(ch, { state: 'done' });
        } catch (e: any) {
          const note = e?.message ?? 'failed';
          errs.push(`${labelFor(ch)}: ${note}`);
          void noteLegErr(ch, note);
          setRow(ch, { state: 'fail', note });
        }
        })(),
        perChannelMs,
        labelFor(ch),
      ).catch(async (e: any) => {
        // Only the timeout rejection lands here — the body swallows its own
        // errors. Timeout ≠ failure: the promise is still running and may
        // land. Park the leg in cooldown so no retry duplicates it, and only
        // record the error if the leg hasn't recorded success meanwhile.
        const note = e?.message ?? 'failed';
        const landed = await serialize(async () => {
          const all = await loadManagedPosts();
          const f = all.find((x) => x.id === p.id);
          if (!f) return false;
          if ((f.remoteIds ?? {})[ch]) return true;
          await saveManagedPostLocal({
            ...f,
            retryAfter: { ...(f.retryAfter ?? {}), [ch]: Date.now() + LEG_COOLDOWN_MS },
            channelErr: { ...(f.channelErr ?? {}), [ch]: note },
          });
          return false;
        }).catch(() => false);
        if (!landed) {
          errs.push(`${labelFor(ch)}: ${note}`);
          void noteLegErr(ch, note);
          setRow(ch, { state: 'fail', note });
        } else {
          setRow(ch, { state: 'done' });
        }
      })));
    } catch (e) {
      setNotice(null);
      throw e;
    } finally {
      if (!silent) setPublishing(false);
      publishingRef.current = false;
    }
    return { done, errs, manual, remoteIds, resolved: plats };
  };

  /**
   * Settle a run against the STORED record (not just this run's arrays — legs
   * may have landed late from an earlier timed-out run). Sent iff at least one
   * real channel exists and every real channel has a remote id. Manual-only
   * posts never auto-flip. Always persists merged progress + bump, so the
   * queue repaints with no manual refresh.
   */
  const settlePost = async (
    base: ManagedPost,
    resolved: string[],
    run: RunResult,
    opts?: { silent?: boolean },
  ): Promise<{ rec: ManagedPost; sent: boolean }> => {
    await serRef.current.catch(() => {});
    const all = await loadManagedPosts();
    const found = all.find((x) => x.id === base.id);
    const fresh = found ?? base;
    const mergedIds = { ...(fresh.remoteIds ?? {}), ...run.remoteIds };
    const real = resolved.filter((c) => c !== 'any');
    const flippable = (fresh.status ?? 'queued') === 'queued' || fresh.status === 'approval';
    const sent = flippable && real.length > 0 && real.every((c) => !!mergedIds[c]);
    const next: ManagedPost = {
      ...fresh,
      remoteIds: mergedIds,
      autoTries: opts?.silent ? (fresh.autoTries ?? 0) : 0,
      status: sent ? 'sent' : fresh.status,
      sentAt: sent ? (fresh.sentAt ?? Date.now()) : fresh.sentAt,
    };
    if (sent && !found) {
      // brand-new row (Post Now) — full save so the cloud mirror is created sent
      await saveManagedPost(next);
    } else {
      await saveManagedPostLocal(next);
    }
    if (sent) {
      await cancelPostReminder(next.id);
      void markCloudPostSent(next.id);
    }
    bump();
    return { rec: next, sent };
  };

  const finishPublish = async (p: ManagedPost, run: RunResult, opts?: { silent?: boolean }) => {
    const { done, errs, manual } = run;
    const rows: PubRow[] = [
      ...done.map((n) => ({ id: n.toLowerCase(), label: n, state: 'done' as const })),
      ...manual.map((n) => ({
        id: n === 'manual post' ? 'any' : n,
        label: labelFor(n === 'manual post' ? 'any' : n),
        state: 'manual' as const,
        note: 'Open the app and post it yourself',
      })),
      ...errs.map((e) => {
        const i = e.indexOf(': ');
        const label = i > 0 ? e.slice(0, i) : e;
        const note = i > 0 ? e.slice(i + 2) : undefined;
        return { id: label.toLowerCase(), label, state: 'fail' as const, note };
      }),
    ];
    const allGood = done.length > 0 && errs.length === 0 && manual.length === 0;
    if (!opts?.silent) setNotice({ mode: 'result', title: allGood ? 'Published' : 'Publish result', rows });
    // The sent verdict comes from the STORED record (late legs included), not
    // just this run's arrays — a timed-out-then-landed video still flips sent.
    const { rec, sent } = await settlePost(p, run.resolved, run, opts);
    if (sent) {
      // On iOS keep the composer open on the sent record: the result then shows
      // inside the one modal. Closing here would try to present the standalone
      // notice modal during the sheet's dismissal — on iOS that double-modal
      // hand-off leaves the whole app untouchable. Android closes as before.
      if (Platform.OS === 'ios' && sheetRef.current) setSheet({ post: rec });
      else setSheet(null);
    }
  };

  /** Auto-publish queued posts whose time has come (silent, one pass, in schedule order). */
  const publishDueRef = useRef<() => Promise<void>>(async () => {});
  publishDueRef.current = async () => {
    if (publishingRef.current) return;
    const all = await loadManagedPosts();
    const now = Date.now();
    const meta = await loadMetaState();
    const due = all
      .filter((p) => p.status === 'queued' && !!p.scheduledAt && p.scheduledAt <= now)
      .sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
    for (const p of due) {
      // Healer: late-recorded legs (a timed-out promise that landed after its
      // run) may have completed the set — flip sent without reposting.
      try {
        const fresh0 = (await loadManagedPosts()).find((x) => x.id === p.id);
        const resolved0 = resolvePlats((fresh0 ?? p).platforms, meta);
        const real0 = resolved0.filter((c) => c !== 'any');
        if (
          fresh0 && (fresh0.status ?? 'queued') === 'queued' && real0.length > 0 &&
          real0.every((c) => !!((fresh0.remoteIds ?? {})[c]))
        ) {
          await settlePost(fresh0, resolved0, { done: [], errs: [], manual: [], remoteIds: {}, resolved: resolved0 }, { silent: true });
          continue;
        }
        // Parked: auto-retry gave up — the row says why; only a manual tap re-arms.
        if ((fresh0?.autoTries ?? p.autoTries ?? 0) >= MAX_AUTO_TRIES) continue;
      } catch {}
      // retry a failed/overdue post every few minutes while the app is open,
      // so one blip doesn't strand it as "Overdue" forever.
      if (now - (attemptTimesRef.current[p.id] ?? 0) < RETRY_MS) continue;
      attemptTimesRef.current[p.id] = now;
      if (publishingRef.current) return;
      try {
        const r = await runPublish(p, { silent: true });
        if (r) await finishPublish(p, r, { silent: true });
      } catch {
        // silent sweep: a pre-blast throw must not kill the whole pass
      }
    }
  };

  /** Reminder tap: the post is due — publish it now. */
  const publishPostById = useCallback(
    async (id: string) => {
      const all = await loadManagedPosts();
      const p = all.find((x) => x.id === id);
      if (!p || p.status === 'sent') return;
      try {
        const r = await runPublish(p);
        if (r) await finishPublish(p, r);
      } catch (e: any) {
        setNotice({ mode: 'result', title: 'Publish failed', rows: [{ id: 'post', label: 'Post', state: 'fail' as const, note: e?.message ?? 'Try again.' }] });
      }
    },
    [runPublish, finishPublish],
  );

  // Back-sync worker verdicts FIRST, then publish due posts (launch, foreground,
  // 60s tick). Ordering matters: the worker publishes when the app is closed,
  // so its verdicts must land before the local pass reads the rows — otherwise
  // the sweep republishes what the worker already posted. Bump only when
  // something actually flipped.
  useEffect(() => {
    const sweep = () => {
      void (async () => {
        try {
          const r = await pullCloudStatus();
          if (r.updated > 0) bump();
        } catch {}
        await publishDueRef.current();
      })();
    };
    void sweep();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void sweep();
    });
    const timer = setInterval(sweep, 60000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);

  return (
    <Ctx.Provider value={{ refreshedAt, openComposer, openPostById, publishPostById, submitForApproval, approvePost, rejectPost }}>
      {children}
      <ScheduleSheet
        visible={sheet !== null}
        title={sheet?.post?.status === 'sent' ? 'Sent post' : sheet?.post ? 'Edit post' : 'New post'}
        readOnly={sheet?.post?.status === 'sent'}
        readOnlyNote={sheet?.post?.status === 'sent' && sheet.post.sentAt ? `Sent ${fmtDateTime(sheet.post.sentAt)}` : undefined}
        remoteIds={sheet?.post?.remoteIds}
        initialAt={sheet?.post?.scheduledAt}
        initialPlatforms={sheet?.post?.platforms}
        initialTypes={sheet?.post?.platformTypes}
        initialSourceUrl={sheet?.post?.sourceUrl}
        initialThreadsTopic={sheet?.post?.threadsTopic}
        initialTtPrivacy={sheet?.post?.ttPrivacy}
        initialYtPrivacy={sheet?.post?.ytPrivacy}
        composer={{ title: '', caption: tBody, onCaption: setTBody, thread: tThread, onThread }}
        media={{ items: tMedia, onPick: pickMedia, onRemove: removeMedia }}
        onSave={save}
        draftLabel="Save as draft"
        onDraft={saveDraft}
        onPostNow={postNow}
        onDelete={sheet?.post ? remove : undefined}
        onClose={() => { setSheet(null); setNotice(null); }}
        publishing={publishing}
        progress={notice?.rows}
        statusTitle={notice?.title}
        statusMessage={notice?.message}
      />
      {/* One native modal at a time: iOS can't reliably present the notice
          Modal on top of the composer sheet's Modal — the second presentation
          fails and leaves the whole app untouchable (frozen incl. the bottom
          nav). While the sheet is open on iOS the same content is mirrored
          inside it, so the standalone notice modal stays out of the way.
          Android handles stacked modals fine, so its behaviour is unchanged. */}
      <PublishNotice
        visible={notice !== null && !(Platform.OS === 'ios' && sheet !== null)}
        mode={notice?.mode ?? 'info'}
        title={notice?.title ?? ''}
        message={notice?.message}
        channels={notice?.channels}
        rows={notice?.rows}
        onDone={() => setNotice(null)}
        onHide={() => setNotice(null)}
      />
      <PublishNotice
        visible={privacyAsk !== null}
        mode="privacy"
        title="TikTok audience"
        message="Who can see this post?"
        rows={(privacyAsk?.options ?? []).map((o) => ({ id: o.value, label: o.label, state: 'pending' as const }))}
        onPick={(v) => privacyAsk?.resolve(v)}
        onCancel={() => privacyCancelRef.current?.()}
      />
    </Ctx.Provider>
  );
}
