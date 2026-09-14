import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { usePost } from '../store/PostContext';
import { PALETTE } from '../constants';
import { FontId, TitlePosition } from '../types';
import { fontFamily } from '../utils/fonts';
import { useTheme, Palette, R } from '../theme';
import { Field, Seg, Swatches, Stepper, Txt, Section } from './ui';

const FONT_OPTIONS: { value: FontId; label: string }[] = [
  { value: 'jakarta', label: 'Jakarta' },
  { value: 'inter', label: 'Inter' },
  { value: 'space-grotesk', label: 'Space Grotesk' },
  { value: 'playfair', label: 'Playfair' },
  { value: 'crimson', label: 'Crimson' },
  { value: 'system', label: 'System' },
];

export default function TitleEditor() {
  const { C } = useTheme();
  const st = makeSt(C);
  const { page, patchTitle, patchPage } = usePost();
  if (!page) return null;
  const t = page.title;
  return (
    <View style={{ gap: 18 }}>
      {/* 01 · Headline — the main line only */}
      <View style={st.group}>
        <Section no="01" title="Headline" hint="The first thing people read." />
        <Txt value={t.text} onChangeText={(v) => patchTitle({ text: v })} placeholder="Type your headline…" multiline />
        <Field label="Placement">
          <Seg<TitlePosition>
            options={[
              { value: 'top', label: 'Top' },
              { value: 'bottom', label: 'Bottom' },
              { value: 'none', label: 'Hidden' },
            ]}
            value={t.position}
            onChange={(v) => patchTitle({ position: v })}
          />
        </Field>
        <Field label="Alignment">
          <Seg
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Center' },
              { value: 'right', label: 'Right' },
            ]}
            value={t.align}
            onChange={(v) => patchTitle({ align: v as 'left' | 'center' | 'right' })}
          />
        </Field>
      </View>

      {/* 02 · Subtitle — its own copy + sizing */}
      <View style={st.group}>
        <Section no="02" title="Subtitle" hint="A smaller line under the headline." />
        <Txt value={t.subtitle ?? ''} onChangeText={(v) => patchTitle({ subtitle: v })} placeholder="Smaller line under the headline…" multiline />
        <Field label="Subtitle size" hint={`${t.subtitleSize ?? 15}pt`}>
          <Stepper value={t.subtitleSize ?? 15} onChange={(v) => patchTitle({ subtitleSize: v })} step={1} min={8} max={32} format={(v) => `${v}pt`} />
        </Field>
        <Field label="Subtitle ink" hint="Follows the headline font">
          <Swatches colors={PALETTE} value={t.subtitleColor ?? t.color} onChange={(c) => patchTitle({ subtitleColor: c })} />
        </Field>
      </View>

      {/* 03 · Type — font, weight, size */}
      <View style={st.group}>
        <Section no="03" title="Type" hint="Font and weight for both lines." />
        <Field label="Font">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {FONT_OPTIONS.map((f) => {
              const on = t.font === f.value;
              return (
                <TouchableOpacity key={f.value} onPress={() => patchTitle({ font: f.value })} style={[st.fontBtn, on && st.fontBtnOn]} activeOpacity={0.7}>
                  <Text style={[st.fontBtnT, { fontFamily: fontFamily(f.value, 'bold') }, on && st.fontBtnTOn]}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Field>
        <Field label="Weight">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={() => patchTitle({ bold: !t.bold })} style={[st.styleBtn, t.bold && st.styleBtnOn]} activeOpacity={0.7}>
              <Text style={[st.styleB, t.bold && st.styleTOn]}>B</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => patchTitle({ italic: !t.italic })} style={[st.styleBtn, t.italic && st.styleBtnOn]} activeOpacity={0.7}>
              <Text style={[st.styleI, t.italic && st.styleTOn]}>I</Text>
            </TouchableOpacity>
          </View>
        </Field>
        <Field label="Headline size" hint={`${t.size}pt`}>
          <Stepper value={t.size} onChange={(v) => patchTitle({ size: v })} step={2} min={16} max={52} format={(v) => `${v}pt`} />
        </Field>
      </View>

      {/* 04 · Ink — headline color on its own */}
      <View style={st.group}>
        <Section no="04" title="Ink" hint="Headline color." />
        <Swatches colors={PALETTE} value={t.color} onChange={(c) => patchTitle({ color: c })} />
      </View>

      {/* 05 · Caption */}
      <View style={st.group}>
        <Section no="05" title="Caption" hint="Copied to the clipboard when you post." />
        <Txt value={page.caption ?? ''} onChangeText={(v) => patchPage({ caption: v })} placeholder="Description for Facebook / IG…" multiline />
      </View>
    </View>
  );
}

const makeSt = (C: Palette) => StyleSheet.create({
  group: { backgroundColor: C.card, borderRadius: R.lg, padding: 15, gap: 13, borderWidth: 1, borderColor: C.lineSoft },
  fontBtn: { flexGrow: 1, minWidth: '30%', paddingVertical: 11, borderRadius: R.md, alignItems: 'center', backgroundColor: C.paper },
  fontBtnOn: { backgroundColor: C.ink },
  fontBtnT: { fontSize: 12.5, color: C.muted },
  fontBtnTOn: { color: C.onInk },
  styleBtn: { width: 48, height: 48, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper },
  styleBtnOn: { backgroundColor: C.ink },
  styleB: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, color: C.muted },
  styleI: { fontFamily: 'PlusJakartaSans_400Regular', fontStyle: 'italic', fontSize: 17, color: C.muted },
  styleTOn: { color: C.onInk },
});
