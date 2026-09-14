import React, { useMemo } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { BackgroundStyle, BgType } from '../types';

function PatternLayer({ type, color, size, opacity, width, height }: { type: BgType; color: string; size: number; opacity: number; width: number; height: number }) {
  const els = useMemo(() => {
    // centered tile grid — equal clipping on all sides instead of top-left anchored
    const grid = (step: number) => {
      const cols = Math.max(1, Math.ceil(width / step));
      const rows = Math.max(1, Math.ceil(height / step));
      const ox = (width - (cols - 1) * step) / 2;
      const oy = (height - (rows - 1) * step) / 2;
      return { cols, rows, ox, oy };
    };
    // centered rows for continuous line patterns
    const rowY = (step: number) => {
      const rows = Math.max(2, Math.ceil(height / step) + 1);
      const first = (height - (rows - 1) * step) / 2;
      return { rows, first };
    };

    if (type === 'solid') return null;
    if (type === 'dots') {
      const { cols, rows, ox, oy } = grid(size);
      const out = [];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = ox + i * size;
          const y = oy + j * size;
          out.push(<Circle key={`${i}-${j}`} cx={x} cy={y} r={Math.max(1.5, size * 0.09)} fill={color} opacity={opacity} />);
        }
      }
      return <>{out}</>;
    }
    if (type === 'grid') {
      const { cols, rows, ox, oy } = grid(size);
      const out = [];
      for (let i = 0; i < cols; i++) {
        const x = ox + i * size;
        out.push(<Line key={`v${i}`} x1={x} y1={0} x2={x} y2={height} stroke={color} strokeWidth={1} opacity={opacity} />);
      }
      for (let j = 0; j < rows; j++) {
        const y = oy + j * size;
        out.push(<Line key={`h${j}`} x1={0} y1={y} x2={width} y2={y} stroke={color} strokeWidth={1} opacity={opacity} />);
      }
      return <>{out}</>;
    }
    if (type === 'stripes') {
      const { cols, ox } = grid(size);
      const out = [];
      for (let i = -Math.ceil(height / size) - 1; i < cols + Math.ceil(height / size) + 1; i++) {
        const x = ox + i * size;
        out.push(<Line key={i} x1={x} y1={0} x2={x + height} y2={height} stroke={color} strokeWidth={size * 0.35} opacity={opacity} />);
      }
      return <>{out}</>;
    }
    if (type === 'zigzag') {
      const amp = size * 0.45;
      const step = size * 0.5;
      const { rows, first } = rowY(size);
      let d = '';
      for (let r = 0; r < rows; r++) {
        const y = first + r * size;
        d += `M0 ${y} `;
        for (let x = 0; x <= width; x += step) {
          const peakY = (Math.floor(x / step) % 2 === 0) ? y - amp : y + amp;
          d += `L${x} ${peakY} `;
        }
      }
      return <Path d={d} stroke={color} strokeWidth={2} fill="none" opacity={opacity} />;
    }
    if (type === 'waves') {
      const amp = size * 0.28;
      const step = size * 0.5;
      const { rows, first } = rowY(size * 0.9);
      let d = '';
      for (let r = 0; r < rows; r++) {
        const y = first + r * size * 0.9;
        d += `M0 ${y} `;
        let k = 0;
        for (let x = 0; x < width; x += step, k++) {
          d += `Q${x + step / 2} ${y + (k % 2 === 0 ? -amp : amp)} ${x + step} ${y} `;
        }
      }
      return <Path d={d} stroke={color} strokeWidth={2} fill="none" opacity={opacity} />;
    }
    if (type === 'hearts') {
      const { cols, rows, ox, oy } = grid(size);
      const out = [];
      const r = size * 0.16;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const cx = ox + i * size;
          const y = oy + j * size;
          out.push(
            <React.Fragment key={`${i}-${j}`}>
              <Circle cx={cx - r * 0.55} cy={y - r * 0.15} r={r * 0.62} fill={color} opacity={opacity} />
              <Circle cx={cx + r * 0.55} cy={y - r * 0.15} r={r * 0.62} fill={color} opacity={opacity} />
              <Path d={`M${cx - r * 1.12} ${y + r * 0.05} L${cx + r * 1.12} ${y + r * 0.05} L${cx} ${y + r * 1.25} Z`} fill={color} opacity={opacity} />
            </React.Fragment>
          );
        }
      }
      return <>{out}</>;
    }
    if (type === 'stars') {
      const { cols, rows, ox, oy } = grid(size);
      const out = [];
      const h = size * 0.24;
      const k = h * 0.18;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = ox + i * size;
          const y = oy + j * size;
          out.push(<Path key={`${i}-${j}`} d={`M${x} ${y - h} Q${x + k} ${y - k} ${x + h} ${y} Q${x + k} ${y + k} ${x} ${y + h} Q${x - k} ${y + k} ${x - h} ${y} Q${x - k} ${y - k} ${x} ${y - h} Z`} fill={color} opacity={opacity} />);
        }
      }
      return <>{out}</>;
    }
    if (type === 'crosses') {
      const { cols, rows, ox, oy } = grid(size);
      const out = [];
      const l = size * 0.16;
      const sw = Math.max(1.5, size * 0.07);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = ox + i * size;
          const y = oy + j * size;
          out.push(<Line key={`v${i}-${j}`} x1={x} y1={y - l} x2={x} y2={y + l} stroke={color} strokeWidth={sw} opacity={opacity} />);
          out.push(<Line key={`h${i}-${j}`} x1={x - l} y1={y} x2={x + l} y2={y} stroke={color} strokeWidth={sw} opacity={opacity} />);
        }
      }
      return <>{out}</>;
    }
    if (type === 'doodle') {
      const { cols, rows, ox, oy } = grid(size);
      const out = [];
      let n = 0;
      for (let jy = 0; jy < rows; jy++) {
        for (let jx = 0; jx < cols; jx++) {
          const hsh = (jx * 31 + jy * 57) % 4;
          const cx = ox + jx * size + (((jx * 13 + jy * 7) % 9) - 4) * size * 0.03;
          const cy = oy + jy * size + (((jx * 5 + jy * 17) % 9) - 4) * size * 0.03;
          const m = size * 0.13;
          if (hsh === 0) {
            out.push(<Circle key={n++} cx={cx} cy={cy} r={m} stroke={color} strokeWidth={1.5} fill="none" opacity={opacity} />);
          } else if (hsh === 1) {
            out.push(
              <React.Fragment key={n++}>
                <Line x1={cx - m} y1={cy - m} x2={cx + m} y2={cy + m} stroke={color} strokeWidth={1.5} opacity={opacity} />
                <Line x1={cx + m} y1={cy - m} x2={cx - m} y2={cy + m} stroke={color} strokeWidth={1.5} opacity={opacity} />
              </React.Fragment>
            );
          } else if (hsh === 2) {
            out.push(<Path key={n++} d={`M${cx - m} ${cy} Q${cx - m / 2} ${cy - m} ${cx} ${cy} Q${cx + m / 2} ${cy + m} ${cx + m} ${cy}`} stroke={color} strokeWidth={1.5} fill="none" opacity={opacity} />);
          } else {
            out.push(<Circle key={n++} cx={cx} cy={cy} r={m * 0.45} fill={color} opacity={opacity} />);
          }
        }
      }
      return <>{out}</>;
    }
    return null;
  }, [type, color, size, opacity, width, height]);

  if (!els) return null;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      {els}
    </Svg>
  );
}

