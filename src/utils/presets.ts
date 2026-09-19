import AsyncStorage from '@react-native-async-storage/async-storage';
import { BackgroundStyle, PostPage, QuickPost } from '../types';
import { uid } from '../constants';

const KEY = 'quickpost_bg_presets_v1';

export interface BgPreset {
  id: string;
  name: string;
  bg: BackgroundStyle;
}

export async function loadCustomBgPresets(): Promise<BgPreset[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveCustomBgPreset(preset: BgPreset): Promise<BgPreset[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list: BgPreset[] = raw ? JSON.parse(raw) : [];
    list.unshift(preset);
    const next = list.slice(0, 30);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

export async function deleteCustomBgPreset(id: string): Promise<BgPreset[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list: BgPreset[] = raw ? JSON.parse(raw) : [];
    const next = list.filter((x) => x.id !== id);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

/* ---------- Full-project presets (size + backdrop + title + photo/socials + content) ---------- */

const PROJECT_KEY = 'quickpost_project_presets_v1';

export interface ProjectPreset {
  id: string;
  name: string;
  post: QuickPost;
  createdAt: number;
  /** starter templates shipped with the app (deletable, never re-seeded) */
  builtIn?: boolean;
}

export async function loadProjectPresets(): Promise<ProjectPreset[]> {
  try {
    const raw = await AsyncStorage.getItem(PROJECT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveProjectPreset(post: QuickPost): Promise<ProjectPreset[]> {
  try {
    const raw = await AsyncStorage.getItem(PROJECT_KEY);
    const list: ProjectPreset[] = raw ? JSON.parse(raw) : [];
    const preset: ProjectPreset = {
      id: uid('tpl'),
      name: post.name,
      post: JSON.parse(JSON.stringify(post)),
      createdAt: Date.now(),
    };
    list.unshift(preset);
    const next = list.slice(0, 30);
    await AsyncStorage.setItem(PROJECT_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

export async function renameProjectPreset(id: string, name: string): Promise<ProjectPreset[]> {
  try {
    const raw = await AsyncStorage.getItem(PROJECT_KEY);
    const list: ProjectPreset[] = raw ? JSON.parse(raw) : [];
    const p = list.find((x) => x.id === id);
    if (p) p.name = name;
    await AsyncStorage.setItem(PROJECT_KEY, JSON.stringify(list));
    return list;
  } catch {
    return [];
  }
}

export async function deleteProjectPreset(id: string): Promise<ProjectPreset[]> {
  try {
    const raw = await AsyncStorage.getItem(PROJECT_KEY);
    const list: ProjectPreset[] = raw ? JSON.parse(raw) : [];
    const next = list.filter((x) => x.id !== id);
    await AsyncStorage.setItem(PROJECT_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

/* ---------------- Starter templates (prebuilt, offline-safe) ---------------- */

const SEED_KEY = 'quickpost_seeded_starter_templates_v1';

function starterPage(opts: {
  bg: string;
  pattern?: BackgroundStyle['type'];
  title: string;
  subtitle?: string;
  items: string[];
}): PostPage {
  return {
    id: uid('page'),
    background: {
      type: opts.pattern ?? 'solid',
      color: opts.bg,
      patternColor: '#00000014',
      patternSize: 20,
      patternOpacity: 0.6,
      mixEnabled: false,
    },
    title: {
      text: opts.title,
      position: 'top',
      color: '#111111',
      size: 30,
      align: 'center',
      font: 'jakarta',
      bold: true,
      italic: false,
      subtitle: opts.subtitle,
      subtitleSize: 15,
      subtitleColor: '#44403C',
    },
    pfp: {
      hidden: true,
      pfpY: 'top',
      size: 64,
      shape: 'circle',
      socialPos: 'below',
      badgeBg: true,
      badgeRows: 1,
      handleColor: '#FFFFFF',
      handleSize: 8,
      iconSize: 16,
      iconOutline: false,
      socialGap: 6,
      align: 'center',
      borderW: 2,
    },
    socials: [],
    blocks: [
      { id: uid('b'), type: 'bullets', items: opts.items, textColor: '#111111' },
    ],
    font: 'jakarta',
    cardStyle: 'facebook',
    showWatermark: true,
    caption: '',
  };
}

function starterPost(name: string, sizeId: QuickPost['sizeId'], page: PostPage): QuickPost {
  return { id: uid('post'), name, sizeId, font: 'jakarta', createdAt: Date.now(), pages: [page] };
}

/**
 * First-run seed: three ready-made designs so the Templates page is never
 * bare. Runs once (marker key) — deleting a starter never brings it back.
 */
export async function seedStarterTemplates(): Promise<ProjectPreset[]> {
  try {
    const raw = await AsyncStorage.getItem(PROJECT_KEY);
    const list: ProjectPreset[] = raw ? JSON.parse(raw) : [];
    const done = await AsyncStorage.getItem(SEED_KEY);
    if (done) return list;
    const has = (id: string) => list.some((x) => x.id === id);
    const seeds: ProjectPreset[] = [];
    const now = Date.now();
    if (!has('starter-quote-v1')) {
      seeds.push({
        id: 'starter-quote-v1', name: 'Morning Quote', builtIn: true, createdAt: now,
        post: starterPost('Morning Quote', 'square', starterPage({
          bg: '#F2EDE2', title: 'Make today count.',
          subtitle: 'One goal. One focus. One win.',
          items: ['Pick a single priority', 'Big text, lots of whitespace', 'End with your handle'],
        })),
      });
    }
    if (!has('starter-sale-v1')) {
      seeds.push({
        id: 'starter-sale-v1', name: 'Weekend Sale', builtIn: true, createdAt: now,
        post: starterPost('Weekend Sale', 'square', starterPage({
          bg: '#F9E2CF', pattern: 'dots', title: 'WEEKEND SALE',
          subtitle: 'Up to 50% off, Sat–Sun only.',
          items: ['Doors open 9am', 'Bring a friend', 'While stocks last'],
        })),
      });
    }
    if (!has('starter-news-v1')) {
      seeds.push({
        id: 'starter-news-v1', name: 'Big Announcement', builtIn: true, createdAt: now,
        post: starterPost('Big Announcement', 'square', starterPage({
          bg: '#E1F3FE', pattern: 'waves', title: 'Big news, everyone.',
          subtitle: 'Here is what changes Monday.',
          items: ['What is new', 'Why it matters', 'What to do next'],
        })),
      });
    }
    const next = [...list, ...seeds];
    await AsyncStorage.setItem(PROJECT_KEY, JSON.stringify(next));
    await AsyncStorage.setItem(SEED_KEY, '1');
    return next;
  } catch {
    return [];
  }
}

/** Instantiate a preset as a fresh editable project. */
export async function instantiatePreset(id: string): Promise<QuickPost | null> {
  try {
    const raw = await AsyncStorage.getItem(PROJECT_KEY);
    const list: ProjectPreset[] = raw ? JSON.parse(raw) : [];
    const found = list.find((x) => x.id === id);
    if (!found) return null;
    const copy: QuickPost = {
      ...JSON.parse(JSON.stringify(found.post)),
      id: uid('proj'),
      createdAt: Date.now(),
    };
    return copy;
  } catch {
    return null;
  }
}
