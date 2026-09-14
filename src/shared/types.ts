/**
 * The one field contract both halves agree on.
 *
 * Everything the plugin persists lives in the `dsh-snippets` settings
 * namespace, so this file is the single source of truth for its shape: the
 * host half turns it into a schemastery schema, the browser half narrows the
 * wire section back into these types.
 */

/** A snippet is either CSS (injected as a `<style>`) or JS (executed). */
export type SnippetType = 'css' | 'js'

/** One code snippet (`showPublishCheckbox` has no DSH counterpart and is gone). */
export interface Snippet {
  /**
   * Stable identity, `YYYYMMDDHHmmss-xxxxxxx` — the same shape the SiYuan
   * plugin uses, so the first 14 characters are a usable creation timestamp
   * for the `createdASC` / `createdDESC` sorts and for Gist file names.
   */
  id: string
  /** Display title; empty falls back to the first 200 characters of `content`. */
  name: string
  type: SnippetType
  content: string
  /** Whether this snippet is applied to the page. */
  enabled: boolean
  /** Creation time in epoch milliseconds. */
  created: number
}

/** Every sort order offered by the manager panel. */
export const SORT_TYPES = [
  'fixedSort',
  'customSort',
  'enabledASC',
  'enabledDESC',
  'nameASC',
  'nameDESC',
  'nameNatASC',
  'nameNatDESC',
  'createdASC',
  'createdDESC',
] as const

/** One of {@link SORT_TYPES}. */
export type SortType = (typeof SORT_TYPES)[number]

/** `fixedSort` and `customSort` keep the stored order; the rest are derived. */
export const ORDER_PRESERVING_SORTS: readonly SortType[] = ['fixedSort', 'customSort']

/** 0 = search off, 1 = title, 2 = content, 3 = title or content. */
export type SearchMode = 0 | 1 | 2 | 3

/** What clicking a snippet row in the manager does. */
export const ROW_CLICK_ACTIONS = ['none', 'toggle', 'editor'] as const
/** One of {@link ROW_CLICK_ACTIONS}. */
export type RowClickAction = (typeof ROW_CLICK_ACTIONS)[number]

/** Where the sidebar-foot quick toggle sits relative to the other footer actions. */
export type FooterPosition = 'left' | 'right'

/** Editor Tab behaviour: one literal tab, or 1–8 spaces. */
export const INDENT_UNITS = [
  'tab',
  'space1',
  'space2',
  'space3',
  'space4',
  'space5',
  'space6',
  'space7',
  'space8',
] as const
/** One of {@link INDENT_UNITS}. */
export type IndentUnit = (typeof INDENT_UNITS)[number]

/** Snippet-folder watcher mode (SiYuan's `fileWatchEnabled`). */
export type FileWatchMode = 'disabled' | 'watch' | 'loadOnce'

/** How a watched folder reconciles with snippets that did not come from it. */
export type FileWatchMirrorMode = 'merge' | 'overwrite'

/** Gist import strategy (SiYuan's three merge modes). */
export type GistImportMode = 'merge' | 'overwrite' | 'fork'

/** The complete `dsh-snippets` settings section. */
export interface SnippetsConfig {
  /** Master switch for every CSS snippet (SiYuan's `config.snippet.enabledCSS`). */
  cssMasterEnabled: boolean
  /** Master switch for every JS snippet (SiYuan's `config.snippet.enabledJS`). */
  jsMasterEnabled: boolean

  /* ── 通用 · General ─────────────────────────────────────────────── */
  /** Which tab the manager panel opens on. */
  defaultTab: SnippetType
  /** Whether a newly created snippet starts enabled. */
  newSnippetEnabled: boolean
  /** Click behaviour for a snippet row in the manager panel. */
  rowClickAction: RowClickAction
  /** Sort order of the manager list. */
  sortType: SortType
  /** Search scope of the manager search box. */
  searchMode: SearchMode
  /** Side of the sidebar foot the quick toggle is rendered on. */
  footerPosition: FooterPosition

  /* ── 管理菜单 · Manager menu ────────────────────────────────────── */
  /** Show the per-row edit button. */
  showEditButton: boolean
  /** Show the per-row duplicate button. */
  showDuplicateButton: boolean
  /** Show the per-row delete button. */
  showDeleteButton: boolean
  /** Ask before deleting a snippet. */
  confirmDelete: boolean

  /* ── 编辑器 · Editor ───────────────────────────────────────────── */
  /** Apply CSS snippets to the page while they are being edited. */
  realTimePreview: boolean
  /** Tab key indentation unit. */
  editorIndentUnit: IndentUnit
  /** Allow more than one editor dialog at a time. */
  multipleEditors: boolean
  /** Soft-wrap long lines in the editor. */
  editorLineWrap: boolean
  /** Editor font size in px. */
  editorFontSize: number
  /** Re-indent the buffer when saving (best effort; never rewrites line content). */
  formatOnSave: boolean

  /* ── 行为与安全 · Behaviour & safety ───────────────────────────── */
  /** Verbose plugin logging in the browser console. */
  consoleDebug: boolean
  /** Reload the page after a JS snippet is edited, when no editor is open. */
  autoReloadAfterJsEdit: boolean
  /** Show the "JS changes need a reload" notice. */
  reloadNotice: boolean
  /** Set by the notice's "don't show again" action. */
  reloadNoticeSuppressed: boolean
  /** Refuse CSS whose content contains `</style` or `<script`. */
  validateCssContent: boolean
  /** Refuse JS that fails to parse. */
  validateJsSyntax: boolean
  /** Ask for confirmation before enabling a JS snippet. */
  confirmJsExecution: boolean

  /* ── 本地文件监听 · Local folder watch ─────────────────────────── */
  /** Watcher mode: off, poll continuously, or load once at startup. */
  fileWatchMode: FileWatchMode
  /** Folder to mirror; absolute paths and a leading `~` are supported. */
  fileWatchPath: string
  /** Poll interval in seconds. */
  fileWatchIntervalSec: number
  /** `merge` keeps unrelated snippets; `overwrite` makes the folder authoritative. */
  fileWatchMirrorMode: FileWatchMirrorMode
  /** Delete a mirrored snippet when its file disappears. */
  fileWatchDeleteMissing: boolean

  /* ── Gist 同步 · Gist sync ─────────────────────────────────────── */
  /*
   * The GitHub token is NOT part of this section. It lives in the host's own
   * 0600 file (`~/.dsh/dsh-snippets/gist-token.json`) so a secret never
   * travels the settings wire and never lands in a settings backup; the
   * browser only learns whether one is configured, through the plugin's own
   * host API.
   */
  /** URL of the Gist this library was last published to. */
  gistLastPublished: string
  /** URL of the Gist this library was last imported from. */
  gistLastImported: string

  /* ── 内容 · Content ───────────────────────────────────────────── */
  /** Every snippet, in stored (custom) order. */
  snippets: Snippet[]
}

/** A snippet library file, as produced by export and accepted by import. */
export interface SnippetsExportFile {
  /** Format marker so a foreign JSON file can be rejected with a clear message. */
  format: 'dsh-snippets'
  version: 1
  exportedAt: string
  snippets: Snippet[]
}
