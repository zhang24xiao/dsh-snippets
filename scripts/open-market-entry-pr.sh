#!/usr/bin/env bash
#
# 向 awesome-dsh-plugin 列表提一个「修正 dsh-snippets 条目位置描述」的 PR。
#
# 为什么需要人工提这个 PR：市场列表（awesome-dsh-plugin/awesome-dsh-plugin）是
# 一份人工维护的 curated list，README 就是列表本体，条目描述不会跟随插件仓库自动
# 更新。dsh-snippets 的设置入口在 DSH 0.1.6-alpha.2 之后，从「设置 → 插件 →
# 插件配置」里的卡片改成了设置导航里的独立页面，列表里的描述却还停在旧位置。
#
# 用法（凭据只留在你自己的终端环境里，本脚本从不回显它）：
#
#   GH_TOKEN=<你的 PAT> ./scripts/open-market-entry-pr.sh
#
# PAT 权限：classic token 勾 public_repo 即可；fine-grained token 需要
# 目标仓库的 Contents: Read and write 与 Pull requests: Read and write。
#
# 脚本是幂等的：fork 已存在就复用，分支已存在就覆盖推送；重复执行只会刷新同一个 PR
# 分支（GitHub 上已开的 PR 会自动跟随新提交，不会重复建 PR）。
set -euo pipefail

: "${GH_TOKEN:?请通过环境变量提供 GH_TOKEN（需要 public_repo 权限）}"

UPSTREAM="awesome-dsh-plugin/awesome-dsh-plugin"
FORK_OWNER="zhang24xiao"
BASE_BRANCH="main"
BRANCH="docs/dsh-snippets-settings-placement"
API="https://api.github.com"
FIX_COMMIT="b65e5ed8bc5d3b441351be510b453083f503056f"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

api() {
  curl -sS \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$@"
}

say() { printf '%s\n' "$*" >&2; }

say "[1/6] 确认 ${FORK_OWNER}/awesome-dsh-plugin 这个 fork ..."
if api -o /dev/null -f "${API}/repos/${FORK_OWNER}/awesome-dsh-plugin"; then
  say "      已存在，直接复用"
else
  say "      不存在，创建 fork"
  api -o /dev/null -X POST "${API}/repos/${UPSTREAM}/forks"
  say "      等待 fork 就绪（GitHub 是异步建仓）..."
  ready=""
  for _ in $(seq 1 30); do
    sleep 3
    if api -o /dev/null -f "${API}/repos/${FORK_OWNER}/awesome-dsh-plugin"; then ready=1; break; fi
  done
  [ -n "${ready}" ] || { say "      fork 在 90 秒内没有就绪，请稍后重跑本脚本"; exit 1; }
fi

say "[2/6] 克隆 fork（走 SSH，token 不落盘）..."
git clone --quiet --depth 1 "git@github.com:${FORK_OWNER}/awesome-dsh-plugin.git" "${WORKDIR}/repo"
cd "${WORKDIR}/repo"
git checkout --quiet -B "${BRANCH}" "origin/${BASE_BRANCH}"

say "[3/6] 改写两条条目描述 ..."
python3 - "${WORKDIR}/repo" <<'PY'
import pathlib, sys

root = pathlib.Path(sys.argv[1])
edits = [
    (
        "README.md",
        "its own card under Settings - Plugins",
        "its own page in the Settings navigation",
    ),
    (
        "README.zh.md",
        "设置里在「插件」下自带一张卡片",
        "并在设置导航里有自己的页面",
    ),
]

for name, old, new in edits:
    path = root / name
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"{name}: 期望恰好 1 处「{old}」，实际 {count} 处 —— "
            "列表可能已被别人改过，请人工确认后再提 PR"
        )
    path.write_text(text.replace(old, new), encoding="utf-8")
    print(f"      {name}: 已替换 1 处", file=sys.stderr)
PY

say "[4/6] 提交 ..."
git add README.md README.zh.md
NAME="$(git config --global user.name || echo "${FORK_OWNER}")"
MAIL="$(git config --global user.email || echo "${FORK_OWNER}@users.noreply.github.com")"
git -c user.name="${NAME}" -c user.email="${MAIL}" commit --quiet -F - <<'MSG'
Update zhang24xiao/dsh-snippets: its own settings page, not a Plugins card

dsh-snippets moved its settings surface out of the card under
Settings -> Plugins -> Plugin configuration and into its own page in the
settings navigation. The move was forced: DSH 0.1.6-alpha.2 no longer declares
the `settings.plugin.item` seat that carried the card, and a registration
against an undeclared seat is dropped silently, so the settings surface simply
stopped rendering.

Fix: https://github.com/zhang24xiao/dsh-snippets/commit/b65e5ed
MSG

say "[5/6] 推送分支 ${BRANCH} ..."
git push --quiet --force-with-lease -u origin "${BRANCH}"

say "[6/6] 创建 PR ..."
python3 - "${WORKDIR}/pr.json" "${FORK_OWNER}" "${BRANCH}" "${FIX_COMMIT}" <<'PY'
import json, sys

out, owner, branch, commit = sys.argv[1:5]

body = f"""`zhang24xiao/dsh-snippets` moved where its settings live, so the entry's placement
sentence is now out of date.

**Before:** a card under **Settings → Plugins → Plugin configuration**
**After:** its own page in the **settings navigation**

The move was forced rather than cosmetic. DSH `0.1.6-alpha.2` no longer declares the
`settings.plugin.item` seat that carried that card, and a registration against an
undeclared seat is dropped silently — the settings surface stopped rendering entirely
while the user's saved settings stayed intact. The fix is
https://github.com/zhang24xiao/dsh-snippets/commit/{commit}

Nothing else about the plugin changes: the install command, the sidebar-footer quick
toggle, the folder and Gist sync all stay as listed.

This PR only corrects the placement sentence, one line in each list:

- `README.md:767`
- `README.zh.md:767`
"""

json.dump(
    {
        "title": "Update zhang24xiao/dsh-snippets: its own settings page, not a Plugins card",
        "head": f"{owner}:{branch}",
        "base": "main",
        "body": body,
    },
    open(out, "w", encoding="utf-8"),
)
PY
api -X POST "${API}/repos/${UPSTREAM}/pulls" --data-binary "@${WORKDIR}/pr.json"
say ""
say "完成 —— 上面的 JSON 里 html_url 就是 PR 地址。"
