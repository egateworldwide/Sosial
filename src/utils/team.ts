import AsyncStorage from '@react-native-async-storage/async-storage';
import { SOCIAL_META, uid } from '../constants';

export type TeamRole = 'owner' | 'admin' | 'member';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  /** channel ids the member may post to, or ['all'] for every channel */
  channels: string[];
  createdAt: number;
}

/** Who is acting in the Team screen. Owner is the device holder (account email). */
export interface Actor {
  id: string | null;
  role: TeamRole;
}

const KEY = 'zap_team_v1';

/** Local roster for now — invites/sync need the backend; roles are enforced once sync lands. */
export async function loadTeam(): Promise<TeamMember[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list: TeamMember[] = raw ? JSON.parse(raw) : [];
    return list.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

async function persist(list: TeamMember[]): Promise<TeamMember[]> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  return list;
}

export async function addTeamMember(m: { name: string; email: string; channels: string[] }): Promise<TeamMember[]> {
  const list = await loadTeam();
  const rec: TeamMember = {
    id: uid('member'),
    name: m.name.trim() || 'Teammate',
    email: m.email.trim(),
    role: 'member',
    channels: m.channels.length ? m.channels : ['all'],
    createdAt: Date.now(),
  };
  list.push(rec);
  return persist(list);
}

export async function updateMember(id: string, patch: Partial<Pick<TeamMember, 'name' | 'email' | 'role' | 'channels'>>): Promise<TeamMember[]> {
  const list = await loadTeam();
  return persist(list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
}

export async function removeTeamMember(id: string): Promise<TeamMember[]> {
  const list = await loadTeam();
  return persist(list.filter((x) => x.id !== id));
}

/* ---------------- permissions (mirrored by the backend later) ---------------- */

/** Owner removes anyone; admin removes members only (never self, never admins). */
export function canRemoveMember(actor: Actor, target: TeamMember): boolean {
  if (actor.role === 'owner') return target.role !== 'owner';
  if (actor.role === 'admin') return target.role === 'member' && target.id !== actor.id;
  return false;
}

/** Owner assigns anyone; admin assigns members only. */
export function canAssignChannels(actor: Actor, target: TeamMember): boolean {
  if (actor.role === 'owner') return true;
  if (actor.role === 'admin') return target.role === 'member' && target.id !== actor.id;
  return false;
}

/** Only the owner moves people between admin and member (never creates owners). */
export function canChangeRole(actor: Actor, target: TeamMember, next: 'admin' | 'member'): boolean {
  if (actor.role !== 'owner') return false;
  return target.role !== 'owner' && target.role !== next;
}

/** 'All channels' or 'Facebook +2' style label. */
export function memberChannelsLabel(ids: string[]): string {
  if (ids.includes('all')) return 'All channels';
  const names = ids.map((k) => SOCIAL_META[k]?.label ?? k);
  if (names.length === 0) return 'No channels';
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

/** Assignable channels, connected ones first. */
export function assignableChannels(meta: { pageName?: string; igName?: string; threadsName?: string }): { id: string; label: string; sub: string }[] {
  return [
    { id: 'facebook', label: 'Facebook', sub: meta.pageName ?? 'Not connected' },
    { id: 'instagram', label: 'Instagram', sub: meta.igName ?? 'Not connected' },
    { id: 'threads', label: 'Threads', sub: meta.threadsName ?? 'Not connected' },
  ];
}
