import { Alert } from 'react-native';
import { TT_API } from './tiktokConfig';
import { TT_PRIVACY_LABELS } from './tiktokConfig';
import { getValidToken, fetchCreatorInfo } from './tiktokAuth';

const CHUNK = 8 * 1024 * 1024; // 8MB parts — bounded memory, no giant buffers
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function friendly(code: string, fallback: string): string {
  switch (code) {
    case 'unaudited_client_can_only_post_to_private_accounts':
      return 'TikTok app isn’t audited yet — it can only post privately. Pick “Only me”, or finish the TikTok app review for public posting.';
    case 'privacy_level_option_mismatch':
      return 'That privacy setting isn’t allowed for this account — pick another.';
    case 'spam_risk_too_many_posts':
      return 'TikTok daily post limit reached — try again tomorrow.';
    case 'spam_risk_user_banned_from_posting':
      return 'TikTok blocked this account from posting.';
    case 'reached_active_user_cap':
      return 'TikTok daily publishing quota for this app is reached — try tomorrow.';
    case 'scope_not_authorized':
      return 'TikTok is missing the video.publish permission — disconnect and reconnect TikTok.';
    case 'access_token_invalid':
      return 'TikTok session expired — reconnect TikTok.';
    default:
      return fallback;
  }
}

function ok(j: any): boolean {
  return j?.error?.code === 'ok';
}

/** Ask the user which of THEIR privacy options to publish with. Resolves one option. */
export async function askTikTokPrivacy(): Promise<string> {
  const token = await getValidToken();
  const ci = await fetchCreatorInfo(token);
  const options = ci.privacyOptions.length > 0 ? ci.privacyOptions : ['SELF_ONLY'];
  if (options.length === 1) return options[0];
  return new Promise((resolve, reject) => {
    Alert.alert(
      'Who can see it on TikTok?',
      'TikTok only accepts your own privacy options — pick one.',
      [
        ...options.map((o) => ({
          text: TT_PRIVACY_LABELS[o] ?? o,
          onPress: () => resolve(o),
        })),
        { text: 'Cancel', style: 'cancel' as const, onPress: () => reject(new Error('Login was cancelled.')) },
      ],
    );
  });
}

function contentTypeFor(uri: string): string {
  const u = uri.split('?')[0].toLowerCase();
  if (u.endsWith('.mov')) return 'video/quicktime';
  if (u.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

/**
 * Direct Post a video: init -> chunked PUTs -> poll until published.
 * Throws human-readable messages (audit gate, privacy mismatch, daily caps).
 */
export async function publishTikTokVideo(opts: {
  title: string;
  privacyLevel: string;
  videoUri: string;
}): Promise<string> {
  const token = await getValidToken();

  // RN fetch() can read file:// URIs — one Blob, sliced per chunk, never
  // the whole file decoded in JS memory.
  const fileResp = await fetch(opts.videoUri);
  const blob: any = await fileResp.blob().catch(() => null);
  const size: number = blob?.size ?? 0;
  if (!size) throw new Error('Could not read the video file — re-attach it and try again.');
  const totalChunks = Math.max(1, Math.ceil(size / CHUNK));
  const chunkSize = Math.min(CHUNK, size);

  const initR = await fetch(`${TT_API}/v2/post/publish/video/init/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info: {
        title: opts.title.slice(0, 150),
        privacy_level: opts.privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: size,
        chunk_size: chunkSize,
        total_chunk_count: totalChunks,
      },
    }),
  });
  const initJ: any = await initR.json().catch(() => ({}));
  const publishId: string | undefined = initJ?.data?.publish_id;
  const uploadUrl: string | undefined = initJ?.data?.upload_url;
  if (!ok(initJ) || !publishId || !uploadUrl) {
    throw new Error(friendly(initJ?.error?.code, 'TikTok upload init failed.'));
  }

  const ctype = contentTypeFor(opts.videoUri);
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(size, start + chunkSize);
    const part = blob.slice(start, end);
    const putR = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': ctype,
        'Content-Length': String(end - start),
        'Content-Range': `bytes ${start}-${end - 1}/${size}`,
      },
      body: part,
    });
    // TikTok answers chunk PUTs with 200/201/206 and usually an empty body
    if (putR.status !== 200 && putR.status !== 201 && putR.status !== 206) {
      throw new Error(`TikTok upload stalled on part ${i + 1}/${totalChunks} — try again.`);
    }
  }

  // processing is async — poll until terminal
  for (let i = 0; i < 15; i++) {
    await sleep(10000);
    const sR = await fetch(`${TT_API}/v2/post/publish/status/fetch/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const sJ: any = await sR.json().catch(() => ({}));
    const status = String(sJ?.data?.status ?? '');
    if (status === 'PUBLISH_COMPLETE') return publishId;
    if (status === 'FAILED') {
      throw new Error(friendly(sJ?.error?.code, 'TikTok failed to process the video.'));
    }
  }
  throw new Error('TikTok is still processing — check your TikTok app in a few minutes.');
}
