import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, Alert, Platform, KeyboardAvoidingView, Image, ActivityIndicator } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useTheme, Palette, R } from '../theme';
import { PrimaryBtn, GhostBtn, Txt } from './ui';
import { PubRow } from './PublishNotice';
import { SocialGlyph } from './ui';
import { SOCIAL_META } from '../constants';
import { MAX_ATTACHMENTS } from '../utils/metaPublish';
import { fmtDateTime } from '../utils/reminders';
import { PlatformTypes, POST_TYPE_OPTIONS, defaultPlatformType, ChannelKey } from '../utils/managed';
import { loadMetaState, connectedChannelIds, MetaState } from '../utils/metaStore';
import { getValidToken, fetchCreatorInfo } from '../utils/tiktokAuth';
import { TT_PRIVACY_LABELS } from '../utils/tiktokConfig';
import { fetchPostStats, SentPostStats } from '../utils/postStats';
import { fbComments, igComments, thComments, mastodonComments, bskyComments, ytComments, PerPost, FeedComment } from '../utils/analytics';

const CHANNELS = ['any', 'facebook', 'instagram', 'tiktok', 'threads', 'linkedin', 'bluesky', 'youtube', 'mastodon', 'pinterest', 'x'];
const COMING_SOON: string[] = [];
type TypeChannel = 'facebook' | 'instagram' | 'threads' | 'x' | 'linkedin' | 'youtube' | 'bluesky' | 'mastodon' | 'pinterest' | 'tiktok';
const TYPE_CHANNELS: TypeChannel[] = ['facebook', 'instagram', 'threads', 'x', 'linkedin', 'youtube', 'bluesky', 'mastodon', 'pinterest', 'tiktok'];

/** YouTube listing options — static, no fetch needed. */
const YT_LISTING = [
  { id: 'public', label: 'Public' },
  { id: 'unlisted', label: 'Unlisted' },
  { id: 'private', label: 'Private' },
];

function slotToday(hour: number, min = 0): number {
  const d = new Date();
  d.setHours(hour, min, 0, 0);
  if (d.getTime() <= Date.now() + 60000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function slotTomorrow(hour: number, min = 0): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, min, 0, 0);
  return d.getTime();
}

/** Real video preview for the viewer modal — own component so the player hook
 *  stays unconditional; keyed by uri so Prev/Next always loads the right file. */
function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <VideoView
      style={{ width: '100%', height: '100%' }}
      player={player}
      contentFit="contain"
      nativeControls
    />
  );
}

