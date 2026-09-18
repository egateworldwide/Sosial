import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme';
import { SocialGlyph } from './ui';
import { SOCIAL_META } from '../constants';
import { loadMetaState } from '../utils/metaStore';

/** Masthead Connect pill — shows stacked brand tiles for every connected
 *  channel (single logo when one, overlapped stack when many) + Connect. */
export default function ConnectButton({ onPress }: { onPress: () => void }) {
  const { C } = useTheme();
  const [connected, setConnected] = useState<string[]>([]);
  const MAX_LOGOS = 4;
  const shown = connected.slice(0, MAX_LOGOS);
  const extra = connected.length - shown.length;

  useEffect(() => {
    (async () => {
      try {
        const m = await loadMetaState();
        const list: string[] = [];
        if (m.pageId) list.push('facebook');
        if (m.igId) list.push('instagram');
        if (m.threadsId) list.push('threads');
        if (m.ttAccessToken || m.ttRefreshToken) list.push('tiktok');
        if (m.xUserId && (m.xAccessToken || m.xRefreshToken)) list.push('x');
        if (m.bskyDid && (m.bskyAccessJwt || m.bskyRefreshJwt)) list.push('bluesky');
        if (m.mastodonAccessToken && m.mastodonInstance) list.push('mastodon');
        if (m.pinAccessToken) list.push('pinterest');
        if (m.liPersonUrn && (m.liAccessToken || m.liRefreshToken)) list.push('linkedin');
        if (m.ytRefreshToken || m.ytAccessToken) list.push('youtube');
        setConnected(list);
      } catch {}
    })();
  }, []);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{ backgroundColor: C.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: C.lineSoft }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        {connected.length > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {shown.map((p, i) => (
              <View
                key={p}
                style={{
                  width: 20, height: 20, borderRadius: 10,
                  backgroundColor: SOCIAL_META[p]?.bg ?? C.ink,
                  alignItems: 'center', justifyContent: 'center',
                  marginLeft: i === 0 ? 0 : -7,
                  borderWidth: 1.5, borderColor: C.card,
                }}
              >
                <SocialGlyph platform={p} size={10} color="#fff" />
              </View>
            ))}
            {extra > 0 ? (
              <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12, color: C.muted, marginLeft: 1 }}>+{extra}</Text>
            ) : null}
          </View>
        ) : null}
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.accentInk }}>Connect</Text>
      </View>
    </TouchableOpacity>
  );
}
