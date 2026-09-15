import { ContentBrief } from './types';

const MODEL = 'gemini-2.5-flash';
const endpoint = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;

/** Loose object schema — every field optional except `type`; rules.ts clamps it all. */
const SCHEMA = {
  type: 'object',
  properties: {
    pages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          blocks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['free', 'bullets', 'numbered', 'table', 'bar', 'vbar', 'pie', 'image'] },
                heading: { type: 'string' },
                lines: { type: 'array', items: { type: 'string' } },
                items: { type: 'array', items: { type: 'string' } },
                columns: { type: 'array', items: { type: 'string' } },
                rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
                series: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { label: { type: 'string' }, value: { type: 'number' } },
                    required: ['label', 'value'],
                  },
                },
              },
              required: ['type'],
            },
          },
        },
        required: ['blocks'],
      },
    },
  },
  required: ['pages'],
};

function buildPrompt(brief: ContentBrief): string {
  return [
    `You write social-media carousel copy. Language: ${brief.language}.`,
    `User's idea: ${brief.prompt}`,
    `Produce exactly ${brief.pages} cards. Card 1 is the hook, the last card closes with a takeaway.`,
    `Every card: a TEXT block first (heading of at most 6 words + 1-2 short description lines), then ONE context block that fits that card's message — pick from bullets, numbered steps, a small table (short cells), or a chart with 2-6 numeric points. Never repeat the same heading or the same lines twice.`,
    `Hard limits: at most ${brief.maxBlocksPerPage} blocks per card, at most ${brief.maxWordsPerPage} words per card. Chart values must be numbers; keep labels under 4 words.`,
    brief.includeImages
      ? 'You may add one image block (type "image" with a heading) to a card that has room.'
      : 'Do not emit image blocks.',
    'Return ONLY JSON: {"pages":[{"blocks":[{"type":"free","heading":"...","lines":["..."]}]}]}.',
  ].join('\n');
}

/**
 * One call returns all cards. `grounding` adds Google Search so the copy can
 * reference current facts — costs extra per call, so the UI gates it behind
 * an explicit toggle. Everything returned still passes through normalizeResult.
 */
export async function geminiRaw(brief: ContentBrief, key: string, grounding: boolean): Promise<any[]> {
  const body: any = {
    systemInstruction: { parts: [{ text: 'You output strict JSON only. No markdown fences, no commentary.' }] },
    contents: [{ role: 'user', parts: [{ text: buildPrompt(brief) }] }],
    generationConfig: grounding
      ? { responseMimeType: 'text/plain', temperature: 0.7, maxOutputTokens: 4096 }
      : { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.8, maxOutputTokens: 4096 },
  };
  if (grounding) body.tools = [{ google_search: {} }];

  const r = await fetch(endpoint(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(humanErr(j));
  const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
  const pages = extractPages(text);
  if (!pages) throw new Error('The model returned unusable JSON — try again.');
  return pages;
}

function extractPages(text: string): any[] | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    if (o && Array.isArray(o.pages)) return o.pages;
    if (Array.isArray(o)) return o;
    return null;
  } catch {
    return null;
  }
}

function humanErr(j: any): string {
  const msg = String(j?.error?.message ?? '');
  if (/API key/i.test(msg)) return 'That API key was rejected — check it and try again.';
  if (/quota|rate|429|RESOURCE_EXHAUSTED/i.test(msg)) return 'Rate limit hit — wait a minute and retry.';
  return msg || 'Gemini request failed.';
}
