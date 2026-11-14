#!/usr/bin/env python3
"""把网站里的 BiliPicks（bili/）同步到开源仓库 bilipicks。

网站版：bili/index.html 里内嵌数据（const DATA = {...};），策展人信息写死；bili/tv.html 是电视版，运行时从 index.html 读数据。
开源版：index.html + tv.html + data.js（数据单独一个文件，开头的 "site" 写策展人信息，别人改它就能做自己的版本）。
安卓电视版应用（android/）只在开源仓库里维护，不从这里同步。

用法（在网站仓库根目录运行）：
  python3 bili/sync_bilipicks.py ../../bilipicks          只写文件，之后自己看 git diff、提交
  python3 bili/sync_bilipicks.py ../../bilipicks --check  只检查能不能转换，不写文件

每一处替换都会核对原文；网站上的文字改过、对不上时直接报错，不会悄悄漏改。
开源版 data.js 里已有的 "site"（策展人信息）会保留。README 不自动改。
"""
import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA_RE = re.compile(r"^const DATA = (\{.*\});$", re.M)

DATA_HEADER = (
    "// BiliPicks 数据文件：视频清单、成长路线、频道榜、策展人信息都在这里。\n"
    "// 改这个文件就能做出你自己的版本。DATA 必须保持在单独一行（update.py 靠它读写）。\n"
    "// 手动改完可运行 python3 update.py --check 检查格式和失效视频。\n"
)

DEFAULT_SITE = {
    "curator": "实践哥 Li", "curatorHandle": "@MinLiBuilds", "curatorUrl": "https://x.com/MinLiBuilds",
    "audience": "五六年级到初一", "timezone": "Asia/Singapore",
}

# 网站版 index.html → 开源版：(原文, 替换成)。原文必须恰好出现一次。
HTML_SUBS = [
    ("BiliPicks — Min 给五六年级孩子手选的 B 站视频",
     "BiliPicks — 家长给孩子手选的 B 站视频"),
    ("这份清单是<strong>实践哥 Li（@MinLiBuilds）</strong>给<strong>五六年级到初一</strong>的孩子手选的 B 站入口。",
     "这份清单是<strong id=\"about-curator\"></strong>给<strong id=\"about-audience\"></strong>的孩子手选的 B 站入口。"),
    ("<p>策展：<a href=\"https://x.com/MinLiBuilds\" target=\"_blank\" rel=\"noopener noreferrer\">实践哥 Li @MinLiBuilds</a>（Asia/Singapore）</p>",
     "<p id=\"about-credit\"></p>\n      <p>BiliPicks 是开源项目，可以复制一份改成你自己的清单：改 <code>data.js</code> 就行。</p>"),
    ("// 封面平时由 bili/update.py 写进数据。", "// 封面平时由 update.py 写进 data.js。"),
    ("function renderAbout() {\n",
     "function renderAbout() {\n"
     "  const s = DATA.site || {};\n"
     "  const who = [s.curator, s.curatorHandle].filter(Boolean);\n"
     "  $('#about-curator').textContent = who.length > 1 ? `${who[0]}（${who[1]}）` : (who[0] || '家长');\n"
     "  $('#about-audience').textContent = s.audience || '中小学';\n"
     "  const name = esc(who.join(' · ') || '家长');\n"
     "  const link = s.curatorUrl ? `<a href=\"${esc(s.curatorUrl)}\" target=\"_blank\" rel=\"noopener noreferrer\">${name}</a>` : name;\n"
     "  $('#about-credit').innerHTML = `策展：${link}${s.timezone ? `（${esc(s.timezone)}）` : ''}`;\n"),
]

# 网站版 tv.html → 开源版：数据改成从 data.js 加载
TV_SUBS = [
    ("\n<script>\n'use strict';", "\n<script src=\"data.js\"></script>\n<script>\n'use strict';"),
    ("数据和网页版是同一份：读 index.html 里的 `const DATA = {...};`", "数据和网页版是同一份：data.js"),
]

