/**
 * Client-half smoke test.
 *
 * Loads the BUILT `client/client.js` the same way the DSH web loader does
 * (`window.__ModuleLoader__.load({ id, factory })`), mounts it against a fake
 * cordis context, and then drives the snippet runtime by moving the fake
 * settings snapshot. That is the whole of requirement 1 under test: an enabled
 * CSS snippet must produce exactly one `<style>` element, an enabled JS snippet
 * must run, and turning the CSS one off must remove its element again.
 *
 * `@deepseek-ai/dsh-client-ui-primitives` is the one module stubbed: the real
 * package imports CSS modules, which only the browser bundler can resolve. The
 * stub keeps the same prop surface this plugin uses, so the assertions are
 * about this plugin's behaviour rather than about the primitives.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as react from 'react'
import * as reactDom from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolve(here, '..', 'client', 'client.js')

/* ── browser environment ───────────────────────────────────────────── */

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://127.0.0.1:3080/',
  pretendToBeVisual: true,
})

for (const key of ['window', 'document', 'navigator', 'CSS', 'HTMLElement', 'Node', 'Element', 'SVGElement', 'MutationObserver', 'getComputedStyle']) {
  // Node 22 exposes some of these as getter-only globals, so assign through a
  // descriptor rather than plain assignment.
  Object.defineProperty(globalThis, key, {
    value: dom.window[key],
    configurable: true,
    writable: true,
  })
}
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
dom.window.matchMedia ??= globalThis.matchMedia

/* ── the primitives stub ───────────────────────────────────────────── */

const passThrough = (tag) => ({ children, ...rest }) => createElement(tag, rest, children)
const icon = ({ size = 16, className }) => createElement('svg', { width: size, height: size, className })

