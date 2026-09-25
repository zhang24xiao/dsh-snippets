/**
 * Opening this plugin's settings card from the snippet manager panel.
 *
 * The settings used to live on a page of their own in the **Settings**
 * navigation, and the panel's gear button walked the settings DOM to that
 * page. They now live on this package's page inside the official **Plugins**
 * manager (seat `plugins.bundle.config`), so the gear has two things to do:
 * select the Plugins main panel, and open this bundle's detail page on it.
 *
 * ## Why this is best-effort rather than a call
 *
 * Selecting the main panel IS a supported call — `ctx.layout.selectPanel`
 * takes the registered panel id, and the manager's own id is the stable
 * `plugins` its sidebar entry is registered under. Opening one *bundle's*
 * detail page is not: the manager keeps the open row in component-local state
 * and exposes no service, so the only stable handle is the accessibility
 * contract of the list:
 *
 *  - every bundle card's title is a `button` labelled with the package name
 *    (`packageText.title` is `pkg.name` for a third-party package), and
 *  - clicking it opens that bundle's page, which mounts the settings card.
 *
 * Both steps are wrapped: if the manager changes shape, the panel still opens
 * and the user picks the bundle themselves. Nothing else in the plugin depends
 * on this.
 *
 * ## Marking the card open
 *
 * The card mounts only after the manager page renders it, i.e. after the click
 * below, so a plain "set open" would have nothing to set. The module therefore
 * keeps one pending mark: `requestSettingsOpen()` raises it and notifies any
 * card already on screen; `takeSettingsOpen()` consumes it on the first mount.
 * A card that mounts later still finds it.
 */

/** How long to keep looking for this bundle's card in the manager list. */
const CARD_POLL_MS = 1500
/** Poll cadence while looking for the card. */
const CARD_POLL_STEP_MS = 60

/** The official Plugins manager's main-panel id (its sidebar entry's own id). */
const PLUGINS_PANEL_ID = 'plugins'

/** Pending open mark, consumed by the card's first mount. */
let pendingOpen = false
/** Cards currently on screen, notified when the mark is raised. */
const openListeners = new Set<() => void>()

/** Mark the settings card for expansion, now or when it next mounts. */
export function requestSettingsOpen(): void {
  pendingOpen = true
  for (const listener of Array.from(openListeners)) listener()
}

/**
 * Consume the pending open mark.
 * @returns whether expansion was asked for since the last consumption.
 */
export function takeSettingsOpen(): boolean {
  const open = pendingOpen
  pendingOpen = false
  return open
}

/**
 * Subscribe to expansion requests while a card is on screen.
 * @param listener - called on every request.
 * @returns the unsubscribe function.
 */
export function onSettingsOpen(listener: () => void): () => void {
  openListeners.add(listener)
  return () => { openListeners.delete(listener) }
}

/** The list card whose title is exactly this package's name, if it is showing. */
function bundleCard(packageName: string): HTMLElement | null {
  const buttons = document.querySelectorAll<HTMLElement>('button')
  for (const button of buttons) {
    if ((button.textContent ?? '').trim() === packageName) return button
  }
  return null
}

/** Click this bundle's card once it exists, giving up at the deadline. */
function openCard(packageName: string, deadline: number): void {
  const card = bundleCard(packageName)
  if (card !== null) {
    card.click()
    return
  }
  if (Date.now() > deadline) return
  window.setTimeout(() => { openCard(packageName, deadline) }, CARD_POLL_STEP_MS)
}

/** What {@link openPluginSettings} needs from the caller's context. */
export interface OpenPluginSettingsOptions {
  /**
   * The installed package name, as the manager's bundle card shows it. It is
   * both the card to click and the seat key whose settings card expands.
   */
  packageName: string
  /**
   * Select the manager's main panel. Absent when the layout service is not
   * available, in which case only the DOM steps are attempted.
   */
  selectPanel?: ((panelId: string) => void) | undefined
}

/**
 * Open this plugin's page in the Plugins manager, with its settings card
 * expanded.
 * @param options - see {@link OpenPluginSettingsOptions}.
 * @returns whether the Plugins panel was selected.
 */
export function openPluginSettings(options: OpenPluginSettingsOptions): boolean {
  requestSettingsOpen()
  let selected = false
  try {
    if (options.selectPanel !== undefined) {
      options.selectPanel(PLUGINS_PANEL_ID)
      selected = true
    }
  } catch {
    // The panel id is not registered in this deployment: the DOM steps below
    // may still work if the manager is already showing, so keep going.
  }
  try {
    openCard(options.packageName, Date.now() + CARD_POLL_MS)
  } catch {
    // A DOM shape we do not recognise is not an error worth surfacing.
  }
  return selected
}
