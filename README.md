# 🪁 Kite

A Claude Code launcher that bridges your terminal session to Telegram, Feishu/Lark, and more.

Run `kite` instead of `claude` — same terminal experience, plus IM control from anywhere.

## How It Works

Kite wraps Claude Code with a **mutual-exclusion state machine**: at any moment, either your terminal OR an IM platform is controlling Claude. Both share the same session via `--resume`.

```
You run: kite [claude args...]
                │
                ▼
         ┌─── State Machine ───┐
         │                      │
    Local Mode            Remote Mode
    (Terminal)            (Telegram)
         │                      │
    spawn claude           spawn claude
    stdio: inherit         -p --resume --output-format text
    Normal terminal        IM messages → Claude → IM reply
         │                      │
    TG message ──────→ kill local, start remote
         │                      │
    Press Enter ←────── kill remote, start local
```

**Only one Claude process runs at a time.** Session is shared via `--resume`.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed
- A Telegram bot token (get one from [@BotFather](https://t.me/BotFather))

### Install

```bash
git clone https://github.com/user/kite.git
cd kite
bun install
bun link
```

### Configure

```bash
mkdir -p ~/.config/kite
cat > ~/.config/kite/.env << 'EOF'
TELEGRAM_BOT_TOKEN=your_token_here
EOF
```

### Run

```bash
kite                          # Same as claude, but with Telegram bridge
kite --resume abc123          # Resume a specific session
kite "fix the bug"            # With initial prompt
kite --model sonnet           # Use a specific model
kite --dangerously-skip-permissions  # YOLO mode (both local + remote)
```

All arguments are transparently passed to `claude`.

## Features

### Terminal (Local Mode)
Identical to running `claude` directly. Full TUI, all features.

### Telegram (Remote Mode)
When a Telegram message arrives, Kite kills the local Claude and starts a remote Claude process to handle it. A retro Macintosh-style TUI shows the activity in your terminal.

**Telegram Commands:**
| Command | Description |
|---------|-------------|
| `/model sonnet` | Switch model (sonnet / opus / haiku) |
| `/effort high` | Set reasoning effort (low / medium / high / max) |
| `/status` | Show current settings |
| `/approve <code>` | Approve a new user's pairing code |

### Access Control
- **First use**: Open mode — your first message to the bot goes through
- **After that**: Pairing mode — new users get a 6-digit code and need approval via `/approve`
- **Or**: Set `TELEGRAM_ALLOWED_USER_IDS` in config for strict allowlist

### Observation Mode
While you work in the terminal, Claude's responses are automatically forwarded to subscribed Telegram chats in real-time.

### Auto Keep-Alive
On macOS, Kite automatically prevents idle sleep (`caffeinate`) so Telegram messages work even when you walk away.

## Configuration

Config file: `~/.config/kite/.env`

```bash
# Telegram
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_ALLOWED_USER_IDS=       # comma-separated, empty = pairing mode

# Feishu / Lark (optional)
FEISHU_APP_ID=xxx
FEISHU_APP_SECRET=xxx
```

Shell environment variables override the config file.

## Project Structure

```
kite/
├── packages/
│   ├── core/                 # State machine, session management, TUI
│   ├── telegram/             # Telegram adapter (grammy, long polling)
│   └── feishu/               # Feishu/Lark adapter (official SDK)
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

## Inspiration

This project draws inspiration from [Happy](https://github.com/slopus/happy)'s mutual-exclusion state machine model.

## License

MIT

---

<details>
<summary><strong>🤖 AI Installation Guide — copy this to Claude / ChatGPT / Cursor to auto-install</strong></summary>

```
I want to install and set up Kite — a Claude Code launcher with Telegram bridge.

Here's what you need to do:

1. Check prerequisites:
   - Bun installed? Run: bun --version
   - Claude Code installed? Run: claude --version
   - If not installed, install Bun from https://bun.sh and Claude Code from https://docs.anthropic.com

2. Clone and install:
   git clone https://github.com/user/kite.git
   cd kite
   bun install
   bun link

3. Set up Telegram bot:
   - I need a Telegram bot token. If I don't have one, tell me to message @BotFather on Telegram,
     send /newbot, follow the prompts, and paste the token here.
   - Once I give you the token, create the config:
     mkdir -p ~/.config/kite
     echo 'TELEGRAM_BOT_TOKEN=<my_token>' > ~/.config/kite/.env

4. Test it:
   Run: kite
   This should start Claude Code normally. Then send a message to the bot on Telegram —
   it should switch to remote mode and respond.

5. If there's a 409 error about "terminated by other getUpdates request", just wait 30 seconds
   and try again — the previous bot session needs to timeout.

Ask me for any information you need (like the bot token) and guide me through each step.
```

</details>
