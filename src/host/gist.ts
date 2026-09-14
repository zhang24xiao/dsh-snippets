/**
 * The GitHub Gist bridge — host side.
 *
 * Runs on the host for two reasons: the token must never enter a browser, and
 * a browser cannot call the GitHub API without a CORS preflight it will lose.
 * The token lives in a 0600 file next to the plugin's other state, NOT in the
 * settings document, so it never travels the settings wire and never ends up
 * inside a settings backup.
 *
 * Everything pure (URL grammar, file-name convention, import plan, line diff)
 * lives in `shared/gist.ts` so the browser can preview exactly what a write
 * will do before it writes it.
 */
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { gistFileName, parseGistId, splitGistFileName, type GistFile, type GistSnapshot } from '../shared/gist.ts'
import type { Snippet } from '../shared/types.ts'
import { gistTokenFile } from './paths.ts'

/** Stable failure codes; the browser maps each to a localized sentence. */
export type GistErrorCode =
  | 'invalid-url'
  | 'not-found'
  | 'unauthorized'
  | 'rate-limit'
  | 'network'
  | 'token-required'
  | 'too-large'
  | 'too-many'
  | 'empty'

/** A failure carrying a {@link GistErrorCode}. */
export class GistError extends Error {
  /** Stable machine token. */
  readonly code: GistErrorCode

  /** @param code - stable machine token. */
  constructor(code: GistErrorCode) {
    super(code)
    this.name = 'GistError'
    this.code = code
  }
}

/* ── Token storage ─────────────────────────────────────────────────── */

/** Read the stored token, or `''`. */
export async function readGistToken(): Promise<string> {
  try {
    const raw = await readFile(gistTokenFile(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return ''
    const token = (parsed as { token?: unknown }).token
    return typeof token === 'string' ? token : ''
  } catch {
    return ''
  }
}

/** Store (or clear, with an empty string) the token, mode 0600. */
export async function writeGistToken(token: string): Promise<void> {
  const target = gistTokenFile()
  if (token.trim() === '') {
    await rm(target, { force: true })
    return
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify({ token: token.trim() }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  // `writeFile`'s mode only applies at creation; an existing file keeps its own.
  await chmod(target, 0o600)
}

/** Whether a token is configured, without revealing it. */
export async function isGistConfigured(): Promise<boolean> {
  return (await readGistToken()) !== ''
}

/* ── HTTP ──────────────────────────────────────────────────────────── */

const API = 'https://api.github.com'

/** Call the GitHub API, translating transport and status failures into codes. */
async function github(
  path: string,
  init: RequestInit,
  token: string,
): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'dsh-snippets',
  }
  if (token !== '') headers.authorization = `Bearer ${token}`
  if (init.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(`${API}${path}`, { ...init, headers })
  } catch {
    throw new GistError('network')
  }

  if (response.status === 401 || response.status === 403) {
    // 403 with an exhausted quota is a rate limit, not an auth failure.
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      throw new GistError('rate-limit')
    }
    throw new GistError('unauthorized')
  }
  if (response.status === 404) throw new GistError('not-found')

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (response.status >= 400) throw new GistError('network')
  return body
}

/* ── Read ──────────────────────────────────────────────────────────── */

/**
 * Fetch one Gist and project its `.css` / `.js` files.
 * @param url - Gist URL or bare id.
 */
export async function fetchGist(url: string): Promise<GistSnapshot> {
  const id = parseGistId(url)
  if (id === null) throw new GistError('invalid-url')
  const token = await readGistToken()
  const body = await github(`/gists/${id}`, { method: 'GET' }, token)
  if (typeof body !== 'object' || body === null) throw new GistError('network')
  const gist = body as {
    id?: unknown
    html_url?: unknown
    description?: unknown
    public?: unknown
    files?: Record<string, { content?: unknown; truncated?: unknown }>
  }

  const files: GistFile[] = []
  for (const [filename, file] of Object.entries(gist.files ?? {})) {
    const { id: fileId, title, type } = splitGistFileName(filename)
    if (type === null) continue
    const truncated = file.truncated === true
    const entry: GistFile = {
      filename,
      type,
      title,
      content: truncated || typeof file.content !== 'string' ? '' : file.content,
      truncated,
    }
    if (fileId !== undefined) entry.id = fileId
    files.push(entry)
  }

  return {
    id: typeof gist.id === 'string' ? gist.id : id,
    url: typeof gist.html_url === 'string' ? gist.html_url : `https://gist.github.com/${id}`,
    description: typeof gist.description === 'string' ? gist.description : '',
    public: gist.public === true,
    files,
  }
}

/* ── Write ─────────────────────────────────────────────────────────── */

/** GitHub's per-file cap, in bytes. */
const MAX_FILE_BYTES = 1024 * 1024
/** GitHub's per-Gist file count cap. */
const MAX_FILES = 300

/** Where a publish should land. */
export type PublishTarget =
  | { kind: 'new-secret' }
  | { kind: 'new-public' }
  | { kind: 'update'; url: string }

/** A publish request. */
export interface PublishRequest {
  target: PublishTarget
  description: string
  snippets: Snippet[]
  /**
   * On an update, files already in the Gist that are not part of
   * {@link snippets} are deleted. The browser confirms before setting this,
   * because it is the one destructive branch.
   */
  deleteUnchecked: boolean
}

/**
 * Create or update a Gist from a snippet selection.
 * @returns the Gist URL and id, plus how many old files were deleted.
 */
export async function publishGist(
  request: PublishRequest,
): Promise<{ url: string; id: string; deleted: number }> {
  const token = await readGistToken()
  if (token === '') throw new GistError('token-required')
  if (request.snippets.length === 0) throw new GistError('empty')
  if (request.snippets.length > MAX_FILES) throw new GistError('too-many')

  const files: Record<string, { content: string } | null> = {}
  for (const snippet of request.snippets) {
    if (Buffer.byteLength(snippet.content, 'utf8') > MAX_FILE_BYTES) throw new GistError('too-large')
    files[gistFileName(snippet)] = { content: snippet.content }
  }

  let deleted = 0

  if (request.target.kind === 'update') {
    const id = parseGistId(request.target.url)
    if (id === null) throw new GistError('invalid-url')
    if (request.deleteUnchecked) {
      const keep = new Set(Object.keys(files))
      const existing = await fetchGist(id)
      for (const file of existing.files) {
        if (!keep.has(file.filename)) {
          files[file.filename] = null
          deleted += 1
        }
      }
    }
    const body = await github(
      `/gists/${id}`,
      { method: 'PATCH', body: JSON.stringify({ description: request.description, files }) },
      token,
    )
    const result = body as { html_url?: unknown; id?: unknown }
    return {
      url: typeof result?.html_url === 'string' ? result.html_url : `https://gist.github.com/${id}`,
      id: typeof result?.id === 'string' ? result.id : id,
      deleted,
    }
  }

  const body = await github(
    '/gists',
    {
      method: 'POST',
      body: JSON.stringify({
        description: request.description,
        public: request.target.kind === 'new-public',
        files,
      }),
    },
    token,
  )
  const result = body as { html_url?: unknown; id?: unknown }
  if (typeof result?.id !== 'string' || typeof result.html_url !== 'string') {
    throw new GistError('network')
  }
  return { url: result.html_url, id: result.id, deleted: 0 }
}
