/**
 * Freemium contract — the authoritative plan matrix, enforced server-side.
 * The mobile/web clients may mirror it for UI copy but MUST NOT trust it.
 */
export type Plan = 'free' | 'pro' | 'team';

export interface PlanLimits {
  /** max connected channels (pro/team extend via per-channel passes) */
  channels: number;
  /** max scheduled posts per channel; -1 = unlimited (fair-use daily cap applies) */
  scheduledPerChannel: number;
  /** fair-use publishes per day when scheduledPerChannel is unlimited */
  fairUsePerDay: number;
  /** post history retention, days; -1 = unlimited */
  historyDays: number;
  /** analytics window, days */
  analyticsDays: number;
  /** AI generations per month */
  aiMonthly: number;
  /** free-plan "made with Sosial" badge forced on */
  watermarkForced: boolean;
  /** team seats; 0 = solo */
  seats: number;
  /** fair-use seat cap for team */
  seatFairUse: number;
  /** approval workflow available */
  approvals: boolean;
  /** media storage quota, bytes */
  storageBytes: number;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const LIMITS: Record<Plan, PlanLimits> = {
  free: {
    channels: 2,
    scheduledPerChannel: 10,
    fairUsePerDay: 10,
    historyDays: 30,
    analyticsDays: 7,
    aiMonthly: 0,
    watermarkForced: true,
    seats: 0,
    seatFairUse: 0,
    approvals: false,
    storageBytes: 250 * MB,
  },
  pro: {
    channels: 0, // extended by purchased channel passes
    scheduledPerChannel: -1,
    fairUsePerDay: 100,
    historyDays: -1,
    analyticsDays: 365,
    aiMonthly: 500,
    watermarkForced: false,
    seats: 0,
    seatFairUse: 0,
    approvals: false,
    storageBytes: 5 * GB,
  },
  team: {
    channels: 0, // extended by purchased channel passes
    scheduledPerChannel: -1,
    fairUsePerDay: 100,
    historyDays: -1,
    analyticsDays: 365,
    aiMonthly: 1000,
    watermarkForced: false,
    seats: -1, // unlimited within fair use
    seatFairUse: 25,
    approvals: true,
    storageBytes: 25 * GB,
  },
};

export function limitsFor(plan: Plan): PlanLimits {
  return LIMITS[plan] ?? LIMITS.free;
}

/** Effective channel cap = base plan cap + purchased passes for this plan. */
export function channelCap(plan: Plan, purchasedPasses: number): number {
  if (plan === 'free') return LIMITS.free.channels;
  return Math.max(0, purchasedPasses);
}

export function canConnectChannel(plan: Plan, connected: number, purchasedPasses: number): boolean {
  return connected < channelCap(plan, purchasedPasses);
}

export function withinScheduleCap(plan: Plan, scheduledCount: number): boolean {
  const lim = limitsFor(plan).scheduledPerChannel;
  return lim < 0 || scheduledCount < lim;
}

export function withinAiQuota(plan: Plan, usedThisMonth: number): boolean {
  return usedThisMonth < limitsFor(plan).aiMonthly;
}

export function withinStorage(plan: Plan, bytesUsed: number): boolean {
  return bytesUsed < limitsFor(plan).storageBytes;
}
