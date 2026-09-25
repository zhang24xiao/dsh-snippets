/**
 * Build-time manifest facts, inlined from `package.json`.
 *
 * esbuild replaces `__DSH_SNIPPETS_VERSION__` and `__DSH_SNIPPETS_PACKAGE__`
 * with literals, so the built halves carry the facts that produced them
 * without bundling the manifest — which matters for the client bundle, where
 * importing `package.json` would pull the whole file into the served script.
 */
declare const __DSH_SNIPPETS_VERSION__: string
declare const __DSH_SNIPPETS_PACKAGE__: string

/** The version the running build was produced from. */
export const PLUGIN_VERSION: string =
  typeof __DSH_SNIPPETS_VERSION__ === 'string' ? __DSH_SNIPPETS_VERSION__ : '0.0.0-dev'

/**
 * The npm package name, which is also the bundle key the official Plugins page
 * dispatches its per-bundle configuration seat (`plugins.bundle.config`) on.
 * A key that does not equal the installed package's name renders nothing, so
 * it is inlined from the manifest rather than spelled out at the call site.
 */
export const PLUGIN_PACKAGE: string =
  typeof __DSH_SNIPPETS_PACKAGE__ === 'string' ? __DSH_SNIPPETS_PACKAGE__ : 'dsh-snippets'
