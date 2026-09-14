/**
 * Host-half and shared-logic tests.
 *
 * Three things are covered, in the order they matter:
 *
 *  1. **Mounting.** `apply` must register the `dsh-snippets` namespace with a
 *     composition base and attach the web route prefix.
 *  2. **The loopback fence.** The plugin's own endpoints may touch the user's
 *     filesystem and their GitHub token, so a non-loopback peer must be refused
 *     before any handler logic runs. This is the test that would catch a
 *     regression turning a LAN deployment into a snippet-folder reader.
 *  3. **Pure logic.** The folder reconcile, the Gist import plan, the content
 *     guards and the re-indenter: exactly the parts whose bugs would be silent.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// The plugin resolves its data directory from DSH_HOME, so the test points that
// at a scratch directory inside the package before anything is imported.
const scratch = mkdtempSync(join(here, '.scratch-'))
process.env.DSH_HOME = scratch

const internals = await import('./.build/internals.mjs')
const {
  apply, NAMESPACE, CONFIG_DEFAULTS, decodeConfig,
  reconcile, scanFolder, registerRoutes, ROUTE_PREFIX,
  planImport, gistFileName, splitGistFileName, parseGistId, lineDiff,
  createSnippetId, createdFromId, isValidCssContent, isValidJavaScript,
  reindent, snippetTitle, sortSnippets, filterSnippets, dataDir, backupsDir,
} = internals

/* ── helpers ───────────────────────────────────────────────────────── */

/** Build a fake `IncomingMessage`. */
function fakeRequest({ method = 'GET', url = '/', address = '127.0.0.1', body } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    url,
    socket: { remoteAddress: address },
    async *[Symbol.asyncIterator]() {
      if (payload !== '') yield Buffer.from(payload, 'utf8')
    },
  }
}

/** Build a fake `ServerResponse` that records what was written. */
function fakeResponse() {
  const record = { status: 0, headers: {}, body: '' }
  return {
    record,
    writeHead(status, headers) {
      record.status = status
      record.headers = headers ?? {}
    },
    end(chunk) {
      record.body = chunk === undefined ? '' : String(chunk)
    },
    json() {
      return record.body === '' ? null : JSON.parse(record.body)
    },
  }
}

/** Call the registered prefix route handler. */
async function callRoute(handler, options) {
  const res = fakeResponse()
  await handler(fakeRequest(options), res)
  return res
}

/* ── 1. mounting ───────────────────────────────────────────────────── */

const registrations = []
const effects = []
const routes = []

let snapshotValue = { ...CONFIG_DEFAULTS }
const scope = {
  get: () => snapshotValue,
  watch: () => () => {},
  update: async (patch) => { snapshotValue = { ...snapshotValue, ...patch } },
  replace: async (section) => { snapshotValue = { ...CONFIG_DEFAULTS, ...section } },
}

const ctx = {
  effect: (fn, _label) => { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose); return () => {} },
  inject: (deps, callback) => {
    const child = { ...ctx }
    if (deps.includes('settings')) child.settings = provider
    if (deps.includes('webServer')) child.webServer = webServer
    callback(child)
  },
}
const provider = {
  register: (ns, schema, options) => {
    registrations.push({ ns, schema, options })
    return scope
  },
}
const webServer = {
  register: (route) => {
    routes.push(route)
    return () => {}
  },
}
ctx.settings = provider
ctx.webServer = webServer

apply(ctx)

assert.equal(registrations.length, 1, 'exactly one namespace is registered')
assert.equal(registrations[0].ns, NAMESPACE)
assert.equal(NAMESPACE, 'dsh-snippets')
assert.equal(typeof registrations[0].options.base, 'object', 'a composition base must be supplied')
assert.equal(registrations[0].options.applies, 'live')
assert.equal(routes.length, 1, 'the web route prefix must be registered')
assert.equal(routes[0].kind, 'prefix')
assert.equal(routes[0].path, ROUTE_PREFIX)
assert.equal(ROUTE_PREFIX, '/snippets/api')

