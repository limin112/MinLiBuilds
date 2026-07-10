# MinLiBuilds 个人站

实践哥 MinLi（[@MinLiBuilds](https://x.com/MinLiBuilds)）个人主页：自我宣传 + 商单联系。

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
| `styles.css` | Workbench Signal 视觉系统 |
| `main.js` | 终端打字、复制账号、brief 生成邮件草稿 |

## 上线前建议改

1. **商务邮箱**：把 `hello@minlibuilds.com` 换成真实邮箱（`index.html` + `main.js`）
2. **域名**：部署到 Vercel / Cloudflare Pages / GitHub Pages
3. **OG 图**：需要时补一张分享缩略图

## 设计说明

- 调性：深色工作台 + 铜橙行动色 + 青绿信号色
- 签名元素：Hero 区「field notes」终端日志
- 转化路径：顶栏「谈合作」→ 联系区块 → brief 表单 / X DM / Telegram
