import { BlockType } from '../../types';

/** AI output schema — deliberately narrower than ContentBlock: no ids, no colors,
 *  no pixel sizes. The model only decides words + block shape. */
export type GenBlock =
  | { type: 'free'; heading?: string; lines: string[] }
  | { type: 'bullets'; heading?: string; items: string[] }
  | { type: 'numbered'; heading?: string; items: string[] }
  | { type: 'table'; heading?: string; columns: string[]; rows: string[][] }
  | { type: 'bar' | 'vbar' | 'pie'; heading?: string; series: { label: string; value: number }[] }
  | { type: 'image'; heading?: string };

export interface GenPage {
  blocks: GenBlock[];
  /** optional hint for the empty image placeholder (never a URL we fetch) */
  imagePrompt?: string;
}

export interface ContentBrief {
  /** free-form prompt — the user's idea, in their words */
  prompt: string;
  language: string;
  pages: number;
  maxWordsPerPage: number;
  maxBlocksPerPage: number;
  includeImages: boolean;
}

export interface GenResult {
  pages: GenPage[];
  provider: string;
  /** anything the normalizer had to clamp or drop — surfaced to the user */
  warnings: string[];
}

export const ALLOWED_TYPES: BlockType[] = ['free', 'bullets', 'numbered', 'table', 'bar', 'vbar', 'pie', 'image'];

export const DEFAULT_BRIEF: ContentBrief = {
  prompt: '',
  language: 'English',
  pages: 3,
  maxWordsPerPage: 60,
  maxBlocksPerPage: 2,
  includeImages: false,
};
