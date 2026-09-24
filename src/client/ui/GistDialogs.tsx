/**
 * The two Gist dialogs.
 *
 * Both are thin over the host bridge: the network call, the token and the
 * import plan are all host/shared concerns; what lives here is the reading
 * experience — the three import modes with their per-file diff, and the publish
 * confirmation that spells out the one destructive branch (deleting Gist files
 * that are not selected) and the one irreversible one (a public Gist).
 *
 * The import dialog computes the exact next library with `planImport` before
 * anything is written, so the summary the reader sees IS the change that will be
 * applied.
 */
import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  DiffBlock,
  IconLoadingOutlineRegular,
  Input,
  Modal,
  Switch,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { planImport, type GistImportMode, type GistSnapshot, type ImportCandidate } from '../../shared/gist.ts'
import { snippetTitle } from '../../shared/model.ts'
import type { SnippetsController } from '../controller.ts'
import * as host from '../host-api.ts'
import { PREFIX } from '../styles.ts'
import { useConfig, useFailureToast, type T } from './shared.tsx'

/** Props shared by both dialogs. */
export interface GistDialogProps {
  controller: SnippetsController
  t: T
  onClose: () => void
}

/* ── import ────────────────────────────────────────────────────────── */

/**
 * Fetch a Gist, preview the plan in one of three modes, then write it.
 * @param props - see {@link GistDialogProps}.
 */
