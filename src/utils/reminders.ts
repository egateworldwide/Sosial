import { SOCIAL_META } from '../constants';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// expo-notifications is NEVER statically imported: since SDK 53 the module
// throws at load time inside Android Expo Go (push removed there), which
// kills the whole bundle before first paint. Lazy import keeps Go alive —
// reminders just report unsupported — while the standalone APK works fully.
let _mod: any = null;
let _tried = false;
let _support: boolean | null = null;

async function N(): Promise<any | null> {
  if (_mod) return _mod;
  if (_tried) return null;
  _tried = true;
  // Android Expo Go removed the module (SDK 53+) — don't even attempt the
  // import: even a caught attempt surfaces a LogBox. Everything else loads it.
  if (Constants.appOwnership === 'expo' && Platform.OS === 'android') return null;
  try {
    _mod = await import('expo-notifications');
    try {
      _mod.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
    } catch {}
    return _mod;
  } catch {
    return null;
  }
}

export async function notificationsSupported(): Promise<boolean> {
  if (_support !== null) return _support;
  _support = (await N()) !== null;
  return _support;
}

export async function ensureNotifPermission(): Promise<boolean> {
  try {
    const NN = await N();
    if (!NN) return false;
    const cur = await NN.getPermissionsAsync();
    if (cur.granted) return true;
    const req = await NN.requestPermissionsAsync();
    return !!req.granted;
  } catch {
    return false;
  }
}

export function platformsLabel(keys: string[]): string {
  if (keys.length === 0 || keys.includes('any')) return 'Anywhere';
  const names = keys.map((k) => SOCIAL_META[k]?.label ?? k);
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

export function fmtDateTime(ts: number): string {
  try {
    const d = new Date(ts);
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${date} · ${time}`;
  } catch {
    return '';
  }
}

export const postNotifId = (id: string) => `post_${id}`;

export async function schedulePostReminder(opts: {
  id: string;
  title: string;
  platforms?: string[];
  at: number;
}): Promise<boolean> {
  try {
    const NN = await N();
    if (!NN) return false;
    await NN.scheduleNotificationAsync({
      identifier: postNotifId(opts.id),
      content: {
        title: 'Time to post 📣',
        body: `${opts.title} · ${platformsLabel(opts.platforms ?? ['any'])}`,
        data: { managedPostId: opts.id },
      },
      trigger: { type: NN.SchedulableTriggerInputTypes.DATE, date: new Date(opts.at) },
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelPostReminder(id: string): Promise<void> {
  await cancelNotification(postNotifId(id));
}

export async function cancelNotification(identifier: string): Promise<void> {
  try {
    const NN = await N();
    if (!NN) return;
    await NN.cancelScheduledNotificationAsync(identifier);
  } catch {}
}

export const NO_NOTIF_MSG = 'Android Expo Go removed notifications (SDK 53+) — reminders fire in the installed app and on iPhone.';