const primitives = {
  Button: ({ variant, size, icon: leading, className, children, ...rest }) =>
    createElement('button', { type: 'button', className, ...rest }, leading, children),
  Switch: ({ checked, onChange, label, disabled, title }) =>
    createElement('button', {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      'aria-label': label,
      title,
      disabled,
      onClick: () => { onChange(!checked) },
    }),
  Input: (props) => createElement('input', props),
  Modal: ({ open, onClose, title, closeLabel, children, footer }) =>
    open ? createElement('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, children, footer) : null,
  Tooltip: ({ children }) => children,
  Toast: ({ text, onDone }) => { queueMicrotask(() => { onDone() }); return createElement('div', { role: 'status' }, text) },
  Tag: passThrough('span'),
  DiffBlock: () => null,
  useAnchoredPosition: () => null,
  useDismissOnOutsidePointer: () => {},
  useAnchoredMaxHeight: () => 400,
  writeClipboard: async () => true,
}
for (const name of [
  'IconCodeOutline16', 'IconSearchOutline16', 'IconSettingsOutline16', 'IconPlusOutline16',
  'IconRefreshOutline16', 'IconEditOutline16', 'IconCopyOutline16', 'IconTrashOutline16',
  'IconChevronDownOutline14', 'IconWarningOutline16', 'IconCloseOutline16', 'IconDownloadOutline16',
  'IconFolderOpenOutline16', 'IconRightUpOutline16', 'IconLoadingOutline16', 'IconCheckOutline16',
]) {
  primitives[name] = icon
}

const stubRequire = (name) => {
  if (name === 'react') return react
  if (name === 'react/jsx-runtime') return jsxRuntime
  if (name === 'react-dom') return reactDom
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected external: ${name}`)
}

/* ── load the bundle exactly as the loader does ────────────────────── */

let captured = null
dom.window.__ModuleLoader__ = { load: (spec) => { captured = spec } }
vm.runInThisContext(readFileSync(bundlePath, 'utf8'), { filename: 'client/client.js' })

assert.ok(captured !== null, 'the bundle must register itself with __ModuleLoader__')
assert.equal(captured.id, 'dsh-snippets')

const mod = captured.factory(stubRequire)
assert.equal(mod.name, 'dsh-snippets')
assert.deepEqual(mod.inject, ['slots', 'locale', 'settingsScope'])
assert.equal(typeof mod.apply, 'function')

/* ── a fake cordis context ─────────────────────────────────────────── */

const listeners = new Set()
let snapshotValue = { ...defaults() }
const writes = []

const scope = {
  getSnapshot: () => ({ status: 'ready', value: snapshotValue, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host' }),
  subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  set: async (field, value) => { writes.push({ op: 'set', path: [field], value }) },
  unset: async (field) => { writes.push({ op: 'unset', path: [field] }) },
  mutate: async (ops) => { writes.push(...ops) },
}

/** Push a new snapshot and notify, as the real scope does after a commit. */
function publish(next) {
  snapshotValue = next
  for (const listener of Array.from(listeners)) listener()
}

const registrations = []
const effects = []

const ctx = {
  effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose); return () => {} },
  locale: {
    register: () => () => {},
    bind: () => (key, params) => {
      if (params === undefined) return key
      return Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), key)
    },
  },
  settingsScope: { bind: () => scope },
  slots: {
    inject: (_key, callback) => { callback(); return () => {} },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
  get: () => undefined,
}

mod.apply(ctx)

/* ── registration assertions ───────────────────────────────────────── */

const seats = registrations.map((entry) => entry.options.name)
assert.deepEqual(
  seats.sort(),
  ['settings.section', 'shell.overlay', 'sidebar.footer.action'],
  'all three seats must be registered',
)
const footer = registrations.find((entry) => entry.options.name === 'sidebar.footer.action')
assert.equal(footer.options.order, 10, 'the default footer position is the right-hand side')
assert.equal(footer.options.locale, 'snippets')
const section = registrations.find((entry) => entry.options.name === 'settings.section')
assert.equal(section.options.id, 'dsh-snippets', 'the settings page is its own navigation entry')

assert.ok(
  document.head.querySelector('style[data-dsh-snippets-ui]') !== null,
  'the plugin stylesheet must be injected',
)

/* ── settings-driven footer position ───────────────────────────────── */

const before = registrations.length
publish({ ...snapshotValue, footerPosition: 'left' })
const latest = registrations[registrations.length - 1]
assert.ok(registrations.length > before, 'a position change must re-register the seat')
assert.equal(latest.options.name, 'sidebar.footer.action')
assert.equal(latest.options.order, -10, 'the left position must sort before the other footer actions')
publish({ ...snapshotValue, footerPosition: 'right' })

/* ── the snippet runtime ───────────────────────────────────────────── */

const cssId = '20260914120000-aaaaaaa'
const jsId = '20260914120001-bbbbbbb'
let jsRuns = 0
globalThis.__dshJsProbe = () => { jsRuns += 1 }

publish({
  ...snapshotValue,
  snippets: [
    { id: cssId, name: 'probe css', type: 'css', content: '#root { outline: 1px solid red; }', enabled: true, created: 1 },
    { id: jsId, name: 'probe js', type: 'js', content: 'globalThis.__dshJsProbe()', enabled: true, created: 2 },
  ],
})

const cssTag = document.head.querySelector(`style[data-dsh-snippet="${cssId}"]`)
assert.ok(cssTag !== null, 'an enabled CSS snippet must be injected')
assert.match(cssTag.textContent, /outline: 1px solid red/, 'the snippet body must reach the page verbatim')
assert.equal(jsRuns, 1, 'an enabled JS snippet must run exactly once')

// The runtime is a projection: an unchanged snapshot must not re-run JS.
publish({ ...snapshotValue })
assert.equal(jsRuns, 1, 'a re-sync must not re-execute JS')

// Disabling the CSS snippet removes exactly its element.
publish({
  ...snapshotValue,
  snippets: snapshotValue.snippets.map((snippet) => (snippet.id === cssId ? { ...snippet, enabled: false } : snippet)),
})
assert.equal(document.head.querySelector(`style[data-dsh-snippet="${cssId}"]`), null, 'disabling removes the style element')
assert.equal(jsRuns, 1, 'disabling CSS must not touch JS')

// The type master switch gates every snippet of that type.
publish({
  ...snapshotValue,
  cssMasterEnabled: false,
  snippets: [
    { id: cssId, name: 'probe css', type: 'css', content: '#root{}', enabled: true, created: 1 },
  ],
})
assert.equal(document.head.querySelector(`style[data-dsh-snippet="${cssId}"]`), null, 'the CSS master switch gates injection')

// A disallowed CSS body is a save-time concern, but the runtime must still be
// able to carry an arbitrary string without breaking the page.
publish({
  ...snapshotValue,
  cssMasterEnabled: true,
  snippets: [{ id: cssId, name: 'probe css', type: 'css', content: 'a{color:red}', enabled: true, created: 1 }],
})
assert.equal(document.head.querySelector(`style[data-dsh-snippet="${cssId}"]`).textContent, 'a{color:red}')

/* ── every registered surface must actually render ─────────────────── */

// The cheap half of a live check: SSR runs each component's render path against
// the same fake controller the runtime test used, so a broken hook order, a
// missing export or a bad prop shape fails here rather than in the GUI.
const translate = ctx.locale.bind('snippets')
const controllerRef = registrations
  .find((item) => item.options.name === 'settings.section')
  .options.inject().controller

function renderSeat(seatName, extraProps = {}) {
  const entry = registrations.find((item) => item.options.name === seatName)
  assert.ok(entry !== undefined, `${seatName} must be registered`)
  const injected = entry.options.inject()
  return renderToStaticMarkup(createElement(entry.component, { ...injected, t: translate, ...extraProps }))
}

publish({
  ...snapshotValue,
  snippets: [
    { id: cssId, name: 'render probe', type: 'css', content: 'a{}', enabled: true, created: 1 },
    { id: jsId, name: '', type: 'js', content: 'b()', enabled: false, created: 2 },
  ],
})

const footerHtml = renderSeat('sidebar.footer.action', { wide: true })
assert.match(footerHtml, /aria-haspopup="dialog"/, 'the trigger must advertise its dialog')
assert.match(footerHtml, /aria-label="trigger\.open"/, 'the trigger needs a stable accessible name')

// Icon-only, matching the neighbouring footer actions: the button must contain
// exactly one glyph and no text node.
const buttonInner = /<button[^>]*>([\s\S]*?)<\/button>/.exec(footerHtml)?.[1] ?? ''
assert.equal((buttonInner.match(/<svg/g) ?? []).length, 1, 'the trigger draws exactly one glyph')
assert.equal(
  buttonInner.replace(/<svg[\s\S]*?<\/svg>/, '').trim(),
  '',
  'the trigger must render no label or badge, only the icon',
)

// The trigger draws its own `</>` mark: the shared icon set's nearest
// neighbour is a `#` glyph, so this asserts the three-stroke glyph is ours.
assert.match(
  footerHtml,
  /<svg[^>]*viewBox="0 0 16 16"[^>]*aria-hidden="true"/,
  'the trigger must inline its own code glyph',
)
assert.equal(
  (footerHtml.match(/stroke-linecap="round"/g) ?? []).length,
  3,
  'the code glyph is the three-stroke </> mark',
)

// The tooltip carries what the dropped label used to say.
const wideTitle = /title="([^"]*)"/.exec(footerHtml)?.[1] ?? ''
assert.notEqual(wideTitle, 'trigger.open', 'the tooltip reports counts once snippets are enabled')

