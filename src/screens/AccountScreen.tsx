import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Linking, Switch } from 'react-native';
import Ionicons from '@expo/vector-icons/build/Ionicons';
import { useTheme, Palette, R, T } from '../theme';
import { Txt, Field, Stepper, Seg, GhostBtn } from '../components/ui';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { wipeAllData } from '../utils/account';
import { currentSession, signUpEmail, signInEmail, signInWithGoogle, signOutCloud, onCloudAuthChange, isSupabaseConfigured, pullProfileFromCloud, WorkspaceInfo } from '../utils/supabase';

WebBrowser.maybeCompleteAuthSession();
import { loadTeam, addTeamMember, removeTeamMember, updateMember, memberChannelsLabel, assignableChannels, canRemoveMember, canAssignChannels, canChangeRole, loadActor, saveActor, TeamMember, Actor } from '../utils/team';
import { loadMetaState } from '../utils/metaStore';

type AcctView = 'main' | 'notif' | 'email' | 'password' | 'plan' | 'team' | 'changelog' | 'terms' | 'legal';

const CHANGELOG = [
  { v: '1.0.0', notes: ['Buffer-style app: Create, Post and Analytics tabs', 'Ideas feed with design-studio link', 'Queue / drafts / approvals / sent pipeline', 'Per-channel insights, top posts and comments', 'Meta login via secure bridge page'] },
];