/** Live per-post engagement for sent posts, looked up by saved remote ids. */
function SentStats({ remoteIds }: { remoteIds?: Record<string, string> }) {
  const { C } = useTheme();
  const st = makeSt(C);
  const entries = Object.entries(remoteIds ?? {});
  const [stats, setStats] = useState<Record<string, SentPostStats>>({});
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    if (entries.length === 0) {
      setLoading(false);
      return () => { live = false; };
    }
    (async () => {
      try {
        const m: MetaState = await loadMetaState();
        const readers: Record<string, (mm: MetaState, s: PerPost[]) => Promise<FeedComment[]>> = {
          facebook: fbComments, instagram: igComments, threads: thComments,
          mastodon: mastodonComments, bluesky: bskyComments, youtube: ytComments,
        };
        const got: Record<string, SentPostStats> = {};
        const found: FeedComment[] = [];
        await Promise.all(entries.map(async ([ch, rid]) => {
          const first = rid.split(',')[0].trim();
          const label = SOCIAL_META[ch]?.label ?? ch;
          got[ch] = await fetchPostStats(ch, rid);
          const reader = readers[ch];
          if (reader && first) {
            try {
              const cs = await reader(m, [{ id: first, title: label, likes: 0, comments: 0, views: null, ts: Date.now() }]);
              found.push(...cs);
            } catch {}
          }
        }));
        if (!live) return;
        setStats(got);
        setComments(found.sort((a, b) => b.ts - a.ts).slice(0, 10));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (entries.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={st.label}>Performance</Text>
      {loading ? (
        <ActivityIndicator color={C.accent} />
      ) : (
        entries.map(([ch]) => {
          const s = stats[ch];
          if (!s) return null;
          return (
            <View key={ch} style={st.perfRow}>
              <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: SOCIAL_META[ch]?.bg ?? C.ink, alignItems: 'center', justifyContent: 'center' }}>
                <SocialGlyph platform={ch} size={14} color="#fff" />
              </View>
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={st.perfT}>{SOCIAL_META[ch]?.label ?? ch}</Text>
                <Text style={st.perfS}>
                  {s.likes} likes · {s.comments} comments{s.views != null ? ` · ${s.views} views` : ''}{s.shares > 0 ? ` · ${s.shares} shares` : ''}
                </Text>
                {s.note ? <Text style={st.perfNote}>{s.note}</Text> : null}
              </View>
            </View>
          );
        })
      )}
      {!loading && comments.length > 0 ? (
        <View style={{ gap: 6, marginTop: 2 }}>
          <Text style={st.label}>Latest comments</Text>
          {comments.map((c, i) => (
            <View key={`${c.channel}-${i}`} style={st.feedRow}>
              <Text style={st.feedA} numberOfLines={1}>{c.author} · {SOCIAL_META[c.channel]?.label ?? c.channel}</Text>
              <Text style={st.feedX} numberOfLines={2}>{c.text}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export interface Composer {
  title: string;
  caption: string;
  onCaption: (v: string) => void;
  onTitle?: (v: string) => void;
}

export interface SheetMediaItem {
  uri: string;
  kind: 'image' | 'video';
}

export interface SheetMedia {
  items: SheetMediaItem[];
  onPick: () => void;
  onRemove: (index: number) => void;
}

interface Props {
  visible: boolean;
  initialAt?: number;
  initialPlatforms?: string[];
  initialTypes?: PlatformTypes;
  initialSourceUrl?: string;
  initialThreadsTopic?: string;
  initialTtPrivacy?: string;
  initialYtPrivacy?: string;
  title?: string;
  bulkCount?: number;
  composer?: Composer;
  media?: SheetMedia;
  onDelete?: () => void;
  onSave: (at: number, platforms: string[], types: PlatformTypes, sourceUrl?: string, threadsTopic?: string, ttPrivacy?: string, ytPrivacy?: string) => void;
  onPostNow?: (plats: string[], types: PlatformTypes, sourceUrl?: string, threadsTopic?: string, ttPrivacy?: string, ytPrivacy?: string) => void;
  draftLabel?: string;
  onDraft?: (types: PlatformTypes, sourceUrl?: string, threadsTopic?: string, ttPrivacy?: string, ytPrivacy?: string) => void;
  onClose: () => void;
  /** Live publish progress (shown inline while the "Post now" button spins). */
  publishing?: boolean;
  progress?: PubRow[];
  /** publish-notice mirror, rendered inside the sheet so a result is visible
   *  even when a stacked modal refuses to present over this one */
  statusTitle?: string;
  statusMessage?: string;
  /** Sent posts open read-only: static summary + Delete, no editing or re-sending. */
  readOnly?: boolean;
  readOnlyNote?: string;
  /** per-channel remote ids saved at publish time — drives the Sent analytics section */
  remoteIds?: Record<string, string>;
}

/** Buffer-style sheet: channels (multi) + title/description + time. */
export default function ScheduleSheet({ visible, initialAt, initialPlatforms, initialTypes, initialSourceUrl, initialThreadsTopic, initialTtPrivacy, initialYtPrivacy, title, bulkCount, composer, media, onDelete, draftLabel, onDraft, onSave, onPostNow, onClose, readOnly, readOnlyNote, remoteIds, publishing, progress, statusTitle, statusMessage }: Props) {
  const { C, mode: themeMode } = useTheme();
  const st = makeSt(C);
  const [plats, setPlats] = useState<string[]>(['any']);
  const [connected, setConnected] = useState<string[]>([]);
  const [types, setTypes] = useState<PlatformTypes>({});
  const [threadsTopic, setThreadsTopic] = useState('');
  const [topicOpen, setTopicOpen] = useState(false);
  const [ttPrivacy, setTtPrivacy] = useState('');
  const [ttPrivacyOptions, setTtPrivacyOptions] = useState<string[]>([]);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [ytPrivacy, setYtPrivacy] = useState('public');
  const [listingOpen, setListingOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [preset, setPreset] = useState<'now' | 'custom'>('now');
  const [custom, setCustom] = useState(new Date(Date.now() + 86400000));
  const [showPicker, setShowPicker] = useState(false);
  const [mode, setMode] = useState<'date' | 'time'>('date');
  const [pickingTime, setPickingTime] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);

  const vCount = media?.items.length ?? 0;
  const vIdx = viewer !== null && vCount > 0 ? Math.min(viewer, vCount - 1) : null;
  const vItem = vIdx !== null ? media?.items[vIdx] : undefined;

  useEffect(() => {
    if (visible) {
      const init = initialPlatforms && initialPlatforms.length > 0 ? initialPlatforms : null;
      const explicit = !!init && !(init.length === 1 && init[0] === 'any');
      if (explicit) setPlats(init);
      // "Anywhere" opens with every connected channel already ticked, so a
      // post type can be picked per channel; falls back to Anywhere offline
      loadMetaState().then((m) => {
        const c = connectedChannelIds(m);
        setConnected(c);
        if (!explicit) setPlats(c.length > 0 ? c : ['any']);
      });
      setTypes(initialTypes ?? {});
      setThreadsTopic(initialThreadsTopic ?? '');
      setTopicOpen(false);
      setTtPrivacy(initialTtPrivacy ?? '');
      setPrivacyOpen(false);
      setYtPrivacy(initialYtPrivacy ?? 'public');
      setListingOpen(false);
      setSourceUrl(initialSourceUrl ?? '');
      setPreset('now');
      setCustom(new Date(initialAt ?? Date.now() + 86400000));
      setShowPicker(false);
      setMode('date');
    }
  }, [visible, initialAt, initialPlatforms, initialTypes, initialSourceUrl, initialThreadsTopic, initialTtPrivacy, initialYtPrivacy]);

  // TikTok audience options come from the account itself — load them while the
  // sheet is open so the choice can be made upfront instead of at publish.
  useEffect(() => {
    if (!visible) return;
    if (!plats.includes('tiktok') || !connected.includes('tiktok')) return;
    let live = true;
    (async () => {
      try {
        const m = await loadMetaState();
        const token = await getValidToken();
        const ci = await fetchCreatorInfo(token);
        if (!live || !ci.privacyOptions.length) return;
        setTtPrivacyOptions(ci.privacyOptions);
        setTtPrivacy((prev) => {
          if (prev && ci.privacyOptions.includes(prev)) return prev;
          if (m.ttLastPrivacy && ci.privacyOptions.includes(m.ttLastPrivacy)) return m.ttLastPrivacy;
          if (ci.privacyOptions.includes('PUBLIC_TO_EVERYONE')) return 'PUBLIC_TO_EVERYONE';
          return ci.privacyOptions.length === 1 ? ci.privacyOptions[0] : '';
        });
      } catch {}
    })();
    return () => { live = false; };
  }, [visible, plats, connected]);

  const togglePlat = (c: string) => {
    if (c === 'any') {
      // Anywhere ticks every connected channel (selected pill color each),
      // keeping the per-channel post-type rows visible
      setPlats(connected.length > 0 ? [...connected] : ['any']);
      return;
    }
    if ((COMING_SOON as string[]).includes(c)) {
      const label = c[0].toUpperCase() + c.slice(1);
      Alert.alert(`${label} is coming soon`, 'We’re working on it — pick Facebook, Instagram, Threads, TikTok, X, Bluesky, LinkedIn, Mastodon or YouTube for now.');
      return;
    }
    if (c !== 'any' && !connected.includes(c)) {
      const label = SOCIAL_META[c]?.label ?? (c[0].toUpperCase() + c.slice(1));
      Alert.alert(`${label} isn't connected`, `Connect ${label} in Channels first, then pick it here.`);
      return;
    }
    setPlats((prev) => {
      const without = prev.filter((x) => x !== 'any' && x !== c);
      if (prev.includes(c)) return without.length > 0 ? without : ['any'];
      return [...without, c];
    });
  };

  const setType = (c: ChannelKey, t: string) => {
    setTypes((prev) => ({ ...prev, [c]: t }));
  };

  /** Saved types go stale (a draft stored as photo gains a video later) — when
   *  the attachments contradict the pick, the format follows the media so the
   *  TikTok/IG type always matches what's actually attached. */
  const typeFor = (c: ChannelKey): string => {
    const items = media?.items ?? [];
    const hasVideo = items.some((a) => a.kind === 'video');
    const hasImage = items.some((a) => a.kind === 'image');
    const explicit = types[c] as string | undefined;
    if (c === 'tiktok') {
      if (explicit === 'photo' && hasVideo && !hasImage) return 'video';
      if (explicit === 'video' && !hasVideo) return 'photo';
      return explicit ?? defaultPlatformType(c, items);
    }
    if (c === 'instagram') {
      if (explicit === 'post' && hasVideo && !hasImage) return 'reel';
      if (explicit === 'reel' && !hasVideo) return 'post';
      return explicit ?? defaultPlatformType(c, items);
    }
    return explicit ?? defaultPlatformType(c, items);
  };

  /** Materialize a concrete type for every selected channel, including defaults. */
  const finalTypes = (): PlatformTypes => {
    const out: Record<string, string | undefined> = { ...types };
    for (const c of TYPE_CHANNELS) {
      if (plats.includes(c)) out[c] = typeFor(c);
    }
    return out as PlatformTypes;
  };

  const at = preset === 'now' ? Date.now() + 60000 : custom.getTime();

  // Anywhere reads as selected when it literally is, or when every connected
  // channel is ticked (which is what tapping it produces)
  const anyOn = plats.includes('any') || (connected.length > 0 && connected.every((c) => plats.includes(c)));

  // Channel chips: Anywhere first, then connected left, rest after (stable —
  // original order kept inside each group)
  const orderedChannels = ['any', ...CHANNELS.filter((c) => c !== 'any').sort(
    (a, b) => Number(connected.includes(b)) - Number(connected.includes(a)),
  )];

  const onPick = (_e: any, d?: Date) => {
    if (_e?.type === 'dismissed') {
      setShowPicker(false);
      setMode('date');
      setPickingTime(false);
      return;
    }
    if (!d) return;
    setCustom(d);
    // Android: pick date, then reopen for time
    if (Platform.OS === 'android') {
      setShowPicker(false);
      if (mode === 'date') {
        setMode('time');
        setTimeout(() => setShowPicker(true), 200);
      } else {
        setMode('date');
      }
    }
  };

  const save = () => {
    if (at <= Date.now() + 30000) {
      Alert.alert('Pick a future time', 'Reminders can only fire in the future.');
      return;
    }
    onSave(at, plats, finalTypes(), sourceUrl.trim(), threadsTopic.trim() || undefined, ttPrivacy || undefined, ytPrivacy || undefined);
  };

  /** Delete asks twice — queue removals can't be undone. */
  const confirmDelete = () => {
    if (!onDelete) return;
    Alert.alert('Delete this post?', 'It will be removed from the queue.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => Alert.alert('Are you sure?', 'This cannot be undone.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Yes, delete', style: 'destructive', onPress: () => onDelete() },
        ]),
      },
    ]);
  };

  return (
  <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={st.bg}>
        {/* backdrop tap-to-close sits BEHIND the sheet — no pressable may wrap
            the ScrollView or Android drags die in responder negotiation */}
        <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <View style={st.sheet}>
          <ScrollView nestedScrollEnabled style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} keyboardShouldPersistTaps="handled">
          <Text style={st.title}>{title ?? 'Add to queue'}</Text>
          {readOnly && readOnlyNote ? <Text style={st.sentNote}>✓ {readOnlyNote}</Text> : null}

          {composer ? (
            <View style={st.post}>
              {readOnly ? (
                <>
                  <Text style={st.postT} numberOfLines={2}>{composer.title || 'Untitled'}</Text>
                  {composer.caption ? <Text style={st.postCap}>{composer.caption}</Text> : null}
                </>
              ) : (
                <>
                  <Txt
                    value={composer.caption}
                    onChangeText={composer.onCaption}
                    placeholder="Write your post…"
                    multiline
                    style={{ minHeight: 96, textAlignVertical: 'top' }}
                  />
                </>
              )}
            </View>
          ) : null}

          {media ? (
            readOnly ? (
              media.items.length > 0 ? (
                <View>
                  <Text style={st.label}>Photo or video</Text>
                  <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 8, paddingRight: 4 }}>
                    {media.items.map((it, i) => (
                      <TouchableOpacity key={`${it.uri}-${i}`} onPress={() => setViewer(i)} activeOpacity={0.8}>
                        {it.kind === 'video' ? (
                          <View style={[st.thumb, { backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }]}>
                            <Ionicons name="play" size={20} color="#fff" />
                          </View>
                        ) : (
                          <Image source={{ uri: it.uri }} style={st.thumb} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              ) : null
            ) : (
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={st.label}>Photo or video</Text>
                {media.items.length > 0 ? <Text style={st.countT}>{media.items.length}/{MAX_ATTACHMENTS}</Text> : null}
              </View>
              {media.items.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 8, paddingRight: 4 }}>
                  {media.items.map((it, i) => (
                    <View key={`${it.uri}-${i}`}>
                      <TouchableOpacity onPress={() => setViewer(i)} activeOpacity={0.8}>
                        {it.kind === 'video' ? (
                          <View style={[st.thumb, { backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }]}>
                            <Ionicons name="play" size={20} color="#fff" />
                          </View>
                        ) : (
                          <Image source={{ uri: it.uri }} style={st.thumb} />
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => media.onRemove(i)} style={st.thumbX} activeOpacity={0.7}>
                        <Ionicons name="close" size={12} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {media.items.length < MAX_ATTACHMENTS ? (
                    <TouchableOpacity onPress={media.onPick} style={[st.thumb, st.thumbAdd]} activeOpacity={0.7}>
                      <Ionicons name="add" size={22} color={C.accentInk} />
                    </TouchableOpacity>
                  ) : null}
                </ScrollView>
              ) : (
                <View style={{ marginTop: 8 }}>
                  <GhostBtn label="Attach photo or video" onPress={media.onPick} />
                </View>
              )}
              <Text style={st.limitHint}>Instagram · up to 10 photos as a carousel — Facebook · up to 10 photos — TikTok · up to 10 photos or 1 video — Threads · first item only</Text>
            </View>
            )
          ) : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={st.label}>Channels{readOnly ? '' : ' — pick any'}</Text>
            {!readOnly && !(plats.length === 1 && plats[0] === 'any') ? (
              <TouchableOpacity onPress={() => setPlats(['any'])} activeOpacity={0.7}>
                <Text style={st.clearAllT}>Clear all</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {readOnly ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {plats.map((c, i) => (
                  c === 'any' ? (
                    <View key={c} style={[st.stackTile, { backgroundColor: C.card, borderColor: C.lineSoft, marginLeft: i === 0 ? 0 : -8 }]}>
                      <Ionicons name="globe-outline" size={14} color={C.muted} />
                    </View>
                  ) : (
                    <View key={c} style={[st.stackTile, { backgroundColor: SOCIAL_META[c]?.bg ?? C.ink, marginLeft: i === 0 ? 0 : -8 }]}>
                      <SocialGlyph platform={c} size={12} color="#fff" />
                    </View>
                  )
                ))}
              </View>
              <Text style={st.stackNames} numberOfLines={2}>
                {plats.map((c) => (c === 'any' ? 'Anywhere' : c[0].toUpperCase() + c.slice(1))).join('  ·  ')}
              </Text>
            </View>
          ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {orderedChannels.map((c) => {
              const on = c === 'any' ? anyOn : plats.includes(c);
              const soon = (COMING_SOON as string[]).includes(c);
              const label = c === 'any' ? 'Anywhere' : c[0].toUpperCase() + c.slice(1);
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => togglePlat(c)}
                  style={[st.chip, on && { backgroundColor: C.ink, borderColor: C.ink }, soon && { opacity: 0.75 }]}
                  activeOpacity={0.75}
                >
                  {c === 'any' ? (
                    <Ionicons name="globe-outline" size={14} color={on ? C.onInk : C.muted} />
                  ) : (
                    <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: SOCIAL_META[c]?.bg ?? C.ink, alignItems: 'center', justifyContent: 'center' }}>
                      <SocialGlyph platform={c} size={11} color="#fff" />
                    </View>
                  )}
                  <Text style={[st.chipT, on && { color: C.onInk }]}>{label}</Text>
                  {soon ? <Text style={st.soonT}>Soon</Text> : null}
                </TouchableOpacity>
              );
            })}
          </View>
          )}

          {readOnly ? <SentStats remoteIds={remoteIds} /> : null}

          {!readOnly && plats.some((c) => (TYPE_CHANNELS as string[]).includes(c)) ? (
            <View style={{ gap: 10 }}>
              <Text style={st.label}>Post type</Text>
              {TYPE_CHANNELS.filter((c) => plats.includes(c)).map((c) => (
                <View key={c} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: SOCIAL_META[c]?.bg ?? C.ink, alignItems: 'center', justifyContent: 'center' }}>
                      <SocialGlyph platform={c} size={11} color="#fff" />
                    </View>
                    <Text style={st.typeLabel}>{c[0].toUpperCase() + c.slice(1)}</Text>
                    {c === 'threads' ? (
                      <TouchableOpacity onPress={() => setTopicOpen((v) => !v)} style={st.topicLink} activeOpacity={0.7}>
                        <Text style={st.topicLinkT} numberOfLines={1}>{threadsTopic || 'Community or topic'}</Text>
                        <Text style={st.topicChev}>›</Text>
                      </TouchableOpacity>
                    ) : null}
                    {c === 'tiktok' ? (
                      <TouchableOpacity onPress={() => setPrivacyOpen((v) => !v)} style={st.topicLink} activeOpacity={0.7}>
                        <Text style={st.topicLinkT} numberOfLines={1}>{ttPrivacy ? (TT_PRIVACY_LABELS[ttPrivacy] ?? ttPrivacy) : 'Audience'}</Text>
                        <Text style={st.topicChev}>›</Text>
                      </TouchableOpacity>
                    ) : null}
                    {c === 'youtube' ? (
                      <TouchableOpacity onPress={() => setListingOpen((v) => !v)} style={st.topicLink} activeOpacity={0.7}>
                        <Text style={st.topicLinkT} numberOfLines={1}>{YT_LISTING.find((o) => o.id === ytPrivacy)?.label ?? 'Listing'}</Text>
                        <Text style={st.topicChev}>›</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {c === 'tiktok' && privacyOpen && ttPrivacyOptions.length > 0 ? (
                    <View style={{ gap: 6 }}>
                      {ttPrivacyOptions.map((o) => (
                        <TouchableOpacity key={o} onPress={() => { setTtPrivacy(o); setPrivacyOpen(false); }} style={[st.typeChip, ttPrivacy === o && { backgroundColor: C.ink, borderColor: C.ink }]} activeOpacity={0.75}>
                          <Text style={[st.typeChipT, ttPrivacy === o && { color: C.onInk }]}>{TT_PRIVACY_LABELS[o] ?? o}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                  {c === 'youtube' && listingOpen ? (
                    <View style={{ gap: 6 }}>
                      {YT_LISTING.map((o) => (
                        <TouchableOpacity key={o.id} onPress={() => { setYtPrivacy(o.id); setListingOpen(false); }} style={[st.typeChip, ytPrivacy === o.id && { backgroundColor: C.ink, borderColor: C.ink }]} activeOpacity={0.75}>
                          <Text style={[st.typeChipT, ytPrivacy === o.id && { color: C.onInk }]}>{o.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                  {c === 'threads' && topicOpen ? (
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Txt value={threadsTopic} onChangeText={(v) => setThreadsTopic(v.slice(0, 50))} placeholder="e.g. Photography" autoCapitalize="none" autoCorrect={false} maxLength={50} returnKeyType="done" onSubmitEditing={() => setTopicOpen(false)} />
                      </View>
                      {threadsTopic ? (
                        <TouchableOpacity onPress={() => setThreadsTopic('')} style={st.topicClear} activeOpacity={0.7}>
                          <Text style={st.topicClearT}>Clear</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {POST_TYPE_OPTIONS[c].map((o) => {
                      const on = typeFor(c) === o.id;
                      return (
                        <TouchableOpacity key={o.id} onPress={() => setType(c, o.id)} style={[st.typeChip, on && { backgroundColor: C.ink, borderColor: C.ink }]} activeOpacity={0.75}>
                          <Text style={[st.typeChipT, on && { color: C.onInk }]}>{o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                </View>
              ))}
            </View>
          ) : null}

          {!readOnly && (
          <>
          <Text style={[st.label, { marginTop: 6 }]}>Time</Text>
          {(
            [
              { id: 'now', label: 'Now', sub: 'Publishes right away' },
              { id: 'custom', label: 'Custom', sub: fmtDateTime(custom.getTime()) },
            ] as const
          ).map((o) => {
            const on = preset === o.id;
            return (
              <TouchableOpacity
                key={o.id}
                onPress={() => {
                  setPreset(o.id);
                  if (o.id === 'custom') {
                    setMode('date');
                    setPickingTime(false);
                    setShowPicker(true);
                  }
                }}
                style={[st.opt, on && { borderColor: C.accent, backgroundColor: C.accentSoft }]}
                activeOpacity={0.75}
              >
                <View style={[st.radio, on && { borderColor: C.accent }]}>
                  {on ? <View style={st.radioOn} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.optT}>{o.label}</Text>
                  <Text style={st.optS}>{o.sub}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          {showPicker && preset === 'custom' ? (
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <DateTimePicker
                value={custom}
                mode={mode}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onPick}
                themeVariant={themeMode}
                textColor={C.ink}
                minimumDate={new Date()}
              />
              {Platform.OS === 'ios' ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  {mode === 'time' ? (
                    <TouchableOpacity onPress={() => { setMode('date'); setPickingTime(false); }} style={st.pickerBack} activeOpacity={0.7}>
                      <Text style={st.pickerBackT}>‹ Back to date</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => {
                      if (mode === 'date') {
                        setMode('time');
                        setPickingTime(true);
                      } else {
                        setShowPicker(false);
                        setPickingTime(false);
                        setMode('date');
                      }
                    }}
                    style={st.pickerDone}
                    activeOpacity={0.7}
                  >
                    <Text style={st.pickerDoneT}>{mode === 'date' ? 'Next: Time' : 'Done'}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={{ marginTop: 10 }}>
            <PrimaryBtn
              icon={preset === 'now' && onPostNow && !bulkCount ? 'send' : undefined}
              label={bulkCount ? `Queue ${bulkCount} page${bulkCount > 1 ? 's' : ''}` : preset === 'now' ? 'Post now' : `Queue for ${fmtDateTime(at)}`}
              loading={preset === 'now' && onPostNow && !bulkCount && !!publishing}
              loadingLabel="Posting…"
              onPress={preset === 'now' && onPostNow && !bulkCount ? () => onPostNow(plats, finalTypes(), sourceUrl.trim(), threadsTopic.trim() || undefined, ttPrivacy || undefined, ytPrivacy || undefined) : save}
            />
          </View>
          </>
          )}
          {/* Publish status mirrored INSIDE the sheet: a stacked modal can fail
              to present over this one, which used to make a failed post look
              like nothing happened at all. Rendered in read-only too, so a
              sent post's "Published" result shows without a second modal. */}
          {statusTitle || (progress && progress.length > 0) ? (
            <View style={st.progress}>
              {statusTitle ? <Text style={st.progressTitle}>{statusTitle}</Text> : null}
              {statusMessage ? <Text style={st.progressMsg}>{statusMessage}</Text> : null}
              {(progress ?? []).map((r) => (
                <View key={r.id} style={st.progressRow}>
                  {r.state === 'working' ? (
                    <ActivityIndicator size="small" color={C.accent} />
                  ) : r.state === 'done' ? (
                    <Ionicons name="checkmark-circle" size={18} color={C.greenText} />
                  ) : r.state === 'fail' ? (
                    <Ionicons name="close-circle" size={18} color={C.redText} />
                  ) : r.state === 'manual' ? (
                    <Ionicons name="globe-outline" size={17} color={C.accentInk} />
                  ) : (
                    <View style={st.progressDot} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={st.progressT}>{r.label}</Text>
                    {r.note ? (
                      <Text style={st.progressNote} selectable>{r.note}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          {((!readOnly && onDraft) || onDelete) ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              {!readOnly && onDraft ? (
                <View style={{ flex: 1 }}>
                  <GhostBtn label={draftLabel ?? 'Save as draft'} onPress={() => onDraft?.(finalTypes(), sourceUrl.trim(), threadsTopic.trim() || undefined, ttPrivacy || undefined, ytPrivacy || undefined)} />
                </View>
              ) : null}
              {onDelete ? (
                <View style={{ flex: 1 }}>
                  <GhostBtn label="Delete" danger onPress={confirmDelete} />
                </View>
              ) : null}
            </View>
          ) : null}
          </ScrollView>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
    <Modal visible={vIdx !== null} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
      {vItem ? (
        <View style={st.viewerBg}>
          <View style={st.viewerBar}>
            <Text style={st.viewerCount}>{(vIdx ?? 0) + 1} / {vCount}</Text>
            <TouchableOpacity onPress={() => setViewer(null)} style={st.viewerMin} activeOpacity={0.7}>
              <Ionicons name="chevron-down" size={18} color="#fff" />
              <Text style={st.viewerMinT}>Minimize</Text>
            </TouchableOpacity>
          </View>
          <View style={st.viewerBody}>
            {vItem.kind === 'video' ? (
              <View style={{ flex: 1, width: '100%' }}>
                <VideoPreview key={vItem.uri} uri={vItem.uri} />
              </View>
            ) : (
              <Image source={{ uri: vItem.uri }} style={st.viewerImg} resizeMode="contain" />
            )}
          </View>
          <View style={st.viewerNav}>
            <TouchableOpacity
              disabled={(vIdx ?? 0) <= 0}
              onPress={() => setViewer(Math.max(0, (vIdx ?? 0) - 1))}
              style={[st.viewerNavBtn, (vIdx ?? 0) <= 0 && st.viewerNavOff]}
              activeOpacity={0.7}
            >
              <Text style={st.viewerNavBtnT}>‹ Prev</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={(vIdx ?? vCount) >= vCount - 1}
              onPress={() => setViewer(Math.min(vCount - 1, (vIdx ?? 0) + 1))}
              style={[st.viewerNavBtn, (vIdx ?? vCount) >= vCount - 1 && st.viewerNavOff]}
              activeOpacity={0.7}
            >
              <Text style={st.viewerNavBtnT}>Next ›</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </Modal>
    </>
  );
}

const makeSt = (C: Palette) => ({
  bg: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' } as const,
  sheet: { backgroundColor: C.paper, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 30, gap: 10, maxHeight: '92%' } as const,
  title: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 18, letterSpacing: -0.3, color: C.ink } as const,
  label: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6 } as const,
  post: { backgroundColor: C.card, borderRadius: R.lg, padding: 12, gap: 8 } as const,
  postT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 15, letterSpacing: -0.2, color: C.ink } as const,
  postCap: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, lineHeight: 20, color: C.ink } as const,
  sentNote: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.accentInk } as const,
  stackTile: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.paper } as const,
  stackNames: { flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.ink } as const,
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card, borderRadius: 999, borderWidth: 1, borderColor: C.lineSoft, paddingHorizontal: 12, paddingVertical: 8 } as const,
  chipT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.ink, textTransform: 'capitalize' } as const,
  soonT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10.5, color: C.accentInk } as const,
  typeLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.ink } as const,
  typeChip: { backgroundColor: C.card, borderRadius: 999, borderWidth: 1, borderColor: C.lineSoft, paddingHorizontal: 14, paddingVertical: 8 } as const,
  typeChipT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.muted } as const,
  topicLink: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 1 } as const,
  topicLinkT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.muted, flexShrink: 1 } as const,
  topicChev: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, lineHeight: 18, color: C.faint } as const,
  topicClear: { backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' } as const,
  topicClearT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.redText } as const,
  clearAllT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.faint } as const,
  countT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.muted } as const,
  limitHint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5, lineHeight: 16, color: C.faint, marginTop: 6 } as const,
  thumb: { width: 64, height: 64, borderRadius: R.md } as const,
  thumbAdd: { backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft, alignItems: 'center', justifyContent: 'center' } as const,
  thumbX: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' } as const,
  viewerBg: { flex: 1, backgroundColor: '#000000EE', paddingTop: 48, paddingBottom: 32, paddingHorizontal: 20 } as const,
  viewerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } as const,
  viewerCount: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' } as const,
  viewerMin: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFFFFF22', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 } as const,
  viewerMinT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' } as const,
  viewerBody: { flex: 1, alignItems: 'center', justifyContent: 'center', marginVertical: 16 } as const,
  viewerImg: { width: '100%', height: '100%' } as const,
  viewerVideo: { alignItems: 'center', justifyContent: 'center', gap: 10 } as const,
  viewerHint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: '#FFFFFFAA', textAlign: 'center' } as const,
  viewerNav: { flexDirection: 'row', gap: 10 } as const,
  viewerNavBtn: { flex: 1, backgroundColor: '#FFFFFF1A', borderRadius: R.md, paddingVertical: 13, alignItems: 'center' } as const,
  viewerNavOff: { opacity: 0.3 } as const,
  viewerNavBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' } as const,
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1.5, borderColor: C.lineSoft, padding: 12 } as const,
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.faint, alignItems: 'center', justifyContent: 'center' } as const,
  radioOn: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent } as const,
  optT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14.5, color: C.ink } as const,
  optS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted, marginTop: 1 } as const,
  progress: { marginTop: 10, backgroundColor: C.card, borderRadius: R.lg, padding: 12, gap: 9 } as const,
  progressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 } as const,
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.faint, marginTop: 5 } as const,
  progressTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.ink } as const,
  progressMsg: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 17, color: C.muted } as const,
  progressT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.ink } as const,
  perfRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: R.lg, padding: 10 } as const,
  perfT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.ink } as const,
  perfS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted, marginTop: 1 } as const,
  perfNote: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5, color: C.faint, marginTop: 1 } as const,
  feedRow: { backgroundColor: C.card, borderRadius: R.lg, padding: 10, gap: 2 } as const,
  feedA: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.ink } as const,
  feedX: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 18, color: C.muted } as const,
  progressNote: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5, lineHeight: 16, color: C.redText } as const,
  mini: { backgroundColor: C.paper, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 } as const,
  miniWide: { backgroundColor: C.card, borderRadius: R.lg, paddingVertical: 11, alignItems: 'center' } as const,
  miniT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.accentInk } as const,
  pickerDone: { backgroundColor: C.accent, borderRadius: R.md, paddingVertical: 12, paddingHorizontal: 28 } as const,
  pickerDoneT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.onInk } as const,
  pickerBack: { backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft, borderRadius: R.md, paddingVertical: 12, paddingHorizontal: 20 } as const,
  pickerBackT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.ink } as const,
});
