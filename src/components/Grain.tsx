import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect, Filter, FeTurbulence } from 'react-native-svg';

/** Subtle film grain — breaks digital flatness. Static overlay, never captured. */
export default function Grain({ opacity = 0.05 }: { opacity?: number }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      <Svg width="100%" height="100%">
        <Filter id="qp-grain">
          <FeTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" />
        </Filter>
        <Rect width="100%" height="100%" filter="url(#qp-grain)" />
      </Svg>
    </View>
  );
}
