# 🪁 Kite

> **中文** | [English](./README.en.md)

一个 Claude Code 启动器，将你的终端会话桥接到 Telegram、飞书、微信、企业微信等 IM 平台。

运行 `kite` 替代 `claude` —— 终端体验完全一致，同时可以从任何地方通过 IM 控制。

<details>
<summary><strong>🤖 不想看文档？复制以下内容到 Claude / ChatGPT / Cursor 即可自动安装</strong></summary>

```
我想安装和配置 Kite —— 一个带 IM 桥接（Telegram + 飞书）的 Claude Code 启动器。

请按以下步骤操作：

1. 检查前置条件：
   - Bun 已安装？执行：bun --version
   - Claude Code 已安装？执行：claude --version
   - 如果没有安装，从 https://bun.sh 安装 Bun，从 https://docs.anthropic.com 安装 Claude Code

2. 克隆并安装：
   git clone https://github.com/yuanlang12/Kite.git
   cd Kite
   bun install
   bun link

3. 配置 IM Bot（选一个或两个都配）：

   Telegram：
   - 我需要一个 Telegram Bot Token。如果我还没有，请告诉我在 Telegram 上找 @BotFather，
     发送 /newbot，按提示操作，然后把 Token 给你。
   - 拿到 Token 后，创建配置文件：
     mkdir -p ~/.config/kite
     echo 'TELEGRAM_BOT_TOKEN=<我的token>' > ~/.config/kite/.env

   飞书 / Lark：
   - 我需要一个飞书应用。去 https://open.feishu.cn/app 创建应用，
     开启「机器人」能力和「消息」权限，然后把 App ID 和 App Secret 给你。
   - 添加到配置文件：
     mkdir -p ~/.config/kite
     cat >> ~/.config/kite/.env << 'EOF'
     FEISHU_APP_ID=<我的app_id>
     FEISHU_APP_SECRET=<我的app_secret>
     EOF

4. 测试：
   执行：kite
   这应该会正常启动 Claude Code。然后在 IM 上给 Bot 发条消息 ——
   它应该会切换到远程模式并回复。

5. 如果 Telegram 出现 409 错误（"terminated by other getUpdates request"），等 30 秒
   再试 —— 上一个 Bot 会话需要超时断开。

需要我提供任何信息（比如 Bot Token）时请直接问我，然后一步步引导我完成。
```

</details>

## 工作原理

Kite 用 **互斥状态机** 包裹 Claude Code：任意时刻，只有终端 **或** IM 平台在控制 Claude，两者通过 `--resume` 共享同一个会话。

```
你运行: kite [claude 参数...]
                │
                ▼
         ┌─── 状态机循环 ───┐
         │                   │
    本地模式            远程模式
    (终端交互)          (IM: Telegram / 飞书 / 微信 / 企微)
         │                   │
    启动 claude          启动 claude
    stdio: inherit       -p --resume --output-format text
    正常终端操作          IM 消息 → Claude → IM 回复
         │                   │
    IM 消息到达 ──────→ 终止本地, 启动远程
         │                   │
    按 Enter ←────── 终止远程, 启动本地
```

**同一时刻只有一个 Claude 进程在运行。** 会话通过 `--resume` 共享。

