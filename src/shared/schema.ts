/**
 * The `dsh-snippets` settings schema.
 *
 * Registered by the HOST half through `ctx.settings.register(...)`, which makes
 * the namespace durable (it lands in the profile's settings document) and makes
 * it visible to the browser half through the official `settings.describe` wire.
 * Every field carries a default, so an absent user section resolves to the
 * documented out-of-the-box behaviour and "reset to default" is simply
 * `replace({})` on the host side or `unset` per field on the browser side.
 *
 * The schema is intentionally flat plus one array: the settings document is
 * rewritten wholesale on every commit, and a flat shape keeps each write small
 * and each diff legible.
 */
import z from 'schemastery'
import {
  INDENT_UNITS,
  ROW_CLICK_ACTIONS,
  SORT_TYPES,
  type SnippetType,
  type SnippetsConfig,
} from './types.ts'

/** The namespace this plugin owns; the browser half binds the same string. */
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
 * The registered schema.
 *
 * Deliberately left to inference rather than annotated `z<SnippetsConfig>`:
 * schemastery's `default()` narrows `meta.default` for the OPTIONAL-input shape,
 * which an annotation with the resolved output type rejects. `CONFIG_DEFAULTS`
 * below is where the resolved shape is pinned to {@link SnippetsConfig}.
 */
export const Config = z.object({
  cssMasterEnabled: z.boolean().default(true).description('启用全部 CSS 片段'),
  jsMasterEnabled: z.boolean().default(true).description('启用全部 JS 片段'),

  defaultTab: z.union([z.const('css'), z.const('js')]).default('css').description('默认标签页'),
  newSnippetEnabled: z.boolean().default(true).description('新建片段时默认启用'),
  rowClickAction: z.union(ROW_CLICK_ACTIONS.map((v) => z.const(v))).default('toggle').description('点击片段行的行为'),
  sortType: z.union(SORT_TYPES.map((v) => z.const(v))).default('customSort').description('排序方式'),
  // Written out rather than mapped: a mapped `[0,1,2,3]` widens to `number[]`,
  // which would lose the literal union the resolved type depends on.
  searchMode: z
    .union([z.const(0), z.const(1), z.const(2), z.const(3)])
    .default(1)
    .description('搜索范围'),
  footerPosition: z.union([z.const('left'), z.const('right')]).default('right').description('快捷开关位置'),

  showEditButton: z.boolean().default(true).description('显示编辑按钮'),
  showDuplicateButton: z.boolean().default(false).description('显示副本按钮'),
  showDeleteButton: z.boolean().default(true).description('显示删除按钮'),
  confirmDelete: z.boolean().default(true).description('删除前确认'),

  realTimePreview: z.boolean().default(true).description('CSS 实时预览'),
  editorIndentUnit: z.union(INDENT_UNITS.map((v) => z.const(v))).default('space2').description('编辑器缩进单位'),
  multipleEditors: z.boolean().default(true).description('允许同时打开多个编辑器'),
  editorLineWrap: z.boolean().default(false).description('编辑器自动换行'),
  editorFontSize: z.number().min(10).max(24).step(1).default(13).description('编辑器字号'),
  formatOnSave: z.boolean().default(false).description('保存时尝试格式化'),

  consoleDebug: z.boolean().default(false).description('控制台调试日志'),
  autoReloadAfterJsEdit: z.boolean().default(true).description('JS 改动后自动重载界面'),
  reloadNotice: z.boolean().default(true).description('显示重载提示'),
  reloadNoticeSuppressed: z.boolean().default(false).description('不再显示重载提示'),
  validateCssContent: z.boolean().default(true).description('校验 CSS 内容'),
  validateJsSyntax: z.boolean().default(true).description('校验 JS 语法'),
  confirmJsExecution: z.boolean().default(true).description('启用 JS 片段前二次确认'),

  fileWatchMode: z
    .union([z.const('disabled'), z.const('watch'), z.const('loadOnce')])
    .default('disabled')
    .description('本地文件监听模式'),
  fileWatchPath: z.string().default('').description('监听文件夹路径'),
  fileWatchIntervalSec: z.number().min(5).max(300).step(1).default(5).description('监听轮询间隔（秒）'),
  fileWatchMirrorMode: z
    .union([z.const('merge'), z.const('overwrite')])
    .default('merge')
    .description('文件夹镜像策略'),
  fileWatchDeleteMissing: z.boolean().default(false).description('文件消失时删除片段'),

  // The GitHub token deliberately does NOT live here: it stays in the host's
  // own 0600 file (~/.dsh/dsh-snippets/gist-token.json) so a secret never
  // travels the settings wire, never lands in a settings backup, and the
  // browser only ever learns whether one is configured.
  gistLastPublished: z.string().default('').description('上次发布的 Gist'),
  gistLastImported: z.string().default('').description('上次导入的 Gist'),

  snippets: z.array(snippet).default([]).description('代码片段列表'),
})

/**
 * The schema's default object, used as the composition `base` layer.
 *
 * Annotated, so any drift between the schema and {@link SnippetsConfig} is a
 * type error here rather than a surprise at runtime.
 */
export const CONFIG_DEFAULTS: SnippetsConfig = Config({}) as SnippetsConfig

/** Narrow an unknown wire section into {@link SnippetsConfig}, or `undefined`. */
export function decodeConfig(section: unknown): SnippetsConfig | undefined {
  if (typeof section !== 'object' || section === null) return undefined
  const resolved = Config(section as Record<string, unknown>) as unknown as SnippetsConfig
  if (!Array.isArray(resolved.snippets)) return undefined
  return resolved
}

/** True when this value is a syntactically acceptable snippet type. */
export function isSnippetType(value: unknown): value is SnippetType {
  return value === 'css' || value === 'js'
}
