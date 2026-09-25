/**
 * The plugin's settings card on its own page in the official **Plugins**
 * manager.
 *
 * The seat is `plugins.bundle.config`: the manager page keys one entry per
 * bundle by the bundle's npm package name and renders it on that bundle's
 * detail page, between the description and the list of components the bundle
 * declares. That is the surface a user reaches by opening **Plugins** in the
 * sidebar and clicking this package, and it is where the remote-access plugin
 * shows its own settings — this card keeps the same shape: a bordered header
 * carrying the title, a one-line description and a chevron, with the whole
 * body collapsed until the user asks for it.
 *
 * The card owns its chrome because the seat supplies none: the page draws the
 * bundle's icon, name, version and switch, and then mounts whatever the
 * registrant renders. A registration whose key does not equal the installed
 * package's name is silently skipped, which is why the seat's `key` is read
 * from the build manifest rather than spelled out here (see `index.ts`).
 *
 * The body is `SettingsBody` under a collapsed header, so the seat change did
 * not touch a single pref row. The expand state is local, but the sidebar
 * manager panel's gear opens the page through `deep-link.ts`, which marks the
 * card for expansion before the page even exists — `takeSettingsOpen` covers
 * that first mount, and `onSettingsOpen` covers a card already on screen.
 */
import { useEffect, useState } from 'react'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnippetsController } from '../controller.ts'
import { onSettingsOpen, takeSettingsOpen } from '../deep-link.ts'
import { PREFIX } from '../styles.ts'
import { SettingsBody } from './SettingsBody.tsx'
import type { T } from './shared.tsx'

/** The owner share the manager page passes every `plugins.bundle.config` entry. */
export interface PluginConfigViewProps {
  /** `summary` is the bundle card's one-liner; `page` is the form behind it. */
  readonly view: 'summary' | 'page'
}

/** Props this card renders with: the seat's owner share, `t`, and its inject face. */
export interface PluginSettingsCardProps extends Partial<PluginConfigViewProps> {
  /** The settings controller every row writes through. */
  controller: SnippetsController
  /** The plugin's bound translate function. */
  t: T
}

/**
 * Render the collapsed settings card, or its one-liner for the summary view.
 * @param props - see {@link PluginSettingsCardProps}.
 */
export function PluginSettingsCard({ controller, t, view = 'page' }: PluginSettingsCardProps) {
  // The gear on the manager panel may have asked for this card before it
  // mounted, in which case the pending mark is consumed by this initializer.
  const [open, setOpen] = useState(takeSettingsOpen)
  // …and while it is mounted, the ask arrives as an event instead.
  useEffect(() => onSettingsOpen(() => { setOpen(true) }), [])

  if (view === 'summary') {
    return (
      <div className={`${PREFIX}-card ${PREFIX}-card-summary`}>
        <div className={`${PREFIX}-card-header`}>
          <CardText t={t} />
        </div>
      </div>
    )
  }

  return (
    <section className={`${PREFIX}-card`} data-open={open ? 'true' : undefined}>
      <button
        type="button"
        className={`${PREFIX}-card-header`}
        aria-expanded={open}
        onClick={() => { setOpen((value) => !value) }}
      >
        <CardText t={t} />
        <span className={`${PREFIX}-card-chevron`} aria-hidden="true">
          <IconChevronDownOutlineRegular size={16} />
        </span>
      </button>
      {open
        ? (
            <div className={`${PREFIX}-card-body`}>
              <SettingsBody controller={controller} t={t} />
            </div>
          )
        : null}
    </section>
  )
}

/** The header's title + description column, shared by both views. */
function CardText({ t }: { t: T }) {
  return (
    <span className={`${PREFIX}-card-text`}>
      <span className={`${PREFIX}-card-name`}>{t('card.title')}</span>
      <span className={`${PREFIX}-card-desc`}>{t('card.description')}</span>
    </span>
  )
}
