/**
 * The CodeMirror 6 wrapper the snippet editor uses.
 *
 * Kept framework-free: it takes a host element and returns a handle, so the
 * React dialog stays a thin shell around it. The dependency set is the narrow
 * one the feature actually needs — line numbers, history, bracket matching,
 * fold gutter, selection-match highlighting, search/replace, and the CSS and
 * JavaScript language modes — rather than `codemirror`'s `basicSetup`, whose
 * autocompletion and lint packages would ship for nothing.
 *
 * The colour scheme is driven entirely by CSS custom properties declared in
 * `styles.ts`, which is what makes the editor follow the host theme (including
 * `body[data-ds-dark-theme]`) without a second palette here.
 */
import type { Extension } from '@codemirror/state'
import { Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  rectangularSelection,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  indentOnInput,
  indentUnit as indentUnitFacet,
  syntaxHighlighting,
} from '@codemirror/language'
import { css as cssLanguage } from '@codemirror/lang-css'
import { javascript as javascriptLanguage } from '@codemirror/lang-javascript'
import { tags } from '@lezer/highlight'
import { indentUnitWidth } from '../../shared/model.ts'
import type { SnippetType } from '../../shared/types.ts'

/** Syntax colours, expressed as theme variables so dark mode is a CSS override. */
const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--dsn-code-keyword)' },
  { tag: tags.string, color: 'var(--dsn-code-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--dsn-code-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--dsn-code-comment)', fontStyle: 'italic' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--dsn-code-property)' },
  { tag: [tags.tagName, tags.typeName, tags.className], color: 'var(--dsn-code-tag)' },
  { tag: [tags.variableName, tags.definition(tags.variableName), tags.function(tags.variableName)], color: 'var(--dsn-code-var)' },
  { tag: [tags.punctuation, tags.bracket, tags.separator, tags.operator], color: 'var(--dsn-code-punct)' },
  { tag: tags.invalid, color: 'var(--dsw-alias-state-error-primary, #d92d20)', textDecoration: 'underline wavy' },
])

/** Layout/typography the stylesheet does not own. */
const baseTheme = EditorView.theme({
  '&': {
    fontSize: 'var(--dsn-editor-font-size, 13px)',
    backgroundColor: 'transparent',
    color: 'var(--dsw-alias-label-primary, #0f1115)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--dsw-alias-label-primary, #0f1115)' },
  '.cm-line': { padding: '0 10px 0 6px' },
  '.cm-gutterElement': { padding: '0 6px 0 10px' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-foldGutter span': { cursor: 'pointer' },
  '.cm-tooltip': {
    border: '1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%))',
    backgroundColor: 'var(--dsw-alias-bg-layer-1, #fff)',
  },
})

/** Everything the caller may change at runtime. */
export interface CodeEditorOptions {
  /** Initial buffer. */
  doc: string
  /** Which language mode to install. */
  type: SnippetType
  /** Indent unit token from the settings section. */
  indentUnit: string
  /** Soft-wrap long lines. */
  lineWrap: boolean
  /** Font size in px. */
  fontSize: number
  /** Placeholder shown on an empty buffer. */
  placeholder?: string
  /** Notified on every user edit. */
  onChange: (value: string) => void
}

/** The imperative handle a dialog keeps. */
export interface CodeEditorHandle {
  /** Replace the buffer when it differs from the current document. */
  setDocIfChanged: (value: string) => void
  /** Read the buffer. */
  getDoc: () => string
  /** Switch the language mode and indent width. */
  configure: (options: { type: SnippetType; indentUnit: string; lineWrap: boolean; fontSize: number; placeholder?: string }) => void
  /** Focus the editor. */
  focus: () => void
  /** Destroy the view and its DOM. */
  destroy: () => void
}

/** The language extension for a snippet type. */
function languageFor(type: SnippetType): Extension {
  return type === 'css' ? cssLanguage() : javascriptLanguage()
}

/** The indent unit as a literal string (`'\t'` or spaces). */
function indentString(unit: string): string {
  const { tabs, width } = indentUnitWidth(unit)
  return tabs ? '\t' : ' '.repeat(width)
}

/**
 * Mount a code editor into `host`.
 * @param host - the container element; CodeMirror replaces its contents.
 * @param options - see {@link CodeEditorOptions}.
 */
export function createCodeEditor(host: HTMLElement, options: CodeEditorOptions): CodeEditorHandle {
  const language = new Compartment()
  const indent = new Compartment()
  const wrap = new Compartment()
  const placeholderConf = new Compartment()

  const syncFontSize = (size: number): void => {
    host.style.setProperty('--dsn-editor-font-size', `${String(size)}px`)
  }
  syncFontSize(options.fontSize)

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        syntaxHighlighting(highlightStyle),
        baseTheme,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        language.of(languageFor(options.type)),
        indent.of(indentUnitFacet.of(indentString(options.indentUnit))),
        wrap.of(options.lineWrap ? EditorView.lineWrapping : []),
        placeholderConf.of(options.placeholder === undefined ? [] : placeholderExt(options.placeholder)),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          options.onChange(update.state.doc.toString())
        }),
      ],
    }),
  })

  return {
    setDocIfChanged(value) {
      const current = view.state.doc.toString()
      if (current === value) return
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    },
    getDoc: () => view.state.doc.toString(),
    configure(next) {
      syncFontSize(next.fontSize)
      view.dispatch({
        effects: [
          language.reconfigure(languageFor(next.type)),
          indent.reconfigure(indentUnitFacet.of(indentString(next.indentUnit))),
          wrap.reconfigure(next.lineWrap ? EditorView.lineWrapping : []),
          placeholderConf.reconfigure(next.placeholder === undefined ? [] : placeholderExt(next.placeholder)),
        ],
      })
    },
    focus() {
      view.focus()
    },
    destroy() {
      view.destroy()
    },
  }
}
