import { THREAD_CAPS } from '../thread';
import { getAiKey } from './key';

/**
 * Caption + thread generator. Same contract as the carousel engine: real model
 * when the user has a Gemini key, deterministic offline engine otherwise, and
 * every result is clamped to the platform caps afterwards — never trusted.
 *
 * The thread mode is written for natural storytelling: one idea per post, a
 * real hook, a payoff, and no "1/", "🧵" or "thread" markers.
 */

const MODEL = 'gemini-2.5-flash';
const endpoint = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;

export type SocialPlatform = 'any' | 'x' | 'bluesky' | 'threads' | 'mastodon';

export type SocialTone = 'story' | 'punchy' | 'friendly' | 'professional' | 'bold';

export const SOCIAL_TONES: { id: SocialTone; label: string }[] = [
  { id: 'story', label: 'Story' },
  { id: 'punchy', label: 'Punchy' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'professional', label: 'Pro' },
  { id: 'bold', label: 'Bold' },
];

export const SOCIAL_PLATFORMS: { id: SocialPlatform; label: string }[] = [
  { id: 'any', label: 'Anywhere' },
  { id: 'x', label: 'X' },
  { id: 'bluesky', label: 'Bluesky' },
  { id: 'threads', label: 'Threads' },
  { id: 'mastodon', label: 'Mastodon' },
];

export interface SocialBrief {
  prompt: string;
  language: string;
  tone: SocialTone;
  /** true = write a connected thread; false = one caption */
  thread: boolean;
  /** target number of thread posts */
  parts: number;
  hashtags: boolean;
  platform: SocialPlatform;
}

export interface SocialResult {
  /** single-post copy (when thread mode, this is the head post) */
  caption: string;
  /** thread segments, in order (empty when not threading) */
  thread: string[];
  hashtags: string[];
  provider: string;
  warnings: string[];
}

export const DEFAULT_SOCIAL_BRIEF: SocialBrief = {
  prompt: '',
  language: 'English',
  tone: 'story',
  thread: true,
  parts: 5,
  hashtags: true,
  platform: 'any',
};

/** Strictest cap a segment has to fit: the chosen platform, or X's 280 for "any". */
export function capFor(platform: SocialPlatform): number {
  if (platform === 'any') return THREAD_CAPS.x;
  return THREAD_CAPS[platform] ?? 280;
}

const CAPTION_MAX = 2200;

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim() : '');
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** Trim to `limit` characters on a word boundary, adding an ellipsis only when cut. */
function clampChars(s: string, limit: number): string {
  const t = clean(s);
  if (t.length <= limit) return t;
  const cut = t.slice(0, Math.max(0, limit - 1));
  const at = cut.lastIndexOf(' ');
  return (at > limit * 0.6 ? cut.slice(0, at) : cut).trimEnd() + '…';
}

/** Strip leading list markers ("1/", "2.", "3)") a model may sneak in. */
function stripNumbering(s: string): string {
  return s.replace(/^\s*\(?\d{1,2}\s*[\/.)\]:-]\s*/, '').replace(/^\s*[-•]\s*/, '').trim();
}

const HASH_STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'your', 'you', 'about', 'from', 'into', 'when',
  'what', 'how', 'why', 'are', 'was', 'were', 'will', 'can', 'not', 'but', 'our', 'their', 'them',
  'have', 'has', 'had', 'been', 'just', 'like', 'more', 'most', 'some', 'one', 'out', 'get', 'got',
]);

function deriveHashtags(prompt: string, n = 4): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words(prompt.toLowerCase()).map((x) => x.replace(/[^a-z0-9]/g, ''))) {
    if (!w || w.length < 4 || HASH_STOP.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push('#' + w);
    if (out.length >= n) break;
  }
  return out;
}

function normHashtags(raw: unknown, brief: SocialBrief): string[] {
  if (!brief.hashtags) return [];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    let t = clean(item).replace(/^#+/, '').replace(/[^A-Za-z0-9_]/g, '');
    if (!t) continue;
    const tag = '#' + t;
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= 5) break;
  }
  return out;
}

/** Clamp a model/offline response into something the composer can always use. */
export function normalizeSocial(raw: any, brief: SocialBrief, provider: string): SocialResult {
  const warnings: string[] = [];
  const limit = capFor(brief.platform);

  let thread: string[] = Array.isArray(raw?.thread)
    ? raw.thread.map((s: unknown) => stripNumbering(clean(s))).filter(Boolean)
    : [];
  let caption = stripNumbering(clean(raw?.caption));

  if (brief.thread) {
    if (thread.length < 2 && caption) thread = [caption];
    const maxParts = Math.max(2, Math.min(12, brief.parts));
    if (thread.length > maxParts) {
      thread = thread.slice(0, maxParts);
      warnings.push(`Trimmed the thread to ${maxParts} posts.`);
    }
    let clamped = false;
    thread = thread.map((s) => {
      if (s.length <= limit) return s;
      clamped = true;
      return clampChars(s, limit);
    });
    if (clamped) warnings.push(`Some posts were trimmed to fit ${limit} characters.`);
    if (!caption) caption = thread[0] ?? '';
    else if (caption.length <= limit) caption = clampChars(caption, limit);
  } else {
    thread = [];
    if (!caption && Array.isArray(raw?.thread)) caption = raw.thread.map((s: unknown) => clean(s)).filter(Boolean).join('\n\n');
    if (caption.length > CAPTION_MAX) {
      caption = clampChars(caption, CAPTION_MAX);
      warnings.push('The caption was trimmed — it was longer than any platform accepts.');
    }
  }

  const hashtags = normHashtags(raw?.hashtags, brief);
  if (outEmpty(caption, thread, hashtags)) warnings.push('Nothing usable came back — try rephrasing the idea.');

  return { caption, thread, hashtags, provider, warnings };
}

