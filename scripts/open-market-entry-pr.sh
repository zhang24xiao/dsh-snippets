#!/usr/bin/env bash
#
# 向 awesome-dsh-plugin 列表提一个「修正 dsh-snippets 条目位置描述」的 PR。
#
# ── 这个列表的真源是什么 ────────────────────────────────────────────────
# 市场列表（awesome-dsh-plugin/awesome-dsh-plugin）的真正数据源是
#   data/plugins/<owner>__<repo>.yml
# 里面每条包含 url / name / category / description.{en,zh}。
#
# 仓库根部的 README.md 与 README.zh.md 里的条目列表 **是生成物**：由
#   node scripts/generate-readme.mjs
# 从 data/plugins/*.yml 重建（只替换 <!-- BEGIN/END PLUGINS --> 标记块）。
# 合并到 main 之后，.github/workflows/sync-readme.yml 还会再自动重生成一次。
#
# 所以本脚本**只改 data/plugins/zhang24xiao__dsh-snippets.yml**，绝不手改 README。
#
# ── 为什么必须这样（血泪教训）────────────────────────────────────────────
# 曾经的版本改的是 README.md / README.zh.md，结果 CI 第 8 步
# （pr-check.yml → "READMEs match data/plugins"）直接失败：
#
#   if git diff --quiet <base>...HEAD -- README.md README.zh.md; then
#       node scripts/generate-readme.mjs   # PR 没碰 README → 重新生成，放行
#       exit 0
#   fi
#   node scripts/generate-readme.mjs --check   # PR 碰了 README → 必须与真源一致
#
# 改动落在生成物上、而真源还是旧文案时，--check 会用旧文案重建 README，
# 与提交的新文案对不上 → 报 "is out of sync with data/plugins/" 并退出 1。
# 相关 PR：awesome-dsh-plugin/awesome-dsh-plugin#5587（已被关闭，其意图由维护者
# 直接改真源落地了）。脚本第 [5/7] 步的自检就是为了在推送前拦住这类形状错误。
#
# ── 用法 ────────────────────────────────────────────────────────────────
# 凭据只留在你自己的终端环境里，本脚本从不回显它：
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
# 脚本是幂等的：
#   * fork 已存在就复用，分支已存在就覆盖推送（重复执行只刷新同一个 PR 分支）；
#   * 如果真源里已经是新文案（比如维护者已经手动落地），脚本直接报「无需提 PR」
#     并以 0 退出，不会造出一个空 diff 的 PR。
#
# 自检里有一段要跑市场仓库自己的生成器，因此会临时 npm ci（约几秒，装到忽略目录
# 里，不进 diff）。若确实没法装依赖，可以显式跳过：
#
#   MARKET_SKIP_GENERATOR_CHECK=1 ./scripts/open-market-entry-pr.sh
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
# 分支名特意不复用 #5587 那个（它已随真源落地而被关闭），免得跟一个已关闭的 PR 混淆。
BRANCH="docs/dsh-snippets-entry-placement"
API="https://api.github.com"
FIX_COMMIT="b65e5ed8bc5d3b441351be510b453083f503056f"

# 真源：唯一该被本 PR 触碰的文件。
ENTRY="data/plugins/zhang24xiao__dsh-snippets.yml"
# 要替换的文案（旧 → 新）。bash 与 python 共用这几个变量，避免两处各写一份。
OLD_EN="its own card under Settings - Plugins"
NEW_EN="its own page in the Settings navigation"
OLD_ZH="设置里在「插件」下自带一张卡片"
NEW_ZH="并在设置导航里有自己的页面"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

say() { printf '%s\n' "$*" >&2; }
die() { printf '%s\n' "$*" >&2; exit 1; }

