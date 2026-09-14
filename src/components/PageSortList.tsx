import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, PanResponder, Animated } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { PostPage } from '../types';
import { useTheme, Palette, R } from '../theme';

interface Props {
  pages: PostPage[];
  currentIndex: number;
  onSelect: (i: number) => void;
  onCommit: (ids: string[]) => void;
  onDragChange?: (dragging: boolean) => void;
}

/** Long-press the grip and drag to reorder. Order is kept local during the
 * drag (no parent re-renders = no lag) and committed once on drop. */
export default function PageSortList({ pages, currentIndex, onSelect, onCommit, onDragChange }: Props) {
  const { C } = useTheme();
  const s = makeS(C);
  const [dragId, setDragId] = useState<string | null>(null);
  const [local, setLocal] = useState<string[] | null>(null);
  const dy = useRef(new Animated.Value(0)).current;
  const layouts = useRef<Record<string, { y: number; h: number }>>({});

  const byId = new Map(pages.map((p) => [p.id, p]));
  const order = local ?? pages.map((p) => p.id);
  const shown = order.map((id) => byId.get(id)).filter((p) => !!p) as PostPage[];
  const curId = pages[currentIndex]?.id;

  const beginDrag = (id: string) => {
    if (pages.length < 2) return;
    dy.setValue(0);
    setDragId(id);
    setLocal(pages.map((p) => p.id));
    onDragChange?.(true);
  };
  const endDrag = () => {
    if (local) onCommit(local);
    setLocal(null);
    setDragId(null);
    dy.setValue(0);
    onDragChange?.(false);
  };

  // created fresh each render so closures never go stale
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    // Android: let the native touchable receive taps — only steal real drags
    onShouldBlockNativeResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => dragId !== null && Math.abs(g.dy) > 6,
    onPanResponderMove: (_, g) => {
      const id = dragId;
      if (!id) return;
      dy.setValue(g.dy);
      const o = local ?? pages.map((p) => p.id);
      const cur = o.indexOf(id);
      const info = layouts.current[id];
      if (!info || cur < 0) return;
      const mid = info.y + g.dy + info.h / 2;
      // slot boundaries (not midpoints) so the first/last slots are reachable
      let y = 0;
      let target = o.length - 1;
      for (let i = 0; i < o.length; i++) {
        const h = layouts.current[o[i]]?.h ?? info.h;
        if (mid < y + h) {
          target = i;
          break;
        }
        y += h;
      }
      if (target !== cur) {
        const next = [...o];
        const [moved] = next.splice(cur, 1);
        next.splice(target, 0, moved);
        setLocal(next);
      }
    },
    onPanResponderRelease: endDrag,
    onPanResponderTerminate: endDrag,
  });

  return (
    <View>
      <Text style={s.hint}>Hold a row and drag to reorder.</Text>
      <View style={s.list}>
        {shown.map((p, i) => {
          const dragging = dragId === p.id;
          return (
            <Animated.View
              key={p.id}
              onLayout={(e) => {
                const { y, height } = e.nativeEvent.layout;
                layouts.current[p.id] = { y, h: height };
              }}
              style={[
                s.rowWrap,
                i > 0 && s.rowDiv,
                dragging && { transform: [{ translateY: dy }], zIndex: 10, elevation: 6, backgroundColor: C.paper, borderRadius: R.lg, opacity: 0.97 },
              ]}
              {...pan.panHandlers}
            >
              <TouchableOpacity
                onPress={() => {
                  if (!dragId) {
                    const pi = pages.findIndex((x) => x.id === p.id);
                    if (pi >= 0) onSelect(pi);
                  }
                }}
                style={s.row}
                activeOpacity={0.7}
                delayLongPress={200}
                onLongPress={() => beginDrag(p.id)}
              >
                <Text style={s.num}>{String(i + 1).padStart(2, '0')}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowT} numberOfLines={1}>{p.title.text || 'Untitled page'}</Text>
                  <Text style={s.rowS}>{p.blocks.length} block{p.blocks.length === 1 ? '' : 's'}</Text>
                </View>
                {p.id === curId ? <Text style={s.curT}>Editing</Text> : null}
                {p.scheduledAt ? <Ionicons name="time-outline" size={15} color={C.accent} /> : null}
                <View style={s.grip}>
                  <Ionicons name="reorder-three" size={22} color={dragging ? C.accent : C.faint} />
                </View>
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

const makeS = (C: Palette) => ({
  hint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: C.faint, marginBottom: 10 } as const,
  list: { backgroundColor: C.card, borderRadius: R.lg, overflow: 'hidden' } as const,
  rowWrap: {} as const,
  rowDiv: { borderTopWidth: 1, borderTopColor: C.lineSoft } as const,
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 } as const,
  num: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.accent, width: 24 } as const,
  rowT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14.5, letterSpacing: -0.2, color: C.ink } as const,
  rowS: { fontFamily: 'PlusJakartaSans_400Regular', color: C.muted, fontSize: 12 } as const,
  curT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, color: C.accentInk, backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 } as const,
  grip: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' } as const,
});
