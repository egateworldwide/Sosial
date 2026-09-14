import { ContentBrief, GenBlock, GenPage, GenResult } from './types';

/** Hard cap on what one card can hold. Enforced after generation — never trusted
 *  to the model. Tune here; every producer (mock or real API) runs through it. */
export const RULES = {
  maxBlocksPerPage: 2,
  minBlocksPerPage: 1,
  maxWordsPerPage: 60,
  maxWordsPerHeading: 6,
  maxBulletItems: 5,
  maxWordsPerItem: 12,
  maxTableRows: 5,
  maxTableCols: 4,
  maxChartPoints: 6,
  minChartPoints: 2,
  minPages: 1,
  maxPages: 10,
  maxPagesHard: 10,
};

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const wordCount = (s: string) => words(s).length;
const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

/** Keep the first n words, never cut mid-word. */
export function truncateWords(s: string, n: number): string {
  const w = words(s);
  return w.length <= n ? w.join(' ') : w.slice(0, n).join(' ') + '…';
}

/** Count every human-visible word on a page so the per-page budget is real. */
function blockWords(b: GenBlock): number {
  let n = b.heading ? wordCount(b.heading) : 0;
  if (b.type === 'free') {
    n += (b.lines ?? []).reduce((a, s) => a + wordCount(s), 0);
  } else if (b.type === 'bullets' || b.type === 'numbered') {
    n += (b.items ?? []).reduce((a, s) => a + wordCount(s), 0);
  } else if (b.type === 'table') {
    n += (b.columns ?? []).reduce((a, s) => a + wordCount(s), 0);
    n += (b.rows ?? []).reduce((a, r) => a + r.reduce((x, c) => x + wordCount(c), 0), 0);
  } else if (b.type === 'bar' || b.type === 'vbar' || b.type === 'pie') {
    n += (b.series ?? []).reduce((a, d) => a + wordCount(d.label), 0);
  }
  return n;
}

function normalizeBlock(raw: any, warn: (m: string) => void): GenBlock | null {
  if (!raw || typeof raw.type !== 'string') return null;
  const type = raw.type;
  const heading = raw.heading ? truncateWords(clean(raw.heading), RULES.maxWordsPerHeading) : undefined;

  if (type === 'free' || type === 'bullets' || type === 'numbered') {
    const src: string[] = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.lines) ? raw.lines : [];
    let items = src.map((s) => truncateWords(clean(s), RULES.maxWordsPerItem)).filter(Boolean);
    const cap = type === 'free' ? RULES.maxBulletItems : RULES.maxBulletItems;
    if (items.length > cap) {
      warn(`Trimmed a ${type} block to ${cap} lines.`);
      items = items.slice(0, cap);
    }
    if (items.length === 0) return null;
    return type === 'free' ? { type: 'free', heading, lines: items } : { type, heading, items } as GenBlock;
  }

  if (type === 'table') {
    const columns = Array.isArray(raw.columns) ? raw.columns.map((c: any) => truncateWords(clean(c), 4)).slice(0, RULES.maxTableCols) : [];
    let rows: string[][] = Array.isArray(raw.rows)
      ? raw.rows.map((r: any) =>
          (Array.isArray(r) ? r : []).map((c: any) => truncateWords(clean(c), 6)).slice(0, RULES.maxTableCols),
        )
      : [];
    if (rows.length > RULES.maxTableRows) {
      warn(`Trimmed a table to ${RULES.maxTableRows} rows.`);
      rows = rows.slice(0, RULES.maxTableRows);
    }
    if (columns.length === 0 && rows.length === 0) return null;
    return { type: 'table', heading, columns, rows };
  }

  if (type === 'bar' || type === 'vbar' || type === 'pie') {
    let series = Array.isArray(raw.series)
      ? raw.series
          .map((d: any) => ({ label: truncateWords(clean(d?.label), 4), value: Number(d?.value) }))
          .filter((d: any) => d.label && isFinite(d.value))
      : [];
    if (series.length > RULES.maxChartPoints) {
      warn(`Trimmed a chart to ${RULES.maxChartPoints} points.`);
      series = series.slice(0, RULES.maxChartPoints);
    }
    if (series.length < RULES.minChartPoints) {
      warn('Dropped a chart with too few values.');
      return null;
    }
    return { type, heading, series };
  }

  if (type === 'image') return { type: 'image', heading };

  return null;
}

/** Clamp a model/mock response into something the canvas can always render. */
export function normalizeResult(pages: GenPage[], brief: ContentBrief, provider: string): GenResult {
  const warnings: string[] = [];
  let warnedBlocks = false;
  let warnedWords = false;

  const out: GenPage[] = [];
  const target = Math.max(RULES.minPages, Math.min(RULES.maxPages, brief.pages || 1));

  for (const p of pages.slice(0, target)) {
    const blocks: GenBlock[] = [];
    for (const raw of (p.blocks ?? [])) {
      const b = normalizeBlock(raw, (m) => { if (!warnedBlocks) { warnedBlocks = true; warnings.push(m); } });
      if (b) blocks.push(b);
      if (blocks.length >= brief.maxBlocksPerPage) break;
    }
    if (blocks.length === 0) continue;

    // per-page word budget: shed from the bottom up until it fits
    let total = blocks.reduce((a, b) => a + blockWords(b), 0);
    if (total > brief.maxWordsPerPage) {
      warnedWords = true;
      for (let i = blocks.length - 1; i >= 0 && total > brief.maxWordsPerPage; i--) {
        const b: any = blocks[i];
        if (b.type === 'free' || b.type === 'bullets' || b.type === 'numbered') {
          const items = [...(b.items ?? b.lines ?? [])];
          while (items.length > 0 && total > brief.maxWordsPerPage) {
            items.pop();
            blocks[i] = (b.type === 'free' ? { type: 'free', heading: b.heading, lines: items } : { type: b.type, heading: b.heading, items }) as GenBlock;
            total = blocks.reduce((a, x) => a + blockWords(x), 0);
          }
          if (items.length === 0) blocks.splice(i, 1);
        } else if (b.type === 'table') {
          const rows = [...(b.rows ?? [])];
          while (rows.length > 1 && total > brief.maxWordsPerPage) {
            rows.pop();
            blocks[i] = { type: 'table', heading: b.heading, columns: b.columns, rows };
            total = blocks.reduce((a, x) => a + blockWords(x), 0);
          }
        } else if (b.type === 'bar' || b.type === 'vbar' || b.type === 'pie') {
          const series = [...(b.series ?? [])];
          while (series.length > RULES.minChartPoints && total > brief.maxWordsPerPage) {
            series.pop();
            blocks[i] = { type: b.type, heading: b.heading, series };
            total = blocks.reduce((a, x) => a + blockWords(x), 0);
          }
        }
      }
    }
    if (blocks.length === 0) continue;
    out.push({ blocks: blocks.slice(0, brief.maxBlocksPerPage), imagePrompt: p.imagePrompt });
  }

  if (warnedBlocks) warnings.push('Some blocks were trimmed to fit the card rules.');
  if (warnedWords) warnings.push(`Content trimmed to ${brief.maxWordsPerPage} words per card.`);
  if (out.length === 0) warnings.push('Nothing usable was generated — try a more specific topic.');

  return { pages: out, provider, warnings };
}

/** Public rule summary for the UI, so limits are never a surprise. */
export function rulesSummary(brief: ContentBrief): string {
  return `Max ${brief.maxBlocksPerPage} blocks and ${brief.maxWordsPerPage} words per card · up to ${RULES.maxPages} cards`;
}
