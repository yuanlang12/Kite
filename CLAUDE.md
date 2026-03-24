# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kite is a Claude Code launcher that bridges your terminal session to IM platforms (Telegram, Feishu/Lark, WeChat, WeCom). It implements a **mutual-exclusion state machine**: at any moment, either the terminal OR an IM platform is controlling Claude. Both share the same session via `--resume`.

## Communication Style

When discussing decisions with the project owner, use plain language that non-technical users can understand. Avoid jargon and technical terms — explain things in terms of user-facing behavior and outcomes.

## Architecture

### State Machine
```
User runs: kite [claude args...]
                │
                ▼
         ┌─── State Machine ───┐
         │                      │
    Local Mode            Remote Mode
    (Terminal)            (IM: Telegram / Feishu / WeChat / WeCom)
         │                      │
    spawn claude           spawn claude
    stdio: inherit         -p --resume --output-format text
    Normal TUI             IM messages → Claude → IM reply
         │                      │
    IM message ──────→ kill local, start remote
         │                      │
    Press Enter ←────── kill remote, start local
```

**Core principle**: Only one Claude process runs at a time. Session is shared via `--resume`.

**Single-process constraint**: Each IM bot token can only be used by one kite process. Running multiple kite instances with the same bot config causes duplicate message handling. Use multi-project routing (`/addproject` + `/bind`) to manage multiple projects from a single kite process.

### Key Design Decisions

1. **Process-level mutual exclusion** — Local and remote modes never run simultaneously. Switching kills the current process and starts a new one with `--resume`.
2. **JSONL file watching** — SessionScanner watches Claude Code's session files for real-time assistant message forwarding to IM (observation mode in local).
3. **Plugin architecture** — Each IM platform is a separate package implementing `IMAdapter`. Adding a new platform = adding a new package in `packages/<platform>/`.
4. **Zero infrastructure** — Runs entirely locally. No external servers, no cloud dependencies.
5. **Transparent CLI passthrough** — All arguments passed to `kite` are forwarded to `claude` unchanged.
6. **IM feedback layers** — Receipt: 👀 emoji reaction on user's message (Telegram/Feishu). Thinking: 🤔 message sent when Claude starts processing, edited to final response (Telegram/Feishu) or left as marker (WeChat/WeCom).
7. **Binding gate** — If registered projects exist and chat has no binding, messages are held until user sends `/bind <project>`.

```
kite/
├── packages/
│   ├── core/                 # State machine, session management, TUI
│   │   └── src/
│   │       ├── launcher.ts   # State machine main loop (local ↔ remote)
│   │       ├── localMode.ts  # Local mode: spawn claude with stdio inherit
│   │       ├── remoteMode.ts # Remote mode: spawn claude -p, pipe output
│   │       ├── sessionScanner.ts   # File watching for ~/.claude JSONL
│   │       ├── messageQueue.ts     # Async task queue
│   │       ├── projectRouter.ts    # Multi-project routing + chat bindings
│   │       ├── remoteTUI.ts        # Retro Macintosh-style TUI for remote mode
│   │       ├── types.ts            # Shared types + IMAdapter interface
│   │       └── index.ts            # Public exports
│   ├── telegram/             # Telegram adapter (grammy + long polling)
│   ├── feishu/               # Feishu/Lark adapter (official SDK + WebSocket)
│   ├── weixin/               # WeChat adapter (iLink Bot + long polling)
│   └── wecom/                # WeCom adapter (official SDK + WebSocket)
└── apps/
    └── cli/                  # CLI entry point + setup wizard
        └── src/
            ├── index.ts      # Main launcher
            └── setup.ts      # Interactive setup (kite setup)
```

## Common Development Commands

```bash
# Install all dependencies (runs from workspace root)
bun install

# Run kite in dev mode (watches for changes)
bun dev

# Type check entire workspace
bun typecheck

# Run the CLI directly
bun run apps/cli/src/index.ts

# Build all packages
bun run build --filter='*'
```

### Working on Specific Packages

Each adapter package has its own `dev` script:

```bash
# Watch mode for a specific adapter
bun run --cwd packages/telegram dev
bun run --cwd packages/feishu dev
bun run --cwd packages/weixin dev
bun run --cwd packages/wecom dev
bun run --cwd packages/core dev

# Or from the package directory
cd packages/telegram && bun dev
```

## IMAdapter Interface

All IM adapters must implement this interface (defined in `packages/core/src/types.ts`):