export default function PatternBackground({ bg, width, height }: { bg: BackgroundStyle; width: number; height: number }) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: bg.color, width, height }]}>
      {bg.type === 'image' && bg.imageUri ? (
        <Image source={{ uri: bg.imageUri }} style={[StyleSheet.absoluteFill, { width, height, opacity: 1 - (bg.imageOpacity ?? 0.35) }]} resizeMode="cover" />
      ) : null}
      {/* base pattern (skip if image-only with no pattern — still allow) */}
      {bg.type !== 'image' || !bg.imageUri ? (
        <PatternLayer type={bg.type} color={bg.patternColor} size={bg.patternSize} opacity={bg.patternOpacity} width={width} height={height} />
      ) : (
        <PatternLayer type="dots" color={bg.patternColor} size={bg.patternSize} opacity={bg.patternOpacity * 0.6} width={width} height={height} />
      )}
      {/* mixed second pattern */}
      {bg.mixEnabled && bg.mixType ? (
        <PatternLayer type={bg.mixType} color={bg.mixColor ?? '#4D7CFE'} size={Math.max(10, bg.patternSize * 1.4)} opacity={bg.mixOpacity ?? 0.12} width={width} height={height} />
      ) : null}
      {bg.type === 'image' && bg.imageUri ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: bg.color, opacity: bg.imageOpacity ?? 0.35 }]} />
      ) : null}
    </View>
  );
}
