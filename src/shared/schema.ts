/**
 * The `dsh-snippets` settings schema, shared by both halves.
 *
 * In DSH 0.1.7 a settings namespace is not registered by the plugin at all: the
 * namespace IS the plugin's own profile entry id, the schema travels with the
 * host entry as a `Config` export, and the host half picks the resolved config
 * up as `apply(ctx, config)`'s second argument. The browser half then reads it
 * through `ctx.configForms.get(entryId)`. Nothing in this file registers
 * anything — it only declares the shape.
 *
 * Every top-level field is `.volatile()`, for two reasons:
 *
 *  - `dsh-settings` serves a namespace only when at least one field is volatile
 *    (`describe()` skips any entry whose `volatileForm(schema)` is `undefined`),
 *    so without volatile fields the card would never reach the settings page.
 *  - A volatile field is the only kind of config a live edit can change WITHOUT
 *    remounting the plugin. The folder watcher and the HTTP routes therefore
 *    survive every settings write instead of being torn down and rebuilt.
 *
 * The price of volatility is that a field resolves to a stable *reference*
 * rather than a value, so the host half receives {@link SettingsRefs} and reads
 * it through {@link readSettings} — once per read, never cached, because the
 * loader updates those references in place.
 *
 * The schema is intentionally flat plus one array: the settings document is
 * rewritten wholesale on every commit, and a flat shape keeps each write small
 * and each diff legible.
 */
import { isVolatile, type Volatile } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'
import {
  INDENT_UNITS,
  ROW_CLICK_ACTIONS,
  SORT_TYPES,
  type SnippetType,
  type SnippetsConfig,
} from './types.ts'

/**
 * The settings namespace.
 *
 * Also the profile entry id the host half is mounted as, and the string the
 * browser half asks `configForms` for. One source of truth: a renamed patch row
 * then fails loudly on both sides instead of silently serving nothing.
 */
export const NAMESPACE = 'dsh-snippets'

/** Shared marker for the snippet id shape (`YYYYMMDDHHmmss-xxxxxxx`). */
const SNIPPET_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/

const snippet = z.object({
  id: z.string().pattern(SNIPPET_ID_PATTERN).description('片段 ID'),
  name: z.string().default('').description('标题'),
  type: z.union([z.const('css'), z.const('js')]).default('css'),
  content: z.string().default('').description('代码内容'),
  enabled: z.boolean().default(true),
  created: z.number().default(0),
})

/**
 * The exported schema.
 *
 * Deliberately left to inference rather than annotated `z<SnippetsConfig>`:
 * schemastery's `default()` narrows `meta.default` for the OPTIONAL-input shape,
 * which an annotation with the resolved output type rejects. {@link CONFIG_DEFAULTS}
 * is where the resolved shape is pinned to {@link SnippetsConfig}.
 *
 * The fields INSIDE a snippet are not volatilised: the whole `snippets` array is
 * a single reference, and a volatile node nested inside another volatile node is
 * exactly what schemastery's volatile-path validation refuses.
 */
