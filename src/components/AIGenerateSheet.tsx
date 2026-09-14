import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R } from '../theme';
import { Txt, PrimaryBtn, GhostBtn, Seg, Stepper, PillToggle, Section, Field } from './ui';
import { RULES } from '../utils/ai/rules';
import { ContentBrief, DEFAULT_BRIEF, GenResult, TONES, Tone } from '../utils/ai/types';
import { generate } from '../utils/ai/provider';

/** Brief → generate → preview → apply. Mock engine for now (no key yet). */
export default function AIGenerateSheet({ visible, onClose, onApply }: {
  visible: boolean;
  onClose: () => void;
  onApply: (result: GenResult, brief: ContentBrief) => void;
}) {
  const { C } = useTheme();
  const st = makeSt(C);
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState('');
  const [cta, setCta] = useState('');
  const [tone, setTone] = useState<Tone>('friendly');
  const [pages, setPages] = useState(3);
  const [maxWords, setMaxWords] = useState(DEFAULT_BRIEF.maxWordsPerPage);
  const [maxBlocks, setMaxBlocks] = useState(DEFAULT_BRIEF.maxBlocksPerPage);
  const [includeImages, setIncludeImages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);

  const brief: ContentBrief = {
    topic, audience, tone, cta, language: 'English',
    pages, maxWordsPerPage: maxWords, maxBlocksPerPage: maxBlocks, includeImages,
  };

  const run = async () => {
    if (!topic.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await generate(brief));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setResult(null);
    onClose();
  };

  const previewRows = result?.pages ?? [];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <TouchableOpacity activeOpacity={1} onPress={close} style={st.bg}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={st.sheet}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="sparkles" size={19} color={C.accent} />
              <Text style={st.title}>Generate content</Text>
            </View>
            <Text style={st.sub}>
              Your template stays exactly as it is — the AI only fills the content card, then sizes it to fit.
            </Text>

            <Section no="01" title="Brief" hint="The more specific, the better the copy." />
            <Field label="Topic">
              <Txt value={topic} onChangeText={setTopic} placeholder="e.g. 5 habits for better sleep" />
            </Field>
            <Field label="Audience">
              <Txt value={audience} onChangeText={setAudience} placeholder="e.g. busy parents" />
            </Field>
            <Field label="Call to action">
              <Txt value={cta} onChangeText={setCta} placeholder="e.g. Follow for more tips" />
            </Field>
            <Field label="Tone">
              <Seg<Tone> options={TONES.map((t) => ({ value: t.id, label: t.label }))} value={tone} onChange={setTone} />
            </Field>

            <Section no="02" title="Rules" hint="Hard limits the content is always trimmed to." />
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

            <PrimaryBtn label={busy ? 'Generating…' : 'Generate'} onPress={run} />

            {result ? (
              <View style={{ gap: 10, marginTop: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons
                    name={previewRows.length > 0 ? 'checkmark-circle' : 'alert-circle'}
                    size={18}
                    color={previewRows.length > 0 ? '#22C55E' : C.redText}
                  />
                  <Text style={st.previewT}>
                    {previewRows.length} card{previewRows.length === 1 ? '' : 's'} ready · {result.provider}
                  </Text>
                </View>
                {result.warnings.map((w, i) => (
                  <Text key={i} style={st.warn}>• {w}</Text>
                ))}
                {previewRows.map((p, i) => (
                  <View key={i} style={st.preview}>
                    <Text style={st.previewNo}>Card {i + 1}</Text>
                    {p.blocks.map((b, j) => (
                      <Text key={j} style={st.previewB}>
                        {b.type}{b.heading ? ` · ${b.heading}` : ''}
                      </Text>
                    ))}
                  </View>
                ))}
                {previewRows.length > 0 ? (
                  <PrimaryBtn label={`Apply to ${previewRows.length} card${previewRows.length === 1 ? '' : 's'}`} onPress={() => onApply(result, brief)} />
                ) : null}
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
  previewT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: C.ink },
  warn: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, lineHeight: 18, color: C.muted },
  preview: { backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.lineSoft, padding: 12, gap: 3 },
  previewNo: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.accentInk, textTransform: 'uppercase', letterSpacing: 0.5 },
  previewB: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.soft, textTransform: 'capitalize' },
});
