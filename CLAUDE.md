# Kite

A Claude Code launcher that bridges your terminal session to Telegram, Feishu/Lark, and more. Run `kite` instead of `claude` — same terminal experience, plus IM control.

## What This Project Does

Kite wraps Claude Code with a **mutual-exclusion state machine**: at any moment, either the terminal OR an IM platform is controlling Claude. Both share the same session via `--resume`.

## Architecture

```
用户运行: kite [claude args...]
                │
                ▼
         ┌─── 状态机循环 ───┐
         │                   │
    Local Mode          Remote Mode
    (终端交互)          (Telegram 控制)
         │                   │
    spawn claude         spawn claude
    stdio: inherit       -p --resume --output-format text
    用户正常使用          Telegram 消息注入
         │                   │
    TG 消息到达 ──────→ kill local
                        start remote
         │                   │
    Enter 按键 ←────── kill remote
    start local
```

**核心原则**：任意时刻只有一个 Claude 进程在运行，通过 `--resume` 共享同一个 session。

## Key Design Decisions

1. **Process-level mutual exclusion** — Local and remote modes never run simultaneously. Switching kills the current process and starts a new one with `--resume`.
2. **JSONL file watching** — SessionScanner watches Claude Code's session files for real-time assistant message forwarding to IM (observation mode in local).
3. **Plugin architecture** — each IM platform is a separate package implementing `IMAdapter`. Adding a new platform = adding a new package.
4. **Zero infrastructure** — runs entirely locally. No external servers, no cloud dependencies.
5. **Transparent CLI passthrough** — all arguments passed to `kite` are forwarded to `claude` unchanged.

## Project Structure

```
kite/
├── CLAUDE.md
├── package.json              # Bun workspace root, bin: { kite }
├── packages/
│   ├── core/                 # State machine + session management
│   │   └── src/
│   │       ├── index.ts      # Public exports
│   │       ├── launcher.ts   # State machine main loop (local ↔ remote)
│   │       ├── localMode.ts  # Local mode: spawn claude, stdio inherit
│   │       ├── remoteMode.ts # Remote mode: spawn claude -p, pipe output
│   │       ├── sessionScanner.ts   # Watches ~/.claude JSONL files
│   │       ├── sessionManager.ts   # Legacy SDK-based message injection
│   │       ├── messageQueue.ts     # Async task queue
│   │       └── types.ts            # Shared types + IMAdapter interface
│   ├── telegram/             # Telegram bot adapter (grammy + long polling)
│   │   └── src/
│   │       ├── index.ts
│   │       └── bot.ts
│   └── feishu/               # Feishu/Lark adapter (official SDK + long connection)
│       └── src/
│           ├── index.ts
│           └── bot.ts
└── apps/
    └── cli/                  # Main entry point — CLI launcher
        └── src/
            └── index.ts
```

## Usage

```bash
kite                          # 等同于 claude，但带 Telegram 桥接
kite --resume abc123          # 恢复特定会话
kite "fix the bug"            # 带初始 prompt
```

All arguments are transparently passed to `claude`.

## Adding a New IM Platform

1. Create `packages/<platform>/`
2. Implement the `IMAdapter` interface from `@kite/core`
3. Register the adapter in `apps/cli/src/index.ts`

The `IMAdapter` interface:
```typescript
interface IMAdapter {
  name: string
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void
  sendMessage(chatId: string, text: string): Promise<void>
  editMessage(chatId: string, messageId: string, text: string): Promise<void>
  sendTyping(chatId: string): Promise<void>
}
```

## Environment Variables

```bash
# Telegram
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_ALLOWED_USER_IDS=123456,789012   # comma-separated, leave empty to allow all

# Feishu
FEISHU_APP_ID=xxx
FEISHU_APP_SECRET=xxx

# Optional
CLAUDE_PROJECT_PATH=~/my-project   # default: current directory
```

## Development

```bash
# Install dependencies
bun install

# Run in dev mode
bun dev

# Type check
bun typecheck
```

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Telegram**: grammy (long polling, no webhook needed)
- **Feishu**: @larksuiteoapi/node-sdk (long connection)
- **File watching**: chokidar (cross-platform fs.watch wrapper)

## Relationship to Happy

This project draws inspiration from [Happy](https://github.com/slopus/happy)'s mutual-exclusion state machine model. Key differences:
- Happy syncs to a cloud relay server; we bridge directly to IM platforms
- Happy requires their mobile app; we work with any IM platform
- We are fully local — no cloud server involved
