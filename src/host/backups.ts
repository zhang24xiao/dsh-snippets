/**
 * Backups of the snippet library, taken before anything destructive.
 *
 * A backup is a plain `SnippetsExportFile` JSON under
 * `$DSH_HOME/dsh-snippets/backups/`, written by a temp-file-then-rename so a
 * crash mid-write can never leave a half file where a backup should be. The
 * same files are re-importable through the normal import path, which is the
 * point: a user who overwrites their library can always get it back.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { backupFileName } from '../shared/model.ts'
import type { Snippet, SnippetsExportFile } from '../shared/types.ts'
import { backupsDir } from './paths.ts'

/** One backup file as shown in the settings page. */
export interface BackupEntry {
  /** File name, e.g. `20260914-120000.json`. */
  name: string
  /** Absolute path. */
  path: string
  /** Size in bytes. */
  size: number
  /** Last modification time in epoch milliseconds. */
  mtime: number
  /** How many snippets the file holds, when it could be read. */
  count: number
}

/** Ensure a directory exists. */
async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

/**
 * Write one backup of `snippets`.
 * @param snippets - the library as it stands before the destructive action.
 * @param reason - short machine token recorded inside the file (`overwrite-import`, `gist-import`, …).
 * @returns the absolute path written and the snippet count.
 */
export async function createBackup(
  snippets: readonly Snippet[],
  reason: string,
): Promise<{ path: string; count: number }> {
  const dir = backupsDir()
  await ensureDir(dir)
  const payload = {
    format: 'dsh-snippets',
    version: 1,
    exportedAt: new Date().toISOString(),
    reason,
    snippets: [...snippets],
  } satisfies SnippetsExportFile & { reason: string }
  const target = join(dir, `${backupFileName()}.json`)
  const temp = `${target}.tmp`
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await rename(temp, target)
  return { path: target, count: snippets.length }
}

/** List every backup, newest first. */
export async function listBackups(): Promise<BackupEntry[]> {
  const dir = backupsDir()
  if (!existsSync(dir)) return []
  const names = await readdir(dir)
  const entries: BackupEntry[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const path = join(dir, name)
    try {
      const info = await stat(path)
      let count = 0
      try {
        const parsed = JSON.parse(await readFile(path, 'utf8')) as { snippets?: unknown }
        count = Array.isArray(parsed.snippets) ? parsed.snippets.length : 0
      } catch {
        // A file we cannot parse still belongs in the listing; the count is
        // simply unknown, which is more useful than hiding it.
        count = 0
      }
      entries.push({ name, path, size: info.size, mtime: info.mtimeMs, count })
    } catch {
      // Skip entries that vanished between readdir and stat.
    }
  }
  return entries.sort((a, b) => b.mtime - a.mtime)
}

/**
 * Open the backups directory in the OS file manager.
 * Desktop-only by nature: a headless host has nothing to open and reports
 * `no-opener`, which the settings page turns into a copyable path instead.
 */
export async function openBackupsFolder(): Promise<{ path: string; opened: boolean }> {
  const dir = backupsDir()
  await ensureDir(dir)
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  return await new Promise((resolvePromise) => {
    try {
      const child = spawn(command, [dir], { detached: true, stdio: 'ignore' })
      child.on('error', () => { resolvePromise({ path: dir, opened: false }) })
      child.unref()
      resolvePromise({ path: dir, opened: true })
    } catch {
      resolvePromise({ path: dir, opened: false })
    }
  })
}
