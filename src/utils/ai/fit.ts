import { CardStyle } from '../../types';
import { GenBlock } from './types';

/** Canvas is authored at 340 units wide; card height is stored in those units. */
const W = 340;

const CARD_PAD = 13;
const BLOCK_GAP = 10;

/** Rough per-style chrome height (header + footer) in canvas units. */
const CHROME: Record<CardStyle, number> = {
  minimal: 4,
  facebook: 104,
  instagram: 132,
  threads: 112,
  x: 82,
};

function estLines(text: string, fontSize: number, availW: number): number {
  const charsPerLine = Math.max(6, Math.floor(availW / (fontSize * 0.52)));
  return Math.max(1, Math.ceil(text.trim().length / charsPerLine));
}

function headingH(heading?: string, availW = W - CARD_PAD * 2): number {
  if (!heading) return 0;
  const fs = 15.3;
  return estLines(heading, fs, availW) * fs * 1.3 + 4;
}

/** Height of one block's rendered body, in canvas units. */
function blockBodyH(b: GenBlock, zoom: number, availW: number): number {
  const scale = zoom;
  const labelFont = 12.9 * scale;
  const lineH = 18 * scale;

  if (b.type === 'free' || b.type === 'bullets' || b.type === 'numbered') {
    const items = 'items' in b ? (b.items ?? []) : (b.lines ?? []);
    const textW = b.type === 'free' ? availW : availW - 16 * scale;
    const rows = items.reduce((a, s) => a + estLines(s, labelFont, textW) * lineH + 4 * scale, 0);
    return rows;
  }
  if (b.type === 'table') {
    const rows = (b.rows?.length ?? 0) + 1;
    return rows * (9 * scale + 8 * scale) + 2;
  }
  if (b.type === 'bar') {
    const n = b.series?.length ?? 0;
    return n * (8 * scale + Math.max(6, 10 * scale) + 6 * scale);
  }
  if (b.type === 'vbar') {
    return 8 * scale + Math.max(80, availW * 0.35) + 8 * scale + 4;
  }
  if (b.type === 'pie') {
    const R = Math.max(20, availW * 0.16);
    const SW = R * 0.35;
    return (R + SW / 2 + 2) * 2;
  }
  if (b.type === 'image') {
    return availW; // assume square until the user picks/crops
  }
  return 0;
}

/**
 * Estimate the fixed card height that comfortably holds these blocks.
 * App-measured (not model-guessed): AutoFit still guards the overflow edge,
 * so an approximate number is safe.
 */
export function estimateCardH(blocks: GenBlock[], opts: { contentScale?: number; cardStyle?: CardStyle } = {}): number {
  const zoom = opts.contentScale ?? 1;
  const style = opts.cardStyle ?? 'minimal';
  const availW = W - CARD_PAD * 2;
  let h = CHROME[style] + CARD_PAD * 2;
  blocks.forEach((b, i) => {
    if (i > 0) h += BLOCK_GAP;
    h += headingH(b.heading, availW) + blockBodyH(b, zoom, availW);
  });
  return Math.round(Math.max(140, Math.min(640, h)));
}
