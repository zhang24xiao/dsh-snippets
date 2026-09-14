/**
 * Best-effort navigation from the manager panel's gear button to this plugin's
 * own page inside the official settings panel.
 *
 * ## Why this is best-effort rather than a call
 *
 * The settings shell keeps its open state and active section id in
 * component-local state (`ui-settings-general`'s `SettingsRoot`), and exposes
 * no service for another plugin to drive them. There is therefore no supported
 * "open settings at section X" call.
 *
 * What IS stable is the accessibility contract, which is a public interface:
 *
 *  - the sidebar-foot trigger is `button[aria-haspopup="dialog"]` inside the
 *    same `footArea` container our own entry lives in;
 *  - the open panel is `[role="dialog"][aria-modal="true"]`, whose `<nav>`
 *    holds one `<button>` per registered section, labelled with the section's
 *    registered `label` — which is our own localized string.
 *
 * Both steps are wrapped: if the shell changes, the click does nothing and the
 * user opens Settings themselves. Nothing else in the plugin depends on this.
 */

/** How long to keep looking for the section row after opening the panel. */
const SECTION_POLL_MS = 900
/** Poll cadence while looking for the section row. */
const SECTION_POLL_STEP_MS = 60

/**
 * Find the sidebar-foot settings trigger, walking up from our own entry until
 * the shared footer container that also holds the settings control.
 */
function findSettingsTrigger(from: HTMLElement | null): HTMLElement | null {
  let node = from?.parentElement ?? null
  for (let depth = 0; depth < 5 && node !== null; depth += 1) {
    const candidates = Array.from(node.querySelectorAll<HTMLElement>('button[aria-haspopup="dialog"]'))
    const outside = candidates.find((button) => from === null || !from.contains(button))
    if (outside !== undefined) return outside
    node = node.parentElement
  }
  return null
}

/** The open settings dialog, if there is one. */
function settingsDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
}

/** Click the nav row whose label matches, once it exists. */
function selectSection(label: string, deadline: number): void {
  const dialog = settingsDialog()
  if (dialog !== null) {
    const row = Array.from(dialog.querySelectorAll<HTMLElement>('nav button')).find(
      (button) => (button.textContent ?? '').trim() === label,
    )
    if (row !== undefined) {
      row.click()
      return
    }
  }
  if (Date.now() > deadline) return
  window.setTimeout(() => { selectSection(label, deadline) }, SECTION_POLL_STEP_MS)
}

/**
 * Open the settings panel on this plugin's section.
 * @param from - our own trigger element, used to locate the settings control.
 * @param sectionLabel - the section's localized label, as registered.
 * @returns whether the trigger was found and clicked.
 */
export function openSettingsSection(from: HTMLElement | null, sectionLabel: string): boolean {
  try {
    const trigger = findSettingsTrigger(from)
    if (trigger === null) return false
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click()
    selectSection(sectionLabel, Date.now() + SECTION_POLL_MS)
    return true
  } catch {
    // A DOM shape we do not recognise is not an error worth surfacing.
    return false
  }
}
