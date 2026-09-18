import * as FileSystem from 'expo-file-system/legacy';
import { PIN_API, PIN_MAX_BYTES, PIN_MAX_DESC, PIN_MAX_IMAGES, PIN_MAX_TITLE, PIN_MAX_VIDEO_BYTES } from './pinConfig';
import { getValidPin } from './pinAuth';
import { loadMetaState } from './metaStore';

function perr(j: any, status: number, fallback: string): string {
  const m =
    j?.error_description ||
    (typeof j?.error === 'string' ? j.error : j?.error?.message) ||
    j?.message;
  const base = typeof m === 'string' && m.length > 0 ? m : fallback;
  if (status === 401) return 'Pinterest session expired — reconnect Pinterest.';
  if (status === 403) return `${base} — the app may lack a scope or production access; check developers.pinterest.com.`;
  if (status === 429) return 'Pinterest rate limit hit — wait a few minutes and retry.';
  return `${base} (${status})`;
}

export interface PinBoard {
  id: string;
  name: string;
}

/** Boards the account owns — the user picks one as the default Pin target. */
export async function listPinBoards(): Promise<PinBoard[]> {
  const { token } = await getValidPin();
  const out: PinBoard[] = [];
  let bookmark: string | undefined;
  for (let page = 0; page < 4; page++) {
    const qs = `page_size=50${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`;
    const r = await fetch(`${PIN_API}/boards?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray(j?.items)) {
      throw new Error(perr(j, r.status, 'Could not read your Pinterest boards.'));
    }
    for (const b of j.items) {
      if (b?.id) out.push({ id: String(b.id), name: String(b.name ?? 'Untitled board') });
    }
    bookmark = typeof j.bookmark === 'string' && j.bookmark ? j.bookmark : undefined;
    if (!bookmark) break;
  }
  return out;
}

function contentTypeFor(uri: string): string {
  const u = uri.toLowerCase().split('?')[0];
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function fit(s: string, max: number): string {
  const t = (s ?? '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

async function createImagePin(boardId: string, token: string, title: string, description: string, uri: string): Promise<string> {
  const info: any = await FileSystem.getInfoAsync(uri).catch(() => null);
  if (info?.size && info.size > PIN_MAX_BYTES) {
    throw new Error('That photo is over 10 MB — shrink it and try again.');
  }
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const r = await fetch(`${PIN_API}/pins`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      board_id: boardId,
      title: fit(title, PIN_MAX_TITLE),
      description: fit(description, PIN_MAX_DESC),
      media_source: {
        source_type: 'image_base64',
        content_type: contentTypeFor(uri),
        data: b64,
      },
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j?.id) throw new Error(perr(j, r.status, 'Pinterest Pin failed.'));
  return String(j.id);
}

/**
 * Create one Pin per image on the user's default board. Pinterest has no
 * multi-photo post — each image becomes its own Pin with the same caption.
 * A video gets its own video Pin (register → PUT bytes → poll → create).
 * Returns the created Pin ids.
 */
export async function publishPinterest(opts: {
  text: string;
  imageUris?: string[];
  videoUri?: string;
}): Promise<string[]> {
  const m = await loadMetaState();
  if (!m.pinAccessToken) throw new Error('Pinterest not connected');
  if (!m.pinBoardId) throw new Error('Pick a Pinterest board in Connect first.');
  const images = (opts.imageUris ?? []).filter(Boolean).slice(0, PIN_MAX_IMAGES);
  if (images.length === 0 && !opts.videoUri) {
    throw new Error('Pinterest Pins need a photo or video — attach media first.');
  }
  const { token } = await getValidPin();
  const firstLine = (opts.text ?? '').trim().split('\n')[0];
  const ids: string[] = [];
  if (opts.videoUri) {
    try {
      ids.push(await createVideoPin(m.pinBoardId, token, firstLine || 'Sosial video', opts.text ?? '', opts.videoUri));
    } catch (e: any) {
      throw new Error(`Video: ${e?.message ?? 'upload failed'}`);
    }
  }
  for (let i = 0; i < images.length; i++) {
    const title = images.length > 1 && firstLine
      ? `${firstLine} (${i + 1}/${images.length})`
      : firstLine || 'Sosial Pin';
    try {
      ids.push(await createImagePin(m.pinBoardId, token, title, opts.text ?? '', images[i]));
    } catch (e: any) {
      throw new Error(`Photo ${i + 1}/${images.length}: ${e?.message ?? 'upload failed'}`);
    }
  }
  return ids;
}

/* ---------------- Pin analytics (/v5/pins/{id}/analytics) ---------------- */

export interface PinEngagement {
  /** IMPRESSION — the closest Pinterest has to views */
  impressions: number;
  /** SAVE — the closest Pinterest has to likes */
  saves: number;
  /** PIN_CLICK + OUTBOUND_CLICK */
  clicks: number;
}

function ymd(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Pinterest allows at most a 90-day window ending today. */
function clampWindow(start: number, end: number): { startDate: string; endDate: string } {
  const now = Date.now();
  const s = Math.max(start, now - 90 * 86400000);
  const e = Math.max(Math.min(end, now), s);
  return { startDate: ymd(s), endDate: ymd(e) };
}

/** Shape-tolerant metric sum — walks daily_metrics when present, else the body. */
function sumMetric(scope: any, names: string[]): number {
  let total = 0;
  const walk = (v: any, key?: string): void => {
    if (typeof v === 'number' && key && names.includes(key)) {
      if (isFinite(v) && v > 0) total += v;
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x) => walk(x));
      return;
    }
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) walk(v[k], k);
    }
  };
  walk(scope);
  return total;
}

/**
 * Engagement for one Pin. Throws on HTTP errors (callers degrade to zeros +
 * an honest note) — analytics 403s on apps without production access.
 */
export async function pinAnalytics(token: string, pinId: string, start: number, end: number): Promise<PinEngagement> {
  const { startDate, endDate } = clampWindow(start, end);
  const r = await fetch(
    `${PIN_API}/pins/${encodeURIComponent(pinId)}/analytics?start_date=${startDate}&end_date=${endDate}&metric_types=IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(perr(j, r.status, 'Pinterest analytics failed.'));
  const scope = Array.isArray(j?.daily_metrics) ? j.daily_metrics : j;
  return {
    impressions: sumMetric(scope, ['IMPRESSION']),
    saves: sumMetric(scope, ['SAVE']),
    clicks: sumMetric(scope, ['PIN_CLICK', 'OUTBOUND_CLICK']),
  };
}

/* ---------------- Video Pins (/v5/media flow) ---------------- */

function videoMime(uri: string): string {
  const u = uri.toLowerCase().split('?')[0];
  if (u.endsWith('.mov')) return 'video/quicktime';
  if (u.endsWith('.m4v')) return 'video/x-m4v';
  return 'video/mp4';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * S3-style PUT must go through XMLHttpRequest — expo/fetch (SDK 57) can't
 * serialize React Native {uri,name,type} FormData parts. No auth header here:
 * the signed upload URL is the auth.
 */
function xhrPutForm(uploadUrl: string, params: Record<string, string>, uri: string, mime: string, timeoutMs = 300000): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) form.append(k, v);
    form.append('file', { uri, name: `video.${mime === 'video/quicktime' ? 'mov' : 'mp4'}`, type: mime } as any);
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.timeout = timeoutMs;
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        return reject(new Error(`Video bytes rejected (${xhr.status}).`));
      }
      resolve();
    };
    xhr.onerror = () => reject(new Error('Network request failed — check your connection.'));
    xhr.ontimeout = () => reject(new Error('Video upload timed out — try a shorter video or stronger connection.'));
    xhr.send(form as any);
  });
}