/* ── 2. the loopback fence ─────────────────────────────────────────── */

const handler = routes[0].handler

for (const [route, method, body] of [
  ['/status', 'GET', undefined],
  ['/backup', 'POST', { snippets: [] }],
  ['/backups/list', 'POST', {}],
  ['/backups/open', 'POST', {}],
  ['/folder/scan', 'POST', { path: scratch }],
  ['/watch/rescan', 'POST', {}],
  ['/gist/token', 'POST', { token: 'x' }],
  ['/gist/fetch', 'POST', { url: 'https://gist.github.com/a/abc123' }],
  ['/gist/publish', 'POST', { target: 'new-secret', snippets: [] }],
]) {
  const res = await callRoute(handler, {
    method,
    url: `${ROUTE_PREFIX}${route}`,
    address: '192.168.1.50',
    body,
  })
  assert.equal(res.record.status, 400, `${route} must refuse a non-loopback peer`)
  assert.equal(res.json().code, 'loopback-only', `${route} must name the fence code`)
}

// …and it must accept a loopback peer.
const status = await callRoute(handler, { url: `${ROUTE_PREFIX}/status`, address: '127.0.0.1' })
assert.equal(status.record.status, 200)
const statusBody = status.json()
assert.equal(statusBody.ok, true)
assert.equal(statusBody.loopback, true)
assert.equal(statusBody.watch.mode, 'disabled')
assert.ok(statusBody.paths.dataDir.startsWith(scratch), 'the data dir must follow DSH_HOME')

const unknown = await callRoute(handler, { url: `${ROUTE_PREFIX}/nope` })
assert.equal(unknown.record.status, 404)
assert.equal(unknown.json().code, 'unknown-route')

/* ── 3. backups around the route + the data directory ──────────────── */

const sample = [
  { id: createSnippetId(1700000000000), name: 'alpha', type: 'css', content: 'a{}', enabled: true, created: 1 },
]
const backup = await callRoute(handler, {
  method: 'POST',
  url: `${ROUTE_PREFIX}/backup`,
  body: { snippets: sample, reason: 'test' },
})
assert.equal(backup.record.status, 200)
const backupBody = backup.json()
assert.equal(backupBody.count, 1)
assert.ok(backupBody.path.startsWith(backupsDir()))
assert.equal(readdirSync(backupsDir()).length, 1)

/* ── 4. the folder mirror ──────────────────────────────────────────── */

const snippetDir = join(scratch, 'snippets')
mkdirSync(snippetDir, { recursive: true })
writeFileSync(join(snippetDir, 'layout.css'), '#root { color: red; }')
writeFileSync(join(snippetDir, 'probe.js'), 'globalThis.x = 1')
writeFileSync(join(snippetDir, 'ignored.txt'), 'not a snippet')

const scan = await scanFolder(snippetDir)
assert.equal(scan.files.length, 2, 'only .css and .js files become snippets')
assert.deepEqual(scan.files.map((file) => file.type).sort(), ['css', 'js'])
assert.deepEqual(scan.errors, [])

const first = await reconcile([], scan.files, { mirrorMode: 'merge', deleteMissing: false, newSnippetEnabled: true })
assert.equal(first.added, 2)
assert.equal(first.changed, true)
assert.equal(first.snippets.length, 2)

// A second pass over an unchanged folder is a no-op…
const second = await reconcile(first.snippets, scan.files, { mirrorMode: 'merge', deleteMissing: false, newSnippetEnabled: true })
assert.equal(second.changed, false, 'an unchanged folder must not produce a write')
assert.equal(second.updated, 0)
assert.deepEqual(second.snippets.map((s) => s.id), first.snippets.map((s) => s.id), 'ids must be stable across scans')

