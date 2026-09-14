import { ContentBrief, GenBlock, GenPage } from './types';

/** Deterministic stand-in for a real model. Good enough to exercise the whole
 *  prompt → generate → normalize → apply → layout path with no API key.
 *  Replace via provider.ts once a real endpoint is wired.
 *
 *  Shape rule: every card starts with a TEXT block (heading + description), then
 *  one context block. A real model decides that second block from the prompt;
 *  here we rotate through the block types so every kind gets exercised. */
export function mockGenerate(brief: ContentBrief): GenPage[] {
  const idea = brief.prompt.trim() || 'your idea';
  const short = shortIdea(idea);
  const n = Math.max(1, Math.min(10, brief.pages));
  const max = Math.max(1, brief.maxBlocksPerPage);
  const CONTEXT: GenBlock['type'][] = ['bar', 'table', 'bullets', 'numbered', 'pie', 'vbar'];
  const pages: GenPage[] = [];

  for (let i = 0; i < n; i++) {
    const blocks: GenBlock[] = [];

    // block 1 — text: heading with description, always present
    blocks.push({
      type: 'free',
      heading: `${short}`,
      lines: [
        `Here is what actually matters about ${short}.`,
        `${cap(short)} is easier than it looks — start small and stay consistent.`,
      ],
    });

    // block 2 — context block, depends on what the card is about
    if (max >= 2) {
      const kind = CONTEXT[i % CONTEXT.length];
      if (kind === 'bar') {
        blocks.push({
          type: 'bar',
          heading: 'By the numbers',
          series: [
            { label: 'Week 1', value: 35 },
            { label: 'Week 2', value: 58 },
            { label: 'Week 3', value: 82 },
          ],
        });
      } else if (kind === 'table') {
        blocks.push({
          type: 'table',
          heading: `${short} at a glance`,
          columns: ['Aspect', 'Before', 'After'],
          rows: [
            ['Time', 'Slow', 'Fast'],
            ['Clarity', 'Low', 'High'],
            ['Cost', 'High', 'Low'],
          ],
        });
      } else if (kind === 'bullets') {
        blocks.push({
          type: 'bullets',
          heading: 'Quick points',
          items: ['One clear goal beats five vague ones.', 'Ten focused minutes a day adds up.', 'Review weekly, adjust once.'],
        });
      } else if (kind === 'numbered') {
        blocks.push({
          type: 'numbered',
          heading: 'Next steps',
          items: [`Decide your goal for ${short}.`, 'Block 10 minutes daily.', 'Track one week, then review.'],
        });
      } else if (kind === 'pie') {
        blocks.push({
          type: 'pie',
          heading: 'Where the time goes',
          series: [
            { label: 'Planning', value: 45 },
            { label: 'Doing', value: 35 },
            { label: 'Review', value: 20 },
          ],
        });
      } else if (kind === 'vbar') {
        blocks.push({
          type: 'vbar',
          heading: 'Momentum',
          series: [
            { label: 'Mon', value: 30 },
            { label: 'Wed', value: 55 },
            { label: 'Fri', value: 78 },
          ],
        });
      }
    }

    // optional image slot when there is room left
    if (brief.includeImages && blocks.length < max) {
      blocks.push({ type: 'image', heading: `Visual for ${short}` });
    }

    pages.push({ blocks, imagePrompt: `${idea} — illustrative photo` });
  }

  return pages;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const shortIdea = (s: string) => {
  const w = s.trim().split(/\s+/).slice(0, 3).join(' ');
  return cap(w);
};
