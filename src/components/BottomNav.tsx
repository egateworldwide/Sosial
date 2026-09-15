import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R } from '../theme';

export type MainTab = 'create' | 'analytics';

/** Buffer-style bottom bar: Create | (+) | Analytics. + expands to Template / Post. */
export default function BottomNav({ tab, onTab, onTemplate, onPost }: {
  tab: MainTab;
  onTab: (t: MainTab) => void;
  onTemplate: () => void;
  onPost: () => void;
}) {
  const [plus, setPlus] = useState(false);
  const { C } = useTheme();
  const s = makeS(C);

  const item = (t: MainTab, icon: string, label: string) => {
    const on = tab === t;
    return (
      <TouchableOpacity onPress={() => onTab(t)} style={s.item} activeOpacity={0.7}>
        <Ionicons name={icon as any} size={24} color={on ? C.accent : C.faint} />
        <Text style={[s.itemT, on && { color: C.accent }]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  const inner = (
    <>
      {item('create', tab === 'create' ? 'bulb' : 'bulb-outline', 'Create')}
      <TouchableOpacity onPress={() => setPlus(true)} style={s.plusWrap} activeOpacity={0.8}>
        <View style={s.plus}>
          <Ionicons name="add" size={28} color={C.onInk} />
        </View>
      </TouchableOpacity>
      {item('analytics', tab === 'analytics' ? 'bar-chart' : 'bar-chart-outline', 'Analytics')}
    </>
  );

  return (
    <>
      <View style={s.float}>
        <View style={s.pill}>{inner}</View>
      </View>

      <Modal visible={plus} transparent animationType="fade" onRequestClose={() => setPlus(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setPlus(false)} style={s.sheetBg}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={s.sheet}>
            <TouchableOpacity
              onPress={() => { setPlus(false); onTemplate(); }}
              style={s.opt} activeOpacity={0.75}
            >
              <View style={[s.optIcon, { backgroundColor: C.accentSoft }]}>
                <Ionicons name="color-palette-outline" size={22} color={C.accentInk} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.optT}>Template</Text>
                <Text style={s.optS}>Design studio — images for posts</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.faint} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setPlus(false); onPost(); }}
              style={[s.opt, { borderTopWidth: 1, borderTopColor: C.lineSoft }]} activeOpacity={0.75}
            >
              <View style={[s.optIcon, { backgroundColor: C.ink }]}>
                <Ionicons name="send-outline" size={22} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.optT}>Post</Text>
                <Text style={s.optS}>New post — channels + schedule</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.faint} />
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const makeS = (C: Palette) => StyleSheet.create({
  float: { paddingHorizontal: 22, paddingBottom: 12, paddingTop: 6, backgroundColor: 'transparent' },
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    borderRadius: 32, overflow: 'hidden', backgroundColor: C.paper,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.line,
    paddingVertical: 10, paddingHorizontal: 10,
    shadowColor: '#1C1917', shadowOpacity: 0.14, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  item: { alignItems: 'center', gap: 3, minWidth: 72, paddingVertical: 2 },
  itemT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11.5, color: C.faint },
  plusWrap: { alignItems: 'center', justifyContent: 'center', minWidth: 72 },
  plus: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.accent, shadowOpacity: 0.35, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  sheetBg: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.paper, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 34 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
  optIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  optT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 16, letterSpacing: -0.2, color: C.ink },
  optS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted, marginTop: 2 },
});
