/**
 * The snippet editor dialog.
 *
 * One dialog serves both "new" and "edit": a new snippet is only written to
 * the namespace when the dialog is saved, so abandoning a new snippet leaves
 * nothing behind. Closing a dirty dialog is a two-step in the same card
 * (a footer swap rather than a second modal on top), which keeps the
 * confirmation legible.
 *
 * Live CSS preview is the one thing that reaches the page before saving: when
 * `realTimePreview` is on and the buffer is CSS, every keystroke replaces a
 * dedicated preview `<style>` element. That element is removed on close, so a
 * discarded edit cannot linger.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
  Input,
  Modal,
  Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { indentUnitWidth, isValidCssContent, isValidJavaScript, reindent, snippetTitle } from '../../shared/model.ts'
import type { Snippet } from '../../shared/types.ts'
import type { EditorRequest, SnippetsController } from '../controller.ts'
import { PREFIX } from '../styles.ts'
import { createCodeEditor, type CodeEditorHandle } from './code-editor.ts'
import { useConfig, type T } from './shared.tsx'

/** Props for {@link EditorDialog}. */
export interface EditorDialogProps {
  controller: SnippetsController
  t: T
  request: EditorRequest
}

/** The dialog's transient status line. */
interface Status {
  tone: 'ok' | 'error' | 'muted'
  text: string
}

/** The configured indent unit as the literal whitespace it stands for. */
function indentText(unit: string): string {
  const { tabs, width } = indentUnitWidth(unit)
  return tabs ? '\t' : ' '.repeat(width)
}

/**
 * Render one snippet editor.
 * @param props - see {@link EditorDialogProps}.
 */
