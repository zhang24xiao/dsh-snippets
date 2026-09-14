/**
 * The controller: one object every surface talks to.
 *
 * It owns three things.
 *
 * 1. **The settings namespace.** Reads go through `getConfig()`, a stable
 *    snapshot the React surfaces subscribe to with `useSyncExternalStore`;
 *    writes go through path-addressed mutations, so the host's per-namespace
 *    write queue serializes them and a rapid series of toggles lands in order.
 * 2. **The snippet runtime.** It re-projects the config onto the page after
 *    every accepted change.
 * 3. **Dialog state.** Editors, confirmations and toasts are held here rather
 *    than in a component, so closing the manager panel does not close an open
 *    editor and a confirmation raised from the settings page renders in the
 *    same place as one raised from the panel.
 */
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { CONFIG_DEFAULTS } from '../shared/schema.ts'
import { createSnippetId } from '../shared/model.ts'
import type { Snippet, SnippetType, SnippetsConfig } from '../shared/types.ts'
import { PLUGIN_VERSION } from '../shared/version.ts'
import { createRuntime, type RuntimeState } from './apply.ts'

/** A minimal observable store for the plugin's own UI state. */
export class Observable<T> {
  private current: T
  private readonly listeners = new Set<() => void>()

  /** @param initial - the first value. */
  constructor(initial: T) {
    this.current = initial
  }

  /**
   * The current value; stable between changes, so it is
   * `useSyncExternalStore`-safe.
   *
   * Declared as an arrow property rather than a prototype method: it is handed
   * to `useSyncExternalStore` as a bare reference, and a prototype method would
   * arrive with `this` undefined and throw on the first render.
   */
  readonly get = (): T => this.current

  /** Replace the value and notify, or update it from the previous value. */
  set(next: T | ((previous: T) => T)): void {
    const value = typeof next === 'function' ? (next as (previous: T) => T)(this.current) : next
    if (Object.is(value, this.current)) return
    this.current = value
    for (const listener of Array.from(this.listeners)) listener()
  }

  /** Observe changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

/** One open snippet editor. */
export interface EditorRequest {
  /** Stable dialog key (`new:<type>` or the snippet id). */
  key: string
  /** The snippet being edited, or `null` for a new one. */
  id: string | null
  /** The type a new snippet gets. */
  type: SnippetType
}

/** One pending confirmation. */
export interface ConfirmRequest {
  key: string
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  tone: 'default' | 'danger'
  resolve: (accepted: boolean) => void
}

/** One transient banner. */
export interface ToastRequest {
  key: string
  text: string
}

/** Everything the overlay host renders. */
export interface UiState {
  editors: EditorRequest[]
  confirms: ConfirmRequest[]
  toasts: ToastRequest[]
  /** Whether the DOM is behind the configuration until the next reload. */
  reloadPending: boolean
  /** CSS snippets currently injected. */
  cssApplied: number
  /** JS snippets that have run on this page load. */
  jsExecuted: number
}

/** Where a new snippet is inserted. */
export type InsertPosition = 'first' | 'last' | 'before'

/** What a surface may ask the controller to do. */
export interface SnippetsController {
  /** Stable config snapshot for `useSyncExternalStore`. */
  getConfig(): SnippetsConfig
  /** Subscribe to config changes. */
  subscribe(listener: () => void): () => void
  /** Wire state of the namespace: `unavailable` means the host never registered it. */
  status(): 'loading' | 'ready' | 'unavailable'
  /** UI state store (editors, confirms, toasts, runtime counters). */
  readonly ui: Observable<UiState>
  /** Version of the running build. */
  readonly version: string

  /** Diagnostic log; silent unless `consoleDebug` is on. */
  log(...args: unknown[]): void
  /** Merge a partial patch into the namespace. */
  patch(patch: Record<string, unknown>): Promise<void>
  /** Replace the whole set of snippets. */
  replaceSnippets(next: Snippet[], extra?: Record<string, unknown>): Promise<void>
  /** Return every preference to its schema default, keeping the snippets. */
  resetPreferences(): Promise<void>

  /** Insert a snippet, returning the created record. */
  addSnippet(
    input: { type: SnippetType; name?: string; content?: string; enabled?: boolean },
    position?: InsertPosition,
    anchorId?: string,
  ): Promise<Snippet>
  /** Persist an edited snippet. */
  saveSnippet(next: Snippet): Promise<void>
  /** Delete one snippet. */
  deleteSnippet(id: string): Promise<void>
  /** Copy one snippet above itself. */
  duplicateSnippet(id: string): Promise<Snippet | null>
  /** Switch one snippet on or off. */
  setEnabled(id: string, enabled: boolean): Promise<void>
  /** Reorder to exactly `orderedIds` (ids not listed keep their relative order at the end). */
  reorder(orderedIds: readonly string[]): Promise<void>

