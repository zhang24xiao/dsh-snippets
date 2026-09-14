/**
 * Host-side path resolution.
 *
 * Everything this plugin writes outside the settings document lives under
 * `$DSH_HOME/dsh-snippets/`:
 *
 *   dsh-snippets/
 *   ├── gist-token.json     0600, the GitHub token (never on the settings wire)
 *   ├── watch-map.json      folder path → snippet id, so re-scans stay stable
 *   └── backups/            one JSON file per destructive import
 *
 * `DSH_HOME` wins when set (the same rule the rest of the DSH family uses);
 * otherwise it is `~/.dsh`.
 */
import { homedir } from 'node:os'
import { isAbsolute, join, posix, win32 } from 'node:path'

/** Expand a leading `~` or `~/` against a home directory, platform-style. */
export function expandHome(input: string, home: string = homedir()): string {
  const isPosixHome = home.startsWith('/')
  const j = isPosixHome ? posix.join : win32.join
  if (input === '~') return home
  if (input.startsWith('~/') || input.startsWith('~\\')) return j(home, input.slice(2))
  return input
}

/** Resolve the DSH home directory from the live environment. */
export function dshHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const raw = env.DSH_HOME
  if (raw !== undefined && raw.trim() !== '') {
    const expanded = expandHome(raw.trim(), home)
    const isPosixHome = home.startsWith('/')
    const isAbs = isPosixHome ? isAbsolute : isAbsolute
    return isAbs(expanded) ? expanded : join(process.cwd(), expanded)
  }
  return join(home, '.dsh')
}

/** `$DSH_HOME/dsh-snippets` — this plugin's private data directory. */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(dshHome(env), 'dsh-snippets')
}

/** Where destructive imports park a copy of the previous library. */
export function backupsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(dataDir(env), 'backups')
}

/** The 0600 file holding the GitHub token. */
export function gistTokenFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(dataDir(env), 'gist-token.json')
}

/** The folder-path → snippet-id memory that keeps folder scans idempotent. */
export function watchMapFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(dataDir(env), 'watch-map.json')
}

/**
 * Turn user input for the watched folder into an absolute path.
 * Unlike the SiYuan original, a DSH host is a plain Node process, so absolute
 * paths are supported and `~` is expanded.
 */
export function resolveUserPath(input: string, env: NodeJS.ProcessEnv = process.env): string {
  const trimmed = input.trim()
  if (trimmed === '') return ''
  const expanded = expandHome(trimmed)
  return isAbsolute(expanded) ? expanded : join(process.cwd(), expanded)
}
