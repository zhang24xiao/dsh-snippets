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
#   ./scripts/open-market-entry-pr.sh
#
# 脚本会自己提示输入 token（不回显、不写文件、不进 shell 历史）。想预先放进
# 环境里也可以：
#
#   GH_TOKEN=<你的 PAT> ./scripts/open-market-entry-pr.sh
#
# PAT 权限：classic token 勾 public_repo 即可；fine-grained token 需要
# 目标仓库的 Contents: Read and write 与 Pull requests: Read and write。
#
# 脚本是幂等的：fork 已存在就复用，分支已存在就覆盖推送；重复执行只会刷新同一个 PR
# 分支（GitHub 上已开的 PR 会自动跟随新提交，不会重复建 PR）。
set -euo pipefail

# 先拿 token：优先环境变量，其次交互式问一次。刻意不做成命令行参数——那会把它
# 留在进程列表和 shell 历史里。
if [ -z "${GH_TOKEN:-}" ]; then
  if [ -t 0 ]; then
    printf 'GitHub PAT（不回显，仅本次进程使用）: ' >&2
    IFS= read -rs GH_TOKEN
    printf '\n' >&2
    export GH_TOKEN
  else
    printf '%s\n' "GH_TOKEN 未设置，且当前不是交互式终端。" >&2
    printf '%s\n' "用法：在终端里直接跑 ./scripts/open-market-entry-pr.sh ，它会提示输入。" >&2
    exit 1
  fi
fi
if [ -z "${GH_TOKEN}" ]; then
  printf '%s\n' "没有读到 token，已中止。" >&2
  exit 1
fi

UPSTREAM="awesome-dsh-plugin/awesome-dsh-plugin"
FORK_OWNER="zhang24xiao"
BASE_BRANCH="main"
BRANCH="docs/dsh-snippets-settings-placement"
API="https://api.github.com"
FIX_COMMIT="b65e5ed8bc5d3b441351be510b453083f503056f"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

say() { printf '%s\n' "$*" >&2; }
die() { printf '%s\n' "$*" >&2; exit 1; }

api() {
  curl -sS \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$@"
}

# 只要状态码。网络层失败给 000，好让调用方按「非预期状态」处理而不是当成成功。
http_code() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$@" 2>/dev/null)" || code="000"
  printf '%s' "${code:-000}"
}

# 认证问题就地报清楚，别让它退化成后面某个「资源不存在」的误判。
require_auth() {
  case "$1" in
    401) die "GitHub 返回 401：token 无效或已过期。请重新生成 PAT 后再跑。" ;;
    403) die "GitHub 返回 403：token 权限不足或触发了限流。请确认 PAT 勾了 public_repo。" ;;
  esac
}

say "[0/6] 校验 token ..."
me="$(api -o "${WORKDIR}/me.json" -w '%{http_code}' "${API}/user" || echo 000)"
require_auth "${me}"
[ "${me}" = "200" ] || die "校验 token 时 GitHub 返回 ${me}，无法继续。"
login="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("login","?"))' "${WORKDIR}/me.json" 2>/dev/null || echo '?')"
say "      已认证为 ${login}"
if [ "${login}" != "${FORK_OWNER}" ]; then
  say "      注意：认证身份是 ${login}，但脚本会往 ${FORK_OWNER} 的 fork 推送。"
  say "      如果这不是你预期的账号，请中止（Ctrl-C）后换成对应账号的 token。"
fi

say "[1/6] 确认 ${FORK_OWNER}/awesome-dsh-plugin 这个 fork ..."
code="$(http_code "${API}/repos/${FORK_OWNER}/awesome-dsh-plugin")"
require_auth "${code}"
case "${code}" in
  200) say "      已存在，直接复用" ;;
  404)
    say "      不存在，创建 fork"
    created="$(api -o /dev/null -w '%{http_code}' -X POST "${API}/repos/${UPSTREAM}/forks" || echo 000)"
    require_auth "${created}"
    case "${created}" in
      202|200) : ;;
      *) die "创建 fork 返回 ${created}，已中止。" ;;
    esac
    say "      等待 fork 就绪（GitHub 是异步建仓）..."
    ready=""
    for _ in $(seq 1 30); do
      sleep 3
      code="$(http_code "${API}/repos/${FORK_OWNER}/awesome-dsh-plugin")"
      require_auth "${code}"
      if [ "${code}" = "200" ]; then ready=1; break; fi
    done
    [ -n "${ready}" ] || die "fork 在 90 秒内没有就绪，请稍后重跑本脚本。"
    ;;
  *) die "查询 fork 时 GitHub 返回 ${code}，无法确认状态，已中止。" ;;
esac

say "[2/6] 拉取 upstream 的 ${BASE_BRANCH} 作为这次改动的基底 ..."
# 刻意基于 upstream 而不是 fork 的 main：fork 可能落后很多，基于落后分支提 PR 会
# 把「落后的那些提交」一起算成差异，看起来像在回退别人的更新。
git -C "${WORKDIR}" init --quiet repo
cd "${WORKDIR}/repo"
git remote add origin "git@github.com:${FORK_OWNER}/awesome-dsh-plugin.git"
git remote add upstream "https://github.com/${UPSTREAM}.git"
git fetch --quiet --depth 1 upstream "${BASE_BRANCH}"
git checkout --quiet -B "${BRANCH}" FETCH_HEAD
say "      基底：$(git log -1 --format='%h %s' | cut -c1-70)"

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

say "[5/6] 推送分支 ${BRANCH} 到 fork ..."
if git ls-remote --exit-code --heads origin "${BRANCH}" >/dev/null 2>&1; then
  say "      fork 上已有该分支，覆盖推送"
  git fetch --quiet origin "${BRANCH}"
  git push --quiet "--force-with-lease=refs/heads/${BRANCH}:$(git rev-parse FETCH_HEAD)" \
    origin "${BRANCH}"
else
  say "      fork 上还没有该分支，新建推送"
  git push --quiet -u origin "${BRANCH}"
fi

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

api -o "${WORKDIR}/pr-response.json" -w '%{http_code}' \
  -X POST "${API}/repos/${UPSTREAM}/pulls" --data-binary "@${WORKDIR}/pr.json" \
  > "${WORKDIR}/pr-code" || true
pr_code="$(cat "${WORKDIR}/pr-code" 2>/dev/null || echo 000)"
require_auth "${pr_code}"

case "${pr_code}" in
  201)
    say ""
    python3 - "${WORKDIR}/pr-response.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
print("完成 —— PR 地址：", d.get("html_url", "(响应里没有 html_url)"))
PY
    ;;
  422)
    # 最常见的是「同 head 的 PR 已经开着」，那其实是我们想要的状态。
    msg="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("message",""))' "${WORKDIR}/pr-response.json" 2>/dev/null || echo '')"
    if printf '%s' "${msg}" | grep -qi "already exists"; then
      say ""
      say "该分支的 PR 已经开着了（本次推送已把新提交加进去）。"
      say "去这里看：https://github.com/${UPSTREAM}/pulls?q=head%3A${FORK_OWNER}%3A${BRANCH}"
    else
      say "创建 PR 被拒（422）：${msg}"
      exit 1
    fi
    ;;
  *) die "创建 PR 时 GitHub 返回 ${pr_code}，已中止。响应：$(head -c 400 "${WORKDIR}/pr-response.json" 2>/dev/null)" ;;
esac
