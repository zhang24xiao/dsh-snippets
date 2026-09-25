/**
 * Build script for the two halves of dsh-snippets.
 *
 * 1. `lib/index.js` — the HOST half: an ESM cordis plugin for the Node side.
 *    Everything it needs (including schemastery) is inlined, so the installed
 *    package has no runtime dependency to resolve.
 * 2. `client/client.js` — the BROWSER half, wrapped in the official client
 *    module-loader contract:
 *
 *        window.__ModuleLoader__.load({ id, factory: (require) => { … } })
 *
 *    `react`, `react-dom` and the `@deepseek-ai/*` module-table entries stay
 *    external and are resolved by the loader; CodeMirror, the icons fallback
 *    and everything else is inlined.
 */
import { build, context } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8'))

/** Modules the browser loader's static table answers; never bundle these. */
const CLIENT_EXTERNAL = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const watch = process.argv.includes('--watch')

/**
 * Manifest facts inlined so the bundles never carry the whole file: the
 * version, and the package name — the latter is the key the official Plugins
 * page dispatches `plugins.bundle.config` on, so the settings card can never
 * drift from the package whose page renders it.
 */
const define = {
  __DSH_SNIPPETS_VERSION__: JSON.stringify(pkg.version),
  __DSH_SNIPPETS_PACKAGE__: JSON.stringify(pkg.name),
}

/** @type {import('esbuild').BuildOptions} */
const hostOptions = {
  entryPoints: [resolve(here, 'src/host/index.ts')],
  outfile: resolve(here, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'bundle',
  external: ['node:*'],
  define,
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
}

/** @type {import('esbuild').BuildOptions} */
const clientOptions = {
  entryPoints: [resolve(here, 'src/client/index.ts')],
  outfile: resolve(here, 'client/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: CLIENT_EXTERNAL,
  define,
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  banner: {
    js: [
      `window.__ModuleLoader__.load({`,
      `  id: ${JSON.stringify(pkg.name)},`,
      `  factory: (require) => {`,
      `    var module = { exports: {} };`,
      `    var exports = module.exports;`,
    ].join('\n'),
  },
  footer: {
    js: ['    return module.exports;', '  },', '});'].join('\n'),
  },
}

const options = [hostOptions, clientOptions]
if (watch) {
  const contexts = await Promise.all(options.map((o) => context(o)))
  await Promise.all(contexts.map((c) => c.watch()))
  console.log('[dsh-snippets] watching for changes…')
} else {
  await Promise.all(options.map((o) => build(o)))
  console.log('[dsh-snippets] built lib/index.js and client/client.js')
}
