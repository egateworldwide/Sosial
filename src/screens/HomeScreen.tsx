import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Modal, TextInput, KeyboardAvoidingView, Platform, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePost } from '../store/PostContext';
import { QuickPost } from '../types';
import { C, T, R } from '../theme';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { deleteProjectPreset, instantiatePreset, loadProjectPresets, renameProjectPreset,
saveProjectPreset, ProjectPreset } from '../utils/presets';
import { loadManagedPosts, ManagedPost } from '../utils/managed';
import { fmtDateTime, platformsLabel } from '../utils/reminders';

const KEY = 'quickpost_projects_v1';

export async function saveProject(p: QuickPost) {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list: QuickPost[] = raw ? JSON.parse(raw) : [];
    const i = list.findIndex((x) => x.id === p.id);
    if (i >= 0) list[i] = p; else list.unshift(p);
    await AsyncStorage.setItem(KEY, JSON.stringify(list.slice(0, 30)));
  } catch {}
}

export async function loadProjects(): Promise<QuickPost[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function deleteProject(id: string) {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list: QuickPost[] = raw ? JSON.parse(raw) : [];
    await AsyncStorage.setItem(KEY, JSON.stringify(list.filter((x) => x.id !== id)));
  } catch {}
}

async function renameProject(id: string, name: string) {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list: QuickPost[] = raw ? JSON.parse(raw) : [];
    const p = list.find((x) => x.id === id);
    if (p) p.name = name;
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}