api() {
  curl -sS \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/json" \
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

say "[0/7] 校验 token ..."
me_code="$(curl -sS -o "${WORKDIR}/me.json" -D "${WORKDIR}/me.headers" -w '%{http_code}' \
  -H "Authorization: Bearer ${GH_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "${API}/user" 2>/dev/null || echo 000)"
require_auth "${me_code}"
[ "${me_code}" = "200" ] || die "校验 token 时 GitHub 返回 ${me_code}，无法继续。"
login="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("login","?"))' "${WORKDIR}/me.json" 2>/dev/null || echo '?')"
say "      已认证为 ${login}"
if [ "${login}" != "${FORK_OWNER}" ]; then
  say "      注意：认证身份是 ${login}，但脚本会往 ${FORK_OWNER} 的 fork 推送。"
  say "      如果这不是你预期的账号，请中止（Ctrl-C）后换成对应账号的 token。"
fi

# classic PAT 会回 x-oauth-scopes 头，fine-grained PAT 没有这个头。这个区别很
# 要紧：fine-grained PAT 只能授权给你自己或你所属组织的仓库，覆盖不到别人的仓库，
# 而最后一步要往 upstream 建 PR —— 那种情况下 GitHub 只会回一个 404。提前讲清楚，
# 省得推到一半才发现。
if grep -qi '^x-oauth-scopes:' "${WORKDIR}/me.headers"; then
  scopes="$(grep -i '^x-oauth-scopes:' "${WORKDIR}/me.headers" | head -1 | cut -d: -f2- | tr -d ' \r')"
  say "      token 类型：classic（scopes:${scopes:-（空）}）"
  case ",${scopes}," in
    *,public_repo,*|*,repo,*) : ;;
    *) say "      注意：scopes 里没有 public_repo，最后一步建 PR 可能被拒。" ;;
  esac
else
  say "      token 类型：fine-grained"
  say "      注意：fine-grained PAT 只能授权给你自己或你所属组织的仓库，无法在"
  say "            ${UPSTREAM} 上建 PR。如果最后一步报 404，请改用 classic PAT"
  say "            并勾上 public_repo；或者分支推上去后直接用浏览器建 PR。"
fi

say "[1/7] 确认 ${FORK_OWNER}/awesome-dsh-plugin 这个 fork ..."
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

say "[2/7] 拉取 upstream 的 ${BASE_BRANCH} 作为这次改动的基底 ..."
# 刻意基于 upstream 而不是 fork 的 main：fork 可能落后很多，基于落后分支提 PR 会
# 把「落后的那些提交」一起算成差异，看起来像在回退别人的更新，而且会被
# pr-check.yml 里的 stale-fork guard 拦下。
git -C "${WORKDIR}" init --quiet repo
cd "${WORKDIR}/repo"
# 只要一个提交就够：既省带宽，也天然保证基底就是当前 main 的尖端。
git remote add origin "git@github.com:${FORK_OWNER}/awesome-dsh-plugin.git"
git remote add upstream "https://github.com/${UPSTREAM}.git"
git fetch --quiet --depth 1 upstream "${BASE_BRANCH}"
git checkout --quiet -B "${BRANCH}" FETCH_HEAD
# 改动前的基底提交：后面自检的 diff 都对着它算。
BASE_SHA="$(git rev-parse HEAD)"
say "      基底：$(git log -1 --format='%h %s' | cut -c1-70)"

say "[3/7] 改写真源 ${ENTRY} 的两条描述 ..."
if python3 - "${WORKDIR}/repo" "${ENTRY}" "${OLD_EN}" "${NEW_EN}" "${OLD_ZH}" "${NEW_ZH}" <<'PY'
import pathlib, sys

root, entry_rel, old_en, new_en, old_zh, new_zh = sys.argv[1:7]
entry = pathlib.Path(root) / entry_rel
pairs = [(old_en, new_en, "en"), (old_zh, new_zh, "zh")]

text = entry.read_text(encoding="utf-8")
stale = [(o, n, loc) for o, n, loc in pairs if o in text]
fresh = [(o, n, loc) for o, n, loc in pairs if n in text]

if not stale and len(fresh) == len(pairs):
    # 真源已经是新文案了 —— 多半是维护者已经手动落地（#5587 就是这样）。
    # 没有任何要提交的改动，硬提只会造出一个空 diff 的 PR。
    raise SystemExit(3)

for o, n, loc in pairs:
    if o in text and n in text:
        raise SystemExit(
            f"{entry_rel}: description.{loc} 里新旧文案同时存在 —— 列表可能正被"
            "别人改，请人工确认后再提 PR"
        )

if not stale:
    raise SystemExit(
        f"{entry_rel}: 既找不到旧文案也找不到新文案 —— 列表可能已被改写过，"
        "请人工确认（先看 upstream main 的该文件）后再决定要不要提 PR"
    )

