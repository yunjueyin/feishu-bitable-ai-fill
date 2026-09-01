# 部署（GitHub Pages，双分支）

- `main`：源码
- `gh-pages`：构建产物（`dist/` 内容）

## 流程

```bash
npm install
npm run build
npx gh-pages -d dist -t true   # -t 保留 .nojekyll
```

首次部署后到仓库 Settings → Pages → Source 选 `Deploy from a branch` → Branch 选 `gh-pages`。

## 首次建仓

```bash
git init && git add -A && git commit -m "init"
# 在 GitHub 建空仓库 feishu-bitable-ai-fill 后：
git remote add origin git@github.com:yunjueyin/feishu-bitable-ai-fill.git
git push -u origin main
```

## 飞书接入

仓库 Pages 地址（形如 `https://yunjueyin.github.io/feishu-bitable-ai-fill/`）填入飞书多维表的「自定义组件 / 插件」URL。**注意**：URL 根路径须能打开 `index.html`；更新代码后若飞书内未刷新，插件已内置 `?v=Date.now()` 缓存破坏，一般无需手动处理。

## 国内访问备选（GitHub Pages 可能被墙）

- **Gitee Pages**：建同名仓库 → 推 `dist/` 内容到 Gitee → 开启 Gitee Pages（需实名，注意仓库须公开）。
- **腾讯云 COS / 阿里云 OSS 静态网站**：上传 `dist/` 内容，开静态网站 + CDN。
- **Cloudflare Pages**：连 GitHub 仓库自动构建，国内一般可达。

## 踩坑备忘

- 本机构建用 `node node_modules/vite/bin/vite.js build`（`.bin/vite` 是 bash 脚本不能直接跑）；裸 `node` 可能不在 PATH，用托管完整路径。
- `vite.config.js` 已设 `emptyOutDir: false`（本机 safe-delete 包装器会拦截 `fs.rmSync`）；多次构建前如需清空 dist，用重命名转移（`Move-Item dist dist.old_<时间戳>`）。
- 不要用 PowerShell `Compress-Archive`（中文路径必失败）。
- 推送前先 `git ls-remote origin HEAD` 探测连通性；本机代理端口 7897/7890/10809 实测全失效，但 github.com 直连可用。
- 凭证：优先 SSH / `gh auth`；如用 PAT，不要拼进受跟踪文件或 `.git/config`。
