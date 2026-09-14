import { useFonts, Inter_400Regular, Inter_700Bold, Inter_900Black } from '@expo-google-fonts/inter';
import { PlusJakartaSans_400Regular, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';
import { SpaceGrotesk_400Regular, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { PlayfairDisplay_400Regular, PlayfairDisplay_700Bold, PlayfairDisplay_900Black } from '@expo-google-fonts/playfair-display';
import { CrimsonPro_400Regular, CrimsonPro_700Bold } from '@expo-google-fonts/crimson-pro';

export type FontId = 'inter' | 'jakarta' | 'space-grotesk' | 'playfair' | 'crimson' | 'system';

export interface FontMeta {
  label: string;
  regular?: string;
  bold?: string;
  black?: string;
}

/**
 * IMPORTANT: fontFamily values must be the registered family NAME strings
 * (matching the keys used in useFonts below), NOT the imported asset objects.
 * The @expo-google-fonts exports are numeric asset IDs — passing those as
 * fontFamily silently fails and falls back to the system font.
 */
export const FONTS: Record<FontId, FontMeta> = {
  inter: { label: 'Inter', regular: 'Inter_400Regular', bold: 'Inter_700Bold', black: 'Inter_900Black' },
  jakarta: { label: 'Jakarta', regular: 'PlusJakartaSans_400Regular', bold: 'PlusJakartaSans_700Bold', black: 'PlusJakartaSans_800ExtraBold' },
  'space-grotesk': { label: 'Space Grotesk', regular: 'SpaceGrotesk_400Regular', bold: 'SpaceGrotesk_700Bold' },
  playfair: { label: 'Playfair', regular: 'PlayfairDisplay_400Regular', bold: 'PlayfairDisplay_700Bold', black: 'PlayfairDisplay_900Black' },
  crimson: { label: 'Crimson', regular: 'CrimsonPro_400Regular', bold: 'CrimsonPro_700Bold' },
  system: { label: 'System' },
};

export function useFontsLoaded(): boolean {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_700Bold,
    Inter_900Black,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_700Bold,
    PlayfairDisplay_400Regular,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_900Black,
    CrimsonPro_400Regular,
    CrimsonPro_700Bold,
  });
  return loaded;
}

/** Resolve fontFamily string for a given font + weight (undefined = system default) */
export function fontFamily(id: FontId | undefined, weight: 'regular' | 'bold' | 'black' = 'regular'): string | undefined {
  if (!id || id === 'system') return undefined;
  const f = FONTS[id];
  if (!f) return undefined;
  if (weight === 'black' && f.black) return f.black;
  if (weight === 'bold') return f.bold ?? f.regular;
  return f.regular;
}

/**
 * Correctly-paired text style fragment. NEVER pair a custom fontFamily with
 * fontWeight on iOS (the font silently drops) — bold comes from the family file.
 */
export function F(id: FontId | undefined, bold = false, italic = false): { fontFamily?: string; fontWeight?: '400' | '700'; fontStyle?: 'normal' | 'italic' } {
  const fam = fontFamily(id, bold ? 'bold' : 'regular');
  if (fam) return { fontFamily: fam, ...(italic ? { fontStyle: 'italic' as const } : {}) };
  return { fontWeight: bold ? '700' : '400', ...(italic ? { fontStyle: 'italic' as const } : {}) };
}
