import React, { useState } from 'react';
import { View, LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path, Circle, Rect } from 'react-native-svg';

let uid = 0;
const nextId = () => `chart${++uid}`;

function useWidth() {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  return { w, onLayout };
}

/** Area chart with a gradient fill and an end dot marking the latest value. */
export function AreaChart({
  data,
  color,
  height = 72,
  strokeWidth = 2.5,
  showEndDot = true,
}: {
  data: number[];
  color: string;
  height?: number;
  strokeWidth?: number;
  showEndDot?: boolean;
}) {
  const { w, onLayout } = useWidth();
  const n = data.length;
  if (n < 2) {
    return <View onLayout={onLayout} style={{ width: '100%', height }} />;
  }
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const span = hi - lo || 1;
  const pad = span * 0.14;
  const min = lo - pad;
  const max = hi + pad;
  const pts = data.map((v, i) => ({
    x: (i / (n - 1)) * w,
    y: height - ((v - min) / (max - min)) * height,
  }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const area = `${line} L${pts[n - 1].x.toFixed(2)},${height} L${pts[0].x.toFixed(2)},${height} Z`;
  const last = pts[n - 1];
  const [id] = useState(nextId);
  return (
    <View onLayout={onLayout} style={{ width: '100%', height }}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity="0.28" />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Path d={area} fill={`url(#${id})`} />
          <Path d={line} stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          {showEndDot ? <Circle cx={last.x} cy={last.y} r={3.5} fill={color} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}

/** Vertical bar chart, scaled to the max value. */
export function BarsChart({
  data,
  color,
  height = 72,
  barGap = 6,
  radius = 3,
}: {
  data: number[];
  color: string;
  height?: number;
  barGap?: number;
  radius?: number;
}) {
  const { w, onLayout } = useWidth();
  const n = data.length;
  const hi = Math.max(1, ...data);
  const bw = n > 0 ? (w - barGap * (n - 1)) / n : 0;
  return (
    <View onLayout={onLayout} style={{ width: '100%', height }}>
      {w > 0 && n > 0 ? (
        <Svg width={w} height={height}>
          {data.map((v, i) => {
            const h = Math.max(2, (v / hi) * height);
            const x = i * (bw + barGap);
            const y = height - h;
            return <Rect key={i} x={x} y={y} width={bw} height={h} rx={radius} fill={color} opacity={v > 0 ? 1 : 0.25} />;
          })}
        </Svg>
      ) : null}
    </View>
  );
}
