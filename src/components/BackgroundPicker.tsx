import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { usePost } from '../store/PostContext';
import { PALETTE, BG_PRESETS, uid } from '../constants';
import { BgPreset, loadCustomBgPresets, saveCustomBgPreset, deleteCustomBgPreset } from '../utils/presets';
import { BgType } from '../types';
import { C, R } from '../theme';
import { Field, Swatches, Stepper, PrimaryBtn, PillToggle, Section, Txt } from './ui';

const TYPES: { value: BgType; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dots', label: 'Dots' },
  { value: 'grid', label: 'Grid' },
  { value: 'stripes', label: 'Lines' },
  { value: 'zigzag', label: 'Zigzag' },
  { value: 'waves', label: 'Waves' },
  { value: 'hearts', label: 'Love' },
  { value: 'stars', label: 'Stars' },
  { value: 'crosses', label: 'Crosses' },
  { value: 'doodle', label: 'Doodle' },
  { value: 'image', label: 'Photo' },
];

const MIX_TYPES: { value: BgType; label: string }[] = [
  { value: 'dots', label: 'Dots' },
  { value: 'grid', label: 'Grid' },
  { value: 'stripes', label: 'Lines' },
  { value: 'zigzag', label: 'Zigzag' },
  { value: 'waves', label: 'Waves' },
  { value: 'hearts', label: 'Love' },
  { value: 'stars', label: 'Stars' },
  { value: 'crosses', label: 'Crosses' },
  { value: 'doodle', label: 'Doodle' },
];

/** Wrapping chip grid — Seg only fits a handful of options. */
function PatternGrid({ options, value, onChange }: { options: { value: BgType; label: string }[]; value: BgType; onChange: (v: BgType) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <TouchableOpacity
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              backgroundColor: on ? C.ink : C.card,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: on ? C.ink : C.lineSoft,
              paddingHorizontal: 14,
              paddingVertical: 9,
            }}
            activeOpacity={0.75}
          >
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: on ? '#fff' : C.ink }}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function BackgroundPicker() {
  const { page, patchBackground } = usePost();
  const [custom, setCustom] = useState<BgPreset[]>([]);
  const [presetName, setPresetName] = useState('');

  useEffect(() => {
    loadCustomBgPresets().then(setCustom);
  }, []);

  if (!page) return null;
  const bg = page.background;

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (!res.canceled && res.assets[0]) patchBackground({ type: 'image', imageUri: res.assets[0].uri });
  };

  return (
    <View style={{ gap: 22 }}>
      <View style={{ gap: 14 }}>
        <Section no="01" title="Pattern" hint="The texture behind everything." />
        <PatternGrid
          options={TYPES}
          value={bg.type}
          onChange={(v) => (v === 'image' ? pickImage() : patchBackground({ type: v }))}
        />
        {bg.type === 'image' ? <PrimaryBtn label={bg.imageUri ? 'Change photo' : 'Choose a photo'} onPress={pickImage} /> : null}
      </View>

      <View style={{ gap: 14 }}>
        <Section no="02" title="Colors" />
        <Field label="Base">
          <Swatches colors={PALETTE} value={bg.color} onChange={(c) => patchBackground({ color: c })} />
        </Field>
        <Field label="Pattern ink">
          <Swatches colors={PALETTE} value={bg.patternColor} onChange={(c) => patchBackground({ patternColor: c })} />
        </Field>
        <Field label="Pattern size" hint={`${bg.patternSize}px`}>
          <Stepper value={bg.patternSize} onChange={(v) => patchBackground({ patternSize: v })} step={4} min={10} max={56} format={(v) => `${v}px`} />
        </Field>
      </View>

      <View style={{ gap: 14 }}>
        <Section no="03" title="Presets" hint="One-tap starting points — or save your own look." />
        <View style={{ backgroundColor: C.card, borderRadius: R.lg, overflow: 'hidden' }}>
          {BG_PRESETS.map((p, i) => (
            <TouchableOpacity key={p.label} onPress={() => patchBackground({ color: p.color, patternColor: p.patternColor })} style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 13 }, i > 0 && { borderTopWidth: 1, borderTopColor: C.lineSoft }]} activeOpacity={0.7}>
              <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: p.color, borderWidth: 1, borderColor: '#00000014', alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.patternColor }} />
              </View>
              <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.ink }}>{p.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={C.faint} />
            </TouchableOpacity>
          ))}
        </View>

        {custom.length > 0 ? (
          <View style={{ backgroundColor: C.card, borderRadius: R.lg, overflow: 'hidden' }}>
            {custom.map((cp, i) => (
              <View key={cp.id} style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 13 }, i > 0 && { borderTopWidth: 1, borderTopColor: C.lineSoft }]}>
                <TouchableOpacity onPress={() => patchBackground({ ...cp.bg })} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }} activeOpacity={0.7}>
                  <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: cp.bg.color, borderWidth: 1, borderColor: '#00000014', alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: cp.bg.patternColor }} />
                  </View>
                  <Text style={{ flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.ink }} numberOfLines={1}>{cp.name}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => Alert.alert('Delete preset', `Delete "${cp.name}"?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deleteCustomBgPreset(cp.id).then(setCustom) },
                  ])}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={{ fontSize: 15, color: C.faint }}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Txt value={presetName} onChangeText={setPresetName} placeholder="Name this look…" />
          </View>
          <TouchableOpacity
            onPress={() => {
              saveCustomBgPreset({ id: uid('preset'), name: presetName.trim() || `Look ${custom.length + 1}`, bg: JSON.parse(JSON.stringify(bg)) }).then(setCustom);
              setPresetName('');
            }}
            style={{ backgroundColor: C.ink, borderRadius: R.md + 2, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' }}
            activeOpacity={0.85}
          >
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', color: '#fff', fontSize: 14 }}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ gap: 14 }}>
        <Section no="04" title="Blend" hint="Layer a second pattern on top." />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, borderRadius: R.lg, paddingHorizontal: 15, paddingVertical: 12 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.ink }}>Second pattern</Text>
          <PillToggle on={bg.mixEnabled} onPress={() => patchBackground({ mixEnabled: !bg.mixEnabled })} />
        </View>
        {bg.mixEnabled ? (
          <View style={{ gap: 14 }}>
            <PatternGrid
              options={MIX_TYPES}
              value={(bg.mixType ?? 'grid') as BgType}
              onChange={(v) => patchBackground({ mixType: v })}
            />
            <Swatches colors={PALETTE.slice(0, 8)} value={bg.mixColor} onChange={(c) => patchBackground({ mixColor: c })} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
