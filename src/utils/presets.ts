import AsyncStorage from '@react-native-async-storage/async-storage';
import { BackgroundStyle, QuickPost } from '../types';
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