for o, n, loc in stale:
    count = text.count(o)
    if count != 1:
        raise SystemExit(
            f"{entry_rel}: description.{loc} 期望恰好 1 处「{o}」，实际 {count} 处 —— "
            "请人工确认后再提 PR"
        )
    text = text.replace(o, n)
    print(f"      description.{loc}: 已替换 1 处", file=sys.stderr)

entry.write_text(text, encoding="utf-8")
PY
then
  :
else
  rc=$?
  if [ "${rc}" = "3" ]; then
    say ""
    say "真源 ${ENTRY} 里已经是新文案了 —— 列表不需要再改，本次不提 PR。"
    say "（upstream main 上该条目已经描述为设置导航里的独立页面。）"
    exit 0
  fi
  die "改写条目描述失败（退出码 ${rc}）。"
fi

say "[4/7] 提交 ..."
# 只 add 真源。README.md / README.zh.md 是生成物，交给 main 上的 sync-readme.yml。
git add "${ENTRY}"
NAME="$(git config --global user.name || echo "${FORK_OWNER}")"
MAIL="$(git config --global user.email || echo "${FORK_OWNER}@users.noreply.github.com")"
git -c user.name="${NAME}" -c user.email="${MAIL}" commit --quiet -F - <<'MSG'
Update zhang24xiao/dsh-snippets entry: its own settings page, not a Plugins card

dsh-snippets moved its settings surface out of the card under
Settings -> Plugins -> Plugin configuration and into its own page in the
settings navigation. The move was forced: DSH 0.1.6-alpha.2 no longer declares
the `settings.plugin.item` seat that carried the card, and a registration
against an undeclared seat is dropped silently, so the settings surface simply
stopped rendering.

This edits the list's source of truth only — data/plugins/zhang24xiao__dsh-snippets.yml
(description.en / description.zh). The generated READMEs are left to
sync-readme.yml, which regenerates them on main after merge.

Fix: https://github.com/zhang24xiao/dsh-snippets/commit/b65e5ed
MSG

say "[5/7] 自检：推送前先在本地复现 CI 的判定路径 ..."

# 自检 1/3：本次 diff 必须**只**含真源那一个文件。这一条就是当初 #5587 翻车的形状
# ——改动落在生成物 README 上、真源没动 —— 它能在这里被拦住。
touched="$(git diff --name-only "${BASE_SHA}" HEAD)"
if [ "${touched}" != "${ENTRY}" ]; then
  say "      实际改动的文件："
  printf '        %s\n' ${touched} >&2
  die "自检失败：本次提交应当只改 ${ENTRY}（一个文件），实际如上。"
fi
say "      自检 1/3：diff 只含 ${ENTRY} ✔"

# 自检 2/3：用市场仓库自己的生成器，从改过的真源重建 README。这等价于 CI 第 8 步
# 在「PR 没碰 README」时走的那条分支（node scripts/generate-readme.mjs），并额外
# 断言新文案确实生成进了两份 README —— 也就是证明「真源改了 → 列表真的会变」。
if [ -n "${MARKET_SKIP_GENERATOR_CHECK:-}" ]; then
  say "      自检 2/3：已按 MARKET_SKIP_GENERATOR_CHECK 跳过生成器重建 ⚠"
  say "                （真源是否被生成器接受、文案是否会真的出现在列表里，未经本地验证）"
else
  say "      自检 2/3：装依赖并运行仓库自带生成器 ..."
  if ! ( npm ci --no-audit --no-fund --loglevel=error ); then
    die "自检失败：npm ci 装不上脚本依赖，没法本地复现生成器。
      网络不通时可用 MARKET_SKIP_GENERATOR_CHECK=1 跳过这条（其余自检仍会跑）。"
  fi
  if ! ( node scripts/generate-readme.mjs ); then
    die "自检失败：scripts/generate-readme.mjs 拒绝了改过的真源（YAML/字段校验没过）。
      CI 的同一段落也会失败，已中止，未推送。"
  fi
  grep -qF "${NEW_EN}" README.md \
    || die "自检失败：重建出的 README.md 里没有出现新英文描述「${NEW_EN}」。"
  grep -qF "${NEW_ZH}" README.zh.md \
    || die "自检失败：重建出的 README.zh.md 里没有出现新中文描述「${NEW_ZH}」。"
  # 生成器是唯一权威的判定：重建后再 --check 一次，确认树是自洽的。
  ( node scripts/generate-readme.mjs --check ) \
    || die "自检失败：生成结果与真源不自洽。"
  say "                生成器接受真源，且新文案已进入两份 README ✔"
  # 把重建出来的 README 丢掉 —— 本 PR 刻意不碰生成物，交给 main 上的 sync-readme.yml。
  git checkout -- README.md README.zh.md
