/** Hex color luminance / contrast helpers for adaptive chrome. */

function rgb(hex: string): [number, number, number] {
  const h = (hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = (s: string) => {
    const v = parseInt(s, 16);
    return isNaN(v) ? 255 : v;
  };
  return [n(full.slice(0, 2)) / 255, n(full.slice(2, 4)) / 255, n(full.slice(4, 6)) / 255];
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isDarkHex(hex: string): boolean {
  return luminance(hex) < 0.45;
}

/** WCAG-style contrast ratio between two hex colors (1 = identical, 21 = max). */
export function contrastRatio(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
