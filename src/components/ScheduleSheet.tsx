import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, Alert, Platform, KeyboardAvoidingView, Image } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R } from '../theme';
import { PrimaryBtn, GhostBtn, Txt } from './ui';
import { SocialGlyph } from './ui';
import { SOCIAL_META } from '../constants';
import { fmtDateTime } from '../utils/reminders';

const CHANNELS = ['any', 'facebook', 'instagram', 'tiktok', 'threads', 'linkedin', 'bluesky', 'youtube', 'mastodon', 'pinterest', 'x'];
const COMING_SOON = ['linkedin', 'bluesky', 'youtube', 'mastodon', 'pinterest', 'x'];

function slotToday(hour: number, min = 0): number {
  const d = new Date();
  d.setHours(hour, min, 0, 0);
  if (d.getTime() <= Date.now() + 60000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function slotTomorrow(hour: number, min = 0): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, min, 0, 0);
  return d.getTime();
}

export interface Composer {
  title: string;
  caption: string;
  onCaption: (v: string) => void;
  onTitle?: (v: string) => void;
}

export interface SheetMedia {
  uri?: string;
  kind?: 'image' | 'video';
  onPick: () => void;
  onRemove: () => void;
}

interface Props {
  visible: boolean;
  initialAt?: number;
  initialPlatforms?: string[];
  title?: string;
  bulkCount?: number;
  composer?: Composer;
  media?: SheetMedia;
  onDelete?: () => void;
  onPosted?: () => void;
  publishLabel?: string;
  publishBusy?: boolean;
  onPublish?: () => void;
  onSave: (at: number, platforms: string[]) => void;
  draftLabel?: string;
  onDraft?: () => void;
  approveLabel?: string;
  onApprove?: () => void;
  onClose: () => void;
}