export function EditorDialog({ controller, t, request }: EditorDialogProps) {
  const config = useConfig(controller)
  const existing = request.id === null ? null : config.snippets.find((item) => item.id === request.id) ?? null
  const type = existing?.type ?? request.type

  const [name, setName] = useState(existing?.name ?? '')
  const [content, setContent] = useState(existing?.content ?? '')
  const [enabled, setEnabled] = useState(existing?.enabled ?? config.newSnippetEnabled)
  const [dirty, setDirty] = useState(existing === null)
  const [discarding, setDiscarding] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)

  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<CodeEditorHandle | null>(null)
  const previewOn = useRef(false)

  const initial = useRef({ name: existing?.name ?? '', content: existing?.content ?? '', enabled: existing?.enabled ?? false })

  /* ── editor lifecycle ───────────────────────────────────────────── */

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const handle = createCodeEditor(host, {
      doc: initial.current.content,
      type,
      indentUnit: config.editorIndentUnit,
      lineWrap: config.editorLineWrap,
      fontSize: config.editorFontSize,
      onChange: (value) => {
        setContent(value)
        setDirty(true)
        if (previewOn.current) controller.previewCss(value)
      },
    })
    editorRef.current = handle
    handle.focus()
    return () => {
      handle.destroy()
      editorRef.current = null
    }
    // Mount-only: later configuration changes are pushed through `configure`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    editorRef.current?.configure({
      type,
      indentUnit: config.editorIndentUnit,
      lineWrap: config.editorLineWrap,
      fontSize: config.editorFontSize,
    })
  }, [config.editorFontSize, config.editorIndentUnit, config.editorLineWrap, type])

  // A preview must never outlive the dialog.
  useEffect(() => {
    return () => { controller.previewCss(null) }
  }, [controller])

  const canPreview = type === 'css' && config.realTimePreview
  const togglePreview = (): void => {
    if (!canPreview) return
    const next = !previewOn.current
    previewOn.current = next
    controller.previewCss(next ? content : null)
    setStatus(next ? { tone: 'muted', text: t('editor.preview.active') } : null)
  }

  /* ── actions ────────────────────────────────────────────────────── */

  const close = (): void => {
    previewOn.current = false
    controller.previewCss(null)
    controller.closeEditor(request.key)
  }

  const requestClose = (): void => {
    if (dirty) {
      setDiscarding(true)
      return
    }
    close()
  }

  const format = (): void => {
    const current = editorRef.current?.getDoc() ?? content
    if (type === 'js' && !isValidJavaScript(current)) {
      setStatus({ tone: 'error', text: t('editor.formatFailed') })
      return
    }
    const result = reindent(current, indentText(config.editorIndentUnit))
    if (!result.ok) {
      setStatus({ tone: 'error', text: t('editor.formatSkipped') })
      return
    }
    if (result.content !== current) {
      editorRef.current?.setDocIfChanged(result.content)
      setContent(result.content)
      setDirty(true)
      if (previewOn.current) controller.previewCss(result.content)
    }
    setStatus({ tone: 'ok', text: t('editor.formatDone') })
  }

  const save = async (): Promise<void> => {
    let buffer = editorRef.current?.getDoc() ?? content

    if (buffer.trim() === '') {
      setStatus({ tone: 'error', text: t('editor.invalid.empty') })
      return
    }
    if (type === 'css' && config.validateCssContent && !isValidCssContent(buffer)) {
      setStatus({ tone: 'error', text: t('editor.invalid.css') })
      return
    }
    if (type === 'js' && config.validateJsSyntax && !isValidJavaScript(buffer)) {
      setStatus({ tone: 'error', text: t('editor.invalid.js') })
      return
    }
    if (config.formatOnSave) {
      const result = reindent(buffer, indentText(config.editorIndentUnit))
      if (result.ok) buffer = result.content
    }

    const before = existing?.content ?? ''
    const next: Snippet = {
      id: existing?.id ?? '',
      name: name.trim(),
      type,
      content: buffer,
      enabled,
      created: existing?.created ?? Date.now(),
    }
    if (existing === null) {
      await controller.addSnippet({ type, name: next.name, content: next.content, enabled: next.enabled })
    } else {
      await controller.saveSnippet({ ...next, id: existing.id })
    }

    previewOn.current = false
    controller.previewCss(null)
    controller.toast(t('notice.saved'))
    close()

    // A JS snippet that already ran cannot be re-applied, and one that is newly
    // enabled only takes effect on the next load — so reload, unless another
    // editor is still open with unsaved work in it.
    const jsChanged = type === 'js' && enabled && before !== buffer
    const othersOpen = controller.ui.get().editors.some((editor) => editor.key !== request.key)
    if (jsChanged && config.autoReloadAfterJsEdit && !othersOpen) {
      window.setTimeout(() => { controller.reload() }, 600)
    }
  }

  /** The snippet as the dialog currently shows it (nothing is stored until save). */
  const displaySnippet: Snippet = {
    id: existing?.id ?? '',
    name,
    type,
    content,
    enabled,
    created: existing?.created ?? 0,
  }

  const title = existing === null
    ? t(type === 'css' ? 'editor.new.css' : 'editor.new.js')
    : t('editor.edit')

  const description = useMemo(
    () => (type === 'js' ? t('confirm.js.body') : t('set.realTimePreview.desc')),
    [t, type],
  )

  return (
    <Modal
      open
      onClose={requestClose}
      title={title}
      description={description}
      closeLabel={t('action.close')}
      className={`${PREFIX}-editor-dialog`}
      contentClassName={`${PREFIX}-editor-body`}
      footer={
        discarding ? (
          <>
            <Button variant="outline" size="sm" onClick={() => { setDiscarding(false) }}>
              {t('editor.unsaved.continue')}
            </Button>
            <Button variant="primary" size="sm" onClick={close}>
              {t('editor.unsaved.discard')}
            </Button>
          </>
        ) : (
          <>
            {status !== null ? (
              <span className={`${PREFIX}-code-status`} data-tone={status.tone} role="status">
                {status.text}
              </span>
            ) : dirty ? (
              <span className={`${PREFIX}-code-status`}>{t('editor.dirty')}</span>
            ) : null}
            <span className={`${PREFIX}-editor-toolbar-spacer`} />
            <Button variant="ghost" size="sm" onClick={requestClose}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => { void save() }}>
              {t('action.save')}
            </Button>
          </>
        )
      }
    >
      <div className={`${PREFIX}-editor-meta`}>
        <span className={`${PREFIX}-editor-name`}>
          <Input
            value={name}
            aria-label={t('editor.name')}
            placeholder={t('editor.name.placeholder')}
            onChange={(event) => { setName(event.target.value); setDirty(true) }}
          />
        </span>
        <Switch
          checked={enabled}
          onChange={(next) => { setEnabled(next); setDirty(true) }}
          label={t('editor.enabled')}
          title={t('editor.enabled.hint')}
        />
      </div>

      <div className={`${PREFIX}-editor-toolbar`}>
        {canPreview ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={togglePreview}
            aria-pressed={previewOn.current}
          >
            {previewOn.current ? t('editor.preview.stop') : t('editor.preview.apply')}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular size={14} />} onClick={format}>
          {t('action.format')}
        </Button>
        {existing !== null && config.showDeleteButton ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<IconTrashOutlineRegular size={14} />}
            onClick={() => {
              void (async () => {
                if (config.confirmDelete) {
                  const accepted = await controller.confirm({
                    title: t('confirm.delete.title'),
                    body: t('confirm.delete.body', { name: snippetTitle(displaySnippet) || t('word.none') }),
                    confirmLabel: t('action.delete'),
                    cancelLabel: t('action.cancel'),
                    tone: 'danger',
                  })
                  if (!accepted) return
                }
                await controller.deleteSnippet(existing.id)
                controller.toast(t('notice.deleted'))
                close()
              })()
            }}
          >
            {t('action.delete')}
          </Button>
        ) : null}
        <span className={`${PREFIX}-editor-toolbar-spacer`} />
        <span className={`${PREFIX}-code-status`}>
          {t(type === 'css' ? 'tab.css' : 'tab.js')} · {t('editor.theme')}
        </span>
      </div>

      {/* Height comes from the flex chain (dialog → content → body → here),
          so the editor fills the card instead of a hard-coded 46vh. */}
      <div className={`${PREFIX}-code-scope`}>
        <div ref={hostRef} className={`${PREFIX}-cm`} />
      </div>

      {discarding ? (
        <div className={`${PREFIX}-hint`} data-tone="warn">
          {t('editor.unsaved.body', { name: snippetTitle(displaySnippet) || t('word.none') })}
        </div>
      ) : null}
    </Modal>
  )
}