/** Account settings: notifications, email, password, plan, legal… (all on-device, no backend). */
export default function AccountScreen({ email, team, plan, notifPosts, notifComments, notifWeekly, onUpdate, onBack, onConnect, onPrivacy, onLoggedOut }: {
  email: string;
  team: string;
  plan: 'free' | 'pro' | 'team';
  notifPosts: boolean;
  notifComments: boolean;
  notifWeekly: boolean;
  onUpdate: (patch: { email?: string; team?: string; plan?: 'free' | 'pro' | 'team'; notifPosts?: boolean; notifComments?: boolean; notifWeekly?: boolean }) => void;
  onBack: () => void;
  onConnect: () => void;
  onPrivacy: () => void;
  onLoggedOut: () => void;
}) {
  const { C } = useTheme();
  const s = makeS(C);
  const [view, setView] = useState<AcctView>('main');
  const [proChannels, setProChannels] = useState(3);
  const [yearly, setYearly] = useState(true);
  const [draftEmail, setDraftEmail] = useState(email);
  const [draftTeam, setDraftTeam] = useState(team);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [mName, setMName] = useState('');
  const [mEmail, setMEmail] = useState('');
  const [mChannels, setMChannels] = useState<string[]>(['all']);
  const [chanList, setChanList] = useState<{ id: string; label: string; sub: string }[]>([]);
  const [actingAs, setActingAs] = useState<string>('owner');
  const [assigningId, setAssigningId] = useState<string | null>(null);

  /* Sosial Cloud (Supabase staging) — real accounts live alongside the legacy
   * on-device profile until the profile/team migration lands. */
  const [sbState, setSbState] = useState<'checking' | 'off' | 'in' | 'unconfigured'>('checking');
  const [sbEmail, setSbEmail] = useState('');
  const [sbPw, setSbPw] = useState('');
  const [sbBusy, setSbBusy] = useState(false);
  const [sbErr, setSbErr] = useState<string | null>(null);
  const [sbNotice, setSbNotice] = useState<string | null>(null);
  const [sbAccount, setSbAccount] = useState<{ email: string; workspace: WorkspaceInfo } | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setSbState('unconfigured');
      return;
    }
    let live = true;
    currentSession()
      .then((s) => {
        if (!live) return;
        setSbAccount(s ? { email: s.user.email ?? '', workspace: s.workspace } : null);
        setSbState(s ? 'in' : 'off');
      })
      .catch(() => {
        if (live) setSbState('off');
      });
    const unsub = onCloudAuthChange((u) => {
      if (!live) return;
      if (!u) {
        setSbAccount(null);
        setSbState('off');
        return;
      }
      currentSession()
        .then((s) => {
          if (!live) return;
          setSbAccount(s ? { email: s.user.email ?? '', workspace: s.workspace } : null);
          setSbState(s ? 'in' : 'off');
        })
        .catch(() => {});
    });
    return () => {
      live = false;
      unsub();
    };
  }, []);

  const doCloudSignIn = async () => {
    if (!sbEmail.trim() || !sbPw) {
      setSbErr('Enter your email and password.');
      return;
    }
    setSbBusy(true);
    setSbErr(null);
    setSbNotice(null);
    try {
      const ws = await signInEmail(sbEmail, sbPw);
      setSbAccount({ email: sbEmail.trim(), workspace: ws });
      setSbState('in');
      setSbPw('');
      void syncDownProfile();
    } catch (e: any) {
      setSbErr(e?.message ?? 'Sign-in failed.');
    } finally {
      setSbBusy(false);
    }
  };

  /** Cloud wins after login: restores identity/notifs/team on this device. */
  const syncDownProfile = async () => {
    try {
      const prof = await pullProfileFromCloud();
      if (prof) {
        onUpdate({
          email: prof.email,
          team: prof.team,
          notifPosts: prof.notifPosts,
          notifComments: prof.notifComments,
          notifWeekly: prof.notifWeekly,
        });
      }
    } catch {}
  };

  const doCloudSignUp = async () => {
    if (!sbEmail.trim() || sbPw.length < 6) {
      setSbErr('Enter an email and a password (min 6 characters).');
      return;
    }
    setSbBusy(true);
    setSbErr(null);
    setSbNotice(null);
    try {
      const r = await signUpEmail(sbEmail, sbPw);
      if (r.needsConfirm) {
        setSbNotice('Account created — check your inbox for the confirmation link, then sign in.');
      } else {
        const s = await currentSession();
        setSbAccount(s ? { email: s.user.email ?? '', workspace: s.workspace } : null);
        setSbState(s ? 'in' : 'off');
        void syncDownProfile();
      }
      setSbPw('');
    } catch (e: any) {
      setSbErr(e?.message ?? 'Sign-up failed.');
    } finally {
      setSbBusy(false);
    }
  };

  const doCloudGoogle = async () => {
    // Google Web clients only accept https redirects and Expo Go can only
    // receive exp:// — the combination can never complete. Dev builds use the
    // sosial:// scheme and work with the same code path.
    if (Constants.appOwnership === 'expo') {
      Alert.alert(
        'Needs a development build',
        'Google sign-in can’t return to Expo Go. Use email + password here — Google lights up automatically in dev builds.',
      );
      return;
    }
    setSbBusy(true);
    setSbErr(null);
    setSbNotice(null);
    try {
        const ws = await signInWithGoogle();
        const s = await currentSession();
        setSbAccount({ email: s?.user.email ?? '', workspace: ws });
        setSbState('in');
        setSbPw('');
        void syncDownProfile();
    } catch (e: any) {
      setSbErr(e?.message ?? 'Google sign-in failed.');
    } finally {
      setSbBusy(false);
    }
  };

  const doCloudSignOut = () => {
    Alert.alert('Sign out of Sosial Cloud?', 'Your designs stay on this device; the cloud workspace stays intact.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        onPress: async () => {
          await signOutCloud();
          setSbAccount(null);
          setSbPw('');
          setSbState('off');
        },
      },
    ]);
  };

  const actor: Actor = actingAs === 'owner'
    ? { id: null, role: 'owner' }
    : (() => {
        const m = members.find((x) => x.id === actingAs);
        return m ? { id: m.id, role: m.role } : { id: null, role: 'owner' as const };
      })();

  useEffect(() => {
    loadTeam().then(setMembers);
    if (view === 'team') {
      loadMetaState().then((m) => setChanList(assignableChannels(m)));
    }
  }, [view]);

  useEffect(() => {
    loadActor().then((a) => setActingAs(a.id ?? 'owner'));
  }, []);

  const changeActor = (id: string | null) => {
    setActingAs(id ?? 'owner');
    setAssigningId(null);
    void saveActor(id);
  };

  const planName = plan === 'pro' ? 'Sosial Pro' : plan === 'team' ? 'Sosial Team' : 'Free plan';

  const initial = (email || team || 'Z')[0].toUpperCase();
  const title = view === 'main' ? 'Account' : (
    view === 'notif' ? 'Notifications' : view === 'email' ? 'Email settings' :
    view === 'password' ? 'Change password' : view === 'plan' ? 'Subscription' : view === 'team' ? 'Team' :
    view === 'changelog' ? "What's new" : view === 'terms' ? 'Terms of use' : 'Legal'
  );

  const row = (icon: string, label: string, sub: string | undefined, onPress: () => void, danger?: boolean) => (
    <TouchableOpacity onPress={onPress} style={s.row} activeOpacity={0.7}>
      <Ionicons name={icon as any} size={20} color={danger ? C.redText : C.ink} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={[s.rowT, danger && { color: C.redText }]}>{label}</Text>
        {sub ? <Text style={s.rowS} numberOfLines={1}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.faint} />
    </TouchableOpacity>
  );

  const toggleRow = (label: string, sub: string, value: boolean, onFlip: () => void) => (
    <View style={s.row}>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={s.rowT}>{label}</Text>
        <Text style={s.rowS}>{sub}</Text>
      </View>
      <Switch value={value} onValueChange={onFlip} trackColor={{ true: C.accent, false: '#D8D1BF' }} thumbColor="#ffffff" />
    </View>
  );

  const logout = () => {
    Alert.alert('Logout', 'Sign out on this device? Your designs and posts stay saved.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', onPress: () => { onUpdate({ email: '' }); onLoggedOut(); } },
    ]);
  };

  const deleteAccount = () => {
    Alert.alert('Delete Sosial account?', 'This wipes everything on this device: designs, templates, ideas, posts, channels and settings. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete everything', style: 'destructive',
        onPress: () => Alert.alert('Last chance', 'Really delete all Sosial data?', [
          { text: 'Keep it', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: async () => { await wipeAllData(); onLoggedOut(); } },
        ]),
      },
    ]);
  };

  const rateApp = () => {
    Linking.openURL('https://play.google.com/store/apps/details?id=com.sosial.app').catch(() => {
      Alert.alert('Rate Sosial', 'Sosial isn’t on the Play Store yet — this link will work after release.');
    });
  };

  const toggleMChannel = (id: string) => {
    setMChannels((prev) => {
      if (id === 'all') return ['all'];
      const without = prev.filter((x) => x !== 'all' && x !== id);
      if (prev.includes(id)) return without.length ? without : ['all'];
      return [...without, id];
    });
  };

  const saveMember = async () => {
    if (!mEmail.trim()) {
      Alert.alert('Email needed', 'Add the teammate’s email so invites reach them.');
      return;
    }
    setMembers(await addTeamMember({ name: mName, email: mEmail, channels: mChannels }));
    setMName('');
    setMEmail('');
    setMChannels(['all']);
  };

  const dropMember = (m: TeamMember) => {
    Alert.alert('Remove teammate', `Remove ${m.name} from the team?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        setMembers(await removeTeamMember(m.id));
        resetActingIfGone(m.id);
      } },
    ]);
  };

  const resetActingIfGone = (id: string) => {
    if (actingAs === id) changeActor(null);
    if (assigningId === id) setAssigningId(null);
  };

  const leaveTeam = (m: TeamMember) => {
    Alert.alert('Leave team?', 'You’ll lose access to these channels on this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        setMembers(await removeTeamMember(m.id));
        resetActingIfGone(m.id);
      } },
    ]);
  };

  const stepDown = (m: TeamMember) => {
    Alert.alert('Step down?', `${m.name} will become a regular member.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Step down', onPress: async () => setMembers(await updateMember(m.id, { role: 'member' })) },
    ]);
  };

  const flipRole = async (m: TeamMember) => {
    const next = m.role === 'admin' ? 'member' : 'admin';
    setMembers(await updateMember(m.id, { role: next }));
  };

  const toggleMemberChannel = async (m: TeamMember, id: string) => {
    let next: string[];
    if (id === 'all') next = ['all'];
    else {
      const without = m.channels.filter((x) => x !== 'all' && x !== id);
      next = m.channels.includes(id) ? (without.length ? without : ['all']) : [...without, id];
    }
    setMembers(await updateMember(m.id, { channels: next }));
  };

  const proTotal = yearly ? `$${49 * proChannels}/yr` : `$${(4.99 * proChannels).toFixed(2)}/mo`;
  const teamTotal = yearly ? `$${99 * proChannels}/yr` : `$${(9.99 * proChannels).toFixed(2)}/mo`;

  /** Plan switching works today as a local flag; real Play Billing replaces the confirm. */
  const choosePlan = (target: 'free' | 'pro' | 'team', label: string) => {
    if (plan === target) return;
    Alert.alert(`Switch to ${label}?`, target === 'free'
      ? 'You’ll lose paid features on this device.'
      : 'Billing is stubbed in this build — this flips the local plan flag only. Real Play Billing activates at launch.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => onUpdate({ plan: target }) },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bone }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => (view === 'main' ? onBack() : setView('main'))} activeOpacity={0.7} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color={C.ink} />
        </TouchableOpacity>
        <Text style={[T.h1, { color: C.ink, marginTop: 16, fontSize: 30, lineHeight: 36 }]}>{title}</Text>

        {view === 'main' ? (
          <>
            <View style={s.head}>
              <View style={s.avatar}><Text style={s.avatarT}>{initial}</Text></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.email} numberOfLines={1}>{email || 'No email set'}</Text>
                <Text style={s.team} numberOfLines={1}>{team}</Text>
              </View>
            </View>
            <View style={s.list}>
              <View style={{ padding: 14, gap: 8 }}>
                <Text style={s.rowT}>Sosial Cloud (staging)</Text>
                {sbState === 'checking' ? <Text style={s.rowS}>Checking cloud account…</Text> : null}
                {sbState === 'unconfigured' ? (
                  <Text style={s.rowS}>Backend not configured — add the Supabase keys to .env and restart Expo.</Text>
                ) : null}
                {sbState === 'off' ? (
                  <>
                    <Txt
                      value={sbEmail}
                      onChangeText={(v) => { setSbEmail(v); setSbErr(null); }}
                      placeholder="Email"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                    />
                    <Txt
                      value={sbPw}
                      onChangeText={(v) => { setSbPw(v); setSbErr(null); }}
                      placeholder="Password (min 6 chars)"
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {sbErr ? <Text style={{ color: C.redText }}>{sbErr}</Text> : null}
                    {sbNotice ? <Text style={s.rowS}>{sbNotice}</Text> : null}
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <GhostBtn label={sbBusy ? '…' : 'Sign in'} onPress={() => { if (!sbBusy) void doCloudSignIn(); }} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <GhostBtn label={sbBusy ? '…' : 'Create account'} onPress={() => { if (!sbBusy) void doCloudSignUp(); }} />
                      </View>
                    </View>
                    <GhostBtn label={sbBusy ? '…' : 'Continue with Google'} onPress={() => { if (!sbBusy) void doCloudGoogle(); }} />
                    <Text style={s.rowS}>One account per email. Your workspace syncs across devices.</Text>
                  </>
                ) : null}
                {sbState === 'in' && sbAccount ? (
                  <>
                    <Text style={s.rowS} numberOfLines={1}>
                      {sbAccount.email} · {sbAccount.workspace.name} ({sbAccount.workspace.role})
                    </Text>
                    <GhostBtn label="Sign out" onPress={doCloudSignOut} />
                  </>
                ) : null}
              </View>
            </View>
            <View style={s.list}>
              {row('notifications-outline', 'Notification settings', 'Post reminders, comments, digest', () => setView('notif'))}
              {row('mail-outline', 'Email settings', email || 'Set your email', () => { setDraftEmail(email); setDraftTeam(team); setView('email'); })}
              {row('key-outline', 'Change password', undefined, () => { setPw1(''); setPw2(''); setView('password'); })}
              {row('log-out-outline', 'Logout', undefined, logout, true)}
            </View>
            <View style={s.list}>
              {row('add-circle-outline', 'Connect new channel', 'Facebook, Instagram, Threads', onConnect)}
              {row('card-outline', 'Subscription plan', planName, () => setView('plan'))}
              {plan === 'team' ? row('people-outline', 'Team', members.length ? `${members.length} teammate${members.length === 1 ? '' : 's'} · invite & roles` : 'Invite people & assign channels', () => setView('team')) : null}
              {row('refresh-outline', 'Restore purchase', undefined, () => Alert.alert('Restore purchase', 'No purchases found on this device.'))}
              {row('star-outline', 'Rate Sosial', 'Review on the Play Store', rateApp)}
              {row('sparkles-outline', "What's new", 'Changelog', () => setView('changelog'))}
            </View>
            <View style={s.list}>
              {row('shield-checkmark-outline', 'Privacy policy', undefined, onPrivacy)}
              {row('document-text-outline', 'Terms of use', undefined, () => setView('terms'))}
              {row('scale-outline', 'Legal', undefined, () => setView('legal'))}
              {row('trash-outline', 'Delete Sosial account', 'Wipe everything on-device', deleteAccount, true)}
            </View>
          </>
        ) : null}

        {view === 'notif' ? (
          <View style={s.list}>
            {toggleRow('Post reminders', 'Alert when a queued post is due', notifPosts, () => onUpdate({ notifPosts: !notifPosts }))}
            {toggleRow('Comments & mentions', 'Alert on new comments (installed app)', notifComments, () => onUpdate({ notifComments: !notifComments }))}
            {toggleRow('Weekly digest', 'A Monday summary of your channels', notifWeekly, () => onUpdate({ notifWeekly: !notifWeekly }))}
            <Text style={s.note}>Reminder alerts need the installed app (not Expo Go) with notifications allowed.</Text>
          </View>
        ) : null}

        {view === 'email' ? (
          <View style={{ gap: 12, marginTop: 16 }}>
            <View>
              <Text style={s.label}>Email</Text>
              <Txt value={draftEmail} onChangeText={setDraftEmail} placeholder="you@studio.com" keyboardType="email-address" autoCapitalize="none" />
            </View>
            <View>
              <Text style={s.label}>Team / organization</Text>
              <Txt value={draftTeam} onChangeText={setDraftTeam} placeholder="My team" />
            </View>
            <TouchableOpacity
              onPress={() => { onUpdate({ email: draftEmail.trim(), team: draftTeam.trim() || 'My team' }); setView('main'); }}
              style={s.save} activeOpacity={0.85}
            >
              <Text style={s.saveT}>Save</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {view === 'password' ? (
          <View style={{ gap: 12, marginTop: 16 }}>
            <Text style={s.note}>Sosial accounts live on this device only — there’s no cloud password. Your social accounts keep their own passwords with Meta. Setting one here just confirms it’s you on this phone.</Text>
            <View>
              <Text style={s.label}>New password</Text>
              <Txt value={pw1} onChangeText={setPw1} placeholder="••••••••" secureTextEntry />
            </View>
            <View>
              <Text style={s.label}>Confirm</Text>
              <Txt value={pw2} onChangeText={setPw2} placeholder="••••••••" secureTextEntry />
            </View>
            <TouchableOpacity
              onPress={() => {
                if (pw1.length < 4) Alert.alert('Too short', 'Use at least 4 characters.');
                else if (pw1 !== pw2) Alert.alert('No match', 'The two passwords differ.');
                else { setPw1(''); setPw2(''); setView('main'); Alert.alert('Saved', 'Password updated on this device.'); }
              }}
              style={s.save} activeOpacity={0.85}
            >
              <Text style={s.saveT}>Update password</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {view === 'plan' ? (
          <View style={{ marginTop: 16, gap: 12 }}>
            <Field label="Channels" hint={`${proChannels} channel${proChannels === 1 ? '' : 's'} — applies to Pro & Team`}>
              <Stepper value={proChannels} onChange={setProChannels} step={1} min={1} max={10} format={(v) => `${v}`} />
            </Field>
            <Field label="Billing">
              <Seg
                options={[{ value: 'yearly', label: 'Yearly · save ~20%' }, { value: 'monthly', label: 'Monthly' }]}
                value={yearly ? 'yearly' : 'monthly'}
                onChange={(v) => setYearly(v === 'yearly')}
              />
            </Field>

            <View style={[s.plan, plan === 'free' && { borderColor: C.accent, borderWidth: 1.5 }]}>
              <Text style={s.planT}>Free{plan === 'free' ? ' · current' : ''}</Text>
              <Text style={s.planS}>2 connected channels · 10 scheduled posts per channel</Text>
              <Text style={s.planS}>Unlimited studio, templates & ideas (exports carry a small badge)</Text>
              <Text style={s.planS}>No AI generation · 7-day analytics</Text>
              {plan !== 'free' ? (
                <View style={{ marginTop: 8 }}><GhostBtn label="Switch to Free" onPress={() => choosePlan('free', 'Free')} /></View>
              ) : (
                <Text style={s.currentTag}>Current plan</Text>
              )}
            </View>

            <View style={[s.plan, plan === 'pro' && { borderColor: C.accent, borderWidth: 1.5 }]}>
              <Text style={s.planT}>Sosial Pro{plan === 'pro' ? ' · current' : ''}</Text>
              <Text style={s.planS}>Pay per channel — add or drop channels anytime.</Text>
              <Text style={[s.planS, { color: C.ink, fontFamily: 'PlusJakartaSans_700Bold' }]}>
                {yearly
                  ? `$${49 * proChannels}/yr ($4.08/mo per channel)`
                  : `$${(4.99 * proChannels).toFixed(2)}/mo ($4.99 per channel)`}
              </Text>
              <Text style={s.planS}>MY: {yearly ? `RM ${219 * proChannels}/yr` : `RM ${(21.9 * proChannels).toFixed(2)}/mo`}</Text>
              <Text style={s.planS}>Everything in Free, plus: unlimited scheduled posts · approvals · no export badge</Text>
              <Text style={s.planS}>500 AI generations / month · 1-year analytics + comments</Text>
              {plan === 'free' ? (
                <TouchableOpacity onPress={() => choosePlan('pro', `Sosial Pro (${proTotal})`)} style={[s.save, { marginTop: 8 }]} activeOpacity={0.85}>
                  <Text style={s.saveT}>Upgrade to Pro · {proTotal}</Text>
                </TouchableOpacity>
              ) : plan === 'team' ? (
                <View style={{ marginTop: 8 }}><GhostBtn label="Switch to Pro" onPress={() => choosePlan('pro', 'Sosial Pro')} /></View>
              ) : (
                <Text style={s.currentTag}>Current plan</Text>
              )}
            </View>

            <View style={[s.plan, plan === 'team' && { borderColor: C.accent, borderWidth: 1.5 }]}>
              <Text style={s.planT}>Sosial Team{plan === 'team' ? ' · current' : ''}</Text>
              <Text style={s.planS}>Everything in Pro, plus seats for the whole crew.</Text>
              <Text style={[s.planS, { color: C.ink, fontFamily: 'PlusJakartaSans_700Bold' }]}>
                {yearly
                  ? `$${99 * proChannels}/yr ($8.25/mo per channel)`
                  : `$${(9.99 * proChannels).toFixed(2)}/mo ($9.99 per channel)`}
              </Text>
              <Text style={s.planS}>MY: {yearly ? `RM ${439 * proChannels}/yr` : `RM ${(43.9 * proChannels).toFixed(2)}/mo`}</Text>
              <Text style={s.planS}>Unlimited seats · owner assigns members to specific channels (or all)</Text>
              <Text style={s.planS}>1,000 AI generations / month · approvals · priority support</Text>
              {plan !== 'team' ? (
                <TouchableOpacity onPress={() => choosePlan('team', `Sosial Team (${teamTotal})`)} style={[s.save, { marginTop: 8 }]} activeOpacity={0.85}>
                  <Text style={s.saveT}>{plan === 'free' ? 'Upgrade' : 'Switch'} to Team · {teamTotal}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={s.currentTag}>Current plan</Text>
              )}
            </View>

            {plan !== 'free' ? (
              <TouchableOpacity
                onPress={() => Alert.alert('Manage subscription', 'Subscriptions are managed in the Play Store app under Payments & subscriptions.')}
                style={s.save} activeOpacity={0.85}
              >
                <Text style={s.saveT}>Manage subscription</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {view === 'team' ? (
          plan !== 'team' ? (
            <View style={{ marginTop: 16, gap: 12 }}>
              <View style={s.empty}>
                <Text style={s.emptyT}>Team needs Sosial Team</Text>
                <Text style={s.emptyS}>The roster, roles and per-channel assignment unlock on the Team plan.</Text>
                <TouchableOpacity onPress={() => setView('plan')} style={[s.save, { marginTop: 12 }]} activeOpacity={0.85}>
                  <Text style={s.saveT}>See plans</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
          <View style={{ marginTop: 16, gap: 12 }}>
            <Text style={s.note}>Roster lives on this device for now — real invites and cross-device sync arrive with the backend.</Text>

            <Field label="Acting as" hint="Preview what each role can do.">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <TouchableOpacity onPress={() => changeActor(null)} style={[s.chan, actingAs === 'owner' && { backgroundColor: C.ink, borderColor: C.ink }]} activeOpacity={0.75}>
                  <Text style={[s.chanT, actingAs === 'owner' && { color: C.onInk }]}>Owner (you)</Text>
                </TouchableOpacity>
                {members.map((m) => (
                  <TouchableOpacity key={m.id} onPress={() => changeActor(m.id)} style={[s.chan, actingAs === m.id && { backgroundColor: C.ink, borderColor: C.ink }]} activeOpacity={0.75}>
                    <Text style={[s.chanT, actingAs === m.id && { color: C.onInk }]}>{m.name} · {m.role}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Field>

            <View style={s.head}>
              <View style={s.avatar}><Text style={s.avatarT}>{initial}</Text></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.email} numberOfLines={1}>{email || 'No email set'}</Text>
                <Text style={s.team} numberOfLines={1}>{team} · Owner</Text>
              </View>
            </View>

            {members.map((m) => {
              const isSelf = actor.id === m.id;
              const showRoleFlip = !isSelf && canChangeRole(actor, m, m.role === 'admin' ? 'member' : 'admin');
              const showChannels = !isSelf && canAssignChannels(actor, m);
              const showTrash = !isSelf && canRemoveMember(actor, m);
              return (
                <View key={m.id} style={s.member}>
                  <View style={s.miniAvatar}><Text style={s.miniAvatarT}>{(m.name || m.email || '?')[0].toUpperCase()}</Text></View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <Text style={s.rowT} numberOfLines={1}>{m.name}</Text>
                      <View style={s.rolePill}><Text style={s.rolePillT}>{m.role}</Text></View>
                    </View>
                    <Text style={s.rowS} numberOfLines={1}>{m.email} · {memberChannelsLabel(m.channels)}</Text>
                    {isSelf && actor.role === 'admin' ? (
                      <View style={{ marginTop: 8 }}><GhostBtn label="Step down to member" onPress={() => stepDown(m)} /></View>
                    ) : null}
                    {isSelf && actor.role === 'member' ? (
                      <View style={{ marginTop: 8 }}><GhostBtn label="Leave team" danger onPress={() => leaveTeam(m)} /></View>
                    ) : null}
                    {showRoleFlip ? (
                      <View style={{ marginTop: 8 }}>
                        <GhostBtn
                          label={m.role === 'admin' ? 'Demote to member' : 'Make admin'}
                          onPress={() => flipRole(m)}
                        />
                      </View>
                    ) : null}
                    {showChannels ? (
                      <View style={{ marginTop: 8 }}>
                        <GhostBtn
                          label={assigningId === m.id ? 'Done assigning' : 'Assign channels'}
                          onPress={() => setAssigningId(assigningId === m.id ? null : m.id)}
                        />
                      </View>
                    ) : null}
                  </View>
                  {showTrash ? (
                    <TouchableOpacity onPress={() => dropMember(m)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Ionicons name="trash-outline" size={18} color={C.faint} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
            {members.length === 0 ? (
              <Text style={s.hint}>No teammates yet — invite your first below.</Text>
            ) : null}
            {assigningId ? (
              (() => {
                const m = members.find((x) => x.id === assigningId);
                if (!m || !canAssignChannels(actor, m)) return null;
                return (
                  <View style={s.plan}>
                    <Text style={s.planT}>Channels for {m.name}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                      <TouchableOpacity
                        onPress={() => toggleMemberChannel(m, 'all')}
                        style={[s.chan, m.channels.includes('all') && { backgroundColor: C.ink, borderColor: C.ink }]}
                        activeOpacity={0.75}
                      >
                        <Text style={[s.chanT, m.channels.includes('all') && { color: C.onInk }]}>All channels</Text>
                      </TouchableOpacity>
                      {chanList.map((c) => {
                        const on = m.channels.includes(c.id);
                        return (
                          <TouchableOpacity
                            key={c.id}
                            onPress={() => toggleMemberChannel(m, c.id)}
                            style={[s.chan, on && { backgroundColor: C.ink, borderColor: C.ink }]}
                            activeOpacity={0.75}
                          >
                            <Text style={[s.chanT, on && { color: C.onInk }]}>{c.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })()
            ) : null}

            {actor.role === 'owner' ? (
              <View style={s.plan}>
                <Text style={s.planT}>Invite teammate</Text>
                <Field label="Name">
                  <Txt value={mName} onChangeText={setMName} placeholder="e.g. Ain" />
                </Field>
                <Field label="Email">
                  <Txt value={mEmail} onChangeText={setMEmail} placeholder="teammate@studio.com" keyboardType="email-address" autoCapitalize="none" />
                </Field>
                <Field label="Channels they can post to" hint="All channels, or pick specific ones.">
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => toggleMChannel('all')}
                      style={[s.chan, mChannels.includes('all') && { backgroundColor: C.ink, borderColor: C.ink }]}
                      activeOpacity={0.75}
                    >
                      <Text style={[s.chanT, mChannels.includes('all') && { color: C.onInk }]}>All channels</Text>
                    </TouchableOpacity>
                    {chanList.map((c) => {
                      const on = mChannels.includes(c.id);
                      return (
                        <TouchableOpacity
                          key={c.id}
                          onPress={() => toggleMChannel(c.id)}
                          style={[s.chan, on && { backgroundColor: C.ink, borderColor: C.ink }]}
                          activeOpacity={0.75}
                        >
                          <Text style={[s.chanT, on && { color: C.onInk }]}>{c.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </Field>
                <TouchableOpacity onPress={saveMember} style={[s.save, { marginTop: 12 }]} activeOpacity={0.85}>
                  <Text style={s.saveT}>Add teammate</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
          )
        ) : null}

        {view === 'changelog' ? (
          <View style={{ marginTop: 16, gap: 12 }}>
            {CHANGELOG.map((c) => (
              <View key={c.v} style={s.plan}>
                <Text style={s.planT}>v{c.v}</Text>
                {c.notes.map((n, i) => (
                  <Text key={i} style={s.planS}>• {n}</Text>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {view === 'terms' ? (
          <View style={{ marginTop: 16 }}>
            <Text style={s.body}>
              Sosial is a personal content studio. Your designs, ideas and posts are stored on your own device; social tokens are kept in the device keychain and used only to publish where you ask us to.{'\n\n'}
              Don’t publish content you don’t own or have rights to. Publishing to Facebook, Instagram and Threads is also governed by Meta’s terms.{'\n\n'}
              Sosial is provided as-is, without warranties.
            </Text>
          </View>
        ) : null}

        {view === 'legal' ? (
          <View style={{ marginTop: 16 }}>
            <Text style={s.body}>
              © 2026 Sosial. All rights reserved.{'\n\n'}
              Facebook, Instagram and Threads are trademarks of Meta Platforms, Inc. This app is not affiliated with or endorsed by Meta.{'\n\n'}
              Open-source licenses for bundled libraries are available in the project repository.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const makeS = (C: Palette) => StyleSheet.create({
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 18 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  avatarT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 22, color: C.onInk },
  email: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 17, letterSpacing: -0.2, color: C.ink },
  team: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted },
  list: { backgroundColor: C.card, borderRadius: R.lg, overflow: 'hidden', marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.lineSoft },
  rowT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.ink },
  rowS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, color: C.muted, marginTop: 1 },
  label: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: C.soft, marginBottom: 7 },
  save: { backgroundColor: C.ink, borderRadius: R.md + 2, paddingVertical: 12, alignItems: 'center' },
  saveT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: C.onInk },
  note: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 19, color: C.muted, margin: 14 },
  hint: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5, lineHeight: 19, color: C.muted },
  plan: { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.lineSoft, padding: 16, gap: 6 },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.lineSoft, padding: 13 },
  miniAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  miniAvatarT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 14, color: C.onInk },
  chan: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.paper, borderWidth: 1, borderColor: C.lineSoft },
  chanT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.muted },
  rolePill: { backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  rolePillT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 10.5, color: C.accentInk, textTransform: 'capitalize' },
  empty: { backgroundColor: C.card, borderRadius: R.lg, padding: 28, alignItems: 'center' },
  emptyT: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: C.ink },
  emptyS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, color: C.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  planT: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 17, color: C.ink },
  currentTag: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12.5, color: C.accent, marginTop: 6 },
  planS: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, lineHeight: 20, color: C.muted },
  body: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, lineHeight: 22, color: C.soft },
});
