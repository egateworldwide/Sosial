/** Zap — print-studio editorial theme.
 * Warm paper, ink, one persimmon accent. App chrome type: Space Grotesk
 * display + Inter UI. NOTE: custom families must never be paired with
 * fontWeight (iOS drops the font) — use the Bold family files instead. */
export const C = {
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
  // semantic accents (kept for compatibility)
  paleYellow: '#F9E2CF',
  yellowText: '#7C2D12',
  paleBlue: '#E1F3FE',
  blueText: '#1F6C9F',
  paleGreen: '#EDF3EC',
  greenText: '#346538',
  paleRed: '#FDEBEC',
  redText: '#9F2F2D',
};

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
