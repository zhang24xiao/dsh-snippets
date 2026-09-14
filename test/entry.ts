/**
 * Test entry: re-exports the host/shared internals so the Node test harness can
 * reach them through one esbuild bundle instead of compiling TypeScript twice.
 * Not shipped — `files` in package.json excludes `test/`.
 */
export { apply, name } from '../src/host/index.ts'
export { registerRoutes, ROUTE_PREFIX } from '../src/host/routes.ts'
export { reconcile, scanFolder } from '../src/host/file-watch.ts'
export { createBackup, listBackups } from '../src/host/backups.ts'
export { backupsDir, dataDir, dshHome, gistTokenFile, resolveUserPath } from '../src/host/paths.ts'
export { isLoopbackRequest } from '../src/host/http.ts'
export { Config, CONFIG_DEFAULTS, NAMESPACE, decodeConfig } from '../src/shared/schema.ts'
export { planImport, gistFileName, splitGistFileName, parseGistId, safeFileTitle, lineDiff } from '../src/shared/gist.ts'
export {
  createSnippetId,
  createdFromId,
  isValidCssContent,
  isValidJavaScript,
  reindent,
  snippetTitle,
  sortSnippets,
  filterSnippets,
  timestampPrefix,
} from '../src/shared/model.ts'