// …and an edited file updates in place rather than duplicating.
writeFileSync(join(snippetDir, 'layout.css'), '#root { color: blue; }')
const rescanned = await scanFolder(snippetDir)
const third = await reconcile(first.snippets, rescanned.files, { mirrorMode: 'merge', deleteMissing: false, newSnippetEnabled: true })
assert.equal(third.updated, 1)
assert.equal(third.added, 0)
assert.equal(third.snippets.length, 2)
assert.match(third.snippets.find((s) => s.type === 'css').content, /blue/)

// A local snippet that did not come from the folder survives a merge…
const localOnly = { id: createSnippetId(), name: 'local', type: 'css', content: 'x{}', enabled: true, created: 2 }
const merged = await reconcile([...third.snippets, localOnly], rescanned.files, { mirrorMode: 'merge', deleteMissing: true, newSnippetEnabled: true })
assert.equal(merged.snippets.length, 3, 'merge keeps unrelated snippets')

// …and does not survive an overwrite.
const overwritten = await reconcile([...third.snippets, localOnly], rescanned.files, { mirrorMode: 'overwrite', deleteMissing: false, newSnippetEnabled: true })
assert.equal(overwritten.snippets.length, 2, 'overwrite makes the folder authoritative')

// An id embedded in a file name is honoured, which is what makes a Gist export
// round-trip through the folder watcher.
const namedId = createSnippetId(1700000000000)
writeFileSync(join(snippetDir, `${namedId}-from-gist.css`), 'body{}')
const named = await scanFolder(snippetDir)
const namedFile = named.files.find((file) => file.id === namedId)
assert.ok(namedFile !== undefined, 'the leading id in a file name must be read back')
assert.equal(namedFile.title, 'from-gist')

/* ── 5. the Gist plan ──────────────────────────────────────────────── */

const local = [
  { id: '20260101000000-aaaaaaa', name: 'one', type: 'css', content: 'a{}', enabled: true, created: 1 },
  { id: '20260101000000-bbbbbbb', name: 'two', type: 'js', content: 'b()', enabled: false, created: 2 },
]
const snapshot = {
  id: 'gist1',
  url: 'https://gist.github.com/u/gist1',
  description: '',
  public: false,
  files: [
    { filename: '20260101000000-aaaaaaa-one.css', type: 'css', id: '20260101000000-aaaaaaa', title: 'one', content: 'a{color:red}', truncated: false },
    { filename: '20260101000000-ccccccc-three.js', type: 'js', id: '20260101000000-ccccccc', title: 'three', content: 'c()', truncated: false },
  ],
}

const merge = planImport(snapshot, local, 'merge')
assert.equal(merge.candidates[0].exists, true)
assert.equal(merge.candidates[0].differs, true)
assert.equal(merge.candidates[1].exists, false)
assert.equal(merge.next.length, 3, 'merge updates one and adds one')
assert.equal(merge.next.find((s) => s.id === '20260101000000-bbbbbbb').enabled, false, 'untouched snippets keep their state')

const overwrite = planImport(snapshot, local, 'overwrite')
assert.equal(overwrite.next.length, 2)

const fork = planImport(snapshot, local, 'fork')
assert.equal(fork.next.length, 4, 'fork adds every file as a new snippet')
assert.equal(fork.candidates.every((candidate) => candidate.exists === false), true)

const truncated = planImport(
  { ...snapshot, files: [{ filename: 'big.css', type: 'css', title: 'big', content: '', truncated: true }] },
  local,
  'merge',
)
assert.equal(truncated.next.length, 2, 'a truncated file must not be imported')

// File-name round trip.
const namedSnippet = local[0]
const fileName = gistFileName(namedSnippet)
assert.equal(fileName, '20260101000000-aaaaaaa-one.css')
const parsedName = splitGistFileName(fileName)
assert.equal(parsedName.id, namedSnippet.id)
assert.equal(parsedName.title, 'one')
assert.equal(parsedName.type, 'css')
assert.equal(gistFileName({ ...namedSnippet, name: 'a/b:c' }), '20260101000000-aaaaaaa-a_b_c.css')

