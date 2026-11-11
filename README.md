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
| `bili/` | BiliPicks：给五六年级孩子的 B 站精选播放页（9 关成长路线、频道榜），见下方 |

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
- 页面：默认浅色（右上角可切深色）；播放页一屏一条，手机上滑切下一条，点封面才加载 B 站播放器；首页往下滚时顶栏、分类条、底部标签栏会收起。地址 `#watch/BV…` 可以直接打开某条视频。