fi

# 自检 3/3：直接照抄 CI 第 8 步的分支条件。README 不在 diff 里 → CI 只会重新生成、
# 不会做 --check 比对，因此不可能因为「README 与真源不一致」而失败。
if git diff --quiet "${BASE_SHA}" HEAD -- README.md README.zh.md; then
  say "      自检 3/3：PR 未改动生成物 README，CI 会走「重新生成」分支 ✔"
else
  die "自检失败：本次 PR 改动了 README.md/README.zh.md。
      CI 第 8 步一旦看到 README 被改动，就会用真源重建 README 再逐字节比对，
      而真源里的新文案与手改的 README 不可能同时对上 —— 这正是 #5587 失败的原因。
      请只改 ${ENTRY}，不要手改 README。"
fi

# 自检跑完，工作区必须是干净的（node_modules 已被 .gitignore 忽略，不会出现在这里）。
dirty="$(git status --porcelain)"
if [ -n "${dirty}" ]; then
  say "      工作区残留："
  printf '        %s\n' "${dirty}" >&2
  die "自检失败：自检结束后工作区仍有未提交改动，已中止（未推送）。"
fi
say "      自检通过：PR 形状与 CI 预期一致。"

say "[6/7] 推送分支 ${BRANCH} 到 fork ..."
if git ls-remote --exit-code --heads origin "${BRANCH}" >/dev/null 2>&1; then
  say "      fork 上已有该分支，覆盖推送"
  git fetch --quiet origin "${BRANCH}"
  git push --quiet "--force-with-lease=refs/heads/${BRANCH}:$(git rev-parse FETCH_HEAD)" \
    origin "${BRANCH}"
else
  say "      fork 上还没有该分支，新建推送"
  git push --quiet -u origin "${BRANCH}"
fi

say "[7/7] 创建 PR ..."
python3 - "${WORKDIR}/pr.json" "${FORK_OWNER}" "${BRANCH}" "${FIX_COMMIT}" "${ENTRY}" <<'PY'
import json, sys

out, owner, branch, commit, entry = sys.argv[1:6]

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

This touches the list's source of truth only:

- `{entry}` — `description.en` and `description.zh`

The generated `README.md` / `README.zh.md` are deliberately **not** edited here; they are
rebuilt from `data/plugins/` by `scripts/generate-readme.mjs` and regenerated on `main`
after merge. (Editing them by hand without the matching source change is what makes the
`READMEs match data/plugins` check fail.)
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
  404)
    # GitHub 对「token 无权在目标仓库建 PR」和「head/base 解析不到」都回 404，
    # 所以这里没法只靠状态码区分，两种可能都讲清楚。
    say ""
    say "创建 PR 返回 404。GitHub 对下列情况都报 404："
    say "  1) token 无权在 ${UPSTREAM} 上建 PR。若你用的是 fine-grained PAT："
    say "     它只能授权给你自己（或你所属组织）的仓库，覆盖不到别人的仓库，"
    say "     这种情况请改用 classic PAT 并勾上 public_repo。"
    say "  2) head/base 分支解析不到（head=${FORK_OWNER}:${BRANCH}，base=${BASE_BRANCH}）。"
    say ""
    say "无论哪种，分支都已经推上去了。用浏览器登录态建 PR 最快，一步到位："
    say "  https://github.com/${FORK_OWNER}/awesome-dsh-plugin/pull/new/${BRANCH}"
    exit 1
    ;;
  *) die "创建 PR 时 GitHub 返回 ${pr_code}，已中止。响应：$(head -c 400 "${WORKDIR}/pr-response.json" 2>/dev/null)" ;;
esac
