/**
 * This plugin's page in the **Settings** navigation.
 *
 * The seat is `settings.section`: the settings panel's left nav renders one
 * entry per registrant and mounts the contribution inside the content column.
 * The shell supplies no copy and no chrome of its own, so this page owns its
 * heading and its description, and `SettingsBody` owns every row below them.
 *
 * The seat that used to carry this surface — the per-namespace card
 * `settings.plugin.item` inside the Plugins section — no longer exists, and a
 * registration against it is dropped silently rather than reported. That is how
 * this page once went missing from the UI while its settings stayed intact, so
 * the surface lives on this seat instead of being repaired in place.
 *
 * As of DSH 0.1.7 the settings values are reachable only through
 * `ctx.configForms.get(entryId)`, where the entry id is this plugin's own id:
 * the plugin exports a `Config` schema and the host serves its volatile fields,
 * rather than the plugin registering a namespace of its own.
 *
 * One deliberate difference from the neighbouring settings pages: every control
 * writes straight through the controller and there is no Save / Discard footer.
 * A snippet manager is used by flipping a switch and watching the page react,
 * and a staging layer would put a Save between those two halves.
 */
import type { SnippetsController } from '../controller.ts'
import { PREFIX } from '../styles.ts'
import { SettingsBody } from './SettingsBody.tsx'
import type { T } from './shared.tsx'

/** Props for {@link SettingsPage}. */
export interface SettingsPageProps {
  controller: SnippetsController
  t: T
}

/**
 * Render the Code Snippets settings page.
 * @param props - see {@link SettingsPageProps}.
 */
export function SettingsPage({ controller, t }: SettingsPageProps) {
  return (
    <div className={`${PREFIX}-settings`}>
      <h2 className={`${PREFIX}-settings-title`}>{t('section.title')}</h2>
      <p className={`${PREFIX}-settings-desc`}>{t('section.description')}</p>
      <SettingsBody controller={controller} t={t} />
    </div>
  )
}
