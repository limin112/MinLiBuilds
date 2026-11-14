# MinLiBuilds 个人站

实践哥 Li（[@MinLiBuilds](https://x.com/MinLiBuilds)）个人主页：AI Builder，超级个体。自我宣传 + 商单联系。

## 本地预览

```bash
# 任意静态服务器即可
python3 -m http.server 5173
# 打开 http://localhost:5173
```

或直接双击打开 `index.html`。

## 结构

| 文件 | 说明 |
|------|------|
| `index.html` | 单页内容：关于 / 代表帖 / 合作 / 联系 |
| `styles.css` | Bench Log 视觉系统（首页与文章页共用） |
| `main.js` | 终端打字、复制账号、brief 生成邮件草稿 |
| `bili/` | BiliPicks：给五六年级孩子的 B 站精选播放页（9 关成长路线、频道榜、电视版），见下方 |

## 上线前建议改

1. **商务邮箱**：把 `hello@minlibuilds.com` 换成真实邮箱（`index.html` + `main.js`）
2. **域名**：部署到 Vercel / Cloudflare Pages / GitHub Pages
3. **OG 图**：需要时补一张分享缩略图

## 设计说明

- 调性：近黑工作台 + 荧光绿行动色 + 青色信号色，等宽数字，实测日志风
- 签名元素：Hero 区 `~/bench/2026.log` 实测日志；长文区按阅读 / 时间排序
- 转化路径：顶栏「谈合作」→ 联系区块 → brief 表单 / X DM / Telegram

## BiliPicks（/bili）

`bili/index.html` 是独立单页，所有数据内嵌在 `const DATA = {...};` 这一行：视频、分类、成长路线（`path`）、频道榜（`tiers` / `originals`）。用 `bili/update.py` 维护（只用 Python 标准库，在本机运行）：

```bash
python3 bili/update.py            # 检查失效视频（页面自动隐藏）、补封面和时长、刷新频道榜粉丝数
python3 bili/update.py --check    # 只出报告，不改文件
python3 bili/update.py add BV1xxxxxxxxx --cat 数学 --age 10 --reason "推荐理由" \
    [--caution "家长提示"] [--page 2] [--stage 2 --note "路线里的说明"] \
    [--title "自己写的标题"] [--orig "原作者"]
python3 bili/update.py --deploy   # 刷新后提交并推送到 main，Cloudflare 自动上线
```

- `--orig`：搬运、译制的公开课和演讲（卡帕西、李宏毅、吴恩达等没有 B 站官方号）写上原作者，播放页会标「搬运」。
- `--title`：B 站标题太长或太标题党时换一个；这样的视频刷新时不再提醒「标题变了」。
- 成长路线每一关（`path.stages[]`）的字段：`icon`、`name`、`age`、`goal`、`items`（`id` + `note`）、`mission`（动手任务：`text`，可选 `url` / `label`）、`later`（初中以后的关卡，路线页默认折叠）。
- 页面：默认浅色（右上角可切深色）；播放页一屏一条，手机上滑切下一条，滑到哪条自动播哪条（顶上「自动播放」可关，关了就点封面才播）；首页往下滚时顶栏、分类条、底部标签栏会收起。地址 `#watch/BV…` 可以直接打开某条视频。
- 老浏览器：电视、投影仪、老平板自带的内核常常停在几年前（极米投影仪是 Chrome 66）。`index.html` 和 `tv.html` 的脚本只用 ES2019 语法（不用 `?.`、`??`、`Object.fromEntries`、`replaceChildren`），新 CSS 写法在 `<style>` 末尾的 `@supports not (…)` 里有兜底。改完可以这样查语法（没输出就是通过）：

  ```bash
  for f in bili/index.html bili/tv.html; do sed -n '/^<script>$/,/^<\/script>$/p' $f | sed '1d;$d' | npx -y acorn --ecma2019 --silent; done
  ```

### 电视版（/bili/tv.html）

给电视、投影仪的遥控器界面：上面是「豆腐块」（继续闯关 + 9 关 + 随便看看），下面一排一排是各关和各分类的视频；右下角「⚙️ 设置」里能一键更新应用。方向键挑、OK 播放；播放时 ▲ 标记看完、▼ 选集（换一条）、返回键回首页；◀ ▶ 在安卓应用 1.1 起是快退 / 快进（应用往 B 站播放器里补按方向键，一下 5 秒），旧版应用和浏览器里是换上一条 / 下一条。数据运行时从 `index.html` 读（不用另外维护），看完进度和网页版共用。看了七成自动记为看完；成长路线放完一关就停，不连着刷下一关。

安卓电视 / 投影仪上的应用在开源仓库的 [`android/`](https://github.com/limin112/bilipicks/tree/main/android)：一个全屏 WebView 外壳，打开就是 `tv.html`，遥控器按键由应用转给页面（所以 OK 键能暂停 B 站播放器，焦点也不会跑进播放器里的推荐视频）。家里那台极米 H3S（现在是 `192.168.0.108`）已经开了无线 ADB，在那个目录里 `DEVICE=192.168.0.108:5555 ./build.sh install` 就能装上去。网页内容更新不需要重装应用。

应用 1.2 起能在电视版主页右下角「⚙️ 设置」里一键更新（有新版时亮小红点）：读 `bili/tv-app.json`，下载 `bili/BiliPicks-tv.apk`，核对后交给系统安装。发新版：在 `bilipicks/android` 里改 `versionCode` / `versionName`，运行 `SITE_DIR=../../tmp/site/bili ./release.sh "改了什么"`，然后两个仓库都提交、推送。

### 同步到开源仓库

开源版在单独的仓库 [limin112/bilipicks](https://github.com/limin112/bilipicks)（`index.html` + `tv.html` + `data.js` + `update.py`，策展人信息写在 `data.js` 的 `site` 里，没有部署，Demo 指回本站；安卓电视版应用 `android/` 只在那边维护）。这里改完、上线后，同步一次：

```bash
python3 bili/sync_bilipicks.py ../../bilipicks --check   # 先试转换，不写文件
python3 bili/sync_bilipicks.py ../../bilipicks           # 写入 index.html、tv.html、data.js、update.py
cd ../../bilipicks && git diff && git commit -am "…" && git push
```

脚本会核对每一处要替换的原文（策展人署名、页面描述等），网站上的文字改过、对不上时会报错停下。README 不会自动改，功能有变化要自己补。

