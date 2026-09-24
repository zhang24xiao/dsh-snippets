/**
 * Real-Cordis integration test for the host half.
 *
 * `test/host.test.mjs` covers the same reactivity against a hand-rolled fake ctx:
 * it looks the two config-commit signals up in a list and calls the handlers
 * directly. That cannot catch a dispatch bug, and it is exactly where a wrong
 * verdict was nearly recorded during the 0.1.7-rc.1 adaptation. This file closes
 * the gap: it mounts the built bundle through the same `@deepseek-ai/cordis`
 * 4.0.4 the harness runs, and replays the **plugin loader's own** volatile commit
 * (cordis-plugin-loader 1.0.5, `_commitVolatile`) so `Context.filter` arbitrates
 * delivery for real.
 *
 * What only this file can prove:
 *
 *  1. The loader's filtered `loader/volatile-update` emit reaches the plugin's
 *     listener, while a listener registered on `root` — a different fiber — is
 *     filtered out. Both halves matter: without the negative control the test
 *     would pass even if the emit were unfiltered.
 *  2. `settings/document-updated` is namespace-gated, and it is the *signal*
 *     (not the ref mutation) that re-arms the watcher.
 *  3. `configure`'s owner is the plugin's own fiber, and disposing the fiber
 *     tears the watcher down.
 *
 * One trap, because it produced a false alarm during this work:
 * `root.plugin(mod, config)` returns a **facade**, not the fiber. The loader
 * builds its filter from `plugin(...).ctx.fiber`, so feeding the facade back
 * into `owner.fiber === fiber` filters every listener out and looks exactly like
 * "the plugin never receives the volatile signal". Always use `facade.ctx.fiber`.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { deepEqual, updateVolatile, volatileEntries } from '@deepseek-ai/cosmokit'

// The plugin resolves its data directory from DSH_HOME, so point that at a
// scratch directory before importing the bundle.
const scratch = mkdtempSync(join(tmpdir(), 'dsh-snippets-cordis-'))
process.env.DSH_HOME = scratch
const watchDir = join(scratch, 'watch-src')
mkdirSync(watchDir, { recursive: true })

const mod = await import('../lib/index.js')

/* ── helpers ───────────────────────────────────────────────────────── */

const settle = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))

/** Mount the host half in a fresh root context with stubbed services. */
async function mount(config) {
  const root = new Context()
  const calls = { configure: [], updates: [], routes: [] }
  root.provide('settings', {
    configure(presentation, owner) {
      calls.configure.push({ presentation, owner })
      return () => {}
    },
    async update(namespace, patch) {
      calls.updates.push({ namespace, patch })
    },
  })
  root.provide('webServer', {
    register(route) {
      calls.routes.push(route)
      return () => {}
    },
  })

  const facade = root.plugin(mod, config)
  await settle()

  const fiber = facade.ctx.fiber
  const ctx = facade.ctx
  const handler = calls.routes[0].handler

  /** Drive one of the plugin's own routes and parse the JSON reply. */
  const request = async (url) => {
    const record = { status: 0, body: '' }
    await handler(
      {
        method: 'GET',
        url,
        socket: { remoteAddress: '127.0.0.1' },
        async *[Symbol.asyncIterator]() {},
      },
      {
        writeHead(status) {
          record.status = status
        },
        end(chunk) {
          record.body = chunk === undefined ? '' : String(chunk)
        },
      },
    )
    return JSON.parse(record.body)
  }

  const active = async () => (await request('/snippets/api/status')).watch.active

  /**
   * The first half of the loader's `_commitVolatile`: resolve a fresh candidate
   * from the schema and move the live volatile refs onto it, without notifying
   * anyone. Split out so a test can tell "the refs moved" apart from "the emit
   * arrived".
   */
  const mutateRefs = (raw) => {
    const candidate = mod.Config(raw)
    return volatileEntries(fiber.config).flatMap(({ path, ref }) => {
      const source = path.reduce((value, key) => Reflect.get(value, key), candidate)
      if (deepEqual(ref.get(), source.get(), true)) return []
      updateVolatile(ref, source)
      return [path]
    })
  }

  /**
   * The loader's full `_commitVolatile`, including the emit through its own
   * filter. `fiber` must be the real fiber, never the plugin facade.
   */
  const commitVolatile = (raw) => {
    const paths = mutateRefs(raw)
    const self = Object.create(fiber.ctx)
    self[Context.filter] = (owner) => owner.fiber === fiber
    fiber.ctx.emit(self, 'loader/volatile-update', paths)
    return paths
  }

  return { root, facade, fiber, ctx, calls, request, active, mutateRefs, commitVolatile }
}

