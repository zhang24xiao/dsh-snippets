/**
 * Bundle the test entry (and only that) so the Node tests can import the
 * TypeScript sources through one ESM file. Kept out of `esbuild.config.mjs`
 * because it is a development artifact, not something the package ships.
 */
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [resolve(here, '..', 'test', 'entry.ts')],
  outfile: resolve(here, '..', 'test', '.build', 'internals.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['node:*'],
  define: { __DSH_SNIPPETS_VERSION__: '"0.0.0-test"' },
  logLevel: 'warning',
})

console.log('[dsh-snippets] built test/.build/internals.mjs')