# 网站版 update.py → 开源版
PY_SUBS = [
    ("数据都内嵌在 bili/index.html 的", "数据都在 data.js 的"),
    ("刷新后 git 提交并推送（推到 main 后 Cloudflare 自动部署）",
     "刷新后 git 提交并推送（托管在 GitHub Pages / Cloudflare Pages 时会自动上线）"),
    ('INDEX = HERE / "index.html"', 'INDEX = HERE / "data.js"'),
    ('print("已推送，Cloudflare 一两分钟后自动上线：https://minlibuilds.com/bili/")',
     'print("已推送。如果网站托管在 GitHub Pages / Cloudflare Pages，一两分钟后自动上线。")'),
]
PY_ALL = [  # 出现多次，全部替换
    ("python3 bili/update.py", "python3 update.py"),
    ("bili/index.html", "data.js"),
]
# 转换后不该再出现的东西
LEFTOVERS = ["MinLiBuilds", "实践哥", "minlibuilds.com", "bili/index.html", "bili/update.py", "Min 给"]


def sub_once(text, old, new, where):
    n = text.count(old)
    if n != 1:
        sys.exit(f"{where}：这段原文应该出现 1 次，实际 {n} 次，网站上的文字可能改过了，请更新 sync_bilipicks.py：\n  {old[:80]}")
    return text.replace(old, new)


def main():
    ap = argparse.ArgumentParser(description="把 bili/ 同步到开源仓库 bilipicks")
    ap.add_argument("repo", help="bilipicks 仓库的路径")
    ap.add_argument("--check", action="store_true", help="只检查，不写文件")
    args = ap.parse_args()
    repo = Path(args.repo).resolve()
    if not (repo / ".git").exists():
        sys.exit(f"{repo} 不是 git 仓库")

    # ---- index.html：拆出数据，换成 <script src="data.js"> ----
    html = (HERE / "index.html").read_text(encoding="utf-8")
    m = DATA_RE.search(html)
    if not m:
        sys.exit("在 bili/index.html 里找不到 `const DATA = {...};` 这一行")
    data = json.loads(m.group(1))
    html = html[:m.start()] + html[m.end() + 1:]  # 连同行尾换行一起去掉
    html = sub_once(html, "\n<script>\n", '\n<script src="data.js"></script>\n<script>\n', "index.html")
    for old, new in HTML_SUBS:
        html = sub_once(html, old, new, "index.html")

    # ---- data.js：保留开源版已有的策展人信息，放在最前面 ----
    site = DEFAULT_SITE
    old_js = repo / "data.js"
    if old_js.exists():
        om = DATA_RE.search(old_js.read_text(encoding="utf-8"))
        if om:
            site = json.loads(om.group(1)).get("site") or site
    data = {"site": site, **{k: v for k, v in data.items() if k != "site"}}
    js = DATA_HEADER + "const DATA = " + json.dumps(data, ensure_ascii=False) + ";\n"

    # ---- tv.html ----
    tv = (HERE / "tv.html").read_text(encoding="utf-8")
    for old, new in TV_SUBS:
        tv = sub_once(tv, old, new, "tv.html")

    # ---- update.py ----
    py = (HERE / "update.py").read_text(encoding="utf-8")
    for old, new in PY_SUBS:
        py = sub_once(py, old, new, "update.py")
    for old, new in PY_ALL:
        py = py.replace(old, new)

    for name, text in (("index.html", html), ("tv.html", tv), ("update.py", py)):
        bad = [w for w in LEFTOVERS if w in text]
        if bad:
            sys.exit(f"转换后的 {name} 里还有网站专属内容：{bad}，请更新 sync_bilipicks.py")

    stages = (data.get("path") or {}).get("stages", [])
    print(f"视频 {len(data['videos'])} 条，成长路线 {len(stages)} 关 {sum(len(s.get('steps', s.get('items', []))) for s in stages)} 步；"
          f"策展人：{site.get('curator')}")
    if args.check:
        print("（--check：没有写入文件）")
        return
    (repo / "index.html").write_text(html, encoding="utf-8")
    (repo / "tv.html").write_text(tv, encoding="utf-8")
    (repo / "data.js").write_text(js, encoding="utf-8")
    (repo / "update.py").write_text(py, encoding="utf-8")
    print(f"已写入 {repo}/index.html、tv.html、data.js、update.py。README 需要的话手动改。")


if __name__ == "__main__":
    main()
