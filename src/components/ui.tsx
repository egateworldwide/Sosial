import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, TextInputProps, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import FontAwesome6 from '@expo/vector-icons/build/FontAwesome6';
import { Svg, Path } from 'react-native-svg';
import { useTheme, Palette, R } from '../theme';

/** Real brand glyph for a social platform — optically balanced per brand */
const GLYPH_SCALE: Record<string, number> = {
  instagram: 1,
  tiktok: 1.08,
  threads: 1,
  x: 0.92,
  facebook: 1,
  youtube: 0.88,
  whatsapp: 1,
  linkedin: 1,
  pinterest: 1,
  bluesky: 1.05,
  mastodon: 1,
};
export function SocialGlyph({ platform, size = 14, color = '#fff' }: { platform: string; size?: number; color?: string }) {
  const s = size * (GLYPH_SCALE[platform] ?? 1);
  if (platform === 'x') return <FontAwesome6 name="x-twitter" size={s} color={color} />;
  if (platform === 'threads') return <FontAwesome6 name="threads" size={s} color={color} />;
  if (platform === 'mastodon') return <FontAwesome6 name="mastodon" size={s} color={color} />;
  if (platform === 'bluesky') {
    return (
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Path
          d="M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213 24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299-5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782 8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.3-2.777.473-5.899-.308-6.755-3.369C.42 10.04 0 4.615 0 3.883c0-3.67 3.217-2.517 5.202-1.026"
          fill={color}
        />
      </Svg>
    );
  }
  const map: Record<string, any> = {
    instagram: 'logo-instagram',
    tiktok: 'logo-tiktok',
    facebook: 'logo-facebook',
    youtube: 'logo-youtube',
    whatsapp: 'logo-whatsapp',
    linkedin: 'logo-linkedin',
    pinterest: 'logo-pinterest',
  };
  return <Ionicons name={map[platform] ?? 'ellipse'} size={s} color={color} />;
}

/** Numbered editorial section header — "01 · Photo" */
export function Section({ no, title, hint }: { no: string; title: string; hint?: string }) {
  const { C } = useTheme();
  const s = makeS(C);
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text style={s.secNo}>{no}</Text>
        <Text style={s.secTitle}>{title}</Text>
      </View>
      {hint ? <Text style={s.secHint}>{hint}</Text> : null}
    </View>
  );
}

