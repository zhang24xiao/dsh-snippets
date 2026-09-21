/**
 * The settings body: every preference, grouped the way the SiYuan original's
 * dialog groups them.
 *
 * Rendered inside this plugin's page in the **Settings** navigation
 * (`SettingsPage`, seat `settings.section`). The page owns the heading and the
 * description, so this body opens straight into the groups.
 *
 * Every preference the SiYuan original exposes has a home here, minus the three
 * that describe features DSH does not have (see `docs/DESIGN.md`).
 *
 * Each control writes straight through the controller, so a change is durable
 * the moment it is made and the body needs no Save button. Neighbouring settings
 * pages stage their edits behind Save / Discard instead; this one deliberately
 * does not, because a snippet manager is used by toggling things and watching
 * the page react, and a staging layer would put a Save between the two.
 *
 * Host-backed controls (the folder watch, the backups folder, Gist sync) are
 * gated on `useHostStatus`: the host answers loopback peers only, so on a LAN
 * or tunneled page those two groups explain themselves and disable rather than
 * failing on click.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconDownloadOutline16,
  IconFolderOpenOutline16,
  IconRefreshOutline16,
  IconRightUpOutline16,
  IconTrashOutline16,
  Switch,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { createSnippetId, exportFileName } from '../../shared/model.ts'
import { INDENT_UNITS, ROW_CLICK_ACTIONS, SORT_TYPES, type Snippet } from '../../shared/types.ts'
import * as host from '../host-api.ts'
import { NAMESPACE } from '../../shared/schema.ts'
import type { SnippetsController } from '../controller.ts'
import { PREFIX } from '../styles.ts'
import { GistImportDialog, GistPublishDialog } from './GistDialogs.tsx'
import { useConfig, useFailureToast, useHostStatus, type T } from './shared.tsx'

const REPOSITORY = 'https://github.com/zhang24xiao/dsh-snippets'

/** Props for {@link SettingsPage}. */
export interface SettingsBodyProps {
  controller: SnippetsController
  t: T
}

/** One label + description + control row. */
function Field({
  label,
  desc,
  disabled,
  stacked,
  children,
}: {
  label: string
  desc?: string
  disabled?: boolean
  stacked?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`${PREFIX}-field${stacked === true ? ` ${PREFIX}-field-stack` : ''}`}>
      <div className={`${PREFIX}-field-text`}>
        <div className={`${PREFIX}-field-label`} data-disabled={disabled === true ? 'true' : undefined}>
          {label}
        </div>
        {desc === undefined ? null : <div className={`${PREFIX}-field-desc`}>{desc}</div>}
      </div>
      <div className={`${PREFIX}-field-control`}>{children}</div>
    </div>
  )
}

/** One titled card of rows. */
function Group({
  title,
  danger,
  children,
}: {
  title: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <section className={`${PREFIX}-group${danger === true ? ` ${PREFIX}-danger` : ''}`}>
      <h3 className={`${PREFIX}-group-title`}>{title}</h3>
      <div className={`${PREFIX}-group-body`}>{children}</div>
    </section>
  )
}

