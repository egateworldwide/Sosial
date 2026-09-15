import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R, T } from '../theme';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Local-first, no accounts',
    body: 'Sosial works entirely on your device. There are no accounts, no sign-ups, and no servers receiving your content. Your designs, posts, templates and schedules are stored only in your phone’s local storage.',
  },
  {
    title: 'Your photos stay yours',
    body: 'When you pick a profile picture, background, content image or video, the file stays on your device and is used only inside your designs. Exported images save straight to your photo library. Nothing is uploaded anywhere by Sosial itself.',
  },
  {
    title: 'Reminders live on your phone',
    body: 'Scheduled post alerts are local notifications created and fired by your own device. No reminder data leaves your phone.',
  },
  {
    title: 'Sharing is manual',
    body: 'Posting to social apps happens through your phone’s share sheet and official apps. Sosial copies your caption to the clipboard and opens the app you choose — it never posts, reads, or accesses your social accounts on its own.',
  },
  {
    title: 'Social connections (optional)',
    body: 'If you connect a Facebook, Instagram or Threads account in the future, login tokens are kept in your device’s secure storage and used only to publish posts you explicitly approve. You can disconnect at any time from the connected app’s settings, which revokes access immediately.',
  },
  {
    title: 'Analytics & tracking',
    body: 'Sosial collects no analytics, shows no ads, and embeds no third-party trackers.',
  },
  {
    title: 'Children',
    body: 'Sosial is a general productivity tool with no age-gated content, and collects no personal data from anyone.',
  },
  {
    title: 'Changes',
    body: 'If this policy changes, the updated version ships inside the app. Continued use after an update means you accept the current policy.',
  },
  {
    title: 'Contact',
    body: 'Questions about privacy? Reach us at egateworldwide on GitHub and we’ll answer.',
  },
];

export default function PrivacyScreen({ onBack }: { onBack: () => void }) {
  const { C } = useTheme();
  const s = makeS(C);
  return (
    <View style={{ flex: 1, backgroundColor: C.bone }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={onBack} activeOpacity={0.7} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color={C.ink} />
        </TouchableOpacity>
        <Text style={s.kicker}>Legal</Text>
        <Text style={[T.h1, { color: C.ink, marginTop: 8, fontSize: 30, lineHeight: 36 }]}>Privacy Policy</Text>
        <Text style={s.sub}>Last updated September 2026. Short version: everything stays on your phone.</Text>
        <View style={{ gap: 18, marginTop: 22 }}>
          {SECTIONS.map((sec) => (
            <View key={sec.title}>
              <Text style={s.t}>{sec.title}</Text>
              <Text style={s.b}>{sec.body}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const makeS = (C: Palette) => StyleSheet.create({
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  kicker: { ...T.tag, color: C.accent, marginTop: 24 },
  sub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6 },
  t: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 16, letterSpacing: -0.2, color: C.ink },
  b: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, lineHeight: 21, color: C.soft, marginTop: 6 },
});
