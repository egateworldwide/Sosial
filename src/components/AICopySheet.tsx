import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R } from '../theme';
import { Txt, PrimaryBtn, GhostBtn, Stepper, PillToggle, Section, Field, SocialGlyph } from './ui';
import {
  SocialBrief, SocialResult, SocialTone, SocialPlatform,
  DEFAULT_SOCIAL_BRIEF, SOCIAL_TONES, SOCIAL_PLATFORMS, generateSocial, capFor,
} from '../utils/ai/social';
import { getAiKey, setAiKey } from '../utils/ai/key';
import { loadAccount } from '../utils/account';

/**
 * Caption + thread writer. Real Gemini when a key is saved, offline draft engine
 * otherwise. Apply hands the copy back to the Create page, which decides whether
 * to drop it into an idea or straight into the new-post composer.
 */
export default function AICopySheet({ visible, initialPrompt = '', onClose, onApply }: {
  visible: boolean;
  initialPrompt?: string;
  onClose: () => void;
  onApply: (result: SocialResult, brief: SocialBrief) => void;
}) {
  const { C } = useTheme();
  const st = makeSt(C);
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState<SocialTone>(DEFAULT_SOCIAL_BRIEF.tone);
  const [thread, setThread] = useState(true);
  const [parts, setParts] = useState(DEFAULT_SOCIAL_BRIEF.parts);
  const [hashtags, setHashtags] = useState(true);
  const [platform, setPlatform] = useState<SocialPlatform>('any');
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<SocialResult | null>(null);
  const [plan, setPlan] = useState<'free' | 'pro' | 'team'>('free');
  const aiLocked = plan === 'free';

  useEffect(() => {
    if (!visible) return;
    setPrompt(initialPrompt);
    setResult(null);
    setErr('');
    getAiKey().then((k) => {
      setKey(k ?? '');
      setHasKey(!!k);
    });
    loadAccount().then((a) => setPlan(a.plan));
  }, [visible, initialPrompt]);

  const brief: SocialBrief = {
    prompt, language: 'English', tone,
    thread, parts, hashtags, platform,
  };

  const run = async () => {
    if (aiLocked) return;
    if (!prompt.trim()) {
      setErr('Tell the AI what to write about.');
      return;
    }
    setErr('');
    setResult(null);
    setBusy(true);
    try {
      setResult(await generateSocial(brief));
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    await setAiKey(key);
    setHasKey(!!key.trim());
  };

  const close = () => {
    setResult(null);
    setErr('');
    onClose();
  };

  const apply = () => {
    if (!result) return;
    onApply(result, brief);
    close();
  };

  const limit = capFor(platform);
  const hasCopy = !!result && (result.caption.trim().length > 0 || result.thread.length > 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <TouchableOpacity activeOpacity={1} onPress={close} style={st.bg}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={st.sheet}>
            <ScrollView
              style={{ flexShrink: 1 }}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: 12 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="sparkles" size={19} color={C.accent} />
                <Text style={st.title}>Write with AI</Text>
              </View>
              <Text style={st.sub}>
                A caption, or a thread that reads like a story — hook, one idea per post, real payoff. No "1/" or "🧵".
              </Text>

              <Field label="What's it about?" hint="A rough thought is enough.">
                <Txt
                  value={prompt}
                  onChangeText={setPrompt}
                  placeholder="e.g. why I stopped chasing viral hacks and started posting one honest update a day…"
                  multiline
                  style={{ minHeight: 78, textAlignVertical: 'top' }}
                />
              </Field>

              <Section no="01" title="Voice" hint="How it should sound." />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {SOCIAL_TONES.map((t) => {
                  const on = tone === t.id;
                  return (
                    <TouchableOpacity key={t.id} onPress={() => setTone(t.id)} style={[st.chip, on && { backgroundColor: C.ink, borderColor: C.ink }]} activeOpacity={0.75}>
                      <Text style={[st.chipT, on && { color: C.onInk }]}>{t.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Section no="02" title="Format" hint="One caption, or a connected thread." />
              <View style={st.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={st.toggleT}>Post as a thread</Text>
                  <Text style={st.toggleS}>Storytelling chain — {limit} chars per post</Text>
                </View>
                <PillToggle on={thread} onPress={() => setThread((v) => !v)} />
              </View>
              {thread ? (
                <Field label="Posts" hint={`~${parts}`}>
                  <Stepper value={parts} onChange={setParts} step={1} min={2} max={12} format={(v) => `${v}`} />
                </Field>
              ) : null}

              <View style={st.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={st.toggleT}>Add hashtags</Text>
                  <Text style={st.toggleS}>Kept separate from the copy</Text>
                </View>
                <PillToggle on={hashtags} onPress={() => setHashtags((v) => !v)} />
              </View>

              <Field label="Best for" hint="Sets the character cap.">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {SOCIAL_PLATFORMS.map((p) => {
                    const on = platform === p.id;
                    return (
                      <TouchableOpacity key={p.id} onPress={() => setPlatform(p.id)} style={[st.plat, on && { backgroundColor: C.accentSoft, borderColor: C.accent }]} activeOpacity={0.75}>
                        {p.id === 'any' ? (
                          <Ionicons name="globe-outline" size={13} color={on ? C.accentInk : C.muted} />
                        ) : (
                          <SocialGlyph platform={p.id} size={12} color={on ? C.accentInk : C.muted} />
                        )}
                        <Text style={[st.platT, on && { color: C.accentInk }]}>{p.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Field>

              <Section no="03" title="Model" hint={hasKey ? 'Gemini 2.5 Flash — your key, your bill.' : 'No key yet — the offline draft engine fills in.'} />
              <Field label="Gemini API key" hint="Free from Google AI Studio. Stays on this device.">
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Txt value={key} onChangeText={setKey} placeholder="AIza…" secureTextEntry autoCapitalize="none" autoCorrect={false} />
                  </View>
                  <TouchableOpacity onPress={saveKey} style={[st.keyBtn, hasKey && { backgroundColor: C.accentSoft }]} activeOpacity={0.8}>
                    <Text style={[st.keyBtnT, hasKey && { color: C.accentInk }]}>{hasKey ? 'Saved ✓' : 'Save'}</Text>
                  </TouchableOpacity>
                </View>
              </Field>

              {aiLocked ? (
                <View style={st.lockBox}>
                  <Ionicons name="lock-closed" size={16} color={C.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.lockT}>AI writing is a Pro & Team feature.</Text>
                    <Text style={st.lockS}>Upgrade in Profile → Account to write captions and threads with AI.</Text>
                  </View>
                </View>
              ) : (
                <TouchableOpacity onPress={run} disabled={busy} style={[st.genBtn, busy && { opacity: 0.6 }]} activeOpacity={0.85}>
                  <Ionicons name="sparkles" size={15} color={C.onInk} />
                  <Text style={st.genT}>{busy ? 'Writing…' : result ? 'Write again' : 'Write it'}</Text>
                </TouchableOpacity>
              )}
              {err ? <Text style={st.err}>{err}</Text> : null}

              {result ? (
                <View style={{ gap: 10, marginTop: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name={hasCopy ? 'checkmark-circle' : 'alert-circle'} size={18} color={hasCopy ? '#22C55E' : C.redText} />
                    <Text style={st.previewT}>
                      {result.thread.length > 1 ? `${result.thread.length}-post thread` : 'Caption'} · {result.provider}
                    </Text>
                  </View>

                  {result.warnings.map((w, i) => (
                    <Text key={i} style={st.warn}>• {w}</Text>
                  ))}

                  {result.thread.length > 1 ? (
                    <View style={{ gap: 8 }}>
                      {result.thread.map((seg, i) => (
                        <View key={i} style={st.seg}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={st.segNo}>Post {i + 1}</Text>
                            <Text style={[st.segCount, seg.length > limit && { color: C.redText }]}>{seg.length}/{limit}</Text>
                          </View>
                          <Text style={st.segT}>{seg}</Text>
                        </View>
                      ))}
                    </View>
                  ) : result.caption ? (
                    <View style={st.seg}>
                      <Text style={st.segT}>{result.caption}</Text>
                    </View>
                  ) : null}

                  {result.hashtags.length > 0 ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {result.hashtags.map((h) => (
                        <View key={h} style={st.tag}><Text style={st.tagT}>{h}</Text></View>
                      ))}
                    </View>
                  ) : null}

                  {hasCopy ? (
                    <PrimaryBtn
                      label={result.thread.length > 1 ? `Use this thread (${result.thread.length})` : 'Use this caption'}
                      onPress={apply}
                    />
                  ) : null}
                </View>
              ) : null}

              <View style={{ marginTop: 2 }}>
                <GhostBtn label="Close" onPress={close} />
              </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeSt = (C: Palette) => StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.paper, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 30, maxHeight: '92%' },
  title: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 18, letterSpacing: -0.3, color: C.ink },
  sub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 19, color: C.muted },
  chip: { borderRadius: 999, paddingHorizontal: 15, paddingVertical: 9, backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft },
  chipT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.muted },
  plat: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.lineSoft },
  platT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.muted },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.lg, paddingHorizontal: 15, paddingVertical: 13 },
  toggleT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.ink },
  toggleS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.muted, marginTop: 2 },
  genBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: C.ink, borderRadius: 999, paddingVertical: 12 },
  genT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.onInk },
  lockBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: R.lg, paddingHorizontal: 15, paddingVertical: 13 },
  lockT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.ink },
  lockS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.muted, marginTop: 2 },
  keyBtn: { backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 16, justifyContent: 'center' },
  keyBtnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.onInk },
  previewT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.ink },
  warn: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, lineHeight: 18, color: C.muted },
  err: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.redText },
  seg: { backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.lineSoft, padding: 12, gap: 5 },
  segNo: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, letterSpacing: 0.4, color: C.accentInk },
  segCount: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.faint },
  segT: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13.5, lineHeight: 20, color: C.soft },
  tag: { backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  tagT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.accentInk },
});
