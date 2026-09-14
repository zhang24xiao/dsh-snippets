# dsh-snippets

CSS and JS code snippets for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web GUI.

A quick toggle in the sidebar footer beside **Settings** opens a manager panel —
the same seat `@linxin666/dsh-remote-web-ui` uses for its phone entry — and
**Settings → Code Snippets** is an independent page with the full set of
preferences. Enabled **CSS** is injected into the page immediately; enabled
**JS** runs after the page loads.

> Inspired by [TCOTC/snippets](https://github.com/TCOTC/snippets), the SiYuan
> note-taking app's snippet manager, and adapted to the DSH plugin contract.

[简体中文](./README.zh-CN.md)

## Features

**Managing snippets**

- CSS / JS tabs with live counts, one master switch per type, and search across
  titles, code, or both
- Add, edit, duplicate, delete, enable/disable, and drag to reorder
- Ten sort orders (custom, enabled-first, title A→Z / natural, oldest/newest)
- Per-row edit / duplicate / delete buttons, each individually hideable
- One-click **Reload the interface** for changes only a reload can apply

**Editing**

- CodeMirror 6: line numbers, CSS/JS syntax highlighting, bracket matching, fold
  gutter, search & replace, history
- Configurable indent unit, font size and soft wrap; the theme follows the app,
  including dark mode
- **Live CSS preview** — see the page change while you type, without saving
- Best-effort re-indent that only ever rewrites leading whitespace
- Content guards: CSS containing `</style` or `<script` is refused, and JS is
  parsed before it is saved

**Beyond the browser**

- **Local folder watch** — mirror a folder of `.css` / `.js` files into the
  snippet library, continuously or once at startup
- **Import / export** the whole library as JSON, with an automatic backup before
  a destructive import
- **GitHub Gist sync** — publish a selection, or import with *merge update*,
  *mirror overwrite* or *add only*, previewing the per-file diff first

## Install

```bash
dsh plugin --profile web add github:zhang24xiao/dsh-snippets
```

Then restart the web GUI. From a checkout:

```bash
git clone git@github.com:zhang24xiao/dsh-snippets.git
dsh plugin --profile web add link:$PWD/dsh-snippets
```

The built `lib/index.js` and `client/client.js` are committed, so a
`github:` install needs no build step.

## Where things live

| Surface | DSH seat |
| --- | --- |
| Quick toggle + manager panel | `sidebar.footer.action`, in the sidebar-foot row beside Settings |
| Settings page | `settings.section` — an independent navigation entry, not a plugin card |
| Editors, confirmations, toasts | `shell.overlay` |
| Snippet library | the `dsh-snippets` namespace of the profile's settings document |
| Backups, Gist token, watcher memory | `$DSH_HOME/dsh-snippets/` |

## How CSS and JS take effect

- Each enabled **CSS** snippet becomes one `<style data-dsh-snippet="<id>">`
  element in `<head>`. Toggling one adds or removes exactly that element, so CSS
  applies and reverts instantly with no reload.
- Each enabled **JS** snippet is compiled with `new Function` and called once per
  page load. **There is no sandbox and no undo** — this is deliberately the same
  trust model as pasting the code into the browser console, which is the point of
  the feature. Disabling, editing or removing a JS snippet therefore reports
  that a reload is required, and `autoReloadAfterJsEdit` can do it for you.
- `window.__dshSnippets` exposes `{ version, log, reload }` for snippets that
  want an entry point.
- Unloading the plugin removes every `<style>` it injected. Executed JS is not
  undone; it cannot be.

## Security notes

- Snippet data travels **only** over the official settings wire. The plugin adds
  no browser-writable snippet endpoint, so on a LAN or tunneled deployment an
  unpaired visitor cannot reach a route that would inject code into a page.
- The plugin's own endpoints (`/snippets/api/*`) do the three things a browser
  cannot: read the watched folder, call GitHub, and open the backups directory.
  They answer **loopback requests only**; over a LAN or tunnel those sections
  disable themselves and say so.
- The GitHub token is stored on the host at `$DSH_HOME/dsh-snippets/gist-token.json`
  with mode `0600`. It never enters the settings document, never reaches the
  browser, and the UI only ever learns whether one is configured.

## Differences from TCOTC/snippets

Three settings describe SiYuan features that DSH does not have:

| SiYuan | DSH |
| --- | --- |
| Snippet "publish service" switches | Removed — DSH has no publish concept |
| "Open the native snippet window" | Replaced by "Open the backups folder" |
| Watched folder: relative paths only | Absolute paths and `~` are supported (the DSH host is a plain Node process) |

## Development

```bash
pnpm install
pnpm run check     # typecheck, build, and both test suites
pnpm run watch     # rebuild on change
```

`npm run test` runs two suites:

- `test/host.test.mjs` — namespace registration, the loopback fence on every
  route, backups, the folder mirror (including id stability across scans), the
  Gist import plan, and the content guards.
- `test/client.test.mjs` — loads the built `client/client.js` through
  `window.__ModuleLoader__.load` in jsdom and drives the runtime: an enabled CSS
  snippet produces exactly one `<style>`, an enabled JS snippet runs exactly
  once, disabling removes only that element, the type master switch gates
  injection, and teardown leaves nothing behind. It then server-renders all
  three registered seats, so a broken render path fails here rather than in the
  GUI.

## License

MIT
