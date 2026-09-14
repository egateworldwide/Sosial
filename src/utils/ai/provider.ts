import { ContentBrief, GenResult } from './types';
import { normalizeResult } from './rules';
import { mockGenerate } from './mock';

export interface AIProvider {
  id: string;
  label: string;
  /** Return raw pages; the caller always runs them through normalizeResult. */
  raw(brief: ContentBrief): Promise<any[]>;
}

/** Local, keyless generator — the default until a real endpoint is configured. */
export const MOCK_PROVIDER: AIProvider = {
  id: 'mock',
  label: 'Draft engine (offline)',
  async raw(brief) {
    // tiny delay so the UI can show its busy state
    await new Promise((r) => setTimeout(r, 450));
    return mockGenerate(brief);
  },
};

/**
 * To wire a real model later:
 *   1. Add a provider that reads the key from SecureStore (never bundle it).
 *   2. Have it prompt for JSON matching GenBlock[] per page, one call for all pages.
 *   3. Return the parsed pages — normalizeResult enforces every rule regardless.
 */
export function getProvider(): AIProvider {
  return MOCK_PROVIDER;
}

export async function generate(brief: ContentBrief): Promise<GenResult> {
  const provider = getProvider();
  try {
    const raw = await provider.raw(brief);
    return normalizeResult(raw as any, brief, provider.label);
  } catch (e: any) {
    return { pages: [], provider: provider.label, warnings: [e?.message ?? 'Generation failed.'] };
  }
}
