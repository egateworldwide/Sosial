import { PostSize } from './types';

export const POST_SIZES: PostSize[] = [
  { id: 'square', label: '1:1 Square', hint: 'IG / FB post · 1080×1080', width: 1080, height: 1080, ratio: 1 },
  { id: 'portrait', label: '4:5 Portrait', hint: 'IG portrait · 1080×1350', width: 1080, height: 1350, ratio: 1.25 },
  { id: 'story', label: '9:16 Story', hint: 'Story / Reel / TikTok · 1080×1920', width: 1080, height: 1920, ratio: 16 / 9 },
  { id: 'landscape', label: '16:9 Wide', hint: 'YouTube / X · 1920×1080', width: 1920, height: 1080, ratio: 9 / 16 },
  { id: 'a4', label: 'A4 Flyer', hint: 'Print / carousel · 1240×1754', width: 1240, height: 1754, ratio: 1.414 },
];

export const PALETTE = [
  '#111111', '#FFFFFF', '#F5F1E8', '#FFE45E', '#FF5C5C',
  '#4D7CFE', '#22C55E', '#A855F7', '#EC4899', '#0EA5E9',
  '#F97316', '#14B8A6', '#EAB308', '#1F2937',
  '#7C2D12', '#92400E', '#1F6C9F', '#346538', '#9F2F2D',
  '#6B7280', '#F9E2CF', '#E1F3FE', '#EDF3EC', '#FDEBEC',
];

export const BG_PRESETS = [
  { label: 'Minimal light', color: '#F5F1E8', patternColor: '#111111' },
  { label: 'Midnight', color: '#111111', patternColor: '#FFE45E' },
  { label: 'Paper dots', color: '#FFFFFF', patternColor: '#CBD5E1' },
  { label: 'Ocean grid', color: '#0EA5E9', patternColor: '#FFFFFF' },
];

export const SOCIAL_META: Record<string, { label: string; bg: string; glyph: string }> = {
  instagram: { label: 'Instagram', bg: '#E1306C', glyph: 'IG' },
  tiktok: { label: 'TikTok', bg: '#111111', glyph: 'TT' },
  x: { label: 'X', bg: '#000000', glyph: '𝕏' },
  facebook: { label: 'Facebook', bg: '#1877F2', glyph: 'f' },
  youtube: { label: 'YouTube', bg: '#FF0000', glyph: '▶' },
  whatsapp: { label: 'WhatsApp', bg: '#25D366', glyph: 'WA' },
  threads: { label: 'Threads', bg: '#000000', glyph: 'TH' },
};

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
