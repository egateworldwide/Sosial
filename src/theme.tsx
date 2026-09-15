import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Sosial — print-studio editorial theme.
 * Warm paper, ink, one persimmon accent. App chrome type: Space Grotesk
 * display + Inter UI. NOTE: custom families must never be paired with
 * fontWeight (iOS drops the font) — use the Bold family files instead.
 *
 * Colors are dynamic: consume via useTheme(), never import C directly.
 * Every module-scope StyleSheet must be a makeS(C) factory called per render. */

export type ThemeMode = 'light' | 'dark';

export interface Palette {
  ink: string;
  soft: string;
  muted: string;
  faint: string;
  paper: string;
  bone: string;
  surface: string;
  card: string;
  line: string;
  lineSoft: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  /** text/icons sitting on ink or accent fills */
  onInk: string;
  paleYellow: string;
  yellowText: string;
  paleBlue: string;
  blueText: string;
  paleGreen: string;
  greenText: string;
  paleRed: string;
  redText: string;
}

export const LIGHT: Palette = {
  ink: '#1C1917',
  soft: '#44403C',
  muted: '#78716C',
  faint: '#A8A29E',
  paper: '#FFFFFF',
  bone: '#F2EDE2',
  surface: '#E9E2D2',
  card: '#FBF9F3',
  line: '#E2DAC6',
  lineSoft: '#ECE5D3',
  accent: '#C8500F',
  accentInk: '#7C2D12',
  accentSoft: '#F9E2CF',
  onInk: '#FFFFFF',
  paleYellow: '#F9E2CF',
  yellowText: '#7C2D12',
  paleBlue: '#E1F3FE',
  blueText: '#1F6C9F',
  paleGreen: '#EDF3EC',
  greenText: '#346538',
  paleRed: '#FDEBEC',
  redText: '#9F2F2D',
};

export const DARK: Palette = {
  ink: '#F5F1E8',
  soft: '#D6CFC0',
  muted: '#A39E93',
  faint: '#6E685E',
  paper: '#211C15',
  bone: '#14110C',
  surface: '#2A241B',
  card: '#1E1913',
  line: '#3A3226',
  lineSoft: '#2C251A',
  accent: '#E8621A',
  accentInk: '#F5B98A',
  accentSoft: '#3A2415',
  onInk: '#14110C',
  paleYellow: '#3A2A14',
  yellowText: '#F0C884',
  paleBlue: '#14303F',
  blueText: '#8FD0F5',
  paleGreen: '#1C3325',
  greenText: '#9BD8A6',
  paleRed: '#3D1D1E',
  redText: '#F2A3A3',
};

const THEME_KEY = 'zap_theme_v1';

interface ThemeCtx {
  C: Palette;
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ C: LIGHT, mode: 'light', setMode: () => {}, toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light');
  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((v) => {
      if (v === 'dark' || v === 'light') setModeState(v);
    }).catch(() => {});
  }, []);
  const setMode = (m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(THEME_KEY, m).catch(() => {});
  };
  const toggle = () => setMode(mode === 'light' ? 'dark' : 'light');
  return <Ctx.Provider value={{ C: mode === 'light' ? LIGHT : DARK, mode, setMode, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}

export const R = { sm: 10, md: 14, lg: 20, xl: 28 };

export const T = {
  display: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 38, letterSpacing: -1.5, lineHeight: 46 },
  h1: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 25, letterSpacing: -0.6, lineHeight: 32 },
  h2: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, letterSpacing: -0.2, lineHeight: 22 },
  body: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, lineHeight: 21 },
  small: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 18 },
  micro: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11.5, lineHeight: 16 },
  /** eyebrow kicker — the ONLY all-caps style, for screen headers */
  tag: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10.5, letterSpacing: 1.8 },
};

/** Muted editorial data palette (charts) — replaces neon defaults */
export const DATA = ['#C4703F', '#D9A441', '#7D8C5C', '#5B7B9A', '#8C5B7E', '#4FA3A3', '#E4572E', '#29335C', '#DB5461', '#816C5B', '#3E92CC', '#6FBF73'];