// The two column states must be marked distinctly: the wide trigger adds the
// 10px padding that makes its hover surface the same 36px circle as the rail's.
assert.match(footerHtml, /data-wide="wide"/, 'the wide state must be marked for styling')
assert.doesNotMatch(footerHtml, /data-rail="rail"/, 'the wide state must not carry the rail marker')

const railHtml = renderSeat('sidebar.footer.action', { wide: false })
assert.match(railHtml, /data-rail="rail"/, 'the rail state must be marked for styling')
assert.doesNotMatch(railHtml, /data-wide="wide"/, 'the rail state must not carry the wide marker')

// …and with nothing enabled it falls back to the plain action label.
publish({ ...snapshotValue, snippets: [] })
const idleHtml = renderSeat('sidebar.footer.action', { wide: true })
assert.match(idleHtml, /title="trigger\.open"/, 'an empty library keeps the plain tooltip')
publish({
  ...snapshotValue,
  snippets: [
    { id: cssId, name: 'render probe', type: 'css', content: 'a{}', enabled: true, created: 1 },
    { id: jsId, name: '', type: 'js', content: 'b()', enabled: false, created: 2 },
  ],
})

// The collapsed rail shim must ship: the shell keeps `footerActions` a row when
// collapsed, which pushes a second plugin's icon out of the 56px rail.
const sheetText = document.head.querySelector('style[data-dsh-snippets-ui]')?.textContent ?? ''
assert.match(
  sheetText,
  /\[class\*='_collapsed'\] \[class\*='_footerActions'\]/,
  'the collapsed-rail layout shim must be in the injected stylesheet',
)
assert.match(sheetText, /flex-direction: column/, 'the shim stacks the footer actions vertically')
// The editor and the KV code spans must follow the shipped code-font token, so
// a reader's code-font snippet reaches them too.
assert.doesNotMatch(sheetText, /--dsw-font-mono/, 'there is no --dsw-font-mono token in DSH')
assert.match(sheetText, /var\(--ds-font-family-code,/, 'code surfaces must read the real code-font token')
assert.match(
  sheetText,
  /html \[class\*='_footerActions'\] \{\s*gap: 6px/,
  'the wide row keeps the neighbours\' 6px rhythm instead of sitting flush',
)
// The wide trigger must keep the neighbour's 10px padding: without it the box
// is 16px wide and its hover surface becomes a narrow vertical pill.
assert.match(
  sheetText,
  /\[data-wide='wide'\] \{\s*width: auto;\s*border-radius: 999px;\s*padding: 0 10px;/,
  'the wide trigger must reproduce the neighbour\'s 36px pill geometry',
)

const sectionHtml = renderSeat('settings.section')
for (const group of [
  'group.general', 'group.menu', 'group.editor', 'group.behavior',
  'group.watch', 'group.data', 'group.gist', 'group.about',
]) {
  assert.match(sectionHtml, new RegExp(group), `the settings page must render the ${group} group`)
}
assert.match(sectionHtml, /section\.description/)
assert.match(sectionHtml, /set\.data\.summary/, 'the data group reports the library size')

assert.equal(renderSeat('shell.overlay'), '', 'an empty overlay must contribute no markup')

// A raised confirmation must reach the overlay.
void controllerRef.confirm({
  title: 'confirm.clear.title',
  body: 'confirm.clear.body',
  confirmLabel: 'action.confirm',
  cancelLabel: 'action.cancel',
  tone: 'danger',
})
assert.match(renderSeat('shell.overlay'), /confirm\.clear\.body/, 'a pending confirmation must render')

/* ── teardown ──────────────────────────────────────────────────────── */

for (const dispose of effects.reverse()) dispose()
assert.equal(
  document.head.querySelector('style[data-dsh-snippets-ui], style[data-dsh-snippet]'),
  null,
  'teardown must remove injected styles',
)

console.log('client smoke test passed')

/** The shape of the settings section, mirroring `shared/schema.ts`. */
function defaults() {
  return {
    cssMasterEnabled: true,
    jsMasterEnabled: true,
    defaultTab: 'css',
    newSnippetEnabled: true,
    rowClickAction: 'toggle',
    sortType: 'customSort',
    searchMode: 1,
    footerPosition: 'right',
    showEditButton: true,
    showDuplicateButton: false,
    showDeleteButton: true,
    confirmDelete: true,
    realTimePreview: true,
    editorIndentUnit: 'space2',
    multipleEditors: true,
    editorLineWrap: false,
    editorFontSize: 13,
    formatOnSave: false,
    consoleDebug: false,
    autoReloadAfterJsEdit: true,
    reloadNotice: true,
    reloadNoticeSuppressed: false,
    validateCssContent: true,
    validateJsSyntax: true,
    confirmJsExecution: true,
    fileWatchMode: 'disabled',
    fileWatchPath: '',
    fileWatchIntervalSec: 5,
    fileWatchMirrorMode: 'merge',
    fileWatchDeleteMissing: false,
    gistLastPublished: '',
    gistLastImported: '',
    snippets: [],
  }
}
