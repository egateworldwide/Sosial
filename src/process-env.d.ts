/**
 * Minimal `process.env` typing for Expo Metro / web / Node.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` at bundle time (babel-preset-expo),
 * so every read below MUST be a static `process.env.FOO` access — never a
 * dynamic `process.env[key]` lookup, which the inliner cannot see.
 * `@types/node` is intentionally not installed; this keeps the declaration local.
 */
declare const process: {
  env: Record<string, string | undefined>;
};
