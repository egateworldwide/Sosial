import React from 'react';
import { View, Text, Image } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { ContentBlock, FontId } from '../types';
import { F } from '../utils/fonts';
import { DATA } from '../theme';

export function ChartBlock({ block, w, font, zoom = 1 }: { block: ContentBlock; w: number; font: FontId; zoom?: number }) {
  const k = w / 340;
  const sz = (base: number, f: number) => Math.max(base * k, w * f) * zoom;
  const txt = (base: number) => sz(base, 0.032);
  const hair = Math.max(0.5, w / 340);
  if (block.type === 'bar') {
    const data = block.chart ?? [];
    const total = data.reduce((a, b) => a + b.value, 0) || 1;
    return (
      <View style={{ gap: Math.max(4 * k, w * 0.02) }}>
        {data.map((d, i) => (
          <View key={i}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ ...F(font, true), fontSize: txt(8), color: block.textColor ?? '#111' }}>{d.label}</Text>
              <Text style={{ ...F(font), fontSize: txt(8), color: block.textColor ?? '#111' }}>{d.value}</Text>
            </View>
            <View style={{ height: Math.max(6 * k, w * 0.03), backgroundColor: '#00000015', borderRadius: 6 * k, overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(0, (d.value / total)) * 100}%`, height: Math.max(6 * k, w * 0.03), backgroundColor: d.color ?? DATA[i % DATA.length], borderRadius: 6 * k }} />
            </View>
          </View>
        ))}
      </View>
    );
  }
  if (block.type === 'pie') {
    const data = block.chart ?? [];
    const total = data.reduce((a, b) => a + Math.max(0, b.value), 0) || 1;
    const colors = DATA;
    let acc = 0;
    const R = Math.max(20 * k, w * 0.15);
    const SW = R * 0.35;
    const VB = (R + SW / 2 + 2) * 2;
    const CC = VB / 2;
    const C = 2 * Math.PI * R;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Math.max(8 * k, w * 0.04) }}>
        <Svg width={VB} height={VB} viewBox={`0 0 ${VB} ${VB}`}>
          <Circle cx={CC} cy={CC} r={R} stroke="#00000015" strokeWidth={SW} fill="none" />
          {data.map((d, i) => {
            const frac = Math.max(0, d.value) / total;
            const dash = frac * C;
            const off = -acc * C;
            acc += frac;
            return <Circle key={i} cx={CC} cy={CC} r={R} stroke={d.color ?? colors[i % colors.length]} strokeWidth={SW} fill="none" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={off} rotation={-90} origin={`${CC},${CC}`} />;
          })}
        </Svg>
        <View style={{ flex: 1, gap: Math.max(3 * k, w * 0.015) }}>
          {data.map((d, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: Math.max(4 * k, w * 0.02) }}>
              <View style={{ width: Math.max(8 * k, w * 0.025), height: Math.max(8 * k, w * 0.025), borderRadius: Math.max(4 * k, w * 0.0125), backgroundColor: d.color ?? colors[i % colors.length] }} />
              <Text style={{ ...F(font), fontSize: sz(10, 0.03), color: block.textColor ?? '#111', flex: 1 }}>{d.label}</Text>
              <Text style={{ ...F(font, true), fontSize: sz(10, 0.03), color: block.textColor ?? '#111' }}>{Math.round((Math.max(0, d.value) / total) * 100)}%</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }
  if (block.type === 'vbar') {
    const data = block.chart ?? [];
    const total = data.reduce((a, b) => a + Math.max(0, b.value), 0) || 1;
    const maxH = Math.max(80 * k, w * 0.35);
    return (
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: Math.max(6 * k, w * 0.03) }}>
        {data.map((d, i) => {
          const h = Math.max(2 * k, (Math.max(0, d.value) / total) * maxH);
          return (
            <View key={i} style={{ flex: 1, alignItems: 'center', gap: 3 * k }}>
              <Text style={{ ...F(font, true), fontSize: txt(8), color: block.textColor ?? '#111' }} numberOfLines={1}>{d.value}</Text>
              <View style={{ height: maxH, justifyContent: 'flex-end', width: '100%' }}>
                <View style={{ height: h, backgroundColor: d.color ?? DATA[i % DATA.length], borderRadius: 6 * k }} />
              </View>
              <Text style={{ ...F(font), fontSize: txt(8), color: block.textColor ?? '#111' }} numberOfLines={1}>{d.label}</Text>
            </View>
          );
        })}
      </View>
    );
  }
  return null;
}

export default function ContentBlockView({ block, width, font = 'inter', zoom = 1, fill = false }: { block: ContentBlock; width: number; font?: FontId; zoom?: number; fill?: boolean }) {
  const tc = block.textColor ?? '#111111';
  const w = width;
  const k = w / 340;
  const sz = (base: number, f: number) => Math.max(base * k, w * f) * zoom;
  const hair = Math.max(0.5, w / 340);

  if (block.type === 'free') {
    return (
      <View>
        {block.heading ? <Text style={{ ...F(font, true), fontSize: sz(12, 0.045), color: tc, marginBottom: Math.max(3 * k, w * 0.01) }}>{block.heading}</Text> : null}
        {(block.items ?? []).map((line, i) => (
          <Text key={i} style={{ ...F(font), fontSize: sz(11, 0.038), color: tc, lineHeight: sz(15, 0.053) }}>{line}</Text>
        ))}
      </View>
    );
  }
  if (block.type === 'bullets') {
    return (
      <View>
        {block.heading ? <Text style={{ ...F(font, true), fontSize: sz(12, 0.045), color: tc, marginBottom: Math.max(4 * k, w * 0.015) }}>{block.heading}</Text> : null}
        {(block.items ?? []).map((line, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: Math.max(6 * k, w * 0.02), marginBottom: Math.max(4 * k, w * 0.015) }}>
            <View style={{ width: Math.max(6 * k, w * 0.02), height: Math.max(6 * k, w * 0.02), borderRadius: Math.max(3 * k, w * 0.01), backgroundColor: tc, marginTop: Math.max(3 * k, w * 0.013) }} />
            <Text style={{ ...F(font), fontSize: sz(11, 0.038), color: tc, flex: 1, lineHeight: sz(15, 0.053) }}>{line}</Text>
          </View>
        ))}
      </View>
    );
  }
  if (block.type === 'numbered') {
    return (
      <View>
        {block.heading ? <Text style={{ ...F(font, true), fontSize: sz(12, 0.045), color: tc, marginBottom: Math.max(4 * k, w * 0.015) }}>{block.heading}</Text> : null}
        {(block.items ?? []).map((line, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: Math.max(6 * k, w * 0.02), marginBottom: Math.max(4 * k, w * 0.015) }}>
            <View style={[{ width: Math.max(16 * k, w * 0.045), height: Math.max(16 * k, w * 0.045), borderRadius: Math.max(8 * k, w * 0.02), borderWidth: hair * 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 }, { borderColor: tc }]}>
              <Text style={{ ...F(font, true), fontSize: sz(9, 0.028), color: tc }}>{i + 1}</Text>
            </View>
            <Text style={{ ...F(font), fontSize: sz(11, 0.038), color: tc, flex: 1, lineHeight: sz(15, 0.053) }}>{line}</Text>
          </View>
        ))}
      </View>
    );
  }
  if (block.type === 'table') {
    const rows = block.table ?? [['', '']];
    return (
      <View>
        {block.heading ? <Text style={{ ...F(font, true), fontSize: sz(12, 0.045), color: tc, marginBottom: Math.max(4 * k, w * 0.015) }}>{block.heading}</Text> : null}
        <View style={{ borderWidth: hair, borderColor: tc + '44', borderRadius: Math.max(6 * k, w * 0.015), overflow: 'hidden' }}>
          {rows.map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', backgroundColor: ri === 0 ? tc + '14' : 'transparent' }}>
              {row.map((cell, ci) => (
                <Text key={ci} style={{ ...F(font, ri === 0), flex: 1, fontSize: sz(9, 0.028), padding: Math.max(4 * k, w * 0.012), color: tc, borderLeftWidth: ci > 0 ? hair : 0, borderLeftColor: tc + '22' }}>{cell}</Text>
              ))}
            </View>
          ))}
        </View>
      </View>
    );
  }
  if (block.type === 'image') {
    const asp = block.imageAspect ?? (block.imageH !== undefined ? 'custom' : 'wide');
    const custom = asp === 'custom';
    const frame = custom ? { height: (block.imageH ?? 140) * k } : { aspectRatio: asp === 'square' ? 1 : 16 / 9 };
    const focus = block.imageFocus ?? 4;
    const fx = (focus % 3) - 1; // -1 show left … +1 show right
    const fy = Math.floor(focus / 3) - 1; // -1 show top … +1 show bottom
    const cropped = fx !== 0 || fy !== 0;
    const iw = cropped ? '140%' : '100%';
    const hAlign: 'center' | 'flex-start' | 'flex-end' = fx === 0 ? 'center' : fx > 0 ? 'flex-end' : 'flex-start';
    const vAlign: 'center' | 'flex-start' | 'flex-end' = fy === 0 ? 'center' : fy > 0 ? 'flex-end' : 'flex-start';
    const imgInner = custom
      ? { width: iw, height: cropped ? '140%' : '100%', alignSelf: hAlign }
      : { width: iw, aspectRatio: asp === 'square' ? 1 : 16 / 9, alignSelf: hAlign };
    // manual crop wins over the focal preset: scale the frame-filling photo and pan it
    const crop = block.imageCrop;
    const frameW = w;
    const frameH = custom ? (block.imageH ?? 140) * k : asp === 'square' ? w : w * (9 / 16);
    const overX = frameW * ((crop?.zoom ?? 1) - 1);
    const overY = frameH * ((crop?.zoom ?? 1) - 1);
    const cropInner = crop
      ? {
          width: `${crop.zoom * 100}%` as any,
          height: `${crop.zoom * 100}%` as any,
          transform: [
            { translateX: (crop.x * overX) / 2 },
            { translateY: (crop.y * overY) / 2 },
          ],
        }
      : null;
    // in fixed-height cards the photo grows into leftover space instead of leaving a gap below
    const grow = fill ? { flexGrow: 1 } : null;
    return (
      <View style={grow}>
        {block.heading ? <Text style={{ ...F(font, true), fontSize: sz(12, 0.045), color: tc, marginBottom: Math.max(4 * k, w * 0.015) }}>{block.heading}</Text> : null}
        {block.imageUri ? (
          <View style={[frame, grow, { overflow: 'hidden', borderRadius: 8 * k, justifyContent: crop ? 'flex-start' : vAlign }]}>
            <Image source={{ uri: block.imageUri }} style={(cropInner ?? imgInner) as any} resizeMode="cover" />
          </View>
        ) : (
          <View style={[frame, { width: '100%', borderRadius: 8 * k, borderWidth: hair, borderStyle: 'dashed', borderColor: tc + '66', alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ ...F(font), fontSize: sz(10, 0.03), color: tc + '99' }}>No image yet — pick one in the editor</Text>
          </View>
        )}
      </View>
    );
  }
  if (block.type === 'bar' || block.type === 'pie' || block.type === 'vbar') {
    return (
      <View>
        {block.heading ? <Text style={{ ...F(font, true), fontSize: sz(12, 0.045), color: tc, marginBottom: Math.max(4, w * 0.015) }}>{block.heading}</Text> : null}
        <ChartBlock block={block} w={w} font={font} zoom={zoom} />
      </View>
    );
  }
  return null;
}
