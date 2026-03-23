# 🪁 Kite

> **English** | [中文](./README.zh-CN.md)

A Claude Code launcher that bridges your terminal session to Telegram, Feishu/Lark, and more.

Run `kite` instead of `claude` — same terminal experience, plus IM control from anywhere.

<details>
<summary><strong>🤖 Don't want to read? Copy this to Claude / ChatGPT / Cursor to auto-install</strong></summary>

```
I want to install and set up Kite — a Claude Code launcher with IM bridge (Telegram + Feishu/Lark).

Here's what you need to do:

1. Check prerequisites:
   - Bun installed? Run: bun --version
   - Claude Code installed? Run: claude --version
   - If not installed, install Bun from https://bun.sh and Claude Code from https://docs.anthropic.com

2. Clone and install:
   git clone https://github.com/yuanlang12/Kite.git
   cd Kite
   bun install
   bun link

3. Set up IM bot (pick one or both):

   For Telegram:
   - I need a Telegram bot token. If I don't have one, tell me to message @BotFather on Telegram,
     send /newbot, follow the prompts, and paste the token here.
   - Once I give you the token, create the config:
     mkdir -p ~/.config/kite
     echo 'TELEGRAM_BOT_TOKEN=<my_token>' > ~/.config/kite/.env

   For Feishu/Lark:
   - I need a Feishu app. Go to https://open.feishu.cn/app, create an app,
     enable the "Messaging" permission and "Bot" capability, then give me the App ID and App Secret.
   - Add to the config:
     mkdir -p ~/.config/kite
     cat >> ~/.config/kite/.env << 'EOF'
     FEISHU_APP_ID=<my_app_id>
     FEISHU_APP_SECRET=<my_app_secret>
     EOF

4. Test it:
   Run: kite
   This should start Claude Code normally. Then send a message to the bot on your IM —
   it should switch to remote mode and respond.

5. If Telegram shows a 409 error about "terminated by other getUpdates request", just wait 30 seconds
   and try again — the previous bot session needs to timeout.

Ask me for any information you need (like bot tokens) and guide me through each step.
```

</details>

## How It Works

Kite wraps Claude Code with a **mutual-exclusion state machine**: at any moment, either your terminal OR an IM platform is controlling Claude. Both share the same session via `--resume`.

```
You run: kite [claude args...]
                │
                ▼
         ┌─── State Machine ───┐
         │                      │
    Local Mode            Remote Mode
    (Terminal)            (IM: Telegram / Feishu)
         │                      │
    spawn claude           spawn claude
    stdio: inherit         -p --resume --output-format text
    Normal terminal        IM messages → Claude → IM reply
         │                      │
    IM message ──────→ kill local, start remote
         │                      │
    Press Enter ←────── kill remote, start local
```

**Only one Claude process runs at a time.** Session is shared via `--resume`.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed
- At least one IM bot set up (see below)

### Install

```bash
git clone https://github.com/yuanlang12/Kite.git
cd Kite
bun install
bun link
```

### Configure

Config file: `~/.config/kite/.env`

```bash
mkdir -p ~/.config/kite
cat > ~/.config/kite/.env << 'EOF'
# ── Telegram ──────────────────────────────────
TELEGRAM_BOT_TOKEN=xxx                   # Get from @BotFather
TELEGRAM_ALLOWED_USER_IDS=               # comma-separated, empty = pairing mode

# ── Feishu / Lark ────────────────────────────
FEISHU_APP_ID=xxx                        # From https://open.feishu.cn/app
FEISHU_APP_SECRET=xxx
EOF
```

You can configure one or both. Shell environment variables override the config file.

### Run

```bash
kite                          # Same as claude, but with IM bridge
kite --resume abc123          # Resume a specific session
kite "fix the bug"            # With initial prompt
kite --model sonnet           # Use a specific model
kite --dangerously-skip-permissions  # YOLO mode (both local + remote)
```

All arguments are transparently passed to `claude`.

> **💡 Tip:** In remote mode, Claude cannot prompt you for permission approvals — if it needs one, it will exit silently. For the best IM experience, run with `--dangerously-skip-permissions` or `--permission-mode auto` so Claude can work unattended.

## Supported IM Platforms

### Telegram

