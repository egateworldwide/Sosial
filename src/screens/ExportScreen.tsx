import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, Dimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { usePost } from '../store/PostContext';
import PostCanvas, { CANVAS_W } from '../components/PostCanvas';
import { capturePage, saveUrisToGallery, shareSingleFile, saveAllImages } from '../utils/export';
import { genericShare, openSocialApp } from '../utils/socialShare';
import { useTheme, Palette, T, R } from '../theme';
import { SOCIAL_META } from '../constants';
import { SocialGlyph } from '../components/ui';

const PLATFORMS = ['facebook', 'instagram', 'tiktok', 'threads', 'whatsapp'] as const;

export default function ExportScreen({ onBack }: { onBack: () => void }) {
  const { post, sizeRatio } = usePost();
  const { C } = useTheme();
  const s = makeS(C);
  const [busy, setBusy] = useState(false);
  const [savedUris, setSavedUris] = useState<string[]>([]);
  const refs = useRef<any[]>([]);

  const caption = useMemo(() => {
    if (!post) return '';
    return post.pages.map((p) => p.caption).filter(Boolean).join('\n\n') || post.pages[0]?.title.text || '';
  }, [post]);

  if (!post) return null;

  const { width: SCREEN_W } = Dimensions.get('window');
  const pvScale = Math.min(0.66, (SCREEN_W - 96) / CANVAS_W);
  const pvSnap = CANVAS_W * pvScale + 14;

  const captureAll = async (): Promise<string[]> => {
    const uris: string[] = [];
    for (let i = 0; i < post.pages.length; i++) {
      // let AutoFit measure passes + fonts settle so capture matches preview
      await new Promise((r) => setTimeout(r, 700));
      const ref = refs.current[i];
      if (!ref) continue;
      const uri = await capturePage(ref, `p${i}`);
      uris.push(uri);
    }
    return uris;
  };

  const onSaveAll = async () => {
    setBusy(true);
    try {
      const uris = await saveAllImages(refs.current, post, sizeRatio);
      setSavedUris(uris);
      await saveUrisToGallery(uris);
    } catch (e: any) {
      Alert.alert('Save failed', e?.message ?? 'Could not capture pages.');
    } finally {
      setBusy(false);
    }
  };

  const onSaveOne = async (index: number) => {
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 700));
      const uri = await capturePage(refs.current[index], `p${index}`);
      const uris = [...savedUris];
      uris[index] = uri;
      setSavedUris(uris);
      await saveUrisToGallery([uri]);
      Alert.alert('Saved', `Page ${index + 1} saved to your photo library.`);
    } catch (e: any) {
      Alert.alert('Save failed', e?.message ?? 'Could not capture page.');
    } finally {
      setBusy(false);
    }
  };

  const onShareFile = async (index: number) => {
    setBusy(true);
    try {
      let uris = savedUris;
      if (!uris[index]) {
        uris = await captureAll();
        setSavedUris(uris);
      }
      await genericShare(post.pages[index]?.title.text ?? post.name, post.pages[index]?.caption ?? '');
      await shareSingleFile(uris[index]);
    } finally {
      setBusy(false);
    }
  };

  const ensureSaved = async () => {
    if (savedUris.length === 0) {
      setBusy(true);
      try {
        const uris = await captureAll();
        setSavedUris(uris);
        await saveUrisToGallery(uris);
      } finally {
        setBusy(false);
      }
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bone }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={onBack} activeOpacity={0.7} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color={C.ink} />
        </TouchableOpacity>

        <Text style={s.kicker}>Step 6 of 6</Text>
        <Text style={[T.h1, { color: C.ink, marginTop: 8, fontSize: 30, lineHeight: 36 }]} numberOfLines={1}>{post.name}</Text>
        <Text style={[T.small, { color: C.muted, marginTop: 6, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13 }]}>
          {post.pages.length} image{post.pages.length > 1 ? 's' : ''} ready to save and post.
        </Text>

        {/* hidden renderers for capture */}
        <View style={{ position: 'absolute', left: -9999, top: 0, opacity: 0, pointerEvents: 'none' }}>
          {post.pages.map((p, i) => (
            <View key={p.id} style={{ width: 340, height: 340 * sizeRatio, overflow: 'visible' }}>
              <PostCanvas ref={(r) => { refs.current[i] = r; }} page={p} ratio={sizeRatio} />
            </View>
          ))}
        </View>

        {/* previews — one snap per swipe, scaled to fit with a peek of next */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={pvSnap}
          snapToAlignment="start"
          disableIntervalMomentum
          decelerationRate="normal"
          contentContainerStyle={{ gap: 14, marginTop: 22, paddingRight: 24 }}
        >
          {post.pages.map((p, i) => (
            <View key={p.id} style={{ gap: 10 }}>
              <View style={s.numBadge}><Text style={s.numBadgeT}>{String(i + 1).padStart(2, '0')}</Text></View>
              <View style={s.previewCard}>
                <PostCanvas page={p} ratio={sizeRatio} scale={pvScale} />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity onPress={() => onSaveOne(i)} style={s.saveMini} disabled={busy} activeOpacity={0.8}>
                  <Text style={s.saveMiniT}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => onShareFile(i)} style={s.shareMini} disabled={busy} activeOpacity={0.8}>
                  <Text style={s.shareMiniT}>Share page {i + 1}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>

        <TouchableOpacity onPress={onSaveAll} style={s.save} disabled={busy} activeOpacity={0.88}>
          {busy ? <ActivityIndicator color={C.onInk} /> : (
            <>
              <Text style={s.saveT}>Save all to device</Text>
              <Ionicons name="download-outline" size={18} color={C.onInk} />
            </>
          )}
        </TouchableOpacity>

        {/* share targets */}
        <Text style={[s.secT, { marginTop: 32 }]}>Post it</Text>
        <View style={s.list}>
          {PLATFORMS.map((platform, i) => (
            <TouchableOpacity
              key={platform}
              style={[s.row, i > 0 && s.rowDiv]}
              disabled={busy}
              activeOpacity={0.7}
              onPress={async () => { await ensureSaved(); openSocialApp(platform, post.name, caption); }}
            >
              <View style={[s.dot, { backgroundColor: SOCIAL_META[platform]?.bg ?? C.ink }]}>
                <SocialGlyph platform={platform} size={15} color="#fff" />
              </View>
              <Text style={s.rowT}>{SOCIAL_META[platform]?.label ?? platform}</Text>
              <Text style={s.chev}>›</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[s.row, s.rowDiv]} onPress={() => genericShare(post.name, caption)} activeOpacity={0.7}>
            <View style={[s.dot, { backgroundColor: C.ink }]}><Text style={s.dotT}>···</Text></View>
            <Text style={s.rowT}>More options</Text>
            <Text style={s.chev}>›</Text>
          </TouchableOpacity>
        </View>

        {/* explainer */}
        <View style={s.note}>
          <View style={s.noteBar} />
          <View style={{ flex: 1 }}>
            <Text style={s.noteT}>How sharing works</Text>
            <Text style={s.noteS}>
              Images save to your photo library and the caption copies to the clipboard. Open an app, paste the text, attach the images. No accounts, no API keys.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const makeS = (C: Palette) => StyleSheet.create({
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  back: { fontFamily: 'PlusJakartaSans_700Bold', color: C.ink, fontSize: 20, marginTop: -2 },
  kicker: { ...T.tag, color: C.accent, marginTop: 24 },
  numBadge: { alignSelf: 'flex-start', backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  numBadgeT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.onInk },
  previewCard: { borderRadius: R.lg, overflow: 'hidden', backgroundColor: C.paper, shadowColor: '#1C1917', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  shareMini: { backgroundColor: C.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  shareMiniT: { fontFamily: 'PlusJakartaSans_700Bold', color: C.ink, fontSize: 12 },
  saveMini: { backgroundColor: C.accent, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  saveMiniT: { fontFamily: 'PlusJakartaSans_700Bold', color: C.onInk, fontSize: 12 },
  save: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.ink, borderRadius: R.md + 2, paddingVertical: 17, paddingHorizontal: 20, marginTop: 22 },
  saveT: { fontFamily: 'PlusJakartaSans_700Bold', color: C.onInk, fontSize: 15 },
  secT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 19, letterSpacing: -0.4, color: C.ink, marginBottom: 12 },
  list: { backgroundColor: C.card, borderRadius: R.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 16, paddingVertical: 14 },
  rowDiv: { borderTopWidth: 1, borderTopColor: C.lineSoft },
  dot: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dotT: { color: C.onInk, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12 },
  rowT: { flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, letterSpacing: -0.2, color: C.ink, textTransform: 'capitalize' },
  chev: { fontSize: 20, color: C.faint },
  note: { flexDirection: 'row', gap: 12, marginTop: 28, backgroundColor: C.card, borderRadius: R.lg, padding: 18 },
  noteBar: { width: 4, borderRadius: 2, backgroundColor: C.accent },
  noteT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.ink },
  noteS: { fontFamily: 'PlusJakartaSans_400Regular', color: C.muted, fontSize: 12.5, marginTop: 6, lineHeight: 19 },
});
