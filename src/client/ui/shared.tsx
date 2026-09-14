/**
 * Shared plumbing for every surface: the two store hooks, the host-status
 * probe, and the one place the JS-enable confirmation lives.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { Snippet, SnippetsConfig } from '../../shared/types.ts'
import type { SnippetsController, UiState } from '../controller.ts'
import * as host from '../host-api.ts'

/** The plugin's bound translate function. */
export type T = TranslateNS<'snippets'>

/** Join class names, dropping the falsey ones. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ')
}

/** Subscribe to the settings snapshot. */
export function useConfig(controller: SnippetsController): SnippetsConfig {
  return useSyncExternalStore(controller.subscribe, controller.getConfig, controller.getConfig)
}

/** Subscribe to the plugin's own UI state. */
export function useUi(controller: SnippetsController): UiState {
  return useSyncExternalStore(controller.ui.subscribe, controller.ui.get, controller.ui.get)
}

/** The host bridge's self-report, plus a manual refresh. */
export interface HostStatusState {
  /** `null` while loading or when the bridge is unavailable/refused. */
  status: host.HostStatus | null
  /** True until the first probe settles. */
  loading: boolean
  /** The last failure code, or `null`. */
  error: string | null
  /** Re-probe. */
  refresh: () => void
}

/** Probe the host bridge once, and on demand. */
export function useHostStatus(): HostStatusState {
  const [status, setStatus] = useState<host.HostStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    host
      .status()
      .then((next) => {
        if (!alive) return
        setStatus(next)
        setError(next === null ? 'unavailable' : null)
      })
      .catch((cause: unknown) => {
        if (!alive) return
        setStatus(null)
        setError(cause instanceof host.HostError ? cause.code : 'unavailable')
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [nonce])

  const refresh = useCallback(() => { setNonce((value) => value + 1) }, [])
  return { status, loading, error, refresh }
}

/**
 * Enable or disable a snippet, keeping the JS risk confirmation in one place.
 *
 * Enabling JS is the only action in this plugin that can execute arbitrary
 * code in the user's page, so when `confirmJsExecution` is on it asks first —
 * from the panel and from the settings page alike.
 */
export function useToggleSnippet(
  controller: SnippetsController,
  t: T,
): (snippet: Snippet, next: boolean) => Promise<void> {
  const config = useConfig(controller)
  return useCallback(
    async (snippet, next) => {
      if (next && snippet.type === 'js' && config.confirmJsExecution) {
        const accepted = await controller.confirm({
          title: t('confirm.js.title'),
          body: t('confirm.js.body'),
          confirmLabel: t('action.confirm'),
          cancelLabel: t('action.cancel'),
          tone: 'danger',
        })
        if (!accepted) return
      }
      await controller.setEnabled(snippet.id, next)
    },
    [config.confirmJsExecution, controller, t],
  )
}

/**
 * Turn a thrown host failure into a localized toast.
 *
 * The lookup chain falls back to the key itself when a namespace misses, so a
 * `gist.error.<code>` key with no entry is detected by comparing the result to
 * the key and replaced with the generic message.
 */
export function useFailureToast(controller: SnippetsController, t: T): (cause: unknown) => void {
  return useCallback(
    (cause: unknown) => {
      const code = cause instanceof host.HostError ? cause.code : 'unknown'
      const key = `gist.error.${code}` as Parameters<T>[0]
      const text = t(key, { code })
      controller.toast(text === key ? t('gist.error.unknown', { code }) : text)
    },
    [controller, t],
  )
}

/** True when the platform treats this as a reduced-motion request. */
export function usePrefersReducedMotion(): boolean {
  return useMemo(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      return false
    }
  }, [])
}
