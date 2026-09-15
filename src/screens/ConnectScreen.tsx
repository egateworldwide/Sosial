import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R, T } from '../theme';
import { SocialGlyph } from '../components/ui';
import { SOCIAL_META } from '../constants';
import { META_APP_ID } from '../utils/metaConfig';
import { loadMetaState, saveMetaState, MetaState } from '../utils/metaStore';
import {
  loginFacebook, exchangeFacebookCode, fetchPages, pickPage, FbPage,
  loginInstagram, exchangeInstagramCode, fetchInstagramProfile,
  loginThreads, exchangeThreadsCode, fetchThreadsProfile,
  BRIDGE_URL,
} from '../utils/metaAuth';
import { loginTikTok, completeTikTokLogin } from '../utils/tiktokAuth';
import { BUILD_TAG } from '../utils/build';
import { subscribeAuthResult, flushAuthResults, clearPendingAuth, getPendingAuth, AuthResult } from '../utils/authFlow';
import { IG_APP_ID } from '../utils/metaConfig';
import { TT_CLIENT_KEY } from '../utils/tiktokConfig';

function ChannelIcon({ platform }: { platform: string }) {
  const { C } = useTheme();
  const s = makeS(C);
  return (
    <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: SOCIAL_META[platform]?.bg ?? C.ink, alignItems: 'center', justifyContent: 'center' }}>
      <SocialGlyph platform={platform} size={17} color="#fff" />
    </View>
  );
}

