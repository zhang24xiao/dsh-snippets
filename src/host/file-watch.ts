/**
 * Local snippet-folder mirroring.
 *
 * The point of this feature is that a snippet can be authored in a real editor
 * with real tooling and still show up in the manager panel. A folder of
 * `.css` / `.js` files is polled, every file becomes a snippet, and the result
 * is written back into the settings namespace — the same namespace the panel
 * and the settings page write, so there is still exactly one library.
 *
 * Two details make the mirror stable rather than duplicating on every tick:
 *
 *  - a snippet id is taken from the file NAME when the name carries one
 *    (`<id>-<title>.<ext>`, the same shape a Gist export produces), and
 *    otherwise remembered in `watch-map.json` keyed by absolute path;
 *  - a snippet is only written when a field actually changed, so an unchanged
 *    folder produces no settings write at all.
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { createSnippetId, isSnippetId } from '../shared/model.ts'
import type { Snippet, SnippetType } from '../shared/types.ts'
import { watchMapFile } from './paths.ts'

/** One snippet file discovered in the watched folder. */
export interface FolderFile {
  /** Absolute path. */
  absPath: string
  /** File name without extension, with any leading id stripped. */
  title: string
  /** `css` or `js`. */
  type: SnippetType
  /** Id parsed from the file name, when the name carries one. */
  id?: string
  /** Raw file contents. */
  content: string
  /** Last modification time in epoch milliseconds. */
  mtime: number
}

/** The extension → snippet type mapping the watcher honours. */
const EXTENSIONS: Record<string, SnippetType> = { '.css': 'css', '.js': 'js' }

/** The persisted path → id memory. */
type WatchMap = Record<string, string>

/** Read `watch-map.json`, tolerating absence and corruption. */
async function readWatchMap(): Promise<WatchMap> {
  try {
    const raw = await readFile(watchMapFile(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const map: WatchMap = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') map[key] = value
    }
    return map
  } catch {
    return {}
  }
}

/** Persist the path → id memory atomically. */
async function writeWatchMap(map: WatchMap): Promise<void> {
  const target = watchMapFile()
  await mkdir(dirname(target), { recursive: true })
  const temp = `${target}.tmp`
  await writeFile(temp, `${JSON.stringify(map, null, 2)}\n`, 'utf8')
  await rename(temp, target)
}

/** Strip a leading snippet id from a file's base name. */
function titleFromFileName(fileName: string): { title: string; id?: string } {
  const base = basename(fileName, extname(fileName))
  const match = /^(\d{14}-[a-z0-9]{7})[-_]?(.*)$/.exec(base)
  if (match === null) return { title: base }
  const [, id, rest] = match
  return rest === undefined || rest.trim() === '' ? { title: base, id } : { title: rest.trim(), id }
}

/**
 * Read every snippet file in a folder (non-recursive).
 * @param dir - absolute folder path.
 * @returns the files found and a human-readable error per unreadable entry.
 */
export async function scanFolder(dir: string): Promise<{ files: FolderFile[]; errors: string[] }> {
  const errors: string[] = []
  if (dir.trim() === '') return { files: [], errors: ['empty-path'] }
  if (!existsSync(dir)) return { files: [], errors: ['folder-missing'] }

  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    return { files: [], errors: [error instanceof Error ? error.message : String(error)] }
  }

  const files: FolderFile[] = []
  for (const name of names) {
    const type = EXTENSIONS[extname(name).toLowerCase()]
    if (type === undefined) continue
    const absPath = join(dir, name)
    try {
      const info = await stat(absPath)
      if (!info.isFile()) continue
      const content = await readFile(absPath, 'utf8')
      const { title, id } = titleFromFileName(name)
      const entry: FolderFile = { absPath, title, type, content, mtime: info.mtimeMs }
      if (id !== undefined) entry.id = id
      files.push(entry)
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  files.sort((a, b) => a.absPath.localeCompare(b.absPath))
  return { files, errors }
}

/** The outcome of one reconcile pass. */
export interface ReconcileResult {
  /** The next library; identical content to the input when nothing changed. */
  snippets: Snippet[]
  /** Whether {@link snippets} differs from the input. */
  changed: boolean
  /** How many snippets were added. */
  added: number
  /** How many had a field updated. */
  updated: number
  /** How many were dropped because their file disappeared. */
  removed: number
}

/**
 * Reconcile a folder scan with the current library.
 *
 * @param current - the library as stored.
 * @param files - the scan result.
 * @param options - `overwrite` makes the folder authoritative; `merge` keeps
 *   snippets that did not come from the folder, and only then does
 *   `deleteMissing` mean anything.
 */
export async function reconcile(
  current: readonly Snippet[],
  files: readonly FolderFile[],
  options: { mirrorMode: 'merge' | 'overwrite'; deleteMissing: boolean; newSnippetEnabled: boolean },
): Promise<ReconcileResult> {
  const map = await readWatchMap()
  const nextMap: WatchMap = {}
  const seenIds = new Set<string>()

  // First pass: assign an id to every file and remember it, so the second pass
  // can diff without caring where the id came from.
  const resolved: Array<{ file: FolderFile; id: string }> = []
  for (const file of files) {
    const remembered = map[file.absPath]
    const id =
      file.id !== undefined && isSnippetId(file.id)
        ? file.id
        : remembered !== undefined && isSnippetId(remembered)
          ? remembered
          : createSnippetId(file.mtime > 0 ? file.mtime : Date.now())
    nextMap[file.absPath] = id
    resolved.push({ file, id })
  }

  // Ids from the previous map that no longer have a file, for deleteMissing.
  const liveIds = new Set(resolved.map((r) => r.id))
  const orphanIds = new Set(
    Object.entries(map)
      .filter(([path]) => nextMap[path] === undefined)
      .map(([, id]) => id)
      .filter((id) => !liveIds.has(id)),
  )

  const byId = new Map(current.map((snippet) => [snippet.id, snippet]))
  let added = 0
  let updated = 0
  const result: Snippet[] = []

  for (const { file, id } of resolved) {
    seenIds.add(id)
    const existing = byId.get(id)
    const name = file.title !== '' ? file.title : file.content.trim().slice(0, 200)
    if (existing === undefined) {
      added += 1
      result.push({
        id,
        name,
        type: file.type,
        content: file.content,
        enabled: options.newSnippetEnabled,
        created: file.mtime > 0 ? Math.round(file.mtime) : Date.now(),
      })
      continue
    }
    const patch: Partial<Snippet> = {}
    if (existing.content !== file.content) patch.content = file.content
    if (existing.type !== file.type) patch.type = file.type
    if (existing.name !== name) patch.name = name
    if (Object.keys(patch).length > 0) updated += 1
    result.push({ ...existing, ...patch })
  }

  let removed = 0
  if (options.mirrorMode === 'merge') {
    for (const snippet of current) {
      if (seenIds.has(snippet.id)) continue
      if (options.deleteMissing && orphanIds.has(snippet.id)) {
        removed += 1
        continue
      }
      result.push(snippet)
    }
  } else {
    removed = current.length - result.length
  }

  const changed =
    added > 0 || updated > 0 || removed > 0 || result.length !== current.length ||
    result.some((snippet, index) => current[index]?.id !== snippet.id)

  // A poll that changes nothing must not rewrite the memory file; at a five
  // second interval that would be pure churn.
  if (JSON.stringify(map) !== JSON.stringify(nextMap)) await writeWatchMap(nextMap)
  return { snippets: result, changed, added, updated, removed }
}
