/**
 * dsh-snippets — browser half.
 *
 * Registers exactly three things and owns nothing else:
 *
 *  - `sidebar.footer.action` — the `</>` quick toggle and its manager panel,
 *    in the same sidebar-foot row `@linxin666/dsh-remote-web-ui` uses (the seat
 *    the SiYuan original puts its top-bar button in, translated to DSH);
 *  - `settings.section` — an independent "Code Snippets" page in the settings
 *    navigation, not a card inside the plugin group;
 *  - `shell.overlay` — the editors, confirmations and toasts, so a dialog
 *    survives the panel closing and renders above every column.
 *
 * The snippet library itself is read and written through `ctx.settingsScope`
 * on the `dsh-snippets` namespace the host half registered, and the runtime
 * projects it onto the page. No snippet data crosses a bespoke endpoint, which
 * is what keeps the feature safe on a LAN or tunneled deployment: an unpaired
 * visitor can never reach a route that would inject code into someone's page.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the renderer's `ctx.slots` Context merge and the
// `shell.overlay` seat declaration.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { NAMESPACE, decodeConfig } from '../shared/schema.ts'
import type { FooterPosition, SnippetsConfig } from '../shared/types.ts'
import { createController, type SnippetsController } from './controller.ts'
import { en, zh } from './locales.ts'
import { installGlobal } from './apply.ts'
import { STYLE_ATTRIBUTE, UI_CSS } from './styles.ts'
import { FooterEntry } from './ui/FooterEntry.tsx'
import { OverlayHost } from './ui/OverlayHost.tsx'
import { SettingsPage } from './ui/SettingsPage.tsx'

/** Cordis plugin name; the loader keys the browser entry on it. */
export const name = 'dsh-snippets'

/** Dictionary namespace owned by this plugin. */
const NS = 'snippets'

/** Services this plugin needs before it can register anything. */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * The `order` that places the quick toggle on one side of the other footer
 * actions. `dsh-remote-web-ui` registers without an `order`, i.e. 0, so a
 * negative value lands left of its phone entry and a positive one to the right.
 */
function orderFor(position: FooterPosition): number {
  return position === 'left' ? -10 : 10
}

/**
 * Register the snippet surfaces.
 * @param ctx - the client root context.
 */
export function apply(ctx: ClientContext): void {
  // One injected stylesheet for every surface, removed with the plugin.
  const style = document.createElement('style')
  style.setAttribute(STYLE_ATTRIBUTE, '')
  style.textContent = UI_CSS
  document.head.appendChild(style)
  ctx.effect(() => () => { style.remove() }, 'dsh-snippets: stylesheet')

  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      // A dictionary collision must not take the plugin down; the keys then
      // resolve through the lookup chain's own fallback.
      return () => {}
    }
  }, 'dsh-snippets: dictionaries')

  installGlobal((...args) => { console.info('[dsh-snippets]', ...args) })

  const scope = ctx.settingsScope.bind<SnippetsConfig>({
    namespace: NAMESPACE,
    decode: decodeConfig,
  })
  const controller: SnippetsController = createController(scope)
  // Unloading removes every `<style>` this plugin injected, including the
  // preview element and the applied snippets themselves.
  ctx.effect(() => () => { controller.dispose() }, 'dsh-snippets: runtime teardown')

  const t = ctx.locale.bind(NS)

  /* ── the sidebar-foot quick toggle ──────────────────────────────── */

  ctx.slots.inject('sidebar.footer.action', () => {
    let dispose: (() => void) | undefined
    let applied: FooterPosition | null = null

    const sync = (): void => {
      const position = controller.getConfig().footerPosition
      // `order` is fixed at registration, so a position change re-registers.
      if (dispose !== undefined && applied === position) return
      dispose?.()
      try {
        dispose = ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: NAMESPACE,
            order: orderFor(position),
            locale: NS,
            inject: () => ({ controller }),
          },
          FooterEntry,
        )
        applied = position
      } catch {
        dispose = undefined
      }
    }

    const unsubscribe = controller.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      dispose?.()
      dispose = undefined
    }
  })

  /* ── the independent settings page ─────────────────────────────── */

  ctx.slots.inject('settings.section', () => {
    try {
      return ctx.slots.register(
        {
          name: 'settings.section',
          id: NAMESPACE,
          order: 30,
          // Re-registered by the shell on locale change, so a thunk keeps the
          // nav label in the active language.
          label: () => t('section.title'),
          locale: NS,
          inject: () => ({ controller }),
        },
        SettingsPage,
      )
    } catch {
      return () => {}
    }
  })

  /* ── dialogs and banners ────────────────────────────────────────── */

  ctx.slots.inject('shell.overlay', () => {
    try {
      return ctx.slots.register(
        {
          name: 'shell.overlay',
          id: NAMESPACE,
          order: 50,
          locale: NS,
          inject: () => ({ controller }),
        },
        OverlayHost,
      )
    } catch {
      return () => {}
    }
  })
}
