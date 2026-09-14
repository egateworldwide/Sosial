import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { usePost } from '../store/PostContext';
import { SocialPlatform, FontId } from '../types';
import { SOCIAL_META, uid, PALETTE } from '../constants';
import { FONTS } from '../utils/fonts';
import { useTheme, Palette, R } from '../theme';
import { Txt, PillToggle, Seg, Field, Stepper, PrimaryBtn, GhostBtn, SocialGlyph, Swatches, Section } from './ui';

const ALL_PLATFORMS: SocialPlatform[] = ['instagram', 'tiktok', 'threads', 'facebook', 'youtube', 'whatsapp'];

export default function PhotoSocialsEditor() {
  const { C } = useTheme();
  const st = makeSt(C);
  const { page, patchPfp, setSocials } = usePost();
  if (!page) return null;
  const p = page.pfp;

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (!res.canceled && res.assets[0]) patchPfp({ uri: res.assets[0].uri });
  };

  const toggle = (platform: SocialPlatform) => {
    const existing = page.socials.find((s) => s.platform === platform);
    if (existing) {
      setSocials(page.socials.map((s) => (s.platform === platform ? { ...s, visible: !s.visible } : s)));
    } else {
      setSocials([...page.socials, { id: uid('s'), platform, handle: '@yourhandle', visible: true, font: 'jakarta', bold: true, italic: false }]);
    }
  };

  const setHandle = (platform: SocialPlatform, handle: string) => {
    setSocials(page.socials.map((s) => (s.platform === platform ? { ...s, handle } : s)));
  };

  const patchSocial = (platform: SocialPlatform, patch: Partial<typeof page.socials[0]>) => {
    setSocials(page.socials.map((s) => (s.platform === platform ? { ...s, ...patch } : s)));
  };

  const visibleSocials = page.socials.filter((s) => s.visible);

  return (
    <View style={{ gap: 22 }}>
      <View style={{ gap: 14 }}>
        <Section no="01" title="Portrait" hint="Your face on the post." />
        {p.uri ? (
          <View style={st.photoCard}>
            <Image source={{ uri: p.uri }} style={{ width: 64, height: 64, borderRadius: p.shape === 'circle' ? 32 : 14 }} />
            <View style={{ flex: 1, gap: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><PrimaryBtn label="Change" onPress={pick} /></View>
                <View style={{ flex: 1 }}><GhostBtn label="Remove" onPress={() => patchPfp({ uri: undefined })} danger /></View>
              </View>
            </View>
          </View>
        ) : (
          <PrimaryBtn label="Choose a profile picture" onPress={pick} />
        )}

        <Field label="Position">
          <Seg options={[{ value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }]} value={p.pfpY} onChange={(v) => patchPfp({ pfpY: v as 'top' | 'bottom' })} />
        </Field>
        <Field label="Alignment">
          <Seg options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} value={p.align} onChange={(v) => patchPfp({ align: v as 'left' | 'center' | 'right' })} />
        </Field>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="Size" hint={`${p.size}px`}>
              <Stepper value={p.size} onChange={(v) => patchPfp({ size: v })} step={4} min={28} max={64} format={(v) => `${v}`} />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Border" hint={`${p.borderW}px`}>
              <Stepper value={p.borderW} onChange={(v) => patchPfp({ borderW: v })} step={1} min={0} max={6} format={(v) => `${v}`} />
            </Field>
          </View>
        </View>
        <Field label="Shape">
          <Seg options={[{ value: 'circle', label: 'Circle' }, { value: 'rounded', label: 'Rounded' }]} value={p.shape} onChange={(v) => patchPfp({ shape: v as 'circle' | 'rounded' })} />
        </Field>
        <Field label="Username" hint="Universal name under your photo.">
          <Txt value={p.username ?? ''} onChangeText={(v) => patchPfp({ username: v })} placeholder="Your name" />
        </Field>
      </View>

      <View style={{ gap: 14 }}>
        <Section no="02" title="Badges" hint="Centered next to your photo on the export." />
        <View style={st.list}>
          {ALL_PLATFORMS.map((pl, i) => {
            const found = page.socials.find((s) => s.platform === pl);
            const on = !!found?.visible;
            return (
              <View key={pl} style={[st.row, i > 0 && st.rowDiv, !on && { opacity: 0.55 }]}>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: SOCIAL_META[pl].bg, alignItems: 'center', justifyContent: 'center' }}>
                  <SocialGlyph platform={pl} size={16} color="#fff" />
                </View>
                <Text style={st.rowT}>{SOCIAL_META[pl].label}</Text>
                <PillToggle on={on} onPress={() => toggle(pl)} />
              </View>
            );
          })}
        </View>

        {visibleSocials.map((s) => (
          <View key={s.id} style={st.handleCard}>
            <Text style={st.hLabel}>{SOCIAL_META[s.platform].label} handle</Text>
            <Txt value={s.handle} onChangeText={(v) => setHandle(s.platform, v)} placeholder="@yourhandle" />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={st.miniLabel}>Font</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                    {(['jakarta', 'inter', 'space-grotesk', 'playfair', 'crimson', 'system'] as FontId[]).map((f) => (
                    <TouchableOpacity key={f} onPress={() => patchSocial(s.platform, { font: f })} style={[st.miniBtn, s.font === f && st.miniBtnOn]} activeOpacity={0.7}>
                      <Text style={[st.miniBtnT, s.font === f && st.miniBtnTOn]}>{FONTS[f].label.slice(0, 4)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={{ gap: 6 }}>
                <Text style={st.miniLabel}>Style</Text>
                <View style={{ flexDirection: 'row', gap: 5 }}>
                  <TouchableOpacity onPress={() => patchSocial(s.platform, { bold: !s.bold })} style={[st.miniToggle, s.bold && st.miniBtnOn]} activeOpacity={0.7}>
                    <Text style={[st.miniBtnT, s.bold && st.miniBtnTOn, { fontFamily: 'PlusJakartaSans_700Bold' }]}>B</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => patchSocial(s.platform, { italic: !s.italic })} style={[st.miniToggle, s.italic && st.miniBtnOn]} activeOpacity={0.7}>
                    <Text style={[st.miniBtnT, s.italic && st.miniBtnTOn, { fontStyle: 'italic' }]}>I</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        ))}

        {visibleSocials.length > 0 ? (
          <View style={{ gap: 14 }}>
            <Field label="Placement">
              <Seg
                options={[
                  { value: 'below', label: 'Below' },
                  { value: 'right', label: 'Right' },
                  { value: 'left', label: 'Left' },
                ]}
                value={p.socialPos ?? 'below'}
                onChange={(v) => patchPfp({ socialPos: v as 'below' | 'right' | 'left' })}
              />
            </Field>
            <View style={st.switchRow}>
              <View>
                <Text style={st.switchT}>Badge background</Text>
                <Text style={st.switchS}>Dark pill behind the icons</Text>
              </View>
              <PillToggle on={p.badgeBg ?? true} onPress={() => patchPfp({ badgeBg: !(p.badgeBg ?? true) })} />
            </View>
            <Field label="Handle ink">
              <Swatches colors={[...PALETTE, '#333333', '#666666', '#999999', '#CCCCCC']} value={p.handleColor} onChange={(c) => patchPfp({ handleColor: c })} />
            </Field>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Field label="Handle size" hint={`${p.handleSize}px`}>
                  <Stepper value={p.handleSize} onChange={(v) => patchPfp({ handleSize: v })} step={0.5} min={6} max={14} format={(v) => `${v}`} />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Icon size" hint={`${p.iconSize}px`}>
                  <Stepper value={p.iconSize} onChange={(v) => patchPfp({ iconSize: v })} step={1} min={12} max={28} format={(v) => `${v}`} />
                </Field>
              </View>
            </View>
            <Field label="Icon style">
              <Seg options={[{ value: 'filled', label: 'Filled' }, { value: 'outline', label: 'Outline' }]} value={p.iconOutline ? 'outline' : 'filled'} onChange={(v) => patchPfp({ iconOutline: v === 'outline' })} />
            </Field>
            <Field label="Layout">
              <Seg options={[{ value: '1', label: 'Single row' }, { value: '2', label: 'Double row' }]} value={String(p.badgeRows)} onChange={(v) => patchPfp({ badgeRows: Number(v) as 1 | 2 })} />
            </Field>
            <Field label="Badge spacing" hint={`${p.socialGap ?? 6}px`}>
              <Stepper value={p.socialGap ?? 6} onChange={(v) => patchPfp({ socialGap: v })} step={1} min={0} max={16} format={(v) => `${v}px`} />
            </Field>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const makeSt = (C: Palette) => StyleSheet.create({
  photoCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.card, borderRadius: R.lg, padding: 14 },
  list: { backgroundColor: C.card, borderRadius: R.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  rowDiv: { borderTopWidth: 1, borderTopColor: C.lineSoft },
  rowT: { flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.ink },
  handleCard: { backgroundColor: C.card, borderRadius: R.lg, padding: 14 },
  hLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.soft, marginBottom: 8 },
  miniLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10.5, color: C.muted },
  miniBtn: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: R.sm, backgroundColor: C.paper },
  miniBtnOn: { backgroundColor: C.ink },
  miniBtnT: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.muted },
  miniBtnTOn: { color: C.onInk },
  miniToggle: { width: 34, height: 30, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, borderRadius: R.lg, paddingHorizontal: 15, paddingVertical: 13 },
  switchT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.ink },
  switchS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.muted, marginTop: 2 },
});
