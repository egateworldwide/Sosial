import React, { forwardRef, memo } from 'react';
import { View, Text, Image, StyleSheet, Dimensions } from 'react-native';
import ViewShot, { ViewShotRef } from 'react-native-view-shot';
import { PostPage } from '../types';
import { SOCIAL_META } from '../constants';
import { F } from '../utils/fonts';
import { contrastRatio } from '../utils/color';
import PatternBackground from './PatternBackground';
import ContentBlockView from './ContentBlockView';
import SocialCardChrome from './SocialCardChrome';
import { SocialGlyph } from './ui';

export const CANVAS_W = 340;
const { width: SCREEN_W } = Dimensions.get('window');
export const CANVAS_SCALE = Math.min(1, (SCREEN_W - 40) / CANVAS_W);

function dirFor(pos: string): 'column' | 'row' | 'row-reverse' {
  if (pos === 'right') return 'row';
  if (pos === 'left') return 'row-reverse';
  return 'column';
}

function crossAlign(align: string): 'flex-start' | 'center' | 'flex-end' {
  if (align === 'center') return 'center';
  if (align === 'right') return 'flex-end';
  return 'flex-start';
}

interface Props {
  page: PostPage;
  ratio: number;
  scale?: number;
}

function PostCanvasInner({ page, ratio, scale }: Props, ref: React.Ref<ViewShotRef>) {
  const H = CANVAS_W * ratio;
  const visibleSocials = page.socials.filter((s) => s.visible);
  const hasTitle = page.title.position !== 'none' && page.title.text.trim().length > 0;
  const titleOnTop = hasTitle && page.title.position === 'top';
  const titleOnBottom = hasTitle && page.title.position === 'bottom';
  const s = scale ?? CANVAS_SCALE;
  const pad = (v: number) => v * s;

  const socialPos = page.pfp.socialPos ?? 'below';
  const badgeBg = page.pfp.badgeBg ?? true;
  const badgeRows = page.pfp.badgeRows ?? 1;
  const handleColor = page.pfp.handleColor ?? '#FFFFFF';
  const handleSize = page.pfp.handleSize ?? 8.5;
  const iconSize = page.pfp.iconSize ?? 17;
  const iconOutline = page.pfp.iconOutline ?? false;
  const socialGap = page.pfp.socialGap ?? 6;
  const align = page.pfp.align ?? 'left';
  const borderW = page.pfp.borderW ?? 2;
  const badgeSurface = badgeBg ? '#111111' : (page.background.color ?? '#FFFFFF');
  const surfaceDark = badgeBg ? true : contrastRatio('#111111', badgeSurface) < contrastRatio('#FFFFFF', badgeSurface);
  const ringColor = surfaceDark ? '#FFFFFF' : '#111111';
  const pfpOnTop = (page.pfp.pfpY ?? 'top') === 'top';
  const cardY = page.cardY ?? 'bottom';
  const stickToCard = page.stickToCard ?? false;
  const dir = dirFor(socialPos);

  const blocks = page.blocks.length === 0 ? (
    <Text style={{ color: '#787774', textAlign: 'center', marginTop: pad(24), fontSize: pad(13), fontWeight: '600' }}>Add bullets, table or chart below</Text>
  ) : (
    page.blocks.map((b) => <ContentBlockView key={b.id} block={b} width={CANVAS_W * s} font={page.font ?? 'inter'} zoom={page.contentScale ?? 1} fill={!!page.cardH} />)
  );

  const titleBlock = (
    <View style={{ gap: pad(4) }}>
      <Text style={{ ...F(page.title.font, page.title.bold, page.title.italic), fontSize: page.title.size * s, color: page.title.color, textAlign: page.title.align, lineHeight: page.title.size * s * 1.28, letterSpacing: -0.4, textShadowColor: '#00000022', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}>
        {page.title.text}
      </Text>
      {page.title.subtitle?.trim() ? (
        <Text style={{ ...F(page.title.font, false, page.title.italic), fontSize: (page.title.subtitleSize ?? 15) * s, color: page.title.subtitleColor ?? page.title.color, textAlign: page.title.align, lineHeight: (page.title.subtitleSize ?? 15) * s * 1.32 }}>
          {page.title.subtitle}
        </Text>
      ) : null}
    </View>
  );

  const pfpRow = (page.pfp.hidden ?? false) ? null : (
    <View
      style={{
        flexDirection: dir,
        alignItems: dir === 'column' ? crossAlign(align) : 'center',
        justifyContent: dir === 'column' ? 'flex-start' : crossAlign(align),
        gap: pad(socialGap),
      }}
    >
      {page.pfp.uri ? (
        <View style={{ alignItems: 'center', gap: pad(3) }}>
          <Image source={{ uri: page.pfp.uri }} style={{ width: page.pfp.size * s, height: page.pfp.size * s, borderRadius: page.pfp.shape === 'circle' ? (page.pfp.size * s) / 2 : pad(12), borderWidth: pad(borderW), borderColor: '#fff' }} />
          {page.pfp.username?.trim() ? (
            <Text style={{ ...F(page.font ?? 'jakarta', true), color: handleColor, fontSize: pad(handleSize), textShadowColor: '#00000066', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}>
              {page.pfp.username}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={{ alignItems: 'center', gap: pad(3) }}>
          <View style={{ width: page.pfp.size * s, height: page.pfp.size * s, borderRadius: page.pfp.shape === 'circle' ? (page.pfp.size * s) / 2 : pad(12), backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center', borderWidth: pad(borderW), borderColor: '#fff' }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: pad(13) }}>YOU</Text>
          </View>
          {page.pfp.username?.trim() ? (
            <Text style={{ ...F(page.font ?? 'jakarta', true), color: handleColor, fontSize: pad(handleSize), textShadowColor: '#00000066', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}>
              {page.pfp.username}
            </Text>
          ) : null}
        </View>
      )}
      {visibleSocials.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: badgeRows === 2 ? 'wrap' : 'nowrap',
            justifyContent: dir === 'column' ? crossAlign(align) : 'center',
            alignItems: 'center',
            gap: pad(socialGap),
            ...(badgeRows === 2 ? { maxWidth: pad(220) } : {}),
          }}
        >
          {visibleSocials.map((sl) => {
            const brand = SOCIAL_META[sl.platform]?.bg ?? '#111111';
            const clash = contrastRatio(brand, badgeSurface) < 3;
            const inverted = !iconOutline && clash;
            const glyphColor = iconOutline ? (clash ? ringColor : brand) : (inverted ? brand : '#fff');
            return (
              <View key={sl.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: badgeBg ? '#111111E8' : 'transparent', borderRadius: pad(8), paddingHorizontal: pad(6), paddingVertical: pad(4), borderWidth: badgeBg ? pad(1) : 0, borderColor: '#FFFFFF2E' }}>
                <View style={{ width: pad(iconSize), height: pad(iconSize), borderRadius: pad(iconSize / 2), backgroundColor: iconOutline ? 'transparent' : (inverted ? '#FFFFFF' : brand), alignItems: 'center', justifyContent: 'center' }}>
                  <SocialGlyph platform={sl.platform} size={pad(iconSize * 0.6)} color={glyphColor} />
                </View>
                {sl.handle ? (
                  <Text style={{ ...F(sl.font, sl.bold, sl.italic), color: handleColor, fontSize: pad(handleSize), textShadowColor: '#00000066', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }}>
                    {sl.handle}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );

  return (
    <ViewShot ref={ref} options={{ format: 'png', quality: 1 }} style={[styles.frame, { width: CANVAS_W * s, height: H * s, borderRadius: pad(14) }]}>
      <View style={{ width: CANVAS_W * s, height: H * s }}>
        <PatternBackground bg={page.background} width={CANVAS_W * s} height={H * s} />
        <View style={{ flex: 1, padding: pad(16), gap: pad(10) }}>
          {(page.cardH || page.cardAuto) ? (
            <>
              {!stickToCard && pfpOnTop ? pfpRow : null}
              <View style={{ gap: pad(10), marginTop: cardY === 'top' ? undefined : 'auto', marginBottom: cardY === 'bottom' ? undefined : 'auto' }}>
                {stickToCard && pfpOnTop ? pfpRow : null}
                {titleOnTop ? titleBlock : null}
                {page.cardH ? (
                  <View style={{ height: pad(page.cardH) }}>
                    <SocialCardChrome page={page} pad={pad}>
                      {blocks}
                    </SocialCardChrome>
                  </View>
                ) : (
                  /* auto height — the card hugs its generated content */
                  <SocialCardChrome page={page} pad={pad} fit>
                    {blocks}
                  </SocialCardChrome>
                )}
                {titleOnBottom ? titleBlock : null}
                {stickToCard && !pfpOnTop ? pfpRow : null}
              </View>
              {!stickToCard && !pfpOnTop ? pfpRow : null}
            </>
          ) : (
            <>
              {pfpOnTop ? pfpRow : null}
              {titleOnTop ? titleBlock : null}
              <View style={{ flex: 1, minHeight: 0 }}>
                <SocialCardChrome page={page} pad={pad}>
                  {blocks}
                </SocialCardChrome>
              </View>
              {titleOnBottom ? titleBlock : null}
              {!pfpOnTop ? pfpRow : null}
            </>
          )}
        </View>
      </View>
      {/* hairline drawn as an overlay so its border never eats into the content box
          (a real border made the inner canvas 2px too wide and shifted it right) */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: pad(14), borderWidth: 1, borderColor: '#EAEAEA' }} />
    </ViewShot>
  );
}

const PostCanvas = memo(forwardRef<ViewShotRef, Props>(PostCanvasInner));

export default PostCanvas;

const styles = StyleSheet.create({
  frame: {
    backgroundColor: '#fff',
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#111111',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
});
