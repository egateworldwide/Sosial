import React, { useState } from 'react';
import { StatusBar, ActivityIndicator, View, Text, BackHandler, Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PostProvider, usePost } from './src/store/PostContext';
import { loadProjects } from './src/screens/HomeScreen';
import CreateScreen from './src/screens/CreateScreen';
import PostScreen from './src/screens/PostScreen';
import AnalyticsScreen from './src/screens/AnalyticsScreen';
import AccountScreen from './src/screens/AccountScreen';
import SizeScreen from './src/screens/SizeScreen';
import EditorScreen from './src/screens/EditorScreen';
import ExportScreen from './src/screens/ExportScreen';
import ConnectScreen from './src/screens/ConnectScreen';
import PrivacyScreen from './src/screens/PrivacyScreen';
import BottomNav, { MainTab } from './src/components/BottomNav';
import ProfileMenu from './src/components/ProfileMenu';
import Grain from './src/components/Grain';
import { useFontsLoaded } from './src/utils/fonts';
import { loadAccount, saveAccount, Account } from './src/utils/account';
import { useTheme, ThemeProvider } from './src/theme';

type Route = MainTab | 'size' | 'editor' | 'export' | 'connect' | 'privacy' | 'account';

// Canvas is a fixed-size export artifact — ignore the OS font-size setting
// so it renders pixel-identical on every device (esp. Android). Also kill
// Android's extra font padding, which shifts every line box vs iOS.
(Text as any).defaultProps = { ...((Text as any).defaultProps ?? {}), allowFontScaling: false, includeFontPadding: false };

const TABS: MainTab[] = ['create', 'post', 'analytics'];

