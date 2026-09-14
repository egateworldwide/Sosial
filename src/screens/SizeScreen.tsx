import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { POST_SIZES } from '../constants';
import { FontId, PostSizeId } from '../types';
import { usePost } from '../store/PostContext';
import { fontFamily } from '../utils/fonts';
import { C, T, R } from '../theme';
import { PrimaryBtn, Txt } from '../components/ui';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { saveProjectPreset } from '../utils/presets';

const FONT_OPTIONS: { value: FontId; label: string }[] = [
  { value: 'jakarta', label: 'Jakarta' },
  { value: 'inter', label: 'Inter' },
  { value: 'space-grotesk', label: 'Space Grotesk' },
  { value: 'playfair', label: 'Playfair' },
  { value: 'crimson', label: 'Crimson' },
  { value: 'system', label: 'System' },
];

export default function SizeScreen({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const { createPost } = usePost();
  const [sizeId, setSizeId] = useState<PostSizeId>('square');
  const [name, setName] = useState('My first post');
  const [font, setFont] = useState<FontId>('jakarta');

  return (
    <View style={{ flex: 1, backgroundColor: C.bone }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 30 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={onBack} activeOpacity={0.7} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Ionicons name="chevron-back" size={18} color={C.ink} />
          <Text style={s.back}>Back</Text>
        </TouchableOpacity>

        <Text style={s.kicker}>Step 1 of 6</Text>
        <Text style={[T.h1, { color: C.ink, marginTop: 8, fontSize: 30, lineHeight: 36 }]}>New post</Text>

        <Text style={s.label}>Post name</Text>
        <Txt value={name} onChangeText={setName} placeholder="Name your post" />

        <Text style={[s.label, { marginTop: 26 }]}>Size</Text>
        <View style={{ gap: 10, marginTop: 4 }}>
          {POST_SIZES.map((sz) => {
            const on = sizeId === sz.id;
            return (
              <TouchableOpacity key={sz.id} onPress={() => setSizeId(sz.id)} style={[s.sizeRow, on && s.sizeRowOn]} activeOpacity={0.75}>
                <View style={[s.thumbWrap, on && s.thumbWrapOn]}>
                  <View style={[s.thumb, { aspectRatio: sz.width / sz.height, backgroundColor: on ? C.accent : C.faint }]} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.rowT}>{sz.label}</Text>
                  <Text style={s.rowS}>{sz.hint}</Text>
                </View>
                <View style={[s.radio, on && s.radioOn]}>{on ? <View style={s.radioDot} /> : null}</View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[s.label, { marginTop: 26 }]}>Content font</Text>
        <Text style={s.sub}>Applied to the title, body text and every block.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {FONT_OPTIONS.map((f) => {
            const on = font === f.value;
            return (
              <TouchableOpacity key={f.value} onPress={() => setFont(f.value)} style={[s.fontBtn, on && s.fontBtnOn]} activeOpacity={0.7}>
                <Text style={[s.fontBtnT, { fontFamily: fontFamily(f.value, 'bold') }, on && s.fontBtnTOn]}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={s.specimen}>
          <Text style={{ fontFamily: fontFamily(font, 'bold'), fontSize: 19, color: C.ink }}>The quick brown fox</Text>
          <Text style={{ fontFamily: fontFamily(font, 'regular'), fontSize: 13.5, color: C.muted, marginTop: 5, lineHeight: 20 }}>jumps over the lazy dog — 0123456789</Text>
        </View>
      </ScrollView>
      <View style={s.footer}>
        <PrimaryBtn label="Continue" onPress={() => { createPost(name.trim() || 'Untitled', sizeId, font); onDone(); }} />
      </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  back: { fontFamily: 'PlusJakartaSans_700Bold', color: C.ink, fontSize: 14 },
  kicker: { ...T.tag, color: C.accent, marginTop: 24 },
  label: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, letterSpacing: -0.2, color: C.ink, marginTop: 18, marginBottom: 8 },
  sub: { fontFamily: 'PlusJakartaSans_400Regular', color: C.muted, fontSize: 12.5, marginBottom: 2 },
  sizeRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.card, borderRadius: R.lg, padding: 14 },
  sizeRowOn: { backgroundColor: C.paper, shadowColor: '#1C1917', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  thumbWrap: { width: 52, height: 52, borderRadius: R.md, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  thumbWrapOn: { backgroundColor: C.accentSoft },
  thumb: { width: 30, borderRadius: 4 },
  rowT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, letterSpacing: -0.2, color: C.ink },
  rowS: { fontFamily: 'PlusJakartaSans_400Regular', color: C.muted, fontSize: 12 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: C.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent },
  fontBtn: { flexGrow: 1, minWidth: '30%', paddingVertical: 12, borderRadius: R.md, alignItems: 'center', backgroundColor: C.card },
  fontBtnOn: { backgroundColor: C.ink },
  fontBtnT: { fontSize: 13, color: C.muted },
  fontBtnTOn: { color: '#fff' },
  specimen: { backgroundColor: C.paper, borderRadius: R.lg, padding: 18, marginTop: 10, shadowColor: '#1C1917', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  footer: { padding: 20, paddingBottom: 26, backgroundColor: C.bone, borderTopWidth: 1, borderTopColor: C.lineSoft },
});
