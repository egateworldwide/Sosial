import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Modal, TextInput, Image, Dimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R, T } from '../theme';
import { AvatarButton } from '../components/ProfileMenu';
import ConnectButton from '../components/ConnectButton';
import { Txt } from '../components/ui';
import AICopySheet from '../components/AICopySheet';
import { usePost, defaultPage } from '../store/PostContext';
import { CardStyle, QuickPost } from '../types';
import { uid } from '../constants';
import { saveProject, loadProjects, deleteProject, renameProject } from './HomeScreen';
import { loadIdeas, saveIdea, deleteIdea, Idea, ThreadSeg } from '../utils/ideas';
import PostScreen from './PostScreen';
import { ScheduleForm } from '../components/ScheduleSheet';
import { useComposer } from '../store/ComposerContext';
import { MediaAttachment, ManagedPost } from '../utils/managed';
import { joinThread } from '../utils/thread';
import { SocialResult } from '../utils/ai/social';
import { deleteProjectPreset, instantiatePreset, renameProjectPreset,
  saveProjectPreset, seedStarterTemplates, ProjectPreset } from '../utils/presets';
import PostCanvas, { CANVAS_W } from '../components/PostCanvas';
import { POST_SIZES } from '../constants';

const THREAD_LIMIT = 280;

function fmtDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

async function pickMedia(): Promise<MediaAttachment | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.9 });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, kind: a.type === 'video' ? 'video' : 'image' };
}

function ideaMedia(idea: Idea): MediaAttachment[] {
  const out: MediaAttachment[] = [];
  if (idea.imageUri) out.push({ uri: idea.imageUri, kind: 'image' });
  if (idea.videoUri) out.push({ uri: idea.videoUri, kind: 'video' });
  return out;
}

/** Build a fresh (unsaved) post to prefill the composer, so any Create surface
 *  can hand off to the proven scheduling sheet instead of duplicating it. */
function draftPost(opts: { body?: string; media?: MediaAttachment | null; thread?: string[] | null }): ManagedPost {
  const raw = opts.thread ?? [];
  const segs = raw.map((s) => s.trim()).filter(Boolean);
  // A 2+ entry starter (even blank) opens the composer in thread mode.
  const thread = segs.length > 1 ? segs : (raw.length > 1 ? raw : undefined);
  return {
    id: '',
    title: '',
    body: thread ? joinThread(thread) : (opts.body ?? ''),
    attachments: opts.media ? [opts.media] : [],
    thread,
    platforms: [],
    createdAt: Date.now(),
    status: 'draft',
  };
}

function MediaThumb({ media, style }: { media: MediaAttachment; style?: any }) {
  const { C } = useTheme();
  const s = makeS(C);
  if (media.kind === 'video') {
    return (
      <View style={[s.mediaThumb, s.videoThumb, style]}>
        <Ionicons name="play-circle" size={34} color="#fff" />
        <Text style={s.videoTag}>Video</Text>
      </View>
    );
  }
  return <Image source={{ uri: media.uri }} style={[s.mediaThumb, style]} />;
}

/** Masonry column width the miniature canvases lay out against. */
const TPL_COL_W = (Dimensions.get('window').width - 48 - 12) / 2;

/**
 * The saved design itself, truly previewed: a miniature of the real canvas
 * (backdrop, title, blocks, chrome — exactly what export produces). Name +
 * meta + dots below like a project library, no outer card or border.
 */
function TplPost({ post, kind, builtIn, onOpen, onMenu }: {
  post: QuickPost;
  kind: 'Template' | 'Design';
  builtIn?: boolean;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const { C } = useTheme();
  const s = makeS(C);
  const page = post.pages[0];
  if (!page) return null;
  const size = POST_SIZES.find((x) => x.id === post.sizeId);
  return (
    <View style={{ width: TPL_COL_W }}>
      <TouchableOpacity onPress={onOpen} activeOpacity={0.85}>
        <PostCanvas page={page} ratio={size?.ratio ?? 1} scale={TPL_COL_W / CANVAS_W} watermark={false} />
      </TouchableOpacity>
      <View style={s.tplMeta}>
        <View style={{ flex: 1 }}>
          <Text style={s.tplName} numberOfLines={1}>{post.name}</Text>
          <Text style={s.tplSub} numberOfLines={1}>{kind} · {post.pages.length} page{post.pages.length > 1 ? 's' : ''}</Text>
        </View>
        <TouchableOpacity onPress={onMenu} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.7}>
          <Ionicons name="ellipsis-horizontal" size={18} color={C.ink} />
        </TouchableOpacity>
      </View>
      {builtIn ? (
        <View style={s.tplStarter}><Text style={s.tplStarterT}>STARTER</Text></View>
      ) : null}
    </View>
  );
}