/** A native select bound to one boolean/config field. */
function Select<T extends string | number>({
  value,
  options,
  disabled,
  label,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  disabled?: boolean
  label: string
  onChange: (next: T) => void
}) {
  return (
    <select
      className={`${PREFIX}-select`}
      value={String(value)}
      aria-label={label}
      disabled={disabled === true}
      onChange={(event) => {
        const raw = event.target.value
        const found = options.find((option) => String(option.value) === raw)
        if (found !== undefined) onChange(found.value)
      }}
    >
      {options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/** A switch row bound to one boolean field. */
function SwitchField({
  label,
  desc,
  checked,
  disabled,
  onChange,
}: {
  label: string
  desc?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <Field label={label} {...(desc === undefined ? {} : { desc })} disabled={disabled} >
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </Field>
  )
}

/**
 * Render the Code Snippets settings body.
 * @param props - see {@link SettingsBodyProps}.
 */
export function SettingsBody({ controller, t }: SettingsBodyProps) {
  const config = useConfig(controller)
  const hostState = useHostStatus()
  const failure = useFailureToast(controller, t)
  const removeSnippet = useRef<HTMLInputElement>(null)
  const replaceFile = useRef<HTMLInputElement>(null)
  const [scanNote, setScanNote] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showPublish, setShowPublish] = useState(false)

  const set = useCallback(
    (patch: Record<string, unknown>) => {
      void controller.patch(patch).catch(failure)
    },
    [controller, failure],
  )

  const hostReady = hostState.status !== null
  const counts = useMemo(() => {
    let css = 0
    let js = 0
    for (const snippet of config.snippets) {
      if (snippet.type === 'css') css += 1
      else js += 1
    }
    return { css, js, total: config.snippets.length }
  }, [config.snippets])

  /* ── data operations ────────────────────────────────────────────── */

  const exportAll = useCallback(() => {
    const payload = {
      format: 'dsh-snippets',
      version: 1,
      exportedAt: new Date().toISOString(),
      snippets: config.snippets,
    }
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = exportFileName()
    anchor.click()
    URL.revokeObjectURL(url)
    controller.toast(t('notice.exported', { count: config.snippets.length }))
  }, [config.snippets, controller, t])

  const readImportFile = useCallback(
    async (file: File): Promise<Snippet[] | null> => {
      try {
        const text = await file.text()
        const parsed: unknown = JSON.parse(text)
        if (typeof parsed !== 'object' || parsed === null) throw new Error('shape')
        const record = parsed as { format?: unknown; snippets?: unknown }
        if (record.format !== 'dsh-snippets' || !Array.isArray(record.snippets)) throw new Error('format')
        return record.snippets as Snippet[]
      } catch {
        controller.toast(t('notice.importInvalid'))
        return null
      }
    },
    [controller, t],
  )

  const importAppend = useCallback(
    async (file: File) => {
      const incoming = await readImportFile(file)
      if (incoming === null) return
      const taken = new Set(config.snippets.map((snippet) => snippet.id))
      let added = 0
      const merged = [...config.snippets]
      for (const snippet of incoming) {
        const id = taken.has(snippet.id) ? createSnippetId() : snippet.id
        taken.add(id)
        merged.push({ ...snippet, id })
        added += 1
      }
      await controller.replaceSnippets(merged)
      controller.toast(t('notice.importAppended', { count: added }))
    },
    [config.snippets, controller, readImportFile, t],
  )

  const importOverwrite = useCallback(
    async (file: File) => {
      const incoming = await readImportFile(file)
      if (incoming === null) return
      const accepted = await controller.confirm({
        title: t('confirm.importOverwrite.title'),
        body: t('confirm.importOverwrite.body', { current: config.snippets.length, incoming: incoming.length }),
        confirmLabel: t('action.importOverwrite'),
        cancelLabel: t('action.cancel'),
        tone: 'danger',
      })
      if (!accepted) return
      if (hostReady) {
        try {
          const backup = await host.createBackup(config.snippets, 'overwrite-import')
          controller.log('backup written', backup.path)
        } catch (cause) {
          failure(cause)
          return
        }
      }
      await controller.replaceSnippets(incoming)
      controller.toast(t('notice.imported', { added: incoming.length, updated: 0 }))
    },
    [config.snippets, controller, failure, hostReady, readImportFile, t],
  )

  const openBackups = useCallback(() => {
    void (async () => {
      try {
        const result = await host.openBackups()
        if (result.opened) {
          controller.toast(t('notice.backupsOpened'))
          return
        }
        await navigator.clipboard.writeText(result.path)
        controller.toast(t('notice.backupsOpenFailed'))
      } catch (cause) {
        failure(cause)
      }
    })()
  }, [controller, failure, t])

  const rescan = useCallback(() => {
    void (async () => {
      try {
        const result = await host.rescanFolder()
        setScanNote(
          result.changed
            ? t('watch.status.scanned', { added: result.added, updated: result.updated, removed: result.removed })
            : t('watch.status.unchanged'),
        )
        hostState.refresh()
      } catch (cause) {
        failure(cause)
      }
    })()
  }, [failure, hostState, t])

  const resetPrefs = useCallback(() => {
    void (async () => {
      // Every preference re-inherits its schema default; `snippets` is
      // deliberately kept, which is the whole difference from `clearAll`.
      await controller.resetPreferences()
      controller.toast(t('notice.prefsReset'))
    })()
  }, [controller, t])

  const clearAll = useCallback(() => {
    void (async () => {
      const accepted = await controller.confirm({
        title: t('confirm.clear.title'),
        body: t('confirm.clear.body', { count: config.snippets.length }),
        confirmLabel: t('action.clearAll'),
        cancelLabel: t('action.cancel'),
        tone: 'danger',
      })
      if (!accepted) return
      if (hostReady && config.snippets.length > 0) {
        try {
          await host.createBackup(config.snippets, 'clear-all')
        } catch {
          // A failed backup must not block the deletion the user asked for.
        }
      }
      await controller.replaceSnippets([])
      controller.toast(t('notice.cleared'))
    })()
  }, [config.snippets, controller, hostReady, t])

  /* ── render ─────────────────────────────────────────────────────── */

  const watch = hostState.status?.watch

  return (
    <div className={`${PREFIX}-page`}>
      {hostState.loading ? null : hostReady ? null : (
        <div className={`${PREFIX}-hint`} data-tone="warn">
          <b>{t('host.loopbackOnly')}</b>
          <br />
          {t('host.loopbackOnly.desc')}
        </div>
      )}

      <Group title={t('group.general')}>
        <Field label={t('set.defaultTab')} desc={t('set.defaultTab.desc')}>
          <Select
            label={t('set.defaultTab')}
            value={config.defaultTab}
            onChange={(next) => { set({ defaultTab: next }) }}
            options={[
              { value: 'css', label: t('tab.css') },
              { value: 'js', label: t('tab.js') },
            ]}
          />
        </Field>
        <SwitchField
          label={t('set.newSnippetEnabled')}
          desc={t('set.newSnippetEnabled.desc')}
          checked={config.newSnippetEnabled}
          onChange={(next) => { set({ newSnippetEnabled: next }) }}
        />
        <Field label={t('set.rowClickAction')} desc={t('set.rowClickAction.desc')}>
          <Select
            label={t('set.rowClickAction')}
            value={config.rowClickAction}
            onChange={(next) => { set({ rowClickAction: next }) }}
            options={ROW_CLICK_ACTIONS.map((value) => ({
              value,
              label: t(`set.rowClickAction.${value}` as never),
            }))}
          />
        </Field>
        <Field label={t('set.sortType')} desc={t('set.sortType.desc')}>
          <Select
            label={t('set.sortType')}
            value={config.sortType}
            onChange={(next) => { set({ sortType: next }) }}
            options={SORT_TYPES.map((value) => ({ value, label: t(`set.sort.${value}` as never) }))}
          />
        </Field>
        <Field label={t('set.searchMode')} desc={t('set.searchMode.desc')}>
          <Select
            label={t('set.searchMode')}
            value={config.searchMode}
            onChange={(next) => { set({ searchMode: next }) }}
            options={([0, 1, 2, 3] as const).map((value) => ({
              value,
              label: t(`set.searchMode.${String(value)}` as never),
            }))}
          />
        </Field>
        <Field label={t('set.footerPosition')} desc={t('set.footerPosition.desc')}>
          <Select
            label={t('set.footerPosition')}
            value={config.footerPosition}
            onChange={(next) => { set({ footerPosition: next }) }}
            options={[
              { value: 'left', label: t('set.footerPosition.left') },
              { value: 'right', label: t('set.footerPosition.right') },
            ]}
          />
        </Field>
      </Group>

      <Group title={t('group.menu')}>
        <SwitchField
          label={t('set.showEditButton')}
          desc={t('set.showEditButton.desc')}
          checked={config.showEditButton}
          onChange={(next) => { set({ showEditButton: next }) }}
        />
        <SwitchField
          label={t('set.showDuplicateButton')}
          desc={t('set.showDuplicateButton.desc')}
          checked={config.showDuplicateButton}
          onChange={(next) => { set({ showDuplicateButton: next }) }}
        />
        <SwitchField
          label={t('set.showDeleteButton')}
          desc={t('set.showDeleteButton.desc')}
          checked={config.showDeleteButton}
          onChange={(next) => { set({ showDeleteButton: next }) }}
        />
        <SwitchField
          label={t('set.confirmDelete')}
          desc={t('set.confirmDelete.desc')}
          checked={config.confirmDelete}
          onChange={(next) => { set({ confirmDelete: next }) }}
        />
      </Group>

      <Group title={t('group.editor')}>
        <SwitchField
          label={t('set.realTimePreview')}
          desc={t('set.realTimePreview.desc')}
          checked={config.realTimePreview}
          onChange={(next) => { set({ realTimePreview: next }) }}
        />
        <Field label={t('set.editorIndentUnit')} desc={t('set.editorIndentUnit.desc')}>
          <Select
            label={t('set.editorIndentUnit')}
            value={config.editorIndentUnit}
            onChange={(next) => { set({ editorIndentUnit: next }) }}
            options={INDENT_UNITS.map((value) => ({ value, label: t(`set.indent.${value}` as never) }))}
          />
        </Field>
        <Field label={t('set.editorFontSize')} desc={t('set.editorFontSize.desc')}>
          <span className={`${PREFIX}-range-row`}>
            <input
              type="range"
              min={10}
              max={24}
              step={1}
              value={config.editorFontSize}
              aria-label={t('set.editorFontSize')}
              onChange={(event) => { set({ editorFontSize: Number(event.target.value) }) }}
            />
            <span className={`${PREFIX}-range-value`}>{config.editorFontSize} px</span>
          </span>
        </Field>
        <SwitchField
          label={t('set.editorLineWrap')}
          desc={t('set.editorLineWrap.desc')}
          checked={config.editorLineWrap}
          onChange={(next) => { set({ editorLineWrap: next }) }}
        />
        <SwitchField
          label={t('set.multipleEditors')}
          desc={t('set.multipleEditors.desc')}
          checked={config.multipleEditors}
          onChange={(next) => { set({ multipleEditors: next }) }}
        />
        <SwitchField
          label={t('set.formatOnSave')}
          desc={t('set.formatOnSave.desc')}
          checked={config.formatOnSave}
          onChange={(next) => { set({ formatOnSave: next }) }}
        />
      </Group>

      <Group title={t('group.behavior')}>
        <SwitchField
          label={t('set.autoReloadAfterJsEdit')}
          desc={t('set.autoReloadAfterJsEdit.desc')}
          checked={config.autoReloadAfterJsEdit}
          onChange={(next) => { set({ autoReloadAfterJsEdit: next }) }}
        />
        <SwitchField
          label={t('set.confirmJsExecution')}
          desc={t('set.confirmJsExecution.desc')}
          checked={config.confirmJsExecution}
          onChange={(next) => { set({ confirmJsExecution: next }) }}
        />
        <SwitchField
          label={t('set.validateCssContent')}
          desc={t('set.validateCssContent.desc')}
          checked={config.validateCssContent}
          onChange={(next) => { set({ validateCssContent: next }) }}
        />
        <SwitchField
          label={t('set.validateJsSyntax')}
          desc={t('set.validateJsSyntax.desc')}
          checked={config.validateJsSyntax}
          onChange={(next) => { set({ validateJsSyntax: next }) }}
        />
        <SwitchField
          label={t('set.reloadNotice')}
          desc={t('set.reloadNotice.desc')}
          checked={config.reloadNotice && !config.reloadNoticeSuppressed}
          onChange={(next) => { set({ reloadNotice: next, reloadNoticeSuppressed: false }) }}
        />
        <SwitchField
          label={t('set.consoleDebug')}
          desc={t('set.consoleDebug.desc')}
          checked={config.consoleDebug}
          onChange={(next) => { set({ consoleDebug: next }) }}
        />
      </Group>

      <Group title={t('group.watch')}>
        <Field label={t('set.fileWatchMode')} desc={t('set.fileWatchMode.desc')} disabled={!hostReady}>
          <Select
            label={t('set.fileWatchMode')}
            value={config.fileWatchMode}
            disabled={!hostReady}
            onChange={(next) => { set({ fileWatchMode: next }) }}
            options={[
              { value: 'disabled', label: t('set.fileWatchMode.disabled') },
              { value: 'watch', label: t('set.fileWatchMode.watch') },
              { value: 'loadOnce', label: t('set.fileWatchMode.loadOnce') },
            ]}
          />
        </Field>
        <Field label={t('set.fileWatchPath')} desc={t('set.fileWatchPath.desc')} disabled={!hostReady} stacked>
          <input
            className={`${PREFIX}-text`}
            type="text"
            value={config.fileWatchPath}
            disabled={!hostReady}
            placeholder={t('set.fileWatchPath.placeholder')}
            aria-label={t('set.fileWatchPath')}
            onChange={(event) => { set({ fileWatchPath: event.target.value }) }}
          />
        </Field>
        <Field label={t('set.fileWatchIntervalSec')} desc={t('set.fileWatchIntervalSec.desc')} disabled={!hostReady}>
          <span className={`${PREFIX}-range-row`}>
            <input
              type="range"
              min={5}
              max={300}
              step={5}
              value={config.fileWatchIntervalSec}
              disabled={!hostReady}
              aria-label={t('set.fileWatchIntervalSec')}
              onChange={(event) => { set({ fileWatchIntervalSec: Number(event.target.value) }) }}
            />
            <span className={`${PREFIX}-range-value`}>{config.fileWatchIntervalSec} s</span>
          </span>
        </Field>
        <Field label={t('set.fileWatchMirrorMode')} desc={t('set.fileWatchMirrorMode.desc')} disabled={!hostReady}>
          <Select
            label={t('set.fileWatchMirrorMode')}
            value={config.fileWatchMirrorMode}
            disabled={!hostReady}
            onChange={(next) => { set({ fileWatchMirrorMode: next }) }}
            options={[
              { value: 'merge', label: t('set.fileWatchMirrorMode.merge') },
              { value: 'overwrite', label: t('set.fileWatchMirrorMode.overwrite') },
            ]}
          />
        </Field>
        <SwitchField
          label={t('set.fileWatchDeleteMissing')}
          desc={t('set.fileWatchDeleteMissing.desc')}
          checked={config.fileWatchDeleteMissing}
          disabled={!hostReady}
          onChange={(next) => { set({ fileWatchDeleteMissing: next }) }}
        />
        <Field label={t('group.runtime')} stacked>
          <div className={`${PREFIX}-hint`}>
            <span
              className={`${PREFIX}-status-dot`}
              data-on={watch?.active === true ? 'true' : undefined}
              data-error={watch?.lastError ? 'true' : undefined}
            />
            {watch === undefined || watch.mode === 'disabled'
              ? t('watch.status.disabled')
              : watch.mode === 'loadOnce'
                ? t('watch.status.loadOnce')
                : t('watch.status.active', { interval: watch.intervalSec })}
            <br />
            {watch === undefined || watch.lastScanAt === 0
              ? t('watch.status.never')
              : t('watch.status.lastScan', { time: new Date(watch.lastScanAt).toLocaleTimeString() })}
            {watch?.lastError ? (
              <>
                <br />
                {t('watch.status.error', { error: watch.lastError })}
              </>
            ) : null}
            {scanNote === null ? null : (
              <>
                <br />
                {scanNote}
              </>
            )}
            <div className={`${PREFIX}-actions`} style={{ marginTop: 8 }}>
              <Button
                variant="outline"
                size="sm"
                icon={<IconRefreshOutline16 size={14} />}
                disabled={!hostReady || config.fileWatchMode === 'disabled'}
                onClick={rescan}
              >
                {t('action.rescan')}
              </Button>
            </div>
          </div>
        </Field>
      </Group>

      <Group title={t('group.data')}>
        <Field label={t('word.count')} desc={t('set.data.summary', { count: counts.total, css: counts.css, js: counts.js })}>
          <Tag>{String(counts.total)}</Tag>
        </Field>
        <Field label={t('action.export')} desc={t('set.data.export.desc')}>
          <Button variant="outline" size="sm" icon={<IconDownloadOutline16 size={14} />} onClick={exportAll}>
            {t('action.export')}
          </Button>
        </Field>
        <Field label={t('action.importAppend')} desc={t('set.data.importAppend.desc')}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { removeSnippet.current?.click() }}
          >
            {t('action.importAppend')}
          </Button>
        </Field>
        <Field label={t('action.importOverwrite')} desc={t('set.data.importOverwrite.desc')}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { replaceFile.current?.click() }}
          >
            {t('action.importOverwrite')}
          </Button>
        </Field>
        <Field
          label={t('action.openBackups')}
          desc={t('set.data.backups.desc', { path: hostState.status?.paths.backupsDir ?? '—' })}
          disabled={!hostReady}
        >
          <Button
            variant="outline"
            size="sm"
            icon={<IconFolderOpenOutline16 size={14} />}
            disabled={!hostReady}
            onClick={openBackups}
          >
            {t('action.openBackups')}
          </Button>
        </Field>
        <Field label={t('action.resetPrefs')} desc={t('set.data.resetPrefs.desc')}>
          <Button variant="outline" size="sm" onClick={resetPrefs}>
            {t('action.resetPrefs')}
          </Button>
        </Field>
        <Field label={t('action.clearAll')} desc={t('set.data.clearAll.desc')}>
          <Button
            variant="outline"
            size="sm"
            icon={<IconTrashOutline16 size={14} />}
            onClick={clearAll}
          >
            {t('action.clearAll')}
          </Button>
        </Field>
      </Group>

      <Group title={t('group.gist')}>
        <GistTokenField
          controller={controller}
          t={t}
          status={hostState.status}
          onChanged={hostState.refresh}
        />
        <Field label={t('gist.import.title')} desc={t('set.gist.import.desc')} disabled={!hostReady}>
          <Button variant="outline" size="sm" disabled={!hostReady} onClick={() => { setShowImport(true) }}>
            {t('gist.import.title')}
          </Button>
        </Field>
        <Field label={t('gist.publish.title')} desc={t('set.gist.publish.desc')} disabled={!hostReady}>
          <Button
            variant="outline"
            size="sm"
            icon={<IconRightUpOutline16 size={14} />}
            disabled={!hostReady}
            onClick={() => { setShowPublish(true) }}
          >
            {t('gist.publish.title')}
          </Button>
        </Field>
        <Field label={t('set.gist.lastPublished')}>
          <span className={`${PREFIX}-field-desc`}>
            {config.gistLastPublished === '' ? (
              t('set.gist.none')
            ) : (
              <a className={`${PREFIX}-link`} href={config.gistLastPublished} target="_blank" rel="noreferrer">
                {config.gistLastPublished}
              </a>
            )}
          </span>
        </Field>
        <Field label={t('set.gist.lastImported')}>
          <span className={`${PREFIX}-field-desc`}>
            {config.gistLastImported === '' ? (
              t('set.gist.none')
            ) : (
              <a className={`${PREFIX}-link`} href={config.gistLastImported} target="_blank" rel="noreferrer">
                {config.gistLastImported}
              </a>
            )}
          </span>
        </Field>
      </Group>

      <Group title={t('group.about')}>
        <Field label={t('host.version')}>
          <span className={`${PREFIX}-field-desc`}>{controller.version}</span>
        </Field>
        <Field label={t('host.repository')}>
          <a className={`${PREFIX}-link`} href={REPOSITORY} target="_blank" rel="noreferrer">
            {REPOSITORY}
          </a>
        </Field>
        <Field label={t('host.feedback')}>
          <a className={`${PREFIX}-link`} href={`${REPOSITORY}/issues`} target="_blank" rel="noreferrer">
            {t('host.feedback')}
          </a>
        </Field>
        <Field label={t('host.license')}>
          <span className={`${PREFIX}-field-desc`}>MIT</span>
        </Field>
        {hostState.status === null ? null : (
          <>
            <Field label={t('host.platform')}>
              <span className={`${PREFIX}-field-desc`}>{hostState.status.platform}</span>
            </Field>
            <Field label={t('host.paths')} stacked>
              <div className={`${PREFIX}-kv`}>
                <span>{NAMESPACE}</span>
                <code>settings document namespace</code>
                <span>data</span>
                <code>{hostState.status.paths.dataDir}</code>
                <span>backups</span>
                <code>{hostState.status.paths.backupsDir}</code>
                <span>token</span>
                <code>{hostState.status.paths.tokenFile}</code>
              </div>
            </Field>
          </>
        )}
      </Group>

      <input
        ref={removeSnippet}
        className={`${PREFIX}-file-input`}
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file !== undefined) void importAppend(file)
        }}
      />
      <input
        ref={replaceFile}
        className={`${PREFIX}-file-input`}
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file !== undefined) void importOverwrite(file)
        }}
      />

      {showImport ? (
        <GistImportDialog
          controller={controller}
          t={t}
          onClose={() => { setShowImport(false) }}
        />
      ) : null}
      {showPublish ? (
        <GistPublishDialog
          controller={controller}
          t={t}
          onClose={() => { setShowPublish(false) }}
        />
      ) : null}
    </div>
  )
}

