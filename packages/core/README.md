# `@sosial/core`

Shared source of truth for channel ids + the freemium entitlement matrix.
Dependency-free so the Expo app, the Next.js web app and the publish worker
can all consume the same rules.

## Status

Scaffolded during P0. Not yet wired into the mobile Metro bundler — wiring
(importing it from `apps` code) happens with the mobile auth integration (P1),
which needs a `metro.config.js` `watchFolders` entry. Until then, keep
`ChannelKey` in `src/utils/managed.ts` and the limits in `AccountScreen.tsx`
in sync with this package by hand.

## Layout

- `src/channels.ts` — canonical 10 postable `ChannelKey`s + labels.
- `src/entitlements.ts` — `Plan`, `LIMITS` matrix, pure check helpers.
- `src/index.ts` — barrel.

## Rules

- Pure functions only. No I/O, no `fetch`, no secrets.
- The server enforces these; clients mirror for UI copy only.