function ThreadEditor({ segments, onChange, pickMedia, placeholder = 'Hook…' }: {
  segments: ThreadSeg[];
  onChange: (s: ThreadSeg[]) => void;
  pickMedia: () => Promise<MediaAttachment | null>;
  placeholder?: string;
}) {
  const { C } = useTheme();
  const s = makeS(C);
  const blank: ThreadSeg = { text: '', media: null };
  const segs = segments.length ? segments : [{ ...blank }];
  const setAt = (i: number, v: string) => onChange(segs.map((x, j) => (j === i ? { ...x, text: v } : x)));
  const add = () => { if (segs.length < 12) onChange([...segs, { ...blank }]); };
  const remove = (i: number) => { if (segs.length > 1) onChange(segs.filter((_, j) => j !== i)); };
  const attach = async (i: number) => {
    const m = await pickMedia();
    if (m) onChange(segs.map((x, j) => (j === i ? { ...x, media: m } : x)));
  };
  const detach = (i: number) => onChange(segs.map((x, j) => (j === i ? { ...x, media: null } : x)));
  return (
    <View style={{ gap: 8 }}>
      {segs.map((seg, i) => (
        <View key={i} style={s.segBox}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={s.segLabel}>Post {i + 1}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {i === 0 ? (
                seg.media ? (
                  <View>
                    {seg.media.kind === 'video' ? (
                      <View style={[s.segThumb, { backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }]}>
                        <Ionicons name="play" size={12} color="#fff" />
                      </View>
                    ) : (
                      <Image source={{ uri: seg.media.uri }} style={s.segThumb} />
                    )}
                    <TouchableOpacity onPress={() => detach(i)} style={s.segThumbX} activeOpacity={0.7} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Ionicons name="close" size={9} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => attach(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="image" size={14} color="rgba(255,255,255,0.45)" />
                  </TouchableOpacity>
                )
              ) : null}
              <Text style={[s.segCount, seg.text.length > THREAD_LIMIT && { color: '#F2A3A3' }]}>{seg.text.length}/{THREAD_LIMIT}</Text>
              {segs.length > 1 ? (
                <TouchableOpacity onPress={() => remove(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={15} color="rgba(255,255,255,0.55)" />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
          <Txt
            value={seg.text}
            onChangeText={(v) => setAt(i, v)}
            placeholder={i === 0 ? placeholder : 'Next part…'}
            multiline
            style={s.segInput}
          />
        </View>
      ))}
      {segs.length < 12 ? (
        <View style={{ alignItems: 'center', marginTop: 2 }}>
          <TouchableOpacity onPress={add} style={s.segPlus} activeOpacity={0.7}>
            <Ionicons name="add" size={17} color={C.accentInk} />
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

function SheetRow({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  const { C } = useTheme();
  const s = makeS(C);
  return (
    <TouchableOpacity onPress={onPress} style={s.shRow} activeOpacity={0.7}>
      <Text style={[s.shRowT, danger && { color: C.redText }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Create tab: ideas + AI writing + templates, with a new-post card up top. */
export default function CreateScreen({ email, team, onProfile, onConnect, onTemplate, onOpenProject, postSignal, onConsumePostSignal }: {
  email: string;
  team: string;
  onProfile: () => void;
  onConnect: () => void;
  onTemplate: () => void;
  onOpenProject: (p: QuickPost) => void;
  postSignal: number;
  onConsumePostSignal: () => void;
}) {
  const { C } = useTheme();
  const s = makeS(C);
  const { openComposer, draftBody, setDraftBody, draftThread, setDraftThread, draftMedia, pickDraftMedia, removeDraftMedia, moveDraftMedia, saveDraftPost, stashDraftPost, postDraftNow, clearDraft, openAi, beginInline, endInline } = useComposer();
  // Fresh inline composer mount (remount resets its channel/schedule picks).
  const [formKey, setFormKey] = useState(0);
  const [tab, setTab] = useState<'ideas' | 'templates' | 'post' | 'publish'>('ideas');
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [projects, setProjects] = useState<QuickPost[]>([]);
  const [presets, setPresets] = useState<ProjectPreset[]>([]);
  const { post } = usePost();

  // idea composer
  const [cTitle, setCTitle] = useState('');
  const [cBody, setCBody] = useState('');
  const [cMedia, setCMedia] = useState<MediaAttachment | null>(null);
  const [cThread, setCThread] = useState<ThreadSeg[] | null>(null);
  // idea editor
  const [editing, setEditing] = useState<Idea | null>(null);
  const [eTitle, setETitle] = useState('');
  const [eBody, setEBody] = useState('');
  const [eMedia, setEMedia] = useState<MediaAttachment | null>(null);
  const [eThread, setEThread] = useState<ThreadSeg[] | null>(null);
  // AI sheet routing (composer AI lives in context; ideas + editor use this one)
  const [ai, setAi] = useState<{ target: 'idea' | 'editor'; prompt: string } | null>(null);
  // design/template menus
  const [menu, setMenu] = useState<{ kind: 'project'; item: QuickPost } | { kind: 'preset'; tpl: ProjectPreset } | null>(null);
  /** Two-column masonry split (even/odd) for the template library grid. */
  const masonry = <T,>(items: T[]): [T[], T[]] => {
    const cols: [T[], T[]] = [[], []];
    items.forEach((it, i) => cols[i % 2].push(it));
    return cols;
  };
  const [renaming, setRenaming] = useState<{ kind: 'project' | 'preset'; id: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const reload = () => {
    loadIdeas().then(setIdeas);
    loadProjects().then(setProjects);
    seedStarterTemplates().then(setPresets);
  };

  useEffect(() => {
    if (postSignal > 0) {
      setTab('post');
      onConsumePostSignal();
    }
  }, [postSignal]);

  // Sheet-gated saves run sheetless while the inline composer is mounted.
  useEffect(() => {
    if (tab !== 'post') return;
    beginInline();
    return () => endInline();
  }, [tab, beginInline, endInline]);

  /** Stored successfully — wipe the page clean for the next post. */
  const resetInline = () => {
    clearDraft();
    setFormKey((k) => k + 1);
  };

  useEffect(() => {
    reload();
    if (post) saveProject(post).then(() => loadProjects().then(setProjects));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- AI apply routing ---------------- */

  const applyAi = (r: SocialResult) => {
    const target = ai?.target;
    const tags = r.hashtags.length ? '\n\n' + r.hashtags.join(' ') : '';
    const asThread = r.thread.length > 1;
    const head = (asThread ? r.thread[0] : r.caption).split('\n')[0].slice(0, 70);
    const toSegs = (t: string[]): ThreadSeg[] => t.map((text) => ({ text, media: null }));
    if (target === 'idea') {
      if (asThread) { setCThread(toSegs(r.thread)); setCBody(joinThread(r.thread)); }
      else { setCThread(null); setCBody(r.caption + tags); }
      if (!cTitle.trim()) setCTitle(head);
    } else if (target === 'editor') {
      if (asThread) { setEThread(toSegs(r.thread)); setEBody(joinThread(r.thread)); }
      else { setEThread(null); setEBody(r.caption + tags); }
      if (!eTitle.trim()) setETitle(head);
    }
    setAi(null);
  };

  /* ---------------- ideas ---------------- */

  /** Live segments (text or media); the head's media doubles as the idea cover. */
  const liveSegs = (t: ThreadSeg[] | null): ThreadSeg[] =>
    (t ?? []).filter((s) => s.text.trim() || s.media);
  const headMediaOf = (segs: ThreadSeg[], fallback: MediaAttachment | null): MediaAttachment | null =>
    segs[0]?.media ?? fallback;

  const saveNewIdea = async () => {
    const live = liveSegs(cThread);
    const thread = live.length > 1 ? live : undefined;
    const texts = live.map((s) => s.text.trim()).filter(Boolean);
    const body = thread ? joinThread(texts) : cBody;
    if (!cTitle.trim() && !body.trim() && !cMedia && !live.some((s) => s.media)) return;
    const head = headMediaOf(live, cMedia);
    await saveIdea({
      title: cTitle.trim() || (body.split('\n')[0] || '').slice(0, 60) || 'Untitled idea',
      body,
      imageUri: head?.kind === 'image' ? head.uri : undefined,
      videoUri: head?.kind === 'video' ? head.uri : undefined,
      thread,
    });
    setCTitle('');
    setCBody('');
    setCMedia(null);
    setCThread(null);
    loadIdeas().then(setIdeas);
  };

  const openEditor = (idea: Idea) => {
    setEditing(idea);
    setETitle(idea.title);
    setEBody(idea.body);
    const isThread = (idea.thread?.length ?? 0) > 1;
    setEMedia(!isThread && idea.imageUri ? { uri: idea.imageUri, kind: 'image' } : !isThread && idea.videoUri ? { uri: idea.videoUri, kind: 'video' } : null);
    setEThread(isThread ? idea.thread!.map((s) => ({ ...s })) : null);
  };

  const saveEditor = async () => {
    if (!editing) return;
    const live = liveSegs(eThread);
    const thread = live.length > 1 ? live : undefined;
    const texts = live.map((s) => s.text.trim()).filter(Boolean);
    const head = headMediaOf(live, eMedia);
    await saveIdea({
      ...editing,
      title: eTitle.trim() || 'Untitled idea',
      body: thread ? joinThread(texts) : eBody,
      imageUri: head?.kind === 'image' ? head.uri : undefined,
      videoUri: head?.kind === 'video' ? head.uri : undefined,
      thread,
    });
    setEditing(null);
    loadIdeas().then(setIdeas);
  };

  const removeIdea = (id: string) => {
    Alert.alert('Delete idea', 'Delete this idea?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteIdea(id).then(setIdeas) },
    ]);
  };

  const postFromIdea = (idea: Idea) => {
    const segs = idea.thread ?? [];
    const texts = segs.map((s) => s.text);
    const head = segs[0]?.media ?? ideaMedia(idea)[0] ?? null;
    const go = () => openComposer(draftPost({
      body: idea.body,
      media: head,
      thread: texts.length > 1 ? texts : null,
    }));
    // Replies publish text-only everywhere — say so instead of dropping
    // their photos silently.
    if (segs.length > 1 && segs.slice(1).some((s) => s.media)) {
      Alert.alert('Heads up', 'Only Post 1’s photo/video can publish in a thread — reply photos stay on the idea.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Post anyway', onPress: go },
      ]);
      return;
    }
    go();
  };

  /** Idea → design studio: reopen the linked project, or spin up a fresh one. */
  const designIdea = async (idea: Idea) => {
    const all = await loadProjects();
    const linked = idea.designProjectId ? all.find((p) => p.id === idea.designProjectId) : undefined;
    if (linked) {
      setEditing(null);
      onOpenProject(linked);
      return;
    }
    const proj: QuickPost = {
      id: uid('post'),
      name: idea.title || 'Untitled',
      sizeId: 'square',
      font: 'jakarta',
      createdAt: Date.now(),
      pages: [defaultPage('jakarta')],
    };
    await saveProject(proj);
    await saveIdea({ ...idea, designProjectId: proj.id });
    setEditing(null);
    loadIdeas().then(setIdeas);
    onOpenProject(proj);
  };

  /* ---------------- post tab entries ---------------- */

  /* ---- templates + designs (from the old library) ---- */

  const handleDeleteProject = (item: QuickPost) => {
    Alert.alert('Delete design', `Delete "${item.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteProject(item.id);
          reload();
        },
      },
    ]);
  };

  const handleDuplicate = async (item: QuickPost) => {
    const copy: QuickPost = {
      ...JSON.parse(JSON.stringify(item)),
      id: uid('post'),
      name: `${item.name} copy`,
      createdAt: Date.now(),
    };
    await saveProject(copy);
    reload();
    onOpenProject(copy);
  };

  const handleSavePreset = async (item: QuickPost) => {
    const next = await saveProjectPreset(item);
    setPresets(next);
    Alert.alert('Saved as template', `"${item.name}" is now reusable — size, backdrop, title, photo, socials and content included.`);
  };

  const handleUsePreset = async (tpl: ProjectPreset) => {
    const copy = await instantiatePreset(tpl.id);
    if (!copy) {
      Alert.alert('Template missing', 'Could not load this template.');
      return;
    }
    await saveProject(copy);
    reload();
    onOpenProject(copy);
  };

  const presetDelete = (tpl: ProjectPreset) => {
    Alert.alert('Delete template', `Delete "${tpl.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteProjectPreset(tpl.id).then(setPresets) },
    ]);
  };

  const commitRename = async () => {
    const v = renameValue.trim();
    if (!v || !renaming) return;
    if (renaming.kind === 'preset') {
      renameProjectPreset(renaming.id, v).then(setPresets);
    } else {
      await renameProject(renaming.id, v);
      loadProjects().then(setProjects);
    }
    setRenaming(null);
  };

  const initial = (email || team || 'Z')[0].toUpperCase();

  return (
    <View style={{ flex: 1, backgroundColor: C.bone }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* masthead */}
        <View style={s.masthead}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Image source={require('../../assets/bolt.png')} style={{ width: 22, height: 28 }} resizeMode="contain" />
            <Text style={s.wordmark}>Sosial</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ConnectButton onPress={onConnect} />
            <AvatarButton email={email} team={team} onPress={onProfile} />
          </View>
        </View>

        <View style={{ paddingHorizontal: 24, marginTop: 22 }}>
          <Text style={[T.h1, { color: C.ink, fontSize: 30, lineHeight: 36 }]}>Create</Text>
          <Text style={s.sub}>Catch the idea, let AI shape it, then post it.</Text>
        </View>

        {/* section tabs — scrolls instead of overflowing on narrow screens */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 20, marginTop: 16 }}>
          {(['ideas', 'templates', 'post', 'publish'] as const).map((t) => {
            const on = tab === t;
            return (
              <TouchableOpacity
                key={t}
                onPress={() => setTab(t)}
                style={[s.tab, on && { backgroundColor: C.ink, borderColor: C.ink }]} activeOpacity={0.75}>
                <Text style={[s.tabT, on && { color: C.onInk }]}>{t === 'ideas' ? 'Ideas' : t === 'templates' ? 'Templates' : t === 'post' ? 'Post' : 'Publish'}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {tab === 'ideas' ? (
          <View style={{ paddingHorizontal: 24, marginTop: 14 }}>
            {/* inline composer */}
            <View style={s.composer}>
              <Txt value={cTitle} onChangeText={setCTitle} placeholder="Idea title…" style={s.cTitle} />
              {cThread ? (
                <ThreadEditor segments={cThread} onChange={setCThread} pickMedia={pickMedia} />
              ) : (
                <Txt value={cBody} onChangeText={setCBody} placeholder="Describe the idea…" multiline style={{ minHeight: 56, textAlignVertical: 'top' }} />
              )}
              {!cThread && cMedia ? <MediaThumb media={cMedia} style={s.cImg} /> : null}
              <View style={s.toolRow}>
                {!cThread ? (
                  <TouchableOpacity onPress={async () => setCMedia(await pickMedia())} style={s.tool} activeOpacity={0.7}>
                    <Ionicons name={cMedia?.kind === 'video' ? 'videocam' : 'image'} size={16} color={C.accentInk} />
                    <Text style={s.toolT}>{cMedia ? 'Change' : 'Photo/video'}</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={() => setAi({ target: 'idea', prompt: `${cTitle} ${cBody}`.trim() })} style={s.tool} activeOpacity={0.7}>
                  <Ionicons name="sparkles" size={15} color={C.accentInk} />
                  <Text style={s.toolT}>AI</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setCThread(cThread ? null : [{ text: '', media: null }, { text: '', media: null }])} style={[s.tool, cThread && s.toolOn]} activeOpacity={0.7}>
                  <Ionicons name="git-branch" size={15} color={cThread ? C.onInk : C.accentInk} />
                  <Text style={[s.toolT, cThread && { color: C.onInk }]}>Thread</Text>
                </TouchableOpacity>
                {!cThread && cMedia ? (
                  <TouchableOpacity onPress={() => setCMedia(null)} style={s.tool} activeOpacity={0.7}>
                    <Text style={[s.toolT, { color: C.redText }]}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <TouchableOpacity onPress={saveNewIdea} style={[s.cPost, s.cPostFull]} activeOpacity={0.8}>
                <Text style={s.cPostT}>Save idea</Text>
              </TouchableOpacity>
            </View>

            {/* feed */}
            <View style={{ gap: 12, marginTop: 14 }}>
              {ideas.map((idea) => {
                const media = ideaMedia(idea);
                const isThreadIdea = (idea.thread?.length ?? 0) > 1;
                return (
                  <TouchableOpacity key={idea.id} onPress={() => openEditor(idea)} style={s.card} activeOpacity={0.8}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                      <View style={s.miniAvatar}>
                        <Text style={s.miniAvatarT}>{initial}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.cardT} numberOfLines={2}>{idea.title}</Text>
                        <Text style={s.cardD}>
                          {fmtDate(idea.createdAt)}
                          {isThreadIdea ? ` · ${idea.thread!.length}-post thread` : ''}
                          {idea.designProjectId ? ' · has design' : ''}
                        </Text>
                      </View>
                      {isThreadIdea ? (
                        <View style={s.badge}><Ionicons name="git-branch" size={11} color={C.accentInk} /></View>
                      ) : null}
                    </View>
                    {idea.body && !isThreadIdea ? <Text style={s.cardB} numberOfLines={4}>{idea.body}</Text> : null}
                    {isThreadIdea ? <Text style={s.cardB} numberOfLines={3}>{idea.thread![0].text}</Text> : null}
                    {media[0] ? <MediaThumb media={media[0]} style={s.cardImg} /> : null}
                    <View style={s.cardActions}>
                      <TouchableOpacity onPress={() => designIdea(idea)} style={s.designBtn} activeOpacity={0.8}>
                        <Ionicons name="color-palette" size={15} color={C.onInk} />
                        <Text style={s.designBtnT}>Design</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => postFromIdea(idea)} style={s.postBtn} activeOpacity={0.8}>
                        <Ionicons name={isThreadIdea ? 'git-branch' : 'send'} size={15} color={C.ink} />
                        <Text style={s.postBtnT}>{isThreadIdea ? 'Thread' : 'Post'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setAi({ target: 'editor', prompt: idea.body || idea.title })} style={s.postBtn} activeOpacity={0.8}>
                        <Ionicons name="sparkles" size={15} color={C.ink} />
                        <Text style={s.postBtnT}>AI</Text>
                      </TouchableOpacity>
                      <View style={{ flex: 1 }} />
                      <TouchableOpacity onPress={() => removeIdea(idea.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Ionicons name="trash" size={18} color={C.faint} />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })}
              {ideas.length === 0 ? (
                <View style={s.empty}>
                  <Text style={s.emptyT}>No ideas yet</Text>
                  <Text style={s.emptyS}>Jot one above, or hit AI and let it write a caption or thread for you.</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : tab === 'templates' ? (
          <View style={{ paddingHorizontal: 24, marginTop: 14 }}>
            <TouchableOpacity onPress={onTemplate} style={s.tplCta} activeOpacity={0.85}>
              <Text style={s.tplCtaT}>+ New template design</Text>
              <Ionicons name="arrow-forward" size={18} color={C.onInk} />
            </TouchableOpacity>
            {presets.length === 0 ? (
              <Text style={s.hint}>No templates yet — tap ••• on any design and choose “Save as template”.</Text>
            ) : (
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                {masonry(presets).map((col, ci) => (
                  <View key={ci} style={{ flex: 1, gap: 20 }}>
                    {col.map((tpl) => (
                      <TplPost
                        key={tpl.id}
                        post={tpl.post}
                        kind="Template"
                        builtIn={tpl.builtIn}
                        onOpen={() => handleUsePreset(tpl)}
                        onMenu={() => setMenu({ kind: 'preset', tpl })}
                      />
                    ))}
                  </View>
                ))}
              </View>
            )}
            <Text style={[s.secT, { marginTop: 26 }]}>Recent</Text>
            {projects.length === 0 ? (
              <Text style={s.hint}>Your recent designs land here.</Text>
            ) : (
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                {masonry(projects).map((col, ci) => (
                  <View key={ci} style={{ flex: 1, gap: 20 }}>
                    {col.map((item) => (
                      <TplPost
                        key={item.id}
                        post={item}
                        kind="Design"
                        onOpen={() => onOpenProject(item)}
                        onMenu={() => setMenu({ kind: 'project', item })}
                      />
                    ))}
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : tab === 'post' ? (
          <View style={{ paddingHorizontal: 20, marginTop: 14 }}>
            {/* The composer itself, inline — no bottom-sheet window. Same form
                and submit paths as the sheet, bound to the live draft. */}
            <ScheduleForm
              key={formKey}
              bare
              visible
              title="New post"
              composer={{ title: '', caption: draftBody, onCaption: setDraftBody, thread: draftThread, onThread: setDraftThread }}
              media={{ items: draftMedia, onPick: pickDraftMedia, onRemove: removeDraftMedia, onMove: moveDraftMedia }}
              onSave={async (at, plats, types, sourceUrl, threadsTopic, ttPrivacy, ytPrivacy) => {
                if (await saveDraftPost(at, plats, types, sourceUrl, threadsTopic, ttPrivacy, ytPrivacy)) resetInline();
              }}
              draftLabel="Save as draft"
              onDraft={async (types, sourceUrl, threadsTopic, ttPrivacy, ytPrivacy) => {
                if (await stashDraftPost(types, sourceUrl, threadsTopic, ttPrivacy, ytPrivacy)) resetInline();
              }}
              onPostNow={async (plats, types, sourceUrl, threadsTopic, ttPrivacy, ytPrivacy) => {
                if (await postDraftNow(plats, types, sourceUrl, threadsTopic, ttPrivacy, ytPrivacy)) resetInline();
              }}
              onClose={() => {}}
              onAi={openAi}
            />
          </View>
        ) : (
          <View style={{ paddingHorizontal: 24, marginTop: 14 }}>
            <PostScreen bare email={email} team={team} onProfile={onProfile} onConnect={onConnect} />
          </View>
        )}
      </ScrollView>

      {/* AI caption/thread writer */}
      <AICopySheet
        visible={ai !== null}
        initialPrompt={ai?.prompt ?? ''}
        onClose={() => setAi(null)}
        onApply={applyAi}
      />

      {/* idea editor */}
      <Modal visible={editing !== null} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setEditing(null)} style={s.sheetBg}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={s.sheet}>
            <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={s.sheetT}>Edit idea</Text>
              <Txt value={eTitle} onChangeText={setETitle} placeholder="Idea title…" style={s.cTitle} />
              <View style={{ height: 8 }} />
              {eThread ? (
                <ThreadEditor segments={eThread} onChange={setEThread} pickMedia={pickMedia} />
              ) : (
                <Txt value={eBody} onChangeText={setEBody} placeholder="Describe the idea…" multiline style={{ minHeight: 90, textAlignVertical: 'top' }} />
              )}
              {!eThread && eMedia ? <MediaThumb media={eMedia} style={[s.cImg, { marginTop: 8 }]} /> : null}
              <View style={s.toolRow}>
                {!eThread ? (
                  <TouchableOpacity onPress={async () => setEMedia(await pickMedia())} style={s.tool} activeOpacity={0.7}>
                    <Ionicons name="image" size={16} color={C.accentInk} />
                    <Text style={s.toolT}>{eMedia ? 'Change' : 'Photo/video'}</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={() => setAi({ target: 'editor', prompt: eBody || eTitle })} style={s.tool} activeOpacity={0.7}>
                  <Ionicons name="sparkles" size={15} color={C.accentInk} />
                  <Text style={s.toolT}>AI</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setEThread(eThread ? null : [{ text: '', media: null }, { text: '', media: null }])} style={[s.tool, eThread && s.toolOn]} activeOpacity={0.7}>
                  <Ionicons name="git-branch" size={15} color={eThread ? C.onInk : C.accentInk} />
                  <Text style={[s.toolT, eThread && { color: C.onInk }]}>Thread</Text>
                </TouchableOpacity>
                {!eThread && eMedia ? (
                  <TouchableOpacity onPress={() => setEMedia(null)} style={s.tool} activeOpacity={0.7}>
                    <Text style={[s.toolT, { color: C.redText }]}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <TouchableOpacity onPress={saveEditor} style={[s.designBtn, { justifyContent: 'center', marginTop: 12, paddingVertical: 15 }]} activeOpacity={0.85}>
                <Text style={s.designBtnT}>Save idea</Text>
              </TouchableOpacity>
              {editing ? (
                <TouchableOpacity onPress={() => postFromIdea(editing)} style={[s.postBtn, { justifyContent: 'center', marginTop: 8, paddingVertical: 14 }]} activeOpacity={0.8}>
                  <Ionicons name="send" size={16} color={C.ink} />
                  <Text style={s.postBtnT}>Post this idea</Text>
                </TouchableOpacity>
              ) : null}
              {editing ? (
                <TouchableOpacity onPress={() => designIdea(editing)} style={[s.postBtn, { justifyContent: 'center', marginTop: 8, paddingVertical: 14 }]} activeOpacity={0.8}>
                  <Ionicons name="color-palette" size={16} color={C.ink} />
                  <Text style={s.postBtnT}>Open in design studio</Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* design/template action sheet */}
      <Modal visible={menu !== null} transparent animationType="fade" onRequestClose={() => setMenu(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setMenu(null)} style={s.sheetBg}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[s.sheet, { paddingBottom: 30 }]}>
            {menu?.kind === 'project' ? (
              <>
                <Text style={s.sheetT} numberOfLines={1}>{menu.item.name}</Text>
                <SheetRow label="Open" onPress={() => { const it = menu.item; setMenu(null); onOpenProject(it); }} />
                <SheetRow label="Save as template" onPress={() => { const it = menu.item; setMenu(null); handleSavePreset(it); }} />
                <SheetRow label="Duplicate" onPress={() => { const it = menu.item; setMenu(null); handleDuplicate(it); }} />
                <SheetRow label="Rename" onPress={() => { const it = menu.item; setMenu(null); setRenameValue(it.name); setRenaming({ kind: 'project', id: it.id }); }} />
                <SheetRow label="Delete" danger onPress={() => { const it = menu.item; setMenu(null); handleDeleteProject(it); }} />
              </>
            ) : null}
            {menu?.kind === 'preset' ? (
              <>
                <Text style={s.sheetT} numberOfLines={1}>{menu.tpl.name}</Text>
                <SheetRow label="Use template" onPress={() => { const t = menu.tpl; setMenu(null); handleUsePreset(t); }} />
                <SheetRow label="Rename" onPress={() => { const t = menu.tpl; setMenu(null); setRenameValue(t.name); setRenaming({ kind: 'preset', id: t.id }); }} />
                <SheetRow label="Delete" danger onPress={() => { const t = menu.tpl; setMenu(null); presetDelete(t); }} />
              </>
            ) : null}
            <SheetRow label="Close" onPress={() => setMenu(null)} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* rename dialog */}
      <Modal visible={renaming !== null} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setRenaming(null)} style={[s.sheetBg, { justifyContent: 'center', paddingHorizontal: 24 }]}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[s.sheet, { borderRadius: R.lg, paddingBottom: 20 }]}>
            <Text style={s.sheetT}>Rename</Text>
            <TextInput value={renameValue} onChangeText={setRenameValue} placeholder="Name" placeholderTextColor={C.faint} autoFocus style={s.nameInput} />
            <TouchableOpacity onPress={commitRename} style={[s.designBtn, { justifyContent: 'center', marginTop: 4, paddingVertical: 14 }]} activeOpacity={0.8}>
              <Text style={s.designBtnT}>Save</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const makeS = (C: Palette) => StyleSheet.create({
  masthead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 20 },
  wordmark: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, letterSpacing: -0.4, color: C.ink },
  sub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6 },
  tab: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft },
  tabT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.muted },
  composer: { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.lineSoft, padding: 13, gap: 4 },
  cTitle: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 14 },
  cImg: { width: '100%', height: 150, borderRadius: R.md, marginTop: 8 },
  cAttach: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  cAttachT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.accentInk },
  cPost: { backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 },
  cPostFull: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, marginTop: 10 },
  cPostT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.onInk },
  toolRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  toolOn: { backgroundColor: C.ink },
  toolT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.accentInk },
  mediaThumb: { width: '100%', borderRadius: R.md, resizeMode: 'cover' },
  videoThumb: { height: 150, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', gap: 4 },
  videoTag: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: '#fff' },
  segBox: { backgroundColor: '#1C1917', borderRadius: R.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', padding: 10, gap: 6, marginTop: 6 },
  segLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, letterSpacing: 0.3, color: 'rgba(255,255,255,0.60)' },
  segCount: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: 'rgba(255,255,255,0.45)' },
  segInput: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13.5, minHeight: 54, textAlignVertical: 'top', color: '#F5F1E8' },
  segPlus: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  segThumb: { width: 34, height: 34, borderRadius: 9 },
  segThumbX: { position: 'absolute', top: -5, right: -5, width: 15, height: 15, borderRadius: 8, backgroundColor: '#000000AA', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: C.paper, borderRadius: R.lg, borderWidth: 1, borderColor: C.lineSoft, padding: 14 },
  miniAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  miniAvatarT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 13, color: C.onInk },
  cardT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 15.5, letterSpacing: -0.2, color: C.ink },
  cardD: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.faint, marginTop: 1 },
  cardB: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13.5, lineHeight: 20, color: C.soft, marginTop: 8 },
  cardImg: { height: 170, marginTop: 10 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  badge: { backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  designBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 17, paddingVertical: 10 },
  designBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.onInk },
  postBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 10 },
  postBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.ink },
  empty: { backgroundColor: C.card, borderRadius: R.lg, padding: 28, alignItems: 'center' },
  emptyT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.ink },
  emptyS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  tplCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.accent, borderRadius: R.md + 2, paddingVertical: 16, paddingHorizontal: 20 },
  tplCtaT: { fontFamily: 'PlusJakartaSans_700Bold', color: C.onInk, fontSize: 15 },
  hint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 19, color: C.muted, marginTop: 12 },
  secT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 19, letterSpacing: -0.4, color: C.ink },
  tplMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  tplName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, letterSpacing: -0.2, color: C.ink },
  tplSub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.muted, marginTop: 1 },
  tplStarter: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tplStarterT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 10, letterSpacing: 0.8, color: '#fff' },
  sheetBg: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.paper, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30, maxHeight: '92%' },
  sheetT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 17, letterSpacing: -0.3, color: C.ink, marginBottom: 6 },
  shRow: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.lineSoft },
  shRowT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.ink },
  nameInput: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.ink, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.lineSoft, paddingHorizontal: 14, paddingVertical: 12, marginVertical: 10 },
});
