import React, { useState } from 'react';
import { StatusBar, ActivityIndicator, View, Text, BackHandler, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PostProvider, usePost } from './src/store/PostContext';
import HomeScreen, { loadProjects } from './src/screens/HomeScreen';
import SizeScreen from './src/screens/SizeScreen';
import EditorScreen from './src/screens/EditorScreen';
import ExportScreen from './src/screens/ExportScreen';
import ScheduleScreen from './src/screens/ScheduleScreen';
import ConnectScreen from './src/screens/ConnectScreen';
import PrivacyScreen from './src/screens/PrivacyScreen';
import Grain from './src/components/Grain';
import { useFontsLoaded } from './src/utils/fonts';
import { C } from './src/theme';

type Route = 'home' | 'size' | 'editor' | 'export' | 'schedule' | 'privacy' | 'connect';

// Canvas is a fixed-size export artifact — ignore the OS font-size setting
// so it renders pixel-identical on every device (esp. Android). Also kill
// Android's extra font padding, which shifts every line box vs iOS.
(Text as any).defaultProps = { ...((Text as any).defaultProps ?? {}), allowFontScaling: false, includeFontPadding: false };

function Shell() {
  const [route, setRoute] = useState<Route>('home');
  const { loadPost, clearPost, setPageIndex } = usePost();
  const fontsLoaded = useFontsLoaded();
  const routeRef = React.useRef(route);
  routeRef.current = route;

  // phone back button follows the route stack (home exits the app)
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const r = routeRef.current;
      if (r === 'export') {
        setRoute('editor');
        return true;
      }
      if (r === 'connect') {
        setRoute('schedule');
        return true;
      }
      if (r === 'editor' || r === 'schedule' || r === 'size' || r === 'privacy') {
        setRoute('home');
        return true;
      }
      return false;
    });
    return () => sub.remove();
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
        setRoute('schedule');
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

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bone }}>
        <ActivityIndicator size="large" color={C.ink} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: C.bone }}>
        <StatusBar barStyle="dark-content" />
        {route === 'home' ? <HomeScreen onNew={() => { clearPost(); setRoute('size'); }} onOpen={(p) => { loadPost(p); setRoute('editor'); }} onQueue={() => setRoute('schedule')} onPrivacy={() => setRoute('privacy')} /> : null}
        {route === 'size' ? <SizeScreen onDone={() => setRoute('editor')} onBack={() => setRoute('home')} /> : null}
        {route === 'editor' ? <EditorScreen onExport={() => setRoute('export')} onHome={() => setRoute('home')} onPosts={() => setRoute('schedule')} /> : null}
        {route === 'export' ? <ExportScreen onBack={() => setRoute('editor')} /> : null}
        {route === 'schedule' ? <ScheduleScreen onBack={() => setRoute('home')} onConnect={() => setRoute('connect')} /> : null}
        {route === 'privacy' ? <PrivacyScreen onBack={() => setRoute('home')} /> : null}
        {route === 'connect' ? <ConnectScreen onBack={() => setRoute('schedule')} /> : null}
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
    <PostProvider>
      <SafeAreaProvider>
        <Shell />
      </SafeAreaProvider>
    </PostProvider>
  );
}
