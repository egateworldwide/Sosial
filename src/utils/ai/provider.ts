import { ContentBrief, GenResult } from './types';
import { normalizeResult } from './rules';
import { mockGenerate } from './mock';
import { geminiRaw } from './gemini';
import { getAiKey } from './key';

export interface GenOpts {
  /** Google Search grounding for fresh facts — metered per call, so opt-in only */
  grounding?: boolean;
}

/**
 * Real model when the user has pasted their own Gemini key (SecureStore),
 * offline draft engine otherwise. Either way the output goes through
 * normalizeResult, so card rules hold no matter who wrote the copy.
 *
 * Later: a server-side provider can plug in here behind the same interface
 * (and hold the key itself) without touching the UI or the rules.
 */
export async function generate(brief: ContentBrief, opts: GenOpts = {}): Promise<GenResult> {
  const key = await getAiKey();
  if (key) {
    try {
      const raw = await geminiRaw(brief, key, !!opts.grounding);
      return normalizeResult(raw as any, brief, opts.grounding ? 'Gemini 2.5 Flash + Search' : 'Gemini 2.5 Flash');
    } catch (e: any) {
      return { pages: [], provider: 'Gemini 2.5 Flash', warnings: [e?.message ?? 'Generation failed.'] };
    }
  }
  await new Promise((r) => setTimeout(r, 450));
  return normalizeResult(mockGenerate(brief) as any, brief, 'Draft engine (offline)');
}
