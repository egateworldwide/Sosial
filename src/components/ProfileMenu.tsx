import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { C, R } from '../theme';

/** Avatar menu: email + team/org, account settings, support, logout. */
export default function ProfileMenu({ visible, email, team, onClose, onAccount, onSupport, onLogout }: {
  visible: boolean;
  email: string;
  team: string;
  onClose: () => void;
  onAccount: () => void;
  onSupport: () => void;
  onLogout: () => void;
}) {
  const initial = (email || team || 'Z')[0].toUpperCase();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={s.bg}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={s.sheet}>
          <View style={s.head}>
            <View style={s.avatar}><Text style={s.avatarT}>{initial}</Text></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.email} numberOfLines={1}>{email || 'No email set'}</Text>
              <Text style={s.team} numberOfLines={1}>{team}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={() => { onClose(); onAccount(); }} style={s.row} activeOpacity={0.7}>
            <Ionicons name="settings-outline" size={20} color={C.ink} />
            <Text style={s.rowT}>Account settings</Text>
            <Ionicons name="chevron-forward" size={18} color={C.faint} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { onClose(); onSupport(); }} style={[s.row, s.div]} activeOpacity={0.7}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={C.ink} />
            <Text style={s.rowT}>Support</Text>
            <Ionicons name="chevron-forward" size={18} color={C.faint} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { onClose(); onLogout(); }} style={[s.row, s.div]} activeOpacity={0.7}>
            <Ionicons name="log-out-outline" size={20} color={C.redText} />
            <Text style={[s.rowT, { color: C.redText }]}>Logout</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

export function AvatarButton({ email, team, onPress }: { email: string; team: string; onPress: () => void }) {
  const initial = (email || team || 'Z')[0].toUpperCase();
  return (
    <TouchableOpacity onPress={onPress} style={a.btn} activeOpacity={0.8}>
      <Text style={a.t}>{initial}</Text>
    </TouchableOpacity>
  );
}

const a = StyleSheet.create({
  btn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  t: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 15, color: '#fff' },
});

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.paper, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 34 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingBottom: 16 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  avatarT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 20, color: '#fff' },
  email: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 16, letterSpacing: -0.2, color: C.ink },
  team: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 15 },
  div: { borderTopWidth: 1, borderTopColor: C.lineSoft },
  rowT: { flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.ink },
});
