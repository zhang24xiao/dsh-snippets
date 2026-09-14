/**
 * The overlay host: every dialog and banner the plugin owns.
 *
 * Registered into `shell.overlay`, the frame-wide floating layer. The layer is
 * click-through and the primitives portal themselves to `document.body`, so
 * this entry contributes no box of its own — when nothing is open it renders
 * nothing at all and the application underneath is untouched.
 *
 * Holding the dialogs here rather than inside the manager panel is what lets an
 * editor survive the panel closing, and lets a confirmation raised from the
 * settings page and one raised from the panel render identically.
 */
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { dismissToast, settleConfirm, type SnippetsController } from '../controller.ts'
import { PREFIX } from '../styles.ts'
import { EditorDialog } from './EditorDialog.tsx'
import { useUi, type T } from './shared.tsx'

/** Props for {@link OverlayHost}. */
export interface OverlayHostProps {
  controller: SnippetsController
  t: T
}

/**
 * Render the open editors, confirmations and toasts.
 * @param props - see {@link OverlayHostProps}.
 */
export function OverlayHost({ controller, t }: OverlayHostProps) {
  const ui = useUi(controller)

  return (
    <>
      {ui.editors.map((request) => (
        <EditorDialog key={request.key} controller={controller} t={t} request={request} />
      ))}

      {ui.confirms.map((request) => (
        <Modal
          key={request.key}
          open
          onClose={() => { settleConfirm(controller, request.key, false) }}
          title={request.title}
          closeLabel={t('action.close')}
          className={`${PREFIX}-confirm`}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => { settleConfirm(controller, request.key, false) }}>
                {request.cancelLabel}
              </Button>
              <Button
                variant={request.tone === 'danger' ? 'primary' : 'primary'}
                size="sm"
                onClick={() => { settleConfirm(controller, request.key, true) }}
              >
                {request.confirmLabel}
              </Button>
            </>
          }
        >
          <p className={`${PREFIX}-intro`}>{request.body}</p>
        </Modal>
      ))}

      {ui.toasts.map((toast) => (
        <Toast
          key={toast.key}
          text={toast.text}
          onDone={() => { dismissToast(controller, toast.key) }}
        />
      ))}
    </>
  )
}
