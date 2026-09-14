import { ContentBrief, GenBlock, GenPage } from './types';

/** Deterministic stand-in for a real model. Exercises the whole
 *  prompt → generate → normalize → apply → layout path with no API key.
 *  Replace via provider.ts once a real endpoint is wired.
 *
 *  Shape rule: every card starts with a TEXT block (heading + description), then
 *  one context block. Text AND context data are varied per card so no two cards
 *  repeat. A real model writes genuinely distinct copy; here we rotate templates. */
export function mockGenerate(brief: ContentBrief): GenPage[] {
  const idea = brief.prompt.trim() || 'your idea';
  const s = shortIdea(idea);
  const n = Math.max(1, Math.min(10, brief.pages));
  const max = Math.max(1, brief.maxBlocksPerPage);
  const pages: GenPage[] = [];

  for (let i = 0; i < n; i++) {
    const blocks: GenBlock[] = [];

    // block 1 — text: heading + description, unique per card
    blocks.push(textBlock(i, s));

    // block 2 — context block, unique per card
    if (max >= 2) blocks.push(contextBlock(i, s));

    if (brief.includeImages && blocks.length < max) {
      blocks.push({ type: 'image', heading: `Visual ${i + 1} for ${s}` });
    }

    pages.push({ blocks, imagePrompt: `${idea} — illustrative photo ${i + 1}` });
  }

  return pages;
}

/* ---------- text block variations ---------- */

function textBlock(i: number, s: string): GenBlock {
  const variants: { heading: string; lines: string[] }[] = [
    { heading: `Why ${s} matters`, lines: [`Most people overcomplicate ${s}.`, 'One clear habit beats ten vague plans.'] },
    { heading: `How ${s} works`, lines: ['Start with the smallest version you can repeat.', 'Consistency beats intensity every single week.'] },
    { heading: `${s}, simplified`, lines: ['Pick one outcome you actually care about.', 'Track it for a week before changing anything.'] },
    { heading: `Common ${s} mistakes`, lines: ['Chasing perfect instead of simply starting.', 'Changing the plan every few days.'] },
    { heading: `${s} quick wins`, lines: ['Ten focused minutes a day compounds fast.', 'Review weekly, adjust once, repeat.'] },
    { heading: `Make ${s} stick`, lines: ['Attach it to something you already do daily.', 'Miss once, never twice — then move on.'] },
    { heading: `The truth about ${s}`, lines: ['Results come from boring repetition, not hacks.', 'Keep the system, change the details.'] },
  ];
  // page number keeps every card's copy different even past the list length
  const v = variants[i % variants.length];
  const heading = i < variants.length ? v.heading : `${v.heading} · part ${Math.floor(i / variants.length) + 1}`;
  return { type: 'free', heading, lines: v.lines };
}

/* ---------- context block variations ---------- */

function contextBlock(i: number, s: string): GenBlock {
  const kind = i % 6;
  const bump = i * 7; // so repeated types still carry different numbers

  if (kind === 0) {
    return {
      type: 'bar',
      heading: `Progress on ${s}`,
      series: [
        { label: `Week ${1 + i}`, value: 30 + bump },
        { label: `Week ${2 + i}`, value: 52 + bump },
        { label: `Week ${3 + i}`, value: 78 + bump },
      ],
    };
  }
  if (kind === 1) {
    return {
      type: 'table',
      heading: `${s} at a glance`,
      columns: ['Aspect', 'Before', 'After'],
      rows: [
        ['Time', `${20 + bump} min`, `${10 + bump} min`],
        ['Focus', 'Scattered', 'Sharp'],
        ['Effort', 'High', 'Low'],
      ],
    };
  }
  if (kind === 2) {
    return {
      type: 'bullets',
      heading: `Points to remember ${i + 1}`,
      items: [
        `Start small with ${s}.`,
        'Measure one thing only.',
        'Adjust weekly, not daily.',
      ],
    };
  }
  if (kind === 3) {
    return {
      type: 'numbered',
      heading: `Step plan ${i + 1}`,
      items: [`Define your goal for ${s}.`, 'Block a daily slot.', 'Review and refine.'],
    };
  }
  if (kind === 4) {
    return {
      type: 'pie',
      heading: `Time split ${i + 1}`,
      series: [
        { label: 'Plan', value: 40 + bump },
        { label: 'Do', value: 35 + bump },
        { label: 'Review', value: 25 + bump },
      ],
    };
  }
  return {
    type: 'vbar',
    heading: `Momentum ${i + 1}`,
    series: [
      { label: 'Mon', value: 25 + bump },
      { label: 'Wed', value: 48 + bump },
      { label: 'Fri', value: 70 + bump },
    ],
  };
}

const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const shortIdea = (t: string) => {
  const w = t.trim().split(/\s+/).filter(Boolean);
  const chosen = w.length <= 6 ? w : w.slice(0, 4);
  return cap(chosen.join(' '));
};
