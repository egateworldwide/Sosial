# QuickPost ⚡ — React Native (Expo)

Simple infographic post maker: picture + text.

## Flow (as requested)
1. **Choose size** — 1:1, 4:5, 9:16 (Story/TikTok), 16:9, A4
2. **Background** — solid / grid / polkadot / stripes / zigzag / your own photo + **mix two patterns**
3. **Title** — top / bottom / none, size, color, align + share caption
4. **Profile picture** — any corner (TL/TR/BL/BR), size, shape
5. **Social icons** — IG / TikTok / X / FB / YT / WA + handle, shown next to PFP
6. **Content (mix anything)** — bullets, numbered, table, bar chart, pie chart, free text. Reorder, edit, delete.
7. **Pages** — duplicate any page to make carousels
8. **Save & share** — save all PNGs to device, or redirect to FB/IG/TikTok/X/WA

## No-API sharing — how it works
We do NOT use Facebook/Instagram APIs (no keys, no login, store-safe).
When you tap e.g. "Share to Facebook":
1. All pages are rendered to PNG via `react-native-view-shot`
2. PNGs are saved to gallery via `expo-media-library`
3. Title + caption is copied to clipboard via `expo-clipboard`
4. The Facebook app is opened via deep link (`fb://feed`)
5. You paste the caption and attach the images

Same pattern for Instagram (`instagram://library`), TikTok, X (prefills text via intent), WhatsApp (prefills text).

## Run
```bash
npm install
npx expo start
# then press `a` (Android), `i` (iOS), or `w` (web preview)
```

Assets folder can be empty — add `assets/icon.png` + `assets/splash.png` (1024px) before building with EAS.

## Build
```bash
npx eas build --platform android
npx eas build --platform ios
```

## Structure
- `App.tsx` — tiny state router (home/size/editor/export)
- `src/types.ts`, `src/constants.ts` — sizes, patterns, socials
- `src/store/PostContext.tsx` — post + current page state, duplicate logic
- `src/components/PostCanvas.tsx` — the exportable infographic renderer
- `src/components/PatternBackground.tsx` — SVG grid/dots/stripes/zigzag + mix
- `src/components/*Editor.tsx` — each step UI
- `src/screens/*` — Home / Size / Editor / Export
- `src/utils/export.ts` — capture + save + share file
- `src/utils/socialShare.ts` — no-API redirect + clipboard