```typescript
interface IMAdapter {
  name: string
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void
  sendMessage(chatId: string, text: string): Promise<void | string>
  editMessage(chatId: string, messageId: string, text: string): Promise<void>
  sendTyping(chatId: string): Promise<void>
  reactToMessage?(chatId: string, messageId: string, emoji: string): Promise<void>
}

interface IncomingMessage {
  platform: string
  chatId: string
  userId: string
  username?: string
  text: string
  messageId?: string
  replyToMessageId?: string
}
```

## IM Platforms & Setup

### Telegram
- **Setup**: Create bot via @BotFather, get token
- **Config**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS` (optional)
- **Mechanism**: grammy library with long polling (no webhook needed)

### Feishu/Lark
- **Setup**: Create app at https://open.feishu.cn/app, enable Bot capability & Messaging permission
- **Config**: `FEISHU_APP_ID`, `FEISHU_APP_SECRET`
- **Mechanism**: Official SDK with WebSocket long connection

### WeChat (iLink Bot)
- **Setup**: Run `kite setup`, select WeChat, scan QR code
- **Config**: Auto-saved token (no manual config needed)
- **Mechanism**: iLink Bot API with long polling

### WeCom (企业微信)
- **Setup**: Create AI Bot in WeCom admin console
- **Config**: `WECOM_BOT_ID`, `WECOM_BOT_SECRET`
- **Mechanism**: Official SDK with WebSocket long connection

### IM Commands (All Platforms)
| Command | Description |
|---------|-------------|
| `/model sonnet` | Switch model (sonnet / opus / haiku) |
| `/effort high` | Set reasoning effort (low / medium / high / max) |
| `/status` | Show current settings + current project |
| `/approve <code>` | Approve a new user's pairing code (Telegram) |
| `/addproject <name> <path>` | Register a project for multi-project routing |
| `/rmproject <name>` | Remove a registered project |
| `/bind <name>` | Bind this chat/group to a project |
| `/unbind` | Remove binding (revert to default project) |
| `/projects` | List all projects and their bindings |

## Configuration

Config file location: `~/.config/kite/.env`

Or use the interactive setup wizard:
```bash
kite setup
```

Environment variables override config file. Each adapter respects its own variables:

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USER_IDS=...       # Pairing mode: leave empty for first-use acceptance
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
WEIXIN_BOT_TOKEN=...                # Auto-set by kite setup
WECOM_BOT_ID=...
WECOM_BOT_SECRET=...
CLAUDE_PROJECT_PATH=~/my-project    # Optional: default is current directory
```

## Adding a New IM Platform

1. Create `packages/<platform>/src/index.ts` and `bot.ts`
2. Implement `IMAdapter` interface (see `packages/telegram/` or `packages/feishu/` as examples)
3. Register in `apps/cli/src/index.ts`:
   - Import adapter
   - Add to adapter list in launcher initialization
   - Add env var documentation

## Session Management

- **Local mode**: Claude runs with `stdio: inherit` — full interactive TUI
- **Remote mode**: Claude runs with `-p --resume --output-format text` — piped output sent to IM
- **Session sharing**: Both modes use `--resume` with the same session ID
- **File watching**: SessionScanner monitors `~/.claude/` JSONL files for assistant messages (forwarded to IM in local mode)

## Multi-Project Routing

One kite process can manage multiple projects. Different IM chats/groups can be bound to different projects.

- **ProjectRouter** (`packages/core/src/projectRouter.ts`): manages project registration and chat-to-project bindings
- **Persistence**: `~/.config/kite/projects.json` stores registered projects and bindings
- **Default project**: The directory where `kite` was launched. Unbound chats use this.
- **Routing key**: `<adapter-name>:<chatId>` (e.g., `telegram:-100123456` or `feishu:oc_xxx`)
- **Scope**: Multi-project routing only applies to Remote mode (IM control). Local mode always uses the default project.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Workspace**: Bun monorepo with multiple packages
- **Telegram**: grammy (long polling, no webhook)
- **Feishu**: @larksuiteoapi/node-sdk (WebSocket, no webhook)
- **WeChat**: iLink Bot API (long polling, no webhook)
- **WeCom**: @wecom/aibot-node-sdk (WebSocket, no webhook)
- **File watching**: chokidar (cross-platform fs.watch wrapper)

## Commit Style

Use conventional commits. Commits go directly to `main`.

```
feat: add multi-project routing
fix: prevent duplicate IM messages with single-process constraint
docs: update README with binding instructions
chore: clean up projects.json persistence
```
