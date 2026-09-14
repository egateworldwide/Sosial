import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Dimensions, KeyboardAvoidingView, Platform, NativeScrollEvent, NativeSyntheticEvent, Animated, PanResponder, StatusBar } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { usePost } from '../store/PostContext';
import PostCanvas, { CANVAS_W, CANVAS_SCALE } from '../components/PostCanvas';
import BackgroundPicker from '../components/BackgroundPicker';
import TitleEditor from '../components/TitleEditor';
import PhotoSocialsEditor from '../components/PhotoSocialsEditor';
import ContentEditor from '../components/ContentEditor';
import PageSortList from '../components/PageSortList';
import { saveManagedPost } from '../utils/managed';
import { useTheme, Palette, R } from '../theme';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryBtn, GhostBtn } from '../components/ui';
import { saveProjectPreset } from '../utils/presets';
import { saveProject } from './HomeScreen';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const GAP = 18;

type EditorStep = 'background' | 'content' | 'title' | 'photo' | 'pages';
const STEPS: { id: EditorStep; label: string }[] = [
  { id: 'background', label: 'Background' },
  { id: 'title', label: 'Title' },
  { id: 'photo', label: 'Photo & socials' },
  { id: 'content', label: 'Content' },
  { id: 'pages', label: 'Pages' },
];