async function duplicateProject(p: QuickPost): Promise<QuickPost> {
  const copy: QuickPost = {
    ...JSON.parse(JSON.stringify(p)),
    id: `proj_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: `${p.name} copy`,
    createdAt: Date.now(),
  };
  await saveProject(copy);
  return copy;
}

function fmtDate(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function SheetRow({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} style={s.shRow} activeOpacity={0.7}>
      <Text style={[s.shRowT, danger && { color: C.redText }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen({ onNew, onOpen, onQueue, onPrivacy }: { onNew: () => void; onOpen: (p: QuickPost) => void; onQueue: () => void; onPrivacy: () => void }) {
  const [projects, setProjects] = useState<QuickPost[]>([]);
  const [presets, setPresets] = useState<ProjectPreset[]>([]);
  const [managed, setManaged] = useState<ManagedPost[]>([]);
  const { post } = usePost();
  const queued = managed.filter((t) => t.scheduledAt).length;
  const [menu, setMenu] = useState<{ kind: 'project'; item: QuickPost } | { kind: 'preset'; tpl: ProjectPreset } | null>(null);
  const [renaming, setRenaming] = useState<{ kind: 'project' | 'preset'; id: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const reload = () => {
    loadProjects().then(setProjects);
    loadManagedPosts().then(setManaged);
  };
  const upcoming: { key: string; at: number; title: string; sub: string }[] = [];
  managed.forEach((t) => {
    if (t.scheduledAt) {
      upcoming.push({
        key: t.id,
        at: t.scheduledAt,
        title: t.title || 'Untitled',
        sub: platformsLabel(t.platforms ?? ['any']),
      });
    }
  });
  upcoming.sort((a, b) => a.at - b.at);
  const next3 = upcoming.slice(0, 3);
  const reloadPresets = () => loadProjectPresets().then(setPresets);

  useEffect(() => {
    reload();
    reloadPresets();
    if (post) saveProject(post).then(reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = (item: QuickPost) => {
    Alert.alert('Delete project', `Delete "${item.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteProject(item.id).then(reload) },
    ]);
  };

  const handleRename = (item: QuickPost) => {
    setMenu(null);
    setRenameValue(item.name);
    setRenaming({ kind: 'project', id: item.id });
  };

  const commitRename = () => {
    const v = renameValue.trim();
    if (!v || !renaming) return;
    if (renaming.kind === 'project') renameProject(renaming.id, v).then(reload);
    else renameProjectPreset(renaming.id, v).then(setPresets);
    setRenaming(null);
  };

  const presetDelete = (tpl: ProjectPreset) => {
    Alert.alert('Delete template', `Delete "${tpl.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteProjectPreset(tpl.id).then(setPresets) },
    ]);
  };

  const handleDuplicate = async (item: QuickPost) => {
    const copy = await duplicateProject(item);
    reload();
    onOpen(copy);
  };

  const openMenu = (item: QuickPost) => setMenu({ kind: 'project', item });

  const handleSavePreset = async (item: QuickPost) => {
    const next = await saveProjectPreset(item);
    setPresets(next);
    Alert.alert('Saved as template', `"${item.name}" is now a reusable template — size, backdrop, title, photo, socials and content included.`);
  };

  const handleUsePreset = async (tpl: ProjectPreset) => {
    const copy = await instantiatePreset(tpl.id);
    if (!copy) {
      Alert.alert('Template missing', 'Could not load this template.');
      return;
    }
    await saveProject(copy);
    reload();
    onOpen(copy);
  };

  const presetMenu = (tpl: ProjectPreset) => setMenu({ kind: 'preset', tpl });

  return (
    <View style={{ flex: 1, backgroundColor: C.bone }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        {/* masthead */}
        <View style={s.masthead}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Image source={require('../../assets/icon.png')} style={{ width: 26, height: 26, borderRadius: 7 }} />
            <Text style={s.wordmark}>Zap</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={onQueue} activeOpacity={0.8} style={s.queueBtn}>
              <Text style={s.queueBtnT}>Posts{queued > 0 ? ` ${queued}` : ''}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onNew} activeOpacity={0.8} style={s.newBtn}>
              <Text style={s.newBtnT}>+ Design</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* hero — two doors: make images, or manage posts */}
        <View style={{ paddingHorizontal: 24, marginTop: 30 }}>
          <Text style={s.kicker}>Design & schedule</Text>
          <Text style={[T.display, { color: C.ink, marginTop: 12 }]}>
            Create images.{'\n'}Ship posts.
          </Text>
          <Text style={[T.body, { color: C.muted, marginTop: 12, maxWidth: 300 }]}>
            Design scroll-stopping cards, then queue them with captions across every channel.
          </Text>
          <TouchableOpacity onPress={onNew} style={[s.cta, { marginTop: 24 }]} activeOpacity={0.88}>
            <View style={{ gap: 2 }}>
              <Text style={s.ctaT}>Design studio</Text>
              <Text style={s.ctaS}>Infographic images for your feed</Text>
            </View>
            <Ionicons name="arrow-forward" size={19} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={onQueue} style={[s.cta, { backgroundColor: C.accent, marginTop: 12 }]} activeOpacity={0.88}>
            <View style={{ gap: 2 }}>
              <Text style={s.ctaT}>Post manager</Text>
              <Text style={s.ctaS}>{queued > 0 ? `${queued} queued · next ${fmtDateTime(next3[0].at)}` : 'Titles, photos, times — Buffer-style'}</Text>
            </View>
            <Ionicons name="arrow-forward" size={19} color="#fff" />
          </TouchableOpacity>
        </View>

        {next3.length > 0 ? (
          <View style={{ paddingHorizontal: 24, marginTop: 40 }}>
            <View style={s.secHead}>
              <Text style={s.secT}>Up next</Text>
              <Text style={s.secCount}>{String(queued).padStart(2, '0')}</Text>
            </View>
            <View>
              {next3.map((u) => (
                <TouchableOpacity key={u.key} onPress={onQueue} style={s.row} activeOpacity={0.7}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.rowT} numberOfLines={1}>{u.title}</Text>
                    <Text style={s.rowS} numberOfLines={1}>{fmtDateTime(u.at)} · {u.sub}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={C.faint} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        {/* templates */}
        <View style={{ paddingHorizontal: 24, marginTop: 40 }}>
          <View style={s.secHead}>
            <Text style={s.secT}>Templates</Text>
            {presets.length > 0 ? <Text style={s.secCount}>{String(presets.length).padStart(2, '0')}</Text> : null}
          </View>
          {presets.length === 0 ? (
            <Text style={s.presetHint}>No templates yet — tap ••• on any design below and choose “Save as template” to reuse its full look: size, backdrop, title, photo, socials and content.</Text>
          ) : (
            <View>
              {presets.map((tpl, idx) => (
                <TouchableOpacity key={tpl.id} onPress={() => handleUsePreset(tpl)} onLongPress={() => presetMenu(tpl)} style={s.row} activeOpacity={0.7}>
                  <Text style={s.idx}>{String(idx + 1).padStart(2, '0')}</Text>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.rowT} numberOfLines={1}>{tpl.name}</Text>
                    <Text style={s.rowS}>{tpl.post.sizeId} · {tpl.post.pages.length} page{tpl.post.pages.length > 1 ? 's' : ''}</Text>
                  </View>
                  <View style={s.useBtn}><Text style={s.useBtnT}>Use</Text></View>
                  <TouchableOpacity onPress={() => presetMenu(tpl)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Ionicons name="ellipsis-horizontal" size={20} color={C.muted} />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* designs */}
        <View style={{ paddingHorizontal: 24, marginTop: 44 }}>
          <View style={s.secHead}>
            <Text style={s.secT}>Your designs</Text>
            <Text style={s.secCount}>{projects.length > 0 ? String(projects.length).padStart(2, '0') : ''}</Text>
          </View>
          {projects.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyStack}>
                <View style={[s.emptyCard, { transform: [{ rotate: '-6deg' }] }]} />
                <View style={[s.emptyCard, s.emptyCardTop, { transform: [{ rotate: '4deg' }] }]} />
              </View>
              <Text style={s.emptyT}>Nothing on the press yet</Text>
              <Text style={s.emptyS}>Image drafts land here. Design your first card above.</Text>
            </View>
          ) : (
            <View>
              {projects.map((item, idx) => (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => onOpen(item)}
                  onLongPress={() => openMenu(item)}
                  style={s.row}
                  activeOpacity={0.7}
                >
                  <Text style={s.idx}>{String(idx + 1).padStart(2, '0')}</Text>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.rowT} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.rowS}>{item.sizeId} · {item.pages.length} page{item.pages.length > 1 ? 's' : ''} · {fmtDate(item.createdAt)}</Text>
                  </View>
                  <TouchableOpacity onPress={() => openMenu(item)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Ionicons name="ellipsis-horizontal" size={20} color={C.muted} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDelete(item)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Text style={s.del}>✕</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Text style={s.hint}>Tip — long-press a design to open, duplicate, rename or delete it.</Text>
          <TouchableOpacity onPress={onPrivacy} activeOpacity={0.7} style={{ marginTop: 26, alignSelf: 'center' }}>
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.faint }}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* action sheet — tap outside, Close, or back button to dismiss */}
      <Modal visible={menu !== null} transparent animationType="fade" onRequestClose={() => setMenu(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setMenu(null)} style={s.sheetBg}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={s.sheet}>
            {menu?.kind === 'project' ? (
              <>
                <Text style={s.sheetT} numberOfLines={1}>{menu.item.name}</Text>
                <SheetRow label="Open" onPress={() => { const it = menu.item; setMenu(null); onOpen(it); }} />
                <SheetRow label="Save as template" onPress={() => { const it = menu.item; setMenu(null); handleSavePreset(it); }} />
                <SheetRow label="Duplicate" onPress={() => { const it = menu.item; setMenu(null); handleDuplicate(it); }} />
                <SheetRow label="Rename" onPress={() => handleRename(menu.item)} />
                <SheetRow label="Delete" danger onPress={() => { const it = menu.item; setMenu(null); handleDelete(it); }} />
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

      {/* rename dialog — centered + keyboard-aware so the field never hides */}
      <Modal visible={renaming !== null} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <TouchableOpacity activeOpacity={1} onPress={() => setRenaming(null)} style={[s.sheetBg, { justifyContent: 'center', paddingHorizontal: 24 }]}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[s.sheet, { borderRadius: R.lg, paddingBottom: 20 }]}>
            <Text style={s.sheetT}>Rename</Text>
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Name"
              placeholderTextColor={C.faint}
              autoFocus
              style={s.nameInput}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <View style={{ flex: 1 }}>
                <TouchableOpacity onPress={() => setRenaming(null)} style={[s.mBtn, { backgroundColor: C.card }]} activeOpacity={0.7}>
                  <Text style={[s.mBtnT, { color: C.ink }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <TouchableOpacity onPress={commitRename} style={[s.mBtn, { backgroundColor: C.accent }]} activeOpacity={0.7}>
                  <Text style={[s.mBtnT, { color: '#fff' }]}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  masthead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 20 },
  mark: { width: 14, height: 14, borderRadius: 4, backgroundColor: C.accent },
  wordmark: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, letterSpacing: -0.4, color: C.ink },
  newBtn: { backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  newBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' },
  queueBtn: { backgroundColor: C.card, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1, borderColor: C.lineSoft },
  queueBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.accentInk },
  kicker: { ...T.tag, color: C.accent },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.ink, borderRadius: R.md + 2, paddingVertical: 17, paddingHorizontal: 20, marginTop: 24 },
  ctaT: { fontFamily: 'PlusJakartaSans_700Bold', color: '#fff', fontSize: 15 },
  ctaS: { fontFamily: 'PlusJakartaSans_400Regular', color: '#ffffffB3', fontSize: 12.5, marginTop: 2 },
  ctaArrow: { fontFamily: 'PlusJakartaSans_400Regular', color: '#fff', fontSize: 18 },
  meta: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.faint, marginTop: 12 },
  secHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', borderBottomWidth: 1.5, borderBottomColor: C.ink, paddingBottom: 10 },
  secT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 19, letterSpacing: -0.4, color: C.ink },
  secCount: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.accent },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: C.line },
  idx: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.accent, width: 24 },
  rowT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15.5, letterSpacing: -0.2, color: C.ink },
  rowS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted },
  useBtn: { backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 8 },
  useBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: '#fff' },
  presetHint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 19, color: C.muted, marginTop: 12 },
  del: { fontSize: 15, color: C.faint },
  hint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.faint, marginTop: 12 },
  empty: { backgroundColor: C.card, borderRadius: R.lg, padding: 28, alignItems: 'center', marginTop: 14 },
  emptyStack: { width: 72, height: 88, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  emptyCard: { position: 'absolute', width: 56, height: 72, borderRadius: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  emptyCardTop: { backgroundColor: C.paper },
  emptyT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.ink },
  emptyS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  stepRow: { flexDirection: 'row', alignItems: 'baseline', gap: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  stepNo: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.faint, width: 22 },
  stepT: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14.5, color: C.ink },
  sheetBg: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.paper, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30 },
  sheetT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 17, letterSpacing: -0.3, color: C.ink, marginBottom: 6 },
  shRow: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.lineSoft },
  shRowT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.ink },
  nameInput: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.ink, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.lineSoft, paddingHorizontal: 14, paddingVertical: 12, marginVertical: 10 },
  mBtn: { borderRadius: R.md, paddingVertical: 13, alignItems: 'center' },
  mBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14 },
});
