/**
 * The plugin's own host routes, mounted on the profile's web server.
 *
 * ## Why this surface is loopback-only
 *
 * The official settings wire already carries every snippet in both directions,
 * and it is authorization-aware. These routes exist only for the three things a
 * browser cannot do: read a local folder, call GitHub with a stored token, and
 * open a directory in the OS file manager.
 *
 * Serving them to any origin that can reach the port would be a real hole on a
 * LAN or tunneled deployment: a deployment that relies on pairing for access
 * control would otherwise let an unpaired visitor list the user's snippet
 * folder or publish to their Gist. Every handler therefore refuses a
 * non-loopback peer with `loopback-only`, and the settings page turns that code
 * into "this section only works when the GUI is opened locally".
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Snippet } from '../shared/types.ts'
import { PLUGIN_VERSION } from '../shared/version.ts'
import { createBackup, listBackups, openBackupsFolder, type BackupEntry } from './backups.ts'
import { scanFolder, type FolderFile } from './file-watch.ts'
import { GistError, fetchGist, isGistConfigured, publishGist, writeGistToken, type PublishRequest } from './gist.ts'
import { RouteError, fail, handle, isLoopbackRequest, ok, optionalBoolean, optionalString, requireString, sendJson } from './http.ts'
import { backupsDir, dataDir, gistTokenFile, resolveUserPath } from './paths.ts'

/** The path prefix every route in this module lives under. */
export const ROUTE_PREFIX = '/snippets/api'

/** Live watcher state, as reported to the settings page. */
export interface WatchStatus {
  /** Whether a poll timer is currently armed. */
  active: boolean
  /** Configured mode. */
  mode: 'disabled' | 'watch' | 'loadOnce'
  /** Resolved absolute folder path (empty when unset). */
  path: string
  /** Poll interval in seconds. */
  intervalSec: number
  /** Epoch ms of the last completed scan, or 0. */
  lastScanAt: number
  /** Last scan error, if any. */
  lastError: string | null
}

/** What the route layer needs from the plugin body. */
export interface HostBridge {
  /** Current resolved settings section. */
  read(): Record<string, unknown>
  /** Merge a patch into the plugin's settings entry. */
  patch(patch: object): Promise<void>
  /** Current watcher state. */
  watchStatus(): WatchStatus
  /** Run one scan immediately. */
  rescan(): Promise<{ added: number; updated: number; removed: number; changed: boolean }>
}

/** Only expose file fields the browser can safely render. */
function publicFolderFile(file: FolderFile): Record<string, unknown> {
  const out: Record<string, unknown> = {
    absPath: file.absPath,
    title: file.title,
    type: file.type,
    content: file.content,
    mtime: file.mtime,
  }
  if (file.id !== undefined) out.id = file.id
  return out
}

/**
 * Register every route, once the profile's web server is present.
 * @param ctx - the caller's context; route disposal rides its fiber.
 * @param bridge - live access to the settings namespace and the watcher.
 * @returns a disposer removing the prefix route.
 */