export default function EditorScreen({ onExport, onHome, onPosts }: { onExport: () => void; onHome: () => void; onPosts: () => void }) {
  const { C } = useTheme();
  const s = makeS(C);
  const { post, page, pageIndex, setPageIndex, duplicatePage, deletePage, setPageOrder, sizeRatio } = usePost();
  const [step, setStep] = useState<EditorStep>('background');
  const [expanded, setExpanded] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const insets = useSafeAreaInsets();
  const pagerRef = useRef<ScrollView>(null);
  const dragX = useRef(new Animated.Value(0)).current;
  const dragIdR = useRef<string | null>(null);
  const startIdxR = useRef(0);
  const orderR = useRef<string[]>([]);
  const orderCommitR = useRef<(ids: string[]) => void>(setPageOrder);
  orderCommitR.current = setPageOrder;
  const postR = useRef(post);
  postR.current = post;

  const beginPreviewDrag = (id: string) => {
    const p = postR.current;
    if (!p || p.pages.length < 2) return;
    const order = p.pages.map((x) => x.id);
    const idx = order.indexOf(id);
    if (idx < 0) return;
    dragIdR.current = id;
    startIdxR.current = idx;
    orderR.current = order;
    dragX.setValue(0);
    setDragOrder(order);
    setDragging(true);
  };
  const endPreviewDrag = () => {
    const id = dragIdR.current;
    const finalOrder = orderR.current;
    dragIdR.current = null;
    dragX.setValue(0);
    setDragOrder(null);
    setDragging(false);
    if (id && finalOrder.length) orderCommitR.current(finalOrder);
  };

  // PanResponder in a ref — reads from refs, never recreated
  const panRef = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      // Android: let the native touchable receive taps — only steal real drags
      onShouldBlockNativeResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => {
        const id = dragIdR.current;
        return id !== null && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy);
      },
      onPanResponderMove: (_, g) => {
        const id = dragIdR.current;
        if (!id) return;
        dragX.setValue(g.dx);
        const o = orderR.current;
        const cur = o.indexOf(id);
        if (cur < 0) return;
        const snap = (stageWR.current || CANVAS_W * CANVAS_SCALE) + 14;
        const target = Math.max(0, Math.min(o.length - 1, Math.round(startIdxR.current + g.dx / snap)));
        if (target !== cur) {
          const next = [...o];
          const [moved] = next.splice(cur, 1);
          next.splice(target, 0, moved);
          orderR.current = next;
          setDragOrder(next);
        }
      },
      onPanResponderRelease: endPreviewDrag,
      onPanResponderTerminate: endPreviewDrag,
    }),
  ).current;

  // preview scale: identical math in both modes, only the available height differs,
  // so Minimize and Maximize render the exact same canvas at different sizes
  const stageMaxH = expanded ? SCREEN_H * 0.82 : SCREEN_H * 0.34;
  const stageScale = Math.min(CANVAS_SCALE, stageMaxH / (CANVAS_W * sizeRatio));
  const stageW = CANVAS_W * stageScale;
  const stageWR = useRef(stageW);
  stageWR.current = stageW;
  const SNAP = stageW + GAP;
  const multi = (post?.pages.length ?? 0) > 1;

  // keep the pager in sync when pageIndex changes from dots / pages tab / duplicate / delete
  useEffect(() => {
    if (multi && pagerRef.current && !dragging) {
      pagerRef.current.scrollTo({ x: pageIndex * SNAP, animated: false });
    }
  }, [pageIndex, multi, SNAP, dragging]);

  if (!post || !page) return null;

  const pageById = new Map(post.pages.map((x) => [x.id, x]));
  const baseOrder = post.pages.map((x) => x.id);
  const activeOrder = dragOrder ?? baseOrder;
  const shownPages = activeOrder.map((id) => pageById.get(id)).filter((x) => !!x) as typeof post.pages;
  const curPageId = post.pages[pageIndex]?.id;

  const doSave = async () => {
    await saveProject(post);
    Alert.alert('Saved', 'Draft saved on this device.');
  };

  const saveWholePreset = async () => {
    if (!post) return;
    await saveProjectPreset(post);
    Alert.alert('Saved as preset', 'The entire post — size, pages, backdrop, title, photo, socials and content — is now a reusable preset on Home.');
  };

  const sendToPosts = async () => {
    if (!post || !page) return;
    const imageUri = page.blocks.find((b) => b.type === 'image' && b.imageUri)?.imageUri;
    await saveManagedPost({
      id: '',
      title: page.title.text || post.name,
      body: page.caption ?? '',
      imageUri,
      platforms: ['any'],
      createdAt: Date.now(),
    });
    onPosts();
  };

  const onSwipe = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SNAP);
    if (idx >= 0 && idx < post.pages.length && idx !== pageIndex) setPageIndex(idx);
  };

  return (
    <View style={s.screen}>
      <StatusBar backgroundColor={C.bone} barStyle="dark-content" />
      {/* top bar */}
      <View style={s.top}>
        <TouchableOpacity onPress={onHome} activeOpacity={0.7} style={s.topBtn}>
          <Ionicons name="chevron-back" size={20} color={C.ink} />
        </TouchableOpacity>
        <Text style={s.topTitle} numberOfLines={1}>{post.name}</Text>
        <TouchableOpacity onPress={doSave} activeOpacity={0.7} style={s.saveBtn}>
          <Text style={s.saveT}>Save</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onExport} activeOpacity={0.85} style={s.exportBtn}>
          <Ionicons name="arrow-forward" size={16} color={C.onInk} />
          <Text style={s.exportT}>Export</Text>
        </TouchableOpacity>
      </View>

      {/* preview stage — swipeable pager */}
      <View style={[s.stage, expanded && { flex: 1 }]}>
        {multi ? (
          <ScrollView
            ref={pagerRef}
            horizontal
            snapToInterval={SNAP}
            snapToAlignment="start"
            disableIntervalMomentum
            decelerationRate="normal"
            showsHorizontalScrollIndicator={false}
            scrollEnabled={!dragging}
            onMomentumScrollEnd={onSwipe}
            contentContainerStyle={{ alignItems: 'center', gap: GAP, paddingHorizontal: (SCREEN_W - stageW) / 2 }}
          >
            {shownPages.map((p) => (
              <Animated.View
                key={p.id}
                {...panRef.panHandlers}
                style={{
                  width: stageW,
                  opacity: p.id === curPageId ? 1 : 0.4,
                  transform: [{ translateX: dragIdR.current === p.id ? dragX : 0 }, { scale: dragIdR.current === p.id ? 1.04 : 1 }],
                  zIndex: dragIdR.current === p.id ? 10 : 1,
                  elevation: dragIdR.current === p.id ? 8 : 0,
                }}
              >
                    <TouchableOpacity
                      activeOpacity={1}
                      delayLongPress={450}
                      onPress={() => {
                        if (dragIdR.current) return;
                        const pi = post.pages.findIndex((x) => x.id === p.id);
                        if (pi >= 0 && pi !== pageIndex) setPageIndex(pi);
                      }}
                      onLongPress={() => beginPreviewDrag(p.id)}
                    >
                  <PostCanvas page={p} ratio={sizeRatio} scale={stageScale} />
                </TouchableOpacity>
              </Animated.View>
            ))}
          </ScrollView>
        ) : (
          <PostCanvas page={page} ratio={sizeRatio} scale={stageScale} />
        )}

        {/* page dots + counter */}
        <View style={s.dotsRow}>
          <View style={s.dots}>
            {post.pages.map((p) => (
              <TouchableOpacity
                key={p.id}
                onPress={() => {
                  const pi = post.pages.findIndex((x) => x.id === p.id);
                  if (pi >= 0) setPageIndex(pi);
                }}
                style={[s.dot, p.id === curPageId && s.dotOn]}
                activeOpacity={0.7}
              />
            ))}
          </View>
          {multi ? <Text style={s.counter}>{pageIndex + 1} / {post.pages.length}</Text> : null}
        </View>
        <View style={s.stageActions}>
          <TouchableOpacity onPress={duplicatePage} style={s.chip} activeOpacity={0.7}>
            <Text style={s.chipT}>Duplicate page</Text>
          </TouchableOpacity>
          {multi ? (
            <TouchableOpacity onPress={() => deletePage(page.id)} style={[s.chip, { borderColor: '#F0D9DA' }]} activeOpacity={0.7}>
              <Text style={[s.chipT, { color: C.redText }]}>Delete</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => setExpanded((v) => !v)} style={s.chip} activeOpacity={0.7}>
            <Text style={[s.chipT, { fontWeight: '700' }]}>{expanded ? 'Minimize' : 'Maximize'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* sheet */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={expanded ? { height: 50 } : { flex: 1 }}>
        <View style={[s.sheet, expanded && { height: 50 }, { marginBottom: -insets.bottom, paddingBottom: insets.bottom }]}>
          {/* pill tabs */}
          <View style={s.tabsWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              {STEPS.map((t, i) => {
                const on = step === t.id;
                return (
                  <TouchableOpacity key={t.id} onPress={() => setStep(t.id)} style={[s.tab, on && s.tabOn]} activeOpacity={0.8}>
                    <Text style={[s.tabNo, on && s.tabNoOn]}>{String(i + 1).padStart(2, '0')}</Text>
                    <Text style={[s.tabT, on && s.tabTOn]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {!expanded ? (
            <KeyboardAwareScrollView
              style={s.panel}
              contentContainerStyle={{ gap: 18, paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              enableOnAndroid
              extraScrollHeight={100}
            >
              {step === 'pages' ? (
                <>
                  <PrimaryBtn label="Save entire post as preset" onPress={saveWholePreset} />
                  <GhostBtn label="Send this page to Posts" onPress={sendToPosts} />
                  <PageSortList
                    pages={post.pages}
                    currentIndex={pageIndex}
                    onSelect={setPageIndex}
                    onCommit={setPageOrder}
                    onDragChange={setSorting}
                  />
                </>
              ) : null}
              {step === 'background' ? <BackgroundPicker /> : null}
              {step === 'title' ? <TitleEditor /> : null}
              {step === 'photo' ? <PhotoSocialsEditor /> : null}
              {step === 'content' ? <ContentEditor /> : null}
            </KeyboardAwareScrollView>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeS = (C: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bone },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, gap: 10 },
  topBtn: { width: 38, height: 38, borderRadius: R.lg, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, letterSpacing: -0.3, color: C.ink },
  saveBtn: { paddingHorizontal: 14, height: 38, borderRadius: R.lg, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  saveT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.accentInk },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, height: 38, borderRadius: R.lg, backgroundColor: C.accent },
  exportT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 14, color: C.onInk, letterSpacing: -0.2 },

  stage: { justifyContent: 'center', alignItems: 'center', paddingTop: 6, paddingBottom: 10 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 6 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.lineSoft },
  dotOn: { backgroundColor: C.accent },
  counter: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.muted },
  stageActions: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: R.lg, backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft },
  chipT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.accentInk },

  sheet: { flex: 1, backgroundColor: C.paper, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, paddingTop: 6 },
  tabsWrap: { borderBottomWidth: 1, borderBottomColor: C.lineSoft, paddingBottom: 0 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: C.accent },
  tabNo: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.faint },
  tabNoOn: { color: C.accent },
  tabT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.muted, letterSpacing: -0.2 },
  tabTOn: { color: C.ink },
  panel: { flex: 1, paddingHorizontal: 16, paddingTop: 14 },

});