/* ── 1. module surface ─────────────────────────────────────────────── */

assert.equal(mod.name, 'dsh-snippets')
assert.equal(typeof mod.apply, 'function')
assert.equal(typeof mod.Config, 'function', 'the loader reads `Config` off the module namespace')

/* ── 2. mounting ───────────────────────────────────────────────────── */

const base = { fileWatchMode: 'watch', fileWatchPath: watchDir }
const app = await mount(base)

// `plugin()` hands back a facade, not the fiber. Pin the distinction here so a
// future test that filters on the facade fails loudly instead of silently
// filtering out every listener (see the file header).
assert.notEqual(app.facade, app.fiber, 'plugin() returns a facade; the filter needs the fiber')
assert.equal(app.facade.uid, app.fiber.uid)
// This is exactly the path the loader takes to build its filter
// (`plugin(...).ctx.fiber`), which is why the fiber — not the facade — is what
// `commitVolatile` below must filter on.
assert.equal(app.facade.ctx.fiber, app.fiber)

assert.equal(app.calls.configure.length, 1, 'settings are presented exactly once')
assert.deepEqual(app.calls.configure[0].presentation, { auto: false })
const owner = app.calls.configure[0].owner
assert.equal(owner, app.fiber, 'the settings owner is the plugin fiber, not the settings service fiber')
assert.equal(owner.ctx, app.ctx, 'and it is the outer ctx, so the entry is attributed to this plugin')
assert.notEqual(owner.uid, app.root.fiber.uid, 'never the root fiber')
assert.equal(app.calls.routes.length, 1, 'one route prefix is registered')
assert.equal(app.calls.routes[0].kind, 'prefix')
assert.equal(app.calls.routes[0].path, '/snippets/api')

/* ── 3. the watcher is armed and reachable through its own route ───── */

assert.equal(await app.active(), true)

/* ── 4. the loader's filtered volatile emit ────────────────────────── */

// Negative control: a listener on `root` belongs to a different fiber, so the
// loader's filter must drop it. If this ever counts, the filter is not being
// applied and the positive assertion below proves nothing.
let rootHeard = 0
app.root.on('loader/volatile-update', () => {
  rootHeard += 1
})

const paths = app.commitVolatile({ fileWatchMode: 'disabled', fileWatchPath: '' })
assert.deepEqual(paths.map((path) => path.join('.')).sort(), ['fileWatchMode', 'fileWatchPath'])
assert.equal(await app.active(), false, 'the filtered emit reached the plugin listener')
assert.equal(rootHeard, 0, 'and was not broadcast to other fibers')

// Re-arm through the same signal, to prove the listener is not one-shot.
app.commitVolatile(base)
assert.equal(await app.active(), true)

/* ── 5. settings/document-updated is namespace-gated ───────────────── */

// Move the refs without emitting: the watcher must stay armed, which is what
// makes the two emits below meaningful.
app.mutateRefs({ fileWatchMode: 'disabled', fileWatchPath: '' })
assert.equal(await app.active(), true, 'a bare ref mutation does not resync the watcher')

app.root.emit('settings/document-updated', 'dsh-permission-presets', 1)
assert.equal(await app.active(), true, 'another namespace is ignored')

app.root.emit('settings/document-updated', 'dsh-snippets', 1)
assert.equal(await app.active(), false, 'our own namespace re-arms the watcher')

// An empty folder and an empty snippet library reconcile to "no change", so no
// settings write may be triggered by any of the above.
await settle()
assert.equal(app.calls.updates.length, 0, 'watching must not write back to settings')

/* ── 6. teardown ───────────────────────────────────────────────────── */

app.facade.dispose()
await settle()
assert.equal(await app.active(), false, 'disposing the fiber disposes the watcher')

// The disposed hook must be inert rather than throwing on a late emit.
assert.doesNotThrow(() => app.commitVolatile(base))
// Cordis documents `uid` as `null` once a fiber is disposed (no state enum is
// exported, so assert the invariant rather than a numeric literal).
assert.equal(app.fiber.uid, null, 'the fiber is disposed, not merely detaching')

rmSync(scratch, { recursive: true, force: true })
console.log('cordis test passed')