export function registerRoutes(ctx: Context, bridge: HostBridge): () => void {
  const webServer = (ctx as unknown as { webServer?: { register(route: unknown): () => void } }).webServer
  if (webServer === undefined || typeof webServer.register !== 'function') return () => {}

  const requireLoopback = (req: Parameters<typeof isLoopbackRequest>[0]): void => {
    if (!isLoopbackRequest(req)) throw new RouteError('loopback-only')
  }

  /** Run a Gist call, folding its typed failure into the route envelope. */
  const viaGist = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (error) {
      if (error instanceof GistError) throw new RouteError(error.code)
      throw error
    }
  }

  const dispatch = handle(async (req, res, body) => {
    // Every route here can touch the filesystem or the network on the user's
    // behalf, so the whole prefix is fenced, `/status` included: a remote page
    // that cannot use these endpoints has no reason to enumerate them either.
    requireLoopback(req)

    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = url.pathname.slice(ROUTE_PREFIX.length) || '/'
    const method = req.method ?? 'GET'

    /* ── metadata ─────────────────────────────────────────────────── */

    if (route === '/status' && method === 'GET') {
      const config = bridge.read()
      sendJson(
        res,
        200,
        ok({
          version: PLUGIN_VERSION,
          platform: process.platform,
          loopback: isLoopbackRequest(req),
          paths: {
            dataDir: dataDir(),
            backupsDir: backupsDir(),
            tokenFile: gistTokenFile(),
          },
          gist: {
            configured: await isGistConfigured(),
            lastPublished: typeof config.gistLastPublished === 'string' ? config.gistLastPublished : '',
            lastImported: typeof config.gistLastImported === 'string' ? config.gistLastImported : '',
          },
          watch: bridge.watchStatus(),
        }),
      )
      return
    }

    /* ── everything below can touch the filesystem or the network ──── */

    if (route === '/folder/scan' && method === 'POST') {
      const requested = optionalString(body, 'path')
      const config = bridge.read()
      const configured = typeof config.fileWatchPath === 'string' ? config.fileWatchPath : ''
      const dir = resolveUserPath(requested ?? configured)
      if (dir === '') throw new RouteError('missing-path')
      const scan = await scanFolder(dir)
      sendJson(res, 200, ok({ path: dir, files: scan.files.map(publicFolderFile), errors: scan.errors }))
      return
    }

    if (route === '/watch/rescan' && method === 'POST') {
      sendJson(res, 200, ok(await bridge.rescan()))
      return
    }

    if (route === '/backup' && method === 'POST') {
      const raw = body.snippets
      const snippets = Array.isArray(raw) ? (raw as Snippet[]) : []
      const reason = optionalString(body, 'reason') ?? 'manual'
      const result = await createBackup(snippets, reason)
      sendJson(res, 200, ok(result))
      return
    }

    if (route === '/backups/list' && method === 'POST') {
      const entries: BackupEntry[] = await listBackups()
      sendJson(res, 200, ok({ entries }))
      return
    }

    if (route === '/backups/open' && method === 'POST') {
      sendJson(res, 200, ok(await openBackupsFolder()))
      return
    }

    if (route === '/gist/token' && method === 'POST') {
      const token = optionalString(body, 'token') ?? ''
      await writeGistToken(token)
      sendJson(res, 200, ok({ configured: await isGistConfigured() }))
      return
    }

    if (route === '/gist/fetch' && method === 'POST') {
      const target = requireString(body, 'url')
      const gist = await viaGist(() => fetchGist(target))
      sendJson(res, 200, ok({ gist }))
      return
    }

    if (route === '/gist/publish' && method === 'POST') {
      const targetKind = requireString(body, 'target')
      const description = optionalString(body, 'description') ?? ''
      const deleteUnchecked = optionalBoolean(body, 'deleteUnchecked') ?? false
      const snippets = Array.isArray(body.snippets) ? (body.snippets as Snippet[]) : []
      if (targetKind !== 'new-secret' && targetKind !== 'new-public' && targetKind !== 'update') {
        throw new RouteError('invalid-target')
      }
      const request: PublishRequest = {
        target: targetKind === 'update' ? { kind: 'update', url: requireString(body, 'url') } : { kind: targetKind },
        description,
        snippets,
        deleteUnchecked,
      }
      const result = await viaGist(() => publishGist(request))
      await bridge.patch({ gistLastPublished: result.url })
      sendJson(res, 200, ok(result))
      return
    }

    sendJson(res, 404, fail('unknown-route'))
  })

  // One prefix route keeps the composition surface a single named entry, and
  // the dispatcher above owns method and path validation from there.
  return webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: dispatch })
}

/**
 * Translate a thrown error into the plugin's failure envelope.
 * Exported for the tests and for `index.ts`, which reuses it for startup work.
 */
export function toFailure(error: unknown): { ok: false; code: string; message?: string } {
  if (error instanceof GistError) return fail(error.code)
  if (error instanceof RouteError) return fail(error.code)
  if (error instanceof Error) return fail('internal', error.message)
  return fail('internal', String(error))
}
