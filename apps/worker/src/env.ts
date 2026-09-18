/** Minimal env access — no @types/node on purpose (dependency-free worker). */
declare const process: any;

export function env(key: string, fallback = ''): string {
  try {
    const v = process?.env?.[key];
    return typeof v === 'string' && v.length > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function required(key: string): string {
  const v = env(key);
  if (!v) throw new Error(`Missing required env ${key} — see apps/worker/.env.example.`);
  return v;
}