> **⚠️ 重要：每个 Bot 只能运行一个 Kite 进程。** 如果你在多个项目目录下分别启动了 kite，所有 IM 消息会被多个进程同时收到，导致重复回复。正确做法是只启动一个 kite，通过[多项目路由](#多项目路由)管理不同项目。

## 快速开始

### 前置条件

- [Bun](https://bun.sh) 运行时
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 已安装
- 至少配置一个 IM Bot（见下方）

### 安装

```bash
git clone https://github.com/yuanlang12/Kite.git
cd Kite
bun install
bun link
```

### 配置

配置文件路径：`~/.config/kite/.env`

```bash
mkdir -p ~/.config/kite
cat > ~/.config/kite/.env << 'EOF'
# ── Telegram ──────────────────────────────────
TELEGRAM_BOT_TOKEN=xxx                   # 从 @BotFather 获取
TELEGRAM_ALLOWED_USER_IDS=               # 逗号分隔，留空 = 配对模式

# ── 飞书 / Lark ──────────────────────────────
FEISHU_APP_ID=xxx                        # 从 https://open.feishu.cn/app 获取
FEISHU_APP_SECRET=xxx

# ── 微信（iLink Bot）─────────────────────────
WEIXIN_BOT_TOKEN=xxx                     # 通过 `kite setup` 扫码获取

# ── 企业微信（WeCom）─────────────────────────
WECOM_BOT_ID=xxx                         # 从企微管理后台获取
WECOM_BOT_SECRET=xxx
EOF
```

可以只配一个，也可以全部配。Shell 环境变量会覆盖配置文件中的值。

或者使用交互式配置向导：

```bash
kite setup
```

### 运行

```bash
kite                          # 等同于 claude，但带 IM 桥接
kite --resume abc123          # 恢复特定会话
kite "fix the bug"            # 带初始 prompt
kite --model sonnet           # 使用指定模型
kite --dangerously-skip-permissions  # YOLO 模式（本地 + 远程均跳过权限确认）
```

所有参数透传给 `claude`。

> **💡 建议：** 远程模式下 Claude 无法弹出权限确认 —— 如果需要授权，它会直接退出。为了获得最佳 IM 体验，建议使用 `--dangerously-skip-permissions` 或 `--permission-mode auto` 启动，让 Claude 能自主执行。

## 支持的 IM 平台

### Telegram

使用 [grammy](https://grammy.dev/) 长轮询 —— 无需 Webhook，无需公网服务器。

**配置方式：** 通过 [@BotFather](https://t.me/BotFather) 创建 Bot，将 Token 填入配置文件的 `TELEGRAM_BOT_TOKEN`。

**访问控制：**
- **首次使用**：开放模式 —— 第一个向 Bot 发送消息的用户自动通过
- **之后**：配对模式 —— 新用户会收到一个 6 位配对码，需要通过 `/approve` 审批
- **或者**：设置 `TELEGRAM_ALLOWED_USER_IDS` 进行严格白名单控制

### 飞书 / Lark

使用官方 [@larksuiteoapi/node-sdk](https://github.com/larksuite/node-sdk) WebSocket 长连接 —— 无需 Webhook，无需公网服务器。

**配置方式：**
1. 前往 [飞书开放平台](https://open.feishu.cn/app) 创建应用
2. 开启 **机器人** 能力，添加 **消息** 相关权限
3. 将 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 填入配置文件

### 微信（iLink Bot）

使用微信 iLink Bot API 长轮询 —— 无需 Webhook，无需公网服务器。

**配置方式：** 运行 `kite setup`，选择微信，用微信扫描终端中的二维码即可。Token 会自动保存。

### 企业微信（WeCom）

使用官方 [@wecom/aibot-node-sdk](https://github.com/WecomTeam/aibot-node-sdk) WebSocket 长连接 —— 无需 Webhook，无需公网服务器。

**配置方式：**
1. 在企业微信管理后台创建智能机器人
2. 获取 **Bot ID** 和 **Bot Secret**
3. 将 `WECOM_BOT_ID` 和 `WECOM_BOT_SECRET` 填入配置文件

### IM 命令（所有平台通用）

| 命令 | 说明 |
|------|------|
| `/model sonnet` | 切换模型（sonnet / opus / haiku）|
| `/effort high` | 设置推理强度（low / medium / high / max）|
| `/status` | 查看当前设置和绑定的项目 |
| `/approve <code>` | 审批新用户的配对码 |
| `/addproject <名称> <路径>` | 注册一个项目 |
| `/rmproject <名称>` | 移除注册的项目 |
| `/bind <名称>` | 将当前聊天绑定到指定项目 |
| `/unbind` | 解除绑定，恢复使用默认项目 |
| `/projects` | 查看所有项目及绑定关系 |

## 功能

### 终端（本地模式）
与直接运行 `claude` 完全一致，TUI 功能全部可用。

### 远程模式
当 IM 消息到达时，Kite 会终止本地 Claude 并启动远程 Claude 进程处理。终端上会显示一个复古 Macintosh 风格的 TUI 展示活动状态。

### 自动防休眠
在 macOS 上，Kite 会自动阻止系统进入待机状态（`caffeinate`），即使你离开电脑，IM 消息也能正常处理。

## 多项目路由

一个 Kite 进程可以管理多个项目。不同的 IM 聊天/群组可以绑定到不同的项目。

### 为什么只能开一个 Kite？

每个 IM Bot（Telegram Bot、飞书应用、微信 Bot 等）同一时间只能被一个进程连接。如果你在两个项目目录下各开了一个 kite，两个进程会同时收到同一条 IM 消息，产生重复回复。

**正确做法：** 只启动一个 kite 进程，通过命令注册和切换项目。

### 使用方法

```bash
# 1. 在你的主项目目录下启动 kite（只启动一次）
cd ~/code/my-app
kite
```

然后在 IM 中操作：

```
# 2. 注册其他项目
/addproject blog ~/code/blog
/addproject api ~/code/api-server

# 3. 绑定当前聊天到某个项目
/bind blog

# 4. 之后这个聊天的所有消息都会路由到 blog 项目

# 5. 想换项目？重新绑定即可
/bind api

# 6. 解除绑定（回到默认项目）
/unbind
```

首次发消息时，如果有多个已注册项目且当前聊天未绑定，Kite 会提示你选择项目，点击复制发送即可绑定：

```
🪁 Please choose a project first 👇
/bind blog
/bind api
/bind default
```

## 项目结构

```
kite/
├── packages/
│   ├── core/                 # 状态机、会话管理、TUI
│   ├── telegram/             # Telegram 适配器（grammy，长轮询）
│   ├── feishu/               # 飞书/Lark 适配器（官方 SDK，WebSocket）
│   ├── weixin/               # 微信适配器（iLink Bot，长轮询）
│   └── wecom/                # 企业微信适配器（官方 SDK，WebSocket）
└── apps/
    └── cli/                  # CLI 入口
```

## 添加新的 IM 平台

1. 创建 `packages/<platform>/`
2. 实现 `@kite/core` 中的 `IMAdapter` 接口
3. 在 `apps/cli/src/index.ts` 中注册

```typescript
interface IMAdapter {
  name: string
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void
  sendMessage(chatId: string, text: string): Promise<void | string>
  editMessage(chatId: string, messageId: string, text: string): Promise<void>
  sendTyping(chatId: string): Promise<void>
}
```

## 技术栈

- **运行时**：Bun
- **语言**：TypeScript
- **Telegram**：grammy（长轮询，无需 Webhook）
- **飞书**：@larksuiteoapi/node-sdk（WebSocket，无需 Webhook）
- **微信**：iLink Bot API（长轮询，无需 Webhook）
- **企业微信**：@wecom/aibot-node-sdk（WebSocket，无需 Webhook）
- **文件监听**：chokidar

## 兼容性

| 平台 | 状态 |
|------|------|
| macOS | 已测试 |
| Linux | 应该可用 |
| Windows | 实验性 —— 欢迎社区贡献 |

## 与同类工具的对比

这个领域还有其他优秀的工具，以下是 Kite 与它们的区别：

### vs [Happy](https://github.com/slopus/happy)

Happy 是一个移动优先的 Claude Code 客户端 —— 通过专属 iOS/Android App 或 Web 端控制 Claude，消息经由云中继服务器转发（端到端加密）。

| | Kite | Happy |
|---|---|---|
| **理念** | 终端优先，IM 是遥控器 | 移动优先，App 是主界面 |
| **基础设施** | 无 —— 完全本地 | 需要中继服务器（官方托管或自部署） |
| **IM 方式** | 复用你的 Telegram / 飞书 / 微信 / 企微 | 专属 App（iOS / Android / Web） |
| **账号** | 只需一个 Bot Token | 需要注册账号 |
| **终端体验** | 完整的 Claude Code TUI，原汁原味 | 有终端模式，但侧重移动端 |

**选 Happy**：你想要精致的移动 App、推送通知和语音输入。
**选 Kite**：你常驻终端，只想用现有的 IM 作为轻量遥控器 —— 不需要服务器，不需要额外 App。

### vs [CC-Connect](https://github.com/chenhg5/cc-connect)

CC-Connect 是一个功能强大的 IM 网关，能在多种 AI Agent（Claude Code、Codex、Cursor、Gemini CLI 等）和多种 IM 平台（Telegram、飞书、钉钉、Slack、Discord 等）之间转发消息。

| | Kite | CC-Connect |
|---|---|---|
| **理念** | 终端 + IM 混合模式 | 纯 IM 网关 |
| **终端模式** | 有 —— 完整 Claude Code TUI | 无 —— 仅 IM |
| **模式切换** | 终端 ↔ IM 无缝切换 | 不适用（始终是 IM） |
| **Agent 支持** | Claude Code | 7 种 Agent |
| **IM 平台** | Telegram、飞书、微信、企微 | 9 种平台 |
| **语言** | TypeScript (Bun) | Go |

**选 CC-Connect**：你需要广泛的 Agent/平台支持，不需要终端交互。
**选 Kite**：你想在终端里正常使用 Claude Code，IM 只是一个无缝叠加的遥控层 —— 随时切换，离开电脑也不中断。

## 社区

Kite 在 [LINUX DO](https://linux.do/) 社区分享和讨论 —— Where possible begins。

## 许可证

MIT
