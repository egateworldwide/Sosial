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

  useEffect(() => {
    (async () => {
      try {
        const m = await loadMetaState();
        const list: string[] = [];
        if (m.pageId) list.push('facebook');
        if (m.igId) list.push('instagram');
        if (m.threadsId) list.push('threads');
        if (m.ttAccessToken || m.ttRefreshToken) list.push('tiktok');
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
            {connected.map((p, i) => (
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
          </View>
        ) : null}
        <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.accentInk }}>Connect</Text>
      </View>
    </TouchableOpacity>
  );
}