/** The token row: write-only, because the browser never reads the token back. */
function GistTokenField({
  controller,
  t,
  status,
  onChanged,
}: {
  controller: SnippetsController
  t: T
  status: host.HostStatus | null
  onChanged: () => void
}) {
  const [draft, setDraft] = useState('')
  const configured = status?.gist.configured === true
  const disabled = status === null

  const save = (): void => {
    void (async () => {
      await host.setGistToken(draft)
      setDraft('')
      controller.toast(t('set.gist.token.saved'))
      onChanged()
    })()
  }

  const clear = (): void => {
    void (async () => {
      await host.setGistToken('')
      setDraft('')
      controller.toast(t('set.gist.token.cleared'))
      onChanged()
    })()
  }

  return (
    <Field
      label={t('set.gist.token')}
      desc={t('set.gist.token.desc', { path: status?.paths.tokenFile ?? '—' })}
      disabled={disabled}
      stacked
    >
      <div className={`${PREFIX}-actions`}>
        <span className={`${PREFIX}-field-desc`}>
          {configured ? t('set.gist.token.configured') : t('set.gist.token.empty')}
        </span>
      </div>
      <div className={`${PREFIX}-actions`}>
        <input
          className={`${PREFIX}-text`}
          type="password"
          value={draft}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          placeholder={t('set.gist.token.placeholder')}
          aria-label={t('set.gist.token')}
          onChange={(event) => { setDraft(event.target.value) }}
        />
        <Button variant="primary" size="sm" disabled={disabled || draft.trim() === ''} onClick={save}>
          {t('action.saveToken')}
        </Button>
        <Button variant="outline" size="sm" disabled={disabled || !configured} onClick={clear}>
          {t('action.clearToken')}
        </Button>
      </div>
      <div className={`${PREFIX}-field-desc`}>
        <a
          className={`${PREFIX}-link`}
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noreferrer"
        >
          {t('set.gist.token.fineGrained')}
        </a>
        {' · '}
        <a
          className={`${PREFIX}-link`}
          href="https://github.com/settings/tokens/new?scopes=gist"
          target="_blank"
          rel="noreferrer"
        >
          {t('set.gist.token.classic')}
        </a>
      </div>
    </Field>
  )
}
