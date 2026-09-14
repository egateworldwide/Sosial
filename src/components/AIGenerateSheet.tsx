import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R } from '../theme';
import { Txt, PrimaryBtn, GhostBtn, Stepper, PillToggle, Section, Field } from './ui';
import PostCanvas from './PostCanvas';
import { RULES } from '../utils/ai/rules';
import { ContentBrief, DEFAULT_BRIEF, GenResult } from '../utils/ai/types';
import { generate } from '../utils/ai/provider';
import { applyGenResult } from '../utils/ai/apply';
import { PostPage } from '../types';

/** Prompt → generate → visual preview → apply. Mock engine for now (no key yet). */
export default function AIGenerateSheet({ visible, template, ratio, onClose, onApply }: {
  visible: boolean;
  template: PostPage;
  ratio: number;
  onClose: () => void;
  onApply: (result: GenResult, brief: ContentBrief) => void;
}) {
  const { C } = useTheme();
  const st = makeSt(C);
  const [prompt, setPrompt] = useState('');
  const [pages, setPages] = useState(3);
  const [maxWords, setMaxWords] = useState(DEFAULT_BRIEF.maxWordsPerPage);
  const [maxBlocks, setMaxBlocks] = useState(DEFAULT_BRIEF.maxBlocksPerPage);
  const [includeImages, setIncludeImages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<GenResult | null>(null);

  const brief: ContentBrief = {
    prompt, language: 'English',
    pages, maxWordsPerPage: maxWords, maxBlocksPerPage: maxBlocks, includeImages,
  };

  // real, rendered cards so the preview is never a mystery
  const previewPages: PostPage[] = useMemo(
    () => (result && result.pages.length ? applyGenResult(result, { template, contentScale: template.contentScale ?? 1 }) : []),
    [result, template],
  );

  const run = async () => {
    if (!prompt.trim()) {
      setErr('Type what you want the AI to write about.');
      return;
    }
    setErr('');
    setResult(null);
    setBusy(true);
    try {
      setResult(await generate(brief));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setResult(null);
    setErr('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <TouchableOpacity activeOpacity={1} onPress={close} style={st.bg}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={st.sheet}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="sparkles" size={19} color={C.accent} />
              <Text style={st.title}>Generate content</Text>
            </View>
            <Text style={st.sub}>
              Your template stays exactly as it is — the AI only fills the content card, then sizes it to fit.
            </Text>

            <Field label="Prompt" hint="Describe the content you want.">
              <Txt
                value={prompt}
                onChangeText={setPrompt}
                placeholder="e.g. 5 habits for better sleep, one per card…"
                multiline
                style={{ minHeight: 70, textAlignVertical: 'top' }}
              />
            </Field>

            <Section no="01" title="Rules" hint="Hard limits the content is always trimmed to." />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Field label="Cards" hint={`${pages}`}>
                  <Stepper value={pages} onChange={setPages} step={1} min={RULES.minPages} max={RULES.maxPages} format={(v) => `${v}`} />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Blocks / card" hint={`max ${RULES.maxBlocksPerPage}`}>
                  <Stepper value={maxBlocks} onChange={setMaxBlocks} step={1} min={1} max={RULES.maxBlocksPerPage} format={(v) => `${v}`} />
                </Field>
              </View>
            </View>
            <Field label="Words / card" hint={`${maxWords}`}>
              <Stepper value={maxWords} onChange={setMaxWords} step={5} min={15} max={120} format={(v) => `${v}`} />
            </Field>
            <View style={st.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.toggleT}>Leave image slots</Text>
                <Text style={st.toggleS}>Adds empty image blocks for you to fill and crop</Text>
              </View>
              <PillToggle on={includeImages} onPress={() => setIncludeImages((v) => !v)} />
            </View>

            <TouchableOpacity onPress={run} disabled={busy} style={[st.genBtn, busy && { opacity: 0.6 }]} activeOpacity={0.85}>
              <Ionicons name="sparkles" size={15} color={C.onInk} />
              <Text style={st.genT}>{busy ? 'Generating…' : 'Generate'}</Text>
            </TouchableOpacity>
            {err ? <Text style={st.err}>{err}</Text> : null}

            {result ? (
              <View style={{ gap: 10, marginTop: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons
                    name={previewPages.length > 0 ? 'checkmark-circle' : 'alert-circle'}
                    size={18}
                    color={previewPages.length > 0 ? '#22C55E' : C.redText}
                  />
                  <Text style={st.previewT}>
                    {previewPages.length} card{previewPages.length === 1 ? '' : 's'} ready · {result.provider}
                  </Text>
                </View>

                {result.warnings.map((w, i) => (
                  <Text key={i} style={st.warn}>• {w}</Text>
                ))}

                {previewPages.length > 0 ? (
                  <>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
                      {previewPages.map((p, i) => (
                        <View key={p.id} style={{ alignItems: 'center', gap: 6 }}>
                          <PostCanvas page={p} ratio={ratio} scale={0.3} />
                          <Text style={st.cardNo}>Card {i + 1}</Text>
                        </View>
                      ))}
                    </ScrollView>
                    <PrimaryBtn
                      label={`Use these ${previewPages.length} card${previewPages.length === 1 ? '' : 's'}`}
                      onPress={() => onApply(result, brief)}
                    />
                  </>
                ) : (
                  <Text style={st.warn}>Nothing usable was generated — try a more specific prompt.</Text>
                )}
              </View>
            ) : null}

            <View style={{ marginTop: 2 }}>
              <GhostBtn label="Close" onPress={close} />
            </View>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const makeSt = (C: Palette) => StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.paper, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 30, maxHeight: '92%' },
  title: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 18, letterSpacing: -0.3, color: C.ink },
  sub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 19, color: C.muted },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.lg, paddingHorizontal: 15, paddingVertical: 13 },
  toggleT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.ink },
  toggleS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.muted, marginTop: 2 },
  genBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: C.ink, borderRadius: 999, paddingVertical: 12 },
  genT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.onInk },
  previewT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.ink },
  warn: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, lineHeight: 18, color: C.muted },
  err: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.redText },
  cardNo: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11.5, color: C.muted },
});