/** One compact row per channel — tap to connect, tap again to manage. */
export default function ConnectScreen({ onBack }: { onBack: () => void }) {
  const { C } = useTheme();
  const s = makeS(C);
  const [meta, setMeta] = useState<MetaState>({});
  const [pages, setPages] = useState<FbPage[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [openCh, setOpenCh] = useState<string | null>(null);
  useEffect(() => {
    loadMetaState().then(setMeta);
  }, []);

  const completeRef = useRef<(r: AuthResult) => void>(() => {});

  /** Finishes an OAuth login no matter which app instance received the code —
   *  the one that opened the browser, or a fresh one after Expo Go reloaded. */
  const completeAuth = async (r: AuthResult) => {
    if (r.error) {
      await clearPendingAuth();
      setBusy(null);
      Alert.alert('Login cancelled', r.error);
      return;
    }
    if (!r.code) {
      await clearPendingAuth();
      setBusy(null);
      return;
    }
    setBusy('Exchanging token…');
    try {
      if (r.channel === 'facebook') {
        const token = await exchangeFacebookCode(r.code);
        const st = await saveMetaState({
          fbUserToken: token,
          pageId: undefined, pageName: undefined, pageToken: undefined,
        });
        setMeta(st);
        const pgs = await fetchPages(token);
        setPages(pgs);
        setOpenCh('facebook');
        if (pgs.length === 0) {
          Alert.alert('No Pages found', 'Create a Facebook Page you manage first — posts publish as the Page.');
        }
      } else if (r.channel === 'instagram') {
        const { token, userId } = await exchangeInstagramCode(r.code);
        let name: string | undefined;
        let id = userId;
        try {
          const prof = await fetchInstagramProfile(token);
          id = prof.id || userId;
          name = prof.username;
        } catch {}
        const st = await saveMetaState({ igToken: token, igId: id, igName: name });
        setMeta(st);
      } else if (r.channel === 'threads') {
        const { token, userId } = await exchangeThreadsCode(r.code);
        let name: string | undefined;
        try {
          const prof = await fetchThreadsProfile(token);
          name = prof.username;
        } catch {}
        const st = await saveMetaState({ threadsToken: token, threadsId: userId, threadsName: name });
        setMeta(st);
      } else if (r.channel === 'tiktok') {
        const { name } = await completeTikTokLogin(r.code);
        setMeta(await loadMetaState());
        setOpenCh('tiktok');
        if (!name) Alert.alert('Connected', 'TikTok connected — we couldn’t read the display name yet.');
      }
    } catch (e: any) {
      const label = r.channel[0].toUpperCase() + r.channel.slice(1);
      Alert.alert(`${label} login failed`, e?.message ?? 'Try again.');
    } finally {
      await clearPendingAuth();
      setBusy(null);
    }
  };
  completeRef.current = completeAuth;

  useEffect(() => {
    const unsub = subscribeAuthResult((r) => { void completeRef.current(r); });
    flushAuthResults((r) => { void completeRef.current(r); });
    getPendingAuth().then((ch) => { if (ch) setBusy('Waiting for login…'); });
    return unsub;
  }, []);

  const doFacebook = async () => {
    setBusy('Opening Facebook…');
    if (!(await loginFacebook())) setBusy(null);
  };

  const doInstagram = async () => {
    setBusy('Opening Instagram…');
    if (!(await loginInstagram())) setBusy(null);
  };

  const doThreads = async () => {
    setBusy('Opening Threads…');
    if (!(await loginThreads())) setBusy(null);
  };

  const loadPages = async () => {
    const st = await loadMetaState();
    if (!st.fbUserToken) return;
    setBusy('Loading Pages…');
    try {
      setPages(await fetchPages(st.fbUserToken));
    } catch (e: any) {
      Alert.alert('Failed', e?.message ?? 'Could not load Pages.');
    } finally {
      setBusy(null);
    }
  };

  const disconnectFB = async () => {
    const st = await saveMetaState({
      fbUserToken: undefined, pageId: undefined, pageName: undefined, pageToken: undefined,
    });
    setMeta(st);
    setPages([]);
    setOpenCh(null);
  };

  const disconnectIG = async () => {
    const st = await saveMetaState({ igToken: undefined, igId: undefined, igName: undefined });
    setMeta(st);
    setOpenCh(null);
  };

  const disconnectThreads = async () => {
    const st = await saveMetaState({ threadsToken: undefined, threadsId: undefined, threadsName: undefined });
    setMeta(st);
    setOpenCh(null);
  };

  const doTikTok = async () => {
    setBusy('Opening TikTok…');
    if (!(await loginTikTok())) setBusy(null);
  };

  const disconnectTikTok = async () => {
    const st = await saveMetaState({
      ttAccessToken: undefined, ttRefreshToken: undefined, ttExpiresAt: undefined,
      ttOpenId: undefined, ttName: undefined,
    });
    setMeta(st);
    setOpenCh(null);
  };

  const configured = META_APP_ID.length > 0;
  const ttConfigured = TT_CLIENT_KEY.length > 0 && !TT_CLIENT_KEY.startsWith('PASTE_');
  const fbOn = !!meta.fbUserToken;
  const igOn = !!(meta.igId && meta.igToken);
  const thOn = !!(meta.threadsId && meta.threadsToken);
  const ttOn = !!(meta.ttOpenId && (meta.ttAccessToken || meta.ttRefreshToken));

  const tap = (ch: 'facebook' | 'instagram' | 'threads' | 'tiktok', connected: boolean, connect: () => void) => {
    if (!connected) connect();
    else setOpenCh(openCh === ch ? null : ch);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bone }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={onBack} activeOpacity={0.7} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color={C.ink} />
        </TouchableOpacity>
        <Text style={s.kicker}>Channels</Text>
        <Text style={[T.h1, { color: C.ink, marginTop: 8, fontSize: 30, lineHeight: 36 }]}>Connect</Text>

        {!configured ? (
          <View style={s.warn}>
            <Text style={s.warnT}>Add your Meta App ID in src/utils/metaConfig.ts first, then reload.</Text>
          </View>
        ) : null}

        <View style={s.list}>
          {/* Facebook */}
          <TouchableOpacity onPress={() => tap('facebook', fbOn, () => { if (configured) void doFacebook(); })} style={s.row} activeOpacity={0.7}>
            <ChannelIcon platform="facebook" />
            <View style={{ flex: 1 }}>
              <Text style={s.rowT}>Facebook</Text>
              <Text style={s.rowS} numberOfLines={1}>{meta.pageName ?? (fbOn ? 'Tap to choose Page' : 'Tap to connect')}</Text>
            </View>
            {fbOn ? (
              <Ionicons name={openCh === 'facebook' ? 'chevron-up' : 'chevron-down'} size={18} color={C.faint} />
            ) : (
              <Text style={s.go}>Connect</Text>
            )}
          </TouchableOpacity>
          {fbOn && openCh === 'facebook' ? (
            <View style={s.sub}>
              {pages.length > 0 ? (
                pages.map((p) => {
                  const on = meta.pageId === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      onPress={async () => { await pickPage(p); setMeta(await loadMetaState()); }}
                      style={[s.pageRow, on && { borderWidth: 1.5, borderColor: C.accent }]}
                      activeOpacity={0.75}
                    >
                      <Text style={s.pageT} numberOfLines={1}>{p.name}</Text>
                      {on ? <Ionicons name="checkmark-circle" size={18} color={C.accent} /> : null}
                    </TouchableOpacity>
                  );
                })
              ) : (
                <TouchableOpacity onPress={loadPages} activeOpacity={0.7} style={s.pageRow}>
                  <Text style={s.pageT}>Load my Pages</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={disconnectFB} activeOpacity={0.7} style={s.disc}>
                <Text style={s.discT}>Disconnect Facebook</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Instagram */}
          <TouchableOpacity onPress={() => tap('instagram', igOn, () => { if (IG_APP_ID) void doInstagram(); })} style={[s.row, s.rowDiv]} activeOpacity={0.7}>
            <ChannelIcon platform="instagram" />
            <View style={{ flex: 1 }}>
              <Text style={s.rowT}>Instagram</Text>
              <Text style={s.rowS} numberOfLines={1}>{meta.igName ?? (igOn ? 'Connected' : 'Tap to connect')}</Text>
            </View>
            {igOn ? (
              <Ionicons name={openCh === 'instagram' ? 'chevron-up' : 'chevron-down'} size={18} color={C.faint} />
            ) : (
              <Text style={s.go}>Connect</Text>
            )}
          </TouchableOpacity>
          {igOn && openCh === 'instagram' ? (
            <View style={s.sub}>
              <TouchableOpacity onPress={disconnectIG} activeOpacity={0.7} style={s.disc}>
                <Text style={s.discT}>Disconnect Instagram</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Threads */}
          <TouchableOpacity onPress={() => tap('threads', thOn, () => { if (configured) void doThreads(); })} style={[s.row, s.rowDiv]} activeOpacity={0.7}>
            <ChannelIcon platform="threads" />
            <View style={{ flex: 1 }}>
              <Text style={s.rowT}>Threads</Text>
              <Text style={s.rowS} numberOfLines={1}>{meta.threadsName ?? (thOn ? 'Connected' : 'Tap to connect')}</Text>
            </View>
            {thOn ? (
              <Ionicons name={openCh === 'threads' ? 'chevron-up' : 'chevron-down'} size={18} color={C.faint} />
            ) : (
              <Text style={s.go}>Connect</Text>
            )}
          </TouchableOpacity>
          {thOn && openCh === 'threads' ? (
            <View style={s.sub}>
              <TouchableOpacity onPress={disconnectThreads} activeOpacity={0.7} style={s.disc}>
                <Text style={s.discT}>Disconnect Threads</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* TikTok */}
          <TouchableOpacity onPress={() => tap('tiktok', ttOn, () => { if (ttConfigured) void doTikTok(); })} style={[s.row, s.rowDiv]} activeOpacity={0.7}>
            <ChannelIcon platform="tiktok" />
            <View style={{ flex: 1 }}>
              <Text style={s.rowT}>TikTok</Text>
              <Text style={s.rowS} numberOfLines={1}>{meta.ttName ?? (ttOn ? 'Connected' : 'Tap to connect')}</Text>
            </View>
            {ttOn ? (
              <Ionicons name={openCh === 'tiktok' ? 'chevron-up' : 'chevron-down'} size={18} color={C.faint} />
            ) : (
              <Text style={s.go}>Connect</Text>
            )}
          </TouchableOpacity>
          {ttOn && openCh === 'tiktok' ? (
            <View style={s.sub}>
              <TouchableOpacity onPress={disconnectTikTok} activeOpacity={0.7} style={s.disc}>
                <Text style={s.discT}>Disconnect TikTok</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {!ttConfigured ? (
            <View style={s.warn}>
              <Text style={s.warnT}>Add your TikTok client key in src/utils/tiktokConfig.ts first, then reload.</Text>
            </View>
          ) : null}

          <View style={s.soonHead}>
            <Text style={s.soonHeadT}>Coming soon</Text>
          </View>
          {['linkedin', 'bluesky', 'youtube', 'mastodon', 'pinterest', 'x'].map((pl) => (
            <TouchableOpacity
              key={pl}
              onPress={() => Alert.alert(`${SOCIAL_META[pl]?.label ?? pl} is coming soon`, 'We’re working on it — connect Facebook, Instagram or Threads for now.')}
              style={[s.row, s.rowDiv, { opacity: 0.75 }]}
              activeOpacity={0.7}
            >
              <ChannelIcon platform={pl} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowT}>{SOCIAL_META[pl]?.label ?? pl}</Text>
                <Text style={s.rowS} numberOfLines={1}>Not yet available</Text>
              </View>
              <View style={s.soon}><Text style={s.soonT}>Soon</Text></View>
            </TouchableOpacity>
          ))}
        </View>

        {busy ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
            <ActivityIndicator color={C.accent} />
            <Text style={s.rowS}>{busy}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          onPress={async () => {
            try {
              await Clipboard.setStringAsync(BRIDGE_URL);
              Alert.alert('Copied', 'Paste this exact URL as a Valid OAuth Redirect URI in every app dashboard.');
            } catch {}
          }}
          style={s.uriCard}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.uriT}>Login redirect URI — tap to copy</Text>
            <Text style={s.uriU} numberOfLines={2}>{BRIDGE_URL}</Text>
          </View>
          <Ionicons name="copy-outline" size={18} color={C.faint} />
        </TouchableOpacity>
        <Text style={s.buildTag}>build {BUILD_TAG}</Text>
      </ScrollView>
    </View>
  );
}

const makeS = (C: Palette) => StyleSheet.create({
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  kicker: { ...T.tag, color: C.accent, marginTop: 24 },
  warn: { backgroundColor: C.paleRed, borderRadius: R.lg, padding: 14, marginTop: 16 },
  warnT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.redText, lineHeight: 19 },
  list: { backgroundColor: C.card, borderRadius: R.lg, overflow: 'hidden', marginTop: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 16, paddingVertical: 14 },
  rowDiv: { borderTopWidth: 1, borderTopColor: C.lineSoft },
  rowT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, letterSpacing: -0.2, color: C.ink },
  rowS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted, marginTop: 1 },
  go: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.accentInk },
  sub: { paddingHorizontal: 16, paddingBottom: 14, gap: 8 },
  pageRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.paper, borderRadius: R.md, borderWidth: 1, borderColor: C.lineSoft, paddingHorizontal: 13, paddingVertical: 11 },
  pageT: { flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.ink },
  disc: { alignItems: 'center', paddingVertical: 10 },
  discT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.redText },
  soonHead: { borderTopWidth: 1, borderTopColor: C.lineSoft, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 2 },
  soonHeadT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: C.faint },
  soon: { backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  soonT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.accentInk },
  uriCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.lineSoft, padding: 14, marginTop: 18 },
  uriT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.ink },
  uriU: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.muted, marginTop: 2 },
  buildTag: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.faint, textAlign: 'center', marginTop: 14, marginBottom: 4 },
});
