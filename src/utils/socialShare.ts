import { Alert, Linking, Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

/**
 * No-API sharing strategy (as requested):
 * We CANNOT silently push images into someone else's Facebook/IG composer —
 * those apps don't accept it. Instead we:
 *  1. Save PNGs / hand the image file to the OS share sheet (which lists FB, IG, TikTok…)
 *  2. Copy title+caption to clipboard so user can paste
 *  3. Deep-link-open the target app at its composer when a scheme is known
 */

export async function copyCaption(title: string, caption: string) {
  const text = [title, caption].filter(Boolean).join('\n\n');
  if (!text) return;
  await Clipboard.setStringAsync(text);
}

export async function genericShare(title: string, caption: string) {
  const message = [title, caption].filter(Boolean).join('\n\n');
  try {
    await Share.share({ message });
  } catch (e: any) {
    Alert.alert('Share failed', e?.message ?? 'Could not open share sheet.');
  }
}

const TARGETS: Record<string, { app: string; web: string; label: string }> = {
  facebook: { app: 'fb://feed', web: 'https://www.facebook.com/', label: 'Facebook' },
  instagram: { app: 'instagram://library', web: 'https://www.instagram.com/', label: 'Instagram' },
  tiktok: { app: 'musically://', web: 'https://www.tiktok.com/upload', label: 'TikTok' },
  x: { app: 'twitter://post', web: 'https://twitter.com/intent/tweet?text=', label: 'X' },
  threads: { app: 'barcelona://', web: 'https://www.threads.com/', label: 'Threads' },
  whatsapp: { app: 'whatsapp://send?text=', web: 'https://wa.me/?text=', label: 'WhatsApp' },
  youtube: { app: 'vnd.youtube://', web: 'https://www.youtube.com/', label: 'YouTube' },
};

export async function openSocialApp(platform: string, title: string, caption: string) {
  const t = TARGETS[platform];
  if (!t) return genericShare(title, caption);
  const text = [title, caption].filter(Boolean).join('\n\n');
  await copyCaption(title, caption);
  Alert.alert(
    `Opening ${t.label}`,
    'Your images are saved / shared via the system sheet, and your title + caption was copied. Paste it in the app composer, then attach the images.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: `Open ${t.label}`,
        onPress: async () => {
          // For X / WhatsApp we can prefill text via URL
          let url = t.app;
          if (platform === 'x') url = text ? `twitter://post?message=${encodeURIComponent(text)}` : t.app;
          if (platform === 'whatsapp') url = `whatsapp://send?text=${encodeURIComponent(text)}`;
          try {
            const can = await Linking.canOpenURL(url);
            if (can) return Linking.openURL(url);
            // fallback: web sharer
            if (platform === 'x') return Linking.openURL(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`);
            if (platform === 'whatsapp') return Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`);
            if (platform === 'facebook') return Linking.openURL('https://www.facebook.com/sharer/sharer.php?u=');
            return Linking.openURL(t.web);
          } catch {
            Linking.openURL(t.web);
          }
        },
      },
    ]
  );
}
