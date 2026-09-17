/**
 * The `sidebar.footer.action` seat: the `</>` trigger and the manager panel.
 *
 * This is the seat `@linxin666/dsh-remote-web-ui` uses for its phone entry, so
 * the snippet manager's quick toggle lands in exactly the same row of the
 * sidebar foot, directly beside the Settings control. Its side is configurable
 * (`footerPosition` → an ascending `order`), which is this plugin's answer to
 * the SiYuan original's `topBarPosition`.
 *
 * The panel is portaled to `document.body` and anchored above the trigger, so
 * the sidebar's own scroll containers and overflow cannot clip it.
 *
 * The trigger follows the footer's two column states, and its geometry is
 * copied value for value from the Settings row above it, because the two read
 * as one stack of full-width rows:
 *
 *   wide   a 42px full-width row: `</>` at the left, then the label 8px later
 *   rail   a bare 36px circle, like the neighbouring rail actions
 *
 * That means the wide state carries a label, while the rail keeps the icon
 * alone — the rail has no room for a word, and the tooltip already carries the
 * name plus the live counts.
 */
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnippetsController } from '../controller.ts'
import { openSettingsSection } from '../deep-link.ts'
import { PREFIX } from '../styles.ts'
import { CodeGlyph } from './icons.tsx'
import { ManagerPanel } from './ManagerPanel.tsx'
import { useConfig, type T } from './shared.tsx'

/** Props supplied through the slot's inject face plus the seat's own `wide`. */
export interface FooterEntryProps {
  controller: SnippetsController
  t: T
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/**
 * Render the footer trigger and its panel.
 * @param props - see {@link FooterEntryProps}.
 */
export function FooterEntry({ controller, t, wide }: FooterEntryProps) {
  const config = useConfig(controller)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const position = useAnchoredPosition({
    open,
    anchorRef,
    panelRef,
    side: 'top',
    gap: 8,
    margin: 8,
  })
  // The panel is portaled outside the trigger, so it counts as "inside" too.
  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef)

  const enabledCount = config.snippets.filter((snippet) => snippet.enabled).length
  // The tip carries the name and the live counts. In the wide column the name
  // is already on screen, so the tip adds the counts only.
  const tooltip =
    enabledCount > 0
      ? `${t('trigger.label')} · ${t('panel.footer.count', {
          total: config.snippets.length,
          enabled: enabledCount,
        })}`
      : t('trigger.open')

  return (
    <div className={`${PREFIX}-entry`} data-wide={wide ? 'wide' : undefined} ref={rootRef}>
      <button
        ref={anchorRef}
        type="button"
        className={`${PREFIX}-trigger`}
        data-wide={wide ? 'wide' : undefined}
        data-rail={wide ? undefined : 'rail'}
        aria-label={t('trigger.open')}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={tooltip}
        onClick={() => { setOpen((value) => !value) }}
      >
        <CodeGlyph size={wide ? 16 : 18} />
        {wide
          ? <span className={`${PREFIX}-trigger-label`}>{t('trigger.label')}</span>
          : null}
      </button>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              className={`${PREFIX}-panel`}
              style={{ ...(position ?? { visibility: 'hidden' }), maxHeight: 'min(60vh, 480px)' }}
              role="dialog"
              aria-label={t('panel.title')}
            >
              <ManagerPanel
                controller={controller}
                t={t}
                onClose={() => { setOpen(false) }}
                onOpenSettings={() => {
                  // Best effort; see deep-link.ts for why there is no call.
                  openSettingsSection(rootRef.current, t('section.title'))
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
