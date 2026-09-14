/**
 * Pure Gist helpers, shared by both halves.
 *
 * The host owns the network call (the token never enters a browser), but the
 * URL grammar, the file-name convention and the import plan are pure string
 * and array work — and the browser needs all three to render the diff dialog
 * and to compute the next library before it writes it. Keeping them here is
 * what lets the import dialog preview exactly what the write will do.
 */
import { createSnippetId } from './model.ts'
import type { Snippet, SnippetType } from './types.ts'

/** One file read out of a Gist. */
export interface GistFile {
  /** Raw Gist file name. */
  filename: string
  /** Snippet type derived from the extension. */
  type: SnippetType
  /** Id embedded in the file name, when there is one. */
  id?: string
  /** Title: the file name with the id prefix stripped. */
  title: string
  /** File contents (empty when {@link truncated}). */
  content: string
  /** GitHub refused to inline the file because it exceeds its size cap. */
  truncated: boolean
}

/** A fetched Gist. */
export interface GistSnapshot {
  /** Gist id. */
  id: string
  /** Canonical HTML URL. */
  url: string
  /** Gist description. */
  description: string
  /** Whether the Gist is publicly listed. */
  public: boolean
  /** Every `.css` / `.js` file, in Gist order. */
  files: GistFile[]
}

/** One importable Gist file, with what it would become locally. */
export interface ImportCandidate {
  filename: string
  /** Existing snippet id when the file name carried one. */
  id?: string
  title: string
  type: SnippetType
  content: string
  truncated: boolean
  /** Whether a snippet with this id already exists locally. */
  exists: boolean
  /** Whether the local snippet's content differs from the Gist file. */
  differs: boolean
}

/** The three import strategies. */
export type GistImportMode = 'merge' | 'overwrite' | 'fork'

/** Accept `https://gist.github.com/user/<id>`, a bare id, or `…/<id>#file-…`. */
export function parseGistId(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  if (/^[0-9a-f]{5,64}$/i.test(trimmed)) return trimmed
  const match = /gist\.github(?:usercontent)?\.com\/(?:[^/]+\/)?([0-9a-f]{5,64})/i.exec(trimmed)
  return match === null ? null : (match[1] as string)
}

/** Replace characters that are unsafe in a file name. */
export function safeFileTitle(title: string): string {
  const cleaned = title
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned === '' ? 'snippet' : cleaned.slice(0, 80)
}

/** The Gist file name for one snippet: `<id>-<safe title>.<ext>`. */
export function gistFileName(snippet: Snippet): string {
  const source = snippet.name.trim() === '' ? snippet.content.trim().slice(0, 40) : snippet.name
  return `${snippet.id}-${safeFileTitle(source)}.${snippet.type}`
}

/** Split a Gist file name into an id (when present) plus a title and type. */
export function splitGistFileName(filename: string): {
  id?: string
  title: string
  type: SnippetType | null
} {
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return { title: filename, type: null }
  const ext = filename.slice(dot + 1).toLowerCase()
  const type: SnippetType | null = ext === 'css' ? 'css' : ext === 'js' ? 'js' : null
  const base = filename.slice(0, dot)
  const match = /^(\d{14}-[a-z0-9]{7})[-_ ]?(.*)$/.exec(base)
  if (match === null) return { title: base, type }
  const [, id, rest] = match
  return { id, title: rest === undefined || rest === '' ? base : rest, type }
}

/**
 * Project a Gist into one of the three import modes.
 *
 * - `merge` matches by the id in the file name, updates those snippets and
 *   adds the rest;
 * - `overwrite` replaces the whole library with the Gist (the caller backs up
 *   first);
 * - `fork` ignores ids entirely and imports every file as a new snippet.
 *
 * @param snapshot - the fetched Gist.
 * @param local - the current library.
 * @param mode - the strategy.
 * @returns the exact next library plus a per-file report for the diff dialog.
 */
export function planImport(
  snapshot: GistSnapshot,
  local: readonly Snippet[],
  mode: GistImportMode,
): { next: Snippet[]; candidates: ImportCandidate[] } {
  const byId = new Map(local.map((snippet) => [snippet.id, snippet]))
  const candidates: ImportCandidate[] = []
  const imported: Snippet[] = []
  const now = Date.now()

  for (const file of snapshot.files) {
    if (file.truncated) {
      const candidate: ImportCandidate = {
        filename: file.filename,
        title: file.title,
        type: file.type,
        content: '',
        truncated: true,
        exists: false,
        differs: false,
      }
      if (file.id !== undefined) candidate.id = file.id
      candidates.push(candidate)
      continue
    }

    const fileId = file.id
    const fork = mode === 'fork' || fileId === undefined
    const id = fileId === undefined || fork ? createSnippetId(now) : fileId
    const existing = fork ? undefined : byId.get(id)
    const candidate: ImportCandidate = {
      filename: file.filename,
      title: file.title,
      type: file.type,
      content: file.content,
      truncated: false,
      exists: existing !== undefined,
      differs: existing === undefined ? true : existing.content !== file.content,
    }
    if (!fork) candidate.id = id
    candidates.push(candidate)
    imported.push({
      id,
      name: file.title,
      type: file.type,
      content: file.content,
      enabled: existing?.enabled ?? true,
      created: existing?.created ?? now,
    })
  }

  const importedIds = new Set(imported.map((snippet) => snippet.id))
  const next =
    mode === 'overwrite'
      ? imported
      : [...local.filter((snippet) => !importedIds.has(snippet.id)), ...imported]
  return { next, candidates }
}

/**
 * A compact line diff for the import dialog.
 *
 * Not a minimal edit script: it walks both sides in order and emits equal /
 * removed / added runs, which is enough to show a reader what changes and is
 * bounded by the line counts rather than by a quadratic table.
 */
export interface DiffLine {
  kind: 'same' | 'local' | 'gist'
  text: string
}

/** Compute the {@link DiffLine} list between the local and Gist content. */
export function lineDiff(local: string, incoming: string): DiffLine[] {
  const a = local.split('\n')
  const b = incoming.split('\n')
  const out: DiffLine[] = []

  // Trim the common head and tail first; snippet edits are usually local, so
  // this collapses most of the noise before any pairwise work.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }

  for (let i = 0; i < start; i += 1) out.push({ kind: 'same', text: a[i] as string })
  const middleA = a.slice(start, endA)
  const middleB = b.slice(start, endB)
  const common = new Set(middleA.filter((line) => middleB.includes(line)))
  for (const line of middleA) out.push(common.has(line) ? { kind: 'same', text: line } : { kind: 'local', text: line })
  for (const line of middleB) {
    if (!common.has(line)) out.push({ kind: 'gist', text: line })
  }
  for (let i = endA; i < a.length; i += 1) out.push({ kind: 'same', text: a[i] as string })
  return out
}