/** Sentence-case field label with optional hint */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const { C } = useTheme();
  const s = makeS(C);
  return (
    <View style={{ gap: 7 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text style={s.label}>{label}</Text>
        {hint ? <Text style={s.hint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** iOS-style segmented control — tonal track, paper thumb with shadow */
export function Seg<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const { C } = useTheme();
  const s = makeS(C);
  return (
    <View style={s.segWrap}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <TouchableOpacity key={o.value} onPress={() => onChange(o.value)} style={[s.seg, on && s.segOn]} activeOpacity={0.8}>
            <Text style={[s.segT, on && s.segTOn]} numberOfLines={1}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Color swatches with offset ink ring when selected (exact dupes collapsed) */
export function Swatches({ colors, value, onChange, size = 30 }: { colors: string[]; value?: string; onChange: (c: string) => void; size?: number }) {
  const { C } = useTheme();
  const s = makeS(C);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const c of colors) {
    const k = c.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(c);
    }
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {unique.map((c) => {
        const on = value?.toLowerCase() === c.toLowerCase();
        return (
          <TouchableOpacity key={c} onPress={() => onChange(c)} activeOpacity={0.7}>
            <View
              style={{
                width: size + 8, height: size + 8, borderRadius: (size + 8) / 2,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: on ? 2 : 0, borderColor: C.ink,
              }}
            >
              <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c, borderWidth: 1, borderColor: '#00000014' }} />
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Round stepper — tap −/+ or tap the number to type a value */
export function Stepper({ value, onChange, step = 1, min = 0, max = 200, format }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; format?: (v: number) => string }) {
  const { C } = useTheme();
  const s = makeS(C);
  const dec = Math.max(0, (String(step).split('.')[1] ?? '').length);
  const round = (v: number) => Number(v.toFixed(dec));
  const clamp = (v: number) => round(Math.min(max, Math.max(min, v)));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    setDraft(null);
    const n = parseFloat(raw.replace(',', '.'));
    if (!isNaN(n)) onChange(clamp(n));
  };
  return (
    <View style={s.stepWrap}>
      <TouchableOpacity onPress={() => onChange(clamp(value - step))} style={s.stepBtn} activeOpacity={0.6}>
        <Text style={s.stepT}>−</Text>
      </TouchableOpacity>
      <TextInput
        value={draft ?? (format ? format(value) : String(value))}
        onChangeText={setDraft}
        onBlur={() => { if (draft !== null) commit(draft); }}
        onSubmitEditing={(e) => commit(e.nativeEvent.text)}
        keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
        returnKeyType="done"
        selectTextOnFocus
        style={s.stepVal}
      />
      <TouchableOpacity onPress={() => onChange(clamp(value + step))} style={s.stepBtn} activeOpacity={0.6}>
        <Text style={s.stepT}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Solid ink press button */
export function PrimaryBtn({ label, onPress }: { label: string; onPress: () => void }) {
  const { C } = useTheme();
  const s = makeS(C);
  return (
    <TouchableOpacity onPress={onPress} style={s.btn} activeOpacity={0.85}>
      <Text style={s.btnT}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Quiet tonal button */
export function GhostBtn({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  const { C } = useTheme();
  const s = makeS(C);
  return (
    <TouchableOpacity onPress={onPress} style={[s.ghost, danger && s.ghostDanger]} activeOpacity={0.8}>
      <Text style={[s.ghostT, danger && { color: C.redText }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Tonal inset text input */
export function Txt(props: TextInputProps) {
  const { C } = useTheme();
  const s = makeS(C);
  return <TextInput {...props} placeholderTextColor={C.faint} style={[s.input, props.multiline && { minHeight: 60, textAlignVertical: 'top' }, props.style as any]} />;
}

/** Native-feel switch */
export function PillToggle({ on, onPress }: { on: boolean; onPress: () => void }) {
  const { C } = useTheme();
  const s = makeS(C);
  return (
    <TouchableOpacity onPress={onPress} style={[s.toggle, on && s.toggleOn]} activeOpacity={0.8}>
      <View style={[s.knob, on && s.knobOn]} />
    </TouchableOpacity>
  );
}

const makeS = (C: Palette) => StyleSheet.create({
  secNo: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11.5, color: C.accent },
  secTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, letterSpacing: -0.3, color: C.ink },
  secHint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, lineHeight: 17, color: C.muted },
  label: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.soft },
  hint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.faint },
  segWrap: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: R.md, padding: 3, gap: 2 },
  seg: { flex: 1, minWidth: 0, paddingVertical: 7.5, paddingHorizontal: 2, alignItems: 'center', borderRadius: R.sm },
  segOn: { backgroundColor: C.paper, shadowColor: '#1C1917', shadowOpacity: 0.12, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  segT: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5, color: C.muted, textAlign: 'center' },
  segTOn: { fontFamily: 'PlusJakartaSans_700Bold', color: C.ink },
  stepWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  stepBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.ink, marginTop: -2 },
  stepVal: { minWidth: 50, flexShrink: 1, textAlign: 'center', fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.ink, fontVariant: ['tabular-nums'] },
  btn: { backgroundColor: C.ink, borderRadius: R.md + 2, minHeight: 46, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  btnT: { fontFamily: 'PlusJakartaSans_700Bold', color: C.onInk, fontSize: 14.5 },
  ghost: { backgroundColor: C.surface, borderRadius: R.md + 2, minHeight: 42, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  ghostDanger: { backgroundColor: C.paleRed },
  ghostT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.ink },
  input: { fontFamily: 'PlusJakartaSans_400Regular', backgroundColor: C.surface, borderRadius: R.md, paddingHorizontal: 13, paddingVertical: 10, fontSize: 14.5, color: C.ink },
  toggle: { width: 50, height: 30, borderRadius: 15, backgroundColor: '#D8D1BF', padding: 2, justifyContent: 'center' },
  toggleOn: { backgroundColor: C.accent, alignItems: 'flex-end' },
  knob: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', shadowColor: '#1C1917', shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  knobOn: { backgroundColor: '#fff' },
});
