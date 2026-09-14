/**
 * The manager panel: the popover the sidebar-foot `</>` trigger opens.
 *
 * This is the direct counterpart of the SiYuan plugin's management menu — the
 * type tabs with counts, search, the per-type master switch, one row per
 * snippet with its own switch, per-row edit / duplicate / delete, drag
 * reordering under custom sort, and the reload control JS changes need.
 *
 * It renders no chrome of its own beyond the panel body: the trigger, the
 * anchored position and the outside-click dismissal belong to `FooterEntry`.
 */
import { useMemo, useState } from 'react'
import {
  Button,
  IconChevronDownOutline14,
  IconCopyOutline16,
  IconEditOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  IconTrashOutline16,
  Input,
  Switch,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { filterSnippets, snippetTitle, sortSnippets } from '../../shared/model.ts'
import type { Snippet, SnippetType } from '../../shared/types.ts'
import type { SnippetsController } from '../controller.ts'
import { ORDER_PRESERVING_SORTS } from '../../shared/types.ts'
import { PREFIX } from '../styles.ts'
import { useConfig, useToggleSnippet, useUi, type T } from './shared.tsx'

/** Props for {@link ManagerPanel}. */
export interface ManagerPanelProps {
  controller: SnippetsController
  t: T
  /** Close the panel (owned by the trigger). */
  onClose: () => void
  /** Open the settings panel on this plugin's section. */
  onOpenSettings: () => void
}

/**
 * Render the manager panel body.
 * @param props - see {@link ManagerPanelProps}.
 */
export function ManagerPanel({ controller, t, onClose, onOpenSettings }: ManagerPanelProps) {
  const config = useConfig(controller)
  const ui = useUi(controller)
  const toggle = useToggleSnippet(controller, t)
  const [tab, setTab] = useState<SnippetType>(config.defaultTab)
  const [searchOpen, setSearchOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)

  const counts = useMemo(() => {
    let css = 0
    let js = 0
    for (const snippet of config.snippets) {
      if (snippet.type === 'css') css += 1
      else js += 1
    }
    return { css, js, enabled: config.snippets.filter((snippet) => snippet.enabled).length }
  }, [config.snippets])

  const visible = useMemo(() => {
    const ofType = config.snippets.filter((snippet) => snippet.type === tab)
    const searched = filterSnippets(ofType, searchOpen ? config.searchMode : 0, searchOpen ? keyword : '')
    return sortSnippets(searched, config.sortType)
  }, [config.searchMode, config.snippets, config.sortType, keyword, searchOpen, tab])

  const master = tab === 'css' ? config.cssMasterEnabled : config.jsMasterEnabled
  const canReorder = ORDER_PRESERVING_SORTS.includes(config.sortType)

  const setMaster = (next: boolean): void => {
    void controller.patch({ [tab === 'css' ? 'cssMasterEnabled' : 'jsMasterEnabled']: next })
  }

  // Opening the editor first means an abandoned "new snippet" leaves nothing
  // behind: the record is only written when the editor is saved.
  const addSnippet = (): void => {
    controller.openEditor(null, tab)
  }

  const duplicate = async (snippet: Snippet): Promise<void> => {
    await controller.duplicateSnippet(snippet.id)
    controller.toast(t('notice.duplicated'))
  }

  const remove = async (snippet: Snippet): Promise<void> => {
    if (config.confirmDelete) {
      const accepted = await controller.confirm({
        title: t('confirm.delete.title'),
        body: t('confirm.delete.body', { name: snippetTitle(snippet) || t('word.none') }),
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        tone: 'danger',
      })
      if (!accepted) return
    }
    await controller.deleteSnippet(snippet.id)
    controller.toast(t('notice.deleted'))
  }

  const handleRowClick = (snippet: Snippet): void => {
    if (config.rowClickAction === 'none') return
    if (config.rowClickAction === 'toggle') void toggle(snippet, !snippet.enabled)
    else controller.openEditor(snippet.id, snippet.type)
  }

  /** Drop `sourceId` onto `targetId`, writing the resulting order back. */
  const drop = async (sourceId: string, targetId: string): Promise<void> => {
    if (sourceId === targetId) return
    const order = visible.map((snippet) => snippet.id)
    const from = order.indexOf(sourceId)
    const to = order.indexOf(targetId)
    if (from < 0 || to < 0) return
    order.splice(to, 0, ...order.splice(from, 1))
    // Only the visible slice is reordered; the caller's `reorder` appends the
    // rest in stored order, so a filtered view cannot scramble hidden rows.
    const merged = order.concat(
      config.snippets.map((snippet) => snippet.id).filter((id) => !order.includes(id)),
    )
    await controller.reorder(merged)
    controller.toast(t('notice.reordered'))
  }

  const showReloadBanner = ui.reloadPending && config.reloadNotice && !config.reloadNoticeSuppressed

  return (
    <>
      <div className={`${PREFIX}-panel-head`}>
        <div className={`${PREFIX}-tabs`} role="tablist" aria-label={t('panel.title')}>
          {(['css', 'js'] as const).map((type) => (
            <button
              key={type}
              type="button"
              role="tab"
              aria-selected={tab === type}
              className={`${PREFIX}-tab`}
              onClick={() => { setTab(type) }}
            >
              {t(type === 'css' ? 'tab.css' : 'tab.js')}
              <span className={`${PREFIX}-tab-count`}>{type === 'css' ? counts.css : counts.js}</span>
            </button>
          ))}
        </div>
        <span className={`${PREFIX}-head-spacer`} />
        <span className={`${PREFIX}-master`}>
          <Switch
            checked={master}
            onChange={setMaster}
            label={t(tab === 'css' ? 'panel.master.css' : 'panel.master.js')}
            title={t(tab === 'css' ? 'panel.master.css' : 'panel.master.js')}
          />
        </span>
      </div>

      <div className={`${PREFIX}-tools`}>
        {searchOpen ? (
          <span className={`${PREFIX}-search`}>
            <Input
              autoFocus
              icon={<IconSearchOutline16 size={14} />}
              value={keyword}
              placeholder={t('panel.search.placeholder')}
              aria-label={t('panel.search')}
              onChange={(event) => { setKeyword(event.target.value) }}
            />
          </span>
        ) : (
          <>
            <Tooltip label={t('panel.search')} side="top">
              <button
                type="button"
                className={`${PREFIX}-icon-btn`}
                aria-label={t('panel.search')}
                onClick={() => { setSearchOpen(true) }}
              >
                <IconSearchOutline16 size={15} />
              </button>
            </Tooltip>
            <span className={`${PREFIX}-head-spacer`} />
            <Tooltip label={t('panel.settings')} side="top">
              <button
                type="button"
                className={`${PREFIX}-icon-btn`}
                aria-label={t('panel.settings')}
                onClick={() => { onClose(); onOpenSettings() }}
              >
                <IconSettingsOutline16 size={15} />
              </button>
            </Tooltip>
            <Tooltip label={t('panel.reload')} side="top">
              <button
                type="button"
                className={`${PREFIX}-icon-btn`}
                aria-label={t('panel.reload')}
                onClick={() => { controller.reload() }}
              >
                <IconRefreshOutline16 size={15} />
              </button>
            </Tooltip>
            <Tooltip label={t('panel.add')} side="top">
              <button
                type="button"
                className={`${PREFIX}-icon-btn`}
                aria-label={t('panel.add')}
                onClick={addSnippet}
              >
                <IconPlusOutline16 size={15} />
              </button>
            </Tooltip>
          </>
        )}
      </div>

      {showReloadBanner ? (
        <div className={`${PREFIX}-reload-banner`} role="status">
          <span>{t('notice.reloadNeeded')}</span>
          <button type="button" onClick={() => { void controller.patch({ reloadNoticeSuppressed: true }) }}>
            {t('notice.noLongerShow')}
          </button>
        </div>
      ) : null}

      <div className={`${PREFIX}-list`} role="list">
        {visible.length === 0 ? (
          <div className={`${PREFIX}-empty`}>
            <div className={`${PREFIX}-empty-title`}>
              {searchOpen && keyword.trim() !== ''
                ? t('empty.search')
                : t(tab === 'css' ? 'empty.css' : 'empty.js')}
            </div>
            <div className={`${PREFIX}-empty-hint`}>
              {searchOpen && keyword.trim() !== '' ? t('empty.search.hint') : t('panel.search')}
            </div>
            {searchOpen && keyword.trim() !== '' ? null : (
              <div className={`${PREFIX}-empty-action`}>
                <Button variant="outline" size="sm" icon={<IconPlusOutline16 size={14} />} onClick={addSnippet}>
                  {t(tab === 'css' ? 'empty.add.css' : 'empty.add.js')}
                </Button>
              </div>
            )}
          </div>
        ) : (
          visible.map((snippet) => {
            const title = snippetTitle(snippet)
            return (
              <div
                key={snippet.id}
                role="listitem"
                className={`${PREFIX}-row`}
                data-dragging={dragId === snippet.id ? 'true' : undefined}
                data-drop={dropId === snippet.id && dragId !== snippet.id ? 'true' : undefined}
                draggable={canReorder}
                onDragStart={(event) => {
                  setDragId(snippet.id)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', snippet.id)
                }}
                onDragEnd={() => { setDragId(null); setDropId(null) }}
                onDragOver={(event) => {
                  if (!canReorder || dragId === null) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropId(snippet.id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const source = event.dataTransfer.getData('text/plain') || dragId
                  setDragId(null)
                  setDropId(null)
                  if (source !== null && source !== '') void drop(source, snippet.id)
                }}
              >
                {canReorder ? (
                  <span className={`${PREFIX}-row-handle`} title={t('panel.drag')} aria-hidden="true">
                    <IconChevronDownOutline14 size={12} />
                  </span>
                ) : null}
                <button
                  type="button"
                  className={`${PREFIX}-row-main`}
                  onClick={() => { handleRowClick(snippet) }}
                  onDoubleClick={() => { controller.openEditor(snippet.id, snippet.type) }}
                >
                  <span
                    className={`${PREFIX}-row-title`}
                    data-off={!snippet.enabled ? 'true' : undefined}
                    data-empty={title === '' ? 'true' : undefined}
                  >
                    {title === '' ? t('word.none') : title}
                  </span>
                </button>
                {config.showEditButton ? (
                  <button
                    type="button"
                    className={`${PREFIX}-icon-btn`}
                    aria-label={t('action.edit')}
                    title={t('action.edit')}
                    onClick={() => { controller.openEditor(snippet.id, snippet.type) }}
                  >
                    <IconEditOutline16 size={14} />
                  </button>
                ) : null}
                {config.showDuplicateButton ? (
                  <button
                    type="button"
                    className={`${PREFIX}-icon-btn`}
                    aria-label={t('action.duplicate')}
                    title={t('action.duplicate')}
                    onClick={() => { void duplicate(snippet) }}
                  >
                    <IconCopyOutline16 size={14} />
                  </button>
                ) : null}
                {config.showDeleteButton ? (
                  <button
                    type="button"
                    className={`${PREFIX}-icon-btn`}
                    data-danger="true"
                    aria-label={t('action.delete')}
                    title={t('action.delete')}
                    onClick={() => { void remove(snippet) }}
                  >
                    <IconTrashOutline16 size={14} />
                  </button>
                ) : null}
                <Switch
                  checked={snippet.enabled}
                  onChange={(next) => { void toggle(snippet, next) }}
                  label={title === '' ? t('word.none') : title}
                />
              </div>
            )
          })
        )}
      </div>

      <div className={`${PREFIX}-foot`}>
        <span>{t('panel.footer.count', { total: config.snippets.length, enabled: counts.enabled })}</span>
        <span className={`${PREFIX}-foot-spacer`} />
        <Button variant="ghost" size="sm" onClick={() => { controller.reload() }}>
          {t('panel.reload')}
        </Button>
      </div>
    </>
  )
}
