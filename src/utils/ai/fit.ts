import { CardStyle } from '../../types';
import { GenBlock } from './types';

/** Canvas is authored at 340 units wide; card height is stored in those units. */
const W = 340;
/** body padding is 13 horizontal for every style; only top/bottom change. */
const INNER_W = W - 26;

/** Fixed chrome measured from SocialCardChrome — header above and footer below the
 *  auto-fit body. Kept in canvas units so it scales with the canvas. */
interface Metrics { header: number; bodyTop: number; bodyBottom: number; footer: number; }
const METRICS: Record<CardStyle, Metrics> = {
  // no header/footer; the body itself carries 13 padding all round
  minimal: { header: 0, bodyTop: 13, bodyBottom: 13, footer: 0 },
  // header 34 · stats 22 · actions 27
  facebook: { header: 34, bodyTop: 8, bodyBottom: 8, footer: 49 },
  // header 33 · actions 21
  x: { header: 33, bodyTop: 8, bodyBottom: 8, footer: 21 },
  // header 30 · like row + social line + comments line 59
  instagram: { header: 30, bodyTop: 8, bodyBottom: 8, footer: 59 },
  // header 31 · actions + replies 41
  threads: { header: 31, bodyTop: 8, bodyBottom: 8, footer: 41 },
};

const lines = (text: string, font: number, availW: number) => {
  const charsPerLine = Math.max(6, Math.floor(availW / (font * 0.52)));
  return Math.max(1, Math.ceil(text.trim().length / charsPerLine));
};

/** Heading line box + its bottom margin (matches ContentBlockView). */
function headingH(heading: string | undefined, zoom: number): number {
  if (!heading) return 0;
  const fs = 15.3 * zoom;
  return lines(heading, fs, INNER_W) * fs * 1.25 + 5.1;
}

/** Rendered height of one block body, in canvas units (edges come from ContentBlockView). */
function blockBodyH(b: GenBlock, zoom: number): number {
  const bodyFont = 12.92 * zoom;
  const bodyLine = 18.02 * zoom;
  const smallFont = 10.88 * zoom;

  if (b.type === 'free') {
    return (b.lines ?? []).reduce((a, s) => a + lines(s, bodyFont, INNER_W) * bodyLine, 0);
  }
  if (b.type === 'bullets') {
    const textW = INNER_W - 6.8 * 2;
    return (b.items ?? []).reduce((a, s) => a + Math.max(11.2, lines(s, bodyFont, textW) * bodyLine) + 5.1, 0);
  }
  if (b.type === 'numbered') {
    const textW = INNER_W - 16 - 6.8;
    return (b.items ?? []).reduce((a, s) => a + Math.max(17, lines(s, bodyFont, textW) * bodyLine) + 5.1, 0);
  }
  if (b.type === 'table') {
    const rowH = 9.52 * zoom * 1.2 + 8.16;
    const n = (b.rows?.length ?? 0) + (b.columns?.length ? 1 : 0);
    return 2 + n * rowH;
  }
  if (b.type === 'bar') {
    const n = b.series?.length ?? 0;
    const item = smallFont * 1.2 + 10.2;
    return n * item + Math.max(0, n - 1) * 6.8;
  }
  if (b.type === 'vbar') {
    return smallFont * 1.2 * 2 + 119 + 6;
  }
  if (b.type === 'pie') {
    const R = Math.max(20, W * 0.15);
    const ring = (R + (R * 0.35) / 2 + 2) * 2;
    const n = b.series?.length ?? 0;
    const legend = n > 0 ? n * (smallFont * 1.2 + 5.1) - 5.1 : 0;
    return Math.max(ring, legend);
  }
  if (b.type === 'image') {
    // square by default; the block is laid out at the card's inner width
    return INNER_W;
  }
  return 0;
}

function blockH(b: GenBlock, zoom: number): number {
  return headingH(b.heading, zoom) + blockBodyH(b, zoom);
}

/**
 * Height of the fixed card that holds these blocks, app-measured (never model-guessed).
 * Deliberately tuned *just* under the natural height so AutoFit fills the card exactly
 * instead of leaving a gap at the bottom — a too-tall card is what made Facebook/IG
 * cards show dead space above their like/comment rows.
 */
export function estimateCardH(blocks: GenBlock[], opts: { contentScale?: number; cardStyle?: CardStyle } = {}): number {
  const zoom = opts.contentScale ?? 1;
  const style = opts.cardStyle ?? 'minimal';
  const m = METRICS[style];
  const content = blocks.reduce((a, b) => a + blockH(b, zoom), 0);
  const total = m.header + m.bodyTop + m.bodyBottom + m.footer + content;
  // bias slightly under so the auto-fit scaler fills the card rather than leaving slack
  const fitted = Math.round(total * 0.97);
  const floor = m.header + m.footer + m.bodyTop + m.bodyBottom + 8;
  return Math.max(floor, Math.min(640, fitted));
}