/** Buffer-style sheet: channels (multi) + title/description + time. */
export default function ScheduleSheet({ visible, initialAt, initialPlatforms, title, bulkCount, composer, media, onDelete, onPosted, publishLabel, publishBusy, onPublish, draftLabel, onDraft, approveLabel, onApprove, onSave, onClose }: Props) {
  const { C, mode: themeMode } = useTheme();
  const st = makeSt(C);
  const [plats, setPlats] = useState<string[]>(['any']);
  const [preset, setPreset] = useState<'now' | 'today' | 'tomorrow' | 'custom'>('now');
  const [custom, setCustom] = useState(new Date(Date.now() + 86400000));
  const [showPicker, setShowPicker] = useState(false);
  const [mode, setMode] = useState<'date' | 'time'>('date');

  useEffect(() => {
    if (visible) {
      setPlats(initialPlatforms && initialPlatforms.length > 0 ? initialPlatforms : ['any']);
      setPreset('now');
      setCustom(new Date(initialAt ?? Date.now() + 86400000));
      setShowPicker(false);
      setMode('date');
    }
  }, [visible, initialAt, initialPlatforms]);

  const togglePlat = (c: string) => {
    if (c === 'any') {
      setPlats(['any']);
      return;
    }
    if ((COMING_SOON as string[]).includes(c)) {
      const label = c[0].toUpperCase() + c.slice(1);
      Alert.alert(`${label} is coming soon`, 'We’re working on it — pick a connected channel for now.');
      return;
    }
    setPlats((prev) => {
      const without = prev.filter((x) => x !== 'any' && x !== c);
      if (prev.includes(c)) return without.length > 0 ? without : ['any'];
      return [...without, c];
    });
  };

  const at = preset === 'now' ? Date.now() + 60000 : preset === 'today' ? slotToday(18) : preset === 'tomorrow' ? slotTomorrow(9) : custom.getTime();

  const onPick = (_e: any, d?: Date) => {
    if (_e?.type === 'dismissed') {
      setShowPicker(false);
      return;
    }
    if (!d) return;
    if (mode === 'date' && Platform.OS === 'android') {
      const merged = new Date(custom);
      merged.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      setCustom(merged);
      setMode('time');
      return;
    }
    setCustom(d);
    if (Platform.OS === 'android') setShowPicker(false);
  };

  const save = () => {
    if (at <= Date.now() + 30000) {
      Alert.alert('Pick a future time', 'Reminders can only fire in the future.');
      return;
    }
    onSave(at, plats);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={st.bg}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={st.sheet}>
          <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} keyboardShouldPersistTaps="handled">
          <Text style={st.title}>{title ?? 'Add to queue'}</Text>

          {composer ? (
            <View style={st.post}>
              {composer.onTitle ? (
                <Txt
                  value={composer.title}
                  onChangeText={composer.onTitle}
                  placeholder="Post title…"
                  style={{ fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 15 }}
                />
              ) : (
                <Text style={st.postT} numberOfLines={2}>{composer.title || 'Untitled'}</Text>
              )}
              <Txt
                value={composer.caption}
                onChangeText={composer.onCaption}
                placeholder="Write the description…"
                multiline
                style={{ minHeight: 64, textAlignVertical: 'top' }}
              />
            </View>
          ) : null}

          {media ? (
            <View>
              <Text style={st.label}>Photo or video</Text>
              {media.uri ? (
                <View style={{ gap: 8, marginTop: 8 }}>
                  {media.kind === 'video' ? (
                    <View style={{ width: '100%', height: 150, borderRadius: R.lg, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="play-circle" size={44} color="#fff" />
                    </View>
                  ) : (
                    <Image source={{ uri: media.uri }} style={{ width: '100%', height: 150, borderRadius: R.lg }} resizeMode="cover" />
                  )}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}><GhostBtn label="Change" onPress={media.onPick} /></View>
                    <View style={{ flex: 1 }}><GhostBtn label="Remove" danger onPress={media.onRemove} /></View>
                  </View>
                </View>
              ) : (
                <View style={{ marginTop: 8 }}>
                  <GhostBtn label="Attach photo or video" onPress={media.onPick} />
                </View>
              )}
            </View>
          ) : null}

          <Text style={st.label}>Channels — pick any</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {CHANNELS.map((c) => {
              const on = plats.includes(c);
              const soon = (COMING_SOON as string[]).includes(c);
              const label = c === 'any' ? 'Anywhere' : c[0].toUpperCase() + c.slice(1);
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => togglePlat(c)}
                  style={[st.chip, on && { backgroundColor: C.ink, borderColor: C.ink }, soon && { opacity: 0.75 }]}
                  activeOpacity={0.75}
                >
                  {c === 'any' ? (
                    <Ionicons name="globe-outline" size={14} color={on ? C.onInk : C.muted} />
                  ) : (
                    <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: SOCIAL_META[c]?.bg ?? C.ink, alignItems: 'center', justifyContent: 'center' }}>
                      <SocialGlyph platform={c} size={11} color="#fff" />
                    </View>
                  )}
                  <Text style={[st.chipT, on && { color: C.onInk }]}>{label}</Text>
                  {soon ? <Text style={st.soonT}>Soon</Text> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={[st.label, { marginTop: 6 }]}>Time</Text>
          {(
            [
              { id: 'now', label: 'Now', sub: 'Reminder fires in about a minute' },
              { id: 'today', label: 'Today', sub: fmtDateTime(slotToday(18)) },
              { id: 'tomorrow', label: 'Tomorrow', sub: fmtDateTime(slotTomorrow(9)) },
              { id: 'custom', label: 'Custom', sub: fmtDateTime(custom.getTime()) },
            ] as const
          ).map((o) => {
            const on = preset === o.id;
            return (
              <TouchableOpacity
                key={o.id}
                onPress={() => {
                  setPreset(o.id);
                  if (o.id === 'custom') {
                    setMode('date');
                    if (Platform.OS === 'android') setShowPicker(true);
                  }
                }}
                style={[st.opt, on && { borderColor: C.accent, backgroundColor: C.accentSoft }]}
                activeOpacity={0.75}
              >
                <View style={[st.radio, on && { borderColor: C.accent }]}>
                  {on ? <View style={st.radioOn} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.optT}>{o.label}</Text>
                  <Text style={st.optS}>{o.sub}</Text>
                </View>
                {o.id === 'custom' && Platform.OS === 'ios' ? (
                  <TouchableOpacity onPress={() => setShowPicker((v) => !v)} style={st.mini} activeOpacity={0.7}>
                    <Text style={st.miniT}>{showPicker ? 'Done' : 'Edit'}</Text>
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
            );
          })}

          {showPicker ? (
            <DateTimePicker
              value={custom}
              mode={mode}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onPick}
              themeVariant={themeMode}
              textColor={C.ink}
            />
          ) : null}
          {preset === 'custom' && Platform.OS === 'ios' && !showPicker ? (
            <TouchableOpacity onPress={() => setShowPicker(true)} style={st.miniWide} activeOpacity={0.7}>
              <Text style={st.miniT}>Pick date & time</Text>
            </TouchableOpacity>
          ) : null}

          <View style={{ marginTop: 10 }}>
            <PrimaryBtn
              label={bulkCount ? `Queue ${bulkCount} page${bulkCount > 1 ? 's' : ''}` : preset === 'now' ? 'Queue now' : `Queue for ${fmtDateTime(at)}`}
              onPress={save}
            />
          </View>
          {onDraft ? (
            <View style={{ marginTop: 8 }}>
              <GhostBtn label={draftLabel ?? 'Save as draft'} onPress={onDraft} />
            </View>
          ) : null}
          {onApprove ? (
            <TouchableOpacity
              onPress={onApprove}
              style={{ backgroundColor: C.accentSoft, borderRadius: R.lg, paddingVertical: 14, alignItems: 'center' }}
              activeOpacity={0.85}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 15, color: C.accentInk }}>
                {approveLabel ?? 'Send to approvals'}
              </Text>
            </TouchableOpacity>
          ) : null}
          {onPublish ? (
            <TouchableOpacity
              onPress={onPublish}
              disabled={!!publishBusy}
              style={{ backgroundColor: C.accent, borderRadius: R.lg, paddingVertical: 14, alignItems: 'center', opacity: publishBusy ? 0.6 : 1 }}
              activeOpacity={0.85}
            >
              <Text style={{ fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 15, color: C.onInk }}>
                {publishBusy ? 'Publishing…' : (publishLabel ?? 'Publish now')}
              </Text>
            </TouchableOpacity>
          ) : null}
          {onPosted || onDelete ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {onPosted ? <View style={{ flex: 1 }}><GhostBtn label="Posted ✓" onPress={onPosted} /></View> : null}
              {onDelete ? <View style={{ flex: 1 }}><GhostBtn label="Delete" danger onPress={onDelete} /></View> : null}
            </View>
          ) : null}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeSt = (C: Palette) => ({
  bg: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' } as const,
  sheet: { backgroundColor: C.paper, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 30, gap: 10, maxHeight: '92%' } as const,
  title: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 18, letterSpacing: -0.3, color: C.ink } as const,
  label: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6 } as const,
  post: { backgroundColor: C.card, borderRadius: R.lg, padding: 12, gap: 8 } as const,
  postT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 15, letterSpacing: -0.2, color: C.ink } as const,
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card, borderRadius: 999, borderWidth: 1, borderColor: C.lineSoft, paddingHorizontal: 12, paddingVertical: 8 } as const,
  chipT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.ink, textTransform: 'capitalize' } as const,
  soonT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10.5, color: C.accentInk } as const,
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1.5, borderColor: C.lineSoft, padding: 12 } as const,
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.faint, alignItems: 'center', justifyContent: 'center' } as const,
  radioOn: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent } as const,
  optT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14.5, color: C.ink } as const,
  optS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted, marginTop: 1 } as const,
  mini: { backgroundColor: C.paper, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 } as const,
  miniWide: { backgroundColor: C.card, borderRadius: R.lg, paddingVertical: 11, alignItems: 'center' } as const,
  miniT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.accentInk } as const,
});
