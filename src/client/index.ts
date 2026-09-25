/**
 * dsh-snippets — browser half.
 *
 * Registers exactly three things and owns nothing else:
 *
 *  - `sidebar.footer.action` — the `</>` quick toggle and its manager panel,
 *    in the same sidebar-foot row `@linxin666/dsh-remote-web-ui` uses (the seat
 *    the SiYuan original puts its top-bar button in, translated to DSH);
 *  - `plugins.bundle.config` — the collapsible settings card on this package's
 *    page in the official **Plugins** manager, keyed by the package name so the
 *    page dispatches it to this bundle (the seat the same remote-access plugin
 *    puts its own card in). The settings used to be a page of their own in the
 *    Settings navigation; they now live here, and the manager panel's gear opens
 *    them through `deep-link.ts`;
 *  - `shell.overlay` — the editors, confirmations and toasts, so a dialog
 *    survives the panel closing and renders above every column.
 *
 * The snippet library is read and written through the shared settings form for
 * the `dsh-snippets` entry — the host half exposes that entry by exporting its
 * schema, and `ctx.configForms.get` is the settings provider's accessor for it.
 * No snippet data crosses a bespoke endpoint, which is what keeps the feature
 * safe on a LAN or tunneled deployment: an unpaired visitor can never reach a
 * route that would inject code into someone's page.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the renderer's `ctx.slots` Context merge and the
// `shell.overlay` seat declaration.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { NAMESPACE } from '../shared/schema.ts'
import type { FooterPosition, SnippetsConfig } from '../shared/types.ts'
import { PLUGIN_PACKAGE } from '../shared/version.ts'
import { createController, type SnippetsController } from './controller.ts'
import { openPluginSettings } from './deep-link.ts'
import { en, zh } from './locales.ts'
import { installGlobal } from './apply.ts'
import { STYLE_ATTRIBUTE, UI_CSS } from './styles.ts'
import { FooterEntry } from './ui/FooterEntry.tsx'
import { OverlayHost } from './ui/OverlayHost.tsx'
import { PluginSettingsCard, type PluginConfigViewProps } from './ui/PluginSettingsCard.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One bundle's own configuration on its page in the official Plugins
     * manager, keyed by the bundle's npm package name.
     *
     * Declared here rather than imported from the manager package: cross-plugin
     * collaboration goes through cordis services, a value import of another
     * plugin's package fails the client bundle-purity gate, and this shape is
     * the whole of what the manager passes (the page always asks for `'page'`).
     */
    'plugins.bundle.config': {
      kind: 'keyed'
      scope: 'root'
      owner: PluginConfigViewProps
    }
  }
}

/** Cordis plugin name; the loader keys the browser entry on it. */
export const name = 'dsh-snippets'

/** Dictionary namespace owned by this plugin. */
const NS = 'snippets'

/**
 * Services this plugin needs before it can register anything.
 *
 * `configForms` is the settings provider's shared-form service. It is a plain
 * service dependency, not a `dsh.client` entry: the latter lists the packages
 * whose browser halves must be loaded first, and those are declared in
 * `package.json` instead.
 */
export const inject = ['slots', 'locale', 'configForms']

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

  // Our settings namespace IS this plugin's own profile entry id, so the shared
  // form is looked up by that id directly. `get` is the settings provider's
  // accessor for cross-plugin consumers: it keys one form per entry id and
  // writes through the provider's own fiber, so this half needs no `remote`
  // dependency of its own. The form's own decoder is not selectable from here,
  // which is why the controller narrows every section with `decodeConfig`.
  const form = ctx.configForms.get<SnippetsConfig>(NAMESPACE)
  const controller: SnippetsController = createController(form)
  // Unloading removes every `<style>` this plugin injected, including the
  // preview element and the applied snippets themselves.
  ctx.effect(() => () => { controller.dispose() }, 'dsh-snippets: runtime teardown')

  // No bound `t` here: every seat declares `locale: NS`, and the render
  // machinery synthesizes the typed `t` seat for each component from that.

  /**
   * Open this package's page in the official Plugins manager with its settings
   * card expanded — what the manager panel's gear button does.
   *
   * The layout service is resolved lazily: it is what provides `selectPanel`,
   * and while the manager's panel id is registered long before anyone clicks,
   * the service need not have been provided when this plugin applies.
   */
  const openSettings = (): void => {
    const layout = ctx.get('layout') as { selectPanel?: (panelId: string) => void } | undefined
    const selectPanel = typeof layout?.selectPanel === 'function'
      ? (panelId: string) => { layout?.selectPanel?.(panelId) }
      : undefined
    openPluginSettings({ packageName: PLUGIN_PACKAGE, selectPanel })
  }

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
            inject: () => ({ controller, openSettings }),
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

  /* ── the settings card on the package's page in the Plugins manager ─ */

  // `plugins.bundle.config` is a keyed seat: the manager's page keys one entry
  // per bundle by the bundle's npm package name and renders it on that bundle's
  // detail page. The key is read from the build manifest, since a key that does
  // not equal the installed package's name is dropped without a word and would
  // leave the page with no card at all. The seat's own page draws the icon,
  // title, version and switch; the card owns the header, body and collapse.
  ctx.slots.inject('plugins.bundle.config', () => {
    try {
      return ctx.slots.register(
        {
          name: 'plugins.bundle.config',
          key: PLUGIN_PACKAGE,
          locale: NS,
          inject: () => ({ controller }),
        },
        PluginSettingsCard,
      )
    } catch {
      // A refused registration leaves the user without a card; the plugin's
      // other surfaces, and the manager panel's own controls, still work.
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
