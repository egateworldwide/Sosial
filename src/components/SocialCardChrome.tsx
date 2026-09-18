import React, { useState } from 'react';
import { View, Text, Image } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import FontAwesome from '@expo/vector-icons/build/FontAwesome';
import { PostPage } from '../types';
import { F, FontId } from '../utils/fonts';
import { SocialGlyph } from './ui';

interface ChromeProps {
  page: PostPage;
  pad: (v: number) => number;
  /** when true the card hugs its content (auto height) instead of filling the canvas */
  fit?: boolean;
  /** hard ceiling for the auto height — content scales down rather than clipping */
  maxH?: number;
  /** render the "made with Sosial" badge (free-plan watermark) */
  watermark?: boolean;
  children: React.ReactNode;
}

function useChrome(page: PostPage) {
  const firstHandle = page.socials.find((s) => s.visible && s.handle)?.handle || '@yourhandle';
  const uni = page.pfp.username?.trim();
  const name = uni || firstHandle.replace(/^@/, '');
  return { firstHandle, name };
}

function Avatar({ page, pad, size }: { page: PostPage; pad: (v: number) => number; size: number }) {
  const d = pad(size);
  if (page.pfp.uri) {
    return <Image source={{ uri: page.pfp.uri }} style={{ width: d, height: d, borderRadius: d / 2 }} />;
  }
  return (
    <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: d * 0.38 }}>Y</Text>
    </View>
  );
}

/** In-card attribution badge: "made with (logo) Sosial", sized/colored to blend into the chrome. */
function Watermark({ font, pad, size, color }: { font: FontId; pad: (v: number) => number; size: number; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: pad(2), flexShrink: 0 }}>
      <Text style={{ ...F(font), fontSize: pad(size), color }}>made with</Text>
      <Image source={require('../../assets/watermark.png')} style={{ width: pad(size + 1), height: pad(size + 1), borderRadius: pad(2) }} />
      <Text style={{ ...F(font, true), fontSize: pad(size), color }}>Sosial</Text>
    </View>
  );
}

