import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Image, PanResponder, StyleSheet, Dimensions } from 'react-native';
import { useTheme, Palette, R } from '../theme';
import { PrimaryBtn, GhostBtn, Field, Stepper } from './ui';

const { width: SCREEN_W } = Dimensions.get('window');

export interface CropValue {
  zoom: number;
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Non-destructive crop: pan + zoom the photo inside its frame, store the transform.
 *  The original file is never rewritten — the block just renders with a transform. */
export default function ImageCropModal({ visible, uri, aspect, customH, value, onDone, onClose }: {
  visible: boolean;
  uri?: string;
  aspect: 'square' | 'wide' | 'custom';
  customH?: number;
  value?: CropValue;
  onDone: (c: CropValue) => void;
  onClose: () => void;
}) {
  const { C } = useTheme();
  const s = makeS(C);
  const [zoom, setZoom] = useState(value?.zoom ?? 1);
  const [x, setX] = useState(value?.x ?? 0);
  const [y, setY] = useState(value?.y ?? 0);

  useEffect(() => {
    if (visible) {
      setZoom(value?.zoom ?? 1);
      setX(value?.x ?? 0);
      setY(value?.y ?? 0);
    }
  }, [visible, value]);

  const frameW = Math.min(SCREEN_W - 72, 320);
  const frameH =
    aspect === 'square' ? frameW :
    aspect === 'wide' ? frameW * (9 / 16) :
    Math.max(90, Math.min(420, (customH ?? 140) * (frameW / 340)));

  const overX = frameW * (zoom - 1);
  const overY = frameH * (zoom - 1);

  // refs so the PanResponder (created once) always sees fresh values
  const cur = useRef({ x, y });
  cur.current = { x, y };
  const grant = useRef({ x: 0, y: 0 });
  const overXRef = useRef(overX);
  overXRef.current = overX;
  const overYRef = useRef(overY);
  overYRef.current = overY;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        grant.current = { ...cur.current };
      },
      onPanResponderMove: (_e, g) => {
        const ox = overXRef.current;
        const oy = overYRef.current;
        if (ox > 1) setX(clamp(grant.current.x + g.dx / (ox / 2), -1, 1));
        if (oy > 1) setY(clamp(grant.current.y + g.dy / (oy / 2), -1, 1));
      },
    }),
  ).current;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={s.bg}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={s.sheet}>
          <Text style={s.title}>Crop photo</Text>
          <Text style={s.sub}>Drag to reposition, zoom in, then Done.</Text>

          <View style={s.stage}>
            <View style={[s.frame, { width: frameW, height: frameH }]} {...pan.panHandlers}>
              {uri ? (
                <Image
                  source={{ uri }}
                  resizeMode="cover"
                  style={{
                    width: frameW * zoom,
                    height: frameH * zoom,
                    transform: [
                      { translateX: (x * overX) / 2 },
                      { translateY: (y * overY) / 2 },
                    ],
                  }}
                />
              ) : (
                <Text style={s.empty}>Pick a photo first</Text>
              )}
            </View>
          </View>

          <Field label="Zoom" hint={`${zoom.toFixed(1)}×`}>
            <Stepper value={zoom} onChange={(v) => setZoom(clamp(v, 1, 3))} step={0.1} min={1} max={3} format={(v) => `${v.toFixed(1)}×`} />
          </Field>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <View style={{ flex: 1 }}>
              <GhostBtn label="Reset" onPress={() => { setZoom(1); setX(0); setY(0); }} />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryBtn label="Done" onPress={() => onDone({ zoom, x, y })} />
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const makeS = (C: Palette) => StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.paper, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 30, gap: 6 },
  title: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 18, letterSpacing: -0.3, color: C.ink },
  sub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted },
  stage: { alignItems: 'center', paddingVertical: 14 },
  frame: { borderRadius: R.md, overflow: 'hidden', backgroundColor: C.surface, justifyContent: 'flex-start' },
  empty: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, padding: 20 },
});
