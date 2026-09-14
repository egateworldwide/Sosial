import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R } from '../theme';
import { SocialGlyph } from './ui';

export interface DrawerChannel {
  id: string;
  label: string;
  sub: string;
  connected: boolean;
}

/** Channel dropdown drawer: All + per-channel rows, add-channel + settings footer. */
export default function ChannelDrawer({ visible, channels, value, onPick, onAddChannel, onSettings, onClose }: {
  visible: boolean;
  channels: DrawerChannel[];
  value: string;
  onPick: (id: string) => void;
  onAddChannel: () => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const { C } = useTheme();
  const s = makeS(C);
  const row = (id: string, label: string, sub: string, glyph: string | null, dot?: boolean) => {
    const on = value === id;
    return (
      <TouchableOpacity key={id} onPress={() => { onPick(id); onClose(); }} style={[s.row, on && { borderColor: C.accent, backgroundColor: C.accentSoft }]} activeOpacity={0.75}>
        {glyph ? (
          <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
            <SocialGlyph platform={glyph} size={15} color={C.onInk} />
          </View>
        ) : (
          <View style={[s.globe, dot && { backgroundColor: C.accent }]}>
            <Ionicons name="globe-outline" size={17} color={dot ? '#fff' : C.muted} />
          </View>
        )}
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={s.rowT} numberOfLines={1}>{label}</Text>
          <Text style={s.rowS} numberOfLines={1}>{sub}</Text>
        </View>
        {on ? <Ionicons name="checkmark-circle" size={20} color={C.accent} /> : null}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={s.bg}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={s.sheet}>
          <Text style={s.title}>Channels</Text>
          <View style={{ gap: 8, marginTop: 12 }}>
            {row('all', 'All channels', `${channels.filter((c) => c.connected).length} connected`, null, true)}
            {channels.map((c) => row(c.id, c.label, c.sub, c.id))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <View style={{ flex: 1 }}>
              <TouchableOpacity onPress={() => { onClose(); onAddChannel(); }} style={s.add} activeOpacity={0.8}>
                <Ionicons name="add" size={18} color={C.onInk} />
                <Text style={s.addT}>Add channel</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => { onClose(); onSettings(); }} style={s.gear} activeOpacity={0.7}>
              <Ionicons name="settings-outline" size={20} color={C.ink} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const makeS = (C: Palette) => StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.paper, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 30, maxHeight: '80%' },
  title: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 18, letterSpacing: -0.3, color: C.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1.5, borderColor: C.lineSoft, padding: 11 },
  rowT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14.5, color: C.ink },
  rowS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted },
  globe: { width: 34, height: 34, borderRadius: 12, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.ink, borderRadius: R.md, paddingVertical: 14 },
  addT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.onInk },
  gear: { width: 52, borderRadius: R.md, backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft, alignItems: 'center', justifyContent: 'center' },
});