Uses [grammy](https://grammy.dev/) with long polling — no webhook or public server needed.

**Setup:** Create a bot via [@BotFather](https://t.me/BotFather), set `TELEGRAM_BOT_TOKEN` in config.

**Access control:**
- **First use**: Open mode — your first message goes through automatically
- **After that**: Pairing mode — new users get a 6-digit code and need approval via `/approve`
- **Or**: Set `TELEGRAM_ALLOWED_USER_IDS` for strict allowlist

### Feishu / Lark

Uses the official [@larksuiteoapi/node-sdk](https://github.com/larksuite/node-sdk) with WebSocket long connection — no webhook or public server needed.

**Setup:**
1. Go to [Feishu Open Platform](https://open.feishu.cn/app) and create an app
2. Enable **Bot** capability and **Messaging** permission
3. Set `FEISHU_APP_ID` and `FEISHU_APP_SECRET` in config

### IM Commands (all platforms)

| Command | Description |
|---------|-------------|
| `/model sonnet` | Switch model (sonnet / opus / haiku) |
| `/effort high` | Set reasoning effort (low / medium / high / max) |
| `/status` | Show current settings |
| `/approve <code>` | Approve a new user's pairing code |

## Features

### Terminal (Local Mode)
Identical to running `claude` directly. Full TUI, all features.

### Remote Mode
When an IM message arrives, Kite kills the local Claude and starts a remote Claude process to handle it. A retro Macintosh-style TUI shows the activity in your terminal.

### Auto Keep-Alive
On macOS, Kite automatically prevents idle sleep (`caffeinate`) so IM messages work even when you walk away.

## Project Structure

```
kite/
├── packages/
│   ├── core/                 # State machine, session management, TUI
│   ├── telegram/             # Telegram adapter (grammy, long polling)
│   └── feishu/               # Feishu/Lark adapter (official SDK, WebSocket)
└── apps/
    └── cli/                  # CLI entry point
```

## Adding a New IM Platform

1. Create `packages/<platform>/`
2. Implement the `IMAdapter` interface from `@kite/core`
3. Register in `apps/cli/src/index.ts`

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

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Telegram**: grammy (long polling, no webhook needed)
- **Feishu**: @larksuiteoapi/node-sdk (WebSocket, no webhook needed)
- **File watching**: chokidar

## Compatibility

| Platform | Status |
|----------|--------|
| macOS | Tested |
| Linux | Should work |
| Windows | Experimental — community help welcome |

## How Kite Compares

There are other great tools in this space. Here's how Kite differs:

### vs [Happy](https://github.com/slopus/happy)

Happy is a mobile-first client for Claude Code — you control Claude from their iOS/Android app or web UI, with messages relayed through a cloud server (E2E encrypted).

| | Kite | Happy |
|---|---|---|
| **Philosophy** | Terminal-first, IM as remote control | Mobile-first, app as primary UI |
| **Infrastructure** | None — fully local | Requires relay server (hosted or self-deployed) |
| **IM platform** | Your existing Telegram / Feishu | Their dedicated app (iOS / Android / Web) |
| **Account** | Just a bot token | Registration required |
| **Terminal experience** | Full Claude Code TUI, untouched | Has terminal mode, but focused on mobile |

**Choose Happy if** you want a polished mobile app with push notifications and voice input.
**Choose Kite if** you live in the terminal and want your existing IM as a lightweight remote control — no servers, no extra apps.

### vs [CC-Connect](https://github.com/chenhg5/cc-connect)

CC-Connect is a powerful IM gateway that pipes messages between many AI agents (Claude Code, Codex, Cursor, Gemini CLI, etc.) and many IM platforms (Telegram, Feishu, DingTalk, Slack, Discord, etc.).

| | Kite | CC-Connect |
|---|---|---|
| **Philosophy** | Terminal + IM hybrid | Pure IM gateway |
| **Terminal mode** | Yes — full Claude Code TUI | No — IM only |
| **Switching** | Seamless terminal ↔ IM mid-session | N/A (always IM) |
| **Agent support** | Claude Code | 7 agents |
| **IM platforms** | Telegram, Feishu | 9 platforms |
| **Language** | TypeScript (Bun) | Go |

**Choose CC-Connect if** you need broad agent/platform coverage and don't need the terminal.
**Choose Kite if** you want to keep using Claude Code in your terminal normally, and add IM as a seamless overlay for when you step away.

## Community

Kite is shared and discussed on [LINUX DO](https://linux.do/) — a vibrant developer community where possible begins.

## License

MIT