export function GistImportDialog({ controller, t, onClose }: GistDialogProps) {
  const config = useConfig(controller)
  const failure = useFailureToast(controller, t)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [snapshot, setSnapshot] = useState<GistSnapshot | null>(null)
  const [mode, setMode] = useState<GistImportMode>('merge')
  const [selected, setSelected] = useState<string | null>(null)

  const plan = useMemo(
    () => (snapshot === null ? null : planImport(snapshot, config.snippets, mode)),
    [config.snippets, mode, snapshot],
  )

  const fetchGist = useCallback(() => {
    void (async () => {
      setBusy(true)
      try {
        const next = await host.fetchGist(url)
        setSnapshot(next)
        setSelected(next.files[0]?.filename ?? null)
      } catch (cause) {
        failure(cause)
      } finally {
        setBusy(false)
      }
    })()
  }, [failure, url])

  const apply = useCallback(() => {
    void (async () => {
      if (plan === null || snapshot === null) {
        controller.toast(t('gist.import.fetchFirst'))
        return
      }
      if (mode === 'overwrite') {
        const accepted = await controller.confirm({
          title: t('confirm.importOverwrite.title'),
          body: t('confirm.importOverwrite.body', {
            current: config.snippets.length,
            incoming: plan.next.length,
          }),
          confirmLabel: t('action.import'),
          cancelLabel: t('action.cancel'),
          tone: 'danger',
        })
        if (!accepted) return
        try {
          await host.createBackup(config.snippets, 'gist-import')
        } catch (cause) {
          failure(cause)
          return
        }
      }
      const added = plan.candidates.filter((candidate) => !candidate.exists && !candidate.truncated).length
      const updated = plan.candidates.filter((candidate) => candidate.exists && candidate.differs).length
      await controller.replaceSnippets(plan.next, { gistLastImported: snapshot.url })
      controller.toast(t('notice.imported', { added, updated }))
      onClose()
    })()
  }, [config.snippets, controller, failure, mode, onClose, plan, snapshot, t])

  const selectedCandidate: ImportCandidate | undefined = plan?.candidates.find(
    (candidate) => candidate.filename === selected,
  )
  const localMatch =
    selectedCandidate?.id === undefined
      ? undefined
      : config.snippets.find((snippet) => snippet.id === selectedCandidate.id)

  const summary = useMemo(() => {
    if (plan === null) return null
    const added = plan.candidates.filter((candidate) => !candidate.exists && !candidate.truncated).length
    const updated = plan.candidates.filter((candidate) => candidate.exists && candidate.differs).length
    const same = plan.candidates.filter((candidate) => candidate.exists && !candidate.differs).length
    return t('gist.import.summary', { total: plan.candidates.length, added, updated, same })
  }, [plan, t])

  return (
    <Modal
      open
      onClose={onClose}
      title={t('gist.import.title')}
      closeLabel={t('action.close')}
      contentClassName={`${PREFIX}-dialog-body`}
      footer={
        <>
          <span className={`${PREFIX}-code-status`}>{summary ?? ''}</span>
          <span className={`${PREFIX}-editor-toolbar-spacer`} />
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" size="sm" disabled={plan === null} onClick={apply}>
            {t('action.import')}
          </Button>
        </>
      }
    >
      <div className={`${PREFIX}-dialog-row`}>
        <span className={`${PREFIX}-grow`}>
          <Input
            value={url}
            placeholder={t('gist.import.url.placeholder')}
            aria-label={t('gist.import.url')}
            onChange={(event) => { setUrl(event.target.value) }}
          />
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || url.trim() === ''}
          icon={busy ? <IconLoadingOutlineRegular size={14} /> : undefined}
          onClick={fetchGist}
        >
          {t('action.fetch')}
        </Button>
      </div>

      <div className={`${PREFIX}-dialog-row`}>
        <span className={`${PREFIX}-seg`} role="group" aria-label={t('gist.import.mode')}>
          {(['merge', 'overwrite', 'fork'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => { setMode(value) }}
            >
              {t(`gist.import.mode.${value}` as never)}
            </button>
          ))}
        </span>
      </div>
      <div className={`${PREFIX}-field-desc`}>{t(`gist.import.mode.${mode}.desc` as never)}</div>

      {plan === null ? (
        <div className={`${PREFIX}-hint`}>{t('gist.import.url.placeholder')}</div>
      ) : plan.candidates.length === 0 ? (
        <div className={`${PREFIX}-hint`} data-tone="warn">
          {t('gist.import.empty')}
        </div>
      ) : (
        <div className={`${PREFIX}-import-split`}>
          <div className={`${PREFIX}-file-list`} role="listbox" aria-label={t('gist.import.title')}>
            {plan.candidates.map((candidate) => (
              <button
                key={candidate.filename}
                type="button"
                role="option"
                aria-selected={selected === candidate.filename}
                className={`${PREFIX}-file`}
                onClick={() => { setSelected(candidate.filename) }}
              >
                <span className={`${PREFIX}-file-name`}>{candidate.title || candidate.filename}</span>
                <span
                  className={`${PREFIX}-badge`}
                  data-kind={
                    candidate.truncated
                      ? undefined
                      : !candidate.exists
                        ? 'new'
                        : candidate.differs
                          ? 'update'
                          : undefined
                  }
                >
                  {candidate.truncated
                    ? '!'
                    : !candidate.exists
                      ? t('gist.import.badge.new')
                      : candidate.differs
                        ? t('gist.import.badge.update')
                        : t('gist.import.badge.same')}
                </span>
              </button>
            ))}
          </div>

          <div className={`${PREFIX}-diff-pane`}>
            {selectedCandidate === undefined ? (
              <div className={`${PREFIX}-diff-empty`}>{t('gist.import.compare.hint')}</div>
            ) : selectedCandidate.truncated ? (
              <div className={`${PREFIX}-diff-empty`}>{t('gist.import.truncated')}</div>
            ) : localMatch === undefined ? (
              <div className={`${PREFIX}-diff-empty`}>{t('gist.import.compareLocal')}</div>
            ) : localMatch.content === selectedCandidate.content ? (
              <div className={`${PREFIX}-diff-empty`}>{t('gist.import.compareSame')}</div>
            ) : (
              <DiffBlock
                diffs={[{ path: selectedCandidate.filename, oldText: localMatch.content, newText: selectedCandidate.content }]}
                labels={{
                  copy: t('word.copy'),
                  copied: t('word.copied'),
                  collapseAria: t('gist.import.compare'),
                  expandAria: (hidden: number) => t('gist.import.compare') + ` (+${String(hidden)})`,
                  collapse: t('gist.import.compare'),
                  expand: (hidden: number) => t('gist.import.compare') + ` (+${String(hidden)})`,
                  codeLabel: t('word.code'),
                  wrapLabel: t('word.wrap'),
                  unwrapLabel: t('word.unwrap'),
                }}
              />
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

/* ── publish ───────────────────────────────────────────────────────── */

/**
 * Publish a snippet selection to a new or existing Gist.
 * @param props - see {@link GistDialogProps}.
 */
export function GistPublishDialog({ controller, t, onClose }: GistDialogProps) {
  const config = useConfig(controller)
  const failure = useFailureToast(controller, t)
  const [target, setTarget] = useState<'new-secret' | 'new-public' | 'update-last' | 'update-custom'>(
    config.gistLastPublished === '' ? 'new-secret' : 'update-last',
  )
  const [customUrl, setCustomUrl] = useState('')
  const [description, setDescription] = useState('')
  const [filter, setFilter] = useState<'all' | 'enabled'>('enabled')
  const [deleteUnchecked, setDeleteUnchecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    for (const snippet of config.snippets) {
      if (snippet.enabled) initial.add(snippet.id)
    }
    return initial
  })

  const visibleSnippets = useMemo(
    () => (filter === 'enabled' ? config.snippets.filter((snippet) => snippet.enabled) : config.snippets),
    [config.snippets, filter],
  )

  const togglePick = (id: string, next: boolean): void => {
    setPicked((current) => {
      const copy = new Set(current)
      if (next) copy.add(id)
      else copy.delete(id)
      return copy
    })
  }

  const selectAll = (next: boolean): void => {
    setPicked(next ? new Set(visibleSnippets.map((snippet) => snippet.id)) : new Set())
  }

  const publish = useCallback(() => {
    void (async () => {
      const selected = config.snippets.filter((snippet) => picked.has(snippet.id))
      if (selected.length === 0) {
        controller.toast(t('gist.error.empty'))
        return
      }
      if (target === 'new-public') {
        const accepted = await controller.confirm({
          title: t('gist.publish.title'),
          body: t('gist.publish.publicWarn'),
          confirmLabel: t('action.publish'),
          cancelLabel: t('action.cancel'),
          tone: 'danger',
        })
        if (!accepted) return
      }
      setBusy(true)
      try {
        const result = await host.publishGist({
          target: target === 'new-secret' ? 'new-secret' : target === 'new-public' ? 'new-public' : 'update',
          ...(target === 'update-last' ? { url: config.gistLastPublished } : {}),
          ...(target === 'update-custom' ? { url: customUrl } : {}),
          description,
          snippets: selected,
          deleteUnchecked: target === 'new-secret' || target === 'new-public' ? false : deleteUnchecked,
        })
        controller.toast(t('gist.publish.done', { url: result.url }))
        onClose()
      } catch (cause) {
        failure(cause)
      } finally {
        setBusy(false)
      }
    })()
  }, [config.gistLastPublished, config.snippets, controller, customUrl, deleteUnchecked, description, failure, onClose, picked, t, target])

  const isUpdate = target === 'update-last' || target === 'update-custom'
  const needsCustomUrl = target === 'update-custom'

  return (
    <Modal
      open
      onClose={onClose}
      title={t('gist.publish.title')}
      closeLabel={t('action.close')}
      contentClassName={`${PREFIX}-dialog-body`}
      footer={
        <>
          <span className={`${PREFIX}-code-status`}>
            {t('gist.publish.selected', { count: picked.size })}
          </span>
          <span className={`${PREFIX}-editor-toolbar-spacer`} />
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || (needsCustomUrl && customUrl.trim() === '')}
            icon={busy ? <IconLoadingOutlineRegular size={14} /> : undefined}
            onClick={publish}
          >
            {t('action.publish')}
          </Button>
        </>
      }
    >
      <div className={`${PREFIX}-dialog-row`}>
        <select
          className={`${PREFIX}-select`}
          value={target}
          aria-label={t('gist.publish.target')}
          onChange={(event) => { setTarget(event.target.value as typeof target) }}
        >
          <option value="new-secret">{t('gist.publish.target.newSecret')}</option>
          <option value="new-public">{t('gist.publish.target.newPublic')}</option>
          {config.gistLastPublished === '' ? null : (
            <option value="update-last">{t('gist.publish.target.updateLast')}</option>
          )}
          <option value="update-custom">{t('gist.publish.target.updateCustom')}</option>
        </select>
        {needsCustomUrl ? (
          <span className={`${PREFIX}-grow`}>
            <Input
              value={customUrl}
              placeholder={t('gist.import.url.placeholder')}
              aria-label={t('gist.publish.target.updateCustom')}
              onChange={(event) => { setCustomUrl(event.target.value) }}
            />
          </span>
        ) : null}
      </div>

      <div className={`${PREFIX}-dialog-row`}>
        <span className={`${PREFIX}-grow`}>
          <Input
            value={description}
            placeholder={t('gist.publish.description.placeholder')}
            aria-label={t('gist.publish.description')}
            onChange={(event) => { setDescription(event.target.value) }}
          />
        </span>
      </div>

      <div className={`${PREFIX}-dialog-row`}>
        <span className={`${PREFIX}-seg`} role="group">
          {(['all', 'enabled'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value) }}>
              {t(`gist.publish.filter.${value}` as never)}
            </button>
          ))}
        </span>
        <Button variant="ghost" size="sm" onClick={() => { selectAll(true) }}>
          {t('action.selectAll')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { selectAll(false) }}>
          {t('action.selectNone')}
        </Button>
      </div>

      <div className={`${PREFIX}-select-list`}>
        {visibleSnippets.length === 0 ? (
          <div className={`${PREFIX}-diff-empty`}>{t('gist.publish.empty')}</div>
        ) : (
          visibleSnippets.map((snippet) => (
            <div key={snippet.id} className={`${PREFIX}-select-row`}>
              <label>
                <input
                  type="checkbox"
                  checked={picked.has(snippet.id)}
                  onChange={(event) => { togglePick(snippet.id, event.target.checked) }}
                />
                <span>{snippetTitle(snippet) || t('word.none')}</span>
              </label>
              <Tag>{snippet.type}</Tag>
            </div>
          ))
        )}
      </div>

      {isUpdate ? (
        <div className={`${PREFIX}-dialog-row`}>
          <Switch
            checked={deleteUnchecked}
            onChange={setDeleteUnchecked}
            label={t('gist.publish.deleteUnchecked')}
          />
          <span className={`${PREFIX}-field-desc`}>{t('gist.publish.deleteUnchecked.desc')}</span>
        </div>
      ) : null}

      {target === 'new-public' ? (
        <div className={`${PREFIX}-hint`} data-tone="warn">
          {t('gist.publish.publicWarn')}
        </div>
      ) : null}

      {config.gistLastPublished === '' ? null : (
        <div className={`${PREFIX}-field-desc`}>
          {t('set.gist.lastPublished')}: {config.gistLastPublished}
        </div>
      )}
    </Modal>
  )
}

/** Kept for the `GistSnapshot` type re-export used by callers. */
export type { GistSnapshot }
