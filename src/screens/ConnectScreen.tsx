import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { C, R, T } from '../theme';
import { PrimaryBtn, GhostBtn, Section } from '../components/ui';
import { META_APP_ID } from '../utils/metaConfig';
import { redirectUri as getRedirectUri } from '../utils/metaAuth';
import { loadMetaState, saveMetaState, MetaState } from '../utils/metaStore';
import {
  useFacebookAuth, exchangeFacebookCode, fetchPages, pickPage, FbPage,
  useThreadsAuth, exchangeThreadsCode, fetchThreadsProfile,
} from '../utils/metaAuth';

/** Link Facebook Page / Instagram / Threads accounts for API publishing. */
export default function ConnectScreen({ onBack }: { onBack: () => void }) {
  const [meta, setMeta] = useState<MetaState>({});
  const [pages, setPages] = useState<FbPage[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const fb = useFacebookAuth();
  const th = useThreadsAuth();

  useEffect(() => {
    loadMetaState().then(setMeta);
  }, []);

  // Facebook login result
  useEffect(() => {
    const r: any = fb.response;
    if (!r) return;
    if (r.type !== 'success') {
      if (r.type === 'error') Alert.alert('Facebook login failed', 'Cancelled or rejected — try again.');
      return;
    }
    (async () => {
      setBusy('Exchanging token…');
      try {
        const token = await exchangeFacebookCode(r.params.code);
        const st = await saveMetaState({
          fbUserToken: token,
          pageId: undefined, pageName: undefined, pageToken: undefined,
          igId: undefined, igName: undefined,
        });
        setMeta(st);
        const pgs = await fetchPages(token);
        setPages(pgs);
        if (pgs.length === 0) Alert.alert('No Pages found', 'Create a Facebook Page you manage first — posts publish as the Page.');
      } catch (e: any) {
        Alert.alert('Facebook login failed', e?.message ?? 'Try again.');
      } finally {
        setBusy(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fb.response]);

  // Threads login result
  useEffect(() => {
    const r: any = th.response;
    if (!r) return;
    if (r.type !== 'success') {
      if (r.type === 'error') Alert.alert('Threads login failed', 'Cancelled or rejected — try again.');
      return;
    }
    (async () => {
      setBusy('Exchanging token…');
      try {
        const { token, userId } = await exchangeThreadsCode(r.params.code);
        let name: string | undefined;
        try {
          const prof = await fetchThreadsProfile(token);
          name = prof.username;
        } catch {}
        const st = await saveMetaState({ threadsToken: token, threadsId: userId, threadsName: name });
        setMeta(st);
      } catch (e: any) {
        Alert.alert('Threads login failed', e?.message ?? 'Try again.');
      } finally {
        setBusy(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [th.response]);

  const disconnectFB = async () => {
    const st = await saveMetaState({
      fbUserToken: undefined, pageId: undefined, pageName: undefined,
      pageToken: undefined, igId: undefined, igName: undefined,
    });
    setMeta(st);
    setPages([]);
  };

  const disconnectThreads = async () => {
    const st = await saveMetaState({ threadsToken: undefined, threadsId: undefined, threadsName: undefined });
    setMeta(st);
  };

  const copyUri = async () => {
    await Clipboard.setStringAsync(getRedirectUri());
    Alert.alert('Copied', 'Paste it into Facebook Login → Valid OAuth redirect URIs (and Threads redirect URIs).');
  };

  const configured = META_APP_ID.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.bone }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={onBack} activeOpacity={0.7} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color={C.ink} />
        </TouchableOpacity>
        <Text style={s.kicker}>Channels</Text>
        <Text style={[T.h1, { color: C.ink, marginTop: 8, fontSize: 30, lineHeight: 36 }]}>Connect</Text>
        <Text style={s.sub}>Log in once — Zap publishes as your Page and profiles. Tokens stay in this phone’s secure storage.</Text>

        {!configured ? (
          <View style={s.warn}>
            <Text style={s.warnT}>Add your Meta App ID in src/utils/metaConfig.ts first, then reload.</Text>
          </View>
        ) : null}

        <View style={s.uriBox}>
          <Text style={s.uriLabel}>Redirect URI — whitelist this in the Meta dashboard</Text>
          <Text style={s.uri} numberOfLines={1}>{getRedirectUri()}</Text>
          <TouchableOpacity onPress={copyUri} style={s.copyBtn} activeOpacity={0.7}>
            <Text style={s.copyT}>Copy</Text>
          </TouchableOpacity>
        </View>

        {/* Facebook + Instagram */}
        <View style={{ marginTop: 22 }}>
          <Section no="01" title="Facebook & Instagram" hint="One login covers both. Posts go out as your Page." />
          {meta.pageId ? (
            <View style={s.status}>
              <Text style={s.statusT} numberOfLines={1}>{meta.pageName ?? 'Page'} {meta.igName ? `· ${meta.igName}` : '· no IG linked'}</Text>
              <TouchableOpacity onPress={disconnectFB} activeOpacity={0.7}><Text style={s.danger}>Disconnect</Text></TouchableOpacity>
            </View>
          ) : (
            <PrimaryBtn label="Connect Facebook & Instagram" onPress={() => configured && fb.promptAsync()} />
          )}
          {pages.length > 0 && !meta.pageId ? (
            <View style={{ gap: 8, marginTop: 12 }}>
              <Text style={s.pickLabel}>Choose the Page to post as:</Text>
              {pages.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={async () => { await pickPage(p); setMeta(await loadMetaState()); }}
                  style={s.pageRow}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.pageT} numberOfLines={1}>{p.name}</Text>
                    <Text style={s.pageS}>{p.instagram_business_account ? `@${p.instagram_business_account.username ?? 'ig'}` : 'No IG linked'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={C.faint} />
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {busy ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <ActivityIndicator color={C.accent} />
              <Text style={s.pageS}>{busy}</Text>
            </View>
          ) : null}
        </View>

        {/* Threads */}
        <View style={{ marginTop: 22 }}>
          <Section no="02" title="Threads" hint="Separate login, same dashboard." />
          {meta.threadsId ? (
            <View style={s.status}>
              <Text style={s.statusT} numberOfLines={1}>{meta.threadsName ?? 'Threads connected'}</Text>
              <TouchableOpacity onPress={disconnectThreads} activeOpacity={0.7}><Text style={s.danger}>Disconnect</Text></TouchableOpacity>
            </View>
          ) : (
            <GhostBtn label="Connect Threads" onPress={() => configured && th.promptAsync()} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  kicker: { ...T.tag, color: C.accent, marginTop: 24 },
  sub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6 },
  warn: { backgroundColor: C.paleRed, borderRadius: R.lg, padding: 14, marginTop: 16 },
  warnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.redText, lineHeight: 19 },
  uriBox: { backgroundColor: C.card, borderRadius: R.lg, padding: 14, gap: 6, marginTop: 16 },
  uriLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.muted },
  uri: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.ink },
  copyBtn: { alignSelf: 'flex-start', backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, marginTop: 4 },
  copyT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: '#fff' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: R.lg, padding: 14 },
  statusT: { flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14.5, color: C.ink },
  danger: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.redText },
  pickLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.muted },
  pageRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: R.lg, padding: 14 },
  pageT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14.5, color: C.ink },
  pageS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted, marginTop: 1 },
});
