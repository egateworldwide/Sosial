import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R, T } from '../theme';
import { SocialGlyph, Txt } from '../components/ui';
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
import { loginX, completeXLogin } from '../utils/xAuth';
import { X_CLIENT_ID } from '../utils/xConfig';
import { completeBskyLogin } from '../utils/bskyAuth';
import { loginMastodon, completeMastodonLogin } from '../utils/mastodonAuth';
import { loginLinkedIn, completeLiLogin, listMyLiOrgs, pickLiOrg, LiOrg } from '../utils/liAuth';
import { LI_CLIENT_ID } from '../utils/liConfig';
import { loginYouTube, completeYtLogin } from '../utils/ytAuth';
import { YT_CLIENT_ID } from '../utils/ytConfig';
import { loginPinterest, completePinLogin } from '../utils/pinAuth';
import { PIN_CLIENT_ID } from '../utils/pinConfig';
import { listPinBoards, PinBoard } from '../utils/pinPublish';
import { BUILD_TAG } from '../utils/build';
import { subscribeAuthResult, flushAuthResults, clearPendingAuth, getPendingAuth, wasCodeDone, markCodeDone, AuthResult } from '../utils/authFlow';
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
  const [photoHost, setPhotoHost] = useState('');
  const [bskyHandle, setBskyHandle] = useState('');
  const [bskyPass, setBskyPass] = useState('');
  const [mastodonInstance, setMastodonInstance] = useState('');
  const [pinBoards, setPinBoards] = useState<PinBoard[] | null>(null);
  const [pinBoardsLoading, setPinBoardsLoading] = useState(false);
  const [liOrgs, setLiOrgs] = useState<LiOrg[]>([]);
  useEffect(() => {
    loadMetaState().then((m) => { setMeta(m); setPhotoHost(m.ttPhotoHost ?? ''); });
  }, []);

  const completeRef = useRef<(r: AuthResult) => void>(() => {});
  const lastCodeRef = useRef<string | null>(null);
  // Synchronous in-flight claim: the same return URL can arrive twice in the
  // same tick (browser-session result + OS link event). Providers burn codes
  // on first redeem, so without this both redemptions run and the loser pops
  // a scary "login failed" over an already-connected account.
  const claimingRef = useRef<Set<string>>(new Set());

  /** Finishes an OAuth login no matter which app instance received the code —
   *  the one that opened the browser, or a fresh one after Expo Go reloaded. */
  const completeAuth = async (r: AuthResult) => {
    // the same return URL can arrive twice (browser-session result + OS link
    // event, or a replay after an Expo Go reload) — providers burn codes on
    // first redeem, so a second exchange of the same code always fails with
    // "authorization code was invalid"
    if (r.code) {
      if (lastCodeRef.current === r.code || claimingRef.current.has(r.code)) {
        await clearPendingAuth();
        return;
      }
      claimingRef.current.add(r.code);
      lastCodeRef.current = r.code;
      if (await wasCodeDone(r.code)) {
        await clearPendingAuth();
        return;
      }
    }
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
      } else if (r.channel === 'x') {
        const { name } = await completeXLogin(r.code);
        setMeta(await loadMetaState());
        setOpenCh('x');
        if (!name) Alert.alert('Connected', 'X connected — we couldn’t read the handle yet.');
      } else if (r.channel === 'mastodon') {
        const { name } = await completeMastodonLogin(r.code);
        setMeta(await loadMetaState());
        setOpenCh('mastodon');
        if (!name) Alert.alert('Connected', 'Mastodon connected — we couldn’t read the handle yet.');
      } else if (r.channel === 'linkedin') {
        const { name } = await completeLiLogin(r.code);
        setMeta(await loadMetaState());
        setOpenCh('linkedin');
        try {
          const orgs = await listMyLiOrgs();
          setLiOrgs(orgs);
          if (orgs.length === 0) {
            Alert.alert('No Company Pages found', 'Posting as yourself — admin a LinkedIn Page to post as the business.');
          }
        } catch {
          // org list needs the Marketing Developer Platform product; member
          // posting + stats still work, the picker just stays empty.
        }
        if (!name) Alert.alert('Connected', 'LinkedIn connected — we couldn’t read the name yet.');
      } else if (r.channel === 'youtube') {
        const { name } = await completeYtLogin(r.code);
        setMeta(await loadMetaState());
        setOpenCh('youtube');
        if (!name) Alert.alert('Connected', 'YouTube connected — we couldn’t read the channel yet.');
      } else if (r.channel === 'pinterest') {
        const { name } = await completePinLogin(r.code);
        setMeta(await loadMetaState());
        setOpenCh('pinterest');
        setPinBoards(null);
        void loadPinBoards();
        if (!name) Alert.alert('Connected', 'Pinterest connected — we couldn’t read the handle yet. Pick a board below.');
      }
      if (r.code) await markCodeDone(r.code);
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

  const backedOut = (label: string) => {
    setBusy(null);
    Alert.alert(
      `${label} login closed`,
      'If the browser showed a login page instead of a permission screen, sign in there — after that one sign-in, Connect goes straight through every time.'
    );
  };

  const doFacebook = async () => {
    setBusy('Opening Facebook…');
    if (!(await loginFacebook())) backedOut('Facebook');
  };

  const doInstagram = async () => {
    setBusy('Opening Instagram…');
    if (!(await loginInstagram())) backedOut('Instagram');
  };

  const doThreads = async () => {
    setBusy('Opening Threads…');
    if (!(await loginThreads())) backedOut('Threads');
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
    if (!ttConfigured) {
      Alert.alert('Keys missing', 'TikTok client key is empty — check .env, then restart Expo (env loads at startup).');
      return;
    }
    setBusy('Opening TikTok…');
    if (!(await loginTikTok())) backedOut('TikTok');
  };

  const disconnectTikTok = async () => {
    const st = await saveMetaState({
      ttAccessToken: undefined, ttRefreshToken: undefined, ttExpiresAt: undefined,
      ttOpenId: undefined, ttName: undefined,
    });
    setMeta(st);
    setOpenCh(null);
  };

  const doX = async () => {
    setBusy('Opening X…');
    if (!(await loginX())) backedOut('X');
  };

  const disconnectX = async () => {
    const st = await saveMetaState({
      xAccessToken: undefined, xRefreshToken: undefined, xExpiresAt: undefined,
      xUserId: undefined, xName: undefined,
    });
    setMeta(st);
    setOpenCh(null);
  };

  const doBsky = async () => {
    setBusy('Connecting Bluesky…');
    try {
      const { name } = await completeBskyLogin(bskyHandle, bskyPass);
      setBskyPass('');
      setMeta(await loadMetaState());
      setOpenCh('bluesky');
      if (!name) Alert.alert('Connected', 'Bluesky connected.');
    } catch (e: any) {
      Alert.alert('Bluesky login failed', e?.message ?? 'Try again.');
    } finally {
      setBusy(null);
    }
  };

  const disconnectBsky = async () => {
    const st = await saveMetaState({
      bskyAccessJwt: undefined, bskyRefreshJwt: undefined, bskyExpiresAt: undefined,
      bskyDid: undefined, bskyHandle: undefined, bskyName: undefined, bskyPdsHost: undefined,
    });
    setMeta(st);
    setOpenCh(null);
  };

  const doMastodon = async () => {
    setBusy('Opening Mastodon…');
    try {
      if (!(await loginMastodon(mastodonInstance))) backedOut('Mastodon');
    } catch (e: any) {
      setBusy(null);
      Alert.alert('Mastodon login failed', e?.message ?? 'Try again.');
    }
  };

  const disconnectMastodon = async () => {
    const st = await saveMetaState({
      mastodonAccessToken: undefined, mastodonInstance: undefined,
      mastodonAccountId: undefined, mastodonName: undefined,
    });
    setMeta(st);
    setOpenCh(null);
  };

  const doLinkedin = async () => {
    if (!liConfigured) {
      Alert.alert('Keys missing', 'Paste the Client ID + secret into .env first, then reload.');
      return;
    }
    setBusy('Opening LinkedIn…');
    try {
      if (!(await loginLinkedIn())) backedOut('LinkedIn');
    } catch (e: any) {
      setBusy(null);
      Alert.alert('LinkedIn login failed', e?.message ?? 'Try again.');
    }
  };

  const disconnectLinkedin = async () => {
    const st = await saveMetaState({
      liAccessToken: undefined, liRefreshToken: undefined, liExpiresAt: undefined,
      liPersonUrn: undefined, liName: undefined, liOrgId: undefined, liOrgName: undefined,
    });
    setMeta(st);
    setLiOrgs([]);
    setOpenCh(null);
  };

  const loadLiOrgs = async () => {
    setBusy('Loading Pages…');
    try {
      setLiOrgs(await listMyLiOrgs());
    } catch (e: any) {
      Alert.alert('Failed', e?.message ?? 'Could not load Company Pages.');
    } finally {
      setBusy(null);
    }
  };

  const doYoutube = async () => {
    if (!ytConfigured) {
      Alert.alert('Keys missing', 'Paste the Client ID + secret into .env first, then reload.');
      return;
    }
    setBusy('Opening Google…');
    try {
      if (!(await loginYouTube())) backedOut('YouTube');
    } catch (e: any) {
      setBusy(null);
      Alert.alert('YouTube login failed', e?.message ?? 'Try again.');
    }
  };

  const disconnectYoutube = async () => {
    const st = await saveMetaState({
      ytAccessToken: undefined, ytRefreshToken: undefined, ytExpiresAt: undefined,
      ytChannelName: undefined,
    });
    setMeta(st);
    setOpenCh(null);
  };

  const doPinterest = async () => {
    if (!pinConfigured) {
      Alert.alert('Keys missing', 'Paste the App ID + secret into .env first, then reload.');
      return;
    }
    setBusy('Opening Pinterest…');
    try {
      if (!(await loginPinterest())) backedOut('Pinterest');
    } catch (e: any) {
      setBusy(null);
      Alert.alert('Pinterest login failed', e?.message ?? 'Try again.');
    }
  };

  const disconnectPinterest = async () => {
    const st = await saveMetaState({
      pinAccessToken: undefined, pinRefreshToken: undefined, pinExpiresAt: undefined,
      pinUsername: undefined, pinBoardId: undefined, pinBoardName: undefined,
    });
    setMeta(st);
    setPinBoards(null);
    setOpenCh(null);
  };

  const loadPinBoards = async () => {
    setPinBoardsLoading(true);
    try {
      const boards = await listPinBoards();
      setPinBoards(boards);
      if (boards.length === 0) Alert.alert('No boards yet', 'Create a board in Pinterest first, then pick it here.');
    } catch (e: any) {
      Alert.alert('Couldn’t load boards', e?.message ?? 'Try again.');
    } finally {
      setPinBoardsLoading(false);
    }
  };

  const pickPinBoard = async (b: PinBoard) => {
    setMeta(await saveMetaState({ pinBoardId: b.id, pinBoardName: b.name }));
  };

  const savePhotoHost = async () => {
    const v = photoHost.trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//i.test(v)) {
      Alert.alert('Invalid URL', 'Use a full URL like https://media.example.com/upload');
      return;
    }
    const st = await saveMetaState({ ttPhotoHost: v || undefined });
    setMeta(st);
    setPhotoHost(st.ttPhotoHost ?? '');
    Alert.alert(v ? 'Saved' : 'Cleared', v ? 'TikTok photo posts will upload here.' : 'TikTok photo posts are disabled until you set a host.');
  };

  const configured = META_APP_ID.length > 0;
  const ttConfigured = TT_CLIENT_KEY.length > 0 && !TT_CLIENT_KEY.startsWith('PASTE_');
  const xConfigured = X_CLIENT_ID.length > 0 && !X_CLIENT_ID.startsWith('PASTE_');
  const liConfigured = LI_CLIENT_ID.length > 0 && !LI_CLIENT_ID.startsWith('PASTE_');
  const ytConfigured = YT_CLIENT_ID.length > 0 && !YT_CLIENT_ID.startsWith('PASTE_');
  const pinConfigured = PIN_CLIENT_ID.length > 0 && !PIN_CLIENT_ID.startsWith('PASTE_');
  const fbOn = !!meta.fbUserToken;
  const igOn = !!(meta.igId && meta.igToken);
  const thOn = !!(meta.threadsId && meta.threadsToken);
  const ttOn = !!(meta.ttOpenId && (meta.ttAccessToken || meta.ttRefreshToken));
  const xOn = !!(meta.xUserId && (meta.xAccessToken || meta.xRefreshToken));
  const bskyOn = !!(meta.bskyDid && (meta.bskyAccessJwt || meta.bskyRefreshJwt));
  const mastodonOn = !!(meta.mastodonAccessToken && meta.mastodonInstance);
  const liOn = !!(meta.liPersonUrn && (meta.liAccessToken || meta.liRefreshToken));
  const ytOn = !!(meta.ytRefreshToken || meta.ytAccessToken);
  const pinOn = !!meta.pinAccessToken;

  const tap = (ch: 'facebook' | 'instagram' | 'threads' | 'tiktok' | 'x' | 'bluesky' | 'mastodon' | 'linkedin' | 'youtube' | 'pinterest', connected: boolean, connect: () => void) => {
    if (!connected) connect();
    else setOpenCh(openCh === ch ? null : ch);
  };

  /* Channel sections as sortable elements — connected rows float to the top
   * (stable sort keeps the original order inside each group). */
  const rowFacebook = (<React.Fragment>
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
  </React.Fragment>);

  const rowInstagram = (<React.Fragment>
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
  </React.Fragment>);

  const rowThreads = (<React.Fragment>
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
  </React.Fragment>);

  const rowTiktok = (<React.Fragment>
    <TouchableOpacity onPress={() => tap('tiktok', ttOn, () => void doTikTok())} style={[s.row, s.rowDiv]} activeOpacity={0.7}>
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
  </React.Fragment>);

  const rowX = (<React.Fragment>
    <TouchableOpacity onPress={() => tap('x', xOn, () => { if (xConfigured) void doX(); })} style={[s.row, s.rowDiv]} activeOpacity={0.7}>
      <ChannelIcon platform="x" />
      <View style={{ flex: 1 }}>
        <Text style={s.rowT}>X</Text>
        <Text style={s.rowS} numberOfLines={1}>{meta.xName ?? (xOn ? 'Connected' : 'Tap to connect')}</Text>
      </View>
      {xOn ? (
        <Ionicons name={openCh === 'x' ? 'chevron-up' : 'chevron-down'} size={18} color={C.faint} />
      ) : (
        <Text style={s.go}>Connect</Text>
      )}
    </TouchableOpacity>
    {xOn && openCh === 'x' ? (
      <View style={s.sub}>
        <TouchableOpacity onPress={disconnectX} activeOpacity={0.7} style={s.disc}>
          <Text style={s.discT}>Disconnect X</Text>
        </TouchableOpacity>
      </View>
    ) : null}
  </React.Fragment>);

  const rowBluesky = (<React.Fragment>
    <TouchableOpacity onPress={() => tap('bluesky', bskyOn, () => setOpenCh((v) => (v === 'bluesky' ? null : 'bluesky')))} style={[s.row, s.rowDiv]} activeOpacity={0.7}>
      <ChannelIcon platform="bluesky" />
      <View style={{ flex: 1 }}>
        <Text style={s.rowT}>Bluesky</Text>
        <Text style={s.rowS} numberOfLines={1}>{meta.bskyName ?? (bskyOn ? 'Connected' : 'Handle + app password')}</Text>
      </View>
      {bskyOn ? (
        <Ionicons name={openCh === 'bluesky' ? 'chevron-up' : 'chevron-down'} size={18} color={C.faint} />
      ) : (
        <Text style={s.go}>Connect</Text>
      )}
    </TouchableOpacity>
    {openCh === 'bluesky' ? (
      <View style={s.sub}>
        {bskyOn ? (
          <TouchableOpacity onPress={disconnectBsky} activeOpacity={0.7} style={s.disc}>
            <Text style={s.discT}>Disconnect Bluesky</Text>
          </TouchableOpacity>
        ) : (
          <>
            <View style={s.bskyField}>
              <Txt
                value={bskyHandle}
                onChangeText={setBskyHandle}
                placeholder="yourname"
                autoCapitalize="none"
                autoCorrect={false}
                style={{ flex: 1, backgroundColor: 'transparent', paddingHorizontal: 0 }}
              />
              {!bskyHandle.includes('.') ? <Text style={s.bskySuffix}>.bsky.social</Text> : null}
            </View>
            <Txt value={bskyPass} onChangeText={setBskyPass} placeholder="xxxx-xxxx-xxxx-xxxx" autoCapitalize="none" autoCorrect={false} secureTextEntry />
            <View style={s.helpCard}>
              <Text style={s.helpTitle}>How to get your app password</Text>
              {[
                'Bluesky → Settings → Privacy and security → App passwords',
                'Press “+ Add App Password”',
                'Name it “Sosial”',
                'Tick “Allow access to your direct messages”',
                'Copy the one-time password and paste it above',
              ].map((step, i) => (
                <View key={i} style={s.helpStep}>
                  <Text style={s.helpNum}>{i + 1}</Text>
                  <Text style={s.helpText}>{step}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity onPress={doBsky} activeOpacity={0.7} style={s.pageRow}>
              <Text style={s.pageT}>Connect Bluesky</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    ) : null}
  </React.Fragment>);

  const rowMastodon = (<React.Fragment>
    <TouchableOpacity onPress={() => tap('mastodon', mastodonOn, () => setOpenCh((v) => (v === 'mastodon' ? null : 'mastodon')))} style={[s.row, s.rowDiv]} activeOpacity={0.7}>
      <ChannelIcon platform="mastodon" />
      <View style={{ flex: 1 }}>
        <Text style={s.rowT}>Mastodon</Text>
        <Text style={s.rowS} numberOfLines={1}>{meta.mastodonName ?? (mastodonOn ? 'Connected' : 'Username + login')}</Text>
      </View>
      {mastodonOn ? (
        <Ionicons name={openCh === 'mastodon' ? 'chevron-up' : 'chevron-down'} size={18} color={C.faint} />
      ) : (
        <Text style={s.go}>Connect</Text>
      )}
    </TouchableOpacity>
    {openCh === 'mastodon' ? (
      <View style={s.sub}>
        {mastodonOn ? (
          <TouchableOpacity onPress={disconnectMastodon} activeOpacity={0.7} style={s.disc}>
            <Text style={s.discT}>Disconnect Mastodon</Text>
          </TouchableOpacity>
        ) : (
          <>
            <View style={s.bskyField}>
              <Txt
                value={mastodonInstance}
                onChangeText={setMastodonInstance}
                placeholder="username"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={{ flex: 1, backgroundColor: 'transparent', paddingHorizontal: 0 }}
              />
              {!mastodonInstance.includes('.') ? <Text style={s.bskySuffix}>@mastodon.social</Text> : null}
            </View>
            <View style={s.helpCard}>
              <Text style={s.helpTitle}>How to connect Mastodon</Text>
              {[
                'Type your username — or a full server like fosstodon.org',
                'Sign in and approve the app on that server',
                'Posts and analytics then go to your account there',
              ].map((step, i) => (
                <View key={i} style={s.helpStep}>
                  <Text style={s.helpNum}>{i + 1}</Text>
                  <Text style={s.helpText}>{step}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity onPress={doMastodon} activeOpacity={0.7} style={s.pageRow}>
              <Text style={s.pageT}>Connect Mastodon</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    ) : null}
  </React.Fragment>);

  const rowLinkedin = (<React.Fragment>
    <TouchableOpacity onPress={() => tap('linkedin', liOn, () => { if (liConfigured) void doLinkedin(); })} style={[s.row, s.rowDiv]} activeOpacity={0.7}>
      <ChannelIcon platform="linkedin" />
      <View style={{ flex: 1 }}>
        <Text style={s.rowT}>LinkedIn</Text>
        <Text style={s.rowS} numberOfLines={1}>{meta.liOrgName ?? meta.liName ?? (liOn ? 'Tap to choose Page' : 'Tap to connect')}</Text>
      </View>
      {liOn ? (
        <Ionicons name={openCh === 'linkedin' ? 'chevron-up' : 'chevron-down'} size={18} color={C.faint} />
      ) : (
        <Text style={s.go}>Connect</Text>
      )}
    </TouchableOpacity>
    {liOn && openCh === 'linkedin' ? (
      <View style={s.sub}>
        {liOrgs.length > 0 ? (
          <React.Fragment>
            <TouchableOpacity
              onPress={async () => { await pickLiOrg(null); setMeta(await loadMetaState()); }}
              style={[s.pageRow, !meta.liOrgId && { borderWidth: 1.5, borderColor: C.accent }]}
              activeOpacity={0.75}
            >
              <Text style={s.pageT} numberOfLines={1}>Post as {meta.liName ?? 'myself'}</Text>
              {!meta.liOrgId ? <Ionicons name="checkmark-circle" size={18} color={C.accent} /> : null}
            </TouchableOpacity>
            {liOrgs.map((o) => {
              const on = meta.liOrgId === o.id;
              return (
                <TouchableOpacity
                  key={o.id}
                  onPress={async () => { await pickLiOrg(o); setMeta(await loadMetaState()); }}
                  style={[s.pageRow, on && { borderWidth: 1.5, borderColor: C.accent }]}
                  activeOpacity={0.75}
                >
                  <Text style={s.pageT} numberOfLines={1}>{o.name}</Text>
                  {on ? <Ionicons name="checkmark-circle" size={18} color={C.accent} /> : null}
                </TouchableOpacity>
              );
            })}
          </React.Fragment>
        ) : (
          <TouchableOpacity onPress={loadLiOrgs} activeOpacity={0.7} style={s.pageRow}>
            <Text style={s.pageT}>Load my Company Pages</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={disconnectLinkedin} activeOpacity={0.7} style={s.disc}>
          <Text style={s.discT}>Disconnect LinkedIn</Text>
        </TouchableOpacity>
      </View>
    ) : null}
  </React.Fragment>);

  const rowYoutube = (<React.Fragment>
    <TouchableOpacity onPress={() => tap('youtube', ytOn, () => { if (ytConfigured) void doYoutube(); })} style={[s.row, s.rowDiv]} activeOpacity={0.7}>
      <ChannelIcon platform="youtube" />
      <View style={{ flex: 1 }}>
        <Text style={s.rowT}>YouTube</Text>
        <Text style={s.rowS} numberOfLines={1}>{meta.ytChannelName ?? (ytOn ? 'Connected' : 'Tap to connect')}</Text>
      </View>
      {ytOn ? (
        <Ionicons name={openCh === 'youtube' ? 'chevron-up' : 'chevron-down'} size={18} color={C.faint} />
      ) : (
        <Text style={s.go}>Connect</Text>
      )}
    </TouchableOpacity>
    {openCh === 'youtube' ? (
      <View style={s.sub}>
        {ytOn ? (
          <TouchableOpacity onPress={disconnectYoutube} activeOpacity={0.7} style={s.disc}>
            <Text style={s.discT}>Disconnect YouTube</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={doYoutube} activeOpacity={0.7} style={s.pageRow}>
            <Text style={s.pageT}>Connect YouTube</Text>
          </TouchableOpacity>
        )}
      </View>
    ) : null}
  </React.Fragment>);

  const rowPinterest = (<React.Fragment>
    <TouchableOpacity onPress={() => tap('pinterest', pinOn, () => { if (pinConfigured) void doPinterest(); })} style={[s.row, s.rowDiv]} activeOpacity={0.7}>
      <ChannelIcon platform="pinterest" />
      <View style={{ flex: 1 }}>
        <Text style={s.rowT}>Pinterest</Text>
        <Text style={s.rowS} numberOfLines={1}>{meta.pinBoardName ?? meta.pinUsername ?? (pinOn ? 'Tap to choose board' : 'Tap to connect')}</Text>
      </View>
      {pinOn ? (
        <Ionicons name={openCh === 'pinterest' ? 'chevron-up' : 'chevron-down'} size={18} color={C.faint} />
      ) : (
        <Text style={s.go}>Connect</Text>
      )}
    </TouchableOpacity>
    {pinOn && openCh === 'pinterest' ? (
      <View style={s.sub}>
        {pinBoardsLoading ? (
          <View style={s.pageRow}><Text style={s.pageT}>Loading boards…</Text></View>
        ) : pinBoards && pinBoards.length > 0 ? (
          pinBoards.map((b) => {
            const on = meta.pinBoardId === b.id;
            return (
              <TouchableOpacity
                key={b.id}
                onPress={() => { void pickPinBoard(b); }}
                style={[s.pageRow, on && { borderWidth: 1.5, borderColor: C.accent }]}
                activeOpacity={0.75}
              >
                <Text style={s.pageT} numberOfLines={1}>{b.name}</Text>
                {on ? <Ionicons name="checkmark-circle" size={18} color={C.accent} /> : null}
              </TouchableOpacity>
            );
          })
        ) : (
          <TouchableOpacity onPress={loadPinBoards} activeOpacity={0.7} style={s.pageRow}>
            <Text style={s.pageT}>Load my boards</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={disconnectPinterest} activeOpacity={0.7} style={s.disc}>
          <Text style={s.discT}>Disconnect Pinterest</Text>
        </TouchableOpacity>
      </View>
    ) : null}
  </React.Fragment>);

  const orderedChannelRows = [...[
    { id: 'facebook', on: fbOn, el: rowFacebook },
    { id: 'instagram', on: igOn, el: rowInstagram },
    { id: 'threads', on: thOn, el: rowThreads },
    { id: 'tiktok', on: ttOn, el: rowTiktok },
    { id: 'x', on: xOn, el: rowX },
    { id: 'bluesky', on: bskyOn, el: rowBluesky },
    { id: 'mastodon', on: mastodonOn, el: rowMastodon },
    { id: 'linkedin', on: liOn, el: rowLinkedin },
    { id: 'youtube', on: ytOn, el: rowYoutube },
    { id: 'pinterest', on: pinOn, el: rowPinterest },
  ] as { id: string; on: boolean; el: React.ReactNode }[]]
    .sort((a, b) => Number(b.on) - Number(a.on))
    .map((r) => <React.Fragment key={r.id}>{r.el}</React.Fragment>);

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
            <Text style={s.warnT}>Add your Meta App ID in .env first, then reload.</Text>
          </View>
        ) : null}
        {!ttConfigured ? (
          <View style={s.warn}>
            <Text style={s.warnT}>Add your TikTok client key in .env first, then reload.</Text>
          </View>
        ) : null}
        {!xConfigured ? (
          <View style={s.warn}>
            <Text style={s.warnT}>Add your X Client ID in .env first, then reload.</Text>
          </View>
        ) : null}
        {!liConfigured ? (
          <View style={s.warn}>
            <Text style={s.warnT}>Add your LinkedIn Client ID + secret in .env first, then reload.</Text>
          </View>
        ) : null}
        {!ytConfigured ? (
          <View style={s.warn}>
            <Text style={s.warnT}>Add your Google Client ID + secret in .env first, then reload.</Text>
          </View>
        ) : null}
        {!pinConfigured ? (
          <View style={s.warn}>
            <Text style={s.warnT}>Add your Pinterest App ID + secret in .env first, then reload.</Text>
          </View>
        ) : null}

        <View style={s.list}>
          {orderedChannelRows}
        </View>

        <View style={s.hostCard}>
          <Text style={s.uriT}>TikTok photo host</Text>
          <Text style={s.uriU}>TikTok only pulls photos from a domain you verify in its developer portal. Paste your upload endpoint below — it receives the image (multipart field “file”) and returns a public URL.</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Txt
                value={photoHost}
                onChangeText={setPhotoHost}
                placeholder="https://media.example.com/upload"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </View>
            <TouchableOpacity onPress={savePhotoHost} style={s.hostSave} activeOpacity={0.7}>
              <Text style={s.hostSaveT}>Save</Text>
            </TouchableOpacity>
          </View>
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
  bskyField: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: R.md, paddingHorizontal: 13 },
  bskySuffix: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14.5, color: C.muted },
  helpCard: { backgroundColor: C.paper, borderRadius: R.md, borderWidth: 1, borderColor: C.lineSoft, padding: 12, gap: 8 },
  helpTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.ink },
  helpStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  helpNum: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.accentInk, backgroundColor: C.accentSoft, width: 18, height: 18, borderRadius: 9, textAlign: 'center', lineHeight: 18, overflow: 'hidden' },
  helpText: { flex: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, lineHeight: 17, color: C.muted },
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
  hostCard: { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.lineSoft, padding: 14, marginTop: 18, gap: 2 },
  hostSave: { backgroundColor: C.ink, borderRadius: R.md, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  hostSaveT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5, color: C.onInk },
  buildTag: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11, color: C.faint, textAlign: 'center', marginTop: 14, marginBottom: 4 },
});
