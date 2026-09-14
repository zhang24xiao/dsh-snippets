/**
 * dsh-snippets — host half.
 *
 * Two jobs, both of which have to run in Node:
 *
 *  1. **Own the data.** It registers the `dsh-snippets` settings namespace, so
 *     the snippet library is durable and reaches the browser through the
 *     official settings wire. There is deliberately no second store and no
 *     browser-writable snippet endpoint: one namespace, one library.
 *  2. **Do what a browser cannot.** It mirrors a local folder of `.css` / `.js`
 *     files into that namespace, and it exposes a small loopback-only HTTP
 *     prefix for the backup folder and the GitHub Gist bridge (see
 *     `routes.ts` for the loopback rationale and the token's storage).
 *
 * The browser half does everything else: the sidebar quick toggle, the manager
 * panel, the editor and the settings page.
 */
import type { Context } from '@deepseek-ai/cordis'
import { CONFIG_DEFAULTS, Config, NAMESPACE } from '../shared/schema.ts'
import type { SnippetsConfig } from '../shared/types.ts'
import { reconcile, scanFolder } from './file-watch.ts'
import { resolveUserPath } from './paths.ts'
import { registerRoutes, type HostBridge, type WatchStatus } from './routes.ts'

/** Cordis plugin name; also the id the patch layer inserts. */
export const name = 'dsh-snippets'

/** The subset of the settings owner scope this plugin uses. */
interface SettingsScopeLike {
  get(): SnippetsConfig
  watch(callback: (next: SnippetsConfig, prev: SnippetsConfig) => void): () => void
  update(patch: object): Promise<void>
  replace(section: object): Promise<void>
}

/** The subset of the settings provider this plugin uses. */
interface SettingsProviderLike {
  register(ns: string, schema: unknown, options?: { base?: unknown; applies?: string }): SettingsScopeLike
}

/** Result of one reconcile pass, as reported to the browser. */
interface RescanResult {
  added: number
  updated: number
  removed: number
  changed: boolean
}

/**
 * The folder watcher, and the only writer in this process.
 *
 * It never holds a copy of the library: every pass reads the current section
 * from the settings scope, reconciles it against a fresh scan, and writes back
 * only when something actually changed. That keeps the browser's writes and the
 * watcher's writes serialized by the settings provider's own per-namespace
 * queue rather than by a second lock this plugin would have to maintain.
 */
class FolderWatcher {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private lastScanAt = 0
  private lastError: string | null = null
  /**
   * Identity of the last applied watcher configuration. The watcher is its own
   * writer, so a scan that changes the library re-enters `sync()`; comparing
   * this key first is what stops that from arming a fresh immediate scan every
   * time and turning the poll into a loop.
   */
  private appliedKey = ''

  /** @param scope - the settings owner scope for `dsh-snippets`. */
  constructor(private readonly scope: SettingsScopeLike) {}

  /** Re-read the watch settings and (re)arm the timer when they changed. */
  sync(): void {
    const config = this.scope.get()
    const mode = config.fileWatchMode
    const path = resolveUserPath(config.fileWatchPath)
    const intervalSec = config.fileWatchIntervalSec
    const key = `${mode}|${path}|${String(intervalSec)}`
    if (key === this.appliedKey) return
    this.appliedKey = key

    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }

    if (mode === 'disabled' || path === '') {
      this.lastError = null
      return
    }

    if (mode === 'loadOnce') {
      // Exactly one pass per configuration: nothing polls afterwards.
      void this.rescan()
      return
    }

    const periodMs = Math.max(5, intervalSec) * 1000
    this.timer = setInterval(() => { void this.rescan() }, periodMs)
    // Do not hold the process open for a poll timer.
    this.timer.unref?.()
    void this.rescan()
  }

  /** Current state, for the browser's file-watch section. */
  status(): WatchStatus {
    const config = this.scope.get()
    return {
      active: this.timer !== null,
      mode: config.fileWatchMode,
      path: resolveUserPath(config.fileWatchPath),
      intervalSec: config.fileWatchIntervalSec,
      lastScanAt: this.lastScanAt,
      lastError: this.lastError,
    }
  }

  /** Run one reconcile pass now. */
  async rescan(): Promise<RescanResult> {
    const empty: RescanResult = { added: 0, updated: 0, removed: 0, changed: false }
    if (this.running) return empty
    const config = this.scope.get()
    const path = resolveUserPath(config.fileWatchPath)
    if (path === '') {
      this.lastError = 'empty-path'
      return empty
    }

    this.running = true
    try {
      const scan = await scanFolder(path)
      this.lastScanAt = Date.now()
      this.lastError = scan.errors.length > 0 ? scan.errors.join('; ') : null

      const result = await reconcile(config.snippets, scan.files, {
        mirrorMode: config.fileWatchMirrorMode,
        deleteMissing: config.fileWatchDeleteMissing,
        newSnippetEnabled: config.newSnippetEnabled,
      })
      if (result.changed) await this.scope.update({ snippets: result.snippets })
      return {
        added: result.added,
        updated: result.updated,
        removed: result.removed,
        changed: result.changed,
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      return empty
    } finally {
      this.running = false
    }
  }

  /** Stop polling. */
  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.appliedKey = ''
  }
}

/**
 * Mount the host half.
 * @param ctx - the host root context.
 */
export function apply(ctx: Context): void {
  // `inject` rather than a hard dependency: a profile without a settings
  // provider still boots, it simply gets no snippet library.
  ctx.inject(['settings'], (settingsCtx) => {
    const provider = (settingsCtx as unknown as { settings?: SettingsProviderLike }).settings
    if (provider === undefined || typeof provider.register !== 'function') return

    let scope: SettingsScopeLike
    try {
      scope = provider.register(NAMESPACE, Config, { base: CONFIG_DEFAULTS, applies: 'live' })
    } catch {
      // A duplicate registration (two plugin rows) must not take the host down.
      return
    }

    const watcher = new FolderWatcher(scope)
    watcher.sync()
    const unwatch = scope.watch(() => { watcher.sync() })
    ctx.effect(() => () => {
      unwatch()
      watcher.dispose()
    }, 'dsh-snippets: folder watcher')

    const bridge: HostBridge = {
      read: () => scope.get() as unknown as Record<string, unknown>,
      patch: (patch) => scope.update(patch),
      replace: (section) => scope.replace(section),
      watchStatus: () => watcher.status(),
      rescan: () => watcher.rescan(),
    }

    // The web server is optional: a headless or non-web profile still gets the
    // namespace and the watcher, just without the HTTP bridge.
    ctx.inject(['webServer'], (webCtx) => {
      registerRoutes(webCtx, bridge)
    })
  })
}