async function createVideoPin(boardId: string, token: string, title: string, description: string, uri: string): Promise<string> {
  const info: any = await FileSystem.getInfoAsync(uri).catch(() => null);
  if (info?.size && info.size > PIN_MAX_VIDEO_BYTES) {
    throw new Error('That video is over 200 MB — shrink it and try again.');
  }
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  // 1. register the upload
  const reg: any = await (
    await fetch(`${PIN_API}/media`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ media_type: 'video' }),
    })
  ).json().catch(() => ({}));
  const mediaId = String(reg?.media_id ?? '');
  const uploadUrl = String(reg?.upload_url ?? '');
  const params = (reg?.upload_parameters ?? {}) as Record<string, string>;
  if (!mediaId || !uploadUrl) {
    throw new Error(perr(reg, 0, 'Pinterest would not start a video upload.'));
  }
  // 2. PUT the bytes
  await xhrPutForm(uploadUrl, params, uri, videoMime(uri));
  // 3. wait for Pinterest to finish processing
  const start = Date.now();
  let delay = 5000;
  for (;;) {
    const st: any = await (
      await fetch(`${PIN_API}/media/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json().catch(() => ({}));
    const status = String(st?.status ?? '').toLowerCase();
    if (status === 'succeeded') break;
    if (status === 'failed') throw new Error('Pinterest could not process that video — try MP4 under 15 minutes.');
    if (Date.now() - start > 180000) {
      throw new Error('Pinterest is still processing the video — wait a minute, then check your board (the Pin may still land).');
    }
    await sleep(delay);
    delay = Math.min(delay + 2000, 10000);
  }
  // 4. create the Pin from the finished media
  const r = await fetch(`${PIN_API}/pins`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      board_id: boardId,
      title: fit(title, PIN_MAX_TITLE),
      description: fit(description, PIN_MAX_DESC),
      media_source: { source_type: 'video_id', media_id: mediaId },
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j?.id) throw new Error(perr(j, r.status, 'Pinterest video Pin failed.'));
  return String(j.id);
}
