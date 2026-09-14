import { ContentBlock, PostPage } from '../../types';
import { uid } from '../../constants';
import { GenBlock, GenResult } from './types';

/** GenBlock → canvas ContentBlock. No colors/sizes: the template owns those. */
export function toContentBlock(b: GenBlock): ContentBlock {
  const id = uid('b');
  switch (b.type) {
    case 'free':
      return { id, type: 'free', heading: b.heading, items: b.lines };
    case 'bullets':
      return { id, type: 'bullets', heading: b.heading, items: b.items };
    case 'numbered':
      return { id, type: 'numbered', heading: b.heading, items: b.items };
    case 'table':
      return { id, type: 'table', heading: b.heading, items: [], table: [b.columns, ...b.rows] };
    case 'bar':
    case 'vbar':
    case 'pie':
      return { id, type: b.type, heading: b.heading, items: [], chart: b.series };
    case 'image':
      return { id, type: 'image', heading: b.heading, items: [], imageAspect: 'square' };
  }
}

export interface ApplyOptions {
  /** the page whose template (background, title, pfp, socials, card style) is reused */
  template: PostPage;
  contentScale?: number;
}

/**
 * Build the replacement page list: one page per generated page, each cloned from
 * the template so the *design* is untouched. Card height is auto — the card hugs
 * its generated content instead of a guessed fixed height. Page ids are fresh;
 * the caller swaps the whole list in atomically.
 */
export function applyGenResult(gen: GenResult, opts: ApplyOptions): PostPage[] {
  const { template } = opts;
  return gen.pages.map((p) => {
    const page: PostPage = JSON.parse(JSON.stringify(template));
    page.id = uid('page');
    page.blocks = p.blocks.map(toContentBlock);
    page.cardH = null;
    page.cardAuto = true;
    page.cardY = page.cardY ?? 'bottom';
    delete page.scheduledAt;
    delete page.scheduledPlatform;
    delete page.scheduledPlatforms;
    return page;
  });
}
