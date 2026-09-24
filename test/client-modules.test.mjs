// Proves the browser half reaches the real client-module graph.
//
// test/cordis.test.mjs mounts the Host half in real Cordis. This test covers
// the other half of the *same* Loader row: the `dsh.client` declaration plus
// `exports["./client"]` must make the real `dsh-client-modules` registry
// resolve this package, compose it into `window.__DSH_BOOT__`, and serve this
// package's real browser bundle from /plugins at the advertised revision.
//
// It is hermetic. A scratch directory holds `node_modules/dsh-snippets`, the
// symlink a profile install creates, so the registry resolves the bare
// specifier exactly as the live Host does — without a Web server, a profile,
// or the browser.
//
// Run: node test/client-modules.test.mjs

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import ClientModuleRegistry from '@deepseek-ai/dsh-client-modules'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = realpathSync(resolve(here, '..'))
const settle = (ms = 20) => new Promise((done) => setTimeout(done, ms))

const scratch = mkdtempSync(join(tmpdir(), 'dsh-snippets-client-'))
mkdirSync(join(scratch, 'node_modules'), { recursive: true })
symlinkSync(packageRoot, join(scratch, 'node_modules', 'dsh-snippets'), 'dir')

/**
 * One Loader row for this package, shaped as `dsh-client-modules` reads it:
 * the row name, a live fiber, and the resolution base of the tree that owns
 * the row. `fiber` is opaque to the registry — it only checks for absence.
 */
const rows = [{
  options: { name: 'dsh-snippets' },
  fiber: {},
  disabled: false,
  parent: { tree: { ctx: { baseUrl: `${scratch}/` } } },
}]

const app = new Context()
app.provide('loader', { entries: () => rows })
app.plugin(ClientModuleRegistry)
await settle()

// 1. The registry adopted the row and exposed the service the Web shell reads.
const registry = app.clientModules
assert.ok(registry, 'the client-modules service is registered on the context')
assert.equal(typeof registry.graph, 'function')
assert.equal(registry.constructor.name, 'ClientModuleRegistry')

// 2. The composed boot graph carries exactly the id the module bundle registers.
const graph = registry.graph()
const ids = graph.entries.map((entry) => entry.id)
const row = graph.entries.find((entry) => entry.id === 'dsh-snippets')
assert.ok(row, `dsh-snippets is composed into the boot graph (ids: ${ids.join(', ')})`)
assert.match(row.rev, /^[0-9a-f]{12}$/, 'the composed row advertises an artifact revision')

// 3. The declared client bundle resolved to this package's real file.
assert.equal(registry.clientPath('dsh-snippets'), join(packageRoot, 'client', 'client.js'))

// 4. `dsh.client.inject` survived manifest parsing, in declaration order.
assert.deepEqual(row.inject, [
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-sidebar',
])

// 5. The browser-facing URL is the revisioned combo route the shell preloads.
// It is document-relative by design (`comboReference` strips the route's
// leading slash at the boundary between the two halves), so the served route
// key is `/${row.url}`.
assert.match(row.url, /^plugins\/\?\?dsh-snippets\/client\.js&rev=[0-9a-f]{12}$/)

// 6. The advertised revision serves this package's real bundle bytes.
const bundle = readFileSync(join(packageRoot, 'client', 'client.js'))
const served = await registry.bundleResource('GET', `/${row.url}`)
assert.equal(served.status, 200)
assert.equal(served.headers['content-type'], 'text/javascript; charset=utf-8')
assert.ok(
  served.body.byteLength >= bundle.byteLength && served.body.byteLength <= bundle.byteLength + 256,
  `the response is the real bundle plus a source-map trailer (${served.body.byteLength} vs ${bundle.byteLength})`,
)
const script = served.body.toString('utf8')
assert.ok(script.includes('window.__ModuleLoader__.load('), 'the served script enters through the module loader')
assert.ok(
  script.includes(`id: "dsh-snippets"`),
  'the served script registers the composed graph id, so the loader can hand it to the shell',
)

// 7. Negative control: the same route at a stale revision is not served. This is
// why probing /plugins without the composed revision cannot prove registration.
const stale = await registry.bundleResource('GET', '/plugins/??dsh-snippets/client.js&rev=000000000000')
assert.equal(stale.status, 404)

// 8. HEAD returns the same immutable headers without materializing a body.
const head = await registry.bundleResource('HEAD', `/${row.url}`)
assert.equal(head.status, 200)
assert.equal(head.headers['cache-control'], 'public, max-age=31536000, immutable')
assert.equal(head.body, undefined)

// 9. Control: the graph is driven by the Loader row, not by the package merely
// being resolvable from the base URL. The same scratch tree, a row naming a
// package that is not installed, and nothing is composed.
const decoy = new Context()
decoy.provide('loader', {
  entries: () => [{ ...rows[0], options: { name: '@deepseek-ai/dsh-not-installed' } }],
})
decoy.plugin(ClientModuleRegistry)
await settle()
assert.equal(decoy.clientModules.graph().entries.length, 0)
assert.equal(decoy.clientModules.clientPath('dsh-snippets'), undefined)

rmSync(scratch, { recursive: true, force: true })
console.log('client-modules test passed')
