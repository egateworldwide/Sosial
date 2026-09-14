import { ContentBrief, GenPage } from './types';

/** Deterministic stand-in for a real model. Good enough to exercise the whole
 *  brief → generate → normalize → apply → layout path with no API key.
 *  Replace via provider.ts once a real endpoint is wired. */
export function mockGenerate(brief: ContentBrief): GenPage[] {
  const topic = brief.topic.trim() || 'your idea';
  const audience = brief.audience.trim() || 'your audience';
  const cta = brief.cta.trim() || 'Learn more';
  const n = Math.max(1, Math.min(10, brief.pages));
  const pages: GenPage[] = [];

  for (let i = 0; i < n; i++) {
    const kind = i % 5;
    if (kind === 0) {
      pages.push({
        blocks: [
          {
            type: 'bullets',
            heading: `Why ${short(topic)}`,
            items: [
              `${cap(topic)} saves ${audience} time every week.`,
              `It removes the guesswork from daily decisions.`,
              `Small habit, compounding long-term results.`,
            ],
          },
        ],
      });
      continue;
    }
    if (kind === 1) {
      pages.push({
        blocks: [
          {
            type: 'numbered',
            heading: 'How to start',
            items: [`Pick one clear goal for ${short(topic)}.`, 'Set a 10-minute daily block.', `Track it for a week, then review.`],
          },
        ],
      });
      continue;
    }
    if (kind === 2) {
      pages.push({
        blocks: [
          {
            type: 'bar',
            heading: 'By the numbers',
            series: [
              { label: 'Week 1', value: 35 },
              { label: 'Week 2', value: 58 },
              { label: 'Week 3', value: 82 },
            ],
          },
        ],
      });
      continue;
    }
    if (kind === 3) {
      pages.push({
        blocks: [
          {
            type: 'table',
            heading: `${short(topic)} at a glance`,
            columns: ['Aspect', 'Before', 'After'],
            rows: [
              ['Time', 'Slow', 'Fast'],
              ['Clarity', 'Low', 'High'],
              ['Cost', 'High', 'Low'],
            ],
          },
        ],
      });
      continue;
    }
    const blocks: GenPage['blocks'] = [
      {
        type: 'free',
        heading: 'Key insight',
        lines: [
          `${cap(topic)} works best when it is simple and repeated.`,
          `Start today — ${cta.toLowerCase()}.`,
        ],
      },
    ];
    if (brief.includeImages && brief.maxBlocksPerPage > blocks.length) {
      blocks.push({ type: 'image', heading: `Visual for ${short(topic)}` });
    }
    pages.push({ blocks, imagePrompt: `${topic} — illustrative photo` });
  }

  return pages;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const short = (s: string) => {
  const w = s.trim().split(/\s+/).slice(0, 3).join(' ');
  return cap(w);
};
