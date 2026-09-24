/**
 * dsh-snippets — host half.
 *
 * Two jobs, both of which have to run in Node:
 *
 *  1. **Own the data.** The snippet library lives in the `dsh-snippets`
 *     settings namespace, so it is durable and reaches the browser through the
 *     official settings wire. There is deliberately no second store and no
 *     browser-writable snippet endpoint: one namespace, one library.
 *  2. **Do what a browser cannot.** It mirrors a local folder of `.css` / `.js`
 *     files into that namespace, and it exposes a small loopback-only HTTP
 *     prefix for the backup folder and the GitHub Gist bridge (see
 *     `routes.ts` for the loopback rationale and the token's storage).
 *
 * The namespace needs no registration of its own in DSH 0.1.7: it IS this
 * plugin's profile entry id, and the settings service discovers it by reading
 * the {@link Config} schema off this module (see the re-export below). What the
 * host half receives instead is `apply`'s second argument — the resolved
 * config — whose fields are stable volatile references rather than values.
 *
 * The browser half does everything else: the sidebar quick toggle, the manager
 * panel, the editor and the settings page.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only imports: each pulls in a `declare module '@deepseek-ai/cordis'`
// augmentation and is erased at build time, so neither package becomes a
// runtime dependency.
//   - `dsh-settings` types `ctx.settings`;
//   - `cordis-plugin-loader` declares `loader/volatile-update`, the event the
//     loader emits after committing a config change without a remount.
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { NAMESPACE, readSettings, type SettingsRefs } from '../shared/schema.ts'
import type { SnippetsConfig } from '../shared/types.ts'
import { reconcile, scanFolder } from './file-watch.ts'
import { resolveUserPath } from './paths.ts'
import { registerRoutes, type HostBridge, type WatchStatus } from './routes.ts'

/** Cordis plugin name; also the id the patch layer inserts. */
export const name = 'dsh-snippets'

/**
 * The settings schema, re-exported so the loader can find it.
 *
 * Cordis reads a plugin's schema off its module namespace as `plugin.Config`
 * and hands it to the settings service, which is how the `dsh-snippets` entry
 * gets a configuration card and a stable entry id at all. Exporting the same
 * object the shared module builds keeps the host's write target and the
 * browser's read target derived from one definition.
 */
export { Config } from '../shared/schema.ts'

/** Result of one reconcile pass, as reported to the browser. */
interface RescanResult {
  added: number
  updated: number
  removed: number
  changed: boolean
}

/**
 * The host's own view of its config.
 *
 * Split from the raw reference tree so the watcher can be tested against a
 * plain object, and so the "read it fresh every time" rule lives in one place.
 */
interface SettingsAccess {
  /** Snapshot the current config as plain data. */
  read(): SnippetsConfig
  /** Merge a patch into this plugin's settings entry. */
  write(patch: object): Promise<void>
}

/**
 * The folder watcher, and the only writer in this process.
 *
 * It never holds a copy of the library: every pass reads the current section,
 * reconciles it against a fresh scan, and writes back only when something
 * actually changed. That keeps the browser's writes and the watcher's writes
 * serialized by the settings service's own write path rather than by a second
 * lock this plugin would have to maintain.
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

  /** @param settings - the host's live config access for `dsh-snippets`. */
  constructor(private readonly settings: SettingsAccess) {}

  /** Re-read the watch settings and (re)arm the timer when they changed. */
  sync(): void {
    const config = this.settings.read()
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
    const config = this.settings.read()
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
    const config = this.settings.read()
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
      if (result.changed) await this.settings.write({ snippets: result.snippets })
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
 *
 * @param ctx - the host root context.
 * @param config - this plugin's resolved config: one stable reference per field.
 */
export function apply(ctx: Context, config: SettingsRefs): void {
  // `inject` rather than a hard dependency: a profile without a settings
  // provider still boots, it simply gets no snippet library.
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings

    // Read through `config` on every access instead of resolving it once here:
    // the loader commits a volatile-only edit by mutating these references in
    // place, so a snapshot taken now would pin the plugin to its boot-time
    // config and the folder watcher would never notice a settings change.
    const access: SettingsAccess = {
      read: () => readSettings(config),
      write: async (patch) => { await settings.update(NAMESPACE, patch) },
    }

    // The card is driven entirely by the schema and its volatile fields; there
    // is no auto-generated section to contribute, so opt out of one. The owner
    // must be this plugin's own fiber — that is the key `describe()` looks up
    // when it decides each entry's `autoGenerate`.
    settingsCtx.effect(
      () => settings.configure({ auto: false }, ctx.fiber),
      'dsh-snippets: settings presentation',
    )

    const watcher = new FolderWatcher(access)
    watcher.sync()

    // Two independent signals, because the watcher's fields must be read only
    // once their new values have actually been committed:
    //
    //  - `loader/volatile-update` is emitted synchronously right after the
    //    loader commits values into the references, so it is the deterministic
    //    one. It is what the shipped speech-to-text plugin listens to.
    //  - `settings/document-updated` is the documented settings event, emitted
    //    from `describe()` with the entry id and its new revision.
    //
    // `sync()` is idempotent — it returns early unless the mode/path/interval
    // key actually changed — so a signal arriving before the commit reads the
    // unchanged config and does nothing, and spurious signals cost nothing.
    const offVolatile = ctx.on('loader/volatile-update', () => { watcher.sync() })
    const offDocument = ctx.on('settings/document-updated', (ns: string) => {
      if (ns === NAMESPACE) watcher.sync()
    })

    settingsCtx.effect(() => () => {
      offVolatile()
      offDocument()
      watcher.dispose()
    }, 'dsh-snippets: folder watcher')

    const bridge: HostBridge = {
      read: () => access.read() as unknown as Record<string, unknown>,
      patch: (patch) => access.write(patch),
      watchStatus: () => watcher.status(),
      rescan: () => watcher.rescan(),
    }

    // The web server is optional: a headless or non-web profile still gets the
    // namespace and the watcher, just without the HTTP bridge.
    settingsCtx.inject(['webServer'], (webCtx) => {
      // `register` throws when the path is already taken, which is exactly what
      // a remount would hit if the previous registration had not been released.
      // Tying the disposer to the fiber and swallowing a duplicate keeps a route
      // collision from taking the whole host down.
      webCtx.effect(() => {
        try {
          return registerRoutes(webCtx, bridge)
        } catch {
          return () => {}
        }
      }, 'dsh-snippets: host routes')
    })
  })
}
