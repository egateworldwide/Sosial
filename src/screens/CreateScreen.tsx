import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Modal, TextInput, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R, T } from '../theme';
import { AvatarButton } from '../components/ProfileMenu';
import ConnectButton from '../components/ConnectButton';
import { Txt } from '../components/ui';
import AICopySheet from '../components/AICopySheet';
import { usePost, defaultPage } from '../store/PostContext';
import { QuickPost } from '../types';
import { uid } from '../constants';
import { saveProject, loadProjects, deleteProject, renameProject } from './HomeScreen';
import { loadIdeas, saveIdea, deleteIdea, Idea } from '../utils/ideas';
import PostScreen from './PostScreen';
import { useComposer } from '../store/ComposerContext';
import { MediaAttachment, ManagedPost } from '../utils/managed';
import { joinThread } from '../utils/thread';
import { SocialResult } from '../utils/ai/social';
import { deleteProjectPreset, instantiatePreset, loadProjectPresets, renameProjectPreset,
  saveProjectPreset, ProjectPreset } from '../utils/presets';

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
  const segs = (opts.thread ?? []).map((s) => s.trim()).filter(Boolean);
  const thread = segs.length > 1 ? segs : undefined;
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

function ThreadEditor({ segments, onChange, placeholder = 'Hook…' }: {
  segments: string[];
  onChange: (s: string[]) => void;
  placeholder?: string;
}) {
  const { C } = useTheme();
  const s = makeS(C);
  const segs = segments.length ? segments : [''];
  const setAt = (i: number, v: string) => onChange(segs.map((x, j) => (j === i ? v : x)));
  const add = () => { if (segs.length < 12) onChange([...segs, '']); };
  const remove = (i: number) => { if (segs.length > 1) onChange(segs.filter((_, j) => j !== i)); };
  return (
    <View style={{ gap: 8 }}>
      {segs.map((seg, i) => (
        <View key={i} style={s.segBox}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={s.segLabel}>Post {i + 1}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={[s.segCount, seg.length > THREAD_LIMIT && { color: C.redText }]}>{seg.length}/{THREAD_LIMIT}</Text>
              {segs.length > 1 ? (
                <TouchableOpacity onPress={() => remove(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={15} color={C.faint} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
          <Txt
            value={seg}
            onChangeText={(v) => setAt(i, v)}
            placeholder={i === 0 ? placeholder : 'Next part…'}
            multiline
            style={s.segInput}
          />
        </View>
      ))}
      {segs.length < 12 ? (
        <TouchableOpacity onPress={add} style={s.segAdd} activeOpacity={0.7}>
          <Ionicons name="add" size={15} color={C.accentInk} />
          <Text style={s.segAddT}>Add post</Text>
        </TouchableOpacity>
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
  const { openComposer } = useComposer();
  const [tab, setTab] = useState<'ideas' | 'templates' | 'post'>('ideas');
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [projects, setProjects] = useState<QuickPost[]>([]);
  const [presets, setPresets] = useState<ProjectPreset[]>([]);
  const { post } = usePost();

  // idea composer
  const [cTitle, setCTitle] = useState('');
  const [cBody, setCBody] = useState('');
  const [cMedia, setCMedia] = useState<MediaAttachment | null>(null);
  const [cThread, setCThread] = useState<string[] | null>(null);
  // new-post card
  const [npBody, setNpBody] = useState('');
  const [npMedia, setNpMedia] = useState<MediaAttachment | null>(null);
  const [npThread, setNpThread] = useState<string[] | null>(null);
  // idea editor
  const [editing, setEditing] = useState<Idea | null>(null);
  const [eTitle, setETitle] = useState('');
  const [eBody, setEBody] = useState('');
  const [eMedia, setEMedia] = useState<MediaAttachment | null>(null);
  const [eThread, setEThread] = useState<string[] | null>(null);
  // AI sheet routing
  const [ai, setAi] = useState<{ target: 'idea' | 'editor' | 'newpost'; prompt: string } | null>(null);
  // design/template menus
  const [menu, setMenu] = useState<{ kind: 'project'; item: QuickPost } | { kind: 'preset'; tpl: ProjectPreset } | null>(null);
  const [renaming, setRenaming] = useState<{ kind: 'project' | 'preset'; id: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const reload = () => {
    loadIdeas().then(setIdeas);
    loadProjects().then(setProjects);
    loadProjectPresets().then(setPresets);
  };

  useEffect(() => {
    if (postSignal > 0) {
      setTab('post');
      onConsumePostSignal();
    }
  }, [postSignal]);

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
    if (target === 'idea') {
      if (asThread) { setCThread(r.thread); setCBody(joinThread(r.thread)); }
      else { setCThread(null); setCBody(r.caption + tags); }
      if (!cTitle.trim()) setCTitle(head);
    } else if (target === 'editor') {
      if (asThread) { setEThread(r.thread); setEBody(joinThread(r.thread)); }
      else { setEThread(null); setEBody(r.caption + tags); }
      if (!eTitle.trim()) setETitle(head);
    } else if (target === 'newpost') {
      if (asThread) { setNpThread(r.thread); setNpBody(joinThread(r.thread)); }
      else { setNpThread(null); setNpBody(r.caption + tags); }
    }
    setAi(null);
  };

  /* ---------------- ideas ---------------- */

  const saveNewIdea = async () => {
    const segs = (cThread ?? []).map((x) => x.trim()).filter(Boolean);
    const thread = segs.length > 1 ? segs : undefined;
    const body = thread ? joinThread(thread) : cBody;
    if (!cTitle.trim() && !body.trim() && !cMedia) return;
    await saveIdea({
      title: cTitle.trim() || (body.split('\n')[0] || '').slice(0, 60) || 'Untitled idea',
      body,
      imageUri: cMedia?.kind === 'image' ? cMedia.uri : undefined,
      videoUri: cMedia?.kind === 'video' ? cMedia.uri : undefined,
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
    setEMedia(idea.imageUri ? { uri: idea.imageUri, kind: 'image' } : idea.videoUri ? { uri: idea.videoUri, kind: 'video' } : null);
    setEThread(idea.thread && idea.thread.length > 1 ? [...idea.thread] : null);
  };

  const saveEditor = async () => {
    if (!editing) return;
    const segs = (eThread ?? []).map((x) => x.trim()).filter(Boolean);
    const thread = segs.length > 1 ? segs : undefined;
    await saveIdea({
      ...editing,
      title: eTitle.trim() || 'Untitled idea',
      body: thread ? joinThread(thread) : eBody,
      imageUri: eMedia?.kind === 'image' ? eMedia.uri : undefined,
      videoUri: eMedia?.kind === 'video' ? eMedia.uri : undefined,
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
    const media = ideaMedia(idea);
    openComposer(draftPost({ body: idea.body, media: media[0] ?? null, thread: idea.thread ?? null }));
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

  /* ---------------- new-post card ---------------- */

  const continueNewPost = () => {
    const media = npMedia;
    if (!npBody.trim() && !media && !(npThread ?? []).some((x) => x.trim())) {
      Alert.alert('Nothing to post', 'Write something or attach a photo/video first.');
      return;
    }
    openComposer(draftPost({ body: npBody, media, thread: npThread }));
  };

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
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
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

        {/* section tabs */}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 24, marginTop: 16 }}>
          {(['ideas', 'templates', 'post'] as const).map((t) => {
            const on = tab === t;
            return (
              <TouchableOpacity key={t} onPress={() => setTab(t)} style={[s.tab, on && { backgroundColor: C.ink, borderColor: C.ink }]} activeOpacity={0.75}>
                <Text style={[s.tabT, on && { color: C.onInk }]}>{t === 'ideas' ? 'Ideas' : t === 'templates' ? 'Templates' : 'Post'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {tab === 'ideas' ? (
          <View style={{ paddingHorizontal: 24, marginTop: 14 }}>
            {/* inline composer */}
            <View style={s.composer}>
              <Txt value={cTitle} onChangeText={setCTitle} placeholder="Idea title…" style={s.cTitle} />
              {cThread ? (
                <ThreadEditor segments={cThread} onChange={setCThread} />
              ) : (
                <Txt value={cBody} onChangeText={setCBody} placeholder="Describe the idea…" multiline style={{ minHeight: 56, textAlignVertical: 'top' }} />
              )}
              {cMedia ? <MediaThumb media={cMedia} style={s.cImg} /> : null}
              <View style={s.toolRow}>
                <TouchableOpacity onPress={async () => setCMedia(await pickMedia())} style={s.tool} activeOpacity={0.7}>
                  <Ionicons name={cMedia?.kind === 'video' ? 'videocam-outline' : 'image-outline'} size={16} color={C.accentInk} />
                  <Text style={s.toolT}>{cMedia ? 'Change' : 'Photo'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setAi({ target: 'idea', prompt: `${cTitle} ${cBody}`.trim() })} style={s.tool} activeOpacity={0.7}>
                  <Ionicons name="sparkles" size={15} color={C.accentInk} />
                  <Text style={s.toolT}>AI</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setCThread(cThread ? null : ['', ''])} style={[s.tool, cThread && s.toolOn]} activeOpacity={0.7}>
                  <Ionicons name="chatbubbles-outline" size={15} color={cThread ? C.onInk : C.accentInk} />
                  <Text style={[s.toolT, cThread && { color: C.onInk }]}>Thread</Text>
                </TouchableOpacity>
                {cMedia ? (
                  <TouchableOpacity onPress={() => setCMedia(null)} style={s.tool} activeOpacity={0.7}>
                    <Text style={[s.toolT, { color: C.redText }]}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
                <View style={{ flex: 1 }} />
                <TouchableOpacity onPress={saveNewIdea} style={s.cPost} activeOpacity={0.8}>
                  <Text style={s.cPostT}>Save idea</Text>
                </TouchableOpacity>
              </View>
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
                        <View style={s.badge}><Ionicons name="chatbubbles" size={11} color={C.accentInk} /></View>
                      ) : null}
                    </View>
                    {idea.body && !isThreadIdea ? <Text style={s.cardB} numberOfLines={4}>{idea.body}</Text> : null}
                    {isThreadIdea ? <Text style={s.cardB} numberOfLines={3}>{idea.thread![0]}</Text> : null}
                    {media[0] ? <MediaThumb media={media[0]} style={s.cardImg} /> : null}
                    <View style={s.cardActions}>
                      <TouchableOpacity onPress={() => designIdea(idea)} style={s.designBtn} activeOpacity={0.8}>
                        <Ionicons name="color-palette-outline" size={15} color={C.onInk} />
                        <Text style={s.designBtnT}>Design</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => postFromIdea(idea)} style={s.postBtn} activeOpacity={0.8}>
                        <Ionicons name={isThreadIdea ? 'chatbubbles-outline' : 'send-outline'} size={15} color={C.ink} />
                        <Text style={s.postBtnT}>{isThreadIdea ? 'Thread' : 'Post'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setAi({ target: 'editor', prompt: idea.body || idea.title })} style={s.postBtn} activeOpacity={0.8}>
                        <Ionicons name="sparkles-outline" size={15} color={C.ink} />
                        <Text style={s.postBtnT}>AI</Text>
                      </TouchableOpacity>
                      <View style={{ flex: 1 }} />
                      <TouchableOpacity onPress={() => removeIdea(idea.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Ionicons name="trash-outline" size={18} color={C.faint} />
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
              <View style={{ marginTop: 6 }}>
                {presets.map((tpl, idx) => (
                  <View key={tpl.id} style={s.row}>
                    <TouchableOpacity onPress={() => handleUsePreset(tpl)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 }} activeOpacity={0.7}>
                      <Text style={s.idx}>{String(idx + 1).padStart(2, '0')}</Text>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={s.rowT} numberOfLines={1}>{tpl.name}</Text>
                        <Text style={s.rowS}>{tpl.post.sizeId} · {tpl.post.pages.length} page{tpl.post.pages.length > 1 ? 's' : ''}</Text>
                      </View>
                      <View style={s.useBtn}><Text style={s.useBtnT}>Use</Text></View>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setMenu({ kind: 'preset', tpl })} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                      <Ionicons name="ellipsis-horizontal" size={20} color={C.muted} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            <Text style={[s.secT, { marginTop: 26 }]}>Recent</Text>
            {projects.length === 0 ? (
              <Text style={s.hint}>Your recent designs land here.</Text>
            ) : (
              <View style={{ marginTop: 6 }}>
                {projects.map((item, idx) => (
                  <View key={item.id} style={s.row}>
                    <TouchableOpacity onPress={() => onOpenProject(item)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 }} activeOpacity={0.7}>
                      <Text style={s.idx}>{String(idx + 1).padStart(2, '0')}</Text>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={s.rowT} numberOfLines={1}>{item.name}</Text>
                        <Text style={s.rowS}>{item.sizeId} · {item.pages.length} page{item.pages.length > 1 ? 's' : ''} · {fmtDate(item.createdAt)}</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setMenu({ kind: 'project', item })} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                      <Ionicons name="ellipsis-horizontal" size={20} color={C.muted} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={{ paddingHorizontal: 24, marginTop: 14 }}>
            {/* new-post card */}
            <View style={s.newCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <View style={s.miniAvatar}><Text style={s.miniAvatarT}>{initial}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.newCardT}>New post</Text>
                  <Text style={s.newCardS}>Write it, attach, or make it a thread.</Text>
                </View>
                <TouchableOpacity onPress={() => setAi({ target: 'newpost', prompt: npBody })} style={s.aiPill} activeOpacity={0.8}>
                  <Ionicons name="sparkles" size={13} color={C.accentInk} />
                  <Text style={s.aiPillT}>AI</Text>
                </TouchableOpacity>
              </View>

              {npThread ? (
                <ThreadEditor segments={npThread} onChange={setNpThread} placeholder="Hook — start the story…" />
              ) : (
                <Txt value={npBody} onChangeText={setNpBody} placeholder="What do you want to share?" multiline style={{ minHeight: 78, textAlignVertical: 'top' }} />
              )}
              {npMedia ? <MediaThumb media={npMedia} style={s.cImg} /> : null}

              <View style={s.toolRow}>
                <TouchableOpacity onPress={async () => setNpMedia(await pickMedia())} style={s.tool} activeOpacity={0.7}>
                  <Ionicons name="image-outline" size={16} color={C.accentInk} />
                  <Text style={s.toolT}>{npMedia ? 'Change' : 'Photo'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setNpThread(npThread ? null : ['', ''])} style={[s.tool, npThread && s.toolOn]} activeOpacity={0.7}>
                  <Ionicons name="chatbubbles-outline" size={15} color={npThread ? C.onInk : C.accentInk} />
                  <Text style={[s.toolT, npThread && { color: C.onInk }]}>Thread</Text>
                </TouchableOpacity>
                {npMedia ? (
                  <TouchableOpacity onPress={() => setNpMedia(null)} style={s.tool} activeOpacity={0.7}>
                    <Text style={[s.toolT, { color: C.redText }]}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
                <View style={{ flex: 1 }} />
                <TouchableOpacity onPress={continueNewPost} style={s.cPost} activeOpacity={0.85}>
                  <Text style={s.cPostT}>Continue</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={[s.secT, { marginTop: 24 }]}>Queue & sent</Text>
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
                <ThreadEditor segments={eThread} onChange={setEThread} />
              ) : (
                <Txt value={eBody} onChangeText={setEBody} placeholder="Describe the idea…" multiline style={{ minHeight: 90, textAlignVertical: 'top' }} />
              )}
              {eMedia ? <MediaThumb media={eMedia} style={[s.cImg, { marginTop: 8 }]} /> : null}
              <View style={s.toolRow}>
                <TouchableOpacity onPress={async () => setEMedia(await pickMedia())} style={s.tool} activeOpacity={0.7}>
                  <Ionicons name="image-outline" size={16} color={C.accentInk} />
                  <Text style={s.toolT}>{eMedia ? 'Change' : 'Photo'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setAi({ target: 'editor', prompt: eBody || eTitle })} style={s.tool} activeOpacity={0.7}>
                  <Ionicons name="sparkles" size={15} color={C.accentInk} />
                  <Text style={s.toolT}>AI</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setEThread(eThread ? null : ['', ''])} style={[s.tool, eThread && s.toolOn]} activeOpacity={0.7}>
                  <Ionicons name="chatbubbles-outline" size={15} color={eThread ? C.onInk : C.accentInk} />
                  <Text style={[s.toolT, eThread && { color: C.onInk }]}>Thread</Text>
                </TouchableOpacity>
                {eMedia ? (
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
                  <Ionicons name="send-outline" size={16} color={C.ink} />
                  <Text style={s.postBtnT}>Post this idea</Text>
                </TouchableOpacity>
              ) : null}
              {editing ? (
                <TouchableOpacity onPress={() => designIdea(editing)} style={[s.postBtn, { justifyContent: 'center', marginTop: 8, paddingVertical: 14 }]} activeOpacity={0.8}>
                  <Ionicons name="color-palette-outline" size={16} color={C.ink} />
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
  tab: { borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9, backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft },
  tabT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.muted },
  composer: { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.lineSoft, padding: 13, gap: 4 },
  cTitle: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 14 },
  cImg: { width: '100%', height: 150, borderRadius: R.md, marginTop: 8 },
  cAttach: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  cAttachT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.accentInk },
  cPost: { backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 },
  cPostT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.onInk },
  toolRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  toolOn: { backgroundColor: C.ink },
  toolT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.accentInk },
  mediaThumb: { width: '100%', borderRadius: R.md, resizeMode: 'cover' },
  videoThumb: { height: 150, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', gap: 4 },
  videoTag: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: '#fff' },
  segBox: { backgroundColor: C.paper, borderRadius: R.md, borderWidth: 1, borderColor: C.lineSoft, padding: 10, gap: 6, marginTop: 6 },
  segLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, letterSpacing: 0.3, color: C.accentInk },
  segCount: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.faint },
  segInput: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13.5, minHeight: 54, textAlignVertical: 'top' },
  segAdd: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, marginTop: 6 },
  segAddT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.accentInk },
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
  newCard: { backgroundColor: C.paper, borderRadius: R.lg, borderWidth: 1, borderColor: C.lineSoft, padding: 14, gap: 8 },
  newCardT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 15.5, letterSpacing: -0.2, color: C.ink },
  newCardS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.muted, marginTop: 1 },
  aiPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  aiPillT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.accentInk },
  tplCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.accent, borderRadius: R.md + 2, paddingVertical: 16, paddingHorizontal: 20 },
  tplCtaT: { fontFamily: 'PlusJakartaSans_700Bold', color: C.onInk, fontSize: 15 },
  hint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 19, color: C.muted, marginTop: 12 },
  secT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 19, letterSpacing: -0.4, color: C.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  idx: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.accent, width: 24 },
  rowT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15.5, letterSpacing: -0.2, color: C.ink },
  rowS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted },
  useBtn: { backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 8 },
  useBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.onInk },
  sheetBg: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.paper, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30, maxHeight: '92%' },
  sheetT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 17, letterSpacing: -0.3, color: C.ink, marginBottom: 6 },
  shRow: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.lineSoft },
  shRowT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.ink },
  nameInput: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.ink, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.lineSoft, paddingHorizontal: 14, paddingVertical: 12, marginVertical: 10 },
});
