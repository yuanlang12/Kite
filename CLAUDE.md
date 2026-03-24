# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kite is a Claude Code launcher that bridges your terminal session to IM platforms (Telegram, Feishu/Lark, WeChat, WeCom). It implements a **mutual-exclusion state machine**: at any moment, either the terminal OR an IM platform is controlling Claude. Both share the same session via `--resume`.

## Communication Style

When discussing decisions with the project owner, use plain language that non-technical users can understand. Avoid jargon and technical terms — explain things in terms of user-facing behavior and outcomes.

## Architecture

**Core principle**: Only one Claude process runs at a time. Local and remote modes never run simultaneously — switching kills the current process and starts a new one with `--resume`.

**Single-process constraint**: Each IM bot token can only be used by one kite process. Use multi-project routing (`/addproject` + `/bind`) to manage multiple projects from a single process.

Key design decisions:
1. **JSONL file watching** — SessionScanner watches Claude Code's session files for real-time assistant message forwarding to IM
2. **Plugin architecture** — Each IM platform is a separate package implementing `IMAdapter` in `packages/<platform>/`
3. **Zero infrastructure** — Runs entirely locally, no external servers
4. **IM feedback layers** — 👀 reaction on receipt, 🤔 thinking message edited to final response
5. **Binding gate** — If registered projects exist and chat has no binding, messages are held until `/bind`

## Development Commands

```bash
bun install          # Install dependencies
bun dev              # Dev mode (apps/cli)
bun typecheck        # Type check workspace
bun lint             # Lint with Biome
bun format           # Format with Biome (auto-fix)
```

## Code Style

- **Formatter/Linter**: Biome (config in `biome.json`)
- Single quotes, no semicolons (`semicolons: asNeeded`)
- 2-space indentation, 100 char line width
- A PostToolUse hook auto-formats on every Write/Edit

## Adding a New IM Platform

1. Create `packages/<platform>/src/index.ts` and `bot.ts`
2. Implement `IMAdapter` interface (see `@packages/core/src/types.ts`)
3. Register in `apps/cli/src/index.ts`

## Commit Style

Use conventional commits. Commits go directly to `main`.

```
feat: add multi-project routing
fix: prevent duplicate IM messages
docs: update README with binding instructions
```
