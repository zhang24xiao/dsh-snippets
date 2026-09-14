# dsh-snippets 设计与实施计划

> 本文档是动手前的设计稿，实施完成后保留作为设计说明；与实现不一致的地方以代码为准
> （下文「§12 实施记录」列出了设计与最终实现的差异）。

> 目标仓库：`git@github.com:zhang24xiao/dsh-snippets.git`（当前仅有一个空 `README.md`）
> 参考实现：[TCOTC/snippets](https://github.com/TCOTC/snippets)（思源笔记插件）、
> [@linxin666/dsh-remote-web-ui](https://github.com/zhu1090093659/dsh-web)（DSH 侧边栏底部署位范式）

---

## 1. 结论先行：一个包、两个半边、一个命名空间

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 交付形态 | 单个 npm 包 `dsh-snippets`，宿主半 + 客户端半 | DSH 插件标准形态；`dsh.client.platform: "web"` 让客户端半被 `__DSH_WEB_PLUGINS__` 扫描进 Web 插件名册 |
| 数据存储 | **只用官方设置命名空间 `dsh-snippets`** | 直接继承官方 settings 线的鉴权与脱敏；LAN / 隧道场景下不会因为自建接口被未配对设备注入 JS |
| 界面接入 | `sidebar.footer.action` + `settings.plugin.item` 两个插槽 | 前者与 `dsh-remote-web-ui` 的手机图标同排（需求 3）；后者是 **设置 → 插件 → 插件配置** 下的插件卡片（需求 2，见 §12.5） |
| 构建 | esbuild 打包 TSX 源码，产物入库 | 源码可维护、可用 JSX 与 CodeMirror；产物入库后 `github:` 安装无需构建 |
| 编辑器 | CodeMirror 6（按需裁剪语言包） | 对齐 TCOTC 的编辑器能力（行号 / 高亮 / 括号匹配 / 搜索替换） |

---

## 2. 架构（见 `snippets-plugin-architecture.html`）

```
浏览器 · 客户端半 client/client.js
  ctx.slots ──注册席位──> 快捷开关面板 (sidebar.footer.action)
                         代码片段管理器设置页 (settings.section)
                         片段编辑器（由面板打开）
  ctx.settingsScope <──读写── 上面三个界面
  片段运行时 ──注入 <style> / 执行 Function──> DSH Web 页面
        ▲
        └── 快照变更
  ctx.settingsScope ──settings 线──> 宿主进程 · 宿主半 lib/index.js
                                       ├─ 注册命名空间 schema
                                       ├─ 片段文件夹监听（轮询 *.css / *.js）
                                       └─ GitHub Gist（导入 / 发布 / 差异）
                                     └─持久化──> ~/.dsh/settings.yaml
```

要点：

- **唯一事实源**是设置文档里 `dsh-snippets` 这一段。客户端半读快照、写变更；宿主半注册 schema，
  并在需要时（文件监听、Gist 导入）写回同一段。
- 客户端半**不替换任何官方界面**：`slots.register` 只是往官方已声明的席位里加一个条目。
- 宿主半负责三件浏览器做不到的事：读本地文件夹、调 GitHub API、在系统文件管理器里打开备份目录。

---

## 3. 包结构

```
dsh-snippets/
├── package.json                 # dsh.bundle.patch + dsh.client + exports["./client"]
├── cordis.patch.yml             # 往 profile 层插入插件行
├── esbuild.config.mjs           # 两个产物：lib/index.js（宿主）、client/client.js（客户端）
├── tsconfig.json
├── LICENSE                      # MIT
├── README.md  README.zh-CN.md
├── docs/DESIGN.md               # 本文件
├── src/
│   ├── shared/
│   │   ├── schema.ts            # schemastery 配置 schema（两半共用的字段契约）
│   │   └── types.ts             # Snippet / Prefs / 排序 / 搜索枚举
│   ├── host/
│   │   ├── index.ts             # cordis 插件入口：注册命名空间 + 启动宿主能力
│   │   ├── paths.ts             # DSH_HOME / 片段文件夹 / 备份目录解析
│   │   ├── file-watch.ts        # 文件夹轮询 → 命名空间
│   │   ├── gist.ts              # GitHub Gist REST：拉取 / 发布 / 差异
│   │   ├── backups.ts           # 覆盖导入前自动备份、打开备份目录
│   │   └── routes.ts            # /snippets/api/*（仅宿主专用操作，不回传 Token）
│   └── client/
│       ├── index.ts             # apply(ctx)：字典 / scope / 席位 / 运行时
│       ├── store.ts             # settingsScope 绑定与写队列封装
│       ├── model.ts             # 片段模型：ID、排序、搜索、校验、克隆
│       ├── apply.ts             # 片段运行时：<style> 注入 / Function 执行 / 预览
│       ├── locales.ts           # zh + en 字典
│       ├── styles.ts            # 单一 CSS 文本，全部使用 --dsw-alias-* 变量
│       └── ui/
│           ├── FooterEntry.tsx  # sidebar.footer.action 席位（</> 触发器）
│           ├── ManagerPanel.tsx # 快捷面板（复刻附图 1）
│           ├── EditorDialog.tsx # 片段编辑器（CodeMirror 6）
│           ├── SettingsPage.tsx # settings.section 页面
│           ├── sections/        # 通用 / 菜单 / 编辑器 / 行为 / 监听 / 数据 / 同步 / 关于
│           └── dialogs/         # 删除确认 / 重载确认 / Gist 导入 / 差异对比 / 发布确认
├── lib/index.js                 # 构建产物（入库）
├── client/client.js             # 构建产物（入库，含 CSS 与 CodeMirror）
└── .gitignore                   # node_modules / .pnpm-store / *.log
```

### 关键清单字段

```jsonc
{
  "name": "dsh-snippets",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./client/client.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-sidebar"
      ]
    }
  },
  "files": ["lib", "client", "cordis.patch.yml", "README.md", "README.zh-CN.md", "LICENSE"]
}
```

`client/client.js` 采用官方模块表契约：

```js
window.__ModuleLoader__.load({
  id: 'dsh-snippets',
  factory: (require) => {
    const { createElement, useState } = require('react')
    const { createPortal } = require('react-dom')
    const { IconCodeOutline16, useAnchoredPosition, /* … */ } = require('@deepseek-ai/dsh-client-ui-primitives')
    return { name: 'dsh-snippets', inject: ['slots', 'settingsScope', 'locale'], apply }
  },
})
```

> 已确认模块表静态种子：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、
> `@deepseek-ai/cordis`、`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`、
> `dsh-client-ui-dockkit`。其余依赖（CodeMirror 等）打进自己的 bundle。

---

## 4. 数据模型（设置命名空间 `dsh-snippets`）

```ts
interface Snippet {
  id: string          // "20260914120000-a1b2c3d"（前 14 位为创建时间，对齐 TCOTC）
  name: string        // 标题，可为空（空则回退内容前 200 字符）
  type: 'css' | 'js'
  content: string
  enabled: boolean
  created: number     // epoch ms
}

interface SnippetsPrefs {
  // 总开关（对应 SiYuan 的 config.snippet.enabledCSS / enabledJS）
  cssMasterEnabled: boolean
  jsMasterEnabled: boolean

  // 通用
  defaultTab: 'css' | 'js'
  newSnippetEnabled: boolean
  rowClickAction: 0 | 1 | 2            // 无操作 / 切换开关 / 打开编辑器
  sortType: SortType                   // 9 项，见 §6.1
  searchMode: 0 | 1 | 2 | 3            // 禁用 / 标题 / 内容 / 标题或内容
  footerPosition: 'left' | 'right'     // 对应 TCOTC 的 topBarPosition

  // 管理菜单
  showEditButton: boolean
  showDuplicateButton: boolean
  showDeleteButton: boolean
  confirmDelete: boolean

  // 编辑器
  realTimePreview: boolean
  editorIndentUnit: IndentUnit
  multipleEditors: boolean
  editorLineWrap: boolean
  editorFontSize: number
  formatOnSave: boolean

  // 行为与安全
  consoleDebug: boolean
  autoReloadAfterJsEdit: boolean
  reloadNotice: boolean
  reloadNoticeSuppressed: boolean
  validateCssContent: boolean
  validateJsSyntax: boolean
  confirmJsExecution: boolean

  // 本地文件监听
  fileWatchMode: 'disabled' | 'watch' | 'loadOnce'
  fileWatchPath: string
  fileWatchIntervalSec: number         // 5..300
  fileWatchMirrorMode: 'merge' | 'overwrite'
  fileWatchDeleteMissing: boolean

  // Gist 同步
  gistToken: string                    // schemastery secret，走脱敏路径
  gistLastPublished: string
  gistLastImported: string

  // 内容
  snippets: Snippet[]
}
```

---

## 5. 快捷面板（复刻附图 1）

**触发器**：`sidebar.footer.action` 席位，`</>` 图标（`IconCodeOutline16`）。
位置由 `footerPosition` 决定：

| 取值 | `order` | 效果 |
| --- | --- | --- |
| `right`（默认） | `10` | 排在 `dsh-remote-web-ui` 手机图标右侧 |
| `left` | `-10` | 排在手机图标左侧 |

宽栏时图标 + 「片段」文字，rail（56px）时仅图标 + `title`；`aria-expanded` 表示面板开合。

**面板**（`createPortal` 到 `document.body`，`useAnchoredPosition({ side: 'top' })` 向上锚定 + `useDismissOnOutsidePointer` 点外关闭）：

```
┌─────────────────────────────────────────────┐
│  [ CSS 3 ]  JS 0            ⌕  ⚙  ⟳  ＋     │  ← 标签页带计数；右侧工具行
│  ─────────────────────────────────────────  │
│  ● 无序列表层级                      [ ▮━ ]  │  ← 标题 + 逐条开关；hover 显示 编辑/复制/删除
│    标题位置                          [ ▮━ ]  │
│    修改字体                          [ ▭━ ]  │
│  ─────────────────────────────────────────  │
│  3 个片段 · 2 个已启用        重载界面       │
└─────────────────────────────────────────────┘
```

- 标签页右侧是**当前类型的总开关**（对应附图 1 右上角那个大开关）。
- `sortType === 'custom'` 时行首出现拖拽手柄（HTML5 DnD 重排 `snippets` 顺序）。
- 空状态：`添加第一个 CSS 代码片段` / `添加第一个 JS 代码片段` 按钮。
- 右上角 `⚙` 打开设置页的「代码片段管理器」导航项（见 §7 的深链说明）。

---

## 6. 功能实现

### 6.1 排序与搜索（对齐 TCOTC `domain/snippet.ts`）

排序：`fixed` / `custom` / `enabledASC`（已开启优先）/ `enabledDESC` / `nameASC` / `nameDESC` /
`nameNatASC`（自然序）/ `nameNatDESC` / `createdASC` / `createdDESC`。
搜索：`0 禁用 / 1 标题 / 2 内容 / 3 标题或内容`，不区分大小写。

### 6.2 校验（对齐 + 加固）

| 规则 | 行为 |
| --- | --- |
| CSS 内容含 `</style` 或 `<script`（不区分大小写） | 拒绝保存，提示「CSS 代码片段无法保存，内容包含被禁止的标记」（沿用思源内核同款判据） |
| JS 语法无效 | 用 `new Function(code)` 预解析；失败则不保存并提示 |
| 保留 ID | `id` 走 `YYYYMMDDHHmmss-xxxxxxx` 格式，保证「创建时间」排序可用 |

### 6.3 片段运行时

```ts
// CSS：一条片段一个 <style>，开关切换即时生效，插件卸载时全部移除
<style data-dsh-snippet="<id>">…</style>

// 编辑器实时预览：独立 tag，编辑结束即移除
<style data-dsh-snippet-preview>…</style>

// JS：每个启用片段执行一次；新增/启用即执行；禁用需重载页面
new Function(snippet.content)()
```

- 快照 `status === 'ready'` 后才应用；`subscribe` 每次变更重算。
- 首次应用前不预先执行任何代码；已执行过的 JS 片段记录在内存 Set 里，避免重复执行。
- 插件被禁用 / 卸载：移除所有注入的 `<style>`；已执行的 JS 无法撤销，面板与设置页均明示「需重载界面」。

### 6.4 宿主能力

| 能力 | 实现 |
| --- | --- |
| 片段文件夹监听 | `mode: watch` 时 `setInterval` 轮询（间隔可配置），扫描 `*.css` / `*.js`，按 `merge` / `overwrite` 策略写入命名空间；`loadOnce` 只加载一次不轮询 |
| 备份 | 「导入并覆盖」前把现有片段写到 `~/.dsh/dsh-snippets/backups/<时间戳>.json` |
| 打开备份目录 | 宿主调用系统文件管理器（Linux `xdg-open` / macOS `open` / Windows `explorer`） |
| Gist 导入 | `GET /gists/{id}` → 解析 `*.css` / `*.js` 文件名里的 ID → 三种模式：合并更新 / 覆盖镜像 / 仅新增；先弹差异对比 |
| Gist 发布 | `POST /gists` 或 `PATCH /gists/{id}`，逐片段勾选，支持 secret/public、描述、删除未勾选旧文件的确认（单文件 1MB / 300 个文件上限校验） |

### 6.5 安全与授权

1. **不新增浏览器可写的片段接口。** 片段数据全部走官方 `settings` 线（`settings.describe` 读、
   `remote.settings` 写），这样 LAN / 隧道部署下的未配对设备无法通过自建接口往别人浏览器里注入 JS。
2. 宿主侧 `/snippets/api/*` 只承载「宿主才能做」的动作（Gist、备份、打开目录），
   路径与目标由服务端配置决定，**不回传 Token**。
3. `gistToken` 用 schemastery 的 secret 角色声明，走 `describe({ redactSecrets: true })` 脱敏路径；
   浏览器只看得到「已配置」。
4. 启用 JS 片段前二次确认（`confirmJsExecution`），并在设置页显著位置说明：
   **JS 片段在本页执行，等价于你亲手在控制台粘贴这段代码**。

---

## 7. 设置页（`settings.section`）

注册为独立导航项，`id: 'dsh-snippets'`，`label: () => t('section.title')`（中文「代码片段管理器」/ English “Code Snippets”），
`order` 排在「通用」之后。页面内是分组卡片：

| 分组 | 内容 |
| --- | --- |
| 通用 | 默认标签页、新建默认启用、点击片段行行为、排序方式、搜索范围、快捷开关位置（左 / 右） |
| 管理菜单 | 显示编辑按钮、显示副本按钮、显示删除按钮、删除前确认 |
| 编辑器 | CSS 实时预览、缩进单位、字号、自动换行、允许同时打开多个编辑器、保存时尝试格式化 |
| 行为与安全 | 控制台调试日志、JS 改动后自动重载、重载提示开关、CSS 内容校验、JS 语法校验、JS 启用前二次确认 |
| 本地文件监听 | 模式（禁用 / 监听 / 仅启动加载一次）、文件夹路径、轮询间隔、合并策略、文件消失时删除片段 |
| 数据 | 导出 JSON、导入并追加、导入并覆盖（自动备份）、打开备份目录、恢复默认设置、清空全部片段（危险区） |
| Gist 同步 | Token 配置（fine-grained / classic 两种创建入口）、从 Gist 导入、发布到 Gist、上次发布 / 导入记录 |
| 关于 | 版本、仓库链接、反馈入口、License |

**与 TCOTC 的差异（3 处，均为平台差异）**

| TCOTC 设置项 | DSH 处理 |
| --- | --- |
| `showPublishCheckbox` / `disabledInPublish`（发布服务开关） | **移除**：DSH 没有「发布服务」概念 |
| `openNativeSnippets`（打开思源原生片段窗口） | **替换**为「打开备份目录」（DSH 无原生片段管理窗口） |
| `fileWatchPath` 仅支持相对路径 | **放宽**为支持绝对路径与 `~/`，因为 DSH 宿主是 Node 进程而非内核沙箱 |

**已知限制（诚实说明）**：DSH 的设置面板开合与当前分组是 `ui-settings-general` 组件内部的
本地状态，没有对外的「打开到指定 section」服务。因此面板上的 `⚙` 采用**尽力而为**的深链：
先点击侧栏官方的「设置」触发按钮，再按我们注册的本地化标题匹配并点击对应导航行；
任何一步失败就只打开设置面板（用户自己点「代码片段管理器」），不会报错。

---

## 8. 设置深链的备选方案（若你希望更稳）

| 方案 | 说明 | 代价 |
| --- | --- | --- |
| A. 尽力而为 DOM 深链（推荐，默认） | 见 §7 限制说明；失效时优雅降级 | 上游改 DOM 结构时深链失效（但功能不失效） |
| B. 面板内自带「快速设置」抽屉 | 把最常用的 5～6 项也放进快捷面板 | 与设置页有重复入口，需保持两处一致 |
| C. 只打开设置面板 | 用户自己点导航项 | 最简单，体验略差 |

---

## 9. 分阶段交付

| 阶段 | 内容 | 完成标志 |
| --- | --- | --- |
| **P1 骨架与核心** | 包结构 / cordis.patch / 命名空间 schema / 两个席位注册 / 快捷面板 / 设置页（通用·菜单·行为安全）/ 片段运行时 / 增删改查·开关·复制·拖拽排序·搜索 / zh+en 字典 | 面板可增删片段，CSS 片段启用后界面立即变化 |
| **P2 编辑器与数据** | CodeMirror 6 编辑器 / CSS 实时预览 / 缩进与字号 / 导入导出 JSON / 覆盖前备份 / 打开备份目录 / 恢复默认 / 危险区 | 编辑器可写可存，导出文件可再导入 |
| **P3 宿主能力** | 文件夹监听（三种模式）/ Gist Token / 从 Gist 导入（合并·覆盖·仅新增 + 差异对比）/ 发布到 Gist | 改本地 `.css` 文件后片段自动更新；能从 Gist 拉取并发布 |
| **P4 打磨与验证** | 暗色 / rail 态 / 窄屏 / 空状态 / 键盘可达性 / README / 真实 profile 加载验证 / 打 tag 推送 | 见 §10 全部通过 |

---

## 10. 验证方案

**构建与静态检查**

```bash
pnpm build                                  # 产出 lib/index.js 与 client/client.js
node -e "import('./lib/index.js').then(m => console.log(m.name, typeof m.apply))"
node -e "JSON.parse(require('fs').readFileSync('package.json'))"   # 清单自检
```

**真实加载验证**（挂进 web profile）

```bash
dsh plugin --profile web add link:/mnt/mediaHDD4T/work/dsh-workspace/dsh_plugin/dsh-snippets
```

逐项检查：

1. 侧栏底部出现 `</>` 图标，与手机图标同排；改 `footerPosition` 后能左右切换。
2. 面板可开合、标签页计数正确、搜索过滤正确、拖拽排序可保存。
3. 新增一段「醒目」的 CSS（例如给 `#root` 加描边）并启用 → 界面**立即**变化；关闭 → 立即还原。
4. 新增一段 JS（例如 `console.log` + 改一个 DOM 属性）并启用 → 重载后生效；禁用后重载才撤销。
5. 设置页出现独立的「代码片段管理器」导航项；每一项改动刷新页面后仍然保留。
6. 导出 JSON → 清空 → 导入并追加 → 片段与开关状态完全恢复。
7. 指向一个含 `.css` / `.js` 的目录，开启监听 → 改文件后片段自动更新。
8. Gist：配置 Token → 发布 → 在 GitHub 上确认文件；改一个片段 → 重新导入走「合并更新」，差异对比显示正确。
9. 移除插件（`dsh plugin --profile web remove dsh-snippets`）→ 注入的 `<style>` 消失、设置命名空间消失、界面无残留。

**需要注意**：第 3～8 项需要在运行中的 dsh web GUI 里手工确认，而**重启 dsh web 会中断我们当前这个会话**。
所以实施时我会先尝试 `patchReload: live` 的热加载；如果必须重启，会先征求你的同意，或者由你在合适的时间重启后我再继续验证。

---

## 11. 待你确认的三个选择

1. **编辑器**：CodeMirror 6（对齐 TCOTC，bundle 约 +450KB）**还是**轻量 `textarea`（零依赖，无高亮）。
2. **验证方式**：允许我重启 dsh web 自行验证，还是我只做构建/静态验证、由你重启后我远程继续。
3. **提交署名**：仓库没有配置 `user.name` / `user.email`，请给出这次提交要用的署名（默认用
   `zhang24xiao` + GitHub 的 noreply 邮箱）。

---

## 12. 实施记录

设计确认后按 P1→P4 落地，最终实现与本文档的差异如下。

### 12.1 已确认的三个选择

| 选择 | 结论 |
| --- | --- |
| 编辑器 | CodeMirror 6（行号 / CSS+JS 高亮 / 括号匹配 / 折叠 / 搜索替换 / 历史） |
| 验证方式 | 先尝试热加载；需要重启时先征求同意 |
| 提交署名 | `ZerriZhang <zhang24xiao@126.com>` |

### 12.2 与设计稿不同、以代码为准的地方

1. **Gist Token 不放设置命名空间。** 设计稿用 schemastery 的 `role('secret')`；实现改为宿主私有的
   `$DSH_HOME/dsh-snippets/gist-token.json`（权限 0600）。这样密钥完全不经过设置通道，
   也不会随设置文档被备份或分享；浏览器只通过 `/snippets/api/status` 得知「是否已配置」。
2. **宿主接口整套 loopback 围栏。** 设计稿只提到「不回传 Token」；实现把整个 `/snippets/api` 前缀
   收敛为仅响应本机请求。局域网 / 隧道访问时，文件监听与 Gist 两个分区自行禁用并说明原因，
   而代码片段本身仍可正常编辑与生效（它走设置通道）。
3. **`theme` 编辑器主题** 由 CSS 变量驱动（`body[data-ds-dark-theme]` 覆盖），不引入第二个配色表。
4. **格式化** 采用「只重写行首空白」的保守实现，并在括号不平衡或字符串/模板字面量未闭合时拒绝执行；
   设计稿里「JS 仅校验不重排」的折中因此不再需要。
5. **确认框** 不使用嵌套 Modal，而是在同一个编辑器卡片里切换底栏（避免两层遮罩叠加）。
6. **新增了设计稿没有的两个安全项**：`confirmJsExecution`（启用 JS 前二次确认）与
   `autoReloadAfterJsEdit` 的「其他编辑器仍打开时不自动重载」保护。
7. **测试** 落成两套 Node 测试（`test/host.test.mjs`、`test/client.test.mjs`），
   后者按真实的 `window.__ModuleLoader__.load` 契约加载构建产物并在 jsdom 中驱动运行时。
8. **设置深链** 按设计稿的「方案 A」实现：从自己的席位向上找到 sidebar foot 中的
   `button[aria-haspopup="dialog"]`，点击后再按本地化标题匹配 `[role="dialog"][aria-modal="true"] nav button`。
   任一步失败都只是「没有跳转」，不影响任何功能。
9. **文件清单** 增加 `scripts/build-tests.mjs` 与 `test/entry.ts`（仅开发期使用，不随包发布）。
10. **`</>` 图标自己画。** 实测发现官方图标集里的 `IconCodeOutline16` 画的是 `#` 而不是 `</>`，
    与参考图不符；因此新增 `src/client/ui/icons.tsx`（`CodeGlyph`，三笔描边，`currentColor`），
    与 `dsh-remote-web-ui` 自绘手机图标的做法一致。`test/client.test.mjs` 现在断言触发器内联的
    就是这三笔的 `</>` 字形，避免以后被悄悄换回。
11. **触发器改为纯图标。** 实测反馈「展开时不需要文字」；同时官方外壳在收起状态下
    仍把 `sidebar.footer.action` 排成横向，导致第二个插件的图标被挤出 56px 轨道。
    因此：触发器去掉文字与计数徽标（数量移入悬停提示与面板底部），
    并注入一条窄范围规则 `html [class*='_collapsed'] [class*='_footerActions']{flex-direction:column}`。
    该 shim 用属性子串选择器 + `html` 提高优先级，外壳类名变化时只会失效而不会致错；
    `test/client.test.mjs` 断言这条规则确实随样式表下发。
13. **触发器几何与间距对齐隔壁条目。** 实测反馈「大小间距不同、不协调」。
    核对 `remote.module.css` 后确认：隔壁条目的触发器在收起态是 **36×36 圆形**、
    展开态是 **36px 高**，行内间距 6px、轨道内间距 4px；而本插件原来是 28/30px 方角 + 容器无间距。
    现已改为同款 36px 高度与 36px 圆形热区，并让 shim 同时下发 6px / 4px 间距。
    `</>` 字形用真实矢量路径与官方图标做了逐像素对照（见 `design/icon-fidelity-preview.png`），
    笔画粗细 1.4 落在「填充的下载图标」与「描边的电话图标」之间，保持协调。
14. **宽度修正（第二轮）。** 第一次只对齐了高度，漏掉了 `[data-wide='wide']` 里的
    `padding: 0 10px` 与 `border-radius: 999px`——这两条才是让「16px 字形 + 20px 内边距 = 36px 盒子」
    的关键。少了内边距，展开态触发器只有 16px 宽，悬停时成了一条竖长药丸，
    与隔壁 36px 圆形热区并列非常刺眼。现在基础规则即 36×36 圆形（收起态），
    展开态仅追加 `width:auto / radius 999px / padding 0 10px`，两者悬停面完全一致。
    `test/client.test.mjs` 同时断言 `data-wide` / `data-rail` 标记与这条几何规则随样式表下发。
15. **编辑器弹窗改为视口自适应。** 官方 `Modal` 卡片是 `width: min(380px, 100%)` 且没有高度上限——
    对两三个字段的表单合适，对代码编辑器太窄（内容列只有 332px），而且片段一长就会把卡片顶出窗口，
    连关闭按钮都够不到。现在弹窗取 `width: min(1040px, 100vw - 48px)`、
    `height: min(760px, 100vh - 72px)`（48px 是遮罩层的内边距，额外 24px 是卡片自身的下内边距，
    因为 DSH 没有全局 `box-sizing` 重置，属 content-box），
    并让 `content → body → 代码区` 走 flex 链吃掉剩余高度。已在 1222×700 / 1600×900 / 1000×600 /
    800×520 / 560×720 / 400×700 / 1222×480 七种视口下验证：卡片都在视口内，代码区不低于 180px。
12. **运行时的投影时机修正。** 原实现把「同步运行时」塞在 `getConfig` 里，
    而 `getConfig` 是交给 `useSyncExternalStore` 的 `getSnapshot`，React 会在渲染期调用它——
    在渲染期改 DOM、通知 UI store 是副作用。现在 `getConfig` 是纯读取，
    投影只在控制器创建时与每次设置提交时执行；同时缓存最后一次可用配置，
    避免连接抖动（ready→loading）时把已生效的 CSS 从页面上抹掉。

### 12.3 落地后的目录

```
dsh-snippets/
├── package.json  cordis.patch.yml  tsconfig.json  esbuild.config.mjs  LICENSE
├── README.md  README.zh-CN.md  docs/DESIGN.md
├── src/
│   ├── shared/{types,schema,model,gist,version}.ts
│   ├── host/{index,paths,http,routes,backups,file-watch,gist}.ts
│   └── client/
│       ├── index.ts  controller.ts  apply.ts  locales.ts  styles.ts
│       ├── host-api.ts  deep-link.ts
│       └── ui/{shared,FooterEntry,ManagerPanel,EditorDialog,OverlayHost,SettingsPage,GistDialogs}.tsx
│       └── ui/code-editor.ts
├── lib/index.js          # 构建产物（宿主半，约 39 KB）
├── client/client.js      # 构建产物（客户端半，约 601 KB，含 CodeMirror）
├── scripts/build-tests.mjs
└── test/{entry.ts,host.test.mjs,client.test.mjs}
```

### 12.5 设置入口的最终位置（需求 2 的修订）

最初按「独立的设置项」把设置页注册进 `settings.section`，于是它成了设置导航里的一级项
（通用设置 / 模型 / 插件 / Agent 预设 / 代码片段管理器 / 插件市场）。实机看过后改为放进
**设置 → 插件 → 插件配置**——也就是其他 host-plane 插件的设置所在的那张卡片列表。

机制是 `settings.plugin.item`：一个**以设置命名空间为 key** 的 keyed 插槽。插件配置这个 tab 会读取
宿主当前提供的命名空间，然后按命名空间逐个派发 slot key，所以渲染出来的是「宿主注册的命名空间」
与「注册了卡片的 key」两个清单的交集。本插件宿主半已经注册 `dsh-snippets`，浏览器半用同一个字符串
注册卡片，配对就完成了——tab 完全不需要知道这个命名空间是什么意思。

卡片外观逐值照抄了邻居（`PluginCard` 模块：圆角 16、半像素描边、表头 padding 14/16、
15px/600 标题配 13px 说明、内容区 16px 内缩加一条发丝分隔线），否则一行里会看出是「外来户」。

**一处有意的差异**：卡片内容仍是即时生效，没有 Save / Discard。邻居是暂存式表单，而代码片段管理器
的使用方式就是「拨一下开关、看页面反应」，中间插一个保存会把同一个动作劈成两半。这一点在
`test/client.test.mjs` 里有展开/收起的交互测试覆盖（默认折叠、点击展开后才渲染分组）。

### 12.4 验证结果

- `npm run check`：`tsc --noEmit` 通过；两个 bundle 构建通过；
  `test/host.test.mjs` 与 `test/client.test.mjs` 全部通过。
- 客户端测试覆盖需求 1 的核心链路：启用的 CSS 片段恰好产生一个 `<style>`、
  启用的 JS 片段恰好执行一次、停用只移除对应元素、类型总开关拦截注入、卸载后无残留；
  并对三个已注册席位（`sidebar.footer.action` / `settings.section` / `shell.overlay`）做服务端渲染。
  这一步在实现期抓到了一个真实缺陷：`Observable.get` 原本是原型方法，
  作为裸引用传给 `useSyncExternalStore` 时 `this` 丢失，会让插件在浏览器里完全无法渲染；
  现已改为箭头属性。
- 宿主测试覆盖：命名空间注册、9 条路由的 loopback 围栏、备份、文件夹镜像（含跨扫描 ID 稳定）、
  Gist 三种导入模式、内容校验、格式化安全性。