const outEmpty = (caption: string, thread: string[], hashtags: string[]) =>
  !caption && thread.length === 0 && hashtags.length === 0;

/* ---------------- model path ---------------- */

function buildPrompt(brief: SocialBrief, limit: number): string {
  const lines = [
    'You are a sharp social-media writer. You sound like a real person telling a story, never like a brand or a press release.',
    `Language: ${brief.language}. Tone: ${brief.tone}.`,
    `The user's raw idea: "${brief.prompt}"`,
  ];
  if (brief.thread) {
    lines.push(
      `Write it as a NATURAL THREAD of about ${brief.parts} connected posts.`,
      'Open with a hook that earns the next tap. Move ONE idea per post, in a rising order, and land a real payoff in the last one.',
      'Each post must stand on its own but pull the reader forward. Vary sentence length. Write like you talk.',
      `Never number the posts, never write "1/", never use "🧵", never say "thread", "in this thread", or "let me explain". No hashtags inside the posts.`,
      `Keep every post under ${limit} characters.`,
      'Set "caption" to the first post.',
    );
  } else {
    lines.push(
      'Write ONE tight caption — a hook line, one or two beats of value, and a soft close. No numbered lists unless the idea is genuinely a list.',
      `Keep it under ${CAPTION_MAX} characters, but shorter is better.`,
      'Set "thread" to an empty array.',
    );
  }
  lines.push(
    brief.hashtags
      ? 'Return 3-5 relevant hashtags separately (no more).'
      : 'Return an empty hashtags array.',
    'No emojis unless one genuinely fits; never more than one. No corporate filler like "game-changer" or "unlock".',
    'Return ONLY JSON: {"caption":"...","thread":["..."],"hashtags":["..."]}.',
  );
  return lines.join('\n');
}

const SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string' },
    thread: { type: 'array', items: { type: 'string' } },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
  required: ['caption'],
};

export async function geminiSocial(brief: SocialBrief, key: string): Promise<any> {
  const limit = capFor(brief.platform);
  const body = {
    systemInstruction: { parts: [{ text: 'You output strict JSON only. No markdown fences, no commentary.' }] },
    contents: [{ role: 'user', parts: [{ text: buildPrompt(brief, limit) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.9, maxOutputTokens: 2048 },
  };
  const r = await fetch(endpoint(key), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(humanErr(j));
  const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('The model returned unusable JSON — try again.');
  return JSON.parse(m[0]);
}

function humanErr(j: any): string {
  const msg = String(j?.error?.message ?? '');
  if (/API key/i.test(msg)) return 'That API key was rejected — check it and try again.';
  if (/quota|rate|429|RESOURCE_EXHAUSTED/i.test(msg)) return 'Rate limit hit — wait a minute and retry.';
  return msg || 'Gemini request failed.';
}

/* ---------------- offline path ---------------- */

/** Deterministic, human-sounding stand-in so the flow works with no key. */
export function mockSocial(brief: SocialBrief): any {
  const topic = clean(brief.prompt) || 'your idea';
  const t = topic.replace(/[.!?]+$/, '');
  const hooks: Record<SocialTone, string> = {
    story: `Let me tell you about ${t}.`,
    punchy: `${cap(t)} — but not how you think.`,
    friendly: `Okay, let's actually talk about ${t}.`,
    professional: `A quick note on ${t}.`,
    bold: `Most advice about ${t} is wrong.`,
  };
  const beats = [
    hooks[brief.tone] ?? hooks.story,
    `For a long time I treated ${t} like a checklist. More effort, more tabs open, more noise. It didn't work.`,
    `What finally moved things was smaller than I expected: one habit, done on the days I didn't feel like it.`,
    `Here's the part most people skip — you don't need a new system. You need to keep the one you have for longer than it feels exciting.`,
    `So pick the smallest version, attach it to something you already do, and let it be boring for a while.`,
    `If ${t} has been on your mind, save this and start today.`,
  ];
  if (!brief.thread) {
    return {
      caption: [beats[0], beats[2], beats[4]].join('\n\n'),
      thread: [],
      hashtags: deriveHashtags(topic),
    };
  }
  const n = Math.max(2, Math.min(beats.length, brief.parts));
  return { caption: beats[0], thread: beats.slice(0, n), hashtags: deriveHashtags(topic) };
}

/* ---------------- entry point ---------------- */

export async function generateSocial(brief: SocialBrief): Promise<SocialResult> {
  const key = await getAiKey();
  if (key) {
    try {
      const raw = await geminiSocial(brief, key);
      return normalizeSocial(raw, brief, 'Gemini 2.5 Flash');
    } catch (e: any) {
      return { caption: '', thread: [], hashtags: [], provider: 'Gemini 2.5 Flash', warnings: [e?.message ?? 'Generation failed.'] };
    }
  }
  await new Promise((r) => setTimeout(r, 500));
  return normalizeSocial(mockSocial(brief), brief, 'Draft engine (offline)');
}
