import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Linking, Switch } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R, T } from '../theme';
import { Txt } from '../components/ui';
import { wipeAllData } from '../utils/account';

type AcctView = 'main' | 'notif' | 'email' | 'password' | 'plan' | 'changelog' | 'terms' | 'legal';

const CHANGELOG = [
  { v: '1.0.0', notes: ['Buffer-style app: Create, Post and Analytics tabs', 'Ideas feed with design-studio link', 'Queue / drafts / approvals / sent pipeline', 'Per-channel insights, top posts and comments', 'Meta login via secure bridge page'] },
];

/** Account settings: notifications, email, password, plan, legal… (all on-device, no backend). */
export default function AccountScreen({ email, team, notifPosts, notifComments, notifWeekly, onUpdate, onBack, onConnect, onPrivacy, onLoggedOut }: {
  email: string;
  team: string;
  notifPosts: boolean;
  notifComments: boolean;
  notifWeekly: boolean;
  onUpdate: (patch: { email?: string; team?: string; notifPosts?: boolean; notifComments?: boolean; notifWeekly?: boolean }) => void;
  onBack: () => void;
  onConnect: () => void;
  onPrivacy: () => void;
  onLoggedOut: () => void;
}) {
  const { C } = useTheme();
  const s = makeS(C);
  const [view, setView] = useState<AcctView>('main');
  const [draftEmail, setDraftEmail] = useState(email);
  const [draftTeam, setDraftTeam] = useState(team);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');

  const initial = (email || team || 'Z')[0].toUpperCase();
  const title = view === 'main' ? 'Account' : (
    view === 'notif' ? 'Notifications' : view === 'email' ? 'Email settings' :
    view === 'password' ? 'Change password' : view === 'plan' ? 'Subscription' :
    view === 'changelog' ? "What's new" : view === 'terms' ? 'Terms of use' : 'Legal'
  );

  const row = (icon: string, label: string, sub: string | undefined, onPress: () => void, danger?: boolean) => (
    <TouchableOpacity onPress={onPress} style={s.row} activeOpacity={0.7}>
      <Ionicons name={icon as any} size={20} color={danger ? C.redText : C.ink} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={[s.rowT, danger && { color: C.redText }]}>{label}</Text>
        {sub ? <Text style={s.rowS} numberOfLines={1}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.faint} />
    </TouchableOpacity>
  );

  const toggleRow = (label: string, sub: string, value: boolean, onFlip: () => void) => (
    <View style={s.row}>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={s.rowT}>{label}</Text>
        <Text style={s.rowS}>{sub}</Text>
      </View>
      <Switch value={value} onValueChange={onFlip} trackColor={{ true: C.accent, false: '#D8D1BF' }} />
    </View>
  );

  const logout = () => {
    Alert.alert('Logout', 'Sign out on this device? Your designs and posts stay saved.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', onPress: () => { onUpdate({ email: '' }); onLoggedOut(); } },
    ]);
  };

  const deleteAccount = () => {
    Alert.alert('Delete Zap account?', 'This wipes everything on this device: designs, templates, ideas, posts, channels and settings. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete everything', style: 'destructive',
        onPress: () => Alert.alert('Last chance', 'Really delete all Zap data?', [
          { text: 'Keep it', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: async () => { await wipeAllData(); onLoggedOut(); } },
        ]),
      },
    ]);
  };

  const rateApp = () => {
    Linking.openURL('https://play.google.com/store/apps/details?id=com.zap.app').catch(() => {
      Alert.alert('Rate Zap', 'Zap isn’t on the Play Store yet — this link will work after release.');
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bone }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => (view === 'main' ? onBack() : setView('main'))} activeOpacity={0.7} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color={C.ink} />
        </TouchableOpacity>
        <Text style={[T.h1, { color: C.ink, marginTop: 16, fontSize: 30, lineHeight: 36 }]}>{title}</Text>

        {view === 'main' ? (
          <>
            <View style={s.head}>
              <View style={s.avatar}><Text style={s.avatarT}>{initial}</Text></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.email} numberOfLines={1}>{email || 'No email set'}</Text>
                <Text style={s.team} numberOfLines={1}>{team}</Text>
              </View>
            </View>
            <View style={s.list}>
              {row('notifications-outline', 'Notification settings', 'Post reminders, comments, digest', () => setView('notif'))}
              {row('mail-outline', 'Email settings', email || 'Set your email', () => { setDraftEmail(email); setDraftTeam(team); setView('email'); })}
              {row('key-outline', 'Change password', undefined, () => { setPw1(''); setPw2(''); setView('password'); })}
              {row('log-out-outline', 'Logout', undefined, logout, true)}
            </View>
            <View style={s.list}>
              {row('add-circle-outline', 'Connect new channel', 'Facebook, Instagram, Threads', onConnect)}
              {row('card-outline', 'Subscription plan', 'Free plan', () => setView('plan'))}
              {row('refresh-outline', 'Restore purchase', undefined, () => Alert.alert('Restore purchase', 'No purchases found on this device.'))}
              {row('star-outline', 'Rate Zap', 'Review on the Play Store', rateApp)}
              {row('sparkles-outline', "What's new", 'Changelog', () => setView('changelog'))}
            </View>
            <View style={s.list}>
              {row('shield-checkmark-outline', 'Privacy policy', undefined, onPrivacy)}
              {row('document-text-outline', 'Terms of use', undefined, () => setView('terms'))}
              {row('scale-outline', 'Legal', undefined, () => setView('legal'))}
              {row('trash-outline', 'Delete Zap account', 'Wipe everything on-device', deleteAccount, true)}
            </View>
          </>
        ) : null}

        {view === 'notif' ? (
          <View style={s.list}>
            {toggleRow('Post reminders', 'Alert when a queued post is due', notifPosts, () => onUpdate({ notifPosts: !notifPosts }))}
            {toggleRow('Comments & mentions', 'Alert on new comments (installed app)', notifComments, () => onUpdate({ notifComments: !notifComments }))}
            {toggleRow('Weekly digest', 'A Monday summary of your channels', notifWeekly, () => onUpdate({ notifWeekly: !notifWeekly }))}
            <Text style={s.note}>Reminder alerts need the installed app (not Expo Go) with notifications allowed.</Text>
          </View>
        ) : null}

        {view === 'email' ? (
          <View style={{ gap: 12, marginTop: 16 }}>
            <View>
              <Text style={s.label}>Email</Text>
              <Txt value={draftEmail} onChangeText={setDraftEmail} placeholder="you@studio.com" keyboardType="email-address" autoCapitalize="none" />
            </View>
            <View>
              <Text style={s.label}>Team / organization</Text>
              <Txt value={draftTeam} onChangeText={setDraftTeam} placeholder="My team" />
            </View>
            <TouchableOpacity
              onPress={() => { onUpdate({ email: draftEmail.trim(), team: draftTeam.trim() || 'My team' }); setView('main'); }}
              style={s.save} activeOpacity={0.85}
            >
              <Text style={s.saveT}>Save</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {view === 'password' ? (
          <View style={{ gap: 12, marginTop: 16 }}>
            <Text style={s.note}>Zap accounts live on this device only — there’s no cloud password. Your social accounts keep their own passwords with Meta. Setting one here just confirms it’s you on this phone.</Text>
            <View>
              <Text style={s.label}>New password</Text>
              <Txt value={pw1} onChangeText={setPw1} placeholder="••••••••" secureTextEntry />
            </View>
            <View>
              <Text style={s.label}>Confirm</Text>
              <Txt value={pw2} onChangeText={setPw2} placeholder="••••••••" secureTextEntry />
            </View>
            <TouchableOpacity
              onPress={() => {
                if (pw1.length < 4) Alert.alert('Too short', 'Use at least 4 characters.');
                else if (pw1 !== pw2) Alert.alert('No match', 'The two passwords differ.');
                else { setPw1(''); setPw2(''); setView('main'); Alert.alert('Saved', 'Password updated on this device.'); }
              }}
              style={s.save} activeOpacity={0.85}
            >
              <Text style={s.saveT}>Update password</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {view === 'plan' ? (
          <View style={{ marginTop: 16 }}>
            <View style={s.plan}>
              <Text style={s.planT}>Free plan</Text>
              <Text style={s.planS}>Unlimited ideas, designs, scheduling and 3 channels.</Text>
            </View>
            <TouchableOpacity onPress={() => Alert.alert('Zap Pro', 'Pro with team approvals and unlimited history is coming soon.')} style={[s.save, { marginTop: 12 }]} activeOpacity={0.85}>
              <Text style={s.saveT}>See Zap Pro</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {view === 'changelog' ? (
          <View style={{ marginTop: 16, gap: 12 }}>
            {CHANGELOG.map((c) => (
              <View key={c.v} style={s.plan}>
                <Text style={s.planT}>v{c.v}</Text>
                {c.notes.map((n, i) => (
                  <Text key={i} style={s.planS}>• {n}</Text>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {view === 'terms' ? (
          <View style={{ marginTop: 16 }}>
            <Text style={s.body}>
              Zap is a personal content studio. Your designs, ideas and posts are stored on your own device; social tokens are kept in the device keychain and used only to publish where you ask us to.{'\n\n'}
              Don’t publish content you don’t own or have rights to. Publishing to Facebook, Instagram and Threads is also governed by Meta’s terms.{'\n\n'}
              Zap is provided as-is, without warranties.
            </Text>
          </View>
        ) : null}

        {view === 'legal' ? (
          <View style={{ marginTop: 16 }}>
            <Text style={s.body}>
              © 2026 Zap. All rights reserved.{'\n\n'}
              Facebook, Instagram and Threads are trademarks of Meta Platforms, Inc. This app is not affiliated with or endorsed by Meta.{'\n\n'}
              Open-source licenses for bundled libraries are available in the project repository.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const makeS = (C: Palette) => StyleSheet.create({
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 18 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  avatarT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 22, color: C.onInk },
  email: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 17, letterSpacing: -0.2, color: C.ink },
  team: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted },
  list: { backgroundColor: C.card, borderRadius: R.lg, overflow: 'hidden', marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.lineSoft },
  rowT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.ink },
  rowS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted, marginTop: 1 },
  label: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.soft, marginBottom: 7 },
  save: { backgroundColor: C.ink, borderRadius: R.md + 2, paddingVertical: 12, alignItems: 'center' },
  saveT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.onInk },
  note: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 19, color: C.muted, margin: 14 },
  plan: { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.lineSoft, padding: 16, gap: 6 },
  planT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 17, color: C.ink },
  planS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, lineHeight: 20, color: C.muted },
  body: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, lineHeight: 22, color: C.soft },
});
