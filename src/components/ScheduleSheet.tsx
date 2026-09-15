import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, Alert, Platform, KeyboardAvoidingView, Image } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R } from '../theme';
import { PrimaryBtn, GhostBtn, Txt } from './ui';
import { SocialGlyph } from './ui';
import { SOCIAL_META } from '../constants';
import { MAX_ATTACHMENTS } from '../utils/metaPublish';
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

export interface SheetMediaItem {
  uri: string;
  kind: 'image' | 'video';
}

export interface SheetMedia {
  items: SheetMediaItem[];
  onPick: () => void;
  onRemove: (index: number) => void;
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
  onPostNow?: (plats: string[]) => void;
  draftLabel?: string;
  onDraft?: () => void;
  approveLabel?: string;
  onApprove?: () => void;
  onClose: () => void;
  /** Sent posts open read-only: static summary + Delete, no editing or re-sending. */
  readOnly?: boolean;
  readOnlyNote?: string;
}

/** Buffer-style sheet: channels (multi) + title/description + time. */
export default function ScheduleSheet({ visible, initialAt, initialPlatforms, title, bulkCount, composer, media, onDelete, onPosted, publishLabel, publishBusy, onPublish, draftLabel, onDraft, approveLabel, onApprove, onSave, onPostNow, onClose, readOnly, readOnlyNote }: Props) {
  const { C, mode: themeMode } = useTheme();
  const st = makeSt(C);
  const [plats, setPlats] = useState<string[]>(['any']);
  const [preset, setPreset] = useState<'now' | 'custom'>('now');
  const [custom, setCustom] = useState(new Date(Date.now() + 86400000));
  const [showPicker, setShowPicker] = useState(false);
  const [mode, setMode] = useState<'date' | 'time'>('date');
  const [pickingTime, setPickingTime] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);

  const vCount = media?.items.length ?? 0;
  const vIdx = viewer !== null && vCount > 0 ? Math.min(viewer, vCount - 1) : null;
  const vItem = vIdx !== null ? media?.items[vIdx] : undefined;

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

  const at = preset === 'now' ? Date.now() + 60000 : custom.getTime();

  const onPick = (_e: any, d?: Date) => {
    if (_e?.type === 'dismissed') {
      setShowPicker(false);
      setMode('date');
      setPickingTime(false);
      return;
    }
    if (!d) return;
    setCustom(d);
    // Android: pick date, then reopen for time
    if (Platform.OS === 'android') {
      setShowPicker(false);
      if (mode === 'date') {
        setMode('time');
        setTimeout(() => setShowPicker(true), 200);
      } else {
        setMode('date');
      }
    }
    // iOS: date → time → stay visible
    if (Platform.OS === 'ios' && mode === 'date' && !pickingTime) {
      setMode('time');
      setPickingTime(true);
    }
  };

  const save = () => {
    if (at <= Date.now() + 30000) {
      Alert.alert('Pick a future time', 'Reminders can only fire in the future.');
      return;
    }
    onSave(at, plats);
  };

  return (
  <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={st.bg}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={st.sheet}>
          <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} keyboardShouldPersistTaps="handled">
          <Text style={st.title}>{title ?? 'Add to queue'}</Text>
          {readOnly && readOnlyNote ? <Text style={st.sentNote}>✓ {readOnlyNote}</Text> : null}

          {composer ? (
            <View style={st.post}>
              {readOnly ? (
                <>
                  <Text style={st.postT} numberOfLines={2}>{composer.title || 'Untitled'}</Text>
                  {composer.caption ? <Text style={st.postCap}>{composer.caption}</Text> : null}
                </>
              ) : (
                <>
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
                </>
              )}
            </View>
          ) : null}

          {media ? (
            readOnly ? (
              media.items.length > 0 ? (
                <View>
                  <Text style={st.label}>Photo or video</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 8, paddingRight: 4 }}>
                    {media.items.map((it, i) => (
                      <TouchableOpacity key={`${it.uri}-${i}`} onPress={() => setViewer(i)} activeOpacity={0.8}>
                        {it.kind === 'video' ? (
                          <View style={[st.thumb, { backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }]}>
                            <Ionicons name="play" size={20} color="#fff" />
                          </View>
                        ) : (
                          <Image source={{ uri: it.uri }} style={st.thumb} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              ) : null
            ) : (
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={st.label}>Photo or video</Text>
                {media.items.length > 0 ? <Text style={st.countT}>{media.items.length}/{MAX_ATTACHMENTS}</Text> : null}
              </View>
              {media.items.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 8, paddingRight: 4 }}>
                  {media.items.map((it, i) => (
                    <View key={`${it.uri}-${i}`}>
                      <TouchableOpacity onPress={() => setViewer(i)} activeOpacity={0.8}>
                        {it.kind === 'video' ? (
                          <View style={[st.thumb, { backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }]}>
                            <Ionicons name="play" size={20} color="#fff" />
                          </View>
                        ) : (
                          <Image source={{ uri: it.uri }} style={st.thumb} />
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => media.onRemove(i)} style={st.thumbX} activeOpacity={0.7}>
                        <Ionicons name="close" size={12} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {media.items.length < MAX_ATTACHMENTS ? (
                    <TouchableOpacity onPress={media.onPick} style={[st.thumb, st.thumbAdd]} activeOpacity={0.7}>
                      <Ionicons name="add" size={22} color={C.accentInk} />
                    </TouchableOpacity>
                  ) : null}
                </ScrollView>
              ) : (
                <View style={{ marginTop: 8 }}>
                  <GhostBtn label="Attach photo or video" onPress={media.onPick} />
                </View>
              )}
              <Text style={st.limitHint}>Instagram · up to 10 photos as a carousel — Facebook · up to 10 photos — Threads & TikTok · first item only</Text>
            </View>
            )
          ) : null}

          <Text style={st.label}>Channels{readOnly ? '' : ' — pick any'}</Text>
          {readOnly ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {plats.map((c, i) => (
                  c === 'any' ? (
                    <View key={c} style={[st.stackTile, { backgroundColor: C.card, borderColor: C.lineSoft, marginLeft: i === 0 ? 0 : -8 }]}>
                      <Ionicons name="globe-outline" size={14} color={C.muted} />
                    </View>
                  ) : (
                    <View key={c} style={[st.stackTile, { backgroundColor: SOCIAL_META[c]?.bg ?? C.ink, marginLeft: i === 0 ? 0 : -8 }]}>
                      <SocialGlyph platform={c} size={12} color="#fff" />
                    </View>
                  )
                ))}
              </View>
              <Text style={st.stackNames} numberOfLines={2}>
                {plats.map((c) => (c === 'any' ? 'Anywhere' : c[0].toUpperCase() + c.slice(1))).join('  ·  ')}
              </Text>
            </View>
          ) : (
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
          )}

          {!readOnly && (
          <>
          <Text style={[st.label, { marginTop: 6 }]}>Time</Text>
          {(
            [
              { id: 'now', label: 'Now', sub: 'Reminder fires in about a minute' },
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
                    setPickingTime(false);
                    setShowPicker(true);
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
              </TouchableOpacity>
            );
          })}

          {showPicker && preset === 'custom' ? (
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <DateTimePicker
                value={custom}
                mode={mode}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onPick}
                themeVariant={themeMode}
                textColor={C.ink}
                minimumDate={new Date()}
              />
              {Platform.OS === 'ios' ? (
                <TouchableOpacity onPress={() => { setShowPicker(false); setPickingTime(false); setMode('date'); }} style={st.pickerDone} activeOpacity={0.7}>
                  <Text style={st.pickerDoneT}>Done</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          <View style={{ marginTop: 10 }}>
            <PrimaryBtn
              label={bulkCount ? `Queue ${bulkCount} page${bulkCount > 1 ? 's' : ''}` : preset === 'now' ? 'Post now' : `Queue for ${fmtDateTime(at)}`}
              onPress={preset === 'now' && onPostNow && !bulkCount ? () => onPostNow(plats) : save}
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
          </>
          )}
          {!readOnly && (onPosted || onDelete) ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {onPosted ? <View style={{ flex: 1 }}><GhostBtn label="Posted ✓" onPress={onPosted} /></View> : null}
              {onDelete ? <View style={{ flex: 1 }}><GhostBtn label="Delete" danger onPress={onDelete} /></View> : null}
            </View>
          ) : null}
          {readOnly && onDelete ? (
            <GhostBtn label="Delete" danger onPress={onDelete} />
          ) : null}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
    <Modal visible={vIdx !== null} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
      {vItem ? (
        <View style={st.viewerBg}>
          <View style={st.viewerBar}>
            <Text style={st.viewerCount}>{(vIdx ?? 0) + 1} / {vCount}</Text>
            <TouchableOpacity onPress={() => setViewer(null)} style={st.viewerMin} activeOpacity={0.7}>
              <Ionicons name="chevron-down" size={18} color="#fff" />
              <Text style={st.viewerMinT}>Minimize</Text>
            </TouchableOpacity>
          </View>
          <View style={st.viewerBody}>
            {vItem.kind === 'video' ? (
              <View style={st.viewerVideo}>
                <Ionicons name="play-circle" size={64} color="#fff" />
                <Text style={st.viewerHint}>Video preview isn’t available — it posts fine.</Text>
              </View>
            ) : (
              <Image source={{ uri: vItem.uri }} style={st.viewerImg} resizeMode="contain" />
            )}
          </View>
          <View style={st.viewerNav}>
            <TouchableOpacity
              disabled={(vIdx ?? 0) <= 0}
              onPress={() => setViewer(Math.max(0, (vIdx ?? 0) - 1))}
              style={[st.viewerNavBtn, (vIdx ?? 0) <= 0 && st.viewerNavOff]}
              activeOpacity={0.7}
            >
              <Text style={st.viewerNavBtnT}>‹ Prev</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={(vIdx ?? vCount) >= vCount - 1}
              onPress={() => setViewer(Math.min(vCount - 1, (vIdx ?? 0) + 1))}
              style={[st.viewerNavBtn, (vIdx ?? vCount) >= vCount - 1 && st.viewerNavOff]}
              activeOpacity={0.7}
            >
              <Text style={st.viewerNavBtnT}>Next ›</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </Modal>
    </>
  );
}

const makeSt = (C: Palette) => ({
  bg: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' } as const,
  sheet: { backgroundColor: C.paper, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 30, gap: 10, maxHeight: '92%' } as const,
  title: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 18, letterSpacing: -0.3, color: C.ink } as const,
  label: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6 } as const,
  post: { backgroundColor: C.card, borderRadius: R.lg, padding: 12, gap: 8 } as const,
  postT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 15, letterSpacing: -0.2, color: C.ink } as const,
  postCap: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, lineHeight: 20, color: C.ink } as const,
  sentNote: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.accentInk } as const,
  stackTile: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.paper } as const,
  stackNames: { flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.ink } as const,
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card, borderRadius: 999, borderWidth: 1, borderColor: C.lineSoft, paddingHorizontal: 12, paddingVertical: 8 } as const,
  chipT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.ink, textTransform: 'capitalize' } as const,
  soonT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10.5, color: C.accentInk } as const,
  countT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.muted } as const,
  limitHint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5, lineHeight: 16, color: C.faint, marginTop: 6 } as const,
  thumb: { width: 64, height: 64, borderRadius: R.md } as const,
  thumbAdd: { backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft, alignItems: 'center', justifyContent: 'center' } as const,
  thumbX: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' } as const,
  viewerBg: { flex: 1, backgroundColor: '#000000EE', paddingTop: 48, paddingBottom: 32, paddingHorizontal: 20 } as const,
  viewerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } as const,
  viewerCount: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' } as const,
  viewerMin: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFFFFF22', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 } as const,
  viewerMinT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: '#fff' } as const,
  viewerBody: { flex: 1, alignItems: 'center', justifyContent: 'center', marginVertical: 16 } as const,
  viewerImg: { width: '100%', height: '100%' } as const,
  viewerVideo: { alignItems: 'center', justifyContent: 'center', gap: 10 } as const,
  viewerHint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: '#FFFFFFAA', textAlign: 'center' } as const,
  viewerNav: { flexDirection: 'row', gap: 10 } as const,
  viewerNavBtn: { flex: 1, backgroundColor: '#FFFFFF1A', borderRadius: R.md, paddingVertical: 13, alignItems: 'center' } as const,
  viewerNavOff: { opacity: 0.3 } as const,
  viewerNavBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: '#fff' } as const,
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1.5, borderColor: C.lineSoft, padding: 12 } as const,
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.faint, alignItems: 'center', justifyContent: 'center' } as const,
  radioOn: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent } as const,
  optT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14.5, color: C.ink } as const,
  optS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted, marginTop: 1 } as const,
  mini: { backgroundColor: C.paper, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 } as const,
  miniWide: { backgroundColor: C.card, borderRadius: R.lg, paddingVertical: 11, alignItems: 'center' } as const,
  miniT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.accentInk } as const,
  pickerDone: { marginTop: 12, backgroundColor: C.accent, borderRadius: R.md, paddingVertical: 12, paddingHorizontal: 28 } as const,
  pickerDoneT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.onInk } as const,
});
