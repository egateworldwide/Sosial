import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { uid } from '../constants';

/** Local-only account (no backend): email + team live on-device. */
export interface Account {
  email: string;
  team: string;
  notifPosts: boolean;
  notifComments: boolean;
  notifWeekly: boolean;
}

const KEY = 'zap_account_v1';

export const DEFAULT_ACCOUNT: Account = {
  email: '',
  team: 'My team',
  notifPosts: true,
  notifComments: true,
  notifWeekly: false,
};

export function accountId(): string {
  return `zap_${uid('acct').replace('acct_', '')}`;
}

export async function loadAccount(): Promise<Account> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_ACCOUNT };
    return { ...DEFAULT_ACCOUNT, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_ACCOUNT };
  }
}

export async function saveAccount(patch: Partial<Account>): Promise<Account> {
  const cur = await loadAccount();
  const next = { ...cur, ...patch };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  return next;
}

/** Delete-account: wipe every local store + token vault. */
export async function wipeAllData(): Promise<void> {
  const keys = [
    'quickpost_projects_v1',
    'quickpost_managed_posts_v1',
    'quickpost_text_posts_v1',
    'quickpost_bg_presets_v1',
    'quickpost_project_presets_v1',
    'zap_account_v1',
    'zap_ideas_v1',
    'quickpost_open_post',
    'quickpost_compose',
  ];
  try {
    await AsyncStorage.multiRemove(keys);
  } catch {}
  try {
    await SecureStore.deleteItemAsync('zap_meta_v1');
  } catch {}
}
