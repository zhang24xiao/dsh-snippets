/**
 * Snippet domain logic shared by both halves.
 *
 * The browser uses it for the manager panel and the settings page; the host
 * uses it for the folder watcher and the Gist bridge. Keeping it here means a
 * file mirrored from disk and a snippet typed into the panel are validated,
 * sorted and titled by exactly the same rules.
 */
import {
  ORDER_PRESERVING_SORTS,
  type SearchMode,
  type Snippet,
  type SnippetType,
  type SortType,
} from './types.ts'

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Two-digit zero pad. */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** `YYYYMMDDHHmmss` in local time — the id's timestamp prefix. */
export function timestampPrefix(epochMs: number): string {
  const d = new Date(epochMs)
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  )
}

/**
 * Mint a snippet id: `YYYYMMDDHHmmss-xxxxxxx`.
 *
 * The 14-character timestamp prefix is why the id is not an opaque uuid — the
 * `createdASC` / `createdDESC` sorts read it, and Gist file names carry it so
 * an import can match snippets by identity.
 */
export function createSnippetId(now: number = Date.now(), random: () => number = Math.random): string {
  let suffix = ''
  for (let i = 0; i < 7; i += 1) {
    suffix += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)] ?? '0'
  }
  return `${timestampPrefix(now)}-${suffix}`
}

/** True when `value` has the snippet id shape. */
export function isSnippetId(value: string): boolean {
  return /^\d{14}-[a-z0-9]{7}$/.test(value)
}

/** The creation time encoded in an id's timestamp prefix. */
export function createdFromId(id: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-/.exec(id)
  if (m === null) return 0
  const [, y, mo, d, h, mi, s] = m
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  ).getTime()
}

/** Display title: the name, or the first 200 characters of the content. */
export function snippetTitle(snippet: Snippet): string {
  const name = snippet.name.trim()
  if (name !== '') return name
  const content = snippet.content.trim()
  if (content === '') return ''
  return content.slice(0, 200)
}

/**
 * Whether CSS content is acceptable.
 *
 * Mirrors the SiYuan kernel's own guard: `</style` or `<script` inside a CSS
 * snippet would break out of the injected `<style>` element, so it is refused
 * before it can reach the page.
 */
export function isValidCssContent(content: string): boolean {
  const lower = content.toLowerCase()
  return !lower.includes('</style') && !lower.includes('<script')
}

/**
 * Whether JS content parses.
 *
 * Parsing (not executing) is the check: `new Function` compiles synchronously
 * and throws a `SyntaxError` without running a single statement. The SiYuan
 * original additionally rejects bodies whose only statement is a no-op
 * expression; that needs a full AST parser, which is not worth the bundle
 * weight here, so a syntactically valid no-op is simply allowed.
 */
export function isValidJavaScript(content: string): boolean {
  const code = content.trim()
  if (code === '') return false
  try {
    // eslint-disable-next-line no-new-func
    new Function(code)
    return true
  } catch {
    return false
  }
}

/** Validate one snippet's content for its type; returns an error code or `null`. */
export function validateContent(type: SnippetType, content: string): 'empty' | 'invalid-css' | 'invalid-js' | null {
  if (content.trim() === '') return 'empty'
  if (type === 'css') return isValidCssContent(content) ? null : 'invalid-css'
  return isValidJavaScript(content) ? null : 'invalid-js'
}

/**
 * Sort a snippet list for display.
 *
 * `fixedSort` and `customSort` return the input order untouched (the stored
 * order IS the custom order, so a drag reorder writes back to it); everything
 * else sorts a copy so the stored order is never disturbed by a view choice.
 */
export function sortSnippets(list: readonly Snippet[], sortType: SortType): Snippet[] {
  if (ORDER_PRESERVING_SORTS.includes(sortType)) return [...list]

  const comparators: Record<string, (a: Snippet, b: Snippet) => number> = {
    enabledASC: (a, b) => Number(b.enabled) - Number(a.enabled),
    enabledDESC: (a, b) => Number(a.enabled) - Number(b.enabled),
    nameASC: (a, b) => snippetTitle(a).localeCompare(snippetTitle(b)),
    nameDESC: (a, b) => snippetTitle(b).localeCompare(snippetTitle(a)),
    nameNatASC: (a, b) => snippetTitle(a).localeCompare(snippetTitle(b), undefined, { numeric: true }),
    nameNatDESC: (a, b) => snippetTitle(b).localeCompare(snippetTitle(a), undefined, { numeric: true }),
    createdASC: (a, b) => a.created - b.created,
    createdDESC: (a, b) => b.created - a.created,
  }
  const comparator = comparators[sortType]
  if (comparator === undefined) return [...list]
  return [...list].sort(comparator)
}

/** Filter by the configured search scope, case-insensitively. */
export function filterSnippets(
  list: readonly Snippet[],
  searchMode: SearchMode,
  keyword: string,
): Snippet[] {
  const needle = keyword.trim().toLowerCase()
  if (searchMode === 0 || needle === '') return [...list]
  return list.filter((snippet) => {
    const name = snippetTitle(snippet).toLowerCase()
    const content = snippet.content.toLowerCase()
    if (searchMode === 1) return name.includes(needle)
    if (searchMode === 2) return content.includes(needle)
    return name.includes(needle) || content.includes(needle)
  })
}

