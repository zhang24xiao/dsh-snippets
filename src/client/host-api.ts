/**
 * Browser side of the plugin's own host API.
 *
 * Every call goes to `/snippets/api/…`, which the host answers for loopback
 * peers only. A refusal arrives as `{ ok: false, code }`; `HostError` carries
 * that code so a caller can localize it (`host.error.<code>`) instead of
 * printing an English sentence from the server.
 *
 * `available()` distinguishes "the host said no" from "there is no host
 * bridge at all" (a non-web deployment, or a plugin row without `webServer`),
 * which is the difference between a disabled section and an error.
 */
import type { GistSnapshot } from '../shared/gist.ts'
import type { Snippet } from '../shared/types.ts'

/** The path prefix the host registers. */
const PREFIX = '/snippets/api'

/** A failure carrying the host's stable code. */
export class HostError extends Error {
  /** Stable machine token, e.g. `loopback-only` or `rate-limit`. */
  readonly code: string

  /** @param code - the code from the response envelope. */
  constructor(code: string) {
    super(code)
    this.name = 'HostError'
    this.code = code
  }
}

/** What the host reports about itself. */
export interface HostStatus {
  version: string
  platform: string
  loopback: boolean
  paths: { dataDir: string; backupsDir: string; tokenFile: string }
  gist: { configured: boolean; lastPublished: string; lastImported: string }
  watch: {
    active: boolean
    mode: 'disabled' | 'watch' | 'loadOnce'
    path: string
    intervalSec: number
    lastScanAt: number
    lastError: string | null
  }
}

/** One file the host read out of the watched folder. */
export interface ScannedFile {
  absPath: string
  title: string
  type: 'css' | 'js'
  id?: string
  content: string
  mtime: number
}

/** One backup file the host listed. */
export interface BackupFile {
  name: string
  path: string
  size: number
  mtime: number
  count: number
}

/** The outcome of a host-side folder rescan. */
export interface RescanResult {
  added: number
  updated: number
  removed: number
  changed: boolean
}

interface Envelope {
  ok?: unknown
  code?: unknown
}

/** Read an error code out of a non-OK envelope. */
function codeOf(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null) {
    const code = (payload as Envelope).code
    if (typeof code === 'string') return code
  }
  return fallback
}

/** One request against the host prefix. */
async function request<T>(route: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${PREFIX}${route}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    })
  } catch {
    throw new HostError('network')
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok || (typeof payload === 'object' && payload !== null && (payload as Envelope).ok === false)) {
    throw new HostError(codeOf(payload, response.ok ? 'internal' : `http-${String(response.status)}`))
  }
  return payload as T
}

/** Whether the host bridge answers at all. */
export async function available(): Promise<boolean> {
  try {
    await request<unknown>('/status', 'GET')
    return true
  } catch {
    return false
  }
}

/** Host metadata, or `null` when the bridge is absent or refuses this peer. */
export async function status(): Promise<HostStatus | null> {
  try {
    return await request<HostStatus>('/status', 'GET')
  } catch {
    return null
  }
}

/** Back up the given library on the host. */
export async function createBackup(
  snippets: readonly Snippet[],
  reason: string,
): Promise<{ path: string; count: number }> {
  return await request('/backup', 'POST', { snippets, reason })
}

/** List the host's backup files. */
export async function listBackups(): Promise<BackupFile[]> {
  const payload = await request<{ entries: BackupFile[] }>('/backups/list', 'POST', {})
  return payload.entries
}

/** Open the backups folder in the OS file manager. */
export async function openBackups(): Promise<{ path: string; opened: boolean }> {
  return await request('/backups/open', 'POST', {})
}

/** Ask the host to scan the watched folder right now. */
export async function rescanFolder(): Promise<RescanResult> {
  return await request('/watch/rescan', 'POST', {})
}

/** Scan an arbitrary folder (used by the "preview what this folder holds" control). */
export async function scanFolder(path: string): Promise<{ path: string; files: ScannedFile[]; errors: string[] }> {
  return await request('/folder/scan', 'POST', { path })
}

/** Store or clear the GitHub token on the host. */
export async function setGistToken(token: string): Promise<{ configured: boolean }> {
  return await request('/gist/token', 'POST', { token })
}

/** Fetch a Gist through the host. */
export async function fetchGist(url: string): Promise<GistSnapshot> {
  const payload = await request<{ gist: GistSnapshot }>('/gist/fetch', 'POST', { url })
  return payload.gist
}

/** Publish a selection to a Gist through the host. */
export async function publishGist(request_: {
  target: string
  url?: string
  description: string
  snippets: Snippet[]
  deleteUnchecked: boolean
}): Promise<{ url: string; id: string; deleted: number }> {
  return await request('/gist/publish', 'POST', request_)
}
