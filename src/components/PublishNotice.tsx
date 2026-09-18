import React from 'react';
import { View, Text, Modal, ActivityIndicator, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R } from '../theme';
import { PrimaryBtn, GhostBtn, SocialGlyph } from './ui';
import { SOCIAL_META } from '../constants';

export interface PubRow {
  id: string;
  label: string;
  state: 'pending' | 'working' | 'done' | 'fail' | 'manual';
  note?: string;
}

function RowIcon({ state }: { state: PubRow['state'] }) {
  const { C } = useTheme();
  const s = makeS(C);
  if (state === 'working') return <ActivityIndicator size="small" color={C.accent} />;
  if (state === 'pending') {
    return (
      <View style={s.rowIco}>
        <View style={s.dot} />
      </View>
    );
  }
  const cfg =
    state === 'done'
      ? { icon: 'checkmark' as const, bg: C.paleGreen, fg: C.greenText }
      : state === 'fail'
        ? { icon: 'close' as const, bg: C.paleRed, fg: C.redText }
        : { icon: 'globe-outline' as const, bg: C.accentSoft, fg: C.accentInk };
  return (
    <View style={[s.rowIco, { backgroundColor: cfg.bg }]}>
      <Ionicons name={cfg.icon} size={13} color={cfg.fg} />
    </View>
  );
}

/** In-app publishing notice — replaces EVERY native Alert during/after publish.
 *  loading: spinner + live per-channel rows. result: summary card.
 *  info: simple card. privacy: tappable TikTok audience options. */
export default function PublishNotice({
  visible,
  mode,
  title,
  message,
  channels,
  rows,
  onDone,
  onPick,
  onCancel,
  onHide,
}: {
  visible: boolean;
  mode: 'loading' | 'result' | 'info' | 'privacy';
  title: string;
  message?: string;
  /** brand tiles shown above the message (e.g. which channels need media) */
  channels?: string[];
  rows?: PubRow[];
  onDone?: () => void;
  onPick?: (value: string) => void;
  onCancel?: () => void;
  /** loading only: dismiss the overlay while the publish keeps running */
  onHide?: () => void;
}) {
  const { C } = useTheme();
  const s = makeS(C);
  if (!visible) return null;
  const allGood = (rows?.length ?? 0) > 0 && rows!.every((r) => r.state === 'done');
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { if (mode === 'result' || mode === 'info') onDone?.(); if (mode === 'privacy') onCancel?.(); if (mode === 'loading') onHide?.(); }}>
      <View style={s.bg}>
        <View style={s.card}>
          {mode === 'result' ? (
            <View style={[s.head, { backgroundColor: allGood ? C.paleGreen : C.paleRed }]}>
              <Ionicons name={allGood ? 'checkmark' : 'alert'} size={26} color={allGood ? C.greenText : C.redText} />
            </View>
          ) : null}
          {mode === 'loading' ? (
            <View style={s.loadHead}>
              <ActivityIndicator size="large" color={C.accent} />
            </View>
          ) : null}
          {mode === 'privacy' ? (
            <View style={[s.head, { backgroundColor: C.accentSoft }]}>
              <Ionicons name="eye-outline" size={26} color={C.accentInk} />
            </View>
          ) : null}
          <Text style={s.title}>{title}</Text>
          {mode === 'info' && channels && channels.length > 0 ? (
            <View style={s.chanRow}>
              {channels.map((c) => (
                <View key={c} style={[s.chanTile, { backgroundColor: SOCIAL_META[c]?.bg ?? C.ink }]}>
                  <SocialGlyph platform={c} size={16} color="#fff" />
                </View>
              ))}
            </View>
          ) : null}
          {message ? <Text style={s.message}>{message}</Text> : null}
          {mode === 'loading' ? <Text style={s.sub}>Uploading and posting — keep the app open.</Text> : null}
          {rows && rows.length > 0 ? (
            <ScrollView style={mode === 'privacy' ? s.privWrap : s.rowsWrap} showsVerticalScrollIndicator={false}>
              <View style={s.rows}>
                {rows.map((r) =>
                  mode === 'privacy' ? (
                    <TouchableOpacity key={r.id} onPress={() => onPick?.(r.id)} style={s.privOpt} activeOpacity={0.75}>
                      <Text style={s.privOptT}>{r.label}</Text>
                      <Ionicons name="chevron-forward" size={16} color={C.faint} />
                    </TouchableOpacity>
                  ) : (
                    <View key={r.id} style={s.row}>
                      <RowIcon state={r.state} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.rowT}>{r.label}</Text>
                        {r.note ? (
                          <Text style={s.rowNote} selectable>
                            {r.note}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  ),
                )}
              </View>
            </ScrollView>
          ) : null}
          {mode === 'result' || mode === 'info' ? <PrimaryBtn label="Done" onPress={() => onDone?.()} /> : null}
          {mode === 'loading' ? <GhostBtn label="Continue in background" onPress={() => onHide?.()} /> : null}
          {mode === 'privacy' ? <GhostBtn label="Cancel" onPress={() => onCancel?.()} /> : null}
        </View>
      </View>
    </Modal>
  );
}

const makeS = (C: Palette) =>
  StyleSheet.create({
    bg: { flex: 1, backgroundColor: '#00000066', alignItems: 'center', justifyContent: 'center', padding: 28 } as const,
    card: { backgroundColor: C.paper, borderRadius: R.xl, padding: 22, width: '100%', maxWidth: 360, gap: 10 } as const,
    head: { width: 56, height: 56, borderRadius: 28, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' } as const,
    loadHead: { alignSelf: 'center', paddingVertical: 6 } as const,
    title: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 18, letterSpacing: -0.3, color: C.ink, textAlign: 'center' } as const,
    chanRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 } as const,
    chanTile: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' } as const,
    message: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13.5, lineHeight: 19, color: C.muted, textAlign: 'center' } as const,
    sub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.faint, textAlign: 'center' } as const,
    rowsWrap: { maxHeight: 240, marginTop: 2 } as const,
    privWrap: { width: '100%', marginTop: 2 } as const,
    privOpt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.lineSoft, paddingHorizontal: 14, paddingVertical: 13 } as const,
    privOptT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.ink } as const,
    rows: { gap: 10 } as const,
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 } as const,
    rowIco: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' } as const,
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.faint } as const,
    rowT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14.5, color: C.ink } as const,
    rowNote: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, lineHeight: 16, color: C.redText, marginTop: 1 } as const,
  });
