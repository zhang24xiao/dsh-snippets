/**
 * Every style this plugin adds to the page, as one string.
 *
 * Injected as a single `<style data-dsh-snippets-ui>` element and removed when
 * the plugin unloads, so the plugin never leaves anything behind.
 *
 * Two rules shape the sheet:
 *
 *  - **Only `--dsw-*` / `--dsw-alias-*` tokens carry colour.** The host theme
 *    owns those, so the manager panel, the editor and the settings page follow
 *    light/dark and any custom theme without a second palette here. Every token
 *    has a literal fallback because a token only exists once the theme plugin
 *    has painted.
 *  - **Every selector is scoped under a `dsn-` class**, so nothing here can
 *    restyle the application around it.
 *
 * Dark-mode overrides ride `body[data-ds-dark-theme]`, which is the attribute
 * the shipped frontend itself uses.
 */

/** Class prefix for everything this plugin renders. */
export const PREFIX = 'dsn'

/** The attribute marking the injected sheet, so it can be found and removed. */
export const STYLE_ATTRIBUTE = 'data-dsh-snippets-ui'

/** The full stylesheet. */
export const UI_CSS = `
.${PREFIX}-entry {
  display: flex;
  align-items: center;
  min-width: 0;
}

/* ── the collapsed-rail layout shim ───────────────────────────────── */

/*
 * The sidebar shell lays the foot out as a column and gives
 * \`sidebar.footer.action\` a ROW inside it, even when the column is collapsed
 * to the 56px rail. With one action that is invisible; with
 * dsh-remote-web-ui's entry plus this one, the rail's own row (which stacks
 * its two icons) and this plugin's icon end up side by side and the icon is
 * pushed out of the rail.
 *
 * The same shim also restores the row's own rhythm in the wide column. The
 * neighbouring entry spaces its two buttons 6px apart and 4px apart in the
 * rail; with no gap on the container a second registrant sits flush against
 * it, which reads as one crowded cluster rather than two actions.
 *
 * The attribute-substring selectors are deliberately defensive: they match the
 * shell's CSS-module classes by their readable suffix, so a hash change simply
 * stops the rules from applying (and the row degrades to the shipped layout)
 * instead of breaking anything. \`html\` raises specificity above the shell's
 * own two-class rule so the outcome does not depend on stylesheet order.
 */
html [class*='_footerActions'] {
  gap: 6px;
}
html [class*='_collapsed'] [class*='_footerActions'] {
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

/* ── the sidebar-foot trigger ──────────────────────────────────────── */

/*
 * Icon-only, matching the neighbouring footer actions (the update and phone
 * entries): 附图 1's toolbar button is a bare </> glyph, and the rail has no
 * room for a word. The count lives in the manager panel's footer and in this
 * button's tooltip.
 *
 * Geometry is copied field for field from the neighbouring entry's own trigger,
 * because the two sit in one row and their hover surfaces have to agree:
 *
 *   base (collapsed rail)  36x36, border-radius 50%   -> a circle
 *   [data-wide='wide']     padding 0 10px, radius 999px
 *
 * The wide padding is what makes the box 36px wide around a 16px glyph, so both
 * actions present the same circle and the same 36px hover surface. Omitting it
 * left this trigger 16px wide, which read as a narrow vertical pill next to the
 * neighbour's circle.
 */
.${PREFIX}-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  font: inherit;
  line-height: 1;
  cursor: pointer;
  transition: background-color .12s ease, color .12s ease;
}
.${PREFIX}-trigger:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%));
  color: var(--dsw-alias-label-primary, #0f1115);
}
.${PREFIX}-trigger[aria-expanded='true'] {
  background: var(--dsw-alias-interactive-bg-active, rgb(0 0 0 / 8%));
  color: var(--dsw-alias-label-primary, #0f1115);
}
.${PREFIX}-trigger:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe);
  outline-offset: 1px;
}
.${PREFIX}-trigger[data-wide='wide'] {
  width: auto;
  border-radius: 999px;
  padding: 0 10px;
}

/* ── the manager panel ─────────────────────────────────────────────── */

.${PREFIX}-panel {
  position: fixed;
  z-index: 800;
  display: flex;
  flex-direction: column;
  width: min(360px, calc(100vw - 16px));
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: 0 12px 32px rgb(0 0 0 / 16%);
  color: var(--dsw-alias-label-primary, #0f1115);
  font-size: 13px;
}

.${PREFIX}-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 8%));
}
.${PREFIX}-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #f5f5f6);
}
.${PREFIX}-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.${PREFIX}-tab[aria-selected='true'] {
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-primary, #0f1115);
  box-shadow: 0 1px 2px rgb(0 0 0 / 10%);
}
.${PREFIX}-tab-count {
  min-width: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--dsw-alias-brand-primary, #4d6bfe);
  color: var(--dsw-alias-label-primary-foreground, #fff);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 15px;
  text-align: center;
}
.${PREFIX}-tab[aria-selected='false'] .${PREFIX}-tab-count {
  background: var(--dsw-alias-bg-layer-3, rgb(0 0 0 / 8%));
  color: var(--dsw-alias-label-secondary, #61666b);
}
.${PREFIX}-head-spacer { flex: 1 1 auto; }
.${PREFIX}-master {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-size: 11.5px;
}

.${PREFIX}-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 8%));
}
.${PREFIX}-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  cursor: pointer;
  transition: background-color .12s ease, color .12s ease;
}
.${PREFIX}-icon-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%));
  color: var(--dsw-alias-label-primary, #0f1115);
}
.${PREFIX}-icon-btn[aria-pressed='true'] {
  background: var(--dsw-alias-interactive-bg-active, rgb(0 0 0 / 8%));
  color: var(--dsw-alias-label-primary, #0f1115);
}
.${PREFIX}-icon-btn:disabled { opacity: .45; cursor: default; }
.${PREFIX}-icon-btn:focus-visible,
.${PREFIX}-tab:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe);
  outline-offset: 1px;
}
.${PREFIX}-search {
  flex: 1 1 auto;
  min-width: 0;
}

.${PREFIX}-list {
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px;
}
.${PREFIX}-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 3px 4px 3px 2px;
  border-radius: 8px;
}
.${PREFIX}-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 4%)); }
.${PREFIX}-row[data-dragging='true'] { opacity: .4; }
.${PREFIX}-row[data-drop='true'] {
  box-shadow: inset 0 2px 0 var(--dsw-alias-brand-primary, #4d6bfe);
}
.${PREFIX}-row-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  color: var(--dsw-alias-label-tertiary, #81858c);
  cursor: grab;
}
.${PREFIX}-row-main {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.${PREFIX}-row-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${PREFIX}-row-title[data-off='true'] { color: var(--dsw-alias-label-tertiary, #81858c); }
.${PREFIX}-row-title[data-empty='true'] { font-style: italic; }
.${PREFIX}-row-actions {
  display: none;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
}
.${PREFIX}-row:hover .${PREFIX}-row-actions,
.${PREFIX}-row:focus-within .${PREFIX}-row-actions { display: inline-flex; }
.${PREFIX}-row-actions .${PREFIX}-icon-btn { width: 22px; height: 22px; }
.${PREFIX}-row-actions .${PREFIX}-icon-btn[data-danger='true']:hover {
  background: var(--dsw-alias-interactive-bg-hover-danger, rgb(255 0 0 / 8%));
  color: var(--dsw-alias-state-error-primary, #d92d20);
}

.${PREFIX}-empty {
  padding: 18px 14px 20px;
  text-align: center;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.${PREFIX}-empty-title { margin-bottom: 4px; font-size: 13px; }
.${PREFIX}-empty-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); }
.${PREFIX}-empty-action { margin-top: 10px; }

.${PREFIX}-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 8%));
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-size: 11.5px;
}
.${PREFIX}-foot-spacer { flex: 1 1 auto; }

.${PREFIX}-reload-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 8%));
  background: var(--dsw-alias-state-warn-tertiary, rgb(255 196 0 / 12%));
  color: var(--dsw-alias-state-warn-label, #8a5a00);
  font-size: 11.5px;
  line-height: 1.5;
}
.${PREFIX}-reload-banner button {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

/* ── the editor ────────────────────────────────────────────────────── */

.${PREFIX}-editor-body { display: flex; flex-direction: column; gap: 10px; }
.${PREFIX}-editor-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.${PREFIX}-editor-name { flex: 1 1 220px; min-width: 160px; }
.${PREFIX}-editor-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.${PREFIX}-editor-toolbar-spacer { flex: 1 1 auto; }
.${PREFIX}-cm {
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%));
  border-radius: 10px;
  background: var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-layer-2, #f7f7f8));
}
.${PREFIX}-cm .cm-editor { height: 100%; background: transparent; }
.${PREFIX}-cm .cm-editor.cm-focused { outline: none; }
.${PREFIX}-cm .cm-scroller {
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  line-height: 1.6;
}
.${PREFIX}-cm .cm-gutters {
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.${PREFIX}-cm .cm-activeLine { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 4%)); }
.${PREFIX}-cm .cm-activeLineGutter { background: transparent; }
.${PREFIX}-cm .cm-selectionBackground,
.${PREFIX}-cm .cm-content ::selection {
  background: var(--dsw-alias-interactive-bg-active, rgb(77 107 254 / 22%));
}
.${PREFIX}-cm .cm-cursor { border-left-color: var(--dsw-alias-label-primary, #0f1115); }
.${PREFIX}-cm .cm-panels {
  background: var(--dsw-alias-bg-layer-2, #f5f5f6);
  color: var(--dsw-alias-label-primary, #0f1115);
  border-color: var(--dsw-alias-border-l1, rgb(0 0 0 / 8%));
}
.${PREFIX}-cm .cm-searchMatch { background: rgb(255 196 0 / 35%); }
.${PREFIX}-cm .cm-searchMatch-selected { background: rgb(255 140 0 / 55%); }
.${PREFIX}-code-status {
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-size: 11.5px;
}
.${PREFIX}-code-status[data-tone='error'] { color: var(--dsw-alias-state-error-primary, #d92d20); }
.${PREFIX}-code-status[data-tone='ok'] { color: var(--dsw-alias-state-success-primary, #12a150); }

/* CodeMirror syntax palette; overridden for dark below. */
.dsn-code-scope {
  --dsn-code-keyword: #a626a4;
  --dsn-code-string: #50a14f;
  --dsn-code-number: #986801;
  --dsn-code-comment: #a0a1a7;
  --dsn-code-property: #4078f2;
  --dsn-code-tag: #e45649;
  --dsn-code-punct: #383a42;
  --dsn-code-var: #c18401;
}
body[data-ds-dark-theme] .dsn-code-scope {
  --dsn-code-keyword: #c678dd;
  --dsn-code-string: #98c379;
  --dsn-code-number: #d19a66;
  --dsn-code-comment: #7f848e;
  --dsn-code-property: #61afef;
  --dsn-code-tag: #e06c75;
  --dsn-code-punct: #abb2bf;
  --dsn-code-var: #e5c07b;
}

/* ── the settings page ─────────────────────────────────────────────── */

.${PREFIX}-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 720px;
  padding: 2px 2px 24px;
  color: var(--dsw-alias-label-primary, #0f1115);
  font-size: 13px;
}
.${PREFIX}-intro {
  margin: 0;
  color: var(--dsw-alias-label-secondary, #61666b);
  font-size: 12.5px;
  line-height: 1.7;
}
.${PREFIX}-group {
  border: 1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 8%));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  overflow: hidden;
}
.${PREFIX}-group-title {
  margin: 0;
  padding: 10px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 8%));
  background: var(--dsw-alias-bg-layer-2, #f7f7f8);
  font-size: 12.5px;
  font-weight: 600;
}
.${PREFIX}-group-body { padding: 4px 14px; }
.${PREFIX}-field {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-top: 1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 6%));
}
.${PREFIX}-field:first-child { border-top: 0; }
.${PREFIX}-field-text { flex: 1 1 auto; min-width: 0; }
.${PREFIX}-field-label { font-size: 13px; line-height: 1.5; }
.${PREFIX}-field-label[data-disabled='true'] { color: var(--dsw-alias-label-tertiary, #81858c); }
.${PREFIX}-field-desc {
  margin-top: 3px;
  color: var(--dsw-alias-label-secondary, #61666b);
  font-size: 12px;
  line-height: 1.6;
}
.${PREFIX}-field-desc code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--dsw-alias-markdown-inline-code, rgb(0 0 0 / 6%));
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  word-break: break-all;
}
.${PREFIX}-field-control {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 60%;
}
.${PREFIX}-field-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.${PREFIX}-field-stack .${PREFIX}-field-text { max-width: none; }
.${PREFIX}-control-wide { width: 100%; }
.${PREFIX}-select {
  height: 30px;
  max-width: 100%;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%));
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-2, #f7f7f8);
  color: var(--dsw-alias-label-primary, #0f1115);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.${PREFIX}-select:disabled,
.${PREFIX}-text:disabled { opacity: .5; cursor: not-allowed; }
.${PREFIX}-text {
  width: 100%;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%));
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-2, #f7f7f8);
  color: var(--dsw-alias-label-primary, #0f1115);
  font: inherit;
  font-size: 12.5px;
}
.${PREFIX}-range-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 200px;
}
.${PREFIX}-range-row input[type='range'] { flex: 1 1 auto; min-width: 120px; }
.${PREFIX}-range-value {
  min-width: 52px;
  color: var(--dsw-alias-label-secondary, #61666b);
  font-size: 12px;
  text-align: right;
}
.${PREFIX}-file-input { display: none; }
.${PREFIX}-field-control select { max-width: 240px; }
.${PREFIX}-field-stack .${PREFIX}-field-control { max-width: none; }
.${PREFIX}-link {
  color: var(--dsw-alias-link, #4d6bfe);
  text-decoration: none;
}
.${PREFIX}-link:hover { text-decoration: underline; }
.${PREFIX}-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.${PREFIX}-hint {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #f7f7f8);
  color: var(--dsw-alias-label-secondary, #61666b);
  font-size: 12px;
  line-height: 1.6;
}
.${PREFIX}-hint[data-tone='warn'] {
  background: var(--dsw-alias-state-warn-tertiary, rgb(255 196 0 / 12%));
  color: var(--dsw-alias-state-warn-label, #8a5a00);
}
.${PREFIX}-hint[data-tone='error'] {
  background: rgb(217 45 32 / 10%);
  color: var(--dsw-alias-state-error-primary, #d92d20);
}
.${PREFIX}-danger .${PREFIX}-group-title { color: var(--dsw-alias-state-error-primary, #d92d20); }
.${PREFIX}-kv {
  display: grid;
  grid-template-columns: minmax(96px, auto) 1fr;
  gap: 4px 12px;
  color: var(--dsw-alias-label-secondary, #61666b);
  font-size: 12px;
  line-height: 1.7;
}
.${PREFIX}-kv b { color: var(--dsw-alias-label-primary, #0f1115); font-weight: 500; }
.${PREFIX}-kv code { font-family: var(--dsw-font-mono, ui-monospace, monospace); word-break: break-all; }
.${PREFIX}-status-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 5px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary, #81858c);
}
.${PREFIX}-status-dot[data-on='true'] { background: var(--dsw-alias-state-success-primary, #12a150); }
.${PREFIX}-status-dot[data-error='true'] { background: var(--dsw-alias-state-error-primary, #d92d20); }

/* ── the Gist dialogs ──────────────────────────────────────────────── */

.${PREFIX}-dialog-body { display: flex; flex-direction: column; gap: 12px; }
.${PREFIX}-dialog-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.${PREFIX}-dialog-row > .${PREFIX}-grow { flex: 1 1 200px; min-width: 160px; }
.${PREFIX}-seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #f5f5f6);
}
.${PREFIX}-seg button {
  flex: 1 1 auto;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.${PREFIX}-seg button[aria-pressed='true'] {
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-primary, #0f1115);
  box-shadow: 0 1px 2px rgb(0 0 0 / 10%);
}
.${PREFIX}-import-split {
  display: grid;
  grid-template-columns: minmax(160px, 38%) 1fr;
  gap: 10px;
  align-items: start;
}
@media (max-width: 640px) {
  .${PREFIX}-import-split { grid-template-columns: 1fr; }
}
.${PREFIX}-file-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 8%));
  border-radius: 10px;
}
.${PREFIX}-file {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 6%));
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.${PREFIX}-file:last-child { border-bottom: 0; }
.${PREFIX}-file:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 4%)); }
.${PREFIX}-file[aria-selected='true'] { background: var(--dsw-alias-interactive-bg-active, rgb(0 0 0 / 7%)); }
.${PREFIX}-file-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${PREFIX}-badge {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3, rgb(0 0 0 / 7%));
  color: var(--dsw-alias-label-secondary, #61666b);
  font-size: 10.5px;
  line-height: 16px;
}
.${PREFIX}-badge[data-kind='new'] {
  background: rgb(18 161 80 / 14%);
  color: var(--dsw-alias-state-success-primary, #12a150);
}
.${PREFIX}-badge[data-kind='update'] {
  background: var(--dsw-alias-brand-primary, #4d6bfe);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.${PREFIX}-diff-pane {
  min-height: 120px;
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 8%));
  border-radius: 10px;
  background: var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-layer-2, #f7f7f8));
}
.${PREFIX}-diff-empty {
  padding: 18px 14px;
  color: var(--dsw-alias-label-secondary, #61666b);
  font-size: 12.5px;
  line-height: 1.7;
}
.${PREFIX}-select-list {
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 8%));
  border-radius: 10px;
}
.${PREFIX}-select-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgb(0 0 0 / 6%));
  font-size: 12.5px;
}
.${PREFIX}-select-row:last-child { border-bottom: 0; }
.${PREFIX}-select-row label { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; cursor: pointer; }
.${PREFIX}-select-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .${PREFIX}-trigger, .${PREFIX}-icon-btn { transition: none; }
}
`