/** JSON export file name, e.g. `dsh-snippets-20260914-1200.json`. */
export function exportFileName(now: number = Date.now()): string {
  const d = new Date(now)
  return `dsh-snippets-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}.json`
}

/** `YYYYMMDD-HHmmss`, used for backup file names. */
export function backupFileName(now: number = Date.now()): string {
  const d = new Date(now)
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  )
}

/**
 * Best-effort re-indentation.
 *
 * Only a line's LEADING whitespace is ever rewritten — the line's content is
 * returned byte-for-byte — which is what makes this safe to run on save. The
 * scanner tracks quotes, template literals and block comments so a line inside
 * one of those keeps its original indentation, and bracket depth from `{`,
 * `}`, `[`, `]`, `(`, `)` drives the new one. `ok: false` means the scanner
 * saw something it refused to touch (an unterminated string or comment), and
 * the caller should leave the buffer alone.
 */
export function reindent(content: string, unit: string): { ok: boolean; content: string } {
  const lines = content.split('\n')
  const out: string[] = []
  let depth = 0
  let inBlockComment = false
  let inTemplate = false
  let inSingle = false
  let inDouble = false

  for (const line of lines) {
    const held = inBlockComment || inTemplate || inSingle || inDouble

    if (held) {
      // Inside a string, template literal, or block comment the leading
      // whitespace is CONTENT, so the line is passed through byte-for-byte and
      // no depth is counted while the construct stays open.
      out.push(line)
      const carried = scanLine(line, {
        inBlockComment,
        inTemplate,
        inSingle,
        inDouble,
        countDepth: false,
      })
      inBlockComment = carried.inBlockComment
      inTemplate = carried.inTemplate
      inSingle = carried.inSingle
      inDouble = carried.inDouble
      continue
    }

    const leading = /^[ \t]*/.exec(line)?.[0] ?? ''
    const trimmed = line.slice(leading.length)
    if (trimmed === '') {
      out.push('')
    } else {
      // A line that starts by closing a bracket belongs one level out.
      const closingFirst = /^[}\])]/.test(trimmed)
      out.push(unit.repeat(Math.max(0, closingFirst ? depth - 1 : depth)) + trimmed)
    }

    const scan = scanLine(trimmed, {
      inBlockComment,
      inTemplate,
      inSingle,
      inDouble,
      countDepth: true,
    })
    inBlockComment = scan.inBlockComment
    inTemplate = scan.inTemplate
    inSingle = scan.inSingle
    inDouble = scan.inDouble
    depth = Math.max(0, depth + scan.delta)
  }

  if (inBlockComment || inTemplate || inSingle || inDouble) return { ok: false, content }
  // A snippet whose depth did not return to zero has an unbalanced bracket the
  // formatter cannot reason about; refusing is safer than guessing.
  if (depth !== 0) return { ok: false, content }
  return { ok: true, content: out.join('\n') }
}

interface ScanState {
  inBlockComment: boolean
  inTemplate: boolean
  inSingle: boolean
  inDouble: boolean
  countDepth: boolean
}

/** Walk one line, returning the carried scanner state and the depth delta. */
function scanLine(line: string, state: ScanState): ScanState & { delta: number } {
  let { inBlockComment, inTemplate, inSingle, inDouble } = state
  let delta = 0
  let escaped = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] as string
    const next = line[i + 1]

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i += 1
      }
      continue
    }
    if (escaped) {
      escaped = false
      continue
    }
    if (inSingle) {
      if (ch === '\\') escaped = true
      else if (ch === "'") inSingle = false
      continue
    }
    if (inDouble) {
      if (ch === '\\') escaped = true
      else if (ch === '"') inDouble = false
      continue
    }
    if (inTemplate) {
      if (ch === '\\') escaped = true
      else if (ch === '`') inTemplate = false
      continue
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true
      i += 1
      continue
    }
    if (ch === '/' && next === '/') break
    if (ch === "'") {
      inSingle = true
      continue
    }
    if (ch === '"') {
      inDouble = true
      continue
    }
    if (ch === '`') {
      inTemplate = true
      continue
    }
    if (state.countDepth) {
      if (ch === '{' || ch === '[' || ch === '(') delta += 1
      else if (ch === '}' || ch === ']' || ch === ')') delta -= 1
    }
  }

  return { inBlockComment, inTemplate, inSingle, inDouble, countDepth: state.countDepth, delta }
}

/** Indentation unit in spaces, for the editor's Tab handler. */
export function indentUnitWidth(unit: string): { tabs: boolean; width: number } {
  if (unit === 'tab') return { tabs: true, width: 1 }
  const match = /^space(\d)$/.exec(unit)
  return { tabs: false, width: match === null ? 2 : Number(match[1]) }
}
