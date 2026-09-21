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
import { createRoot } from 'react-dom/client'

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
/** Locale subscribers: a `settings.section` label re-registers on a switch. */
const localeListeners = new Set()
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
    subscribe: (listener) => { localeListeners.add(listener); return () => { localeListeners.delete(listener) } },
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
// The settings page lives in the settings navigation, whose list slot keys one
// entry per registrant by `id`. The per-namespace card seat this surface used to
// claim (`settings.plugin.item`) is gone in DSH 0.1.6-alpha.2, and a
// registration against it is dropped without a word — so a regression that
// reintroduces it must fail right here instead of silently rendering nothing.
const page = registrations.find((entry) => entry.options.name === 'settings.section')
assert.equal(page.options.id, 'dsh-snippets', 'the section is identified by the namespace it edits')
assert.equal(page.options.order, 30, 'the section keeps its place in the settings nav')
assert.equal(typeof page.options.label, 'string', 'the nav label is resolved once, at registration')
assert.equal(
  registrations.some((entry) => entry.options.name === 'settings.plugin.item'),
  false,
  'the removed card seat must not be registered',
)

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

// The wide row carries its name, exactly like the Settings row it sits under:
// one glyph plus the localized label, and nothing else.
const buttonInner = /<button[^>]*>([\s\S]*?)<\/button>/.exec(footerHtml)?.[1] ?? ''
assert.equal((buttonInner.match(/<svg/g) ?? []).length, 1, 'the trigger draws exactly one glyph')
assert.equal(
  buttonInner.replace(/<svg[\s\S]*?<\/svg>/, '').replace(/<[^>]*>/g, '').trim(),
  'trigger.label',
  'the wide trigger labels itself with the snippet name',
)
assert.match(
  buttonInner,
  /<span class="dsn-trigger-label">/,
  'the wide label rides the class the stylesheet sizes',
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

// The tooltip still carries the live counts the row's label has no space for.
const wideTitle = /title="([^"]*)"/.exec(footerHtml)?.[1] ?? ''
assert.notEqual(wideTitle, 'trigger.open', 'the tooltip reports counts once snippets are enabled')

// The two column states must be marked distinctly: the wide trigger is the
// full-width labelled row, the rail stays a bare circle.
assert.match(footerHtml, /data-wide="wide"/, 'the wide state must be marked for styling')
assert.doesNotMatch(footerHtml, /data-rail="rail"/, 'the wide state must not carry the rail marker')

const railHtml = renderSeat('sidebar.footer.action', { wide: false })
assert.match(railHtml, /data-rail="rail"/, 'the rail state must be marked for styling')
assert.doesNotMatch(railHtml, /data-wide="wide"/, 'the rail state must not carry the wide marker')
// The rail has no room for a word, so it must render the glyph alone.
const railButtonInner = /<button[^>]*>([\s\S]*?)<\/button>/.exec(railHtml)?.[1] ?? ''
assert.equal(
  railButtonInner.replace(/<svg[\s\S]*?<\/svg>/, '').trim(),
  '',
  'the rail trigger must render no label, only the icon',
)

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
// The settings section paints no copy of its own, so the page's own heading and
// description hooks must ship — a section without them would render bare rows.
assert.match(sheetText, /\.dsn-settings-title\s*\{[^}]*font-size: 15px;\s*font-weight: 600/, 'the page heading matches the neighbouring sections')
assert.match(sheetText, /\.dsn-settings-desc\s*\{[^}]*color: var\(--dsw-alias-label-tertiary/, 'the page description uses the caption colour')
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
  /html \[class\*='_footerActions'\] \{[^}]*gap: 6px/,
  'the wide row keeps the neighbours\' 6px rhythm instead of sitting flush',
)
// A shared row seat must wrap: a wide third-party entry would otherwise push
// this plugin's icon past the edge, where the sidebar's overflow hides it.
assert.match(sheetText, /html \[class\*='_footerActions'\] \{[^}]*flex-wrap: wrap/, 'the row must be allowed to wrap')
assert.match(sheetText, /\.dsn-entry\s*\{[^}]*flex: none/, 'the entry must not be squashed in a crowded row')
// The wide trigger copies the Settings row's geometry field for field: the same
// 4px side bleed on the entry, the same 42px height, and the `0 10px 0 8px`
// padding that lands the glyph on the Settings glyph's own column.
assert.match(
  sheetText,
  /\.dsn-entry\[data-wide='wide'\] \{\s*width: calc\(100% \+ 4px\);\s*margin: 4px -2px;/,
  'the wide entry takes the whole row with the Settings row\'s side bleed',
)
assert.match(
  sheetText,
  /\.dsn-trigger\[data-wide='wide'\] \{[^}]*height: 42px;[^}]*padding: 0 10px 0 8px;/,
  'the wide trigger reproduces the Settings row geometry',
)
assert.match(
  sheetText,
  /\.dsn-trigger\[data-wide='wide'\] \{[^}]*gap: 8px;/,
  'the glyph-to-label gap must match the Settings row',
)
assert.match(
  sheetText,
  /\.dsn-trigger-label \{[^}]*text-overflow: ellipsis/,
  'a very narrow sidebar must ellipsize the label rather than overflow',
)
// The rail keeps the Settings rail row's own rhythm around the circle.
assert.match(
  sheetText,
  /\.dsn-trigger \{[^}]*margin: 8px 0 10px/,
  'the rail trigger keeps the Settings rail row\'s margin',
)
// The shipped Modal card is `min(380px, 100%)` with no height cap: right for a
// two-field form, but a long snippet overflows the window and takes the close
// button with it. The editor dialog must size itself to the viewport instead.
assert.match(
  sheetText,
  /\.dsn-editor-dialog\s*\{[^}]*width: min\(1040px, calc\(100vw - 48px\)\)/,
  'the editor dialog must adapt its width to the viewport',
)
assert.match(
  sheetText,
  /\.dsn-editor-dialog\s*\{[^}]*height: min\(760px, calc\(100vh - 72px\)\)/,
  'the editor dialog must cap its height so it never outgrows the window',
)
assert.match(
  sheetText,
  /\.dsn-cm\s*\{[^}]*flex: 1 1 auto/,
  'the code area must absorb the leftover height rather than a fixed 46vh',
)

// The shell mounts a section whole and paints no copy of its own, so the page is
// rendered into a real DOM: its heading, its description and every group are put
// under test here rather than assumed to arrive from the shell.
const pageHtml = await renderSettingsPage(registrations, translate)
assert.match(pageHtml, /dsn-settings-title/, 'the page renders its own heading')
assert.match(pageHtml, /section\.title/, 'the heading carries the section title')
assert.match(pageHtml, /section\.description/, 'the page carries the description')

for (const group of [
  'group.general', 'group.menu', 'group.editor', 'group.behavior',
  'group.watch', 'group.data', 'group.gist', 'group.about',
]) {
  assert.match(pageHtml, new RegExp(group), `the page must render the ${group} group`)
}
assert.match(pageHtml, /set\.data\.summary/, 'the data group reports the library size')

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

/**
 * Render the settings page into a real DOM, so the page's own heading, its
 * description and every group are exercised rather than assumed.
 * @returns the mounted markup.
 */
async function renderSettingsPage(entries, translate) {
  const act = react.act ?? (await import('react-dom/test-utils')).act
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const entry = entries.find((item) => item.options.name === 'settings.section')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(createElement(entry.component, { ...entry.options.inject(), t: translate }))
  })
  const html = host.innerHTML

  await act(async () => { root.unmount() })
  host.remove()
  return html
}

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