assert.equal(parseGistId('https://gist.github.com/user/abc123'), 'abc123')
assert.equal(parseGistId('abc123'), 'abc123')
assert.equal(parseGistId('https://example.com/nope'), null)

const diff = lineDiff('a\nb\nc', 'a\nB\nc')
assert.deepEqual(diff.map((line) => line.kind), ['same', 'local', 'gist', 'same'])

/* ── 6. content guards and helpers ─────────────────────────────────── */

assert.equal(isValidCssContent('a{}'), true)
assert.equal(isValidCssContent('a{} </style><script>alert(1)</script>'), false)
assert.equal(isValidJavaScript('const a = 1'), true)
assert.equal(isValidJavaScript('const = ;'), false)
assert.equal(isValidJavaScript('   '), false)

const id = createSnippetId(1700000000000)
assert.match(id, /^\d{14}-[a-z0-9]{7}$/)
assert.equal(createdFromId(id), 1700000000000)

assert.equal(snippetTitle({ name: '', content: 'x'.repeat(300) }).length, 200)
assert.equal(snippetTitle({ name: ' named ', content: 'ignored' }), 'named')

const ordered = [
  { id: 'a', name: 'b', type: 'css', content: '', enabled: false, created: 2 },
  { id: 'b', name: 'a', type: 'css', content: '', enabled: true, created: 1 },
]
assert.deepEqual(sortSnippets(ordered, 'customSort').map((s) => s.id), ['a', 'b'], 'custom sort preserves stored order')
assert.deepEqual(sortSnippets(ordered, 'nameASC').map((s) => s.id), ['b', 'a'])
assert.deepEqual(sortSnippets(ordered, 'enabledASC').map((s) => s.id), ['b', 'a'])
assert.deepEqual(filterSnippets(ordered, 1, 'A').map((s) => s.id), ['b'])
assert.deepEqual(filterSnippets(ordered, 0, 'a').map((s) => s.id), ['a', 'b'], 'search disabled returns everything')
assert.equal(filterSnippets(ordered, 1, '').length, 2)

const reindented = reindent('a {\nb;\n}', '  ')
assert.equal(reindented.ok, true)
assert.equal(reindented.content, 'a {\n  b;\n}')
// A template literal's interior whitespace is significant: the lines inside it
// keep their original indentation, and a genuinely unterminated one is refused.
const template = reindent('const x = `\n        keep me\n`', '  ')
assert.equal(template.ok, true)
assert.match(template.content, /^ {8}keep me$/mu, 'template interior indentation must be left alone')
assert.equal(reindent('const x = `\n  unterminated', '  ').ok, false)
// A CSS string containing braces must not move the depth counter.
const withString = reindent('.a { content: "}"; }', '  ')
assert.equal(withString.ok, true)
assert.equal(withString.content, '.a { content: "}"; }')
// An unbalanced bracket is refused rather than guessed at.
assert.equal(reindent('a {', '  ').ok, false)

/* ── 7. schema narrowing ───────────────────────────────────────────── */

assert.equal(decodeConfig(null), undefined)
assert.equal(decodeConfig('nope'), undefined)
const narrowed = decodeConfig({ defaultTab: 'js', snippets: [] })
assert.equal(narrowed.defaultTab, 'js')
assert.equal(narrowed.footerPosition, 'right', 'absent fields resolve to their defaults')
assert.ok(Object.keys(CONFIG_DEFAULTS).length >= 30)
assert.equal(dataDir().startsWith(scratch), true)

/* ── teardown ──────────────────────────────────────────────────────── */

for (const dispose of effects.reverse()) dispose()
rmSync(scratch, { recursive: true, force: true })

console.log('host test passed')
