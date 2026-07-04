# 运动跟练视频库

一个私人运动视频画廊。支持批量粘贴视频链接、B 站标题/封面解析、当前页面播放、编辑标题和分类，并可通过 Supabase 在电脑和 iPad 间同步。也支持用 library key 分开多个视频库。

## 本地预览

```bash
npm run dev
```

打开：

```txt
http://127.0.0.1:4173/
```

如果还没配置 Supabase，页面会使用浏览器本地缓存。

## Supabase 设置

1. 在 Supabase 创建项目。
2. 打开项目里的 `SQL Editor`。
3. 运行：

```sql
-- 复制 supabase/schema.sql 的内容运行
```

4. 到 `Project Settings` -> `API Keys` 复制：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

如果你已经创建过旧版 `videos` 表，也可以重新运行 `supabase/schema.sql`。它会给旧数据补上 `library_key = 'default'`，并把唯一限制改成“同一个库内链接不重复”。

## 本地环境变量

复制 `.env.example` 为 `.env`，填入：

```txt
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
APP_WRITE_TOKEN=choose-a-private-password
```

当前 `server.mjs` 直接读取环境变量。可以这样启动：

```bash
SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." APP_WRITE_TOKEN="..." npm run dev
```

## GitHub

1. 在 GitHub 新建一个空仓库。
2. 在本地项目目录运行：

```bash
git add .
git commit -m "Initial workout video library"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
git push -u origin main
```

## Vercel 部署

1. 打开 Vercel。
2. `Add New Project`。
3. 选择刚才的 GitHub 仓库。
4. Framework Preset 选择默认或 Other。
5. Build Command 留空。
6. Output Directory 留空。
7. 在 `Settings` -> `Environment Variables` 添加：

```txt
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
APP_WRITE_TOKEN
```

8. 重新部署。

## 绑定域名

1. 进入 Vercel 项目。
2. 打开 `Settings` -> `Domains`。
3. 添加你的域名，例如：

```txt
workout.yourdomain.com
```

4. 按 Vercel 提示去域名 DNS 后台添加记录。

常见子域名记录：

```txt
Type: CNAME
Name: workout
Value: cname.vercel-dns.com
```

根域名以 Vercel 页面显示为准。

## 使用

- 电脑和 iPad 打开同一个部署域名，会读取同一份 Supabase 视频列表。
- 默认视频库叫 `default`。
- 可以用网址区分不同视频库：

```txt
https://workout.yourdomain.com/?library=kiokumo
https://workout.yourdomain.com/?library=friend-a
```

- 也可以点击页面左上角的 `库 ...` 按钮切换库名。切换后页面会自动更新网址。
- 如果设置了 `APP_WRITE_TOKEN`，`default` 库第一次添加、编辑、删除时页面会提示输入写入密钥。
- 非 `default` 的库会把 library key 当作这个库自己的写入暗号。请给朋友一个不容易猜到的库名，例如 `friend-a-8k2m`，不要只用 `friend` 这种太短的名字。
- 只观看不需要写入密钥。