export const Config = z.object({
  cssMasterEnabled: z.boolean().default(true).description('启用全部 CSS 片段').volatile(),
  jsMasterEnabled: z.boolean().default(true).description('启用全部 JS 片段').volatile(),

  defaultTab: z.union([z.const('css'), z.const('js')]).default('css').description('默认标签页').volatile(),
  newSnippetEnabled: z.boolean().default(true).description('新建片段时默认启用').volatile(),
  rowClickAction: z
    .union(ROW_CLICK_ACTIONS.map((v) => z.const(v)))
    .default('toggle')
    .description('点击片段行的行为')
    .volatile(),
  sortType: z.union(SORT_TYPES.map((v) => z.const(v))).default('customSort').description('排序方式').volatile(),
  // Written out rather than mapped: a mapped `[0,1,2,3]` widens to `number[]`,
  // which would lose the literal union the resolved type depends on.
  searchMode: z
    .union([z.const(0), z.const(1), z.const(2), z.const(3)])
    .default(1)
    .description('搜索范围')
    .volatile(),
  footerPosition: z.union([z.const('left'), z.const('right')]).default('right').description('快捷开关位置').volatile(),

  showEditButton: z.boolean().default(true).description('显示编辑按钮').volatile(),
  showDuplicateButton: z.boolean().default(false).description('显示副本按钮').volatile(),
  showDeleteButton: z.boolean().default(true).description('显示删除按钮').volatile(),
  confirmDelete: z.boolean().default(true).description('删除前确认').volatile(),

  realTimePreview: z.boolean().default(true).description('CSS 实时预览').volatile(),
  editorIndentUnit: z
    .union(INDENT_UNITS.map((v) => z.const(v)))
    .default('space2')
    .description('编辑器缩进单位')
    .volatile(),
  multipleEditors: z.boolean().default(true).description('允许同时打开多个编辑器').volatile(),
  editorLineWrap: z.boolean().default(false).description('编辑器自动换行').volatile(),
  editorFontSize: z.number().min(10).max(24).step(1).default(13).description('编辑器字号').volatile(),
  formatOnSave: z.boolean().default(false).description('保存时尝试格式化').volatile(),

  consoleDebug: z.boolean().default(false).description('控制台调试日志').volatile(),
  autoReloadAfterJsEdit: z.boolean().default(true).description('JS 改动后自动重载界面').volatile(),
  reloadNotice: z.boolean().default(true).description('显示重载提示').volatile(),
  reloadNoticeSuppressed: z.boolean().default(false).description('不再显示重载提示').volatile(),
  validateCssContent: z.boolean().default(true).description('校验 CSS 内容').volatile(),
  validateJsSyntax: z.boolean().default(true).description('校验 JS 语法').volatile(),
  confirmJsExecution: z.boolean().default(true).description('启用 JS 片段前二次确认').volatile(),

  fileWatchMode: z
    .union([z.const('disabled'), z.const('watch'), z.const('loadOnce')])
    .default('disabled')
    .description('本地文件监听模式')
    .volatile(),
  fileWatchPath: z.string().default('').description('监听文件夹路径').volatile(),
  fileWatchIntervalSec: z.number().min(5).max(300).step(1).default(5).description('监听轮询间隔（秒）').volatile(),
  fileWatchMirrorMode: z
    .union([z.const('merge'), z.const('overwrite')])
    .default('merge')
    .description('文件夹镜像策略')
    .volatile(),
  fileWatchDeleteMissing: z.boolean().default(false).description('文件消失时删除片段').volatile(),

  // The GitHub token deliberately does NOT live here: it stays in the host's
  // own 0600 file (~/.dsh/dsh-snippets/gist-token.json) so a secret never
  // travels the settings wire, never lands in a settings backup, and the
  // browser only ever learns whether one is configured.
  gistLastPublished: z.string().default('').description('上次发布的 Gist').volatile(),
  gistLastImported: z.string().default('').description('上次导入的 Gist').volatile(),

  snippets: z.array(snippet).default([]).description('代码片段列表').volatile(),
})

/**
 * The config tree as `apply(ctx, config)` receives it.
 *
 * A volatile schema resolves to one stable reference per field; the reference
 * keeps its identity while the loader swaps the value underneath it.
 */
export type SettingsRefs = { [K in keyof SnippetsConfig]: Volatile<SnippetsConfig[K]> }

/**
 * Deep-copy a resolved config section into ordinary mutable JSON.
 *
 * Mirrors `dsh-settings`' own `plainConfig` exactly, including the part that
 * matters here: arrays and objects are always freshly allocated, so the result
 * is mutable even though a reference's `get()` snapshot is deeply frozen.
 */
function plainValue(value: unknown): unknown {
  if (isVolatile(value)) return plainValue(value.get())
  if (Array.isArray(value)) return value.map(plainValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainValue(child)]))
  }
  return value
}

/**
 * Read the current config as plain data.
 *
 * Call this once per read instead of caching the result: the caller's
 * `SettingsRefs` object stays live for the life of the mount, and only the
 * values behind it change.
 */
export function readSettings(config: SettingsRefs): SnippetsConfig {
  return plainValue(config) as SnippetsConfig
}

/**
 * The schema's default object, used as the browser half's fallback before the
 * first commit arrives.
 *
 * Annotated, so any drift between the schema and {@link SnippetsConfig} is a
 * type error here rather than a surprise at runtime.
 */
export const CONFIG_DEFAULTS: SnippetsConfig = readSettings(Config({}))

/**
 * Narrow an unknown wire section into {@link SnippetsConfig}, or `undefined`.
 *
 * A section that cannot be evaluated is treated as absent rather than fatal:
 * this runs inside a render path, where throwing would take the page down
 * instead of falling back to the last good value.
 */
export function decodeConfig(section: unknown): SnippetsConfig | undefined {
  if (typeof section !== 'object' || section === null) return undefined
  try {
    const resolved = readSettings(Config(section as Record<string, unknown>))
    if (!Array.isArray(resolved.snippets)) return undefined
    return resolved
  } catch {
    return undefined
  }
}

/** True when this value is a syntactically acceptable snippet type. */
export function isSnippetType(value: unknown): value is SnippetType {
  return value === 'css' || value === 'js'
}
