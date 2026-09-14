/**
 * The snippet runtime: what "enabled" actually means.
 *
 * - A **CSS** snippet becomes one `<style data-dsh-snippet="<id>">` element in
 *   `<head>`. Toggling one adds or removes exactly that element, so CSS takes
 *   effect and reverts instantly with no reload.
 * - A **JS** snippet is compiled with `new Function` and called once. There is
 *   no sandbox and no undo: this is deliberately the same trust model as
 *   pasting the code into the console, which is the entire point of the
 *   feature. What the runtime CAN do is refuse to run the same snippet twice,
 *   notice when the desired state no longer matches what already ran, and
 *   report that a reload is required.
 *
 * Nothing here is persisted: the runtime is a projection of the current
 * settings snapshot onto the live DOM.
 */
import type { SnippetsConfig, Snippet } from '../shared/types.ts'
import { PLUGIN_VERSION } from '../shared/version.ts'

/** A cheap content fingerprint, so a changed snippet is detectable. */
function fingerprint(content: string): string {
  let hash = 5381
  for (let i = 0; i < content.length; i += 1) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0
  }
  return `${String(hash)}:${String(content.length)}`
}

/** What the runtime wants the UI to know after a sync. */
export interface RuntimeState {
  /** How many CSS snippets are currently injected. */
  cssApplied: number
  /** How many JS snippets have run on this page load. */
  jsExecuted: number
  /**
   * Whether the DOM no longer matches the configuration — a JS snippet was
   * disabled, removed or edited after it ran — so only a reload can reconcile
   * it.
   */
  jsPendingReload: boolean
}

/** The runtime handle. */
export interface SnippetRuntime {
  /** Project `config` onto the page and return the resulting state. */
  sync(config: SnippetsConfig): RuntimeState
  /** Show or clear the editor's live CSS preview. */
  previewCss(content: string | null): void
  /** Remove every element this runtime injected. */
  dispose(): void
}

/** The attribute linking an injected `<style>` to its snippet. */
const STYLE_ATTR = 'data-dsh-snippet'
/** The attribute marking the editor's live-preview `<style>`. */
const PREVIEW_ATTR = 'data-dsh-snippet-preview'

/**
 * Create the runtime for one page load.
 * @param log - diagnostic sink; only active when `consoleDebug` is on.
 */
export function createRuntime(log: (...args: unknown[]) => void): SnippetRuntime {
  /** id → the exact content that ran, so a change is visible. */
  const executed = new Map<string, string>()
  let preview: HTMLStyleElement | null = null
  let disposed = false

  const removeStyle = (id: string): void => {
    const node = document.head.querySelector(`style[${STYLE_ATTR}="${CSS.escape(id)}"]`)
    node?.remove()
  }

  const writeStyle = (id: string, content: string): void => {
    let node = document.head.querySelector<HTMLStyleElement>(`style[${STYLE_ATTR}="${CSS.escape(id)}"]`)
    if (node === null) {
      node = document.createElement('style')
      node.setAttribute(STYLE_ATTR, id)
      // Appending (rather than inserting first) keeps snippet order stable and
      // matches how a user would reason about precedence between snippets.
      document.head.appendChild(node)
    }
    if (node.textContent !== content) node.textContent = content
  }

  const runJs = (snippet: Snippet): void => {
    try {
      // `sourceURL` names the synthetic script in the devtools sources list.
      const source = `${snippet.content}\n//# sourceURL=dsh-snippet://${snippet.id}`
      // eslint-disable-next-line no-new-func
      const run = new Function(source)
      run()
      log('executed JS snippet', snippet.id, snippet.name)
    } catch (error) {
      // A throwing snippet must not take the plugin (or the next snippet) down.
      console.error(`[dsh-snippets] JS snippet ${snippet.id} threw:`, error)
    }
  }

  return {
    sync(config) {
      if (disposed) return { cssApplied: 0, jsExecuted: executed.size, jsPendingReload: false }

      /* ── CSS: the desired set is exactly the enabled snippets ─────── */
      const wantedCss = new Map<string, string>()
      if (config.cssMasterEnabled) {
        for (const snippet of config.snippets) {
          if (snippet.type === 'css' && snippet.enabled) wantedCss.set(snippet.id, snippet.content)
        }
      }
      for (const node of Array.from(document.head.querySelectorAll(`style[${STYLE_ATTR}]`))) {
        const id = node.getAttribute(STYLE_ATTR)
        if (id === null || !wantedCss.has(id)) node.remove()
      }
      for (const [id, content] of wantedCss) writeStyle(id, content)

      /* ── JS: run what is new, notice what no longer matches ───────── */
      let pending = false
      const liveIds = new Set<string>()
      if (config.jsMasterEnabled) {
        for (const snippet of config.snippets) {
          if (snippet.type !== 'js' || !snippet.enabled) continue
          liveIds.add(snippet.id)
          const before = executed.get(snippet.id)
          if (before === undefined) {
            executed.set(snippet.id, fingerprint(snippet.content))
            runJs(snippet)
          } else if (before !== fingerprint(snippet.content)) {
            // Re-running would double-apply whatever the code did the first
            // time; the honest answer is "reload".
            pending = true
          }
        }
      }
      for (const id of Array.from(executed.keys())) {
        if (!liveIds.has(id)) pending = true
      }

      return { cssApplied: wantedCss.size, jsExecuted: executed.size, jsPendingReload: pending }
    },

    previewCss(content) {
      if (disposed) return
      if (content === null) {
        preview?.remove()
        preview = null
        return
      }
      if (preview === null || !preview.isConnected) {
        preview = document.createElement('style')
        preview.setAttribute(PREVIEW_ATTR, '')
        document.head.appendChild(preview)
      }
      preview.textContent = content
    },

    dispose() {
      disposed = true
      preview?.remove()
      preview = null
      for (const node of Array.from(document.head.querySelectorAll(`style[${STYLE_ATTR}], style[${PREVIEW_ATTR}]`))) {
        node.remove()
      }
      // Executed JS is intentionally not "undone": it cannot be. The UI says so.
    },
  }
}

/** The global helper snippets can reach for, installed once per page load. */
export interface SnippetsGlobal {
  /** Plugin version. */
  version: string
  /** Log through the plugin's sink. */
  log: (...args: unknown[]) => void
  /** Ask for a reload (the only supported way to undo JS). */
  reload: () => void
}

/** Install `window.__dshSnippets`, so snippets have a supported entry point. */
export function installGlobal(log: (...args: unknown[]) => void): void {
  const target = window as unknown as { __dshSnippets?: SnippetsGlobal }
  target.__dshSnippets = {
    version: PLUGIN_VERSION,
    log,
    reload: () => { window.location.reload() },
  }
}
