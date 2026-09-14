/**
 * The package version, inlined at build time from `package.json`.
 *
 * esbuild replaces `__DSH_SNIPPETS_VERSION__` with the literal, so the built
 * halves carry the version that produced them without bundling the manifest —
 * which matters for the client bundle, where importing `package.json` would
 * pull the whole file into the served script.
 */
declare const __DSH_SNIPPETS_VERSION__: string

/** The version the running build was produced from. */
export const PLUGIN_VERSION: string =
  typeof __DSH_SNIPPETS_VERSION__ === 'string' ? __DSH_SNIPPETS_VERSION__ : '0.0.0-dev'
