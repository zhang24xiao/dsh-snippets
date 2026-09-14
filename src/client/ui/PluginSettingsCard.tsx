/**
 * This plugin's card in **Settings → Plugins → Plugin configuration**.
 *
 * The seat is `settings.plugin.item`, a keyed slot the Plugins section's
 * `configurable` tab declares and dispatches **keyed by the settings namespace a
 * card edits**. This plugin's host half already registers the `dsh-snippets`
 * namespace, so registering a card under that same key is the whole pairing —
 * the tab never learns what the namespace means, and this package needs no
 * relationship with the tab beyond the slot's type.
 *
 * The card renders itself as an `<li>`, because the tab stacks cards inside a
 * `<ul>`, and reproduces the neighbouring cards' chrome value for value
 * (radius 16, `.5px` border, 15px/600 name over a 13px description, a rotating
 * chevron, and a body inset by 16px under a hairline rule) using the same
 * `--dsw-*` tokens, so it sits in that list without looking imported.
 *
 * One deliberate difference from its neighbours: the body applies every change
 * immediately and therefore has no Save / Discard footer. A snippet manager is
 * used by flipping a switch and watching the page react, and a staging layer
 * would put a Save between those two halves of the same gesture.
 */
import { useState } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnippetsController } from '../controller.ts'
import { PREFIX } from '../styles.ts'
import { SettingsBody } from './SettingsBody.tsx'
import type { T } from './shared.tsx'

/** Props for {@link PluginSettingsCard}. */
export interface PluginSettingsCardProps {
  controller: SnippetsController
  t: T
}

/**
 * Render the Code Snippets card.
 * @param props - see {@link PluginSettingsCardProps}.
 */
export function PluginSettingsCard({ controller, t }: PluginSettingsCardProps) {
  const [open, setOpen] = useState(false)
  const bodyId = 'dsh-snippets-card-body'

  return (
    <li className={`${PREFIX}-pcard${open ? ` ${PREFIX}-pcard-open` : ''}`}>
      <button
        type="button"
        className={`${PREFIX}-pcard-head`}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => { setOpen((value) => !value) }}
      >
        <span className={`${PREFIX}-pcard-text`}>
          <span className={`${PREFIX}-pcard-name`}>{t('section.title')}</span>
          <span className={`${PREFIX}-pcard-desc`}>{t('section.description')}</span>
        </span>
        <span className={`${PREFIX}-pcard-chevron`} data-open={open ? 'true' : undefined} aria-hidden="true">
          <IconChevronDownOutline14 size={14} />
        </span>
      </button>
      {open
        ? (
            <div className={`${PREFIX}-pcard-body`} id={bodyId}>
              <SettingsBody controller={controller} t={t} />
            </div>
          )
        : null}
    </li>
  )
}
