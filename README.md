# 校园留言墙

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D14-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-blue.svg)](https://expressjs.com/)
[![WebSocket](https://img.shields.io/badge/WebSocket-ws-8A2BE2.svg)](https://github.com/websockets/ws)
[![AI Assisted](https://img.shields.io/badge/AI%20Assisted-%F0%9F%A4%96-ff6b6b.svg)](.)

> 模拟真实白墙的校园留言墙，留言以方框卡片形式"悬挂"在白色背景墙上，卡片可拖拽移动，支持多人实时协同。

**仓库地址**：https://github.com/songgms/campus-wall

> 🤖 **声明**：本项目由 AI 辅助开发，代码经过人工审核与调整。

## 快速启动

```bash
cd campus-wall
npm install
npm start
```

启动后访问：

- 用户端：http://localhost:3000
- 管理端：http://localhost:3000/admin.html （默认账号 `admin`，密码 `admin123`）

停止服务：

```bash
# 在另一个终端运行，快速关闭占用 3000 端口的进程
npm stop
```

> 也可以直接在运行服务的终端按 `Ctrl + C` 停止。

## 功能特性

### 用户端

| 功能 | 说明 |
|------|------|
| 新增留言 | 弹窗填写内容、昵称，可选公开姓名或匿名 |
| 卡片样式 | 顶栏下拉切换：简约方框 / 圆角便签 / 彩色便签 |
| 拖拽移动 | 鼠标或触摸拖拽自己的卡片到墙面任意位置，实时同步 |
| 编辑 / 删除 | 仅自己的卡片悬浮时显示操作按钮 |
| 点赞互动 | 每条卡片可点赞/取消点赞，实时同步点赞数 |
| 搜索留言 | 顶栏搜索框按内容或昵称过滤 |
| 在线人数 | 顶栏实时显示当前在线人数 |
| 多人实时同步 | WebSocket 推送新增、移动、编辑、删除、点赞事件 |
| 匿名保护 | 匿名留言对其他用户隐藏真实昵称，仅管理端可见 |
| 敏感词过滤 | 发布/编辑时自动检测敏感词并拒绝 |
| 键盘快捷键 | ESC 关闭弹窗，Ctrl/Cmd+Enter 快速提交 |
| 移动端适配 | 响应式布局 + 触摸拖拽，手机端可用 |

### 管理端

| 功能 | 说明 |
|------|------|
| 留言管理 | 查看全部留言（含匿名原始提交人）、屏蔽 / 解除、删除 |
| 批量操作 | 全选、批量删除 |
| 点赞统计 | 每条留言显示点赞数，总览显示总点赞数 |
| 数据统计 | 留言总数、今日新增、匿名数、匿名占比、已屏蔽数、总点赞 |
| 重置位置 | 一键随机重置全部卡片位置 |
| 系统设置 | 匿名开关、可选样式、字数上限、敏感词过滤 |
| 敏感词管理 | 自定义敏感词列表，每行一个，可开关过滤 |
| 数据导出 | 一键导出全部留言为 JSON 文件 |
| 保存模式 | 支持自动保存和手动保存两种模式 |
| 自动保存间隔 | 可配置自动保存时间间隔（5-3600秒） |
| 备份数量上限 | 可配置备份文件保留数量（1-100份） |
| 手动保存 | 手动触发数据写入磁盘，实时显示保存状态 |
| 管理员账号 | 可修改管理员账号和密码 |

## 技术栈

- **后端**：Node.js + Express + ws (WebSocket)
- **前端**：原生 HTML/CSS/JavaScript（无框架依赖）
- **数据存储**：本地 JSON 文件（data.json），自动备份最近 5 份

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务监听端口 |
| `SECRET` | `campus-wall-secret-key` | 管理员 Token 签名密钥，生产环境务必修改 |

```bash
# 指定端口启动
PORT=8080 npm start

# 生产环境设置自定义密钥
SECRET=your-strong-secret-key npm start
```

## npm 脚本

| 命令 | 说明 |
|------|------|
| `npm start` | 启动服务 |
| `npm stop` | 快速关闭服务进程（跨平台），默认关闭 `PORT` 环境变量端口占用进程，缺省 3000 |
| `npm run tunnel` | 启动 localtunnel 内网穿透（需先启动服务），默认连接 `PORT` 环境变量端口，缺省 3000 |
| `npm run tunnel:stop` | 快速关闭 localtunnel 内网穿透进程（跨平台） |

> `npm stop` 支持指定端口：`node stop.js 3001`，或通过环境变量 `PORT=3001 npm stop`

## 远程访问指南

### 方式一：局域网访问（同一 WiFi/校园网）

适合同学连同一个 WiFi 或校园网的场景，速度快且稳定。

**1. 放行防火墙（只需做一次）**

以**管理员身份**打开 PowerShell，运行：

```powershell
New-NetFirewallRule -DisplayName "Campus Wall - Port 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

**2. 查看本机局域网 IP**

```powershell
ipconfig
```

找到无线网卡（WLAN）的 IPv4 地址，例如 `192.168.1.104`。

**3. 启动服务**

```bash
npm start
```

**4. 别人访问**

```
http://你的局域网IP:3000
```

例如：`http://192.168.1.104:3000`

> 局域网 IP 可能会变化（DHCP），如果访问不了请重新用 `ipconfig` 查看。可以在路由器中设置静态 IP 绑定来固定地址。

### 方式二：公网访问（内网穿透）

适合对方不在同一个局域网的情况，任何人 anywhere 都能访问。

**使用 localtunnel（推荐，免费无需注册）**

```bash
# 终端 1：启动服务（可自定义端口）
npm start
# 或指定端口：PORT=8080 npm start

# 终端 2：启动内网穿透（自动读取 PORT 环境变量，默认 3000）
npm run tunnel
# 自定义端口（cmd）：  set PORT=8080 && npm run tunnel
# 自定义端口（PowerShell）：  $env:PORT=8080; npm run tunnel
```

运行后会输出类似：

```
your url is: https://random-name-123.loca.lt
```

把这个 URL 发给任何人即可访问，WebSocket 实时同步也能正常工作。

> 💡 `npm run tunnel` 会自动与服务端的 `PORT` 环境变量保持一致：若用 `PORT=8080 npm start` 改端口启动，只需同步执行 `PORT=8080 npm run tunnel`（或在 Windows cmd 中 `set PORT=8080`）即可连接正确的端口，无需手动修改命令。

**关闭内网穿透：**

```bash
# 在另一个终端运行，快速关闭所有 localtunnel 进程
npm run tunnel:stop
```

> 也可以直接在运行内网穿透的终端按 `Ctrl + C` 停止。

**其他内网穿透工具对比**

| 工具 | 免费 | 需注册 | 稳定性 | 说明 |
|------|------|--------|--------|------|
| localtunnel | 是 | 否 | 一般 | 最简单，npm 一键启动 |
| ngrok | 是（有限额） | 是 | 较好 | 需注册获取 authtoken |
| Cloudflare Tunnel | 是 | 是 | 好 | 需 Cloudflare 账号 |
| frp | 是 | 否 | 取决于服务器 | 需自己有公网服务器 |

### 方式三：部署到云服务器（生产环境）

适合长期稳定运行，推荐使用 PM2 + Nginx。

**1. 安装 PM2（进程守护）**

```bash
npm install -g pm2
pm2 start server.js --name campus-wall
pm2 save
pm2 startup   # 开机自启
```

**2. Nginx 反向代理配置**

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }
}
```

> WebSocket 需要 `Upgrade` 和 `Connection` 头，否则实时同步会失效。

**3. 配置 HTTPS（推荐）**

使用 Let's Encrypt 免费证书：

```bash
certbot --nginx -d your-domain.com
```

配置 HTTPS 后，WebSocket 自动使用 `wss://` 协议，前端无需修改。

## API 接口

### 公开接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/config | 获取公开配置 |
| GET | /api/messages | 获取留言列表（公开视图） |
| POST | /api/messages | 新增留言 |
| PATCH | /api/messages/:id | 编辑自己的留言 |
| DELETE | /api/messages/:id | 删除自己的留言 |
| POST | /api/messages/:id/like | 点赞/取消点赞 |

### 管理接口（需 Bearer Token）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/login | 管理员登录 |
| GET | /api/admin/messages | 获取全部留言（含匿名信息） |
| DELETE | /api/admin/messages/:id | 管理员删除留言 |
| POST | /api/admin/messages/batch-delete | 批量删除 |
| PATCH | /api/admin/messages/:id | 屏蔽/解除屏蔽 |
| POST | /api/admin/reset-positions | 重置全部卡片位置 |
| GET | /api/admin/config | 获取完整配置 |
| PUT | /api/admin/config | 更新配置 |
| GET | /api/admin/stats | 获取统计数据 |
| GET | /api/admin/export | 导出留言数据 |
| GET | /api/admin/save-status | 获取保存状态（模式/是否有未保存变更/上次保存时间） |
| POST | /api/admin/save | 手动保存数据到磁盘 |

## WebSocket 事件

客户端连接后接收服务端推送：

| type | 说明 |
|------|------|
| create | 新增留言 |
| update | 留言内容更新（含屏蔽状态变更） |
| move | 卡片位置移动 |
| delete | 留言被删除 |
| like | 点赞数变更 |
| reset | 全部卡片位置被重置 |
| config | 配置变更 |
| online | 在线人数变更 |
| save-status | 保存状态变更（自动保存/手动保存后触发，管理端使用） |

客户端可发送：

| type | 说明 |
|------|------|
| move | 拖拽结束后提交新位置 |

## 数据结构

```json
{
  "messages": [
    {
      "id": "唯一标识",
      "text": "留言内容",
      "style": "plain|rounded|color",
      "x": 0-95,
      "y": 0-90,
      "authorId": "作者标识",
      "nickname": "昵称或null",
      "showName": true,
      "blocked": false,
      "likes": ["点赞者ID列表"],
      "createdAt": 时间戳
    }
  ],
  "config": {
    "allowAnonymous": true,
    "allowedStyles": ["plain", "rounded", "color"],
    "maxTextLength": 200,
    "adminUser": "admin",
    "adminPass": "admin123",
    "sensitiveWords": ["敏感词列表"],
    "enableSensitiveFilter": true,
    "saveMode": "auto",
    "autoSaveInterval": 30,
    "backupLimit": 5
  }
}
```

## 目录结构

```
campus-wall/
├── server.js          # 后端服务（Express + WebSocket）
├── stop.js            # 快速关闭端口占用进程的脚本（跨平台）
├── stop-tunnel.js     # 快速关闭 localtunnel 内网穿透进程的脚本（跨平台）
├── package.json       # 项目配置
├── data.json          # 数据存储（运行时生成）
├── backups/           # 自动备份目录（运行时生成，保留最近5份）
├── public/
│   ├── index.html     # 用户端页面
│   ├── admin.html     # 管理端页面
│   ├── css/
│   │   └── style.css  # 样式文件
│   └── js/
│       ├── wall.js    # 用户端逻辑
│       └── admin.js   # 管理端逻辑
├── LICENSE            # 开源协议
└── README.md
```

## 常见问题

### Q: 启动时报 `EADDRINUSE: address already in use :::3000`

端口被占用了。**推荐使用快速关闭命令**：

```bash
npm stop
```

或手动查找并关闭：

```powershell
# 查找占用 3000 端口的进程
Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess

# 关闭指定 PID 的进程
Stop-Process -Id <PID> -Force

# 或者换个端口启动
PORT=3001 npm start
```

### Q: 局域网内别人访问不了

1. 确认防火墙已放行 3000 端口（见上方「远程访问指南」）
2. 确认双方在同一个局域网（同一个 WiFi/网段）
3. 用 `ipconfig` 确认当前局域网 IP 是否变化
4. 关闭电脑上的第三方安全软件（可能会拦截）

### Q: 公网穿透后实时同步不生效

localtunnel 默认支持 WebSocket。如果使用其他穿透工具，请确认：
- 穿透工具支持 WebSocket 协议转发
- Nginx 反向代理配置了 `Upgrade` 和 `Connection` 头
- HTTPS 站点下 WebSocket 会自动使用 `wss://`，确保代理支持

### Q: 数据会丢失吗

数据存储在 `data.json` 中，每次变更会自动备份到 `backups/` 目录（保留最近 5 份）。如需恢复，用备份文件替换 `data.json` 后重启服务即可。

### Q: 如何修改管理员密码

登录管理后台 → 系统设置 → 修改管理员账号，填写新密码后保存。也可以直接编辑 `data.json` 中的 `config.adminPass` 字段，重启服务生效。

## 数据保存机制

本项目支持两种数据保存模式，可在管理后台「系统设置 → 数据保存设置」中配置：

### 自动保存模式（默认）

- 数据变更后标记为"待保存"，由定时器按设定间隔自动写入磁盘
- 间隔可配置：**5-3600 秒**，默认 30 秒
- 间隔 ≤ 5 秒时，每次变更立即写入磁盘（适合高频操作场景）
- 服务启动时自动加载定时器，配置变更后自动重启定时器

### 手动保存模式

- 数据变更仅更新内存，不自动写入磁盘
- 管理员需点击「立即保存」按钮手动触发写入
- 管理后台实时显示保存状态（是否有未保存变更、上次保存时间）
- 每 10 秒自动刷新保存状态

> ⚠️ **手动保存模式注意**：未保存到磁盘的变更在服务重启或崩溃后会丢失。进程正常退出（SIGINT/SIGTERM）时会自动保存，但强制杀进程不会。建议定期手动保存，或使用自动保存模式。

### 备份机制

- 每次写入磁盘时自动创建备份文件到 `backups/` 目录
- 备份数量上限可配置：**1-100 份**，默认 5 份
- 超出上限时自动删除最旧的备份
- 备份文件名格式：`data-YYYY-MM-DDTHH-mm-ss-sssZ.json`

### 保存状态接口

```bash
# 查看保存状态
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/admin/save-status

# 手动保存
curl -X POST -H "Authorization: Bearer <token>" http://localhost:3000/api/admin/save
```

## 注意事项

- 首次启动会自动创建 `data.json`，默认管理员账号 `admin` / `admin123`，请及时修改
- 数据文件每次写入磁盘时自动备份到 `backups/` 目录，保留数量可配置（默认 5 份）
- 手动保存模式下请注意及时保存，避免服务异常导致数据丢失
- 敏感词过滤默认开启，可在管理端「系统设置」中关闭或自定义词库
- 生产环境建议使用反向代理（Nginx）并配置 HTTPS，WebSocket 对应使用 wss 协议
- 本项目仅供学习和校园内部使用，请遵守相关法律法规，不要用于非法用途

## License

[MIT](LICENSE) © 2026 songgms

本项目采用 MIT 协议开源，可自由使用、修改和分发。详见 [LICENSE](LICENSE) 文件。