/** Luminance check — dark cards get light chrome ink, light cards get dark. */
function isDarkHex(hex: string): boolean {
  const h = (hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45;
}

/** Auto-fit: measures available body height vs natural content height and
 * scales content down (min 45%) so nothing ever clips out of the fixed card. */
function AutoFit({ style, children, fit, maxH }: { style: any; children: React.ReactNode; fit?: boolean; maxH?: number }) {
  const [avail, setAvail] = useState(0);
  const [natural, setNatural] = useState(0);
  const ratio = avail > 0 && natural > avail + 1 ? Math.max(0.45, avail / natural) : 1;
  const onOuter = (e: any) => {
    const h = e.nativeEvent.layout.height;
    setAvail((p) => (Math.abs(p - h) > 1 ? h : p));
  };
  const onInner = (e: any) => {
    const h = e.nativeEvent.layout.height;
    setNatural((p) => (Math.abs(p - h) > 1 ? h : p));
  };
  const base = fit
    ? { ...style, flex: undefined, minHeight: undefined, flexShrink: 1, maxHeight: maxH, overflow: 'hidden' as const }
    : style;
  return (
    <View onLayout={onOuter} style={[base, ratio < 1 ? { height: Math.max(1, Math.round(natural * ratio)), overflow: 'hidden' } : null]}>
      <View
        onLayout={onInner}
        style={
          ratio < 1
            ? { width: '100%', transform: [{ scale: ratio }], transformOrigin: ['50%', '0%', 0] as any }
            : { width: '100%' }
        }
      >
        {children}
      </View>
    </View>
  );
}

/** Platform-authentic card templates wrapping the content blocks. */
export default function SocialCardChrome({ page, pad, fit, maxH, watermark, children }: ChromeProps) {
  const style = page.cardStyle ?? 'minimal';
  const cardBg = page.cardColor ?? '#FFFFFFF2';
  const { firstHandle, name } = useChrome(page);
  const font = page.font ?? 'inter';
  const dark = isDarkHex(cardBg);
  const ink = dark ? '#FFFFFF' : '#111111';
  const gray = dark ? '#CFC9BD' : '#65676B';
  const faint = dark ? '#A8A29E' : '#B0B3B8';
  const hairline = dark ? '#FFFFFF24' : '#11111114';
  const showCheck = page.verified ?? true;
  const check = (size: number) => showCheck ? <Ionicons name="checkmark-circle" size={pad(size)} color="#1D9BF0" /> : null;
  const rootFlex = fit
    ? { flexShrink: 1 as const, maxHeight: maxH, overflow: 'hidden' as const }
    : { flex: 1 as const, minHeight: 0 as const };

  const bodyPad = pad(13);
  const body = (topExtra: boolean, bottomExtra: boolean) => ({
    padding: bodyPad,
    paddingTop: topExtra ? pad(8) : bodyPad,
    paddingBottom: bottomExtra ? pad(8) : bodyPad,
    gap: pad(10),
    ...rootFlex,
  });

  if (style === 'facebook') {
    return (
      <View style={{ ...rootFlex, backgroundColor: cardBg, borderRadius: pad(8), borderWidth: pad(1), borderColor: '#11111112', overflow: 'hidden' }}>
        {/* author header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: pad(7), paddingHorizontal: pad(12), paddingTop: pad(10) }}>
          <Avatar page={page} pad={pad} size={24} />
          <View style={{ flex: 1, gap: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: pad(4) }}>
              <Text style={{ ...F(font, true), fontSize: pad(9.5), color: ink, flexShrink: 1 }} numberOfLines={1}>{name} {check(9)}</Text>
              {watermark ? <Watermark font={font} pad={pad} size={8} color={gray} /> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Text style={{ ...F(font), fontSize: pad(7.5), color: gray }}>2h · Public</Text>
              <Ionicons name="globe-outline" size={pad(8)} color={gray} />
            </View>
          </View>
          <Ionicons name="ellipsis-horizontal" size={pad(12)} color={gray} />
        </View>
        <AutoFit fit={fit} maxH={maxH} style={body(true, true)}>{children}</AutoFit>
        {/* stats */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: pad(12), paddingBottom: pad(7) }}>
          <View style={{ width: pad(15), height: pad(15), borderRadius: pad(7.5), backgroundColor: '#1877F2', alignItems: 'center', justifyContent: 'center' }}>
            <FontAwesome name="thumbs-up" size={pad(9)} color="#fff" />
          </View>
          <Text style={{ ...F(font), fontSize: pad(8.5), color: gray, marginLeft: 5 }}>1.2K</Text>
          <View style={{ flex: 1 }} />
          <Text style={{ ...F(font), fontSize: pad(8.5), color: gray }}>48 comments · 12 shares</Text>
        </View>
        {/* actions */}
        <View style={{ borderTopWidth: pad(1), borderTopColor: hairline, flexDirection: 'row', paddingVertical: pad(7) }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            <FontAwesome name="thumbs-o-up" size={pad(12)} color={gray} />
            <Text style={{ ...F(font), fontSize: pad(9), color: gray }}>Like</Text>
          </View>
          {[
            { icon: 'chatbubble-outline', label: 'Comment' },
            { icon: 'share-social-outline', label: 'Share' },
          ].map((a) => (
            <View key={a.label} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <Ionicons name={a.icon as any} size={pad(12)} color={gray} />
              <Text style={{ ...F(font), fontSize: pad(9), color: gray }}>{a.label}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (style === 'x') {
    return (
      <View style={{ ...rootFlex, backgroundColor: cardBg, borderRadius: pad(14), borderWidth: pad(1), borderColor: hairline, overflow: 'hidden' }}>
        {/* author header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: pad(7), paddingHorizontal: pad(13), paddingTop: pad(11) }}>
          <Avatar page={page} pad={pad} size={22} />
          <Text style={{ ...F(font, true), fontSize: pad(9), color: ink, flexShrink: 1 }} numberOfLines={1}>
            {name} {check(9)}
          </Text>
          <Text style={{ ...F(font), fontSize: pad(8.5), color: gray, flexShrink: 1 }} numberOfLines={1}>
            {firstHandle} · 2h
          </Text>
          {watermark ? <Watermark font={font} pad={pad} size={8} color={gray} /> : null}
          <View style={{ flex: 1 }} />
          <Ionicons name="ellipsis-horizontal" size={pad(11)} color={gray} />
        </View>
        <AutoFit fit={fit} maxH={maxH} style={body(true, true)}>{children}</AutoFit>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: pad(14), paddingBottom: pad(10), gap: pad(4) }}>
          {[
            { icon: 'chatbubble-outline', count: '12', color: gray },
            { icon: 'repeat-outline', count: '48', color: '#22C55E' },
            { icon: 'heart-outline', count: '312', color: '#EC4899' },
            { icon: 'bar-chart-outline', count: '2.1K', color: gray },
          ].map((a, i) => (
            <View key={i} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Ionicons name={a.icon as any} size={pad(11)} color={a.color} />
              <Text style={{ ...F(font), fontSize: pad(8), color: gray }}>{a.count}</Text>
            </View>
          ))}
          <Ionicons name="bookmark-outline" size={pad(11)} color={gray} />
        </View>
      </View>
    );
  }

  if (style === 'instagram') {
    return (
      <View style={{ ...rootFlex, backgroundColor: cardBg, borderRadius: pad(6), borderWidth: pad(1), borderColor: '#11111112', overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: pad(7), paddingHorizontal: pad(12), paddingTop: pad(10) }}>
          <Avatar page={page} pad={pad} size={20} />
          <Text style={{ ...F(font, true), fontSize: pad(9), color: ink, flexShrink: 1 }} numberOfLines={1}>{name} {check(9)}</Text>
          {watermark ? <Watermark font={font} pad={pad} size={8} color={gray} /> : null}
          <View style={{ flex: 1 }} />
          <SocialGlyph platform="instagram" size={pad(11)} color="#E1306C" />
          <Ionicons name="ellipsis-horizontal" size={pad(12)} color={ink} />
        </View>
        <AutoFit fit={fit} maxH={maxH} style={body(true, true)}>{children}</AutoFit>
        <View style={{ paddingHorizontal: pad(12), paddingBottom: pad(11), gap: pad(6) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: pad(10) }}>
            <Ionicons name="heart-outline" size={pad(14)} color={ink} />
            <Ionicons name="chatbubble-outline" size={pad(14)} color={ink} />
            <Ionicons name="paper-plane-outline" size={pad(14)} color={ink} />
            <View style={{ flex: 1 }} />
            <Ionicons name="bookmark-outline" size={pad(14)} color={ink} />
          </View>
          <Text style={{ ...F(font), fontSize: pad(8.5), color: ink }}>
            <Text style={{ ...F(font, true) }}>Liked by you</Text> and 1,234 others
          </Text>
          <Text style={{ ...F(font), fontSize: pad(8.5), color: gray }}>View all 48 comments</Text>
        </View>
      </View>
    );
  }

  if (style === 'threads') {
    return (
      <View style={{ ...rootFlex, backgroundColor: cardBg, borderRadius: pad(14), borderWidth: pad(1), borderColor: hairline, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: pad(7), paddingHorizontal: pad(13), paddingTop: pad(11) }}>
          <Avatar page={page} pad={pad} size={20} />
          <Text style={{ ...F(font, true), fontSize: pad(9), color: ink, flexShrink: 1 }} numberOfLines={1}>
            {name} {check(8)} <Text style={{ ...F(font), color: faint }}>· 2h</Text>
          </Text>
          {watermark ? <Watermark font={font} pad={pad} size={8} color={faint} /> : null}
          <View style={{ flex: 1 }} />
          <SocialGlyph platform="threads" size={pad(12)} color={ink} />
        </View>
        <AutoFit fit={fit} maxH={maxH} style={body(true, true)}>{children}</AutoFit>
        <View style={{ paddingHorizontal: pad(13), paddingBottom: pad(11), gap: pad(6) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: pad(11) }}>
            <Ionicons name="heart-outline" size={pad(13)} color={ink} />
            <Ionicons name="chatbubble-outline" size={pad(13)} color={ink} />
            <Ionicons name="repeat" size={pad(13)} color={ink} />
            <Ionicons name="paper-plane-outline" size={pad(13)} color={ink} />
          </View>
          <Text style={{ ...F(font), fontSize: pad(8), color: faint }}>12 replies</Text>
        </View>
      </View>
    );
  }

  if (style === 'bluesky') {
    return (
      <View style={{ ...rootFlex, backgroundColor: cardBg, borderRadius: pad(14), borderWidth: pad(1), borderColor: hairline, overflow: 'hidden' }}>
        {/* author header */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: pad(7), paddingHorizontal: pad(13), paddingTop: pad(11) }}>
          <Avatar page={page} pad={pad} size={22} />
          <View style={{ flex: 1, gap: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: pad(4) }}>
              <Text style={{ ...F(font, true), fontSize: pad(9), color: ink, flexShrink: 1 }} numberOfLines={1}>{name} {check(9)}</Text>
              {watermark ? <Watermark font={font} pad={pad} size={8} color={gray} /> : null}
            </View>
            <Text style={{ ...F(font), fontSize: pad(8), color: gray }} numberOfLines={1}>{firstHandle} · 2h</Text>
          </View>
          <Ionicons name="ellipsis-horizontal" size={pad(11)} color={gray} />
        </View>
        <AutoFit fit={fit} maxH={maxH} style={body(true, true)}>{children}</AutoFit>
        {/* reply · repost · like · views */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: pad(14), paddingBottom: pad(10), gap: pad(4) }}>
          {[
            { icon: 'chatbubble-outline', count: '12', color: gray },
            { icon: 'repeat-outline', count: '48', color: '#2E9E53' },
            { icon: 'heart-outline', count: '312', color: '#EC245E' },
            { icon: 'bar-chart-outline', count: '2.1K', color: gray },
          ].map((a, i) => (
            <View key={i} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Ionicons name={a.icon as any} size={pad(11)} color={a.color} />
              <Text style={{ ...F(font), fontSize: pad(8), color: gray }}>{a.count}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (style === 'mastodon') {
    return (
      <View style={{ ...rootFlex, backgroundColor: cardBg, borderRadius: pad(10), borderWidth: pad(1), borderColor: hairline, overflow: 'hidden' }}>
        {/* author header — display name over @account */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: pad(7), paddingHorizontal: pad(12), paddingTop: pad(10) }}>
          <Avatar page={page} pad={pad} size={24} />
          <View style={{ flex: 1, gap: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: pad(4) }}>
              <Text style={{ ...F(font, true), fontSize: pad(9.5), color: ink, flexShrink: 1 }} numberOfLines={1}>{name} {check(9)}</Text>
              {watermark ? <Watermark font={font} pad={pad} size={8} color={gray} /> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Text style={{ ...F(font), fontSize: pad(7.5), color: gray }} numberOfLines={1}>{firstHandle} · 2h</Text>
              <Ionicons name="globe-outline" size={pad(8)} color={gray} />
            </View>
          </View>
          <Ionicons name="ellipsis-horizontal" size={pad(12)} color={gray} />
        </View>
        <AutoFit fit={fit} maxH={maxH} style={body(true, true)}>{children}</AutoFit>
        {/* reply · boost · favourite · bookmark */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: pad(14), paddingBottom: pad(10), gap: pad(4) }}>
          {[
            { icon: 'chatbubble-outline', count: '12', color: gray },
            { icon: 'repeat-outline', count: '48', color: '#6364FF' },
            { icon: 'star-outline', count: '312', color: '#CA8F04' },
            { icon: 'bookmark-outline', count: '', color: gray },
          ].map((a, i) => (
            <View key={i} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Ionicons name={a.icon as any} size={pad(11)} color={a.color} />
              {a.count ? <Text style={{ ...F(font), fontSize: pad(8), color: gray }}>{a.count}</Text> : null}
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (style === 'linkedin') {
    return (
      <View style={{ ...rootFlex, backgroundColor: cardBg, borderRadius: pad(8), borderWidth: pad(1), borderColor: '#11111112', overflow: 'hidden' }}>
        {/* author header — name over headline */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: pad(7), paddingHorizontal: pad(12), paddingTop: pad(10) }}>
          <Avatar page={page} pad={pad} size={24} />
          <View style={{ flex: 1, gap: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: pad(4) }}>
              <Text style={{ ...F(font, true), fontSize: pad(9.5), color: ink, flexShrink: 1 }} numberOfLines={1}>{name} {check(9)}</Text>
              {watermark ? <Watermark font={font} pad={pad} size={8} color={gray} /> : null}
            </View>
            <Text style={{ ...F(font), fontSize: pad(7.5), color: gray }} numberOfLines={1}>{firstHandle}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Text style={{ ...F(font), fontSize: pad(7.5), color: gray }}>2h ·</Text>
              <Ionicons name="globe-outline" size={pad(8)} color={gray} />
            </View>
          </View>
          <Ionicons name="ellipsis-horizontal" size={pad(12)} color={gray} />
        </View>
        <AutoFit fit={fit} maxH={maxH} style={body(true, true)}>{children}</AutoFit>
        {/* reaction summary */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: pad(12), paddingBottom: pad(7) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {['#0A66C2', '#057642', '#DF704D'].map((bg, i) => (
              <View key={i} style={{ width: pad(13), height: pad(13), borderRadius: pad(6.5), backgroundColor: bg, alignItems: 'center', justifyContent: 'center', marginLeft: i === 0 ? 0 : pad(-4), borderWidth: pad(1.5), borderColor: cardBg }}>
                <FontAwesome name={['thumbs-up', 'handshake-o', 'heart'][i] as any} size={pad(7)} color="#fff" />
              </View>
            ))}
          </View>
          <Text style={{ ...F(font), fontSize: pad(8.5), color: gray, marginLeft: 5 }}>48</Text>
          <View style={{ flex: 1 }} />
          <Text style={{ ...F(font), fontSize: pad(8.5), color: gray }}>12 comments · 5 reposts</Text>
        </View>
        {/* actions */}
        <View style={{ borderTopWidth: pad(1), borderTopColor: hairline, flexDirection: 'row', paddingVertical: pad(7) }}>
          {[
            { icon: 'thumbs-up-outline', label: 'Like' },
            { icon: 'chatbubble-outline', label: 'Comment' },
            { icon: 'repeat-outline', label: 'Repost' },
            { icon: 'paper-plane-outline', label: 'Send' },
          ].map((a) => (
            <View key={a.label} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <Ionicons name={a.icon as any} size={pad(12)} color={gray} />
              <Text style={{ ...F(font), fontSize: pad(9), color: gray }}>{a.label}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (style === 'snapchat') {
    return (
      <View style={{ ...rootFlex, backgroundColor: cardBg, borderRadius: pad(16), borderWidth: pad(1), borderColor: hairline, overflow: 'hidden' }}>
        {/* ghost header — your pfp ringed in snapchat yellow + mini ghost badge */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: pad(7), paddingHorizontal: pad(13), paddingTop: pad(11) }}>
          <View style={{ width: pad(28), height: pad(28) }}>
            <View style={{ borderWidth: pad(1.5), borderColor: '#FFFC00', borderRadius: pad(14), padding: pad(1.5) }}>
              <Avatar page={page} pad={pad} size={22} />
            </View>
            <View style={{ position: 'absolute', right: 0, bottom: 0, width: pad(12), height: pad(12), borderRadius: pad(6), backgroundColor: '#FFFC00', alignItems: 'center', justifyContent: 'center' }}>
              <FontAwesome name="snapchat-ghost" size={pad(7)} color="#000" />
            </View>
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: pad(4) }}>
              <Text style={{ ...F(font, true), fontSize: pad(9), color: ink, flexShrink: 1 }} numberOfLines={1}>{name} {check(9)}</Text>
              {watermark ? <Watermark font={font} pad={pad} size={8} color={gray} /> : null}
            </View>
            <Text style={{ ...F(font), fontSize: pad(8), color: gray }} numberOfLines={1}>{firstHandle} · 2h</Text>
          </View>
          <Ionicons name="ellipsis-horizontal" size={pad(11)} color={gray} />
        </View>
        <AutoFit fit={fit} maxH={maxH} style={body(true, true)}>{children}</AutoFit>
        {/* likes · views · share */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: pad(14), paddingBottom: pad(10), gap: pad(4) }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Ionicons name="heart" size={pad(11)} color="#FF3B5C" />
            <Text style={{ ...F(font), fontSize: pad(8), color: gray }}>12.4K</Text>
          </View>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Ionicons name="eye-outline" size={pad(11)} color={gray} />
            <Text style={{ ...F(font), fontSize: pad(8), color: gray }}>48K views</Text>
          </View>
          <Ionicons name="paper-plane-outline" size={pad(11)} color={gray} />
        </View>
      </View>
    );
  }

  // minimal
  return (
    <View style={{ flex: fit ? undefined : 1, flexShrink: fit ? 1 : 0 }}>
      <AutoFit fit={fit} maxH={maxH} style={{ flex: 1, gap: pad(10), backgroundColor: cardBg, borderRadius: pad(14), padding: pad(13), borderWidth: pad(1), borderColor: '#11111112' }}>
        {children}
      </AutoFit>
      {watermark ? (
        <View style={{ position: 'absolute', right: pad(13), bottom: pad(13) }}>
          <Watermark font={font} pad={pad} size={8} color={gray} />
        </View>
      ) : null}
    </View>
  );
}