  /** Open (or focus) the editor for a snippet, or for a new one of `type`. */
  openEditor(id: string | null, type?: SnippetType): void
  /** Close one editor by dialog key. */
  closeEditor(key: string): void
  /** Ask the user; resolves `false` when they decline or dismiss. */
  confirm(spec: Omit<ConfirmRequest, 'key' | 'resolve'>): Promise<boolean>
  /** Show a transient banner. */
  toast(text: string): void
  /** Reload the page. */
  reload(): void
  /** Show or clear the editor's live CSS preview (see the runtime). */
  previewCss(content: string | null): void
  /**
   * Release everything this controller injected. Executed JS is deliberately
   * not undone — it cannot be — so the UI keeps saying a reload is required.
   */
  dispose(): void
}

/** Build the controller for one page load. */
export function createController(
  scope: SettingsScope<SnippetsConfig>,
  options: { fallback?: SnippetsConfig } = {},
): SnippetsController {
  const fallback = options.fallback ?? CONFIG_DEFAULTS
  const ui = new Observable<UiState>({
    editors: [],
    confirms: [],
    toasts: [],
    reloadPending: false,
    cssApplied: 0,
    jsExecuted: 0,
  })

  let debug = false
  const log = (...args: unknown[]): void => {
    if (debug) console.info('[dsh-snippets]', ...args)
  }

  const runtime = createRuntime(log)
  let dialogSeq = 0
  /** Last accepted section, so a reconnect does not blank the page. */
  let lastGood: SnippetsConfig | null = null
  /** The section the runtime was last projected from. */
  let synced: SnippetsConfig | null = null

  /**
   * The current section, purely.
   *
   * While the namespace is still loading, or if it was never exposed, the last
   * accepted section is returned rather than the schema default: a transient
   * reconnect must not strip the user's CSS off the page. Only a namespace that
   * never produced a value falls back to the defaults.
   *
   * The return value is referentially stable between commits, which is what
   * `useSyncExternalStore` requires, and this function has NO side effects
   * because React calls it during render.
   */
  const read = (): SnippetsConfig => {
    const snapshot = scope.getSnapshot()
    if (snapshot.status === 'ready' && snapshot.value !== undefined) {
      lastGood = snapshot.value
      return snapshot.value
    }
    return lastGood ?? fallback
  }

  /**
   * Project the current section onto the page.
   *
   * Deliberately NOT called from `getConfig`: mutating the DOM and notifying the
   * UI store are side effects, and React may invoke a `getSnapshot` function at
   * any point during a render. This runs once when the controller is built and
   * on every settings commit instead, and it no-ops when the section reference
   * has not moved.
   */
  const syncRuntime = (): void => {
    const config = read()
    if (config === synced) return
    synced = config
    if (debug !== config.consoleDebug) {
      debug = config.consoleDebug
      log('debug logging enabled')
    }
    const state: RuntimeState = runtime.sync(config)
    const current = ui.get()
    if (
      current.cssApplied !== state.cssApplied ||
      current.jsExecuted !== state.jsExecuted ||
      current.reloadPending !== state.jsPendingReload
    ) {
      ui.set({ ...current, ...state, reloadPending: state.jsPendingReload })
    }
  }

  const mutate = async (ops: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>): Promise<void> => {
    log('write', ops)
    await scope.mutate(ops as unknown as Parameters<typeof scope.mutate>[0])
  }

  const replaceSnippets = async (next: Snippet[], extra: Record<string, unknown> = {}): Promise<void> => {
    const ops: Array<{ op: 'set'; path: string[]; value: unknown }> = [{ op: 'set', path: ['snippets'], value: next }]
    for (const [key, value] of Object.entries(extra)) ops.push({ op: 'set', path: [key], value })
    await mutate(ops)
  }

  const patch = async (values: Record<string, unknown>): Promise<void> => {
    const ops = Object.entries(values).map(([field, value]) => ({ op: 'set' as const, path: [field], value }))
    if (ops.length > 0) await mutate(ops)
  }

  const controller: SnippetsController = {
    getConfig: read,
    subscribe: (listener) => scope.subscribe(listener),
    status: () => scope.getSnapshot().status,
    ui,
    version: PLUGIN_VERSION,
    log,
    patch,
    replaceSnippets,

    async resetPreferences() {
      const config = read()
      // `unset` (not `set undefined`) is what re-inherits the schema default.
      const fields = Object.keys(config).filter((field) => field !== 'snippets')
      await mutate(fields.map((field) => ({ op: 'unset' as const, path: [field] })))
    },

    async addSnippet(input, position = 'first', anchorId) {
      const config = read()
      const now = Date.now()
      const snippet: Snippet = {
        id: createSnippetId(now),
        name: input.name ?? '',
        type: input.type,
        content: input.content ?? '',
        enabled: input.enabled ?? config.newSnippetEnabled,
        created: now,
      }
      const next = [...config.snippets]
      if (position === 'before' && anchorId !== undefined) {
        const index = next.findIndex((item) => item.id === anchorId)
        next.splice(index < 0 ? 0 : index, 0, snippet)
      } else if (position === 'last') {
        next.push(snippet)
      } else {
        next.unshift(snippet)
      }
      await replaceSnippets(next)
      return snippet
    },

    async saveSnippet(next) {
      const config = read()
      const index = config.snippets.findIndex((item) => item.id === next.id)
      if (index < 0) {
        await replaceSnippets([next, ...config.snippets])
        return
      }
      const list = [...config.snippets]
      list[index] = next
      await replaceSnippets(list)
    },

    async deleteSnippet(id) {
      const config = read()
      await replaceSnippets(config.snippets.filter((item) => item.id !== id))
    },

    async duplicateSnippet(id) {
      const config = read()
      const index = config.snippets.findIndex((item) => item.id === id)
      const source = config.snippets[index]
      if (source === undefined) return null
      // A duplicate starts disabled: copying a JS snippet should never run the
      // same code twice by accident.
      const copy: Snippet = {
        ...source,
        id: createSnippetId(),
        created: Date.now(),
        enabled: false,
      }
      const list = [...config.snippets]
      list.splice(index, 0, copy)
      await replaceSnippets(list)
      return copy
    },

    async setEnabled(id, enabled) {
      const config = read()
      const next = config.snippets.map((item) => (item.id === id ? { ...item, enabled } : item))
      await replaceSnippets(next)
    },

    async reorder(orderedIds) {
      const config = read()
      const byId = new Map(config.snippets.map((item) => [item.id, item]))
      const ordered: Snippet[] = []
      for (const id of orderedIds) {
        const item = byId.get(id)
        if (item !== undefined) {
          ordered.push(item)
          byId.delete(id)
        }
      }
      // Anything the caller did not name keeps its stored relative order.
      for (const item of config.snippets) {
        if (byId.has(item.id)) ordered.push(item)
      }
      await replaceSnippets(ordered)
    },

    openEditor(id, type = 'css') {
      const key = id === null ? `new:${type}` : id
      const current = ui.get()
      const already = current.editors.find((editor) => editor.key === key)
      if (already !== undefined) return
      const request: EditorRequest = { key, id, type }
      // Without multiple editors the newest replaces the previous one.
      const keep = read().multipleEditors ? current.editors : []
      ui.set({ ...current, editors: [...keep, request] })
    },

    closeEditor(key) {
      const current = ui.get()
      ui.set({ ...current, editors: current.editors.filter((editor) => editor.key !== key) })
    },

    confirm(spec) {
      const key = `c${String(++dialogSeq)}`
      return new Promise<boolean>((resolve) => {
        const current = ui.get()
        ui.set({ ...current, confirms: [...current.confirms, { ...spec, key, resolve }] })
      })
    },

    toast(text) {
      const key = `t${String(++dialogSeq)}`
      const current = ui.get()
      ui.set({ ...current, toasts: [...current.toasts, { key, text }] })
    },

    reload() {
      window.location.reload()
    },

    previewCss(content) {
      runtime.previewCss(content)
    },

    dispose() {
      runtime.dispose()
    },
  }

  // Project once for an already-resolved section, then on every commit. A
  // namespace that resolves later still lands here, because the scope notifies
  // its subscribers on the loading → ready transition.
  scope.subscribe(syncRuntime)
  syncRuntime()

  return controller
}

/** Drop one toast by key (the Toast primitive calls this when it finishes). */
export function dismissToast(controller: SnippetsController, key: string): void {
  const current = controller.ui.get()
  controller.ui.set({ ...current, toasts: current.toasts.filter((toast) => toast.key !== key) })
}

/** Resolve one confirmation and remove it. */
export function settleConfirm(
  controller: SnippetsController,
  key: string,
  accepted: boolean,
): void {
  const current = controller.ui.get()
  const target = current.confirms.find((item) => item.key === key)
  if (target === undefined) return
  controller.ui.set({ ...current, confirms: current.confirms.filter((item) => item.key !== key) })
  target.resolve(accepted)
}
