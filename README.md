# Sosial — multi-channel post studio + scheduler (Expo)

Design infographic posts, publish and schedule to 10 channels
(Facebook, Instagram, Threads, TikTok, X, Bluesky, LinkedIn, Mastodon,
Pinterest, YouTube), with queue, approvals, analytics and AI drafts.

## Run (mobile)

```powershell
npm install
Copy-Item .env.example .env   # then fill in provider keys
npx expo start                # a = Android, i = iOS
```

## Scripts

- `npm run typecheck` — `tsc --noEmit` (must stay clean)
- `npm run scan` — fail if a hardcoded provider secret is in source
- CI (`.github/workflows/ci.yml`) runs `npm ci` + typecheck + scan on push/PR

## Env

Provider keys live in `.env` as `EXPO_PUBLIC_*` (see `.env.example`).
Expo inlines them at build time — keep every read a static
`process.env.EXPO_PUBLIC_FOO` access. EAS builds need the same names as
EAS secrets (`eas secret:create --name …`).

## Layout

- `App.tsx`, `src/` — the Expo app (manual routing, no nav library)
- `assets/` — icon, splash, watermark, header logo
- `packages/core/` — shared channel ids + freemium entitlement matrix
  (dependency-free; server enforces, clients mirror)
- `supabase/` — backend migrations + setup (`supabase/README.md`)
- `scripts/scan-secrets.js` — local + CI secret hygiene

## Backend status

Milestone A in progress: P1 migrations (identity/tenancy + RLS) are in
`supabase/migrations`. Staging/prod Supabase projects + Railway worker come
next — see `supabase/README.md`.

## Security note (read before release)

Provider OAuth secrets were previously committed in source and are therefore
**in git history**. Before any store release you MUST rotate all of them in
the provider dashboards (Meta, Threads, IG, TikTok, LinkedIn, YouTube), move
token exchange server-side (P2), and set the new values as env — never in code.