function Shell() {
  const { C, mode, toggle } = useTheme();
  const [route, setRoute] = useState<Route>('create');
  const [connectFrom, setConnectFrom] = useState<Route>('post');
  const [privacyFrom, setPrivacyFrom] = useState<Route>('account');
  const [profileOpen, setProfileOpen] = useState(false);
  const [composeSignal, setComposeSignal] = useState(0);
  const [account, setAccount] = useState<Account>({ email: '', team: 'My team', notifPosts: true, notifComments: true, notifWeekly: false });
  const { loadPost, clearPost, setPageIndex } = usePost();
  const fontsLoaded = useFontsLoaded();
  const routeRef = React.useRef(route);
  routeRef.current = route;

  React.useEffect(() => {
    loadAccount().then(setAccount);
  }, []);

  const patchAccount = async (patch: Partial<Account>) => {
    setAccount(await saveAccount(patch));
  };

  const goConnect = (from: Route) => {
    setConnectFrom(from);
    setRoute('connect');
  };

  // phone back button follows the route stack (tabs exit the app)
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const r = routeRef.current;
      if (r === 'export') {
        setRoute('editor');
        return true;
      }
      if (r === 'connect') {
        setRoute(connectFrom);
        return true;
      }
      if (r === 'privacy') {
        setRoute(privacyFrom);
        return true;
      }
      if (r === 'account') {
        setRoute('create');
        return true;
      }
      if (r === 'editor' || r === 'size') {
        setRoute('create');
        return true;
      }
      return false;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openScheduled = async (projectId: string, pageId: string) => {
    try {
      const all = await loadProjects();
      const proj = all.find((p) => p.id === projectId);
      if (!proj) return;
      const idx = proj.pages.findIndex((x) => x.id === pageId);
      loadPost(proj);
      setPageIndex(Math.max(0, idx));
      setRoute('editor');
    } catch {}
  };

  // tapping a reminder deep-links straight to its post (lazy: module throws in Android Go)
  React.useEffect(() => {
    let sub: { remove: () => void } | null = null;
    const openData = async (d: any) => {
      if (!d) return;
      if (d.managedPostId) {
        try {
          await AsyncStorage.setItem('quickpost_open_post', String(d.managedPostId));
        } catch {}
        setRoute('post');
        return;
      }
      if (d.projectId) openScheduled(d.projectId, d.pageId);
    };
    (async () => {
      try {
        // Android Expo Go has no notification module at all — skip silently
        if (Constants.appOwnership === 'expo' && Platform.OS === 'android') return;
        const NN = await import('expo-notifications');
        sub = NN.addNotificationResponseReceivedListener((resp: any) => {
          openData(resp.notification.request.content.data ?? {});
        });
        const last = await NN.getLastNotificationResponseAsync().catch(() => null);
        if (last) openData((last as any)?.notification.request.content.data ?? {});
      } catch {}
    })();
    return () => {
      try {
        sub?.remove();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const composePost = () => {
    setRoute('post');
    setComposeSignal(Date.now());
  };

  const newTemplate = () => {
    clearPost();
    setRoute('size');
  };

  const support = () => {
    Alert.alert('Support', 'Need help? Email pestelbiz@gmail.com and we’ll get back to you.');
  };

  const logout = () => {
    Alert.alert('Logout', 'Sign out on this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        onPress: async () => {
          await patchAccount({ email: '' });
          setRoute('create');
        },
      },
    ]);
  };

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bone }}>
        <ActivityIndicator size="large" color={C.ink} />
      </View>
    );
  }

  const isTab = (TABS as string[]).includes(route);

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: C.bone }}>
        <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
        <View style={{ flex: 1 }}>
          {route === 'create' ? (
            <CreateScreen
              email={account.email}
              team={account.team}
              onProfile={() => setProfileOpen(true)}
              onConnect={() => goConnect('create')}
              onTemplate={newTemplate}
              onOpenProject={(p) => { loadPost(p); setRoute('editor'); }}
              onComposePost={composePost}
              onPost={() => setRoute('post')}
            />
          ) : null}
          {route === 'post' ? (
            <PostScreen
              email={account.email}
              team={account.team}
              onProfile={() => setProfileOpen(true)}
              onConnect={() => goConnect('post')}
              composeSignal={composeSignal}
            />
          ) : null}
          {route === 'analytics' ? (
            <AnalyticsScreen
              email={account.email}
              team={account.team}
              onProfile={() => setProfileOpen(true)}
              onConnect={() => goConnect('analytics')}
            />
          ) : null}
          {route === 'size' ? <SizeScreen onDone={() => setRoute('editor')} onBack={() => setRoute('create')} /> : null}
          {route === 'editor' ? <EditorScreen onExport={() => setRoute('export')} onHome={() => setRoute('create')} onPosts={() => setRoute('post')} /> : null}
          {route === 'export' ? <ExportScreen onBack={() => setRoute('editor')} /> : null}
          {route === 'account' ? (
            <AccountScreen
              email={account.email}
              team={account.team}
              notifPosts={account.notifPosts}
              notifComments={account.notifComments}
              notifWeekly={account.notifWeekly}
              onUpdate={patchAccount}
              onBack={() => setRoute('create')}
              onConnect={() => goConnect('account')}
              onPrivacy={() => { setPrivacyFrom('account'); setRoute('privacy'); }}
              onLoggedOut={() => setRoute('create')}
            />
          ) : null}
          {route === 'privacy' ? <PrivacyScreen onBack={() => setRoute(privacyFrom)} /> : null}
          {route === 'connect' ? <ConnectScreen onBack={() => setRoute(connectFrom)} /> : null}
        </View>
        {isTab ? (
          <BottomNav
            tab={route as MainTab}
            onTab={setRoute}
            onTemplate={newTemplate}
            onPost={composePost}
          />
        ) : null}
        <ProfileMenu
          visible={profileOpen}
          email={account.email}
          team={account.team}
          dark={mode === 'dark'}
          onToggleDark={toggle}
          onClose={() => setProfileOpen(false)}
          onAccount={() => setRoute('account')}
          onSupport={support}
          onLogout={logout}
        />
      </SafeAreaView>
      {/* single film-grain coat over the whole window incl. status/home strips,
          so the strips never read as a different color from the screens */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <Grain />
      </View>
    </View>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <PostProvider>
        <SafeAreaProvider>
          <Shell />
        </SafeAreaProvider>
      </PostProvider>
    </ThemeProvider>
  );
}
